<?php
use function Ceasar\Shell\quoteshellarg;

$TAB = "SERVER";

// Main include
include $_SERVER["DOCUMENT_ROOT"] . "/inc/main.php";
require_once $_SERVER["DOCUMENT_ROOT"] . "/inc/branding.php";

// Check user
if ($_SESSION["userContext"] != "admin") {
	header("Location: /list/user");
	exit();
}
branding_migrate_legacy();

if (!empty($_POST)) {
	verify_csrf($_POST);
	if (!empty($_POST["v_title"]) && $_SESSION["TITLE"] != $_POST["v_title"]) {
		exec(
			CEASAR_CMD . "v-change-sys-config-value TITLE " . quoteshellarg($_POST["v_title"]),
			$output,
			$return_var,
		);
	}
	if (
		!empty($_POST["v_subject_email"]) &&
		$_SESSION["SUBJECT_EMAIL"] != $_POST["v_subject_email"]
	) {
		exec(
			CEASAR_CMD .
				"v-change-sys-config-value SUBJECT_EMAIL " .
				quoteshellarg($_POST["v_subject_email"]),
			$output,
			$return_var,
		);
	}
	if (!empty($_POST["v_hide_docs"]) && $_SESSION["HIDE_DOCS"] != $_POST["v_hide_docs"]) {
		exec(
			CEASAR_CMD .
				"v-change-sys-config-value HIDE_DOCS " .
				quoteshellarg($_POST["v_hide_docs"]),
			$output,
			$return_var,
		);
	}

	if (!empty($_POST["v_from_email"]) && $_SESSION["FROM_EMAIL"] != $_POST["v_from_email"]) {
		exec(
			CEASAR_CMD .
				"v-change-sys-config-value FROM_EMAIL " .
				quoteshellarg($_POST["v_from_email"]),
			$output,
			$return_var,
		);
	}
	if (!empty($_POST["v_hide_docs"]) && $_SESSION["HIDE_DOCS"] != $_POST["v_hide_docs"]) {
		exec(
			CEASAR_CMD .
				"v-change-sys-config-value HIDE_DOCS " .
				quoteshellarg($_POST["v_hide_docs"]),
			$output,
			$return_var,
		);
	}
	try {
		$branding = branding_save([
			"name" => trim((string) ($_POST["v_app_name"] ?? $_SESSION["APP_NAME"])),
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
				$branding[$kind] = "";
			}
			if (isset($_FILES["v_" . $kind])) {
				$asset = branding_store_upload($kind, $_FILES["v_" . $kind]);
				if ($asset !== "") {
					$branding[$kind] = $asset;
				}
			}
		}
		branding_save($branding);
		$_SESSION["ok_msg"] = _("Branding settings saved.");
	} catch (Throwable $exception) {
		$_SESSION["error_msg"] = $exception->getMessage();
	}
}

// Check system configuration
exec(CEASAR_CMD . "v-list-sys-config json", $output, $return_var);
$data = json_decode(implode("", $output), true);
unset($output);

$sys_arr = $data["config"];
foreach ($sys_arr as $key => $value) {
	$_SESSION[$key] = $value;
}

$v_title = $_SESSION["TITLE"];
$branding = branding_config();
$v_app_name = $branding["name"];
$v_hide_docs = $_SESSION["HIDE_DOCS"];
$v_from_name = $branding["sender_name"];
$v_from_email = $_SESSION["FROM_EMAIL"];
$v_subject_email = $_SESSION["SUBJECT_EMAIL"];
// Render page
render_page($user, $TAB, "edit_whitelabel");

// Flush session messages
unset($_SESSION["error_msg"]);
unset($_SESSION["ok_msg"]);
