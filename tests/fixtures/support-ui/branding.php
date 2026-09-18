<?php

declare(strict_types=1);

/** Disposable visual fixture for the actual shared branding helpers and page template. */
putenv("CEASAR_BRANDING_DIR=" . sys_get_temp_dir() . "/ceasar-branding-preview");
session_start();
$_SESSION += [
	"APP_NAME" => "Ceasar",
	"FROM_NAME" => "Ceasar",
	"FROM_EMAIL" => "noreply@example.test",
	"TITLE" => "{{appname}}",
	"SUBJECT_EMAIL" => "{{appname}}: {{subject}}",
	"HIDE_DOCS" => "no",
	"VERSION" => "preview",
	"token" => "preview-token",
];
function _(string $value): string {
	return $value;
}
function tohtml(string $value): string {
	return htmlspecialchars($value, ENT_QUOTES, "UTF-8");
}
function get_hostname(): string {
	return "preview.example.test";
}
function show_alert_message(array $session): void {
	if (!empty($session["ok_msg"])) {
		echo '<p class="success">' . tohtml($session["ok_msg"]) . "</p>";
	}
	if (!empty($session["error_msg"])) {
		echo '<p class="error">' . tohtml($session["error_msg"]) . "</p>";
	}
}
require dirname(__DIR__, 3) . "/web/inc/branding.php";

if ($_SERVER["REQUEST_METHOD"] === "POST") {
	try {
		$branding = branding_save([
			"name" => trim((string) ($_POST["v_app_name"] ?? branding_name())),
			"accent_color" => branding_validate_color(
				(string) ($_POST["v_accent_color"] ?? "#5b5bd6"),
			),
			"legal_url" => branding_validate_url((string) ($_POST["v_legal_url"] ?? "")),
			"privacy_url" => branding_validate_url((string) ($_POST["v_privacy_url"] ?? "")),
			"support_url" => branding_validate_url((string) ($_POST["v_support_url"] ?? "")),
			"sender_name" => trim((string) ($_POST["v_from_name"] ?? "")),
		]);
		foreach (["logo", "header_logo", "favicon"] as $kind) {
			if (!empty($_POST["v_reset_" . $kind])) {
				branding_reset_asset($kind);
			}
			if (
				isset($_FILES["v_" . $kind]) &&
				($_FILES["v_" . $kind]["error"] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE
			) {
				branding_save([$kind => branding_store_upload($kind, $_FILES["v_" . $kind])]);
			}
		}
		$_SESSION["ok_msg"] = "Branding settings saved.";
	} catch (Throwable $error) {
		$_SESSION["error_msg"] = $error->getMessage();
	}
}
$branding = branding_config();
$v_app_name = $branding["name"];
$v_from_name = $branding["sender_name"];
$v_title = $_SESSION["TITLE"];
$v_from_email = $_SESSION["FROM_EMAIL"];
$v_subject_email = $_SESSION["SUBJECT_EMAIL"];
$v_hide_docs = $_SESSION["HIDE_DOCS"];
?><!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title><?= tohtml(
	branding_name(),
) ?> branding preview</title>
<link rel="stylesheet" href="/css/themes/default.min.css"><style>:root { <?= branding_accent_style() ?> } body { padding-top:40px; }</style>
</head><body><header class="top-bar"><div class="container"><a class="top-bar-logo" href="/branding-preview"><img class="top-bar-logo-image" src="<?= tohtml(
	branding_asset_url("header_logo"),
) ?>" alt="<?= tohtml(branding_name()) ?>"></a></div></header>
<?php require dirname(__DIR__, 3) . "/web/templates/pages/edit_whitelabel.php"; ?>
<footer class="app-footer"><a href="https://iharc.ca/">Powered by IHARC Labs</a></footer></body></html><?php unset(
	$_SESSION["ok_msg"],
	$_SESSION["error_msg"],
);
