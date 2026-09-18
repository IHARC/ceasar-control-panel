<?php

declare(strict_types=1);
require "/usr/local/ceasar/web/inc/support.php";

function backup_fixture_assert(bool $condition, string $message): void {
	if (!$condition) {
		throw new RuntimeException($message);
	}
}
function backup_fixture_command(string $command): string {
	$output = [];
	exec($command, $output, $status);
	if ($status !== 0) {
		throw new RuntimeException("Command failed: $command\n" . implode("\n", $output));
	}
	return implode("\n", $output);
}

$root = "/tmp/ceasar-support-backup-fixture";
$archive = $root . "/support.tar";
$export = $root . "/support.json";
@mkdir($root, 0700, true);
file_put_contents(
	"/usr/local/ceasar/conf/support.json",
	json_encode(
		[
			"database" => "/var/lib/ceasar/support/support.sqlite3",
			"attachments" => "/var/lib/ceasar/support/attachments",
			"staff_recipients" => ["staff@example.test"],
		],
		JSON_PRETTY_PRINT,
	),
);
@mkdir("/usr/local/ceasar/data/branding", 0750, true);
file_put_contents(
	"/usr/local/ceasar/data/branding/config.json",
	json_encode(["name" => "Fixture Hosting", "accent_color" => "#112233"]),
);
file_put_contents(
	"/usr/local/ceasar/data/branding/header_logo.svg",
	"<svg xmlns=\"http://www.w3.org/2000/svg\"/>",
);
$db = support_db();
$now = "2026-09-18T00:00:00Z";
$db->prepare("INSERT INTO support_tickets VALUES(?,?,?,?,?,?,?,?,?)")->execute([
	"ticket-1",
	"account-1",
	"Fixture ticket",
	"waiting_customer",
	"high",
	"staff-1",
	$now,
	$now,
	"customer-1",
]);
foreach (
	[
		["customer-1", "customer@example.test", "Customer", "customer"],
		["staff-1", "staff@example.test", "Staff", "staff"],
	]
	as $participant
) {
	$db->prepare("INSERT INTO support_participants VALUES(?,?,?,?,?)")->execute([
		"ticket-1",
		...$participant,
	]);
}
foreach (
	[
		[
			"message-public",
			"customer-1",
			"customer@example.test",
			"Customer",
			"customer",
			"public",
			"Public fixture message",
		],
		[
			"message-private",
			"staff-1",
			"staff@example.test",
			"Staff",
			"staff",
			"internal",
			"Private fixture note",
		],
	]
	as $message
) {
	$db->prepare("INSERT INTO support_messages VALUES(?,?,?,?,?,?,?,?,?,?)")->execute([
		$message[0],
		"ticket-1",
		...array_slice($message, 1),
		$now,
		null,
	]);
}
@mkdir("/var/lib/ceasar/support/attachments", 0700, true);
file_put_contents(
	"/var/lib/ceasar/support/attachments/attachment-fixture.bin",
	"fixture attachment bytes",
);
$db->prepare("INSERT INTO support_attachments VALUES(?,?,?,?,?,?,?,?)")->execute([
	"attachment-1",
	"ticket-1",
	"message-public",
	"fixture.txt",
	"text/plain",
	24,
	"attachment-fixture.bin",
	$now,
]);
foreach (["queued", "uncertain"] as $state) {
	$db->prepare(
		"INSERT INTO support_outbox(id,ticket_id,event_key,recipient,subject,body,reply_to,state,attempts,next_attempt_at,last_error,accepted_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
	)->execute([
		"outbox-" . $state,
		"ticket-1",
		"event-" . $state,
		"staff@example.test",
		"Fixture",
		"Fixture body",
		"",
		$state,
		1,
		$now,
		$state === "uncertain" ? "transport outcome unknown" : null,
		null,
		$now,
		$now,
	]);
}

$before = json_decode(
	backup_fixture_command("/usr/local/ceasar/bin/v-support-export"),
	true,
	512,
	JSON_THROW_ON_ERROR,
);
backup_fixture_command("/usr/local/ceasar/bin/v-support-backup " . escapeshellarg($archive));
$db->exec("DELETE FROM support_tickets");
file_put_contents(
	"/usr/local/ceasar/data/branding/config.json",
	json_encode(["name" => "Changed"]),
);
file_put_contents("/var/lib/ceasar/support/attachments/attachment-fixture.bin", "changed");
backup_fixture_command("/usr/local/ceasar/bin/v-support-restore " . escapeshellarg($archive));
$after = json_decode(
	backup_fixture_command("/usr/local/ceasar/bin/v-support-export"),
	true,
	512,
	JSON_THROW_ON_ERROR,
);
foreach (
	["support_tickets", "support_messages", "support_attachments", "support_outbox"]
	as $table
) {
	backup_fixture_assert(
		$after["tables"][$table] === $before["tables"][$table],
		"Restore changed $table or created notification work.",
	);
}
backup_fixture_assert(
	file_get_contents("/var/lib/ceasar/support/attachments/attachment-fixture.bin") ===
		"fixture attachment bytes",
	"Attachment bytes were not restored.",
);
$branding = json_decode(
	(string) file_get_contents("/usr/local/ceasar/data/branding/config.json"),
	true,
);
backup_fixture_assert(
	($branding["name"] ?? "") === "Fixture Hosting",
	"Branding configuration was not restored.",
);
file_put_contents($export, json_encode($before, JSON_UNESCAPED_SLASHES));
$importConfig = $root . "/import.json";
file_put_contents(
	$importConfig,
	json_encode([
		"database" => $root . "/import.sqlite3",
		"attachments" => $root . "/import-attachments",
	]),
);
backup_fixture_command(
	"CEASAR_SUPPORT_CONFIG=" .
		escapeshellarg($importConfig) .
		" /usr/local/ceasar/bin/v-support-import " .
		escapeshellarg($export),
);
$import = new PDO("sqlite:" . $root . "/import.sqlite3");
backup_fixture_assert(
	(int) $import->query("SELECT count(*) FROM support_messages")->fetchColumn() === 2,
	"Export/import did not preserve message IDs.",
);
backup_fixture_assert(
	(int) $import
		->query("SELECT count(*) FROM support_outbox WHERE state IN ('queued','uncertain')")
		->fetchColumn() === 2,
	"Export/import changed queued notification states.",
);
echo "backup/restore fixture passed\n";
