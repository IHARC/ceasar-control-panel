<!doctype html>
<html class="no-js" lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<meta name="robots" content="noindex,nofollow">
	<title><?= htmlspecialchars($title, ENT_QUOTES) ?> · <?= htmlspecialchars((string) $config['brand_name'], ENT_QUOTES) ?></title>
	<link rel="icon" href="/images/logo.svg" type="image/svg+xml">
	<link rel="stylesheet" href="/css/themes/default.min.css">
	<link rel="stylesheet" href="/css/customer.min.css">
	<script type="module" defer src="/js/dist/customer.min.js"></script>
</head>
<body class="customer-page" data-customer-page="<?= htmlspecialchars((string) ($customerPage ?? ''), ENT_QUOTES) ?>">
	<header class="customer-header">
		<a class="customer-brand" href="/customer/account/">
			<img src="/images/logo.svg" width="34" height="42" alt="">
			<span><?= htmlspecialchars((string) $config['brand_name'], ENT_QUOTES) ?></span>
		</a>
		<button class="button button-secondary" type="button" data-customer-sign-out hidden>Sign out</button>
	</header>
	<main class="customer-main">
		<script id="customer-config" type="application/json"><?= customer_config_json($config) ?></script>
