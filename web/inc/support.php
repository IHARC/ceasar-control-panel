<?php

/** Native, installation-local support desk.  It deliberately has no IHARC dependency. */
declare(strict_types=1);

const CEASAR_SUPPORT_CONFIG = "/usr/local/ceasar/conf/support.json";
const CEASAR_SUPPORT_DATA = "/var/lib/ceasar/support";
require_once __DIR__ . "/support-settings.php";
require_once __DIR__ . "/mail-transport.php";

function support_config(): array {
	$path = getenv("CEASAR_SUPPORT_CONFIG") ?: CEASAR_SUPPORT_CONFIG;
	$defaults = [
		"database" => CEASAR_SUPPORT_DATA . "/support.sqlite3",
		"attachments" => CEASAR_SUPPORT_DATA . "/attachments",
		"staff_recipients" => [],
		"from_email" => "",
		"from_name" => "Ceasar Support",
		"identity_endpoint" => "",
		"identity_secret" => "",
		"imap" => [],
	];
	if (!is_file($path)) {
		$data = [];
	} else {
		$data = json_decode((string) file_get_contents($path), true);
		if (!is_array($data)) {
			throw new RuntimeException("Support configuration is invalid.");
		}
	}
	if (!is_array($data)) {
		$data = [];
	}
	$config = array_replace($defaults, $data);
	if (is_file(__DIR__ . "/branding.php")) {
		require_once __DIR__ . "/branding.php";
		$brand = branding_config();
		$config["brand_name"] = $brand["name"];
		$config["from_name"] =
			$brand["sender_name"] !== ""
				? $brand["sender_name"]
				: ($brand["name"] ?:
				$config["from_name"]);
		$config["accent_color"] = $brand["accent_color"];
		$config["branding_logo"] = $brand["logo"] !== "" ? branding_asset_url("logo") : "";
	}
	return $config;
}

function support_db(): PDO {
	static $db;
	if ($db instanceof PDO) {
		return $db;
	}
	$config = support_config();
	$dir = dirname((string) $config["database"]);
	if (!is_dir($dir) && !mkdir($dir, 0700, true) && !is_dir($dir)) {
		throw new RuntimeException("Unable to create support data directory.");
	}
	$db = new PDO("sqlite:" . $config["database"], null, null, [
		PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
		PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
	]);
	$db->exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000");
	support_migrate($db);
	$GLOBALS["ceasar_support_db"] = $db;
	return $db;
}

function support_migrate(PDO $db): void {
	$db->exec("CREATE TABLE IF NOT EXISTS support_tickets (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, subject TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('open','waiting_staff','waiting_customer','resolved','closed')), priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')), assignee_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by TEXT NOT NULL);
	CREATE INDEX IF NOT EXISTS support_tickets_account_updated ON support_tickets(account_id, updated_at DESC);
	CREATE TABLE IF NOT EXISTS support_participants (ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE, user_id TEXT NOT NULL, email TEXT NOT NULL, display_name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('customer','staff')), PRIMARY KEY(ticket_id,user_id));
	CREATE TABLE IF NOT EXISTS support_messages (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE, author_id TEXT NOT NULL, author_email TEXT NOT NULL, author_name TEXT NOT NULL, author_role TEXT NOT NULL CHECK(author_role IN ('customer','staff')), visibility TEXT NOT NULL CHECK(visibility IN ('public','internal')), body TEXT NOT NULL, created_at TEXT NOT NULL, inbound_key TEXT UNIQUE);
	CREATE INDEX IF NOT EXISTS support_messages_ticket_created ON support_messages(ticket_id,created_at);
	CREATE TABLE IF NOT EXISTS support_attachments (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE, message_id TEXT NOT NULL REFERENCES support_messages(id) ON DELETE CASCADE, filename TEXT NOT NULL, mime_type TEXT NOT NULL, bytes INTEGER NOT NULL, storage_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
	CREATE TABLE IF NOT EXISTS support_outbox (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE, event_key TEXT NOT NULL UNIQUE, recipient TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, reply_to TEXT, state TEXT NOT NULL CHECK(state IN ('queued','sending','accepted','retrying','failed','uncertain')), attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL, last_error TEXT, accepted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
	CREATE INDEX IF NOT EXISTS support_outbox_pending ON support_outbox(state,next_attempt_at);
	CREATE TABLE IF NOT EXISTS support_intake (id TEXT PRIMARY KEY, message_id TEXT UNIQUE, sender TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, state TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL);
	CREATE TABLE IF NOT EXISTS support_attachment_rejections (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE, message_id TEXT NOT NULL REFERENCES support_messages(id) ON DELETE CASCADE, filename TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL);
	CREATE TABLE IF NOT EXISTS support_reads (ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE, user_id TEXT NOT NULL, read_at TEXT NOT NULL, PRIMARY KEY(ticket_id,user_id));
	CREATE TABLE IF NOT EXISTS support_mail_tokens (token TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE, recipient TEXT NOT NULL, created_at TEXT NOT NULL, used_at TEXT);
	CREATE TABLE IF NOT EXISTS support_audit (id TEXT PRIMARY KEY, ticket_id TEXT, actor_id TEXT NOT NULL, action TEXT NOT NULL, created_at TEXT NOT NULL, details TEXT NOT NULL);
	CREATE TABLE IF NOT EXISTS support_idempotency (actor_id TEXT NOT NULL, request_key TEXT NOT NULL, action TEXT NOT NULL, response TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(actor_id,request_key));
	CREATE TABLE IF NOT EXISTS support_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);");
	try {
		$db->exec("ALTER TABLE support_outbox ADD COLUMN reply_to TEXT");
	} catch (PDOException) {
	}
	try {
		$db->exec("ALTER TABLE support_idempotency ADD COLUMN payload_hash TEXT");
	} catch (PDOException) {
	}
}

function support_uuid(): string {
	return bin2hex(random_bytes(16));
}
function support_now(): string {
	return gmdate("Y-m-d\\TH:i:s\\Z");
}
function support_json_error(int $status, string $code, string $message): never {
	http_response_code($status);
	header("Content-Type: application/json; charset=utf-8");
	echo json_encode(["ok" => false, "error" => ["code" => $code, "message" => $message]]);
	exit();
}
function support_input(): array {
	$raw = file_get_contents("php://input");
	$json = $raw === "" ? [] : json_decode($raw, true);
	return is_array($json) ? array_merge($_GET, $_POST, $json) : array_merge($_GET, $_POST);
}

/** @return array{userId:string,email:string,displayName:string,role:string,accounts:array<int,array{accountId:string,displayName:string}>} */
function support_actor(): array {
	// The built-in HTTP fixture supplies a synthetic actor only with an explicit
	// test process flag; production never accepts these headers.
	if (getenv("CEASAR_SUPPORT_TEST") === "1" && isset($_SERVER["HTTP_X_TEST_ROLE"])) {
		$other = ($_SERVER["HTTP_X_TEST_USER"] ?? "") === "other";
		if (($_SERVER["HTTP_X_TEST_ROLE"] ?? "") === "staff") {
			return [
				"userId" => "staff-1",
				"email" => "staff@example.test",
				"displayName" => "Staff",
				"role" => "staff",
				"accounts" => [],
			];
		}
		return $other
			? [
				"userId" => "customer-2",
				"email" => "other@example.test",
				"displayName" => "Other",
				"role" => "customer",
				"accounts" => [["accountId" => "account-2", "displayName" => "Other account"]],
			]
			: [
				"userId" => "customer-1",
				"email" => "customer@example.test",
				"displayName" => "Customer",
				"role" => "customer",
				"accounts" => [["accountId" => "account-1", "displayName" => "Account"]],
			];
	}
	$auth = $_SERVER["HTTP_AUTHORIZATION"] ?? "";
	if (!preg_match('/^Bearer\\s+(.+)$/i', $auth, $match)) {
		return support_native_actor();
	}
	$config = support_config();
	if ($config["identity_endpoint"] === "") {
		support_json_error(
			401,
			"unauthenticated",
			"External support identities are not configured.",
		);
	}
	$context = stream_context_create([
		"http" => [
			"method" => "GET",
			"header" =>
				"Authorization: Bearer " .
				trim($match[1]) .
				"\r\nX-Ceasar-Support-Secret: " .
				$config["identity_secret"] .
				"\r\n",
			"timeout" => 10,
			"ignore_errors" => true,
		],
	]);
	$reply = @file_get_contents($config["identity_endpoint"], false, $context);
	$data = is_string($reply) ? json_decode($reply, true) : null;
	if (is_array($data) && isset($data["data"]) && is_array($data["data"])) {
		$data = $data["data"];
	}
	if (
		!is_array($data) ||
		empty($data["userId"]) ||
		!filter_var($data["email"] ?? "", FILTER_VALIDATE_EMAIL)
	) {
		support_json_error(401, "unauthenticated", "Support identity could not be verified.");
	}
	$accounts = array_values(
		array_filter(
			$data["accounts"] ?? [],
			fn($a) => is_array($a) && is_string($a["accountId"] ?? null),
		),
	);
	return [
		"userId" => (string) $data["userId"],
		"email" => (string) $data["email"],
		"displayName" => (string) ($data["displayName"] ?? $data["email"]),
		"role" => ($data["role"] ?? "customer") === "staff" ? "staff" : "customer",
		"accounts" => $accounts,
	];
}

function support_native_actor(): array {
	if (session_status() !== PHP_SESSION_ACTIVE) {
		session_start();
	}
	$user = $_SESSION["user"] ?? null;
	if (!is_string($user) || $user === "") {
		support_json_error(401, "unauthenticated", "A support identity is required.");
	}
	// Match main.php session binding: only trust CF-Connecting-IP when the peer is
	// a Cloudflare address. A raw REMOTE_ADDR comparison logs every proxied user out.
	$ip = support_real_user_ip();
	if (
		!empty($_SESSION["user_combined_ip"]) &&
		!hash_equals((string) $_SESSION["user_combined_ip"], $ip)
	) {
		support_json_error(401, "unauthenticated", "Native session IP validation failed.");
	}
	if (
		!empty($_SESSION["INACTIVE_SESSION_TIMEOUT"]) &&
		(!isset($_SESSION["LAST_ACTIVITY"]) ||
			(int) $_SESSION["LAST_ACTIVITY"] + (int) $_SESSION["INACTIVE_SESSION_TIMEOUT"] * 60 <
				time())
	) {
		support_json_error(401, "unauthenticated", "Native session expired.");
	}
	$_SESSION["LAST_ACTIVITY"] = time();
	$record = [];
	$output = [];
	$code = 1;
	if (defined("CEASAR_CMD")) {
		exec(CEASAR_CMD . "v-list-user " . escapeshellarg($user) . " json", $output, $code);
	} elseif (is_executable("/usr/local/ceasar/bin/v-list-user")) {
		exec(
			"/usr/bin/sudo /usr/local/ceasar/bin/v-list-user " . escapeshellarg($user) . " json",
			$output,
			$code,
		);
	}
	if ($code === 0) {
		$decoded = json_decode(implode("", $output), true);
		if (is_array($decoded)) {
			$record = $decoded[$user] ?? [];
		}
	}
	$email = (string) ($record["CONTACT"] ?? ($record["EMAIL"] ?? ""));
	if (($record["SUSPENDED"] ?? "no") === "yes") {
		support_json_error(403, "forbidden", "The native account is suspended.");
	}
	if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
		support_json_error(
			401,
			"unauthenticated",
			"The native account has no valid contact email.",
		);
	}
	$staff = ($record["ROLE"] ?? "") === "admin";
	return [
		"userId" => "ceasar:" . $user,
		"email" => $email,
		"displayName" => (string) ($record["NAME"] ?? $user),
		"role" => $staff ? "staff" : "customer",
		"accounts" => $staff
			? []
			: [
				[
					"accountId" => "ceasar:" . $user,
					"displayName" => (string) ($record["NAME"] ?? $user),
				],
			],
	];
}

