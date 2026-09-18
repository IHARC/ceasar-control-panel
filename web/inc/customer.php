<?php

declare(strict_types=1);

require_once __DIR__ . "/branding.php";

const CEASAR_CUSTOMER_CONFIG = "/usr/local/ceasar/conf/customer.json";

function customer_bootstrap(): void {
	global $customer_style_nonce;
	$customer_style_nonce = base64_encode(random_bytes(18));
	$config = customer_config();
	$connectSource =
		parse_url((string) $config["supabase_url"], PHP_URL_SCHEME) .
		"://" .
		parse_url((string) $config["supabase_url"], PHP_URL_HOST);
	if (parse_url((string) $config["supabase_url"], PHP_URL_PORT) !== null) {
		$connectSource .= ":" . parse_url((string) $config["supabase_url"], PHP_URL_PORT);
	}

	header("Cache-Control: no-store, max-age=0");
	$logoSource = customer_logo_source((string) $config["logo_url"]);
	header(
		"Content-Security-Policy: default-src 'self'; img-src 'self' data:{$logoSource}; style-src 'self' 'nonce-{$customer_style_nonce}'; " .
			"script-src 'self'; connect-src 'self' {$connectSource}; frame-ancestors 'none'; " .
			"base-uri 'none'; form-action 'self' https://checkout.stripe.com https://billing.stripe.com",
	);
	header("Referrer-Policy: strict-origin-when-cross-origin");
	header("X-Content-Type-Options: nosniff");
	header("X-Frame-Options: DENY");

	if (($config["enabled"] ?? false) !== true) {
		http_response_code(404);
		customer_render("Customer access unavailable", "customer-disabled", ["config" => $config]);
		exit();
	}
}

