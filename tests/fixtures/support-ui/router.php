<?php
declare(strict_types=1);
$path = parse_url($_SERVER["REQUEST_URI"], PHP_URL_PATH);
if (isset($_GET["previewRole"]) && in_array($_GET["previewRole"], ["staff", "customer"], true)) {
	setcookie("previewRole", $_GET["previewRole"], ["path" => "/", "samesite" => "Strict"]);
	header("Location: " . $path);
	return;
}
if ($path === "/branding/asset.php") {
	putenv("CEASAR_BRANDING_DIR=" . sys_get_temp_dir() . "/ceasar-branding-preview");
	require dirname(__DIR__, 3) . "/web/branding/asset.php";
	return;
}
if (
	preg_match('#^/(css|js/dist|webfonts|images)/[A-Za-z0-9._/-]+$#', $path) &&
	!str_contains($path, "..")
) {
	$file = dirname(__DIR__, 3) . "/web" . $path;
	if (is_file($file)) {
		header(
			"Content-Type: " .
				(str_ends_with($path, ".css")
					? "text/css"
					: (str_ends_with($path, ".js")
						? "application/javascript"
						: (str_ends_with($path, ".svg")
							? "image/svg+xml"
							: "application/octet-stream"))),
		);
		readfile($file);
		return;
	}
}
if ($path === "/js/dist/support.min.js") {
	header("Content-Type: application/javascript");
	readfile(dirname(__DIR__, 3) . "/web/js/dist/support.min.js");
	return;
}
if ($path === "/branding-preview") {
	require __DIR__ . "/branding.php";
	return;
}
if ($path === "/auth-preview" || $path === "/auth-preview/") {
	require __DIR__ . "/auth-preview.php";
	return;
}
if ($path === "/recovery-preview" || $path === "/recovery-preview/") {
	$_GET["recovery"] = "1";
	require __DIR__ . "/auth-preview.php";
	return;
}
if ($path === "/customer-preview" || $path === "/customer-preview/") {
	require __DIR__ . "/customer-preview.php";
	return;
}
if ($path === "/customer-preview.js") {
	header("Content-Type: application/javascript; charset=utf-8");
	readfile(__DIR__ . "/customer-preview.js");
	return;
}
if ($path === "/email-preview") {
	require __DIR__ . "/email-preview.php";
	return;
}
if (str_starts_with($path, "/api/support/v1")) {
	session_start();
	$_SERVER["HTTP_X_TEST_ROLE"] = $_COOKIE["previewRole"] ?? "staff";
	require dirname(__DIR__) . "/support-api/router.php";
	return;
}
$file = __DIR__ . $path;
if ($path !== "/" && is_file($file)) {
	return false;
}
require __DIR__ . "/index.php";