function support_real_user_ip(): string {
	// Keep the API binding identical to main.php, including trusted Cloudflare proxies.
	if (!function_exists("get_real_user_ip") && is_file(__DIR__ . "/helpers.php")) {
		require_once __DIR__ . "/helpers.php";
	}
	if (function_exists("get_real_user_ip")) {
		return (string) get_real_user_ip();
	}
	return (string) ($_SERVER["REMOTE_ADDR"] ?? "");
}

function support_can_access(array $actor, array $ticket): bool {
	if ($actor["role"] === "staff") {
		return true;
	}
	foreach ($actor["accounts"] as $account) {
		if ($account["accountId"] === $ticket["account_id"]) {
			return true;
		}
	}
	return false;
}
function support_ticket_row(PDO $db, string $id): array {
	$s = $db->prepare("SELECT * FROM support_tickets WHERE id=?");
	$s->execute([$id]);
	$ticket = $s->fetch();
	if (!$ticket) {
		support_json_error(404, "not_found", "Ticket not found.");
	}
	return $ticket;
}
function support_permissions(array $actor, array $ticket): array {
	$staff = $actor["role"] === "staff";
	return [
		"reply" => $ticket["status"] !== "closed",
		"reopen" => $ticket["status"] === "closed",
		"note" => $staff,
		"assign" => $staff,
		"priority" => $staff,
		"status" => $staff || $ticket["status"] === "closed",
	];
}
function support_participants(PDO $db, string $id): array {
	$s = $db->prepare(
		"SELECT user_id AS id,email,display_name AS displayName,role FROM support_participants WHERE ticket_id=? ORDER BY role,email",
	);
	$s->execute([$id]);
	return $s->fetchAll();
}
function support_ticket(
	PDO $db,
	array $actor,
	string $id,
	?string $before = null,
	bool $summary = false,
): array {
	$ticket = support_ticket_row($db, $id);
	if (!support_can_access($actor, $ticket)) {
		support_json_error(403, "forbidden", "Ticket access is not permitted.");
	}
	$staff = $actor["role"] === "staff";
	$cutoff = null;
	if ($before) {
		$cursor = $db->prepare("SELECT rowid FROM support_messages WHERE id=? AND ticket_id=?");
		$cursor->execute([$before, $id]);
		$cutoff = $cursor->fetchColumn();
	}
	$sql =
		"SELECT * FROM support_messages WHERE ticket_id=? " .
		($staff ? "" : "AND visibility='public' ") .
		($cutoff !== false && $cutoff !== null ? "AND rowid < ? " : "") .
		"ORDER BY created_at DESC, rowid DESC LIMIT 51";
	$s = $db->prepare($sql);
	$s->execute($cutoff ? [$id, $cutoff] : [$id]);
	$rows = $s->fetchAll();
	$hasMore = count($rows) > 50;
	if ($hasMore) {
		array_pop($rows);
	}
	$rows = array_reverse($rows);
	$messages = [];
	foreach ($summary ? [] : $rows as $m) {
		$a = $db->prepare(
			"SELECT id,filename,mime_type AS mimeType,bytes FROM support_attachments WHERE message_id=?",
		);
		$a->execute([$m["id"]]);
		$messages[] = [
			"id" => $m["id"],
			"author" => [
				"id" => $m["author_id"],
				"email" => $m["author_email"],
				"displayName" => $m["author_name"],
				"role" => $m["author_role"],
			],
			"visibility" => $m["visibility"],
			"body" => $m["body"],
			"createdAt" => $m["created_at"],
			"attachments" => $a->fetchAll(),
		];
	}
	$read = $db->prepare("SELECT read_at FROM support_reads WHERE ticket_id=? AND user_id=?");
	$read->execute([$id, $actor["userId"]]);
	$readAt = $read->fetchColumn();
	$unread = $readAt === false || $readAt < $ticket["updated_at"];
	$result = [
		"id" => $ticket["id"],
		"accountId" => $ticket["account_id"],
		"subject" => $ticket["subject"],
		"status" => $ticket["status"],
		"priority" => $ticket["priority"],
		"assigneeId" => $ticket["assignee_id"],
		"createdAt" => $ticket["created_at"],
		"updatedAt" => $ticket["updated_at"],
		"unread" => $unread,
		"participants" => support_participants($db, $id),
		"permissions" => support_permissions($actor, $ticket),
	];
	if (!$summary) {
		$result["messages"] = $messages;
		$result["hasMoreMessages"] = $hasMore;
		$result["nextBefore"] = $hasMore ? $messages[0]["id"] : null;
	}
	return $result;
}

