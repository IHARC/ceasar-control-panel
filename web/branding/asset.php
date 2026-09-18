<?php

declare(strict_types=1);

require dirname(__DIR__) . "/inc/branding.php";

$kind = $_GET["kind"] ?? "";
if (!is_string($kind) || !in_array($kind, ["logo", "header_logo", "favicon"], true)) {
	http_response_code(404);
	exit();
}
$config = branding_config();
$name = $config[$kind];
if (
	$name === "" ||
	preg_match('/^(?:logo|header_logo|favicon)\\.(?:png|webp|svg)$/D', $name) !== 1
) {
	http_response_code(404);
	exit();
}
$path = CEASAR_BRANDING_ASSET_DIR . "/" . $name;
if (!is_file($path)) {
	http_response_code(404);
	exit();
}
$type = match (pathinfo($path, PATHINFO_EXTENSION)) {
	"png" => "image/png",
	"webp" => "image/webp",
	"svg" => "image/svg+xml",
};
header("Content-Type: " . $type);
header("Cache-Control: private, max-age=300");
header("X-Content-Type-Options: nosniff");
if ($type === "image/svg+xml") {
	header(
		"Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:",
	);
}
readfile($path);
