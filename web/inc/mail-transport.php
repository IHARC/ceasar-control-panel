<?php

declare(strict_types=1);

if (is_file(__DIR__ . "/vendor/autoload.php")) {
	require_once __DIR__ . "/vendor/autoload.php";
}

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\SMTP;

class CeasarOutcomeSMTP extends SMTP {
	public bool $dataAttempted = false;
	public bool $dataUncertain = false;
	public function data($message): bool {
		$this->dataAttempted = true;
		$ok = parent::data($message);
		$error = $this->getError();
		$this->dataUncertain = !$ok && empty($error["smtp_code"]);
		return $ok;
	}
}

/** Read Ceasar's existing system SMTP settings without bootstrapping web authentication. */
function ceasar_system_mail_config(): array {
	static $config;
	if (is_array($config)) {
		return $config;
	}
	$output = [];
	$code = 1;
	$command = defined("CEASAR_CMD")
		? CEASAR_CMD . "v-list-sys-config json"
		: "/usr/bin/sudo /usr/local/ceasar/bin/v-list-sys-config json 2>/dev/null";
	exec($command, $output, $code);
	$data = $code === 0 ? json_decode(implode("", $output), true) : null;
	return $config = is_array($data["config"] ?? null) ? $data["config"] : [];
}

/**
 * Shared PHPMailer transport used by existing panel mail and the support worker/API.
 * A true result means the configured transport accepted the message; it is not delivery confirmation.
 */
function ceasar_send_email(
	string $to,
	string $subject,
	string $mailtext,
	string $from,
	string $fromName,
	string $toName = "",
	string $replyTo = "",
	array $headers = [],
	?array $transport = null,
): bool {
	if (!class_exists(PHPMailer::class)) {
		require_once __DIR__ . "/vendor/autoload.php";
	}
	$transport ??= ceasar_system_mail_config();
	$mail = new PHPMailer();
	$outcomeSmtp = new CeasarOutcomeSMTP();
	$mail->setSMTPInstance($outcomeSmtp);
	if (($transport["USE_SERVER_SMTP"] ?? "") === "true") {
		if (filter_var($transport["SERVER_SMTP_ADDR"] ?? "", FILTER_VALIDATE_EMAIL)) {
			$from = (string) $transport["SERVER_SMTP_ADDR"];
		}
		$mail->isSMTP();
		$mail->Mailer = "smtp";
		$mail->SMTPDebug = 0;
		$mail->SMTPAuth = (string) ($transport["SERVER_SMTP_USER"] ?? "") !== "";
		$mail->SMTPSecure = (string) ($transport["SERVER_SMTP_SECURITY"] ?? "");
		$mail->Port = (int) ($transport["SERVER_SMTP_PORT"] ?? 25);
		$mail->Host = (string) ($transport["SERVER_SMTP_HOST"] ?? "");
		$mail->Username = (string) ($transport["SERVER_SMTP_USER"] ?? "");
		$mail->Password = (string) ($transport["SERVER_SMTP_PASSWD"] ?? "");
	}
	$mail->isHTML(true);
	$mail->clearReplyTos();
	if ($toName === "") {
		$mail->addAddress($to);
	} else {
		$mail->addAddress($to, $toName);
	}
	$mail->setFrom($from, $fromName);
	if ($replyTo !== "" && filter_var($replyTo, FILTER_VALIDATE_EMAIL)) {
		$mail->addReplyTo($replyTo);
	}
	foreach ($headers as $name => $value) {
		$mail->addCustomHeader((string) $name, (string) $value);
	}
	$mail->CharSet = "utf-8";
	$mail->Subject = $subject;
	$mail->msgHTML(nl2br($mailtext));
	$sent = $mail->send();
	$GLOBALS["ceasar_mail_last_outcome"] = [
		"uncertain" => !$sent && $outcomeSmtp->dataUncertain,
		"error" => $mail->ErrorInfo,
	];
	return $sent;
}

/** SMTP acceptance outcome. Only a lost/timeout response after DATA is ambiguous. */
function ceasar_send_email_result(
	string $to,
	string $subject,
	string $mailtext,
	string $from,
	string $fromName,
	string $toName = "",
	string $replyTo = "",
	array $headers = [],
	?array $transport = null,
): array {
	try {
		$accepted = ceasar_send_email(
			$to,
			$subject,
			$mailtext,
			$from,
			$fromName,
			$toName,
			$replyTo,
			$headers,
			$transport,
		);
		return [
			"accepted" => $accepted === true,
			"uncertain" => !empty($GLOBALS["ceasar_mail_last_outcome"]["uncertain"]),
			"error" =>
				$accepted === true
					? null
					: $GLOBALS["ceasar_mail_last_outcome"]["error"] ??
						"SMTP transport rejected the message before confirmed acceptance.",
		];
	} catch (Throwable $e) {
		$error = $e->getMessage();
		$ambiguous =
			preg_match(
				"/(?:data not accepted|after data|end of data|connection.*(?:closed|lost|reset|timed out)|unexpected eof)/i",
				$error,
			) === 1;
		return ["accepted" => false, "uncertain" => $ambiguous, "error" => substr($error, 0, 500)];
	}
}