function support_assert_body(array $input): string {
	$body = trim((string) ($input["body"] ?? ""));
	if ($body === "" || mb_strlen($body) > 20000) {
		support_json_error(
			422,
			"invalid_body",
			"Message body must be between 1 and 20,000 characters.",
		);
	}
	return $body;
}
function support_add_participant(PDO $db, string $ticket, array $actor): void {
	$s = $db->prepare(
		"INSERT OR IGNORE INTO support_participants(ticket_id,user_id,email,display_name,role) VALUES(?,?,?,?,?)",
	);
	$s->execute([
		$ticket,
		$actor["userId"],
		$actor["email"],
		$actor["displayName"],
		$actor["role"],
	]);
}
function support_add_message(
	PDO $db,
	array $ticket,
	array $actor,
	string $body,
	string $visibility,
	string $inboundKey = "",
): string {
	$id = support_uuid();
	$s = $db->prepare(
		"INSERT INTO support_messages(id,ticket_id,author_id,author_email,author_name,author_role,visibility,body,created_at,inbound_key) VALUES(?,?,?,?,?,?,?,?,?,?)",
	);
	$s->execute([
		$id,
		$ticket["id"],
		$actor["userId"],
		$actor["email"],
		$actor["displayName"],
		$actor["role"],
		$visibility,
		$body,
		support_now(),
		$inboundKey ?: null,
	]);
	return $id;
}
function support_queue(
	PDO $db,
	array $ticket,
	array $recipients,
	string $event,
	string $subject,
	string $body,
): void {
	$recipients = array_values(
		array_unique(
			array_filter(
				array_map(fn($mail) => strtolower(trim((string) $mail)), $recipients),
				fn($mail) => filter_var($mail, FILTER_VALIDATE_EMAIL),
			),
		),
	);
	foreach ($recipients as $recipient) {
		$key = hash("sha256", $event . "|" . $recipient);
		$token = support_uuid();
		$replyTo = support_reply_to($db, $token);
		if ($replyTo) {
			$db->prepare(
				"INSERT INTO support_mail_tokens(token,ticket_id,recipient,created_at) VALUES(?,?,?,?)",
			)->execute([$token, $ticket["id"], $recipient, support_now()]);
		}
		$s = $db->prepare(
			"INSERT OR IGNORE INTO support_outbox(id,ticket_id,event_key,recipient,subject,body,reply_to,state,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?, 'queued',?,?,?)",
		);
		$now = support_now();
		$s->execute([
			support_uuid(),
			$ticket["id"],
			$key,
			$recipient,
			$subject,
			$body,
			$replyTo,
			$now,
			$now,
			$now,
		]);
	}
}
function support_reply_to(PDO $db, string $token): string {
	$address = (string) (support_effective_config($db)["inbound_address"] ?? "");
	if (!filter_var($address, FILTER_VALIDATE_EMAIL)) {
		return "";
	}
	[$local, $domain] = explode("@", $address, 2);
	return $local . "+" . $token . "@" . $domain;
}
function support_email_link(array $cfg, array $ticket, string $audience): string {
	$base =
		$audience === "staff"
			? (string) ($cfg["admin_support_url"] ?? "")
			: (string) ($cfg["support_url"] ?? "");
	if ($base === "") {
		return "";
	}
	$parts = parse_url($base);
	if (
		!is_array($parts) ||
		!in_array($parts["scheme"] ?? "", ["https", "http"], true) ||
		empty($parts["host"])
	) {
		return "";
	}
	$query = [];
	parse_str($parts["query"] ?? "", $query);
	$query["ticket"] = $ticket["id"];
	return $parts["scheme"] .
		"://" .
		$parts["host"] .
		(isset($parts["port"]) ? ":" . $parts["port"] : "") .
		($parts["path"] ?? "/") .
		"?" .
		http_build_query($query) .
		(isset($parts["fragment"]) ? "#" . $parts["fragment"] : "");
}
/** Pure renderer for preview and queue workers. Message text is always HTML-escaped. */
function support_render_email(
	array $cfg,
	array $ticket,
	string $audience,
	string $heading,
	string $message,
): string {
	$name = htmlspecialchars(
		(string) ($cfg["brand_name"] ?? ($cfg["from_name"] ?? "") ?: "Ceasar"),
		ENT_QUOTES | ENT_SUBSTITUTE,
		"UTF-8",
	);
	$subject = htmlspecialchars((string) $ticket["subject"], ENT_QUOTES | ENT_SUBSTITUTE, "UTF-8");
	$body = nl2br(htmlspecialchars($message, ENT_QUOTES | ENT_SUBSTITUTE, "UTF-8"));
	$link = support_email_link($cfg, $ticket, $audience);
	$accent = preg_match('/^#[0-9a-fA-F]{6}$/', (string) ($cfg["accent_color"] ?? ""))
		? $cfg["accent_color"]
		: "#1f5f99";
	$action =
		$link === ""
			? ""
			: '<p style="margin:24px 0"><a style="color:' .
				$accent .
				';font-weight:bold" href="' .
				htmlspecialchars($link, ENT_QUOTES | ENT_SUBSTITUTE, "UTF-8") .
				'">Open ticket</a></p>';
	$logo = "";
	$origin = parse_url($link);
	if (
		!empty($cfg["branding_logo"]) &&
		is_array($origin) &&
		!empty($origin["host"]) &&
		str_starts_with($cfg["branding_logo"], "/branding/")
	) {
		$url =
			$origin["scheme"] .
			"://" .
			$origin["host"] .
			(isset($origin["port"]) ? ":" . $origin["port"] : "") .
			$cfg["branding_logo"];
		$logo =
			'<p><img src="' .
			htmlspecialchars($url, ENT_QUOTES, "UTF-8") .
			'" alt="' .
			$name .
			'" style="max-width:180px;max-height:72px;width:auto;height:auto"></p>';
	}
	return '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f5f6f7;font-family:Arial,sans-serif;color:#26313b;line-height:1.6"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:24px 16px"><div style="max-width:600px;margin:auto;background:white;padding:24px;border-top:3px solid ' .
		$accent .
		'">' .
		$logo .
		'<p style="color:' .
		$accent .
		';font-weight:bold;margin:0 0 24px">' .
		$name .
		"</p><p>" .
		htmlspecialchars($heading, ENT_QUOTES | ENT_SUBSTITUTE, "UTF-8") .
		'</p><h1 style="font-size:21px;line-height:1.4">' .
		$subject .
		'</h1><div style="overflow-wrap:anywhere">' .
		$body .
		"</div>" .
		$action .
		'<p style="font-size:13px;color:#616d78">' .
		(!empty($cfg["inbound_address"])
			? "Reply to this email to continue the conversation."
			: "Open the ticket to continue the conversation.") .
		'</p><hr style="border:0;border-top:1px solid #e1e5e9;margin:24px 0"><a style="font-size:11px;color:#697582" href="https://iharc.ca/">Powered by IHARC Labs</a></div></td></tr></table></body></html>';
}
function support_notify(PDO $db, array $ticket, array $actor, string $kind): void {
	$cfg = support_effective_config($db);
	$participants = support_participants($db, $ticket["id"]);
	$customer = array_column(
		array_filter($participants, fn($p) => $p["role"] === "customer"),
		"email",
	);
	$staff = (array) ($cfg["staff_recipients"] ?? []);
	if ($ticket["assignee_id"]) {
		foreach ($participants as $p) {
			if ($p["id"] === $ticket["assignee_id"] && $p["role"] === "staff") {
				$staff[] = $p["email"];
			}
		};
	}
	$last = $db->prepare(
		"SELECT id,body FROM support_messages WHERE ticket_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1",
	);
	$last->execute([$ticket["id"]]);
	$last = $last->fetch() ?: ["id" => "created", "body" => ""];
	$message = (string) $last["body"];
	if ($kind === "created") {
		support_queue(
			$db,
			$ticket,
			$customer,
			"created-ack-" . $ticket["id"],
			"We received your support request",
			support_render_email(
				$cfg,
				$ticket,
				"customer",
				"We received your support request.",
				$message,
			),
		);
		support_queue(
			$db,
			$ticket,
			$staff,
			"created-staff-" . $ticket["id"],
			"New support ticket",
			support_render_email(
				$cfg,
				$ticket,
				"staff",
				"A customer created a support ticket.",
				$message,
			),
		);
	} elseif ($kind === "customer_reply") {
		support_queue(
			$db,
			$ticket,
			$staff,
			"customer-" . $ticket["id"] . "-" . $last["id"],
			"Customer replied to support ticket",
			support_render_email(
				$cfg,
				$ticket,
				"staff",
				"A customer replied to this ticket.",
				$message,
			),
		);
	} elseif ($kind === "staff_reply") {
		support_queue(
			$db,
			$ticket,
			$customer,
			"staff-" . $ticket["id"] . "-" . $last["id"],
			"Support replied to your ticket",
			support_render_email(
				$cfg,
				$ticket,
				"customer",
				"Support replied to your ticket.",
				$message,
			),
		);
	}
}

