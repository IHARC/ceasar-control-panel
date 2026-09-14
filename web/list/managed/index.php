<?php
$TAB = "MANAGED";
include $_SERVER["DOCUMENT_ROOT"] . "/inc/main.php";
require_once $_SERVER["DOCUMENT_ROOT"] . "/inc/managed-service.php";
if (!managed_service_authorized_session()) { header("Location: /login/"); exit(); }

$error = "";
$notice = ($_GET["notice"] ?? "") === "updated" ? _("Managed-service request saved.") : "";
$result = [];
$managed_section = "overview";
try {
	if ($_SERVER["REQUEST_METHOD"] === "POST") {
		verify_csrf($_POST);
		$request = managed_service_form_request($_POST);
		$managed_section = $request["section"];
		$result = managed_service_request($request);
		if (!empty($result["ok"])) {
			unset($_SESSION["managed_request_id"]);
			$location = "/list/managed/?section=" . rawurlencode($managed_section) . "&notice=updated";
			if (isset($request["record_id"])) $location .= "&record_id=" . rawurlencode($request["record_id"]);
			header("Location: " . $location);
			exit();
		}
	} else {
		$request = managed_service_read_request($_GET);
		$managed_section = $request["section"];
		$result = managed_service_request($request);
	}
} catch (Throwable $exception) {
	$error = $exception->getMessage();
}
if (empty($_SESSION["managed_request_id"])) {
	$_SESSION["managed_request_id"] = sprintf("%s-%s-4%s-8%s-%s", bin2hex(random_bytes(4)), bin2hex(random_bytes(2)), substr(bin2hex(random_bytes(2)), 0, 3), substr(bin2hex(random_bytes(2)), 0, 3), bin2hex(random_bytes(6)));
}
render_page($user, $TAB, "list_managed");
