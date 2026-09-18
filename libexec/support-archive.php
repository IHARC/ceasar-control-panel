#!/usr/local/ceasar/php/bin/php
<?php
declare(strict_types=1);

require_once "/usr/local/ceasar/web/inc/support.php";

$command = $argv[1] ?? "";
if ($command === "export") {
	echo json_encode(
		support_with_lock(fn() => support_export()),
		JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT,
	) . PHP_EOL;
	exit(0);
}
if ($command === "import" && isset($argv[2])) {
	$archive = json_decode((string) file_get_contents($argv[2]), true, 512, JSON_THROW_ON_ERROR);
	echo json_encode(support_with_lock(fn() => support_import($archive))) . PHP_EOL;
	exit(0);
}
fwrite(STDERR, "Usage: support-archive.php export|import ARCHIVE.json\n");
exit(2);

