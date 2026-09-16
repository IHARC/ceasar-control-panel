<?php

declare(strict_types=1);

$path = parse_url($_SERVER["REQUEST_URI"] ?? "/", PHP_URL_PATH);
$method = $_SERVER["REQUEST_METHOD"] ?? "GET";
$documentRoot = dirname(__DIR__, 3) . "/web";

if (is_string($path)) {
	$static = realpath($documentRoot . $path);
	if (
		$static !== false &&
		is_file($static) &&
		str_starts_with($static, realpath($documentRoot))
	) {
		return false;
	}
}

header("Access-Control-Allow-Origin: http://127.0.0.1:18081");
header("Access-Control-Allow-Headers: authorization, apikey, content-type, x-client-info");
header("Access-Control-Allow-Methods: GET, POST, PATCH, OPTIONS");
if ($method === "OPTIONS") {
	http_response_code(204);
	exit();
}

if (str_starts_with((string) $path, "/auth/v1/")) {
	fixture_auth($method, (string) $path);
}
if (str_starts_with((string) $path, "/api/iharc/v1/customer/")) {
	fixture_customer_api($method, (string) $path);
}

$route = match ($path) {
	"/customer/login", "/customer/login/" => $documentRoot . "/customer/login/index.php",
	"/customer/account", "/customer/account/" => $documentRoot . "/customer/account/index.php",
	"/auth/callback", "/auth/callback/" => $documentRoot . "/auth/callback/index.php",
	default => null,
};
if ($route !== null) {
	$_SERVER["DOCUMENT_ROOT"] = $documentRoot;
	require $route;
	exit();
}

http_response_code(404);
echo "Not found";
exit();

function fixture_auth(string $method, string $path): never {
	if ($method === "POST" && $path === "/auth/v1/token") {
		fixture_json(fixture_session());
	}
	if ($method === "POST" && $path === "/auth/v1/signup") {
		fixture_json(fixture_user());
	}
	if ($method === "POST" && in_array($path, ["/auth/v1/recover", "/auth/v1/logout"], true)) {
		fixture_json([]);
	}
	if ($method === "GET" && $path === "/auth/v1/user") {
		fixture_json(fixture_user());
	}
	if ($method === "GET" && $path === "/auth/v1/factors") {
		fixture_json(["all" => [], "totp" => [], "phone" => []]);
	}
	http_response_code(404);
	fixture_json(["message" => "Fixture auth route not implemented."]);
}

function fixture_customer_api(string $method, string $path): never {
	$authorization = $_SERVER["HTTP_AUTHORIZATION"] ?? "";
	if (!str_starts_with($authorization, "Bearer ")) {
		http_response_code(401);
		fixture_json(["error" => "unauthorized"]);
	}
	if ($method === "GET" && $path === "/api/iharc/v1/customer/session") {
		fixture_json([
			"profile" => ["displayName" => "Preview customer"],
			"accounts" => [
				[
					"id" => "account-preview",
					"displayName" => "Preview account",
					"status" => "active",
				],
			],
			"services" => [
				[
					"id" => "svc_preview",
					"name" => "Managed WordPress",
					"status" => "ready",
					"domain" => "preview.example",
				],
			],
			"offerings" => [
				[
					"id" => "offer_starter",
					"name" => "Starter hosting",
					"summary" => "A native Ceasar service with managed onboarding.",
				],
			],
			"supportCases" => [
				[
					"id" => "case_preview",
					"subject" => "Welcome to the preview",
					"status" => "open",
					"updated_at" => "2026-09-15",
				],
			],
		]);
	}
	if (in_array($method, ["POST", "PATCH"], true)) {
		fixture_json(["ok" => true]);
	}
	http_response_code(404);
	fixture_json(["error" => "Fixture customer route not implemented."]);
}

/** @return array<string, mixed> */
function fixture_session(): array {
	return [
		"access_token" => fixture_jwt(),
		"token_type" => "bearer",
		"expires_in" => 3600,
		"expires_at" => time() + 3600,
		"refresh_token" => "fixture-refresh-token",
		"user" => fixture_user(),
	];
}

/** @return array<string, mixed> */
function fixture_user(): array {
	return [
		"id" => "00000000-0000-4000-8000-000000000001",
		"aud" => "authenticated",
		"role" => "authenticated",
		"email" => "customer@example.com",
		"email_confirmed_at" => "2026-09-15T00:00:00Z",
		"app_metadata" => ["provider" => "email", "providers" => ["email"]],
		"user_metadata" => ["display_name" => "Preview customer"],
		"identities" => [],
		"created_at" => "2026-09-15T00:00:00Z",
		"updated_at" => "2026-09-15T00:00:00Z",
	];
}

function fixture_jwt(): string {
	$header = fixture_base64url(
		json_encode(["alg" => "none", "typ" => "JWT"], JSON_THROW_ON_ERROR),
	);
	$payload = fixture_base64url(
		json_encode(
			[
				"sub" => "00000000-0000-4000-8000-000000000001",
				"aud" => "authenticated",
				"role" => "authenticated",
				"email" => "customer@example.com",
				"aal" => "aal2",
				"session_id" => "00000000-0000-4000-8000-000000000002",
				"iat" => time(),
				"exp" => time() + 3600,
			],
			JSON_THROW_ON_ERROR,
		),
	);

	return $header . "." . $payload . ".fixture";
}

function fixture_base64url(string $value): string {
	return rtrim(strtr(base64_encode($value), "+/", "-_"), "=");
}

/** @param array<string, mixed> $data */
function fixture_json(array $data): never {
	header("Content-Type: application/json; charset=utf-8");
	echo json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
	exit();
}
