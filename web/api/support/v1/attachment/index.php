<?php

declare(strict_types=1);

if (($_SERVER["REQUEST_METHOD"] ?? "GET") === "POST") {
	$_GET["action"] = "attachment";
	require_once dirname(__DIR__, 2) . "/index.php";
	exit();
}
require_once dirname(__DIR__, 3) . "/attachment.php";
