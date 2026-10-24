<?php
declare(strict_types=1);
require_once $_SERVER["DOCUMENT_ROOT"] . "/inc/main.php";
if (empty($_SESSION["user"]) || !empty($_SESSION["look"])) {
	http_response_code(403);
	exit();
}
$ceasarUser = (string) $_SESSION["user"];
$ceasarEmail = (string) ($user_data["CONTACT"] ?? "");
header("Cache-Control: no-store");
header(
	"Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
);
?>
<!doctype html>
<html lang="<?= htmlspecialchars((string) ($_SESSION["language"] ?? "en"), ENT_QUOTES) ?>">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <meta name="ceasar-csrf" content="<?= htmlspecialchars(
  	(string) $_SESSION["token"],
  	ENT_QUOTES,
  ) ?>">
  <title>Set up website · <?= htmlspecialchars(branding_name(), ENT_QUOTES) ?></title>
  <link rel="stylesheet" href="/css/themes/default.min.css">
  <link rel="stylesheet" href="/css/themes/customer.min.css">
  <link rel="icon" href="<?= htmlspecialchars(branding_asset_url("favicon"), ENT_QUOTES) ?>">
  <style>:root { <?= branding_accent_style() ?> }</style>
  <script type="module" src="/js/dist/onboarding-native.min.js"></script>
</head>
<body class="page-customer" data-ceasar-user="<?= htmlspecialchars(
	$ceasarUser,
	ENT_QUOTES,
) ?>" data-ceasar-email="<?= htmlspecialchars($ceasarEmail, ENT_QUOTES) ?>">
  <div class="app">
    <header class="customer-header"><div class="customer-header-inner"><a href="/list/web/" class="customer-brand"><?= htmlspecialchars(
    	branding_name(),
    	ENT_QUOTES,
    ) ?></a><a href="/list/web/">Hosting controls</a></div></header>
    <main class="customer-main"><section data-onboarding-wizard aria-label="Website setup"></section></main>
  </div>
</body>
</html>
