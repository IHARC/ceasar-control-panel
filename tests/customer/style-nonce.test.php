<?php

declare(strict_types=1);

putenv("CEASAR_BRANDING_DIR=" . sys_get_temp_dir() . "/ceasar-style-nonce-test");
session_start();
$_SESSION += ["APP_NAME" => "Ceasar", "FROM_NAME" => "Ceasar Support"];
require dirname(__DIR__, 2) . "/web/inc/customer.php";

$customer_style_nonce = "customer-style-test-nonce";
$config = [
	"schema" => 1,
	"brand_name" => "Ceasar",
	"supabase_url" => "https://preview.invalid",
	"supabase_publishable_key" => "sb_publishable_preview",
	"passkeys_enabled" => false,
	"passkey_rp_id" => "preview.invalid",
	"password_min_length" => 12,
	"logo_url" => "/images/logo-header.svg",
	"support_url" => "https://support.example.test",
	"terms_url" => "https://example.test/terms",
	"privacy_url" => "https://example.test/privacy",
	"login_url" => "/customer/login",
	"callback_url" => "/auth/callback",
	"account_url" => "/customer/account",
	"worker_api_base" => "/fixture/customer-api",
	"analytics" => ["measurement_id" => "", "consent_cookie_domain" => ""],
];

ob_start();
customer_render("Customer access unavailable", "customer-disabled", ["config" => $config]);
$markup = (string) ob_get_clean();
if (!str_contains($markup, '<style nonce="customer-style-test-nonce">')) {
	fwrite(STDERR, "Customer branding style lost its Content Security Policy nonce.\n");
	exit(1);
}
echo "Customer branding style nonce is present.\n";