function support_with_lock(callable $callback): mixed {
	$path = dirname((string) support_config()["database"]) . "/.lock";
	$handle = fopen($path, "c");
	if (!$handle || !flock($handle, LOCK_EX)) {
		throw new RuntimeException("Support store is busy.");
	}
	try {
		return $callback();
	} finally {
		flock($handle, LOCK_UN);
		fclose($handle);
	}
}
function support_idempotent_dispatch(
	PDO $db,
	array $actor,
	string $action,
	array $input,
	string $key,
): array {
	$hash = hash("sha256", json_encode($input, JSON_UNESCAPED_SLASHES));
	$db->beginTransaction();
	try {
		$prior = $db->prepare(
			"SELECT action,response,payload_hash FROM support_idempotency WHERE actor_id=? AND request_key=?",
		);
		$prior->execute([$actor["userId"], $key]);
		$stored = $prior->fetch();
		if ($stored) {
			if (
				$stored["action"] !== $action ||
				(!empty($stored["payload_hash"]) && !hash_equals($stored["payload_hash"], $hash))
			) {
				support_json_error(
					409,
					"idempotency_conflict",
					"This idempotency key belongs to another request.",
				);
			}
			$db->commit();
			return json_decode($stored["response"], true, 512, JSON_THROW_ON_ERROR);
		}
		$result = support_dispatch($db, $actor, $action, $input);
		$db->prepare(
			"INSERT INTO support_idempotency(actor_id,request_key,action,response,payload_hash,created_at) VALUES(?,?,?,?,?,?)",
		)->execute([
			$actor["userId"],
			$key,
			$action,
			json_encode($result, JSON_UNESCAPED_SLASHES),
			$hash,
			support_now(),
		]);
		$ticketId = (string) ($result["id"] ?? ($input["id"] ?? ($input["ticketId"] ?? "")));
		$db->prepare(
			"INSERT INTO support_audit(id,ticket_id,actor_id,action,created_at,details) VALUES(?,?,?,?,?,?)",
		)->execute([
			support_uuid(),
			$ticketId ?: null,
			$actor["userId"],
			$action,
			support_now(),
			json_encode(["requestId" => $key, "payloadHash" => $hash]),
		]);
		$db->commit();
		return $result;
	} catch (Throwable $e) {
		if ($db->inTransaction()) {
			$db->rollBack();
		}
		throw $e;
	}
}
function support_api(): never {
	$input = support_input();
	$action =
		(string) ($input["action"] ??
			basename(rtrim(parse_url($_SERVER["REQUEST_URI"] ?? "", PHP_URL_PATH), "/")));
	$db = support_db();
	$actor = support_actor();
	try {
		$method = $_SERVER["REQUEST_METHOD"] ?? "GET";
		if (
			in_array($method, ["GET", "HEAD"], true) &&
			!in_array(
				$action,
				[
					"tickets",
					"ticket",
					"identity",
					"staff",
					"settings",
					"outbox",
					"intake",
					"participants",
					"attachment-rejections",
				],
				true,
			)
		) {
			support_json_error(
				405,
				"method_not_allowed",
				"This support action requires a mutation request.",
			);
		}
		$write = !in_array($method, ["GET", "HEAD"], true);
		if ($write && !in_array($method, ["POST", "PUT", "PATCH"], true)) {
			support_json_error(
				405,
				"method_not_allowed",
				"This support action requires POST, PUT, or PATCH.",
			);
		}
		if (
			$write &&
			empty($_SERVER["HTTP_AUTHORIZATION"]) &&
			(!isset($_SESSION["token"]) ||
				!hash_equals(
					(string) $_SESSION["token"],
					(string) ($_SERVER["HTTP_X_CEASAR_CSRF"] ?? ""),
				))
		) {
			support_json_error(
				403,
				"csrf_failed",
				"A native-session mutation requires X-Ceasar-CSRF.",
			);
		}
		$key = trim((string) ($_SERVER["HTTP_IDEMPOTENCY_KEY"] ?? ($input["requestId"] ?? "")));
		if ($write && !preg_match('/^[A-Za-z0-9._:-]{16,200}$/', $key)) {
			support_json_error(422, "idempotency_required", "A valid Idempotency-Key is required.");
		}
		$data = $write
			? support_with_lock(function () use ($db, $actor, $action, $input, $key) {
				return support_idempotent_dispatch($db, $actor, $action, $input, $key);
			})
			: support_dispatch($db, $actor, $action, $input);
		header("Content-Type: application/json; charset=utf-8");
		echo json_encode(["ok" => true, "data" => $data], JSON_UNESCAPED_SLASHES);
		exit();
	} catch (PDOException $e) {
		support_json_error(500, "storage_error", "Support storage operation failed.");
	} catch (InvalidArgumentException $e) {
		support_json_error(422, "invalid_request", $e->getMessage());
	} catch (Throwable $e) {
		support_json_error(500, "support_error", "Support request could not be completed.");
	}
}
function support_dispatch(PDO $db, array $actor, string $action, array $in): array {
	if ($action === "identity") {
		return [
			"userId" => $actor["userId"],
			"email" => $actor["email"],
			"displayName" => $actor["displayName"],
			"role" => $actor["role"],
			"accounts" => $actor["accounts"],
		];
	}
	if (
		in_array(
			$action,
			[
				"settings",
				"test-smtp",
				"test-imap",
				"outbox",
				"intake",
				"attachment-rejections",
				"intake-resolve",
				"staff",
				"participant-add",
				"participant-remove",
				"retry",
			],
			true,
		)
	) {
		return support_staff_action($db, $actor, $action, $in);
	}
	if ($action === "mark-read") {
		$ticket = support_ticket_row($db, (string) ($in["id"] ?? ""));
		if (!support_can_access($actor, $ticket)) {
			support_json_error(403, "forbidden", "Ticket access is not permitted.");
		}
		$db->prepare(
			"INSERT INTO support_reads(ticket_id,user_id,read_at) VALUES(?,?,?) ON CONFLICT(ticket_id,user_id) DO UPDATE SET read_at=excluded.read_at",
		)->execute([$ticket["id"], $actor["userId"], support_now()]);
		return ["read" => true];
	}
	if ($action === "tickets") {
		if (!empty($in["id"])) {
			return support_ticket(
				$db,
				$actor,
				(string) $in["id"],
				isset($in["before"]) ? (string) $in["before"] : null,
			);
		}
		$page = max(1, (int) ($in["page"] ?? 1));
		$per = min(100, max(1, (int) ($in["perPage"] ?? 25)));
		$where = [];
		$args = [];
		if ($actor["role"] !== "staff") {
			$ids = array_column($actor["accounts"], "accountId");
			if (!$ids) {
				return [
					"items" => [],
					"tickets" => [],
					"page" => $page,
					"perPage" => $per,
					"total" => 0,
					"nextPage" => null,
				];
			}
			$where[] = "account_id IN (" . implode(",", array_fill(0, count($ids), "?")) . ")";
			$args = $ids;
		}
		foreach (["status", "priority", "assigneeId"] as $k) {
			if (isset($in[$k]) && $in[$k] !== "") {
				$where[] = ($k === "assigneeId" ? "assignee_id" : $k) . "=?";
				$args[] = $in[$k];
			}
		}
		if (!empty($in["query"])) {
			$where[] = "(subject LIKE ? OR id LIKE ?)";
			$args[] = "%" . $in["query"] . "%";
			$args[] = "%" . $in["query"] . "%";
		}
		if (($in["unreadOnly"] ?? "") === "1") {
			$where[] =
				"NOT EXISTS (SELECT 1 FROM support_reads r WHERE r.ticket_id=support_tickets.id AND r.user_id=? AND r.read_at>=support_tickets.updated_at)";
			$args[] = $actor["userId"];
		}
		$sql = " FROM support_tickets" . ($where ? " WHERE " . implode(" AND ", $where) : "");
		$s = $db->prepare("SELECT count(*)" . $sql);
		$s->execute($args);
		$total = (int) $s->fetchColumn();
		$s = $db->prepare("SELECT *" . $sql . " ORDER BY updated_at DESC LIMIT ? OFFSET ?");
		foreach ($args as $i => $v) {
			$s->bindValue($i + 1, $v);
		}
		$s->bindValue(count($args) + 1, $per, PDO::PARAM_INT);
		$s->bindValue(count($args) + 2, ($page - 1) * $per, PDO::PARAM_INT);
		$s->execute();
		$items = [];
		foreach ($s as $row) {
			$items[] = support_ticket($db, $actor, $row["id"], null, true);
		}
		return [
			"items" => $items,
			"tickets" => $items,
			"page" => $page,
			"perPage" => $per,
			"total" => $total,
			"nextPage" => $page * $per < $total ? $page + 1 : null,
		];
	}
	if ($action === "ticket") {
		return support_ticket(
			$db,
			$actor,
			(string) ($in["id"] ?? ""),
			isset($in["before"]) ? (string) $in["before"] : null,
		);
	}
	if ($action === "create") {
		if ($actor["role"] !== "customer") {
			support_json_error(403, "forbidden", "Customers create support tickets.");
		}
		$account = (string) ($in["accountId"] ?? "");
		if (!in_array($account, array_column($actor["accounts"], "accountId"), true)) {
			support_json_error(403, "forbidden", "Account access is not permitted.");
		}
		$subject = trim((string) ($in["subject"] ?? ""));
		if ($subject === "" || mb_strlen($subject) > 200) {
			support_json_error(
				422,
				"invalid_subject",
				"Subject must be between 1 and 200 characters.",
			);
		}
		$body = support_assert_body($in);
		$now = support_now();
		$ticket = [
			"id" => support_uuid(),
			"account_id" => $account,
			"subject" => $subject,
			"status" => "open",
			"priority" => "normal",
			"assignee_id" => null,
			"created_at" => $now,
			"updated_at" => $now,
			"created_by" => $actor["userId"],
		];
		$ownsTransaction = !$db->inTransaction();
		if ($ownsTransaction) {
			$db->beginTransaction();
		}
		try {
			$db->prepare("INSERT INTO support_tickets VALUES(?,?,?,?,?,?,?,?,?)")->execute(
				array_values($ticket),
			);
			support_add_participant($db, $ticket["id"], $actor);
			support_add_message($db, $ticket, $actor, $body, "public");
			support_notify($db, $ticket, $actor, "created");
			if ($ownsTransaction) {
				$db->commit();
			}
		} catch (Throwable $e) {
			if ($ownsTransaction && $db->inTransaction()) {
				$db->rollBack();
			}
			throw $e;
		}
		return support_ticket($db, $actor, $ticket["id"]);
	}
	$ticket = support_ticket_row($db, (string) ($in["id"] ?? ""));
	if (!support_can_access($actor, $ticket)) {
		support_json_error(403, "forbidden", "Ticket access is not permitted.");
	}
	if ($action === "attachment") {
		return support_store_attachment($db, $actor, $ticket, $in);
	}
	if (in_array($action, ["reply", "note"], true)) {
		if ($action === "note" && $actor["role"] !== "staff") {
			support_json_error(403, "forbidden", "Only staff can add internal notes.");
		}
		if ($ticket["status"] === "closed") {
			support_json_error(409, "closed", "Closed tickets must be reopened before replying.");
		}
		$body = support_assert_body($in);
		$ownsTransaction = !$db->inTransaction();
		if ($ownsTransaction) {
			$db->beginTransaction();
		}
		try {
			support_add_participant($db, $ticket["id"], $actor);
			support_add_message(
				$db,
				$ticket,
				$actor,
				$body,
				$action === "note" ? "internal" : "public",
			);
			if ($action === "reply") {
				$status = $actor["role"] === "staff" ? "waiting_customer" : "waiting_staff";
				$db->prepare(
					"UPDATE support_tickets SET status=?,updated_at=? WHERE id=?",
				)->execute([$status, support_now(), $ticket["id"]]);
				$ticket = support_ticket_row($db, $ticket["id"]);
				support_notify(
					$db,
					$ticket,
					$actor,
					$actor["role"] === "staff" ? "staff_reply" : "customer_reply",
				);
			}
			if ($ownsTransaction) {
				$db->commit();
			}
		} catch (Throwable $e) {
			if ($ownsTransaction && $db->inTransaction()) {
				$db->rollBack();
			}
			throw $e;
		}
		return support_ticket($db, $actor, $ticket["id"]);
	}
	if (in_array($action, ["status", "assign", "priority"], true)) {
		if (
			$actor["role"] !== "staff" &&
			!($action === "status" && in_array($in["status"] ?? "", ["open", "closed"], true))
		) {
			support_json_error(403, "forbidden", "Staff permission is required.");
		}
		$column = $action === "assign" ? "assignee_id" : $action;
		$value = $in[$action === "assign" ? "assigneeId" : $action] ?? null;
		if (
			$action === "status" &&
			!in_array(
				$value,
				["open", "waiting_staff", "waiting_customer", "resolved", "closed"],
				true,
			)
		) {
			support_json_error(422, "invalid_status", "Unsupported status.");
		}
		if (
			$action === "priority" &&
			!in_array($value, ["low", "normal", "high", "urgent"], true)
		) {
			support_json_error(422, "invalid_priority", "Unsupported priority.");
		}
		if (
			$action === "assign" &&
			$value !== null &&
			!support_valid_staff_assignee($db, (string) $value)
		) {
			support_json_error(
				422,
				"invalid_assignee",
				"Assignee must be an active staff identity.",
			);
		}
		$db->prepare("UPDATE support_tickets SET $column=?,updated_at=? WHERE id=?")->execute([
			$value,
			support_now(),
			$ticket["id"],
		]);
		return support_ticket($db, $actor, $ticket["id"]);
	}
	if ($action === "participants") {
		if ($actor["role"] !== "staff") {
			support_json_error(403, "forbidden", "Staff permission is required.");
		}
		return ["items" => support_participants($db, $ticket["id"])];
	}
	support_json_error(404, "unknown_action", "Unknown support action.");
}

