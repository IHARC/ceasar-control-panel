<?php

declare(strict_types=1);

$root = dirname(__DIR__, 2);
$data = sys_get_temp_dir() . "/ceasar-support-" . bin2hex(random_bytes(4));
mkdir($data, 0700, true);
$config = $data . "/support.json";
file_put_contents(
	$config,
	json_encode([
		"database" => $data . "/support.sqlite3",
		"attachments" => $data . "/attachments",
		"staff_recipients" => ["staff@example.test"],
		"inbound_address" => "support@example.test",
	]),
);
putenv("CEASAR_SUPPORT_CONFIG=" . $config);
require $root . "/web/inc/support.php";

function assert_true(bool $value, string $message): void {
	if (!$value) {
		throw new RuntimeException($message);
	}
}
$db = support_db();
$emptySettings = support_dispatch(
	$db,
	[
		"userId" => "staff-settings",
		"email" => "settings@example.test",
		"displayName" => "Settings",
		"role" => "staff",
		"accounts" => [],
	],
	"settings",
	[],
);
assert_true(
	($emptySettings["imap"]["host"] ?? null) === "" &&
		($emptySettings["imap"]["configured"] ?? true) === false,
	"empty IMAP settings return clean JSON values",
);
$customer = [
	"userId" => "customer-1",
	"email" => "customer@example.test",
	"displayName" => "Customer",
	"role" => "customer",
	"accounts" => [["accountId" => "account-1", "displayName" => "Account"]],
];
$staff = [
	"userId" => "staff-1",
	"email" => "staff@example.test",
	"displayName" => "Staff",
	"role" => "staff",
	"accounts" => [],
];
$idempotencyKey = "create-ticket-0001";
$firstReplay = support_idempotent_dispatch(
	$db,
	$customer,
	"create",
	["accountId" => "account-1", "subject" => "Idempotent", "body" => "Only once"],
	$idempotencyKey,
);
$secondReplay = support_idempotent_dispatch(
	$db,
	$customer,
	"create",
	["accountId" => "account-1", "subject" => "Idempotent", "body" => "Only once"],
	$idempotencyKey,
);
assert_true(
	$firstReplay["id"] === $secondReplay["id"],
	"idempotent replay returns original ticket",
);
assert_true(
	(int) $db->query("SELECT count(*) FROM support_tickets")->fetchColumn() === 1,
	"idempotency prevents duplicate ticket",
);
for ($i = 0; $i < 55; $i++) {
	support_dispatch($db, $staff, "note", [
		"id" => $firstReplay["id"],
		"body" => "Internal history " . $i,
	]);
}
$conversation = support_ticket($db, $staff, $firstReplay["id"]);
assert_true(
	count($conversation["messages"]) === 50 &&
		$conversation["hasMoreMessages"] === true &&
		!empty($conversation["nextBefore"]),
	"long conversations paginate at 50 messages",
);
assert_true(
	count(
		support_ticket($db, $staff, $firstReplay["id"], $conversation["nextBefore"])["messages"],
	) === 6,
	"older conversation messages remain accessible",
);
$ticket = support_dispatch($db, $customer, "create", [
	"accountId" => "account-1",
	"subject" => "Need help",
	"body" => "Initial question",
]);
$emailPreview = support_render_email(
	[
		"from_name" => "Example",
		"accent_color" => "#112233",
		"support_url" => "https://customer.example/support",
		"admin_support_url" => "https://admin.example/support",
	],
	$ticket,
	"customer",
	"Reply",
	"<img src=x onerror=alert(1)>",
);
assert_true(
	str_contains($emailPreview, "&lt;img") && !str_contains($emailPreview, "<img src=x"),
	"ticket email escapes customer message HTML",
);
assert_true(
	str_contains(
		support_render_email(
			["admin_support_url" => "https://admin.example/support"],
			$ticket,
			"staff",
			"Reply",
			"text",
		),
		"admin.example",
	),
	"staff email uses staff support URL",
);
assert_true($ticket["status"] === "open", "ticket creation status");
assert_true(
	support_email_link(
		["support_url" => "https://example.test/support?plan=pro#cases"],
		$ticket,
		"customer",
	) ===
		"https://example.test/support?plan=pro&ticket=" . $ticket["id"] . "#cases",
	"ticket links preserve existing query and fragment",
);
$inboundAttachment = new class {
	public function getAttributes(): array {
		return ["filename" => "mail.txt", "content" => "mail attachment"];
	}
};
support_store_inbound_attachment(
	$db,
	$ticket["id"],
	$ticket["messages"][0]["id"],
	$inboundAttachment,
);
support_store_inbound_attachment(
	$db,
	$ticket["id"],
	$ticket["messages"][0]["id"],
	$inboundAttachment,
);
assert_true(
	(int) $db->query("SELECT count(*) FROM support_attachments")->fetchColumn() === 1,
	"Webklex attachment retries import only one protected file",
);

