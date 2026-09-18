<?php

declare(strict_types=1);

/** Local-only rendering of the exact queued-notification email template. */
if (getenv("CEASAR_SUPPORT_TEST") !== "1") {
	http_response_code(404);
	exit();
}
putenv("CEASAR_SUPPORT_CONFIG=" . sys_get_temp_dir() . "/ceasar-ui/support.json");
putenv("CEASAR_BRANDING_DIR=" . sys_get_temp_dir() . "/ceasar-branding-preview");
require dirname(__DIR__, 3) . "/web/inc/support.php";
$ticket = support_db()
	->query("SELECT id, subject FROM support_tickets ORDER BY created_at ASC LIMIT 1")
	->fetch() ?: [
	"id" => "0123456789abcdef0123456789abcdef",
	"subject" => "Site not updating after publishing",
];
echo support_render_email(
	array_replace(support_config(), [
		"support_url" => "http://127.0.0.1:8088/customer-preview#support",
		"admin_support_url" => "http://127.0.0.1:8088/",
	]),
	$ticket,
	"customer",
	"Support replied to your ticket.",
	"I can help with that. Which URL is showing the previous version?",
);
