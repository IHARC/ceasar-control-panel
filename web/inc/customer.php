<?php

declare(strict_types=1);

const CEASAR_CUSTOMER_CONFIG = "/usr/local/ceasar/conf/customer.json";
const CEASAR_SYSTEM_CONFIG = "/etc/ceasar/ceasar.conf";

function customer_bootstrap(): void {
	$config = customer_config();
	$connectSource =
		parse_url((string) $config["supabase_url"], PHP_URL_SCHEME) .
		"://" .
		parse_url((string) $config["supabase_url"], PHP_URL_HOST);
	if (parse_url((string) $config["supabase_url"], PHP_URL_PORT) !== null) {
		$connectSource .= ":" . parse_url((string) $config["supabase_url"], PHP_URL_PORT);
	}

	header("Cache-Control: no-store, max-age=0");
	header(
		"Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self'; " .
			"script-src 'self'; connect-src 'self' {$connectSource}; frame-ancestors 'none'; " .
			"base-uri 'none'; form-action 'self' https://checkout.stripe.com https://billing.stripe.com",
	);
	header("Referrer-Policy: strict-origin-when-cross-origin");
	header("X-Content-Type-Options: nosniff");
	header("X-Frame-Options: DENY");

	if (!customer_module_enabled($config)) {
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

	$fixture = getenv("CEASAR_CUSTOMER_FIXTURE") === "1";
	$path = getenv("CEASAR_CUSTOMER_CONFIG");
	if (!is_string($path) || $path === "") {
		$path = CEASAR_CUSTOMER_CONFIG;
	}
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
			"terms_url" => "https://example.invalid/terms",
			"privacy_url" => "https://example.invalid/privacy",
			"brand_name" => "Ceasar",
			"passkeys_enabled" => false,
			"passkey_rp_id" => "",
			"login_url" => "",
			"callback_url" => "",
			"account_url" => "",
			"worker_api_base" => "/api/customer/v1",
			"fixture" => $fixture,
		];

		return $config;
	}

	$supabaseUrl = $data["supabase_url"] ?? ($fixture ? customer_request_origin() : "");
	$publishableKey = $data["supabase_publishable_key"] ?? "";
	$terms = $data["terms_url"] ?? "https://example.invalid/terms";
	$privacy = $data["privacy_url"] ?? "https://example.invalid/privacy";
	$rpId = $data["passkey_rp_id"] ?? "";
	$requestOrigin = customer_request_origin();
	$loginUrl = $data["login_url"] ?? $requestOrigin . "/customer/login";
	$callbackUrl = $data["callback_url"] ?? $requestOrigin . "/auth/callback";
	$accountUrl = $data["account_url"] ?? $requestOrigin . "/customer/account";
	$workerApiBase = $data["worker_api_base"] ?? "/api/customer/v1";
	if (
		!is_string($supabaseUrl) ||
		!is_string($publishableKey) ||
		!is_string($terms) ||
		!is_string($privacy) ||
		!is_string($rpId) ||
		!is_string($loginUrl) ||
		!is_string($callbackUrl) ||
		!is_string($accountUrl)
	) {
		throw new RuntimeException("Customer module configuration is invalid.");
	}
	customer_require_supabase_url($supabaseUrl, $fixture);
	if (!$fixture && !str_starts_with($publishableKey, "sb_publishable_")) {
		throw new RuntimeException("Customer authentication requires a Supabase publishable key.");
	}
	if ($fixture && $publishableKey === "") {
		$publishableKey = "sb_publishable_fixture";
	}
	customer_require_public_https_url($terms, "terms_url");
	customer_require_public_https_url($privacy, "privacy_url");
	customer_require_rp_id($rpId, $fixture);
	$login = customer_require_customer_url($loginUrl, "/customer/login", $fixture);
	$callback = customer_require_customer_url($callbackUrl, "/auth/callback", $fixture);
	$account = customer_require_customer_url($accountUrl, "/customer/account", $fixture);
	$workerApiBase = customer_require_worker_api_base($workerApiBase);
	if (customer_url_origin($login) !== customer_url_origin($account)) {
		throw new RuntimeException("Customer login and account URLs must share one origin.");
	}
	foreach ([$login, $callback, $account] as $customerUrl) {
		$host = strtolower((string) $customerUrl["host"]);
		if (
			!$fixture &&
			$host !== strtolower($rpId) &&
			!str_ends_with($host, "." . strtolower($rpId))
		) {
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
		"terms_url" => $terms,
		"privacy_url" => $privacy,
		"brand_name" => is_string($data["brand_name"] ?? null) ? $data["brand_name"] : "Ceasar",
		"passkeys_enabled" => ($data["passkeys_enabled"] ?? false) === true,
		"passkey_rp_id" => strtolower($rpId),
		"login_url" => rtrim($loginUrl, "/"),
		"callback_url" => rtrim($callbackUrl, "/"),
		"account_url" => rtrim($accountUrl, "/"),
		"worker_api_base" => $workerApiBase,
		"fixture" => $fixture,
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

/** @param array<string, mixed> $config */
function customer_module_enabled(array $config): bool {
	if (getenv("CEASAR_CUSTOMER_FIXTURE") === "1") {
		return $config["enabled"] === true;
	}
	if (!is_file(CEASAR_SYSTEM_CONFIG)) {
		return false;
	}
	$systemConfig = (string) file_get_contents(CEASAR_SYSTEM_CONFIG);

	return $config["enabled"] === true &&
		preg_match('/^CUSTOMER_MODULE=[\'\"]?yes[\'\"]?\s*$/m', $systemConfig) === 1;
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
		"supabaseUrl" => $config["supabase_url"],
		"supabasePublishableKey" => $config["supabase_publishable_key"],
		"passkeysEnabled" => $config["passkeys_enabled"],
		"passkeyRpId" => $config["passkey_rp_id"],
		"fixture" => $config["fixture"],
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
	if (getenv("CEASAR_CUSTOMER_FIXTURE") === "1") {
		return "http";
	}

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

function customer_require_supabase_url(string $url, bool $fixture): void {
	$parts = parse_url($url);
	$allowedScheme = $fixture ? ["http", "https"] : ["https"];
	if (
		!is_array($parts) ||
		!in_array($parts["scheme"] ?? null, $allowedScheme, true) ||
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

/** @return array<string, mixed> */
function customer_require_customer_url(string $url, string $expectedPath, bool $fixture): array {
	$parts = parse_url($url);
	$allowedSchemes = $fixture ? ["http", "https"] : ["https"];
	if (
		!is_array($parts) ||
		!in_array($parts["scheme"] ?? null, $allowedSchemes, true) ||
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

function customer_require_rp_id(string $rpId, bool $fixture): void {
	$host = strtolower((string) preg_replace('/:\d+$/', "", $_SERVER["HTTP_HOST"] ?? ""));
	if ($fixture && in_array($host, ["localhost", "127.0.0.1"], true)) {
		return;
	}
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
