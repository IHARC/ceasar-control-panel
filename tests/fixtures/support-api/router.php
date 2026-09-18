<?php

declare(strict_types=1);

// Test-only HTTP adapter. It never loads a production config: the harness must
// provide CEASAR_SUPPORT_CONFIG under the system temp directory.
if (
	getenv("CEASAR_SUPPORT_TEST") !== "1" ||
	!str_starts_with((string) getenv("CEASAR_SUPPORT_CONFIG"), sys_get_temp_dir())
) {
	http_response_code(404);
	exit();
}
$path = rtrim((string) parse_url($_SERVER["REQUEST_URI"] ?? "/", PHP_URL_PATH), "/");
if ($path === "/real-api") {
	require dirname(__DIR__, 3) . "/web/inc/support.php";
	support_api();
}
if ($path === "/api/support/v1/attachment" && ($_SERVER["REQUEST_METHOD"] ?? "GET") === "GET") {
	require dirname(__DIR__, 3) . "/web/api/support/attachment.php";
	return;
}
require dirname(__DIR__, 3) . "/web/inc/support.php";
support_api();
