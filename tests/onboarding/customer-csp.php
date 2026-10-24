<?php
declare(strict_types=1);
require_once __DIR__ . "/../../web/inc/customer.php";
$sources = customer_form_action_origins();
if (
	!str_contains($sources, "https://*.nodes.example.test:8083") ||
	!str_contains($sources, "https://panel.example.test:8083")
) {
	throw new RuntimeException("Configured grant destinations are missing from customer form CSP.");
}
echo "Customer access CSP fixture passed.\n";
