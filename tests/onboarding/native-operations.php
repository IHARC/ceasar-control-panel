<?php
declare(strict_types=1);
putenv("CEASAR_ONBOARDING_DB=/tmp/ceasar-onboarding-test-" . getmypid() . ".sqlite");
putenv("CEASAR_ONBOARDING_FIXTURE=1");
require_once __DIR__ . "/../../libexec/onboarding.php";
require_once __DIR__ . "/../../libexec/quick-install-options.php";
function check(bool $condition, string $message): void {
	if (!$condition) {
		throw new RuntimeException($message);
	}
}
try {
	try {
		onboarding_require_root(1000);
		throw new RuntimeException("Unprivileged execution accepted.");
	} catch (RuntimeException $error) {
		check(str_contains($error->getMessage(), "privileged"), "Unexpected privilege error.");
	}
	$isolated = onboarding_tenant_command("nobody", ["/bin/true"], 30, true);
	check(
		in_array("--property=Slice=user-65534.slice", $isolated, true),
		"Tenant slice missing from application command.",
	);
	check(
		in_array("--property=User=nobody", $isolated, true),
		"Application command does not use the owning tenant.",
	);
	$probeAddresses = onboarding_public_addresses(["IP" => "10.0.0.5"]);
	check(
		$probeAddresses === ["1.1.1.1"] &&
			onboarding_tls_endpoint($probeAddresses[0]) === "ssl://1.1.1.1:443",
		"TLS target was not pinned to the configured public website address.",
	);
	check(
		onboarding_tls_endpoint("2606:4700:4700::1111") === "ssl://[2606:4700:4700::1111]:443",
		"IPv6 TLS target was not bracketed.",
	);
	$identity = onboarding_tls_context_options("customer.example.test")["ssl"];
	check(
		$identity["peer_name"] === "customer.example.test" &&
			$identity["SNI_server_name"] === "customer.example.test" &&
			$identity["verify_peer_name"] === true,
		"TLS peer identity was not the customer domain.",
	);
	try {
		onboarding_tls_endpoint("10.0.0.5");
		throw new RuntimeException("Private probe target accepted.");
	} catch (InvalidArgumentException $error) {
		/* required */
	}
	check(
		in_array("--description=Ceasar website operation", $isolated, true),
		"Transient unit description exposes command arguments.",
	);
	$generated = ceasar_quick_install_options("WordPress", ["webapp_generate_password" => "true"]);
	check(
		!isset($generated["webapp_generate_password"]) &&
			preg_match('/^[a-f0-9]{48}$/D', $generated["webapp_password"]) === 1,
		"Generated password was not routed into required installer field.",
	);
	$explicit = ceasar_quick_install_options("WordPress", ["webapp_password" => "given"]);
	check($explicit["webapp_password"] === "given", "Existing explicit password changed.");
	try {
		ceasar_quick_install_options("OtherApp", ["webapp_generate_password" => "true"]);
		throw new RuntimeException("Generated password option accepted for another app.");
	} catch (InvalidArgumentException $error) {
		/* required */
	}
	$request = [
		"idempotencyKey" => "native-test-0001",
		"hostname" => "preview.example.test",
		"siteType" => "static",
		"intent" => "new_site",
		"siteTitle" => "Fixture",
		"contactEmail" => "owner@example.test",
	];
	$first = onboarding_dispatch("alice", "prepare", $request);
	check($first["status"] === "queued", "A site should queue.");
	check(
		onboarding_dispatch("alice", "prepare", $request)["operationId"] === $first["operationId"],
		"A retry must return the same operation.",
	);
	try {
		onboarding_dispatch("alice", "prepare", [...$request, "hostname" => "other.example.test"]);
		throw new RuntimeException("Reused idempotency key was accepted.");
	} catch (RuntimeException $error) {
		check(
			str_contains($error->getMessage(), "Idempotency key"),
			"Unexpected idempotency error.",
		);
	}
	$draft = [
		"step" => "preparation",
		"hostname" => "preview.example.test",
		"serviceId" => "preview.example.test",
		"requestId" => $first["operationId"],
	];
	onboarding_dispatch("alice", "save-draft", ["draft" => $draft]);
	check(
		onboarding_dispatch("alice", "read-draft", [])["draft"] === $draft,
		"Server draft did not round trip.",
	);
	try {
		onboarding_dispatch("alice", "save-draft", ["draft" => ["password" => "secret"]]);
		throw new RuntimeException("Secret field accepted.");
	} catch (InvalidArgumentException $error) {
		/* required */
	}
	$grant = onboarding_dispatch("alice", "create-grant", ["hostname" => "preview.example.test"]);
	check(
		$grant["actionUrl"] === "https://panel.example.test:8083/onboarding/access/",
		"Wrong access destination.",
	);
	try {
		onboarding_consume_grant(
			$grant["token"],
			"https://customer.example.test",
			"https://panel.example.test:8083",
		);
		throw new RuntimeException("Mismatched source origin accepted.");
	} catch (RuntimeException $error) {
		check(str_contains($error->getMessage(), "origin"), "Unexpected origin error.");
	}
	$consumed = onboarding_consume_grant(
		$grant["token"],
		"https://panel.example.test:8083",
		"https://panel.example.test:8083",
	);
	check($consumed["owner"] === "alice", "Grant owner changed.");
	try {
		onboarding_consume_grant(
			$grant["token"],
			"https://panel.example.test:8083",
			"https://panel.example.test:8083",
		);
		throw new RuntimeException("Grant replay accepted.");
	} catch (RuntimeException $error) {
		check(str_contains($error->getMessage(), "already used"), "Unexpected replay error.");
	}
	try {
		onboarding_dispatch("bob", "create-grant", ["hostname" => "preview.example.test"]);
		throw new RuntimeException("Cross-account grant accepted.");
	} catch (RuntimeException $error) {
		check(str_contains($error->getMessage(), "Website unavailable"), "Unexpected owner error.");
	}
	$domain = onboarding_domain(
		onboarding_db(),
		"alice",
		"preview.example.test",
		"example.test",
		onboarding_site("alice", "preview.example.test"),
		false,
		fn() => [],
	);
	$txt = array_values(array_filter($domain["records"], fn($entry) => $entry["type"] === "TXT"));
	check(
		count($txt) === 1 && str_starts_with($txt[0]["value"], "ceasar="),
		"Site-bound TXT proof missing.",
	);
	check($domain["ownershipReady"] === false, "Unproved domain was accepted.");
	check($domain["dnsReady"] === false, "Missing DNS was accepted.");
	$sharedIp = onboarding_domain(
		onboarding_db(),
		"alice",
		"preview.example.test",
		"example.test",
		onboarding_site("alice", "preview.example.test"),
		true,
		fn($name, $kind) => $name === "example.test" && $kind === DNS_A
			? [["ip" => "1.1.1.1"]]
			: [],
	);
	check(
		$sharedIp["dnsReady"] === true && $sharedIp["ownershipReady"] === false,
		"Shared node address bypassed the TXT ownership challenge.",
	);
	$primary = onboarding_domain(
		onboarding_db(),
		"alice",
		"preview.example.test",
		"preview.example.test",
		onboarding_site("alice", "preview.example.test"),
		true,
		fn($name, $kind) => $name === "preview.example.test" && $kind === DNS_A
			? [["ip" => "1.1.1.1"]]
			: [],
	);
	check(
		$primary["dnsReady"] && !$primary["ownershipReady"],
		"Primary hostname bypassed ownership proof.",
	);
	check(
		onboarding_domain_targets("preview.example.test", "preview.example.test", false, []) === [
			[],
			[],
		],
		"Primary hostname was added as its own alias.",
	);
	check(
		onboarding_domain_targets("preview.example.test", "preview.example.test", true, []) === [
			["www.preview.example.test"],
			["www.preview.example.test"],
		],
		"Primary hostname certificate alias selection is incorrect.",
	);
	require __DIR__ . "/../../libexec/onboarding-worker.php";
	$installArgs = onboarding_wordpress_install_args([
		"owner" => "alice",
		"hostname" => "preview.example.test",
		"contact_email" => "owner@example.test",
		"site_title" => "Fixture",
	]);
	check(
		in_array("generate_password=true", $installArgs, true) &&
			count(array_filter($installArgs, fn($arg) => str_starts_with($arg, "password="))) === 0,
		"Worker placed an administrator password in installer arguments.",
	);
	check(
		onboarding_dispatch("alice", "status", ["operationId" => $first["operationId"]])[
			"status"
		] === "ready",
		"Worker did not prepare static site.",
	);
	$partial = onboarding_dispatch("alice", "prepare", [
		...$request,
		"idempotencyKey" => "native-test-0002",
		"siteType" => "wordpress",
		"siteTitle" => "Partial site",
	]);
	$docroot = "/home/alice/web/preview.example.test/public_html";
	if (!is_dir($docroot)) {
		mkdir($docroot, 0755, true);
	}
	file_put_contents($docroot . "/wp-config.php", "<?php // interrupted fixture");
	onboarding_work_one();
	$partialStatus = onboarding_dispatch("alice", "status", [
		"operationId" => $partial["operationId"],
	]);
	check(
		$partialStatus["status"] === "failed" && $partialStatus["stage"] === "wordpress_partial",
		"Partial WordPress files were not held for reconciliation: " . json_encode($partialStatus),
	);
	check(
		!is_file("/tmp/ceasar-fixture-quick-installer-called"),
		"Quick installer ran over partial WordPress files.",
	);
	$database = onboarding_db();
	$database
		->prepare("UPDATE operations SET stage='preparation',attempts=9 WHERE id=?")
		->execute([$partial["operationId"]]);
	check(
		onboarding_dispatch("alice", "retry", ["operationId" => $partial["operationId"]])[
			"status"
		] === "queued",
		"Arbitrary lifetime retry limit remained.",
	);
	$database
		->prepare("UPDATE operations SET status='failed',stage='wordpress_partial' WHERE id=?")
		->execute([$partial["operationId"]]);
	$old = [
		"previous_url" => "https://preview.example.test",
		"previous_siteurl" => "https://preview.example.test/wp",
		"backup_path" => "/tmp/ceasar-onboarding-backup-" . getmypid(),
	];
	check(
		onboarding_rewrite_sources($old, "https://example.test", "https://example.test") === [
			"https://preview.example.test",
			"https://preview.example.test/wp",
		],
		"Interrupted rewrite forgot original URLs.",
	);
	file_put_contents($old["backup_path"], "original backup");
	check(
		!onboarding_backup_required($old, $old["backup_path"]),
		"Cutover would repeat the original backup.",
	);
	$database
		->prepare(
			"INSERT INTO domains(owner,hostname,domain,status,previous_url,previous_siteurl,backup_path,updated_at) VALUES (?,?,?,?,?,?,?,?)",
		)
		->execute([
			"alice",
			"preview.example.test",
			"invalid.example.test",
			"rewriting",
			$old["previous_url"],
			$old["previous_siteurl"],
			$old["backup_path"],
			time() - 900,
		]);
	onboarding_work_one();
	$status = $database
		->query("SELECT status FROM domains WHERE domain='invalid.example.test'")
		->fetchColumn();
	check($status !== "rewriting", "Stale rewrite was not reclaimed by the worker.");
	unlink($old["backup_path"]);
	echo "Native onboarding fixture passed.\n";
} finally {
	if (is_file("/tmp/ceasar-fixture-quick-installer-called")) {
		unlink("/tmp/ceasar-fixture-quick-installer-called");
	}
	if (is_file("/tmp/ceasar-fixture-no-php")) {
		unlink("/tmp/ceasar-fixture-no-php");
	}
	$path = getenv("CEASAR_ONBOARDING_DB");
	foreach ([$path, $path . "-shm", $path . "-wal"] as $file) {
		if (is_file($file)) {
			unlink($file);
		}
	}
}