/** @return array<string, mixed> */
function customer_config(): array {
	static $config;
	if (is_array($config)) {
		return $config;
	}

	$branding = branding_config();
	$path = CEASAR_CUSTOMER_CONFIG;
	$data = [];
	if (is_file($path)) {
		$decoded = json_decode((string) file_get_contents($path), true, 32, JSON_THROW_ON_ERROR);
		if (!is_array($decoded)) {
			throw new RuntimeException("Customer module configuration is invalid.");
		}
		$data = $decoded;
	}

	if (($data["enabled"] ?? false) !== true) {
		$config = [
			"schema" => 1,
			"enabled" => false,
			"supabase_url" => "https://disabled.invalid",
			"supabase_publishable_key" => "",
			"terms_url" =>
				$branding["legal_url"] !== ""
					? $branding["legal_url"]
					: "https://example.invalid/terms",
			"privacy_url" =>
				$branding["privacy_url"] !== ""
					? $branding["privacy_url"]
					: "https://example.invalid/privacy",
			"brand_name" => $branding["name"],
			"passkeys_enabled" => false,
			"passkey_rp_id" => "",
			"password_min_length" => 6,
			"logo_url" => branding_asset_url("header_logo"),
			"support_url" => $branding["support_url"],
			"login_url" => "",
			"callback_url" => "",
			"account_url" => "",
			"worker_api_base" => "/api/customer/v1",
		];

		return $config;
	}

	$supabaseUrl = $data["supabase_url"] ?? "";
	$publishableKey = $data["supabase_publishable_key"] ?? "";
	$rpId = $data["passkey_rp_id"] ?? "";
	$passwordMinLength = $data["password_min_length"] ?? 6;
	$requestOrigin = customer_request_origin();
	$loginUrl = $data["login_url"] ?? $requestOrigin . "/customer/login";
	$callbackUrl = $data["callback_url"] ?? $requestOrigin . "/auth/callback";
	$accountUrl = $data["account_url"] ?? $requestOrigin . "/customer/account";
	$workerApiBase = $data["worker_api_base"] ?? "/api/customer/v1";
	if (
		!is_string($supabaseUrl) ||
		!is_string($publishableKey) ||
		!is_string($rpId) ||
		!is_int($passwordMinLength) ||
		!is_string($loginUrl) ||
		!is_string($callbackUrl) ||
		!is_string($accountUrl)
	) {
		throw new RuntimeException("Customer module configuration is invalid.");
	}
	customer_require_supabase_url($supabaseUrl);
	if (!str_starts_with($publishableKey, "sb_publishable_")) {
		throw new RuntimeException("Customer authentication requires a Supabase publishable key.");
	}
	customer_require_rp_id($rpId);
	if ($passwordMinLength < 6 || $passwordMinLength > 128) {
		throw new RuntimeException("Customer password minimum must be between 6 and 128.");
	}
	$login = customer_require_customer_url($loginUrl, "/customer/login");
	$callback = customer_require_customer_url($callbackUrl, "/auth/callback");
	$account = customer_require_customer_url($accountUrl, "/customer/account");
	$workerApiBase = customer_require_worker_api_base($workerApiBase);
	if (customer_url_origin($login) !== customer_url_origin($account)) {
		throw new RuntimeException("Customer login and account URLs must share one origin.");
	}
	foreach ([$login, $callback, $account] as $customerUrl) {
		$host = strtolower((string) $customerUrl["host"]);
		if ($host !== strtolower($rpId) && !str_ends_with($host, "." . strtolower($rpId))) {
			throw new RuntimeException(
				"Customer URLs must be covered by the passkey relying-party ID.",
			);
		}
	}

	$config = [
		"schema" => $data["schema"] ?? 1,
		"enabled" => true,
		"supabase_url" => rtrim($supabaseUrl, "/"),
		"supabase_publishable_key" => $publishableKey,
		"terms_url" => $branding["legal_url"],
		"privacy_url" => $branding["privacy_url"],
		"brand_name" => $branding["name"],
		"passkeys_enabled" => ($data["passkeys_enabled"] ?? false) === true,
		"passkey_rp_id" => strtolower($rpId),
		"password_min_length" => $passwordMinLength,
		"logo_url" => branding_asset_url("header_logo"),
		"support_url" => $branding["support_url"],
		"login_url" => rtrim($loginUrl, "/"),
		"callback_url" => rtrim($callbackUrl, "/"),
		"account_url" => rtrim($accountUrl, "/"),
		"worker_api_base" => $workerApiBase,
	];
	if ($config["schema"] !== 1) {
		throw new RuntimeException("Customer module configuration schema is unsupported.");
	}

	return $config;
}

function customer_require_worker_api_base(mixed $value): string {
	if (
		!is_string($value) ||
		strlen($value) > 200 ||
		preg_match("#^/[A-Za-z0-9][A-Za-z0-9._~!$&'()*+,;=:@/-]*/?$#D", $value) !== 1
	) {
		throw new RuntimeException("Customer worker API base must be a same-origin path.");
	}
	$normalized = rtrim($value, "/");
	foreach (explode("/", substr($normalized, 1)) as $segment) {
		if ($segment === "" || $segment === "." || $segment === "..") {
			throw new RuntimeException("Customer worker API base must be a canonical path.");
		}
	}

	return $normalized;
}

/** @param array<string, mixed> $context */
function customer_render(string $title, string $template, array $context = []): void {
	$path = dirname(__DIR__) . "/templates/pages/customer/" . $template . ".php";
	if (!is_file($path)) {
		throw new RuntimeException("Customer page template is unavailable.");
	}
	extract($context, EXTR_SKIP);
	$config = $context["config"] ?? customer_config();
	require dirname(__DIR__) . "/templates/customer-header.php";
	require $path;
	require dirname(__DIR__) . "/templates/customer-footer.php";
}

