<?php
if (getenv("CEASAR_SUPPORT_TEST") !== "1") {
	exit(1);
}
$dir = "/tmp/ceasar-ui";
if (!is_dir($dir)) {
	mkdir($dir, 0700, true);
}
file_put_contents(
	$dir . "/support.json",
	json_encode([
		"database" => $dir . "/support.sqlite3",
		"attachments" => $dir . "/attachments",
		"staff_recipients" => ["staff@example.test"],
		"inbound_address" => "support@example.test",
		"from_email" => "support@example.test",
	]),
);
require dirname(__DIR__, 3) . "/web/inc/support.php";
$db = support_db();
if ((int) $db->query("SELECT count(*) FROM support_tickets")->fetchColumn() > 0) {
	exit();
}
$c = [
	"userId" => "customer-1",
	"email" => "customer@example.test",
	"displayName" => "Alex Morgan",
	"role" => "customer",
	"accounts" => [["accountId" => "account-1", "displayName" => "Example Studio"]],
];
$s = [
	"userId" => "staff-1",
	"email" => "staff@example.test",
	"displayName" => "Jordan Stevenson",
	"role" => "staff",
	"accounts" => [],
];
$t = support_dispatch($db, $c, "create", [
	"accountId" => "account-1",
	"subject" => "Site not updating after publishing",
	"body" =>
		"I published the new homepage this morning, but visitors still see the previous version. Could you check the cache for me?",
]);
support_dispatch($db, $s, "reply", [
	"id" => $t["id"],
	"body" => "I can help with that. Which URL is showing the previous version?",
]);
support_dispatch($db, $s, "note", [
	"id" => $t["id"],
	"body" => "Check the reverse proxy cache after confirming the affected URL.",
]);
support_dispatch($db, $c, "reply", [
	"id" => $t["id"],
	"body" => "It is the homepage at example.test. The editor preview looks correct.",
]);
for ($i = 1; $i <= 28; $i++) {
	support_dispatch($db, $c, "create", [
		"accountId" => "account-1",
		"subject" => "Example request " . $i,
		"body" => "An earlier support conversation.",
	]);
}
support_dispatch($db, $s, "priority", ["id" => $t["id"], "priority" => "high"]);
echo "Fixture seeded";
