<?php

declare(strict_types=1);

/** Read-only visual preview composed from the real native authentication templates. */
putenv("CEASAR_BRANDING_DIR=" . sys_get_temp_dir() . "/ceasar-branding-preview");
session_start();
$_SERVER["CEASAR"] = dirname(__DIR__, 3);
$_SESSION += [
	"APP_NAME" => "Ceasar",
	"TITLE" => "{{appname}} · {{page}}",
	"THEME" => "default",
	"userTheme" => "default",
	"LANGUAGE" => "en",
	"language" => "en",
	"token" => "preview-token",
	"POLICY_SYSTEM_PASSWORD_RESET" => "yes",
];
if (in_array($_GET["theme"] ?? "", ["default", "dark"], true)) {
	$_SESSION["THEME"] = $_GET["theme"];
	$_SESSION["userTheme"] = $_GET["theme"];
}
const JS_LATEST_UPDATE = "preview";
function _(string $value): string {
	return $value;
}
function tohtml(string $value): string {
	return htmlspecialchars($value, ENT_QUOTES, "UTF-8");
}
function display_title(string $tab): string {
	return str_replace(["{{appname}}", "{{page}}"], [branding_name(), $tab], $_SESSION["TITLE"]);
}
$TAB = "LOGIN";
$user_plain = "";
$error = "";
require dirname(__DIR__, 3) . "/web/inc/branding.php";
require dirname(__DIR__, 3) . "/web/templates/header.php";
require dirname(__DIR__, 3) .
	"/web/templates/pages/login/" .
	(!empty($_GET["recovery"]) ? "reset_1.php" : "login.php");
?>
<script>document.addEventListener("submit", event => event.preventDefault());</script>
<?php require dirname(__DIR__, 3) . "/web/templates/includes/login-footer.php"; ?>
