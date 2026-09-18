<?php

declare(strict_types=1);

/** Installation-wide presentation settings. Assets intentionally live outside web/. */
if (!defined("CEASAR_BRANDING_ASSET_DIR")) {
	define(
		"CEASAR_BRANDING_ASSET_DIR",
		rtrim((string) (getenv("CEASAR_BRANDING_DIR") ?: "/usr/local/ceasar/data/branding"), "/"),
	);
}
if (!defined("CEASAR_BRANDING_CONFIG")) {
	define("CEASAR_BRANDING_CONFIG", CEASAR_BRANDING_ASSET_DIR . "/config.json");
}

/** @return array<string, string> */
function branding_config(): array {
	if (isset($GLOBALS["ceasar_branding_config"]) && is_array($GLOBALS["ceasar_branding_config"])) {
		return $GLOBALS["ceasar_branding_config"];
	}
	$config = branding_defaults();
	if (!is_file(CEASAR_BRANDING_CONFIG)) {
		return $config;
	}
	$stored = json_decode((string) file_get_contents(CEASAR_BRANDING_CONFIG), true);
	if (!is_array($stored)) {
		return $config;
	}
	foreach ($config as $key => $default) {
		if (isset($stored[$key]) && is_string($stored[$key])) {
			$config[$key] = $stored[$key];
		}
	}
	$GLOBALS["ceasar_branding_config"] = $config;
	return $config;
}

function branding_clear_cache(): void {
	unset($GLOBALS["ceasar_branding_config"]);
}

/** @return array<string, string> */
function branding_defaults(): array {
	return [
		"name" => isset($_SESSION["APP_NAME"])
			? trim((string) $_SESSION["APP_NAME"], "'")
			: "Ceasar",
		"accent_color" => "#5b5bd6",
		"legal_url" => "",
		"privacy_url" => "",
		"support_url" => "",
		"sender_name" => isset($_SESSION["FROM_NAME"])
			? trim((string) $_SESSION["FROM_NAME"], "'")
			: "",
		"logo" => "",
		"header_logo" => "",
		"favicon" => "",
	];
}

/** Persist the previous customer brand once, so customer.json is no longer a branding authority. */
function branding_migrate_legacy(): void {
	if (is_file(CEASAR_BRANDING_CONFIG)) {
		return;
	}
	$config = branding_defaults();
	$legacyPath = "/usr/local/ceasar/conf/customer.json";
	$legacy = is_file($legacyPath)
		? json_decode((string) file_get_contents($legacyPath), true)
		: [];
	if (is_array($legacy)) {
		foreach (
			[
				"brand_name" => "name",
				"terms_url" => "legal_url",
				"privacy_url" => "privacy_url",
				"support_url" => "support_url",
			]
			as $legacyKey => $brandingKey
		) {
			if (is_string($legacy[$legacyKey] ?? null) && trim($legacy[$legacyKey]) !== "") {
				$config[$brandingKey] = trim($legacy[$legacyKey]);
			}
		}
	}
	if (
		is_array($legacy) &&
		is_string($legacy["logo_url"] ?? null) &&
		preg_match('#^/images/([A-Za-z0-9._-]+)$#D', $legacy["logo_url"], $match) === 1
	) {
		$root = $_SERVER["CEASAR"] ?? "/usr/local/ceasar";
		$source = $root . "/web/images/" . $match[1];
		if (is_file($source) && filesize($source) <= 2 * 1024 * 1024) {
			$extension = strtolower(pathinfo($source, PATHINFO_EXTENSION));
			if (in_array($extension, ["png", "webp", "svg"], true)) {
				if (!is_dir(CEASAR_BRANDING_ASSET_DIR)) {
					mkdir(CEASAR_BRANDING_ASSET_DIR, 0750, true);
				}
				$target = CEASAR_BRANDING_ASSET_DIR . "/header_logo." . $extension;
				copy($source, $target);
				chmod($target, 0640);
				$config["header_logo"] = basename($target);
			}
		}
	}
	$root = $_SERVER["CEASAR"] ?? "/usr/local/ceasar";
	foreach (
		["logo" => "logo.svg", "header_logo" => "logo-header.svg", "favicon" => "favicon.png"]
		as $kind => $filename
	) {
		$source = $root . "/web/images/custom/" . $filename;
		if (!is_file($source) || filesize($source) > 2 * 1024 * 1024) {
			continue;
		}
		$extension = strtolower(pathinfo($source, PATHINFO_EXTENSION));
		if (!in_array($extension, ["png", "webp", "svg"], true)) {
			continue;
		}
		if (!is_dir(CEASAR_BRANDING_ASSET_DIR)) {
			mkdir(CEASAR_BRANDING_ASSET_DIR, 0750, true);
		}
		$target = CEASAR_BRANDING_ASSET_DIR . "/" . $kind . "." . $extension;
		copy($source, $target);
		chmod($target, 0640);
		$config[$kind] = basename($target);
	}
	branding_save($config);
}

