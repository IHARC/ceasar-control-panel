<?php

declare(strict_types=1);

// This endpoint authenticates its own native session or external bearer identity.
// It must not include main.php because main.php redirects unauthenticated customer
// sessions before a bearer identity can be verified.
require_once dirname(__DIR__, 2) . "/inc/support.php";

$path = trim((string) parse_url($_SERVER["REQUEST_URI"] ?? "", PHP_URL_PATH), "/");
$parts = explode("/", $path);
if (count($parts) >= 4 && $parts[count($parts) - 1] !== "v1") {
	$_GET["action"] ??= end($parts);
}
support_api();
