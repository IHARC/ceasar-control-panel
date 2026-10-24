<?php

declare(strict_types=1);

/** Local-only customer portal preview using the production account template and bundle. */
if (getenv("CEASAR_SUPPORT_TEST") !== "1") {
	http_response_code(404);
	exit();
}
putenv("CEASAR_BRANDING_DIR=" . sys_get_temp_dir() . "/ceasar-branding-preview");
session_start();
$_SESSION += ["APP_NAME" => "Ceasar", "FROM_NAME" => "Ceasar Support"];
require dirname(__DIR__, 3) . "/web/inc/customer.php";
if (($_GET["previewAccent"] ?? "") === "red") {
	$GLOBALS["ceasar_branding_config"] = [...branding_defaults(), "accent_color" => "#d62832"];
}

$config = [
	"schema" => 1,
	"brand_name" => branding_name(),
	"supabase_url" => "https://preview.invalid",
	"supabase_publishable_key" => "sb_publishable_preview",
	"passkeys_enabled" => false,
	"passkey_rp_id" => "preview.invalid",
	"password_min_length" => 12,
	"logo_url" => branding_asset_url("header_logo"),
	"support_url" => "https://support.example.test",
	"terms_url" => "https://example.test/terms",
	"privacy_url" => "https://example.test/privacy",
	"login_url" => "http://127.0.0.1:8088/auth-preview?customer=1",
	"callback_url" => "http://127.0.0.1:8088/customer-preview-callback",
	"account_url" => "http://127.0.0.1:8088/customer-preview",
	"worker_api_base" => "/fixture/customer-api",
	"panel_origin" => "http://127.0.0.1:8088",
	"turnstile_site_key" => isset($_GET["previewCaptcha"]) ? "fixture-site-key" : "",
	"captcha_enabled" => isset($_GET["previewCaptcha"]),
	"analytics" => ["measurement_id" => "", "consent_cookie_domain" => ""],
];
$customerPage = $GLOBALS["customer_preview_page"] ?? "account";
$title =
	$customerPage === "login"
		? "Customer sign-in"
		: ($customerPage === "callback"
			? "Email confirmation"
			: "Customer account");
$customer_style_nonce = "fixture";
require dirname(__DIR__, 3) . "/web/templates/customer-header.php";
// customer.min.js is deferred by the real header; this local fixture is ready first.
echo '<script src="/customer-preview.js"></script>';
if ($customerPage === "login") {
	require dirname(__DIR__, 3) . "/web/templates/pages/customer/login.php";
	echo '<p class="customer-form-help"><a href="/customer-preview-callback?code=preview-code" data-preview-confirm>Preview email confirmation link</a></p>';
} elseif ($customerPage === "callback") {
	require dirname(__DIR__, 3) . "/web/templates/pages/customer/callback.php";
} else {
	require dirname(__DIR__, 3) . "/web/templates/pages/customer/account.php";
}
require dirname(__DIR__, 3) . "/web/templates/customer-footer.php";
