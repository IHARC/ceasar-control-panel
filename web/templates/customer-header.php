<!doctype html>
<html class="no-js" lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<meta name="robots" content="noindex,nofollow">
	<title><?= htmlspecialchars($title, ENT_QUOTES) ?> · <?= htmlspecialchars((string) $config['brand_name'], ENT_QUOTES) ?></title>
	<link rel="icon" href="/images/logo.svg" type="image/svg+xml">
	<link rel="stylesheet" href="/css/themes/default.min.css">
	<script type="module" defer src="/js/dist/customer.min.js"></script>
</head>
<?php $customerIsAccount = ($customerPage ?? '') === 'account'; ?>
<body class="<?= $customerIsAccount ? 'page-customer' : 'page-login' ?>" data-customer-page="<?= htmlspecialchars((string) ($customerPage ?? ''), ENT_QUOTES) ?>">
	<div class="app">
		<?php if ($customerIsAccount) { ?>
		<header class="app-header">
			<div class="top-bar">
				<div class="container top-bar-inner">
					<div class="top-bar-left">
						<a href="/customer/account/" class="top-bar-logo" title="<?= htmlspecialchars((string) $config['brand_name'], ENT_QUOTES) ?>">
							<img src="/images/logo-header.svg" alt="<?= htmlspecialchars((string) $config['brand_name'], ENT_QUOTES) ?>" width="75" height="32">
						</a>
					</div>
					<div class="top-bar-right">
						<button class="top-bar-menu-link top-bar-menu-link-logout u-hidden" type="button" data-customer-sign-out>
							<i class="fas fa-right-from-bracket"></i>
							<span class="top-bar-menu-link-label">Sign out</span>
						</button>
					</div>
				</div>
			</div>
			<nav class="main-menu" aria-label="Customer account">
				<div class="container">
					<ul class="main-menu-list">
						<li class="main-menu-item"><a class="main-menu-item-link active" href="#services"><p class="main-menu-item-label">Services<i class="fas fa-server"></i></p></a></li>
						<li class="main-menu-item"><a class="main-menu-item-link" href="#profile"><p class="main-menu-item-label">Profile<i class="fas fa-user"></i></p></a></li>
						<li class="main-menu-item"><a class="main-menu-item-link" href="#security"><p class="main-menu-item-label">Security<i class="fas fa-shield-halved"></i></p></a></li>
						<li class="main-menu-item"><a class="main-menu-item-link" href="#support"><p class="main-menu-item-label">Support<i class="fas fa-life-ring"></i></p></a></li>
					</ul>
				</div>
			</nav>
		</header>
		<?php } ?>
		<main>
			<script id="customer-config" type="application/json"><?= customer_config_json($config) ?></script>
