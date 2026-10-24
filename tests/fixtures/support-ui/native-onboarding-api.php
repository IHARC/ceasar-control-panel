<?php
declare(strict_types=1);
if (getenv("CEASAR_SUPPORT_TEST") !== "1") {
	http_response_code(404);
	exit();
}
session_start();
header("Content-Type: application/json; charset=utf-8");
header("Cache-Control: no-store");
if (($_SERVER["HTTP_X_CEASAR_CSRF"] ?? "") !== "fixture-csrf") {
	http_response_code(403);
	echo json_encode(["error" => "Invalid preview session."]);
	return;
}
$input = json_decode(file_get_contents("php://input"), true);
if (!is_array($input)) {
	http_response_code(400);
	echo json_encode(["error" => "Invalid preview request."]);
	return;
}
$action = $input["action"] ?? "";
$operation = $_SESSION["northstar_preview_operation"] ?? null;
$result = null;
if ($action === "read-draft") {
	$result = [
		"draft" => $_SESSION["northstar_preview_draft"] ?? null,
		"capabilities" => [
			"setupMethods" => [
				"wordpress-new" => [],
				"wordpress-move" => [],
				"php-import" => [],
				"php-static" => [],
			],
		],
	];
} elseif ($action === "save-draft") {
	$_SESSION["northstar_preview_draft"] = $input["draft"] ?? null;
	$result = ["draft" => $_SESSION["northstar_preview_draft"]];
} elseif ($action === "prepare") {
	$hostname = (string) ($input["hostname"] ?? "");
	if (!preg_match('/^[a-z0-9][a-z0-9.-]{1,251}[a-z0-9]$/D', $hostname)) {
		http_response_code(422);
		echo json_encode(["error" => "Enter a valid preview hostname."]);
		return;
	}
	$operation = [
		"operationId" => "northstar-fixture-operation",
		"hostname" => $hostname,
		"siteType" => $input["siteType"] ?? "php",
		"intent" => $input["intent"] ?? "new_site",
		"status" => "queued",
		"stage" => "allocation",
		"message" => "Hosting workspace queued.",
		"reads" => 0,
		"verified" => false,
	];
	$_SESSION["northstar_preview_operation"] = $operation;
	$result = $operation;
} elseif ($action === "status") {
	if (!$operation) {
		http_response_code(404);
		echo json_encode(["error" => "No fixture operation exists yet."]);
		return;
	}
	$operation["reads"]++;
	$ready = $operation["reads"] >= 2;
	$move = $operation["intent"] === "migration";
	$operation["status"] = !$ready
		? "running"
		: ($move && !$operation["verified"]
			? "needs_action"
			: "ready");
	$operation["stage"] = !$ready
		? "installing"
		: ($move && !$operation["verified"]
			? "transfer"
			: ($move
				? "verified"
				: "ready"));
	$operation["message"] = !$ready
		? "Preparing the website workspace."
		: ($move && !$operation["verified"]
			? "Destination ready. Transfer your website through WPvivid or upload files."
			: "Website ready.");
	$_SESSION["northstar_preview_operation"] = $operation;
	$result = $operation;
} elseif ($action === "confirm-migration") {
	if (!$operation) {
		http_response_code(404);
		echo json_encode(["error" => "Prepare a destination first."]);
		return;
	}
	$operation["verified"] = true;
	$operation["status"] = "ready";
	$operation["stage"] = "verified";
	$operation["message"] = "Imported website verified.";
	$_SESSION["northstar_preview_operation"] = $operation;
	$result = $operation;
} elseif ($action === "create-grant") {
	$result = [
		"actionUrl" =>
			"http://" . ($_SERVER["HTTP_HOST"] ?? "127.0.0.1:8088") . "/onboarding/access/",
		"token" => "fixture-single-use-grant",
		"expiresAt" => gmdate(DATE_ATOM, time() + 60),
	];
} elseif ($action === "wordpress-access") {
	if (
		$operation &&
		$operation["stage"] === "verified" &&
		($input["administrator"] ?? "") === "wpadmin"
	) {
		http_response_code(422);
		echo json_encode(["error" => "Select an existing imported administrator."]);
		return;
	}
	$result = ["url" => "https://preview.example.test/wp-admin/", "method" => "single_use"];
} elseif ($action === "domain-status" || $action === "connect-domain") {
	$domain = (string) ($input["domain"] ?? "example.test");
	if ($action === "connect-domain") {
		$_SESSION["northstar_preview_domain"] = $domain;
	}
	$connected = ($_SESSION["northstar_preview_domain"] ?? "") === $domain;
	$result = [
		"status" => $connected ? "connected" : "awaiting_dns",
		"ownershipReady" => $connected,
		"dnsReady" => $connected,
		"certificateReady" => $connected,
		"records" => [
			["type" => "TXT", "name" => "_ceasar.$domain", "value" => "fixture-verification"],
			["type" => "A", "name" => $domain, "value" => "192.0.2.24"],
			["type" => "CNAME", "name" => "www.$domain", "value" => "preview.example.test"],
		],
	];
}
if ($result === null) {
	http_response_code(400);
	echo json_encode(["error" => "Unsupported preview action."]);
	return;
}
echo json_encode($result, JSON_UNESCAPED_SLASHES);
