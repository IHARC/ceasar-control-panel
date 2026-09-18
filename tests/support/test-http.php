<?php

declare(strict_types=1);

$root = dirname(__DIR__, 2);
$data = sys_get_temp_dir() . "/ceasar-support-http-" . bin2hex(random_bytes(4));
mkdir($data, 0700, true);
file_put_contents(
	$data . "/support.json",
	json_encode([
		"database" => $data . "/support.sqlite3",
		"attachments" => $data . "/attachments",
		"staff_recipients" => ["staff@example.test"],
	]),
);
putenv("CEASAR_SUPPORT_TEST=1");
putenv("CEASAR_SUPPORT_CONFIG=" . $data . "/support.json");
$port = random_int(20000, 30000);
$process = proc_open(
	[PHP_BINARY, "-S", "127.0.0.1:" . $port, $root . "/tests/fixtures/support-api/router.php"],
	[1 => ["pipe", "w"], 2 => ["pipe", "w"]],
	$pipes,
	$root,
	["CEASAR_SUPPORT_TEST" => "1", "CEASAR_SUPPORT_CONFIG" => $data . "/support.json"],
);
if (!is_resource($process)) {
	throw new RuntimeException("Unable to start support HTTP fixture.");
}
usleep(300000);
function request_support_http(
	int $port,
	string $method,
	array $payload = [],
	string $role = "customer",
	string $key = "",
	string $user = "",
): array {
	$headers =
		"Content-Type: application/json\r\nX-Test-Role: $role\r\n" .
		(!empty($payload["bearer"]) ? "Authorization: Bearer fixture-token\r\n" : "") .
		($key ? "Idempotency-Key: $key\r\n" : "") .
		($user ? "X-Test-User: $user\r\n" : "");
	unset($payload["bearer"]);
	$context = stream_context_create([
		"http" => [
			"method" => $method,
			"header" => $headers,
			"content" => json_encode($payload),
			"ignore_errors" => true,
		],
	]);
	$path = isset($payload["realApi"])
		? "/real-api"
		: (isset($payload["attachmentId"])
			? "/api/support/v1/attachment/?attachmentId=" .
				rawurlencode((string) $payload["attachmentId"])
			: "/api/support/v1/tickets/");
	unset($payload["realApi"]);
	$response = file_get_contents("http://127.0.0.1:$port" . $path, false, $context);
	return json_decode((string) $response, true, 512, JSON_THROW_ON_ERROR);
}
try {
	foreach (["GET"] as $method) {
		foreach (["create", "reply", "status", "participant-add"] as $mutation) {
			$r = request_support_http(
				$port,
				$method,
				["realApi" => true, "action" => $mutation],
				"customer",
			);
			if (($r["error"]["code"] ?? "") !== "method_not_allowed") {
				throw new RuntimeException("$method mutation guard failed: $mutation");
			}
		}
	}
	$csrf = request_support_http(
		$port,
		"POST",
		["realApi" => true, "action" => "create"],
		"customer",
		"csrf-test-key-0001",
	);
	if (($csrf["error"]["code"] ?? "") !== "csrf_failed") {
		throw new RuntimeException("native CSRF guard failed");
	}
	$bad = request_support_http(
		$port,
		"POST",
		[
			"realApi" => true,
			"bearer" => true,
			"action" => "settings",
			"settings" => ["imap" => "bad"],
		],
		"staff",
		"settings-test-key-0001",
	);
	if (($bad["error"]["code"] ?? "") !== "invalid_settings") {
		throw new RuntimeException("malformed settings must be 422 JSON");
	}
	$key = "http-create-key-01";
	$one = request_support_http(
		$port,
		"POST",
		[
			"bearer" => true,
			"action" => "create",
			"accountId" => "account-1",
			"subject" => "HTTP case",
			"body" => "A request",
		],
		"customer",
		$key,
	);
	$two = request_support_http(
		$port,
		"POST",
		[
			"bearer" => true,
			"action" => "create",
			"accountId" => "account-1",
			"subject" => "HTTP case",
			"body" => "A request",
		],
		"customer",
		$key,
	);
	if (($one["data"]["id"] ?? "") !== ($two["data"]["id"] ?? "")) {
		throw new RuntimeException("HTTP idempotency replay failed.");
	}
	$list = request_support_http($port, "GET", ["action" => "tickets"], "customer");
	if (($list["data"]["total"] ?? 0) !== 1) {
		throw new RuntimeException("HTTP list failed.");
	}
	$forbidden = request_support_http(
		$port,
		"GET",
		["action" => "tickets", "id" => $one["data"]["id"]],
		"customer",
		"",
		"other",
	);
	if (($forbidden["error"]["code"] ?? "") !== "forbidden") {
		throw new RuntimeException("Cross-account ticket access was not rejected.");
	}
	// Use the actual protected attachment endpoint. Customer access to an internal
	// note attachment must fail even when the ticket itself belongs to their account.
	putenv("CEASAR_SUPPORT_CONFIG=" . $data . "/support.json");
	require_once $root . "/web/inc/support.php";
	$db = support_db();
	$messageId = "private-message";
	$attachmentId = "private-attachment";
	$db->prepare(
		"INSERT INTO support_messages(id,ticket_id,author_id,author_email,author_name,author_role,visibility,body,created_at,inbound_key) VALUES(?,?,?,?,?,?, 'internal',?,?,NULL)",
	)->execute([
		$messageId,
		$one["data"]["id"],
		"staff-1",
		"staff@example.test",
		"Staff",
		"staff",
		"private",
		gmdate("Y-m-d\TH:i:s\Z"),
	]);
	@mkdir($data . "/attachments", 0700, true);
	file_put_contents($data . "/attachments/private.bin", "private");
	$db->prepare("INSERT INTO support_attachments VALUES(?,?,?,?,?,?,?,?)")->execute([
		$attachmentId,
		$one["data"]["id"],
		$messageId,
		"private.txt",
		"text/plain",
		7,
		"private.bin",
		gmdate("Y-m-d\TH:i:s\Z"),
	]);
	$blocked = request_support_http($port, "GET", ["attachmentId" => $attachmentId], "customer");
	if (($blocked["error"]["code"] ?? "") !== "forbidden") {
		throw new RuntimeException("Private attachment endpoint leaked to customer.");
	}
	echo "support HTTP tests passed\n";
} finally {
	proc_terminate($process);
	foreach ($pipes as $pipe) {
		fclose($pipe);
	}
	proc_close($process);
}
