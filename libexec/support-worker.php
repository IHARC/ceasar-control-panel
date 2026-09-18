#!/usr/local/ceasar/php/bin/php
<?php
declare(strict_types=1);

require_once "/usr/local/ceasar/web/inc/support.php";

$command = $argv[1] ?? "deliver";
if ($command === "deliver") {
	echo json_encode(
		support_with_lock(fn() => support_deliver_outbox(isset($argv[2]) ? (int) $argv[2] : 25)),
	) . PHP_EOL;
	exit(0);
}
if ($command === "inbound") {
	echo json_encode(support_with_lock(fn() => support_import_inbound())) . PHP_EOL;
	exit(0);
}
fwrite(STDERR, "Usage: support-worker.php deliver [limit]|inbound\n");
exit(2);

