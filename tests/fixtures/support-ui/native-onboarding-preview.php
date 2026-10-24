<?php
declare(strict_types=1);
if (getenv("CEASAR_SUPPORT_TEST") !== "1") {
	http_response_code(404);
	exit();
}
session_start();
?><!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width,initial-scale=1">
	<meta name="robots" content="noindex,nofollow">
	<meta name="ceasar-csrf" content="fixture-csrf">
	<title>Set up website · Northstar Hosting</title>
	<link rel="stylesheet" href="/css/themes/default.min.css">
	<link rel="stylesheet" href="/css/themes/customer.min.css">
	<style>:root{--branding-accent:#235b75}</style>
	<script type="module" src="/js/dist/onboarding-native.min.js"></script>
</head>
<body class="page-customer" data-ceasar-user="northstar-fixture-tenant" data-ceasar-email="owner@northstar.example">
	<div class="app">
		<header class="customer-header"><div class="customer-header-inner"><a href="/native-onboarding-preview" class="customer-brand">Northstar Hosting</a><a href="/native-onboarding-preview">Hosting controls</a></div></header>
		<main class="customer-main"><section data-onboarding-wizard aria-label="Website setup"></section></main>
	</div>
</body>
</html>
