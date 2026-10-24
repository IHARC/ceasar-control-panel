<?php
declare(strict_types=1);
define("CEASAR_CMD", "/usr/local/ceasar/bin/");
function load_ceasar_config(): void {
	$_SESSION["VERSION"] = "fixture";
	$_SESSION["POLICY_USER_CHANGE_THEME"] = "yes";
	$_SESSION["DISABLE_IP_CHECK"] = "no";
}
function get_real_user_ip(): string {
	return "192.0.2.10";
}
require_once __DIR__ . "/../../web/inc/native-session.php";
session_start();
$_SESSION = [
	"user" => "admin",
	"userContext" => "admin",
	"look" => "alice",
	"login" => ["password" => "secret"],
	"token" => "old",
	"request_uri" => "//evil.invalid/",
];
$old = session_id();
native_begin_user_session("alice", [
	"ROLE" => "user",
	"SHELL" => "nologin",
	"THEME" => "default",
	"PREF_UI_SORT" => "date",
	"LANGUAGE" => "fr",
]);
if (
	$_SESSION["user"] !== "alice" ||
	$_SESSION["userContext"] !== "user" ||
	$_SESSION["VERSION"] !== "fixture" ||
	$_SESSION["language"] !== "fr" ||
	$_SESSION["token"] === "old" ||
	session_id() === $old ||
	isset($_SESSION["look"], $_SESSION["login"]) ||
	isset($_SESSION["request_uri"])
) {
	throw new RuntimeException("Grant did not create a clean native user session.");
}
echo "Native session bootstrap fixture passed.\n";