/** @param array<string, string> $updates */
function branding_save(array $updates): array {
	$current = branding_config();
	foreach ($updates as $key => $value) {
		if (array_key_exists($key, $current)) {
			$current[$key] = $value;
		}
	}
	if (!is_dir(CEASAR_BRANDING_ASSET_DIR)) {
		mkdir(CEASAR_BRANDING_ASSET_DIR, 0750, true);
	}
	$temp = tempnam(CEASAR_BRANDING_ASSET_DIR, ".config-");
	if (
		$temp === false ||
		file_put_contents(
			$temp,
			json_encode($current, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n",
		) === false ||
		!rename($temp, CEASAR_BRANDING_CONFIG)
	) {
		if ($temp !== false && is_file($temp)) {
			unlink($temp);
		}
		throw new RuntimeException("Unable to save branding settings.");
	}
	chmod(CEASAR_BRANDING_CONFIG, 0640);
	branding_clear_cache();
	return $current;
}

function branding_asset_url(string $kind): string {
	$config = branding_config();
	if (!in_array($kind, ["logo", "header_logo", "favicon"], true)) {
		throw new InvalidArgumentException("Unknown branding asset.");
	}
	if ($config[$kind] !== "") {
		$url = "/branding/asset.php?kind=" . rawurlencode($kind);
		$asset = CEASAR_BRANDING_ASSET_DIR . "/" . basename($config[$kind]);
		$revision = is_file($asset) ? hash_file("sha256", $asset) : false;
		if (is_string($revision)) {
			return $url . "&v=" . rawurlencode($revision);
		}
		return $url;
	}
	return match ($kind) {
		"favicon" => "/images/favicon.png",
		"header_logo" => "/images/logo-header.svg",
		default => "/images/logo.svg",
	};
}

function branding_name(): string {
	return branding_config()["name"];
}

function branding_accent_style(): string {
	$color = htmlspecialchars(branding_config()["accent_color"], ENT_QUOTES);
	return "--branding-accent: {$color}; --color-text-link: {$color}; --color-text-link-hover: {$color}; --icon-color-purple: {$color}; --icon-color-maroon: {$color}; --icon-color-blue: {$color}; --iharc-blue: {$color}; --iharc-blue-deep: {$color};";
}

function branding_validate_url(string $value): string {
	$value = trim($value);
	if ($value === "") {
		return "";
	}
	$parts = parse_url($value);
	if (
		!is_array($parts) ||
		($parts["scheme"] ?? "") !== "https" ||
		empty($parts["host"]) ||
		isset($parts["user"]) ||
		isset($parts["pass"])
	) {
		throw new InvalidArgumentException("Branding links must be HTTPS URLs.");
	}
	return $value;
}

function branding_validate_color(string $value): string {
	$value = trim($value);
	if (preg_match('/^#[0-9a-fA-F]{6}$/D', $value) !== 1) {
		throw new InvalidArgumentException("Accent color must be a six-digit hex color.");
	}
	return strtolower($value);
}

function branding_store_upload(string $kind, array $upload): string {
	if (
		!in_array($kind, ["logo", "header_logo", "favicon"], true) ||
		($upload["error"] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE
	) {
		return "";
	}
	if (
		($upload["error"] ?? UPLOAD_ERR_OK) !== UPLOAD_ERR_OK ||
		!isset($upload["tmp_name"]) ||
		!is_uploaded_file((string) $upload["tmp_name"])
	) {
		throw new InvalidArgumentException("Unable to upload branding asset.");
	}
	if (($upload["size"] ?? 0) < 1 || $upload["size"] > 2 * 1024 * 1024) {
		throw new InvalidArgumentException("Branding assets must be 2 MB or smaller.");
	}
	$contents = (string) file_get_contents((string) $upload["tmp_name"]);
	$mime = (new finfo(FILEINFO_MIME_TYPE))->buffer($contents);
	$extension = match ($mime) {
		"image/png" => "png",
		"image/webp" => "webp",
		"image/svg+xml", "text/plain" => "svg",
		default => throw new InvalidArgumentException("Use PNG, WebP, or a sanitized SVG image."),
	};
	if ($extension === "svg") {
		$contents = branding_sanitize_svg($contents);
		if ($contents === null) {
			throw new InvalidArgumentException("SVG is not safe to use as a branding asset.");
		}
		if (file_put_contents((string) $upload["tmp_name"], $contents) === false) {
			throw new RuntimeException("Unable to prepare branding asset.");
		}
	}
	if (!is_dir(CEASAR_BRANDING_ASSET_DIR)) {
		mkdir(CEASAR_BRANDING_ASSET_DIR, 0750, true);
	}
	$name = $kind . "." . $extension;
	foreach (glob(CEASAR_BRANDING_ASSET_DIR . "/" . $kind . ".*") ?: [] as $old) {
		unlink($old);
	}
	$target = CEASAR_BRANDING_ASSET_DIR . "/" . $name;
	if (!move_uploaded_file((string) $upload["tmp_name"], $target)) {
		throw new RuntimeException("Unable to save branding asset.");
	}
	chmod($target, 0640);
	return $name;
}

function branding_sanitize_svg(string $svg): ?string {
	if (
		!class_exists("enshrined\\svgSanitize\\Sanitizer") &&
		is_file(__DIR__ . "/vendor/autoload.php")
	) {
		require_once __DIR__ . "/vendor/autoload.php";
	}
	if (
		strlen($svg) > 2 * 1024 * 1024 ||
		preg_match(
			'/^\\s*(?:<\\?xml\\s+version=["\'][^"\']+["\'](?:\\s+encoding=["\'][^"\']+["\'])?\\s*\\?>\\s*)?<svg\\b/i',
			$svg,
		) !== 1 ||
		!class_exists("enshrined\\svgSanitize\\Sanitizer")
	) {
		return null;
	}
	// Give a clear rejection for unsafe references while the maintained
	// sanitizer remains the authority for all SVG parsing and normalization.
	if (
		preg_match(
			'/<(?:script|foreignObject|iframe|object|embed)\\b|\\bon[a-z]+\\s*=|(?:href|xlink:href)\\s*=\\s*["\']\\s*(?:https?:|data:|javascript:)|\\burl\\s*\\(\\s*["\']?\\s*(?:https?:|data:|javascript:)/i',
			$svg,
		) === 1
	) {
		return null;
	}
	$sanitizer = new \enshrined\svgSanitize\Sanitizer();
	$sanitizer->removeRemoteReferences(true);
	$sanitized = $sanitizer->sanitize($svg);
	return is_string($sanitized) && $sanitized !== "" ? $sanitized : null;
}

function branding_safe_svg(string $svg): bool {
	return branding_sanitize_svg($svg) !== null;
}

function branding_reset_asset(string $kind): void {
	foreach (glob(CEASAR_BRANDING_ASSET_DIR . "/" . $kind . ".*") ?: [] as $asset) {
		unlink($asset);
	}
	branding_save([$kind => ""]);
}
