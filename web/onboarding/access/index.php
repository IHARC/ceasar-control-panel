<?php
declare(strict_types=1);
define("NO_AUTH_REQUIRED", true);
require_once $_SERVER["DOCUMENT_ROOT"] . "/inc/main.php";
require_once $_SERVER["DOCUMENT_ROOT"] . "/inc/native-session.php";
header("Cache-Control: no-store");
if ($_SERVER["REQUEST_METHOD"] !== "POST") {
	http_response_code(405);
	exit();
}
try {
	$token = (string) ($_POST["grant"] ?? "");
	if (preg_match('/^[a-f0-9]{64}$/D', $token) !== 1) {
		throw new RuntimeException("Invalid access grant.");
	}
	if (($_SERVER["HTTPS"] ?? "") === "off" || empty($_SERVER["HTTPS"])) {
		throw new RuntimeException("Secure access required.");
	}
	$sourceOrigin = (string) ($_SERVER["HTTP_ORIGIN"] ?? "");
	$panelOrigin = "https://" . (string) ($_SERVER["HTTP_HOST"] ?? "");
	$process = proc_open(
		[
			"/usr/bin/timeout",
			"--kill-after=2",
			"8",
			"/usr/bin/sudo",
			"/usr/local/ceasar/bin/v-onboarding-consume-grant",
			$token,
			$sourceOrigin,
			$panelOrigin,
		],
		[0 => ["pipe", "r"], 1 => ["pipe", "w"], 2 => ["pipe", "w"]],
		$pipes,
	);
	if (!is_resource($process)) {
		throw new RuntimeException("Access unavailable.");
	}
	fclose($pipes[0]);
	$result = stream_get_contents($pipes[1], 4096);
	fclose($pipes[1]);
	stream_get_contents($pipes[2], 1024);
	fclose($pipes[2]);
	if (proc_close($process) !== 0) {
		throw new RuntimeException("Access grant unavailable.");
	}
	$grant = json_decode((string) $result, true, 8, JSON_THROW_ON_ERROR);
	$user = $grant["owner"];
	$data = get_user_data($user)[$user] ?? null;
	if (
		!is_array($data) ||
		($data["ROLE"] ?? "") === "admin" ||
		($data["SUSPENDED"] ?? "") === "yes"
	) {
		throw new RuntimeException("Hosting access unavailable.");
	}
	native_begin_user_session($user, $data, false);
	header("Location: " . $grant["destination"], true, 303);
} catch (Throwable $error) {
	http_response_code(403);
	echo "This hosting access link is expired or unavailable. Return to your account to request a new one.";
}