assert_true(count($ticket["messages"]) === 1, "initial message");
$participants = support_dispatch($db, $staff, "participant-add", [
	"id" => $ticket["id"],
	"email" => "copied@example.test",
	"displayName" => "Copied customer",
]);
$copied =
	array_values(
		array_filter(
			$participants["items"],
			fn($participant) => $participant["email"] === "copied@example.test",
		),
	)[0] ?? null;
assert_true($copied !== null, "staff can add email-only participant");
$participants = support_dispatch($db, $staff, "participant-remove", [
	"id" => $ticket["id"],
	"participantId" => $copied["id"],
]);
assert_true(
	!in_array("copied@example.test", array_column($participants["items"], "email"), true),
	"staff can remove participant and revoke mail access",
);
assert_true(
	(int) $db->query("SELECT count(*) FROM support_outbox")->fetchColumn() === 4,
	"creation mail intents",
);
$staffTokenQuery = $db->prepare(
	"SELECT token FROM support_mail_tokens WHERE recipient='staff@example.test' AND ticket_id=? LIMIT 1",
);
$staffTokenQuery->execute([$ticket["id"]]);
$staffToken = (string) $staffTokenQuery->fetchColumn();
assert_true(
	$staffToken !== "" &&
		support_import_inbound_message(
			"mail-staff",
			"staff@example.test",
			"support+" . $staffToken . "@example.test",
			"Re: Need help",
			"Staff reply by email",
		),
	"staff inbound mail routes with recipient token",
);
assert_true(
	$db
		->query("SELECT author_role FROM support_messages WHERE inbound_key='mail-staff'")
		->fetchColumn() === "staff" &&
		support_ticket($db, $staff, $ticket["id"])["status"] === "waiting_customer",
	"inbound staff authors retain role and status semantics",
);
$tokenQuery = $db->prepare(
	"SELECT token FROM support_mail_tokens WHERE recipient='customer@example.test' AND ticket_id=? LIMIT 1",
);
$tokenQuery->execute([$ticket["id"]]);
$token = (string) $tokenQuery->fetchColumn();
assert_true($token !== "", "recipient-specific reply token");
$ticket = support_dispatch($db, $staff, "reply", [
	"id" => $ticket["id"],
	"body" => "Here is an answer",
]);
assert_true($ticket["status"] === "waiting_customer", "staff reply status");
$ticket = support_dispatch($db, $staff, "note", [
	"id" => $ticket["id"],
	"body" => "Staff-only context",
]);
$customerView = support_ticket($db, $customer, $ticket["id"]);
assert_true(
	!in_array("internal", array_column($customerView["messages"], "visibility"), true),
	"internal notes are hidden from customers",
);
$ticket = support_dispatch($db, $customer, "reply", ["id" => $ticket["id"], "body" => "Thanks"]);
assert_true($ticket["status"] === "waiting_staff", "customer reply status");
$ticket = support_dispatch($db, $staff, "status", ["id" => $ticket["id"], "status" => "resolved"]);
$ticket = support_dispatch($db, $customer, "reply", [
	"id" => $ticket["id"],
	"body" => "One more thing",
]);
assert_true($ticket["status"] === "waiting_staff", "resolved ticket reopens on reply");
$before = count($ticket["messages"]);
assert_true(
	support_import_inbound_message(
		"mail-1",
		"customer@example.test",
		"support+" . $token . "@example.test",
		"Re: Need help",
		"Reply by email",
	),
	"verified inbound reply route",
);
$ticket = support_ticket($db, $staff, $ticket["id"]);
assert_true(
	(int) $db
		->query("SELECT count(*) FROM support_messages WHERE inbound_key='mail-1'")
		->fetchColumn() === 1,
	"inbound reply stored",
);
assert_true(
	support_import_inbound_message(
		"mail-1",
		"customer@example.test",
		"support+" . $token . "@example.test",
		"Re: Need help",
		"Duplicate",
	),
	"duplicate inbound is idempotent",
);
assert_true(
	(int) $db
		->query("SELECT count(*) FROM support_messages WHERE inbound_key='mail-1'")
		->fetchColumn() === 1,
	"duplicate inbound does not create a second message",
);
$ticket = support_dispatch($db, $staff, "status", ["id" => $ticket["id"], "status" => "closed"]);
assert_true(
	!support_import_inbound_message(
		"mail-closed",
		"customer@example.test",
		"support+" . $token . "@example.test",
		"Re: Need help",
		"Closed ticket reply",
	),
	"closed-ticket email is held for staff",
);
assert_true(
	(int) $db
		->query("SELECT count(*) FROM support_intake WHERE message_id='mail-closed'")
		->fetchColumn() === 1,
	"closed email creates staff intake",
);
$list = support_dispatch($db, $customer, "tickets", ["page" => 1, "perPage" => 25]);
assert_true($list["total"] === 2, "account-scoped pagination");
for ($i = 0; $i < 26; $i++) {
	support_dispatch($db, $customer, "create", [
		"accountId" => "account-1",
		"subject" => "Paged " . $i,
		"body" => "Case " . $i,
	]);
}
$paged = support_dispatch($db, $customer, "tickets", ["page" => 1, "perPage" => 25]);
assert_true($paged["total"] === 28 && $paged["nextPage"] === 2, "more than 25 tickets paginate");
$secondPage = support_dispatch($db, $customer, "tickets", ["page" => 2, "perPage" => 25]);
assert_true(count($secondPage["items"]) === 3, "second ticket page remains accessible");
// Queue delivery has explicit recovery semantics: a stale sending record is uncertain
// and never resent until a staff retry, while a normal SMTP failure retries safely.
$db->exec("UPDATE support_outbox SET state='accepted'");
$now = support_now();
$db->prepare(
	"INSERT INTO support_outbox(id,ticket_id,event_key,recipient,subject,body,reply_to,state,attempts,next_attempt_at,last_error,accepted_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'sending',1,?,?,NULL,?,?)",
)->execute([
	"stale-send",
	$ticket["id"],
	"stale-event",
	"staff@example.test",
	"stale",
	"stale",
	null,
	$now,
	null,
	$now,
	gmdate("Y-m-d\TH:i:s\Z", time() - 700),
]);
$db->prepare(
	"INSERT INTO support_outbox(id,ticket_id,event_key,recipient,subject,body,reply_to,state,attempts,next_attempt_at,last_error,accepted_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'queued',0,?,?,NULL,?,?)",
)->execute([
	"fake-fail",
	$ticket["id"],
	"fake-event",
	"staff@example.test",
	"fake",
	"fake",
	null,
	$now,
	null,
	$now,
	$now,
]);
$calls = 0;
$GLOBALS["ceasar_support_mailer_for_test"] = function () use (&$calls): array {
	$calls++;
	return ["accepted" => false, "error" => "fake SMTP failure"];
};
support_deliver_outbox(1);
assert_true(
	$db->query("SELECT state FROM support_outbox WHERE id='stale-send'")->fetchColumn() ===
		"uncertain",
	"stale SMTP work remains uncertain for manual review",
);
assert_true(
	$db->query("SELECT state FROM support_outbox WHERE id='fake-fail'")->fetchColumn() ===
		"retrying" && $calls === 1,
	"SMTP failure records retry without losing intent",
);
$db->exec("UPDATE support_outbox SET next_attempt_at='1970-01-01T00:00:00Z' WHERE id='fake-fail'");
$GLOBALS["ceasar_support_mailer_for_test"] = function () use (&$calls): array {
	$calls++;
	return ["accepted" => true, "error" => null];
};
support_deliver_outbox(1);
assert_true(
	$db->query("SELECT state FROM support_outbox WHERE id='fake-fail'")->fetchColumn() ===
		"accepted" && $calls === 2,
	"queued retry records SMTP acceptance",
);
unset($GLOBALS["ceasar_support_mailer_for_test"]);
// Rejected inbound files persist a staff-visible recovery record instead of disappearing.
$db->prepare(
	"INSERT INTO support_attachment_rejections(id,ticket_id,message_id,filename,reason,created_at) VALUES(?,?,?,?,?,?)",
)->execute([
	"reject-1",
	$ticket["id"],
	$db
		->query(
			"SELECT id FROM support_messages WHERE ticket_id=" .
				$db->quote($ticket["id"]) .
				" LIMIT 1",
		)
		->fetchColumn(),
	"blocked.exe",
	"Attachment type is not permitted.",
	$now,
]);
assert_true(
	count(
		support_dispatch($db, $staff, "attachment-rejections", ["id" => $ticket["id"]])["items"],
	) === 1,
	"rejected inbound files remain visible to staff",
);
for ($i = 0; $i < 30; $i++) {
	$db->prepare(
		"INSERT INTO support_intake(id,message_id,sender,subject,body,state,created_at) VALUES(?,?,?,?,?,'pending',?)",
	)->execute([
		"intake-" . $i,
		"intake-message-" . $i,
		"sender" . $i . "@example.test",
		"intake",
		"body",
		$now,
	]);
}
$intakePage = support_dispatch($db, $staff, "intake", ["page" => 2, "perPage" => 25]);
assert_true(
	$intakePage["total"] >= 31 && count($intakePage["items"]) >= 6 && $intakePage["page"] === 2,
	"staff intake is paginated",
);
support_save_settings($db, [
	"staff_recipients" => ["staff@example.test"],
	"support_url" => "https://customer.example.test/support?source=email#ticket",
	"admin_support_url" => "http://127.0.0.1:8080/list/support",
	"imap" => [
		"host" => "imap.example.test",
		"port" => 993,
		"authentication" => "oauth2",
		"oauth" => ["tenant" => "tenant", "client_id" => "client", "client_secret" => "secret"],
	],
]);
support_save_settings($db, ["imap" => ["oauth" => ["client_secret" => ""]]]);
$settings = support_effective_config($db);
assert_true(
	$settings["imap"]["oauth"]["client_secret"] === "secret",
	"blank mailbox secrets preserve the stored value",
);
assert_true(
	$settings["support_url"] === "https://customer.example.test/support?source=email#ticket" &&
		$settings["admin_support_url"] === "http://127.0.0.1:8080/list/support",
	"support links are saved with HTTPS and local-preview validation",
);
foreach (
	[
		["from_email" => "duplicate@example.test"],
		["imap" => ["port" => 70000]],
		["staff_recipients" => ["not-an-email"]],
		["support_url" => "http://public.example.test/support"],
	]
	as $invalid
) {
	$rejected = false;
	try {
		support_save_settings($db, $invalid);
	} catch (InvalidArgumentException) {
		$rejected = true;
	}
	assert_true($rejected, "invalid or duplicate support settings are rejected");
}
$archive = support_export();
assert_true(count($archive["tables"]["support_tickets"]) === 28, "archive includes ticket history");
assert_true(
	support_import($archive)["imported"] === true,
	"archive import is idempotent and does not send history",
);
echo "support core tests passed\n";
