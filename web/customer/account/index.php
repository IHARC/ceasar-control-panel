<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . "/inc/customer.php";
customer_bootstrap();
customer_render("Customer account", "account", [
	"config" => customer_config(),
	"customerPage" => "account",
]);