/** @param array<string, mixed> $config */
function customer_config_json(array $config): string {
	$public = [
		"schema" => $config["schema"],
		"brandName" => $config["brand_name"],
		"supabaseUrl" => $config["supabase_url"],
		"supabasePublishableKey" => $config["supabase_publishable_key"],
		"passkeysEnabled" => $config["passkeys_enabled"],
		"passkeyRpId" => $config["passkey_rp_id"],
		"passwordMinLength" => $config["password_min_length"],
		"logoUrl" => $config["logo_url"],
		"supportUrl" => $config["support_url"],
		"loginUrl" => $config["login_url"],
		"callbackUrl" => $config["callback_url"],
		"accountUrl" => $config["account_url"],
		"workerApiBase" => $config["worker_api_base"],
	];

	return htmlspecialchars(
		json_encode($public, JSON_THROW_ON_ERROR | JSON_HEX_TAG | JSON_HEX_AMP),
		ENT_NOQUOTES,
	);
}

function customer_request_scheme(): string {
	return !empty($_SERVER["HTTPS"]) && $_SERVER["HTTPS"] !== "off" ? "https" : "http";
}

function customer_request_origin(): string {
	$host = $_SERVER["HTTP_HOST"] ?? "";
	if (
		!is_string($host) ||
		preg_match('/^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])(?::[0-9]{1,5})?$/D', $host) !== 1
	) {
		throw new RuntimeException("Customer request host is invalid.");
	}

	return customer_request_scheme() . "://" . strtolower($host);
}

function customer_require_supabase_url(string $url): void {
	$parts = parse_url($url);
	if (
		!is_array($parts) ||
		($parts["scheme"] ?? null) !== "https" ||
		empty($parts["host"]) ||
		isset($parts["user"]) ||
		isset($parts["pass"]) ||
		isset($parts["query"]) ||
		isset($parts["fragment"])
	) {
		throw new RuntimeException("Customer Supabase URL is invalid.");
	}
}

function customer_require_public_https_url(string $url, string $field): void {
	$parts = parse_url($url);
	if (!is_array($parts) || ($parts["scheme"] ?? null) !== "https" || empty($parts["host"])) {
		throw new RuntimeException("Customer {$field} must be a public HTTPS URL.");
	}
}

function customer_require_logo_url(string $url): void {
	if (
		preg_match(
			'#^/(?:images/[A-Za-z0-9][A-Za-z0-9._/-]*|branding/asset\\.php\\?kind=(?:logo|header_logo|favicon)(?:&v=[A-Fa-f0-9]{64})?)$#D',
			$url,
		) === 1
	) {
		return;
	}
	customer_require_public_https_url($url, "logo_url");
}

function customer_logo_source(string $url): string {
	$parts = parse_url($url);
	if (!is_array($parts) || ($parts["scheme"] ?? null) !== "https" || empty($parts["host"])) {
		return "";
	}
	return " https://" . $parts["host"] . (isset($parts["port"]) ? ":" . (int) $parts["port"] : "");
}

/** @return array<string, mixed> */
function customer_require_customer_url(string $url, string $expectedPath): array {
	$parts = parse_url($url);
	if (
		!is_array($parts) ||
		($parts["scheme"] ?? null) !== "https" ||
		empty($parts["host"]) ||
		isset($parts["user"]) ||
		isset($parts["pass"]) ||
		isset($parts["query"]) ||
		isset($parts["fragment"]) ||
		rtrim((string) ($parts["path"] ?? ""), "/") !== $expectedPath
	) {
		throw new RuntimeException("Customer URL must use {$expectedPath}.");
	}

	return $parts;
}

/** @param array<string, mixed> $parts */
function customer_url_origin(array $parts): string {
	return strtolower((string) $parts["scheme"]) .
		"://" .
		strtolower((string) $parts["host"]) .
		(isset($parts["port"]) ? ":" . (int) $parts["port"] : "");
}

function customer_require_rp_id(string $rpId): void {
	$host = strtolower((string) preg_replace('/:\d+$/', "", $_SERVER["HTTP_HOST"] ?? ""));
	if (
		$rpId === "" ||
		preg_match('/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/D', $rpId) !== 1 ||
		($host !== $rpId && !str_ends_with($host, "." . $rpId))
	) {
		throw new RuntimeException(
			"Passkey relying-party ID does not match the customer hostname.",
		);
	}
}
