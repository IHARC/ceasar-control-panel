<!doctype html>
<html class="no-js" lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<meta name="robots" content="noindex,nofollow">
	<title><?= htmlspecialchars($title, ENT_QUOTES) ?> · <?= htmlspecialchars((string) $config['brand_name'], ENT_QUOTES) ?></title>
	<link rel="icon" href="<?= htmlspecialchars(branding_asset_url('favicon'), ENT_QUOTES) ?>">
	<link rel="stylesheet" href="/css/themes/default.min.css">
	<link rel="stylesheet" href="/css/themes/customer.min.css">
	<style nonce="<?= htmlspecialchars((string) ($customer_style_nonce ?? ''), ENT_QUOTES) ?>">:root { <?= branding_accent_style() ?> }</style>
	<script type="module" defer src="/js/dist/customer.min.js"></script>
</head>
<?php
$customerIsAccount = ($customerPage ?? '') === 'account';
$customerLogo = is_string($config['logo_url'] ?? null) ? $config['logo_url'] : '/images/logo-header.svg';
?>
<body class="<?= $customerIsAccount ? 'page-customer' : 'page-login' ?>" data-customer-page="<?= htmlspecialchars((string) ($customerPage ?? ''), ENT_QUOTES) ?>">
	<div class="app">
		<?php if ($customerIsAccount) { ?>
		<header class="customer-header">
			<div class="customer-header-inner">
				<a href="#hosting" class="customer-brand" title="<?= htmlspecialchars((string) $config['brand_name'], ENT_QUOTES) ?>">
					<img src="<?= htmlspecialchars($customerLogo, ENT_QUOTES) ?>" alt="<?= htmlspecialchars((string) $config['brand_name'], ENT_QUOTES) ?>">
				</a>
				<div class="customer-account-actions">
					<span class="customer-email" data-customer-email>Loading…</span>
					<button class="customer-sign-out u-hidden" type="button" data-customer-sign-out>Sign out</button>
				</div>
			</div>
			<nav class="customer-nav" aria-label="Customer account">
				<div class="customer-header-inner">
					<ul class="customer-nav-list">
						<li><a class="customer-nav-link" href="#hosting" data-customer-view-link="hosting">Hosting</a></li>
						<li><a class="customer-nav-link" href="#billing" data-customer-view-link="billing">Billing</a></li>
						<li><a class="customer-nav-link" href="#support" data-customer-view-link="support">Support</a></li>
						<li><a class="customer-nav-link" href="#profile" data-customer-view-link="profile">Profile</a></li>
						<li><a class="customer-nav-link" href="#security" data-customer-view-link="security">Security</a></li>
					</ul>
				</div>
			</nav>
		</header>
		<?php } ?>
		<main class="<?= $customerIsAccount ? 'customer-main' : 'customer-auth-main' ?>">
			<script id="customer-config" type="application/json"><?= customer_config_json($config) ?></script>
