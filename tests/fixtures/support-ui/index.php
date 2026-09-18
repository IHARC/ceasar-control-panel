<?php
declare(strict_types=1);
function tohtml(string $value): string {
	return htmlspecialchars($value, ENT_QUOTES, "UTF-8");
}
function _(string $value): string {
	return $value;
}
define("JS_LATEST_UPDATE", "fixture");
session_start();
$_SESSION["token"] = "fixture";
?><!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ceasar Support</title><link rel="stylesheet" href="/css/themes/default.min.css"></head><body style="padding-top:40px"><header class="top-bar"><div class="container" style="padding:16px 0;color:white;font:600 18px system-ui">Ceasar</div></header><?php include dirname(
	__DIR__,
	3,
) .
	"/web/templates/pages/list_support.php"; ?><footer class="app-footer"><div class="container"><p><a href="https://iharc.ca">Powered by IHARC Labs</a></p></div></footer></body></html>
