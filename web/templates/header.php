<!doctype html>
<html class="no-js" lang="<?= $_SESSION["LANGUAGE"] ?>">

<head>
<?php
require $_SERVER["CEASAR"] . "/web/templates/includes/title.php";
require $_SERVER["CEASAR"] . "/web/templates/includes/css.php";
require $_SERVER["CEASAR"] . "/web/templates/includes/js.php";
?>
</head>

<body class="page-<?= strtolower($TAB) ?> lang-<?= $_SESSION["language"] ?>" style="<?= branding_accent_style() ?>">
	<div class="app">