function support_valid_staff_assignee(PDO $db, string $id): bool {
	if (str_starts_with($id, "ceasar:")) {
		$user = substr($id, 7);
		$output = [];
		$code = 1;
		exec(
			"/usr/bin/sudo /usr/local/ceasar/bin/v-list-user " . escapeshellarg($user) . " json",
			$output,
			$code,
		);
		$data = $code === 0 ? json_decode(implode("", $output), true) : null;
		return is_array($data) &&
			($data[$user]["ROLE"] ?? "") === "admin" &&
			($data[$user]["SUSPENDED"] ?? "no") !== "yes";
	}
	$stmt = $db->prepare(
		"SELECT 1 FROM support_participants WHERE user_id=? AND role='staff' LIMIT 1",
	);
	$stmt->execute([$id]);
	return (bool) $stmt->fetchColumn();
}

function support_store_attachment(PDO $db, array $actor, array $ticket, array $in): array {
	if ($ticket["status"] === "closed") {
		support_json_error(
			409,
			"closed",
			"Closed tickets must be reopened before adding attachments.",
		);
	}
	$messageId = (string) ($in["messageId"] ?? "");
	$stmt = $db->prepare(
		"SELECT id,author_id,visibility FROM support_messages WHERE id=? AND ticket_id=?",
	);
	$stmt->execute([$messageId, $ticket["id"]]);
	$message = $stmt->fetch();
	if (
		!$message ||
		($message["visibility"] === "internal" && $actor["role"] !== "staff") ||
		($actor["role"] !== "staff" && $message["author_id"] !== $actor["userId"])
	) {
		support_json_error(403, "forbidden", "Attachment upload is not permitted.");
	}
	$upload = $_FILES["file"] ?? null;
	if (!is_array($upload) || ($upload["error"] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
		support_json_error(422, "invalid_attachment", "A complete attachment upload is required.");
	}
	if (($upload["size"] ?? 0) < 1 || $upload["size"] > 25 * 1024 * 1024) {
		support_json_error(422, "invalid_attachment", "Attachments must be no larger than 25 MiB.");
	}
	$mime = (new finfo(FILEINFO_MIME_TYPE))->file($upload["tmp_name"]);
	$allowed = [
		"application/pdf",
		"image/png",
		"image/jpeg",
		"image/webp",
		"text/plain",
		"application/zip",
	];
	if (!in_array($mime, $allowed, true)) {
		support_json_error(422, "invalid_attachment", "This attachment type is not allowed.");
	}
	if (!support_scan_attachment((string) $upload["tmp_name"])) {
		support_json_error(422, "rejected_attachment", "Attachment scanning rejected this file.");
	}
	$name = basename((string) $upload["name"]);
	$name = preg_replace("/[^A-Za-z0-9._ -]/", "_", $name) ?: "attachment";
	$cfg = support_config();
	if (
		!is_dir($cfg["attachments"]) &&
		!mkdir($cfg["attachments"], 0700, true) &&
		!is_dir($cfg["attachments"])
	) {
		support_json_error(500, "storage_error", "Attachment storage is unavailable.");
	}
	$id = support_uuid();
	$key = $id . ".bin";
	if (!move_uploaded_file($upload["tmp_name"], rtrim($cfg["attachments"], "/") . "/" . $key)) {
		support_json_error(500, "storage_error", "Unable to store attachment.");
	}
	$db->prepare("INSERT INTO support_attachments VALUES(?,?,?,?,?,?,?,?)")->execute([
		$id,
		$ticket["id"],
		$messageId,
		$name,
		$mime,
		(int) $upload["size"],
		$key,
		support_now(),
	]);
	return [
		"id" => $id,
		"filename" => $name,
		"mimeType" => $mime,
		"bytes" => (int) $upload["size"],
	];
}

function support_scan_attachment(string $path): bool {
	$config = support_config();
	$scanner = (string) ($config["attachment_scanner"] ?? "");
	if ($scanner === "") {
		return !($config["attachment_scanner_required"] ?? false);
	}
	if ($scanner !== "clamdscan" || !is_executable("/usr/bin/clamdscan")) {
		return false;
	}
	exec("/usr/bin/clamdscan --fdpass --no-summary " . escapeshellarg($path), $output, $code);
	return $code === 0;
}

function support_staff_action(PDO $db, array $actor, string $action, array $in): array {
	if ($actor["role"] !== "staff") {
		support_json_error(403, "forbidden", "Staff permission is required.");
	}
	if ($action === "settings") {
		if (($_SERVER["REQUEST_METHOD"] ?? "GET") !== "GET") {
			try {
				support_save_settings($db, (array) ($in["settings"] ?? []));
			} catch (InvalidArgumentException $error) {
				support_json_error(422, "invalid_settings", $error->getMessage());
			}
		}
		$settings = support_settings_public($db, support_config());
		$transport = ceasar_system_mail_config();
		$effectiveFrom = (string) ($transport["SERVER_SMTP_ADDR"] ?? "");
		return [
			"settings" => $settings,
			"transport" => [
				"configured" => ($transport["USE_SERVER_SMTP"] ?? "") === "true",
				"fromEmail" => filter_var($effectiveFrom, FILTER_VALIDATE_EMAIL)
					? $effectiveFrom
					: "",
			],
			"imap" => [
				"configured" => !empty($settings["imap"]["host"]),
				"host" => (string) ($settings["imap"]["host"] ?? ""),
			],
		];
	}
	if ($action === "test-smtp") {
		$config = support_effective_config($db);
		$recipient = (string) ($config["staff_recipients"][0] ?? "");
		if (!filter_var($recipient, FILTER_VALIDATE_EMAIL)) {
			support_json_error(
				422,
				"smtp_not_configured",
				"Configure a support recipient before testing SMTP.",
			);
		}
		$result = support_send_mail(
			$recipient,
			"Ceasar support mail test",
			"This is a support mail transport test.",
			$config,
		);
		if (empty($result["accepted"])) {
			support_json_error(
				502,
				"smtp_rejected",
				(string) ($result["error"] ?? "SMTP rejected the test."),
			);
		}
		return ["accepted" => true, "recipient" => $recipient];
	}
	if ($action === "test-imap") {
		$config = support_effective_config($db);
		$imap = $config["imap"] ?? [];
		if (
			empty($imap["host"]) ||
			empty($imap["username"]) ||
			(empty($imap["password"]) && empty($imap["oauth"]))
		) {
			support_json_error(
				422,
				"imap_not_configured",
				"Complete IMAP settings before testing the mailbox.",
			);
		}
		if (!class_exists("Webklex\\PHPIMAP\\ClientManager")) {
			support_json_error(503, "imap_unavailable", "IMAP support is not installed.");
		}
		try {
			$manager = new \Webklex\PHPIMAP\ClientManager();
			$client = $manager->make(support_imap_connection($imap));
			$client->connect();
			$client->disconnect();
			return ["connected" => true];
		} catch (Throwable) {
			support_json_error(502, "imap_rejected", "IMAP connection could not be established.");
		}
	}
	if ($action === "outbox") {
		$page = max(1, (int) ($in["page"] ?? 1));
		$per = min(100, max(1, (int) ($in["perPage"] ?? 25)));
		$where = [];
		$args = [];
		if (!empty($in["ticketId"])) {
			$where[] = "ticket_id=?";
			$args[] = $in["ticketId"];
		}
		if (!empty($in["state"])) {
			$where[] = "state=?";
			$args[] = $in["state"];
		}
		$sql = " FROM support_outbox" . ($where ? " WHERE " . implode(" AND ", $where) : "");
		$count = $db->prepare("SELECT count(*)" . $sql);
		$count->execute($args);
		$total = (int) $count->fetchColumn();
		$q = $db->prepare(
			"SELECT id,ticket_id AS ticketId,recipient,subject,state,attempts,next_attempt_at AS nextAttemptAt,last_error AS lastError,accepted_at AS acceptedAt,created_at AS createdAt" .
				$sql .
				" ORDER BY created_at DESC LIMIT ? OFFSET ?",
		);
		foreach ($args as $i => $v) {
			$q->bindValue($i + 1, $v);
		}
		$q->bindValue(count($args) + 1, $per, PDO::PARAM_INT);
		$q->bindValue(count($args) + 2, ($page - 1) * $per, PDO::PARAM_INT);
		$q->execute();
		return [
			"items" => $q->fetchAll(),
			"page" => $page,
			"perPage" => $per,
			"total" => $total,
			"nextPage" => $page * $per < $total ? $page + 1 : null,
		];
	}
	if ($action === "retry") {
		$id = (string) ($in["notificationId"] ?? "");
		$changed = $db->prepare(
			"UPDATE support_outbox SET state='queued',next_attempt_at=?,updated_at=?,last_error=NULL WHERE id=? AND state IN ('failed','retrying','uncertain')",
		);
		$changed->execute([support_now(), support_now(), $id]);
		return ["retried" => $changed->rowCount() === 1];
	}
	if ($action === "intake") {
		$page = max(1, (int) ($in["page"] ?? 1));
		$per = min(100, max(1, (int) ($in["perPage"] ?? 25)));
		$total = (int) $db->query("SELECT count(*) FROM support_intake")->fetchColumn();
		$q = $db->prepare(
			"SELECT id,message_id AS messageId,sender,subject,body,state,error,created_at AS createdAt FROM support_intake ORDER BY created_at DESC LIMIT ? OFFSET ?",
		);
		$q->bindValue(1, $per, PDO::PARAM_INT);
		$q->bindValue(2, ($page - 1) * $per, PDO::PARAM_INT);
		$q->execute();
		return [
			"items" => $q->fetchAll(),
			"page" => $page,
			"perPage" => $per,
			"total" => $total,
			"nextPage" => $page * $per < $total ? $page + 1 : null,
		];
	}
	if ($action === "attachment-rejections") {
		$id = (string) ($in["id"] ?? "");
		if ($id !== "") {
			support_ticket_row($db, $id);
		}
		$q = $db->prepare(
			"SELECT id,ticket_id AS ticketId,message_id AS messageId,filename,reason,created_at AS createdAt FROM support_attachment_rejections" .
				($id !== "" ? " WHERE ticket_id=?" : "") .
				" ORDER BY created_at DESC",
		);
		$q->execute($id !== "" ? [$id] : []);
		return ["items" => $q->fetchAll()];
	}
	if ($action === "intake-resolve") {
		$intake = $db->prepare("SELECT * FROM support_intake WHERE id=? AND state='pending'");
		$intake->execute([(string) ($in["intakeId"] ?? "")]);
		$intake = $intake->fetch();
		if (!$intake) {
			support_json_error(404, "not_found", "Pending intake message not found.");
		}
		$ticket = support_ticket_row($db, (string) ($in["ticketId"] ?? ""));
		$author = [
			"userId" => "email:" . hash("sha256", $intake["sender"]),
			"email" => $intake["sender"],
			"displayName" => $intake["sender"],
			"role" => "customer",
			"accounts" => [],
		];
		$ownsTransaction = !$db->inTransaction();
		if ($ownsTransaction) {
			$db->beginTransaction();
		}
		try {
			support_add_participant($db, $ticket["id"], $author);
			support_add_message(
				$db,
				$ticket,
				$author,
				$intake["body"],
				"public",
				$intake["message_id"],
			);
			$db->prepare(
				"UPDATE support_tickets SET status='waiting_staff',updated_at=? WHERE id=?",
			)->execute([support_now(), $ticket["id"]]);
			$db->prepare("UPDATE support_intake SET state='attached' WHERE id=?")->execute([
				$intake["id"],
			]);
			if ($ownsTransaction) {
				$db->commit();
			}
		} catch (Throwable $e) {
			if ($ownsTransaction && $db->inTransaction()) {
				$db->rollBack();
			}
			throw $e;
		}
		return support_ticket($db, $actor, $ticket["id"]);
	}
	if ($action === "staff") {
		$q = $db->query(
			"SELECT DISTINCT user_id AS id,email,display_name AS displayName FROM support_participants WHERE role='staff' ORDER BY display_name",
		);
		$items = $q->fetchAll();
		$nativeOutput = [];
		$nativeCode = 1;
		$command = defined("CEASAR_CMD")
			? CEASAR_CMD . "v-list-users json"
			: "/usr/bin/sudo /usr/local/ceasar/bin/v-list-users json";
		if (is_executable("/usr/local/ceasar/bin/v-list-users") || defined("CEASAR_CMD")) {
			exec($command, $nativeOutput, $nativeCode);
		}
		if ($nativeCode === 0) {
			$native = json_decode(implode("", $nativeOutput), true);
			foreach ((array) $native as $username => $record) {
				if (
					!is_array($record) ||
					($record["ROLE"] ?? "") !== "admin" ||
					($record["SUSPENDED"] ?? "no") === "yes"
				) {
					continue;
				}
				$email = (string) ($record["CONTACT"] ?? ($record["EMAIL"] ?? ""));
				if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
					continue;
				}
				$items[] = [
					"id" => "ceasar:" . $username,
					"email" => $email,
					"displayName" => (string) ($record["NAME"] ?? $username),
				];
			}
		}
		$items = array_values(array_column(array_reverse(array_reverse($items)), null, "id"));
		if (!$items) {
			$items[] = [
				"id" => $actor["userId"],
				"email" => $actor["email"],
				"displayName" => $actor["displayName"],
			];
		}
		return ["items" => $items];
	}
	if ($action === "participant-add") {
		$ticket = support_ticket_row($db, (string) ($in["id"] ?? ""));
		$email = trim((string) ($in["email"] ?? ""));
		$name = trim((string) ($in["displayName"] ?? ""));
		if (!filter_var($email, FILTER_VALIDATE_EMAIL) || $name === "" || mb_strlen($name) > 200) {
			support_json_error(
				422,
				"invalid_participant",
				"A valid participant email and display name are required.",
			);
		}
		$participant = [
			"userId" => "email:" . hash("sha256", strtolower($email)),
			"email" => $email,
			"displayName" => $name,
			"role" => "customer",
			"accounts" => [],
		];
		support_add_participant($db, $ticket["id"], $participant);
		return ["items" => support_participants($db, $ticket["id"])];
	}
	if ($action === "participant-remove") {
		$ticket = support_ticket_row($db, (string) ($in["id"] ?? ""));
		$id = (string) ($in["participantId"] ?? "");
		$lookup = $db->prepare(
			"SELECT email,role FROM support_participants WHERE ticket_id=? AND user_id=?",
		);
		$lookup->execute([$ticket["id"], $id]);
		$participant = $lookup->fetch();
		if (!$participant) {
			support_json_error(404, "not_found", "Participant not found.");
		}
		if ($participant["role"] !== "customer") {
			support_json_error(
				422,
				"invalid_participant",
				"Staff participants cannot be removed from a ticket.",
			);
		}
		$db->prepare("DELETE FROM support_participants WHERE ticket_id=? AND user_id=?")->execute([
			$ticket["id"],
			$id,
		]);
		$db->prepare("DELETE FROM support_mail_tokens WHERE ticket_id=? AND recipient=?")->execute([
			$ticket["id"],
			$participant["email"],
		]);
		return ["items" => support_participants($db, $ticket["id"])];
	}
	if ($action === "mark-read") {
		$ticket = support_ticket_row($db, (string) ($in["id"] ?? ""));
		$db->prepare(
			"INSERT INTO support_reads(ticket_id,user_id,read_at) VALUES(?,?,?) ON CONFLICT(ticket_id,user_id) DO UPDATE SET read_at=excluded.read_at",
		)->execute([$ticket["id"], $actor["userId"], support_now()]);
		return ["read" => true];
	}
	support_json_error(404, "unknown_action", "Unknown staff action.");
}

