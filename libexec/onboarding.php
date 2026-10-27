<?php
declare(strict_types=1);

// The public onboarding contract. The API command and native session endpoint
// both enter here; neither may pass executable commands or filesystem paths.
const ONBOARDING_DB = "/var/lib/ceasar/onboarding/operations.sqlite";
const ONBOARDING_BIN = "/usr/local/ceasar/bin/";

function onboarding_require_root(?int $effectiveUid = null): void {
	$effectiveUid ??= function_exists("posix_geteuid") ? posix_geteuid() : -1;
	if ($effectiveUid !== 0) {
		throw new RuntimeException("Onboarding commands require privileged execution.");
	}
}

function onboarding_db(): PDO {
	$path = getenv("CEASAR_ONBOARDING_DB") ?: ONBOARDING_DB;
	$db = new PDO("sqlite:" . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
	$db->exec("PRAGMA busy_timeout = 5000");
	$db->exec("PRAGMA journal_mode = WAL");
	$db->exec('CREATE TABLE IF NOT EXISTS operations (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, idempotency_key TEXT NOT NULL,
        hostname TEXT NOT NULL, site_type TEXT NOT NULL, intent TEXT NOT NULL,
        site_title TEXT NOT NULL, contact_email TEXT NOT NULL,
        status TEXT NOT NULL, stage TEXT NOT NULL, message TEXT NOT NULL,
        next_action TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        UNIQUE(owner, idempotency_key)
    )');
	$db->exec('CREATE TABLE IF NOT EXISTS access_grants (
        token_hash TEXT PRIMARY KEY, owner TEXT NOT NULL, hostname TEXT NOT NULL,
        destination TEXT NOT NULL, panel_origin TEXT NOT NULL, source_origin TEXT NOT NULL,
        expires_at INTEGER NOT NULL, consumed_at INTEGER
    )');
	$db->exec('CREATE TABLE IF NOT EXISTS domains (
        owner TEXT NOT NULL, hostname TEXT NOT NULL, domain TEXT NOT NULL,
        status TEXT NOT NULL, previous_url TEXT, previous_siteurl TEXT,
        backup_path TEXT, updated_at INTEGER NOT NULL,
        PRIMARY KEY(owner, hostname, domain)
    )');
	$domainColumns = $db->query("PRAGMA table_info(domains)")->fetchAll(PDO::FETCH_COLUMN, 1);
	if (!in_array("previous_siteurl", $domainColumns, true)) {
		$db->exec("ALTER TABLE domains ADD COLUMN previous_siteurl TEXT");
	}
	$db->exec('CREATE TABLE IF NOT EXISTS drafts (
        owner TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at INTEGER NOT NULL
    )');
	$db->exec('CREATE TABLE IF NOT EXISTS domain_verifications (
        owner TEXT NOT NULL, hostname TEXT NOT NULL, domain TEXT NOT NULL,
        challenge TEXT NOT NULL, created_at INTEGER NOT NULL,
        PRIMARY KEY(owner,hostname,domain)
    )');
	return $db;
}

function onboarding_host(mixed $value): string {
	if (
		!is_string($value) ||
		strlen($value) > 253 ||
		preg_match(
			'/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/D',
			strtolower($value),
		) !== 1
	) {
		throw new InvalidArgumentException("A valid DNS hostname is required.");
	}
	return strtolower($value);
}

function onboarding_user(mixed $value): string {
	if (!is_string($value) || preg_match('/^[a-z0-9][a-z0-9_-]{0,31}$/D', $value) !== 1) {
		throw new InvalidArgumentException("Invalid Ceasar user.");
	}
	return $value;
}

function onboarding_run(array $args, int $seconds = 30): array {
	$command = ["/usr/bin/timeout", "--signal=TERM", "--kill-after=5", (string) $seconds, ...$args];
	$spec = [0 => ["pipe", "r"], 1 => ["pipe", "w"], 2 => ["pipe", "w"]];
	$process = proc_open($command, $spec, $pipes);
	if (!is_resource($process)) {
		throw new RuntimeException("Native command unavailable.");
	}
	fclose($pipes[0]);
	stream_set_blocking($pipes[1], false);
	stream_set_blocking($pipes[2], false);
	$out = "";
	$err = "";
	while (!feof($pipes[1]) || !feof($pipes[2])) {
		$reads = [];
		if (!feof($pipes[1])) {
			$reads[] = $pipes[1];
		}
		if (!feof($pipes[2])) {
			$reads[] = $pipes[2];
		}
		if (!$reads) {
			break;
		}
		$write = null;
		$except = null;
		$ready = stream_select($reads, $write, $except, 1);
		if ($ready === false) {
			break;
		}
		foreach ($reads as $pipe) {
			$chunk = fread($pipe, 8192);
			if ($chunk === false || $chunk === "") {
				continue;
			}
			if ($pipe === $pipes[1]) {
				$out = substr($out . $chunk, 0, 1048576);
			} else {
				$err = substr($err . $chunk, 0, 8192);
			}
		}
	}
	fclose($pipes[1]);
	fclose($pipes[2]);
	$exit = proc_close($process);
	return ["ok" => $exit === 0, "output" => (string) $out, "error" => (string) $err];
}

function onboarding_native(string $command, array $args, int $seconds = 30): array {
	$allowed = [
		"v-list-user",
		"v-list-web-domains",
		"v-add-web-domain",
		"v-quick-install-app",
		"v-change-web-domain-backend-tpl",
		"v-add-web-domain-alias",
		"v-add-letsencrypt-domain",
		"v-add-user-wp-cli",
	];
	if (!in_array($command, $allowed, true)) {
		throw new LogicException("Command unavailable.");
	}
	if ($command === "v-quick-install-app") {
		return onboarding_tenant_run(
			onboarding_user((string) ($args[1] ?? "")),
			[ONBOARDING_BIN . $command, ...$args],
			$seconds,
			false,
		);
	}
	return onboarding_run([ONBOARDING_BIN . $command, ...$args], $seconds);
}

function onboarding_tenant_command(string $user, array $args, int $seconds, bool $asUser): array {
	$account = posix_getpwnam($user);
	if (!is_array($account) || !isset($account["uid"]) || (int) $account["uid"] < 1000) {
		throw new RuntimeException("Website owner is unavailable for isolated execution.");
	}
	return [
		"/usr/bin/systemd-run",
		"--wait",
		"--pipe",
		"--collect",
		"--quiet",
		"--description=Ceasar website operation",
		"--property=Slice=user-" . (int) $account["uid"] . ".slice",
		"--property=RuntimeMaxSec=" . ($seconds + 5),
		"--property=KillMode=control-group",
		"--property=User=" . ($asUser ? $user : "root"),
		"--",
		...$args,
	];
}

function onboarding_tenant_run(
	string $user,
	array $args,
	int $seconds,
	bool $asUser = true,
): array {
	if (getenv("CEASAR_ONBOARDING_FIXTURE") === "1" && getenv("CEASAR_ONBOARDING_DB")) {
		return onboarding_run($args, $seconds);
	}
	return onboarding_run(
		onboarding_tenant_command($user, $args, $seconds, $asUser),
		$seconds + 10,
	);
}

function onboarding_owner(string $user): array {
	$result = onboarding_native("v-list-user", [$user, "json"]);
	$data = $result["ok"] ? json_decode($result["output"], true) : null;
	if (!is_array($data) || !isset($data[$user]) || ($data[$user]["SUSPENDED"] ?? "no") === "yes") {
		throw new RuntimeException("The hosting account is unavailable.");
	}
	return $data[$user];
}

function onboarding_site(string $user, string $host): ?array {
	$result = onboarding_native("v-list-web-domains", [$user, "json"]);
	if (!$result["ok"]) {
		throw new RuntimeException("We couldn't load your website. Try again or contact support.");
	}
	$data = json_decode($result["output"], true);
	if (!is_array($data) || (array_is_list($data) && $data !== [])) {
		throw new RuntimeException("We couldn't load your website. Try again or contact support.");
	}
	$site = $data[$host] ?? null;
	if ($site !== null && (!is_array($site) || ($site["SUSPENDED"] ?? "no") === "yes")) {
		throw new RuntimeException("Website unavailable.");
	}
	return $site;
}

function onboarding_row(PDO $db, string $user, string $id): array {
	$query = $db->prepare("SELECT * FROM operations WHERE owner = ? AND id = ?");
	$query->execute([$user, $id]);
	$row = $query->fetch(PDO::FETCH_ASSOC);
	if (!$row) {
		throw new RuntimeException("Setup operation not found.");
	}
	return $row;
}

function onboarding_progress(array $row): array {
	return [
		"operationId" => $row["id"],
		"hostname" => $row["hostname"],
		"siteType" => $row["site_type"],
		"intent" => $row["intent"],
		"status" => $row["status"],
		"stage" => $row["stage"],
		"message" => $row["message"],
		"nextAction" => $row["next_action"],
	];
}

function onboarding_origin(mixed $value): string {
	if (!is_string($value) || strlen($value) > 253) {
		throw new InvalidArgumentException("Invalid origin.");
	}
	$parts = parse_url($value);
	if (
		!is_array($parts) ||
		($parts["scheme"] ?? "") !== "https" ||
		empty($parts["host"]) ||
		isset($parts["user"]) ||
		isset($parts["pass"]) ||
		isset($parts["path"]) ||
		isset($parts["query"]) ||
		isset($parts["fragment"]) ||
		$value !== "https://" . $parts["host"] . (isset($parts["port"]) ? ":" . $parts["port"] : "")
	) {
		throw new InvalidArgumentException("Invalid origin.");
	}
	return $value;
}

function onboarding_public_addresses(array $site): array {
	$path = "/usr/local/ceasar/conf/onboarding.json";
	$config = is_file($path) ? json_decode((string) file_get_contents($path), true, 8) : [];
	$configured = is_array($config) ? $config["public_address"] ?? "" : "";
	if (
		$configured !== "" &&
		(!is_string($configured) ||
			!filter_var(
				$configured,
				FILTER_VALIDATE_IP,
				FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE,
			))
	) {
		throw new RuntimeException("Configured public website address is invalid.");
	}
	if ($configured !== "") {
		return [$configured];
	}
	$addresses = [];
	foreach (["IP", "IP6"] as $field) {
		$address = (string) ($site[$field] ?? "");
		if (
			$address !== "" &&
			filter_var(
				$address,
				FILTER_VALIDATE_IP,
				FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE,
			)
		) {
			$addresses[] = $address;
		}
	}
	if ($addresses === []) {
		throw new RuntimeException("A public website address is not configured.");
	}
	return $addresses;
}

function onboarding_panel_config(): array {
	$path = "/usr/local/ceasar/conf/onboarding.json";
	if (!is_file($path)) {
		throw new RuntimeException("Panel access origin is not configured.");
	}
	$data = json_decode((string) file_get_contents($path), true, 8, JSON_THROW_ON_ERROR);
	if (!is_array($data)) {
		throw new RuntimeException("Panel access origin is invalid.");
	}
	$panel = onboarding_origin($data["panel_origin"] ?? null);
	$sources = $data["grant_origins"] ?? [$panel];
	if (!is_array($sources) || !array_is_list($sources)) {
		throw new RuntimeException("Grant origins are invalid.");
	}
	foreach ($sources as $source) {
		onboarding_origin($source);
	}
	if (!in_array($panel, $sources, true)) {
		$sources[] = $panel;
	}
	return ["panel_origin" => $panel, "grant_origins" => $sources];
}

function onboarding_dispatch(string $user, string $action, array $input): array {
	onboarding_require_root();
	$user = onboarding_user($user);
	onboarding_owner($user);
	$db = onboarding_db();
	if ($action === "read-draft") {
		$query = $db->prepare("SELECT body FROM drafts WHERE owner=?");
		$query->execute([$user]);
		$body = $query->fetchColumn();
		return [
			"draft" =>
				$body === false ? null : json_decode((string) $body, true, 16, JSON_THROW_ON_ERROR),
			"capabilities" => [
				"setupMethods" => ["wordpress-new", "wordpress-move", "php-import", "php-static"],
				"wordpressMigration" => "wpvivid",
				"domainConnection" => true,
			],
		];
	}
	if ($action === "save-draft") {
		$draft = $input["draft"] ?? null;
		$allowed = [
			"step",
			"setupKind",
			"intent",
			"siteType",
			"planCode",
			"setupMode",
			"websiteTitle",
			"administratorEmail",
			"importedAdministrator",
			"domain",
			"hostname",
			"serviceId",
			"requestId",
			"updatedAt",
		];
		if (
			!is_array($draft) ||
			array_is_list($draft) ||
			array_diff(array_keys($draft), $allowed)
		) {
			throw new InvalidArgumentException("Invalid draft.");
		}
		foreach ($draft as $field => $value) {
			if ($value === null && in_array($field, ["requestId", "serviceId"], true)) {
				continue;
			}
			if (!is_string($value) || strlen($value) > 512) {
				throw new InvalidArgumentException("Invalid draft field.");
			}
		}
		$db->exec("BEGIN IMMEDIATE");
		try {
			$query = $db->prepare("SELECT body FROM drafts WHERE owner=?");
			$query->execute([$user]);
			$existingBody = $query->fetchColumn();
			$existing =
				$existingBody === false
					? []
					: json_decode((string) $existingBody, true, 16, JSON_THROW_ON_ERROR);
			$bound = (string) ($existing["requestId"] ?? "");
			$reset =
				($draft["step"] ?? null) === "website" &&
				($draft["requestId"] ?? "") === "" &&
				($draft["serviceId"] ?? "") === "";
			if (
				$bound !== "" &&
				!$reset &&
				(($draft["requestId"] ?? "") === "" || ($draft["serviceId"] ?? "") === "")
			) {
				throw new RuntimeException("Reload website setup before changing a prepared site.");
			}
			$body = json_encode($draft, JSON_THROW_ON_ERROR);
			$db->prepare(
				"INSERT INTO drafts(owner,body,updated_at) VALUES (?,?,?) ON CONFLICT(owner) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at",
			)->execute([$user, $body, time()]);
			$db->exec("COMMIT");
		} catch (Throwable $error) {
			$db->exec("ROLLBACK");
			throw $error;
		}
		return ["draft" => $draft];
	}
	if ($action === "prepare") {
		$key = $input["idempotencyKey"] ?? null;
		$host = onboarding_host($input["hostname"] ?? null);
		$type = $input["siteType"] ?? null;
		$intent = $input["intent"] ?? null;
		$title = $input["siteTitle"] ?? "";
		$email = $input["contactEmail"] ?? "";
		if (
			!is_string($key) ||
			preg_match('/^[A-Za-z0-9_-]{8,80}$/D', $key) !== 1 ||
			!in_array($type, ["wordpress", "php", "static"], true) ||
			!in_array($intent, ["new_site", "migration"], true) ||
			!is_string($title) ||
			strlen($title) > 160 ||
			!is_string($email) ||
			filter_var($email, FILTER_VALIDATE_EMAIL) === false
		) {
			throw new InvalidArgumentException("Invalid setup request.");
		}
		$id = bin2hex(random_bytes(16));
		$now = time();
		$db->exec("BEGIN IMMEDIATE");
		try {
			$query = $db->prepare("INSERT OR IGNORE INTO operations
          (id,owner,idempotency_key,hostname,site_type,intent,site_title,contact_email,status,stage,message,next_action,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?, 'queued','admission','Preparing your website.','wait',?,?)");
			$query->execute([$id, $user, $key, $host, $type, $intent, $title, $email, $now, $now]);
			$lookup = $db->prepare("SELECT * FROM operations WHERE owner=? AND idempotency_key=?");
			$lookup->execute([$user, $key]);
			$row = $lookup->fetch(PDO::FETCH_ASSOC);
			if (
				!$row ||
				$row["hostname"] !== $host ||
				$row["site_type"] !== $type ||
				$row["intent"] !== $intent
			) {
				throw new RuntimeException("Idempotency key already used for another setup.");
			}
			$draftQuery = $db->prepare("SELECT body FROM drafts WHERE owner=?");
			$draftQuery->execute([$user]);
			$draftBody = $draftQuery->fetchColumn();
			$current =
				$draftBody === false
					? []
					: json_decode((string) $draftBody, true, 16, JSON_THROW_ON_ERROR);
			$currentRequest = (string) ($current["requestId"] ?? "");
			if ($currentRequest === "" || $currentRequest === $row["id"]) {
				$same = $currentRequest === $row["id"];
				$kind =
					$type === "wordpress"
						? ($intent === "migration"
							? "wordpress-move"
							: "wordpress-new")
						: ($intent === "migration"
							? "php-import"
							: "php-static");
				$draft = $same ? $current : [];
				$draft["step"] =
					$same &&
					in_array($current["step"] ?? null, ["website-setup", "domain", "ready"], true)
						? $current["step"]
						: "preparation";
				$draft["setupKind"] = $kind;
				$draft["siteType"] = $type;
				$draft["intent"] = $intent;
				$draft["hostname"] = $host;
				$draft["serviceId"] = $host;
				$draft["requestId"] = $row["id"];
				$draft["websiteTitle"] = $row["site_title"];
				$draft["administratorEmail"] = $row["contact_email"];
				$db->prepare(
					"INSERT INTO drafts(owner,body,updated_at) VALUES (?,?,?) ON CONFLICT(owner) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at",
				)->execute([$user, json_encode($draft, JSON_THROW_ON_ERROR), $now]);
			}
			$db->exec("COMMIT");
		} catch (Throwable $error) {
			$db->exec("ROLLBACK");
			throw $error;
		}
		return onboarding_progress($row);
	}
	$id = $input["operationId"] ?? null;
	if ($action === "status" && is_string($id)) {
		return onboarding_progress(onboarding_row($db, $user, $id));
	}
	if ($action === "retry" && is_string($id)) {
		$row = onboarding_row($db, $user, $id);
		if ($row["status"] !== "failed" || $row["stage"] === "wordpress_partial") {
			throw new RuntimeException("This setup cannot be retried automatically.");
		}
		$db->prepare(
			"UPDATE operations SET status='queued',stage='retry',message='Retrying website preparation.',next_action='wait',updated_at=? WHERE id=? AND owner=?",
		)->execute([time(), $id, $user]);
		return onboarding_progress(onboarding_row($db, $user, $id));
	}
	if ($action === "domain-status" || $action === "connect-domain") {
		$host = onboarding_host($input["hostname"] ?? null);
		$domain = onboarding_host($input["domain"] ?? null);
		$site = onboarding_site($user, $host);
		if ($site === null) {
			throw new RuntimeException("Website unavailable.");
		}
		$view = onboarding_domain($db, $user, $host, $domain, $site, false);
		if ($action === "connect-domain" && $view["status"] === "connected") {
			return $view;
		}
		if ($action === "connect-domain" && $view["dnsReady"] && $view["ownershipReady"]) {
			$db->prepare(
				"INSERT INTO domains(owner,hostname,domain,status,updated_at) VALUES (?,?,?,?,?)
              ON CONFLICT(owner,hostname,domain) DO UPDATE SET status=CASE WHEN domains.status='running' THEN domains.status ELSE 'queued' END,updated_at=excluded.updated_at",
			)->execute([$user, $host, $domain, "queued", time()]);
			$view["status"] = "queued";
		}
		return $view;
	}
	if ($action === "create-grant") {
		if ((onboarding_owner($user)["ROLE"] ?? "") === "admin") {
			throw new RuntimeException("Administrator accounts use their existing Ceasar session.");
		}
		$host = onboarding_host($input["hostname"] ?? null);
		$destination = $input["destination"] ?? "/list/web/";
		if ($destination === "dashboard") {
			$destination = "/list/web/";
		}
		if (
			!in_array(
				$destination,
				["/list/web/", "/list/web/?domain=" . rawurlencode($host), "/fm/"],
				true,
			)
		) {
			throw new InvalidArgumentException("Invalid access destination.");
		}
		if (onboarding_site($user, $host) === null) {
			throw new RuntimeException("Website unavailable.");
		}
		$settings = onboarding_panel_config();
		$source = onboarding_origin($input["sourceOrigin"] ?? $settings["panel_origin"]);
		if (!in_array($source, $settings["grant_origins"], true)) {
			throw new RuntimeException("Grant source origin is not allowed.");
		}
		$token = bin2hex(random_bytes(32));
		$expiry = time() + 60;
		$db->prepare("INSERT INTO access_grants VALUES (?,?,?,?,?,?,?,NULL)")->execute([
			hash("sha256", $token),
			$user,
			$host,
			$destination,
			$settings["panel_origin"],
			$source,
			$expiry,
		]);
		return [
			"actionUrl" => $settings["panel_origin"] . "/onboarding/access/",
			"token" => $token,
			"expiresAt" => gmdate(DATE_ATOM, $expiry),
		];
	}
	if ($action === "wordpress-access") {
		$host = onboarding_host($input["hostname"] ?? null);
		$site = onboarding_site($user, $host);
		if ($site === null) {
			throw new RuntimeException("Website unavailable.");
		}
		$migration = $db->prepare(
			"SELECT status FROM operations WHERE owner=? AND hostname=? AND intent='migration' AND site_type='wordpress' ORDER BY created_at DESC LIMIT 1",
		);
		$migration->execute([$user, $host]);
		if (
			$migration->fetchColumn() === "ready" &&
			empty($input["userId"]) &&
			empty($input["selectedAdministrator"])
		) {
			throw new InvalidArgumentException("Select an existing imported administrator.");
		}
		return onboarding_wordpress_access($db, $user, $host, $site, $input);
	}
	if ($action === "confirm-migration" && is_string($id)) {
		if (($input["customerAttestsImportComplete"] ?? false) !== true) {
			throw new InvalidArgumentException("Confirm that you checked the imported website.");
		}
		$row = onboarding_row($db, $user, $id);
		if ($row["intent"] !== "migration" || $row["status"] !== "needs_action") {
			throw new RuntimeException(
				"Your website is not ready to confirm yet. Refresh its status and try again.",
			);
		}
		$site = onboarding_site($user, $row["hostname"]);
		if ($site === null) {
			throw new RuntimeException("Hosting is unavailable.");
		}
		if (
			$row["site_type"] === "wordpress" &&
			!onboarding_wp_installed($user, $row["hostname"], $site)
		) {
			throw new RuntimeException("The imported WordPress website is not ready yet.");
		}
		$db->prepare(
			"UPDATE operations SET status='ready',stage='verified',message='Import confirmed. Check the preview before changing DNS.',next_action='domain',updated_at=? WHERE id=? AND owner=?",
		)->execute([time(), $id, $user]);
		return onboarding_progress(onboarding_row($db, $user, $id));
	}
	throw new InvalidArgumentException("Unsupported onboarding action.");
}

function onboarding_php_version(array $site): string {
	foreach ([$site["BACKEND"] ?? null, $site["PHP"] ?? null] as $candidate) {
		if (!is_string($candidate)) {
			continue;
		}
		$normalized = strtolower(str_replace("_", ".", $candidate));
		if (preg_match('/^(?:php-?)?(7\.4|8\.[0-5])$/D', $normalized, $matches) === 1) {
			return $matches[1];
		}
	}
	return "8.3";
}

function onboarding_wp(string $user, string $host, array $site, array $args): array {
	if (!is_file("/home/" . $user . "/.wp-cli/wp")) {
		onboarding_native("v-add-user-wp-cli", [$user], 60);
	}
	$php = "php" . onboarding_php_version($site);
	// The domain is resolved from Ceasar's own web record, never a browser path.
	$docroot = realpath(
		(string) ($site["DOCUMENT_ROOT"] ?? "/home/" . $user . "/web/" . $host . "/public_html"),
	);
	if (!is_string($docroot) || !str_starts_with($docroot, "/home/" . $user . "/")) {
		throw new RuntimeException("Your website files are unavailable. Contact support.");
	}
	$wp = "/home/" . $user . "/.wp-cli/wp";
	return onboarding_tenant_run(
		$user,
		["/usr/bin/" . $php, $wp, ...$args, "--path=" . $docroot],
		90,
	);
}

function onboarding_wp_package(string $user, array $args): array {
	return onboarding_tenant_run($user, ["/home/" . $user . "/.wp-cli/wp", ...$args], 120);
}

function onboarding_wp_installed(string $user, string $host, array $site): bool {
	$docroot = realpath(
		(string) ($site["DOCUMENT_ROOT"] ?? "/home/" . $user . "/web/" . $host . "/public_html"),
	);
	return is_string($docroot) &&
		str_starts_with($docroot, "/home/" . $user . "/") &&
		is_file($docroot . "/wp-config.php") &&
		onboarding_wp($user, $host, $site, ["core", "is-installed"])["ok"];
}

function onboarding_wp_has_config(string $user, string $host, array $site): bool {
	$docroot = realpath(
		(string) ($site["DOCUMENT_ROOT"] ?? "/home/" . $user . "/web/" . $host . "/public_html"),
	);
	return is_string($docroot) &&
		str_starts_with($docroot, "/home/" . $user . "/") &&
		is_file($docroot . "/wp-config.php");
}

function onboarding_wp_has_content(string $user, string $host, array $site): bool {
	$docroot = realpath(
		(string) ($site["DOCUMENT_ROOT"] ?? "/home/" . $user . "/web/" . $host . "/public_html"),
	);
	if (!is_string($docroot) || !str_starts_with($docroot, "/home/" . $user . "/")) {
		throw new RuntimeException("Your website files are unavailable. Contact support.");
	}
	$entries = scandir($docroot);
	if (!is_array($entries)) {
		throw new RuntimeException("Website files are unavailable.");
	}
	return array_diff($entries, [".", "..", "index.html", "robots.txt"]) !== [];
}

function onboarding_wordpress_access(
	PDO $db,
	string $user,
	string $host,
	array $site,
	array $input,
): array {
	$connected = $db->prepare(
		"SELECT domain FROM domains WHERE owner=? AND hostname=? AND status='connected' ORDER BY updated_at DESC",
	);
	$connected->execute([$user, $host]);
	$allowedHosts = [$host];
	foreach ($connected->fetchAll(PDO::FETCH_COLUMN) as $connectedDomain) {
		if (!is_string($connectedDomain)) {
			continue;
		}
		$domainState = onboarding_domain($db, $user, $host, $connectedDomain, $site, false);
		if (
			$domainState["status"] === "connected" &&
			$domainState["dnsReady"] &&
			$domainState["ownershipReady"] &&
			$domainState["certificateReady"]
		) {
			$allowedHosts[] = $connectedDomain;
		}
	}
	$loginHost = $allowedHosts[1] ?? $host;
	$admin = $input["administrator"] ?? ($input["userId"] ?? null);
	if (!is_string($admin) || preg_match('/^[A-Za-z0-9_.@+-]{1,80}$/D', $admin) !== 1) {
		throw new InvalidArgumentException("Select an existing WordPress administrator.");
	}
	if (!onboarding_wp_installed($user, $host, $site)) {
		return [
			"url" => "https://" . $loginHost . "/wp-login.php",
			"resetUrl" => "https://" . $loginHost . "/wp-login.php?action=lostpassword",
			"username" => $admin,
			"method" => "password",
			"message" => "Use the normal WordPress sign-in or reset the password by email.",
		];
	}
	$roles = onboarding_wp($user, $host, $site, ["user", "get", $admin, "--field=roles"]);
	if (!$roles["ok"] || !str_contains($roles["output"], "administrator")) {
		throw new RuntimeException("The selected WordPress user is not an administrator.");
	}
	// The pinned login package is an optional enhancement. Never change imported
	// passwords or create a hidden administrator when it is unavailable.
	$url = onboarding_wp($user, $host, $site, [
		"login",
		"create",
		$admin,
		"--expires=60",
		"--url-only",
	]);
	$link = trim($url["output"]);
	if (
		$url["ok"] &&
		filter_var($link, FILTER_VALIDATE_URL) &&
		parse_url($link, PHP_URL_SCHEME) === "https" &&
		in_array(parse_url($link, PHP_URL_HOST), $allowedHosts, true)
	) {
		return ["url" => $link, "method" => "single_use", "expiresIn" => 60];
	}
	return [
		"url" => "https://" . $loginHost . "/wp-login.php",
		"resetUrl" => "https://" . $loginHost . "/wp-login.php?action=lostpassword",
		"username" => $admin,
		"method" => "password",
		"message" => "Use the normal WordPress sign-in or reset the password by email.",
	];
}

function onboarding_dns_records(string $name, int $kind): array {
	$records = @dns_get_record($name, $kind);
	if ($records === false) {
		throw new RuntimeException("DNS lookup is unavailable. Try the check again.");
	}
	return $records;
}

function onboarding_domain(
	PDO $db,
	string $user,
	string $host,
	string $domain,
	array $site,
	bool $connect,
	?callable $lookup = null,
): array {
	$lookup ??= "onboarding_dns_records";
	$expected = onboarding_public_addresses($site);
	$actual = [];
	foreach ([DNS_A, DNS_AAAA] as $kind) {
		foreach ($lookup($domain, $kind) as $record) {
			$actual[] = (string) ($record["ip"] ?? ($record["ipv6"] ?? ""));
		}
	}
	$matches = count(array_intersect($expected, $actual)) > 0;
	$conflicts = array_values(array_diff($actual, $expected));
	$www = "www." . $domain;
	$wwwRecords = $lookup($www, DNS_CNAME | DNS_A | DNS_AAAA);
	$wwwTargets = [];
	foreach ($wwwRecords as $entry) {
		$wwwTargets[] = (string) ($entry["target"] ?? ($entry["ip"] ?? ($entry["ipv6"] ?? "")));
	}
	$wwwReady =
		in_array($domain, $wwwTargets, true) || count(array_intersect($expected, $wwwTargets)) > 0;
	$query = $db->prepare(
		"SELECT challenge FROM domain_verifications WHERE owner=? AND hostname=? AND domain=?",
	);
	$query->execute([$user, $host, $domain]);
	$challenge = $query->fetchColumn();
	if (!is_string($challenge)) {
		$new = "ceasar=" . bin2hex(random_bytes(20));
		$db->prepare("INSERT OR IGNORE INTO domain_verifications VALUES (?,?,?,?,?)")->execute([
			$user,
			$host,
			$domain,
			$new,
			time(),
		]);
		$query->execute([$user, $host, $domain]);
		$challenge = $query->fetchColumn();
	}
	$txtName = "_ceasar-verification." . $domain;
	$txtRecords = $lookup($txtName, DNS_TXT);
	$ownershipReady = false;
	foreach ($txtRecords as $entry) {
		$value = (string) ($entry["txt"] ?? implode("", (array) ($entry["entries"] ?? [])));
		if (hash_equals((string) $challenge, $value)) {
			$ownershipReady = true;
			break;
		}
	}
	$records = [];
	foreach ($expected as $address) {
		$records[] = [
			"type" => str_contains($address, ":") ? "AAAA" : "A",
			"name" => $domain,
			"value" => $address,
		];
	}
	$records[] = ["type" => "CNAME", "name" => $www, "value" => $domain];
	$records[] = ["type" => "TXT", "name" => $txtName, "value" => $challenge];
	$query = $db->prepare("SELECT * FROM domains WHERE owner=? AND hostname=? AND domain=?");
	$query->execute([$user, $host, $domain]);
	$prior = $query->fetch(PDO::FETCH_ASSOC) ?: null;
	$record = [
		"hostname" => $host,
		"domain" => $domain,
		"expectedAddresses" => $expected,
		"observedAddresses" => $actual,
		"conflictingAddresses" => $conflicts,
		"records" => $records,
		"wwwReady" => $wwwReady,
		"wwwObserved" => $wwwTargets,
		"ownershipReady" => $ownershipReady,
		"dnsReady" => $matches && $conflicts === [],
		"certificateReady" => onboarding_tls_ready($domain, $expected),
		"status" => $prior["status"] ?? "awaiting_dns",
	];
	if (!$record["dnsReady"]) {
		$record["status"] = "awaiting_dns";
	} elseif ($record["status"] === "awaiting_dns") {
		$record["status"] = "awaiting_certificate";
	}
	if (!$connect || !$record["dnsReady"] || !$ownershipReady) {
		return $record;
	}
	$aliases = array_filter(explode(",", (string) ($site["ALIAS"] ?? "")));
	[$newAliases, $certificateAliases] = onboarding_domain_targets(
		$host,
		$domain,
		$wwwReady,
		$aliases,
	);
	if ($newAliases !== []) {
		$added = onboarding_native(
			"v-add-web-domain-alias",
			[$user, $host, implode(",", $newAliases), "yes"],
			90,
		);
		if (!$added["ok"]) {
			throw new RuntimeException("Could not attach this domain to the existing website.");
		}
	}
	$cert = onboarding_native(
		"v-add-letsencrypt-domain",
		[$user, $host, implode(",", $certificateAliases)],
		150,
	);
	if (!$cert["ok"] && !onboarding_tls_ready($domain, $expected)) {
		$record["status"] = "awaiting_certificate";
		$db->prepare(
			"INSERT INTO domains(owner,hostname,domain,status,updated_at) VALUES (?,?,?,?,?)
          ON CONFLICT(owner,hostname,domain) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at",
		)->execute([$user, $host, $domain, $record["status"], time()]);
		return $record;
	}
	if (!onboarding_tls_ready($domain, $expected)) {
		$record["status"] = "awaiting_certificate";
		$db->prepare(
			"UPDATE domains SET status='awaiting_certificate',updated_at=? WHERE owner=? AND hostname=? AND domain=?",
		)->execute([time(), $user, $host, $domain]);
		return $record;
	}
	if (!onboarding_https_ready($domain, $expected)) {
		$record["status"] = "awaiting_website";
		$db->prepare(
			"UPDATE domains SET status='awaiting_certificate',updated_at=? WHERE owner=? AND hostname=? AND domain=?",
		)->execute([time(), $user, $host, $domain]);
		return $record;
	}
	$record["certificateReady"] = true;
	$record["status"] = "connected";
	$wpInstalled = onboarding_wp_installed($user, $host, $site);
	if (onboarding_wp_has_config($user, $host, $site) && !$wpInstalled) {
		throw new RuntimeException(
			"WordPress is not ready for this domain yet. Try again shortly.",
		);
	}
	if ($wpInstalled) {
		$home = onboarding_wp($user, $host, $site, ["option", "get", "home"]);
		$siteurl = onboarding_wp($user, $host, $site, ["option", "get", "siteurl"]);
		if (!$home["ok"] || !$siteurl["ok"]) {
			throw new RuntimeException("WordPress URLs could not be read.");
		}
		[$oldUrl, $oldSiteurl] = onboarding_rewrite_sources(
			$prior,
			trim($home["output"]),
			trim($siteurl["output"]),
		);
		$newUrl = "https://" . $domain;
		if (
			!filter_var($oldUrl, FILTER_VALIDATE_URL) ||
			!filter_var($oldSiteurl, FILTER_VALIDATE_URL)
		) {
			throw new RuntimeException("WordPress URLs are invalid.");
		}
		$backup =
			"/home/" .
			$user .
			"/web/" .
			$host .
			"/private/onboarding-" .
			substr(hash("sha256", $domain), 0, 16) .
			".sql";
		if (onboarding_backup_required($prior, $backup)) {
			$temporary = $backup . ".tmp";
			if (is_file($temporary)) {
				unlink($temporary);
			}
			$saved = onboarding_wp($user, $host, $site, ["db", "export", $temporary]);
			if (!$saved["ok"] || !is_file($temporary) || !rename($temporary, $backup)) {
				throw new RuntimeException(
					"We couldn't save your WordPress backup. Contact support before connecting this domain.",
				);
			}
		}
		$db->prepare(
			"INSERT INTO domains(owner,hostname,domain,status,previous_url,previous_siteurl,backup_path,updated_at) VALUES (?,?,?,?,?,?,?,?)
          ON CONFLICT(owner,hostname,domain) DO UPDATE SET status=excluded.status,previous_url=COALESCE(domains.previous_url,excluded.previous_url),previous_siteurl=COALESCE(domains.previous_siteurl,excluded.previous_siteurl),backup_path=COALESCE(domains.backup_path,excluded.backup_path),updated_at=excluded.updated_at",
		)->execute([$user, $host, $domain, "rewriting", $oldUrl, $oldSiteurl, $backup, time()]);
		foreach (array_unique([$oldUrl, $oldSiteurl]) as $sourceUrl) {
			if ($sourceUrl === $newUrl) {
				continue;
			}
			$rewrite = onboarding_wp($user, $host, $site, [
				"search-replace",
				$sourceUrl,
				$newUrl,
				"--all-tables-with-prefix",
				"--precise",
			]);
			if (!$rewrite["ok"]) {
				throw new RuntimeException(
					"We couldn't finish updating your WordPress address. Try connecting the domain again.",
				);
			}
		}
		foreach (["home", "siteurl"] as $option) {
			$updated = onboarding_wp($user, $host, $site, ["option", "update", $option, $newUrl]);
			if (!$updated["ok"]) {
				throw new RuntimeException(
					"Your WordPress address is still being updated. Try connecting the domain again.",
				);
			}
		}
	}
	$db->prepare(
		"INSERT INTO domains(owner,hostname,domain,status,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(owner,hostname,domain) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at",
	)->execute([$user, $host, $domain, "connected", time()]);
	return $record;
}

function onboarding_domain_targets(
	string $host,
	string $domain,
	bool $wwwReady,
	array $existingAliases,
): array {
	$wanted = $wwwReady ? [$domain, "www." . $domain] : [$domain];
	$certificateAliases = array_values(array_diff($wanted, [$host]));
	$newAliases = array_values(array_diff($certificateAliases, $existingAliases));
	return [$newAliases, $certificateAliases];
}

function onboarding_rewrite_sources(?array $prior, string $home, string $siteurl): array {
	return [
		$prior["previous_url"] ?? null ?: $home,
		$prior["previous_siteurl"] ?? null ?: $siteurl,
	];
}

function onboarding_backup_required(?array $prior, string $path): bool {
	if (is_array($prior) && is_string($prior["backup_path"]) && $prior["backup_path"] !== "") {
		if ($prior["backup_path"] !== $path || !is_file($path)) {
			throw new RuntimeException(
				"Your saved WordPress backup is unavailable. Contact support to finish connecting your domain.",
			);
		}
		return false;
	}
	return !is_file($path);
}

function onboarding_tls_endpoint(string $address): string {
	if (
		!filter_var(
			$address,
			FILTER_VALIDATE_IP,
			FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE,
		)
	) {
		throw new InvalidArgumentException("Invalid website probe address.");
	}
	return "ssl://" . (str_contains($address, ":") ? "[" . $address . "]" : $address) . ":443";
}

function onboarding_tls_context_options(string $domain): array {
	return [
		"ssl" => [
			"verify_peer" => true,
			"verify_peer_name" => true,
			"peer_name" => $domain,
			"SNI_enabled" => true,
			"SNI_server_name" => $domain,
		],
	];
}

function onboarding_tls_socket(string $domain, array $expected) {
	$context = stream_context_create(onboarding_tls_context_options($domain));
	foreach ($expected as $address) {
		if (!is_string($address)) {
			throw new InvalidArgumentException("Invalid website probe address.");
		}
		$socket = @stream_socket_client(
			onboarding_tls_endpoint($address),
			$number,
			$message,
			5,
			STREAM_CLIENT_CONNECT,
			$context,
		);
		if (is_resource($socket)) {
			return $socket;
		}
	}
	return false;
}

function onboarding_tls_ready(string $domain, array $expected): bool {
	$socket = onboarding_tls_socket($domain, $expected);
	if (!is_resource($socket)) {
		return false;
	}
	fclose($socket);
	return true;
}

function onboarding_https_ready(string $domain, array $expected): bool {
	$socket = onboarding_tls_socket($domain, $expected);
	if (!is_resource($socket)) {
		return false;
	}
	stream_set_timeout($socket, 5);
	fwrite($socket, "GET / HTTP/1.1\r\nHost: " . $domain . "\r\nConnection: close\r\n\r\n");
	$status = fgets($socket, 256);
	$location = "";
	$deadline = microtime(true) + 5;
	for ($bytes = 0; $bytes < 4096 && microtime(true) < $deadline; ) {
		$remaining = max(1, (int) ceil($deadline - microtime(true)));
		stream_set_timeout($socket, $remaining);
		$line = fgets($socket, 512);
		if (!is_string($line) || trim($line) === "") {
			break;
		}
		$bytes += strlen($line);
		if (stripos($line, "Location:") === 0) {
			$location = trim(substr($line, 9));
		}
	}
	fclose($socket);
	if (!is_string($status) || preg_match("/^HTTP\/1\.[01] [23][0-9]{2} /D", trim($status)) !== 1) {
		return false;
	}
	return !in_array($location, ["/", "https://" . $domain, "https://" . $domain . "/"], true);
}

function onboarding_consume_grant(string $token, string $sourceOrigin, string $panelOrigin): array {
	onboarding_require_root();
	if (preg_match('/^[a-f0-9]{64}$/D', $token) !== 1) {
		throw new InvalidArgumentException("Invalid access grant.");
	}
	$sourceOrigin = onboarding_origin($sourceOrigin);
	$panelOrigin = onboarding_origin($panelOrigin);
	$db = onboarding_db();
	$db->exec("BEGIN IMMEDIATE");
	try {
		$query = $db->prepare("SELECT * FROM access_grants WHERE token_hash=?");
		$query->execute([hash("sha256", $token)]);
		$row = $query->fetch(PDO::FETCH_ASSOC);
		if (!$row || $row["consumed_at"] !== null || (int) $row["expires_at"] < time()) {
			throw new RuntimeException("Access grant expired or already used.");
		}
		if (
			!hash_equals($row["source_origin"], $sourceOrigin) ||
			!hash_equals($row["panel_origin"], $panelOrigin)
		) {
			throw new RuntimeException("Access grant origin does not match.");
		}
		onboarding_owner($row["owner"]);
		if (onboarding_site($row["owner"], $row["hostname"]) === null) {
			throw new RuntimeException("Website unavailable.");
		}
		$db->prepare(
			"UPDATE access_grants SET consumed_at=? WHERE token_hash=? AND consumed_at IS NULL",
		)->execute([time(), hash("sha256", $token)]);
		$db->exec("COMMIT");
		return $row;
	} catch (Throwable $error) {
		$db->exec("ROLLBACK");
		throw $error;
	}
}
