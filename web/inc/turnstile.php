<?php
declare(strict_types=1);

const CEASAR_TURNSTILE_CONFIG = "/usr/local/ceasar/conf/turnstile.json";

function native_turnstile_config(): array {
	static $config = null;
	if ($config !== null) {
		return $config;
	}
	$path = CEASAR_TURNSTILE_CONFIG;
	if (!is_file($path)) {
		return $config = [
			"enabled" => false,
			"site_key" => "",
			"secret_key" => "",
			"hostname" => "",
		];
	}
	$data = json_decode((string) file_get_contents($path), true, 8, JSON_THROW_ON_ERROR);
	if (!is_array($data)) {
		throw new RuntimeException("Turnstile configuration is invalid.");
	}
	$enabled = ($data["enabled"] ?? false) === true;
	$site = $data["site_key"] ?? "";
	$secret = $data["secret_key"] ?? "";
	$host = $data["hostname"] ?? "";
	if (
		!is_string($site) ||
		!is_string($secret) ||
		!is_string($host) ||
		($enabled && ($site === "" || $secret === "" || $host === ""))
	) {
		throw new RuntimeException("Turnstile configuration is incomplete.");
	}
	return $config = [
		"enabled" => $enabled,
		"site_key" => $site,
		"secret_key" => $secret,
		"hostname" => strtolower($host),
	];
}

function native_turnstile_verify(string $token, string $action): bool {
	$config = native_turnstile_config();
	if (!$config["enabled"]) {
		return true;
	}
	if (
		$token === "" ||
		strlen($token) > 2048 ||
		!in_array($action, ["native_login", "native_recovery"], true)
	) {
		return false;
	}
	$body = http_build_query([
		"secret" => $config["secret_key"],
		"response" => $token,
		"remoteip" => $_SERVER["REMOTE_ADDR"] ?? "",
	]);
	$context = stream_context_create([
		"http" => [
			"method" => "POST",
			"header" => "Content-Type: application/x-www-form-urlencoded",
			"content" => $body,
			"timeout" => 6,
			"ignore_errors" => true,
		],
	]);
	$raw = @file_get_contents(
		"https://challenges.cloudflare.com/turnstile/v0/siteverify",
		false,
		$context,
	);
	if (!is_string($raw)) {
		return false;
	}
	$response = json_decode($raw, true, 8);
	return is_array($response) &&
		($response["success"] ?? false) === true &&
		strtolower((string) ($response["hostname"] ?? "")) === $config["hostname"] &&
		($response["action"] ?? "") === $action;
}

function native_turnstile_widget(string $action): void {
	$config = native_turnstile_config();
	if (!$config["enabled"]) {
		return;
	}
	echo '<div class="cf-turnstile" data-sitekey="' .
		htmlspecialchars($config["site_key"], ENT_QUOTES) .
		'" data-action="' .
		htmlspecialchars($action, ENT_QUOTES) .
		'"></div>';
	echo '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>';
}

function native_turnstile_headers(): void {
	if (!native_turnstile_config()["enabled"]) {
		return;
	}
	header(
		"Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; form-action 'self'",
	);
}
