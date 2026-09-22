<?php

declare(strict_types=1);

$directory = sys_get_temp_dir() . "/ceasar-branding-test-" . bin2hex(random_bytes(6));
putenv("CEASAR_BRANDING_DIR=" . $directory);
require dirname(__DIR__, 2) . "/web/inc/vendor/autoload.php";
require dirname(__DIR__, 2) . "/web/inc/branding.php";

function branding_test_assert(bool $condition, string $message): void {
	if (!$condition) {
		throw new RuntimeException($message);
	}
}

$safe =
	'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" fill="#123456"/></svg>';
$active =
	'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="10" height="10"/></svg>';
$external =
	'<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.test/logo.svg"/></svg>';
branding_test_assert(branding_safe_svg($safe), "Expected safe SVG to be accepted.");
branding_test_assert(!branding_safe_svg($active), "Expected active SVG to be rejected.");
branding_test_assert(
	!branding_safe_svg($external),
	"Expected external SVG reference to be rejected.",
);

$saved = branding_save([
	"name" => "Example Hosting",
	"sender_name" => "Example Support",
	"accent_color" => "#123456",
]);
branding_test_assert($saved["name"] === "Example Hosting", "Brand name was not persisted.");
branding_test_assert(
	branding_config()["sender_name"] === "Example Support",
	"Brand cache was not invalidated after save.",
);
branding_test_assert(
	str_contains(branding_accent_style(), "--icon-color-maroon: #123456"),
	"Brand accent does not override native icon colors.",
);
branding_test_assert(
	str_contains(branding_accent_style(), "--branding-accent: #123456") &&
		!str_contains(branding_accent_style(), "--iharc-blue"),
	"Brand accent does not override customer colors.",
);
$asset = CEASAR_BRANDING_ASSET_DIR . "/header_logo.svg";
file_put_contents($asset, '<svg xmlns="http://www.w3.org/2000/svg"/>');
branding_save(["header_logo" => "header_logo.svg"]);
$firstAssetUrl = branding_asset_url("header_logo");
file_put_contents(
	$asset,
	'<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>',
);
$secondAssetUrl = branding_asset_url("header_logo");
branding_test_assert(
	$firstAssetUrl !== $secondAssetUrl && str_contains($secondAssetUrl, "&v="),
	"Replacing a branding asset must change its cacheable URL.",
);
branding_reset_asset("header_logo");
branding_test_assert(
	branding_config()["header_logo"] === "",
	"Asset reset did not invalidate the cached configuration.",
);

@unlink(CEASAR_BRANDING_CONFIG);
@rmdir(CEASAR_BRANDING_ASSET_DIR);
echo "branding tests passed\n";