function support_deliver_outbox(?int $limit = null): array {
	$db = support_db();
	$limit = $limit ?? 25;
	// A process can die after SMTP accepted a message but before it records the
	// result. Preserve that ambiguity for staff review, then retry deliberately.
	$db->prepare(
		"UPDATE support_outbox SET state='uncertain',last_error='Worker stopped before delivery outcome was recorded',updated_at=? WHERE state='sending' AND updated_at<?",
	)->execute([support_now(), gmdate("Y-m-d\\TH:i:s\\Z", time() - 600)]);
	$s = $db->prepare(
		"SELECT * FROM support_outbox WHERE state IN ('queued','retrying') AND next_attempt_at<=? ORDER BY created_at LIMIT ?",
	);
	$s->bindValue(1, support_now());
	$s->bindValue(2, $limit, PDO::PARAM_INT);
	$s->execute();
	$result = ["accepted" => 0, "failed" => 0];
	foreach ($s as $item) {
		$db->prepare(
			"UPDATE support_outbox SET state='sending',attempts=attempts+1,updated_at=? WHERE id=?",
		)->execute([support_now(), $item["id"]]);
		$cfg = support_effective_config($db);
		$sent = support_send_mail(
			$item["recipient"],
			$item["subject"],
			$item["body"],
			$cfg,
			(string) ($item["reply_to"] ?? ""),
		);
		if ($sent["accepted"]) {
			$db->prepare(
				"UPDATE support_outbox SET state='accepted',accepted_at=?,updated_at=?,last_error=NULL WHERE id=?",
			)->execute([support_now(), support_now(), $item["id"]]);
			$result["accepted"]++;
		} else {
			$attempts = (int) $item["attempts"] + 1;
			$state = $attempts >= 8 ? "failed" : "retrying";
			$next = gmdate("Y-m-d\\TH:i:s\\Z", time() + min(3600, 60 * 2 ** min(6, $attempts)));
			$db->prepare(
				"UPDATE support_outbox SET state=?,next_attempt_at=?,last_error=?,updated_at=? WHERE id=?",
			)->execute([$state, $next, $sent["error"], support_now(), $item["id"]]);
			$result["failed"]++;
		}
	}
	return $result;
}
function support_send_mail(
	string $to,
	string $subject,
	string $body,
	array $cfg,
	string $replyTo = "",
): array {
	try {
		if (
			isset($GLOBALS["ceasar_support_mailer_for_test"]) &&
			is_callable($GLOBALS["ceasar_support_mailer_for_test"])
		) {
			$result = $GLOBALS["ceasar_support_mailer_for_test"](
				$to,
				$subject,
				$body,
				$cfg,
				$replyTo,
			);
			return is_array($result)
				? $result
				: [
					"accepted" => $result === true,
					"uncertain" => false,
					"error" => $result === true ? null : "Test transport rejected the message.",
				];
		}
		return ceasar_send_email_result(
			$to,
			$subject,
			$body,
			$cfg["from_email"] ?: "noreply@localhost",
			$cfg["from_name"],
			"",
			$replyTo,
			["Auto-Submitted" => "auto-generated", "X-Auto-Response-Suppress" => "All"],
			ceasar_system_mail_config(),
		);
	} catch (Throwable $e) {
		return [
			"accepted" => false,
			"uncertain" => false,
			"error" => substr($e->getMessage(), 0, 500),
		];
	}
}

