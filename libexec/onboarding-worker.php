#!/usr/local/ceasar/php/bin/php
<?php
declare(strict_types=1);
require_once __DIR__ . "/onboarding.php";

function onboarding_wordpress_install_args(array $row, array $site): array {
	return [
		"install",
		$row["owner"],
		$row["hostname"],
		"WordPress",
		"email=" . $row["contact_email"],
		"generate_password=true",
		"username=wpadmin",
		"site_name=" . $row["site_title"],
		"install_directory=/",
		"language=en_US",
		"php_version=" . onboarding_php_version($site),
		"database_create=true",
	];
}

function onboarding_mark(
	PDO $db,
	string $id,
	string $status,
	string $stage,
	string $message,
	string $next,
): void {
	$db->prepare(
		"UPDATE operations SET status=?,stage=?,message=?,next_action=?,updated_at=? WHERE id=?",
	)->execute([$status, $stage, $message, $next, time(), $id]);
}

function onboarding_work_one(): bool {
	onboarding_require_root();
	$db = onboarding_db();
	$db->exec("BEGIN IMMEDIATE");
	try {
		// A killed worker may have completed a native command. Every stage below
		// reads Ceasar state before retrying rather than creating another site.
		$row = $db
			->query(
				"SELECT * FROM operations WHERE status='queued' OR
          (status='running' AND updated_at < strftime('%s','now')-600)
          ORDER BY created_at LIMIT 1",
			)
			->fetch(PDO::FETCH_ASSOC);
		if (!$row) {
			$domain = $db
				->query(
					"SELECT * FROM domains WHERE status IN ('queued','awaiting_certificate') OR
								(status IN ('running','rewriting') AND updated_at < strftime('%s','now')-600)
              ORDER BY updated_at LIMIT 1",
				)
				->fetch(PDO::FETCH_ASSOC);
			if (!$domain) {
				$db->exec("COMMIT");
				return false;
			}
			$db->prepare(
				"UPDATE domains SET status='running',updated_at=? WHERE owner=? AND hostname=? AND domain=?",
			)->execute([time(), $domain["owner"], $domain["hostname"], $domain["domain"]]);
			$db->exec("COMMIT");
			try {
				onboarding_owner($domain["owner"]);
				$site = onboarding_site($domain["owner"], $domain["hostname"]);
				if ($site === null) {
					throw new RuntimeException("Website unavailable.");
				}
				$view = onboarding_domain(
					$db,
					$domain["owner"],
					$domain["hostname"],
					$domain["domain"],
					$site,
					true,
				);
				if (!$view["dnsReady"] || !$view["ownershipReady"]) {
					$db->prepare(
						"UPDATE domains SET status='awaiting_dns',updated_at=? WHERE owner=? AND hostname=? AND domain=?",
					)->execute([time(), $domain["owner"], $domain["hostname"], $domain["domain"]]);
				}
			} catch (Throwable $error) {
				$db->prepare(
					"UPDATE domains SET status='failed',updated_at=? WHERE owner=? AND hostname=? AND domain=?",
				)->execute([time(), $domain["owner"], $domain["hostname"], $domain["domain"]]);
			}
			return true;
		}
		$db->prepare(
			"UPDATE operations SET status='running',stage='checking',message='Checking your website.',next_action='wait',attempts=attempts+1,updated_at=? WHERE id=?",
		)->execute([time(), $row["id"]]);
		$db->exec("COMMIT");
	} catch (Throwable $error) {
		$db->exec("ROLLBACK");
		throw $error;
	}

	try {
		$user = $row["owner"];
		$host = $row["hostname"];
		onboarding_owner($user);
		$site = onboarding_site($user, $host);
		if ($site === null) {
			onboarding_mark(
				$db,
				$row["id"],
				"running",
				"creating_site",
				"Creating your hosting space.",
				"wait",
			);
			$created = onboarding_native("v-add-web-domain", [$user, $host], 120);
			if (!$created["ok"]) {
				throw new RuntimeException(
					"Hosting space could not be created. Check account allowance or contact support.",
				);
			}
			$site = onboarding_site($user, $host);
			if ($site === null) {
				throw new RuntimeException("Hosting space is not yet visible.");
			}
		}
		if ($row["site_type"] === "static" && ($site["BACKEND"] ?? "") !== "no-php") {
			onboarding_mark(
				$db,
				$row["id"],
				"running",
				"static_backend",
				"Configuring static file hosting.",
				"wait",
			);
			$backend = onboarding_native(
				"v-change-web-domain-backend-tpl",
				[$user, $host, "no-php", "yes"],
				120,
			);
			if (!$backend["ok"]) {
				throw new RuntimeException("Static hosting backend could not be configured.");
			}
			$site = onboarding_site($user, $host);
			if ($site === null || ($site["BACKEND"] ?? "") !== "no-php") {
				throw new RuntimeException("Static backend is not yet visible.");
			}
		}
		if (($site["SSL"] ?? "no") !== "yes") {
			onboarding_mark(
				$db,
				$row["id"],
				"running",
				"certificate",
				"Securing your website address.",
				"wait",
			);
			$addresses = onboarding_public_addresses($site);
			$certificate = onboarding_native("v-add-letsencrypt-domain", [$user, $host, ""], 150);
			$site = onboarding_site($user, $host);
			if (!$certificate["ok"] || $site === null || ($site["SSL"] ?? "no") !== "yes") {
				throw new RuntimeException(
					"Point " .
						$host .
						" to " .
						implode(", ", $addresses) .
						" in DNS, wait for propagation, then retry certificate setup. Contact support if DNS is already correct.",
				);
			}
		}
		if ($row["site_type"] === "wordpress") {
			onboarding_mark(
				$db,
				$row["id"],
				"running",
				"wordpress",
				"Installing standard WordPress.",
				"wait",
			);
			if (!onboarding_wp_installed($user, $host, $site)) {
				if (
					in_array($row["stage"], ["installing_wordpress", "wordpress_partial"], true) ||
					onboarding_wp_has_content($user, $host, $site)
				) {
					throw new RuntimeException(
						"WordPress files or a partial install need inspection before retry. Existing content was left intact.",
					);
				}
				onboarding_mark(
					$db,
					$row["id"],
					"running",
					"installing_wordpress",
					"Installing standard WordPress.",
					"wait",
				);
				$installed = onboarding_native(
					"v-quick-install-app",
					onboarding_wordpress_install_args($row, $site),
					300,
				);
				if (!$installed["ok"]) {
					throw new RuntimeException(
						"WordPress installation needs attention. Retry or contact support.",
					);
				}
				$site = onboarding_site($user, $host) ?? $site;
				if (!onboarding_wp_installed($user, $host, $site)) {
					throw new RuntimeException(
						"WordPress is not responding yet. Retry readiness check.",
					);
				}
			}
			if ($row["intent"] === "new_site") {
				$title = onboarding_wp($user, $host, $site, [
					"option",
					"update",
					"blogname",
					$row["site_title"],
				]);
				$email = onboarding_wp($user, $host, $site, [
					"option",
					"update",
					"admin_email",
					$row["contact_email"],
				]);
				if (!$title["ok"] || !$email["ok"]) {
					throw new RuntimeException(
						"WordPress settings could not be saved. Retry preparation.",
					);
				}
			}
			// The public package and companion plugin are pinned. Failure keeps
			// ordinary wp-login.php available; onboarding itself still works.
			onboarding_native("v-add-user-wp-cli", [$user], 60);
			$loginPackage = "aaemnnosttv/wp-cli-login-command:1.5.0";
			onboarding_wp_package($user, ["package", "install", $loginPackage]);
			onboarding_wp($user, $host, $site, ["login", "install", "--activate", "--yes"]);
			if ($row["intent"] === "migration") {
				onboarding_mark(
					$db,
					$row["id"],
					"running",
					"migration_tools",
					"Preparing supported migration tools.",
					"wait",
				);
				$plugin = onboarding_wp($user, $host, $site, [
					"plugin",
					"install",
					"wpvivid-backuprestore",
					"--version=0.9.136",
					"--activate",
				]);
				if (!$plugin["ok"]) {
					throw new RuntimeException(
						"Migration tools could not be installed. Retry or contact support.",
					);
				}
				onboarding_mark(
					$db,
					$row["id"],
					"needs_action",
					"transfer",
					"Install WPvivid on the source and transfer or upload a backup, then confirm the import.",
					"confirm_migration",
				);
				return true;
			}
		}
		if ($row["intent"] === "migration") {
			onboarding_mark(
				$db,
				$row["id"],
				"needs_action",
				"transfer",
				"Upload your website files and database, check the preview, then confirm the import.",
				"confirm_migration",
			);
			return true;
		}
		onboarding_mark(
			$db,
			$row["id"],
			"ready",
			"ready",
			"Your hosting space is ready.",
			"domain",
		);
		return true;
	} catch (Throwable $error) {
		// Native command output can contain credentials. Persist only curated
		// messages and never exception traces or command arguments.
		$message =
			$error instanceof RuntimeException
				? $error->getMessage()
				: "Preparation needs attention.";
		$current = onboarding_row($db, $row["owner"], $row["id"]);
		$partial =
			in_array($current["stage"], ["installing_wordpress", "wordpress_partial"], true) ||
			str_contains($message, "partial install");
		$stage = $partial
			? "wordpress_partial"
			: ($current["stage"] === "certificate"
				? "certificate"
				: "preparation");
		onboarding_mark(
			$db,
			$row["id"],
			"failed",
			$stage,
			$message,
			$partial ? "support" : "retry",
		);
		return true;
	}
}

try {
	echo json_encode(["processed" => onboarding_work_one()], JSON_THROW_ON_ERROR) . PHP_EOL;
} catch (Throwable $error) {
	fwrite(STDERR, "Onboarding worker failed.\n");
	exit(1);
}

