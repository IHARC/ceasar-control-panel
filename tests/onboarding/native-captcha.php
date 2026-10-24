<?php
declare(strict_types=1);

require __DIR__ . "/../../web/inc/turnstile.php";

function check(bool $value, string $message): void {
	if (!$value) {
		throw new RuntimeException($message);
	}
}

$settings = ["enabled" => true, "site_key" => "fixture-site", "secret_key" => "fixture-secret"];
$config = native_turnstile_settings(
	$settings + ["hostnames" => ["panel.example.test", "APP.example.test"]],
);
foreach (["panel.example.test", "app.example.test"] as $hostname) {
	check(
		native_turnstile_response_valid(
			["success" => true, "hostname" => $hostname, "action" => "native_login"],
			$config,
			"native_login",
		),
		"Configured direct and proxy hostnames must work.",
	);
}
$response = ["success" => true, "hostname" => "attacker.example.test", "action" => "native_login"];
check(
	!native_turnstile_response_valid($response, $config, "native_login"),
	"An unconfigured hostname must fail.",
);
$response["hostname"] = "app.example.test";
check(
	!native_turnstile_response_valid($response, $config, "native_recovery"),
	"A login token must not authorize recovery.",
);
$response["success"] = false;
check(
	!native_turnstile_response_valid($response, $config, "native_login"),
	"An invalid, expired or replayed provider response must fail.",
);
check(
	native_turnstile_settings($settings + ["hostname" => "panel.example.test"])["hostnames"] === [
		"panel.example.test",
	],
	"Existing single-host configuration remains supported.",
);
check(
	native_turnstile_settings(["enabled" => false, "hostname" => ""])["hostnames"] === [],
	"Disabled empty configuration remains supported.",
);
foreach (
	[
		[],
		["*.example.test"],
		["example.test:8083"],
		["https://example.test"],
		["a..example.test"],
		["a.-example.test"],
	]
	as $hosts
) {
	$rejected = false;
	try {
		native_turnstile_settings($settings + ["hostnames" => $hosts]);
	} catch (RuntimeException) {
		$rejected = true;
	}
	check($rejected, "Enabled CAPTCHA requires explicit valid hostnames.");
}
echo "Native CAPTCHA hostname and action fixture passed.\n";