/** Import IMAP mail only when the maintained Webklex dependency is installed. */
function support_import_inbound(): array {
	$config = support_effective_config(support_db());
	$imap = $config["imap"] ?? [];
	$isOauth = ($imap["authentication"] ?? "") === "oauth2";
	if (
		empty($imap["host"]) ||
		empty($imap["username"]) ||
		(!$isOauth && empty($imap["password"])) ||
		($isOauth && empty(($imap["oauth"] ?? [])["client_id"]))
	) {
		return [
			"imported" => 0,
			"intake" => 0,
			"skipped" => 0,
			"reason" => "IMAP is not configured",
		];
	}
	if (!class_exists("Webklex\\PHPIMAP\\ClientManager")) {
		throw new RuntimeException("Webklex PHP-IMAP is not installed.");
	}
	$connection = support_imap_connection($imap);
	$manager = new \Webklex\PHPIMAP\ClientManager();
	$client = $manager->make($connection);
	$client->connect();
	$folder = $client->getFolder($imap["folder"] ?? "INBOX");
	$messages = $folder->messages()->unseen()->get();
	$result = ["imported" => 0, "intake" => 0, "skipped" => 0];
	foreach ($messages as $mail) {
		$messageId = trim((string) ($mail->getMessageId() ?? ""));
		$sender = (string) ($mail->getFrom()->first()?->mail ?? "");
		$recipient = (string) ($mail->getTo()->first()?->mail ?? "");
		$subject = trim((string) ($mail->getSubject() ?? ""));
		$body = trim((string) ($mail->getTextBody() ?: $mail->getHTMLBody()));
		$header = method_exists($mail, "getHeader") ? $mail->getHeader() : null;
		$autoSubmitted =
			$header && method_exists($header, "has") && $header->has("auto-submitted")
				? strtolower(trim((string) $header->get("auto-submitted")->get()))
				: "";
		$precedence =
			$header && method_exists($header, "has") && $header->has("precedence")
				? strtolower(trim((string) $header->get("precedence")->get()))
				: "";
		$autoSuppress =
			$header && method_exists($header, "has") && $header->has("x-auto-response-suppress");
		if (
			($autoSubmitted !== "" && $autoSubmitted !== "no") ||
			$precedence === "bulk" ||
			$autoSuppress
		) {
			$mail->setFlag(["Seen"]);
			$result["skipped"]++;
			continue;
		}
		if (
			preg_match(
				"/\b(automatic reply|auto.?reply|out of office|vacation responder)\b/i",
				$subject,
			)
		) {
			$mail->setFlag(["Seen"]);
			$result["skipped"]++;
			continue;
		}
		if (!filter_var($sender, FILTER_VALIDATE_EMAIL) || $body === "") {
			$db = support_db();
			$db->prepare(
				"INSERT OR IGNORE INTO support_intake(id,message_id,sender,subject,body,state,error,created_at) VALUES(?,?,?,?,?,'pending',?,?)",
			)->execute([
				support_uuid(),
				$messageId ?: hash("sha256", $sender . "|" . $subject . "|" . $body),
				mb_substr($sender ?: "unknown", 0, 254),
				mb_substr($subject, 0, 200),
				mb_substr($body, 0, 20000),
				"Malformed inbound message",
				support_now(),
			]);
			$mail->setFlag(["Seen"]);
			$result["skipped"]++;
			continue;
		}
		$routed = support_import_inbound_message(
			$messageId ?: hash("sha256", $sender . "|" . $subject . "|" . $body),
			$sender,
			$recipient,
			$subject,
			$body,
		);
		if ($routed && method_exists($mail, "getAttachments")) {
			$row = support_db()->prepare(
				"SELECT ticket_id,id FROM support_messages WHERE inbound_key=?",
			);
			$row->execute([$messageId ?: hash("sha256", $sender . "|" . $subject . "|" . $body)]);
			$message = $row->fetch();
			if ($message) {
				foreach ($mail->getAttachments() as $attachment) {
					try {
						support_store_inbound_attachment(
							support_db(),
							$message["ticket_id"],
							$message["id"],
							$attachment,
						);
					} catch (Throwable $e) {
						$name = method_exists($attachment, "getName")
							? (string) $attachment->getName()
							: "attachment";
						$db = support_db();
						$reason = mb_substr($e->getMessage(), 0, 500);
						$db->prepare(
							"INSERT OR IGNORE INTO support_attachment_rejections(id,ticket_id,message_id,filename,reason,created_at) VALUES(?,?,?,?,?,?)",
						)->execute([
							hash("sha256", $message["id"] . "|" . $name . "|" . $reason),
							$message["ticket_id"],
							$message["id"],
							mb_substr(basename($name), 0, 255),
							$reason,
							support_now(),
						]);
					}
				}
			}
		}
		$mail->setFlag(["Seen"]);
		$result[$routed ? "imported" : "intake"]++;
	}
	return $result;
}

function support_imap_connection(array $imap): array {
	$connection = [
		"host" => $imap["host"],
		"port" => (int) ($imap["port"] ?? 993),
		"encryption" => $imap["encryption"] ?? "ssl",
		"validate_cert" => $imap["validate_cert"] ?? true,
		"protocol" => "imap",
		"username" => $imap["username"],
	];
	if (($imap["authentication"] ?? "") === "oauth2") {
		$token = support_m365_access_token((array) ($imap["oauth"] ?? []));
		$connection["authentication"] = "oauth";
		$connection["oauth"] = ["access_token" => $token];
		$connection["password"] = $token;
	} else {
		$connection["password"] = $imap["password"] ?? "";
	}
	return $connection;
}

