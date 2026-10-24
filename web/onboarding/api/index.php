<?php
declare(strict_types=1);
require_once $_SERVER["DOCUMENT_ROOT"] . "/inc/main.php";
header("Content-Type: application/json; charset=utf-8");
header("Cache-Control: no-store");
if (
	$_SERVER["REQUEST_METHOD"] !== "POST" ||
	empty($_SESSION["user"]) ||
	!empty($_SESSION["look"])
) {
	http_response_code(403);
	echo '{"error":"Forbidden"}';
	exit();
}
$body = file_get_contents("php://input");
try {
	if (!is_string($body) || strlen($body) > 24576) {
		throw new InvalidArgumentException("Invalid request.");
	}
	$request = json_decode($body, true, 32, JSON_THROW_ON_ERROR);
	if (
		!is_array($request) ||
		!hash_equals(
			(string) ($_SESSION["token"] ?? ""),
			(string) ($_SERVER["HTTP_X_CEASAR_CSRF"] ?? ""),
		)
	) {
		throw new RuntimeException("Invalid session token.");
	}
	$action = $request["action"] ?? null;
	if (
		!is_string($action) ||
		!in_array(
			$action,
			[
				"read-draft",
				"save-draft",
				"prepare",
				"status",
				"retry",
				"wordpress-access",
				"domain-status",
				"connect-domain",
				"confirm-migration",
				"create-grant",
			],
			true,
		)
	) {
		throw new InvalidArgumentException("Unsupported action.");
	}
	unset($request["action"]);
	$command = [
		"/usr/bin/timeout",
		"--kill-after=2",
		"18",
		"/usr/bin/sudo",
		"/usr/local/ceasar/bin/v-onboarding-request",
		$_SESSION["user"],
		$action,
		base64_encode(json_encode($request, JSON_THROW_ON_ERROR)),
	];
	$process = proc_open(
		$command,
		[0 => ["pipe", "r"], 1 => ["pipe", "w"], 2 => ["pipe", "w"]],
		$pipes,
	);
	if (!is_resource($process)) {
		throw new RuntimeException("Setup service unavailable.");
	}
	fclose($pipes[0]);
	$output = stream_get_contents($pipes[1], 32768);
	fclose($pipes[1]);
	stream_get_contents($pipes[2], 2048);
	fclose($pipes[2]);
	if (proc_close($process) !== 0) {
		throw new RuntimeException("Setup action could not be completed.");
	}
	echo $output;
} catch (Throwable $error) {
	http_response_code($error instanceof InvalidArgumentException ? 400 : 409);
	echo json_encode(["error" => $error->getMessage()], JSON_THROW_ON_ERROR);
}
