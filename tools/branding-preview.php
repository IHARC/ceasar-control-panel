<?php
/**
 * Local-only QA fixture for the native Ceasar white-label templates.
 *
 * Run from the repository root after building the checked-in assets:
 *   npm run build
 *   php -S 127.0.0.1:8099 -t . tools/branding-preview.php
 *
 * The fixture renders the actual native header, login template, footer, and
 * generated theme assets. Use /?brand=iharc to exercise a server-owned name
 * override while keeping the same native page structure.
 */
declare(strict_types=1);

$repositoryRoot = dirname(__DIR__);
$webRoot = realpath($repositoryRoot . "/web");
$requestPath = parse_url($_SERVER["REQUEST_URI"] ?? "/", PHP_URL_PATH) ?: "/";

// The built-in PHP server invokes the router for every request when `-t .` is
// used. Serve the checked-in/generated web assets from their native web root.
if ($webRoot !== false && $requestPath !== "/" && $requestPath !== "") {
	$asset = realpath($webRoot . $requestPath);
	if (
		$asset !== false &&
		is_file($asset) &&
		str_starts_with($asset, $webRoot . DIRECTORY_SEPARATOR)
	) {
		$extension = strtolower(pathinfo($asset, PATHINFO_EXTENSION));
		if ($extension !== "php") {
			$mime = match ($extension) {
				"css" => "text/css",
				"js" => "application/javascript",
				"svg" => "image/svg+xml",
				default => mime_content_type($asset) ?: "application/octet-stream",
			};
			header("Content-Type: " . $mime);
			readfile($asset);
			return true;
		}
	}
}

if (!function_exists("tohtml")) {
	function tohtml(mixed $value): string {
		return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, "UTF-8");
	}
}

if (!function_exists("_")) {
	function _(string $value): string {
		return $value;
	}
}

if (!function_exists("display_title")) {
	function display_title(string $tab): string {
		return str_replace(
			["{{page}}", "{{hostname}}", "{{ip}}", "{{appname}}"],
			[$tab, "preview.local", $_SERVER["REMOTE_ADDR"] ?? "127.0.0.1", $_SESSION["APP_NAME"]],
			$_SESSION["TITLE"],
		);
	}
}

function renderNativeLogin(string $appName, string $repositoryRoot): string {
	$_SERVER["CEASAR"] = $repositoryRoot;
	$_SERVER["DOCUMENT_ROOT"] = $repositoryRoot . "/web";
	$_SERVER["REMOTE_ADDR"] = "127.0.0.1";
	$_SERVER["HTTP_HOST"] = "preview.local";
	$_SESSION = [
		"APP_NAME" => $appName,
		"VERSION" => "1.10.4",
		"LANGUAGE" => "en",
		"language" => "en",
		"TITLE" => "{{page}} - {{appname}}",
		"THEME" => "default",
		"userTheme" => "default",
		"DEBUG_MODE" => "false",
		"HIDE_DOCS" => "yes",
		"token" => "ceasar-preview-token",
		"error_msg" => "",
	];
	$TAB = "LOGIN";
	$user_plain = "";
	if (!defined("JS_LATEST_UPDATE")) {
		define("JS_LATEST_UPDATE", "preview");
	}

	ob_start();
	require $repositoryRoot . "/web/templates/header.php";
	require $repositoryRoot . "/web/templates/pages/login/login.php";
	require $repositoryRoot . "/web/templates/includes/login-footer.php";
	return (string) ob_get_clean();
}

$requestedBrand = strtolower((string) ($_GET["brand"] ?? "ceasar"));
$appName = $requestedBrand === "iharc" ? "IHARC Labs Hosting" : "Ceasar Control Panel";
header("X-Ceasar-Preview-Brand: " . $appName);
echo renderNativeLogin($appName, $repositoryRoot);