function support_store_inbound_attachment(
	PDO $db,
	string $ticketId,
	string $messageId,
	object $attachment,
): void {
	$attributes = method_exists($attachment, "getAttributes") ? $attachment->getAttributes() : [];
	$name = (string) ($attributes["filename"] ?? ($attributes["name"] ?? "attachment"));
	$content = (string) ($attributes["content"] ?? "");
	if ($content === "") {
		throw new RuntimeException("Attachment has no content.");
	}
	if (strlen($content) > 25 * 1024 * 1024) {
		throw new RuntimeException("Attachment exceeds 25 MB.");
	}
	$mime = (new finfo(FILEINFO_MIME_TYPE))->buffer($content);
	if (
		!in_array(
			$mime,
			[
				"application/pdf",
				"image/png",
				"image/jpeg",
				"image/webp",
				"text/plain",
				"application/zip",
			],
			true,
		)
	) {
		throw new RuntimeException("Attachment type is not permitted.");
	}
	$tmp = tempnam(sys_get_temp_dir(), "ceasar-support-");
	if (!$tmp) {
		throw new RuntimeException("Unable to stage attachment.");
	}
	try {
		file_put_contents($tmp, $content);
		if (!support_scan_attachment($tmp)) {
			throw new RuntimeException("Attachment scanner rejected the file.");
		}
		$cfg = support_effective_config($db);
		if (
			!is_dir($cfg["attachments"]) &&
			!mkdir($cfg["attachments"], 0700, true) &&
			!is_dir($cfg["attachments"])
		) {
			throw new RuntimeException("Unable to create protected attachment storage.");
		}
		$safe = preg_replace("/[^A-Za-z0-9._ -]/", "_", basename($name)) ?: "attachment";
		// Stable identifiers make an IMAP restart after message insertion safe.
		$id = hash(
			"sha256",
			$ticketId . "|" . $messageId . "|" . $safe . "|" . hash("sha256", $content),
		);
		$key = $id . ".bin";
		$exists = $db->prepare("SELECT 1 FROM support_attachments WHERE id=?");
		$exists->execute([$id]);
		if ($exists->fetchColumn()) {
			return;
		}
		if (
			file_put_contents(rtrim($cfg["attachments"], "/") . "/" . $key, $content, LOCK_EX) ===
			false
		) {
			throw new RuntimeException("Unable to store protected attachment.");
		}
		$db->prepare("INSERT INTO support_attachments VALUES(?,?,?,?,?,?,?,?)")->execute([
			$id,
			$ticketId,
			$messageId,
			$safe,
			$mime,
			strlen($content),
			$key,
			support_now(),
		]);
	} finally {
		@unlink($tmp);
	}
}

function support_m365_access_token(array $oauth): string {
	foreach (["tenant", "client_id", "client_secret"] as $key) {
		if (empty($oauth[$key])) {
			throw new RuntimeException("Microsoft 365 OAuth configuration is incomplete.");
		}
	}
	$url =
		"https://login.microsoftonline.com/" .
		rawurlencode((string) $oauth["tenant"]) .
		"/oauth2/v2.0/token";
	$grant =
		(string) ($oauth["grant_type"] ??
			(empty($oauth["refresh_token"]) ? "client_credentials" : "refresh_token"));
	if (!in_array($grant, ["client_credentials", "refresh_token"], true)) {
		throw new RuntimeException("Unsupported Microsoft 365 OAuth grant.");
	}
	if ($grant === "refresh_token" && empty($oauth["refresh_token"])) {
		throw new RuntimeException("Microsoft 365 refresh token is required for delegated OAuth.");
	}
	$body = http_build_query([
		"client_id" => $oauth["client_id"],
		"client_secret" => $oauth["client_secret"],
		...$grant === "refresh_token" ? ["refresh_token" => $oauth["refresh_token"]] : [],
		"grant_type" => $grant,
		"scope" =>
			$oauth["scope"] ??
			($grant === "client_credentials"
				? "https://outlook.office365.com/.default"
				: "https://outlook.office.com/IMAP.AccessAsUser.All offline_access"),
	]);
	$context = stream_context_create([
		"http" => [
			"method" => "POST",
			"header" =>
				"Content-Type: application/x-www-form-urlencoded\r\nContent-Length: " .
				strlen($body) .
				"\r\n",
			"content" => $body,
			"timeout" => 15,
			"ignore_errors" => true,
		],
	]);
	$response = @file_get_contents($url, false, $context);
	$data = is_string($response) ? json_decode($response, true) : null;
	if (!is_array($data) || empty($data["access_token"])) {
		throw new RuntimeException("Microsoft 365 OAuth token refresh failed.");
	}
	return (string) $data["access_token"];
}

/** Match a recipient-specific opaque Reply-To token; ambiguous mail remains staff intake. */
function support_import_inbound_message(
	string $messageId,
	string $sender,
	string $recipient,
	string $subject,
	string $body,
): bool {
	$db = support_db();
	$local = strtolower((string) strtok($recipient, "@"));
	$token = "";
	if (str_contains($local, "+")) {
		$token = substr($local, strrpos($local, "+") + 1);
	}
	$lookup = $db->prepare("SELECT * FROM support_mail_tokens WHERE token=? AND recipient=?");
	$lookup->execute([$token, $sender]);
	$match = $lookup->fetch();
	if ($match) {
		$ticket = support_ticket_row($db, $match["ticket_id"]);
		$existing = $db->prepare("SELECT 1 FROM support_messages WHERE inbound_key=?");
		$existing->execute([$messageId]);
		if ($existing->fetchColumn()) {
			return true;
		}
		// Email does not silently reopen a deliberately closed ticket. Staff can
		// attach the held intake after explicitly reopening it.
		if ($ticket["status"] === "closed") {
			$match = false;
		}
	}
	if ($match) {
		$ticket = support_ticket_row($db, $match["ticket_id"]);
		$known = $db->prepare(
			"SELECT user_id,email,display_name,role FROM support_participants WHERE ticket_id=? AND lower(email)=lower(?) LIMIT 1",
		);
		$known->execute([$ticket["id"], $sender]);
		$participant = $known->fetch();
		$author = $participant
			? [
				"userId" => $participant["user_id"],
				"email" => $participant["email"],
				"displayName" => $participant["display_name"],
				"role" => $participant["role"],
				"accounts" => [],
			]
			: [
				"userId" => "email:" . hash("sha256", strtolower($sender)),
				"email" => $sender,
				"displayName" => $sender,
				// A reply token is addressed to exactly one recipient. A configured staff
				// mailbox using that token remains staff even before it has joined a ticket.
				"role" => in_array(
					strtolower($sender),
					array_map(
						"strtolower",
						(array) (support_effective_config($db)["staff_recipients"] ?? []),
					),
					true,
				)
					? "staff"
					: "customer",
				"accounts" => [],
			];
		$ownsTransaction = !$db->inTransaction();
		if ($ownsTransaction) {
			$db->beginTransaction();
		}
		try {
			support_add_participant($db, $ticket["id"], $author);
			support_add_message(
				$db,
				$ticket,
				$author,
				mb_substr($body, 0, 20000),
				"public",
				$messageId,
			);
			$status = $author["role"] === "staff" ? "waiting_customer" : "waiting_staff";
			$db->prepare("UPDATE support_tickets SET status=?,updated_at=? WHERE id=?")->execute([
				$status,
				support_now(),
				$ticket["id"],
			]);
			$ticket = support_ticket_row($db, $ticket["id"]);
			support_notify(
				$db,
				$ticket,
				$author,
				$author["role"] === "staff" ? "staff_reply" : "customer_reply",
			);
			if ($ownsTransaction) {
				$db->commit();
			}
			return true;
		} catch (Throwable $e) {
			if ($ownsTransaction && $db->inTransaction()) {
				$db->rollBack();
			}
			throw $e;
		}
	}
	$s = $db->prepare(
		"INSERT OR IGNORE INTO support_intake(id,message_id,sender,subject,body,state,created_at) VALUES(?,?,?,?,?,'pending',?)",
	);
	$s->execute([
		support_uuid(),
		$messageId,
		$sender,
		mb_substr($subject, 0, 200),
		mb_substr($body, 0, 20000),
		support_now(),
	]);
	return false;
}

/** Stream-safe JSON export used by backups; it never creates notification work. */
function support_export(): array {
	$db = support_db();
	$tables = [
		"support_tickets",
		"support_participants",
		"support_messages",
		"support_attachments",
		"support_outbox",
		"support_intake",
		"support_attachment_rejections",
		"support_settings",
		"support_reads",
		"support_mail_tokens",
		"support_audit",
		"support_idempotency",
	];
	$out = ["schema" => 1, "exportedAt" => support_now(), "tables" => []];
	foreach ($tables as $table) {
		$out["tables"][$table] = $db->query("SELECT * FROM $table")->fetchAll();
	}
	return $out;
}
function support_import(array $archive): array {
	if (($archive["schema"] ?? null) !== 1 || !is_array($archive["tables"] ?? null)) {
		throw new InvalidArgumentException("Unsupported support archive.");
	}
	$db = support_db();
	$tables = [
		"support_tickets",
		"support_participants",
		"support_messages",
		"support_attachments",
		"support_outbox",
		"support_intake",
		"support_attachment_rejections",
		"support_settings",
		"support_reads",
		"support_mail_tokens",
		"support_audit",
		"support_idempotency",
	];
	$db->beginTransaction();
	try {
		foreach ($tables as $table) {
			foreach ($archive["tables"][$table] ?? [] as $row) {
				if (!is_array($row)) {
					throw new InvalidArgumentException("Invalid support archive row.");
				}
				$columns = array_keys($row);
				$sql =
					"INSERT OR IGNORE INTO $table(" .
					implode(",", $columns) .
					") VALUES(" .
					implode(",", array_fill(0, count($columns), "?")) .
					")";
				$db->prepare($sql)->execute(array_values($row));
			}
		}
		$db->commit();
	} catch (Throwable $e) {
		$db->rollBack();
		throw $e;
	}
	return ["imported" => true];
}
