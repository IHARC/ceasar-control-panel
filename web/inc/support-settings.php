<?php

declare(strict_types=1);

/** Installation-local support routing settings. Branding and SMTP sender remain separate authorities. */
function support_effective_config(PDO $db): array {
	$config = support_config();
	$rows = $db->query("SELECT key,value FROM support_settings")->fetchAll(PDO::FETCH_KEY_PAIR);
	foreach ($rows as $key => $value) {
		$decoded = json_decode((string) $value, true);
		if ($key === "imap" && is_array($decoded)) {
			$config["imap"] = array_replace_recursive((array) ($config["imap"] ?? []), $decoded);
		} elseif (json_last_error() === JSON_ERROR_NONE) {
			$config[$key] = $decoded;
		}
	}
	return $config;
}
function support_settings_text(mixed $value, string $label, int $maximum): string {
	if (!is_string($value)) {
		throw new InvalidArgumentException("$label must be text.");
	}
	$value = trim($value);
	if (strlen($value) > $maximum || preg_match('/[\x00-\x1F\x7F]/', $value)) {
		throw new InvalidArgumentException("$label is invalid.");
	}
	return $value;
}
function support_settings_url(mixed $value, string $label): string {
	$value = support_settings_text($value, $label, 2000);
	if ($value === "") {
		return "";
	}
	$parts = parse_url($value);
	if (
		!is_array($parts) ||
		!isset($parts["scheme"], $parts["host"]) ||
		isset($parts["user"], $parts["pass"]) ||
		!in_array(strtolower((string) $parts["scheme"]), ["https", "http"], true)
	) {
		throw new InvalidArgumentException("$label must be an HTTPS URL or a local HTTP URL.");
	}
	$host = strtolower((string) $parts["host"]);
	$local = in_array($host, ["localhost", "127.0.0.1", "::1"], true);
	if (strtolower((string) $parts["scheme"]) !== "https" && !$local) {
		throw new InvalidArgumentException("$label must use HTTPS outside localhost.");
	}
	return $value;
}
function support_normalize_imap(array $imap): array {
	$allowed = [
		"host",
		"port",
		"encryption",
		"username",
		"password",
		"authentication",
		"folder",
		"oauth",
	];
	if (array_diff(array_keys($imap), $allowed)) {
		throw new InvalidArgumentException("Unsupported IMAP setting.");
	}
	$out = [];
	foreach ($imap as $key => $value) {
		if ($key === "host") {
			$value = support_settings_text($value, "IMAP host", 253);
			if (
				$value !== "" &&
				!filter_var($value, FILTER_VALIDATE_IP) &&
				!filter_var($value, FILTER_VALIDATE_DOMAIN, FILTER_FLAG_HOSTNAME)
			) {
				throw new InvalidArgumentException(
					"IMAP host must be a valid hostname or IP address.",
				);
			}
		} elseif ($key === "port") {
			$value = support_settings_text((string) $value, "IMAP port", 5);
			if (
				$value !== "" &&
				(!ctype_digit($value) || (int) $value < 1 || (int) $value > 65535)
			) {
				throw new InvalidArgumentException("IMAP port must be between 1 and 65535.");
			}
			$value = $value === "" ? "" : (int) $value;
		} elseif ($key === "encryption") {
			$value = support_settings_text($value, "IMAP encryption", 8);
			if (!in_array($value, ["", "ssl", "tls", "none"], true)) {
				throw new InvalidArgumentException("IMAP encryption is invalid.");
			}
		} elseif ($key === "authentication") {
			$value = support_settings_text($value, "IMAP authentication", 16);
			if (!in_array($value, ["basic", "oauth2"], true)) {
				throw new InvalidArgumentException("IMAP authentication is invalid.");
			}
		} elseif ($key === "oauth") {
			if (
				!is_array($value) ||
				array_diff(array_keys($value), [
					"tenant",
					"client_id",
					"client_secret",
					"refresh_token",
					"scope",
					"grant_type",
				])
			) {
				throw new InvalidArgumentException("OAuth settings are invalid.");
			}
			foreach ($value as $oauthKey => $oauthValue) {
				$oauthValue = support_settings_text($oauthValue, "OAuth setting", 2048);
				if (
					$oauthKey === "grant_type" &&
					!in_array($oauthValue, ["client_credentials", "refresh_token"], true)
				) {
					throw new InvalidArgumentException("OAuth grant type is invalid.");
				}
				$value[$oauthKey] = $oauthValue;
			}
		} else {
			$value = support_settings_text($value, "IMAP setting", $key === "folder" ? 255 : 2048);
		}
		$out[$key] = $value;
	}
	return $out;
}
function support_save_settings(PDO $db, array $settings): void {
	if (
		array_diff(array_keys($settings), [
			"staff_recipients",
			"inbound_address",
			"support_url",
			"admin_support_url",
			"imap",
		])
	) {
		throw new InvalidArgumentException("Unsupported support setting.");
	}
	if (array_key_exists("staff_recipients", $settings)) {
		if (!is_array($settings["staff_recipients"])) {
			throw new InvalidArgumentException("Support recipients must be an email list.");
		}
		$recipients = array_values(
			array_unique(
				array_filter(
					array_map(
						fn($email) => strtolower(trim((string) $email)),
						$settings["staff_recipients"],
					),
					fn($email) => filter_var($email, FILTER_VALIDATE_EMAIL),
				),
			),
		);
		if (!$recipients || count($recipients) > 100) {
			throw new InvalidArgumentException(
				"Enter one or more valid staff recipient email addresses.",
			);
		}
		$db->prepare(
			"INSERT INTO support_settings(key,value) VALUES('staff_recipients',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
		)->execute([json_encode($recipients)]);
	}
	if (array_key_exists("inbound_address", $settings)) {
		$email = support_settings_text($settings["inbound_address"], "Inbound reply address", 254);
		if ($email !== "" && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
			throw new InvalidArgumentException(
				"Inbound reply address must be a valid email address.",
			);
		}
		$db->prepare(
			"INSERT INTO support_settings(key,value) VALUES('inbound_address',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
		)->execute([json_encode($email)]);
	}
	foreach (
		["support_url" => "Customer ticket URL", "admin_support_url" => "Staff ticket URL"]
		as $key => $label
	) {
		if (!array_key_exists($key, $settings)) {
			continue;
		}
		$url = support_settings_url($settings[$key], $label);
		$db->prepare(
			"INSERT INTO support_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
		)->execute([$key, json_encode($url)]);
	}
	if (array_key_exists("imap", $settings)) {
		if (!is_array($settings["imap"])) {
			throw new InvalidArgumentException("IMAP settings must be an object.");
		}
		$next = support_normalize_imap($settings["imap"]);
		$current = (array) (support_effective_config($db)["imap"] ?? []);
		foreach (["password"] as $secret) {
			if (($next[$secret] ?? null) === "") {
				unset($next[$secret]);
			}
		}
		foreach (["client_secret", "refresh_token"] as $secret) {
			if (($next["oauth"][$secret] ?? null) === "") {
				unset($next["oauth"][$secret]);
			}
		}
		$next = array_replace_recursive($current, $next);
		$db->prepare(
			"INSERT INTO support_settings(key,value) VALUES('imap',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
		)->execute([json_encode($next, JSON_UNESCAPED_SLASHES)]);
	}
}
function support_settings_public(PDO $db, array $config): array {
	$effective = support_effective_config($db);
	$imap = (array) ($effective["imap"] ?? []);
	$oauth = (array) ($imap["oauth"] ?? []);
	unset(
		$imap["password"],
		$oauth["client_secret"],
		$oauth["refresh_token"],
		$oauth["access_token"],
	);
	$imap["oauth"] = $oauth;
	return [
		"staffRecipients" => array_values((array) ($effective["staff_recipients"] ?? [])),
		"inboundAddress" => (string) ($effective["inbound_address"] ?? ""),
		"supportUrl" => (string) ($effective["support_url"] ?? ""),
		"adminSupportUrl" => (string) ($effective["admin_support_url"] ?? ""),
		"imap" => $imap,
	];
}
