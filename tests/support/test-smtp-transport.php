<?php
$root = dirname(__DIR__, 2);
require $root . "/web/inc/mail-transport.php";
ok(
	ceasar_smtp_encryption("STARTTLS") === PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_STARTTLS &&
		ceasar_smtp_encryption("ssl") === PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_SMTPS,
	"legacy SMTP encryption values map to PHPMailer",
);
function ok($v, $m) {
	if (!$v) {
		throw new RuntimeException($m);
	}
}
function run($mode) {
	$port = random_int(31000, 39000);
	$p = proc_open(
		["python3", __DIR__ . "/fake-smtp.py", $mode, (string) $port],
		[1 => ["pipe", "w"], 2 => ["pipe", "w"]],
		$pipes,
	);
	usleep(600000);
	$r = ceasar_send_email_result(
		"to@example.test",
		"s",
		"b",
		"from@example.test",
		"From",
		"",
		"",
		[],
		[
			"USE_SERVER_SMTP" => "true",
			"SERVER_SMTP_HOST" => "127.0.0.1",
			"SERVER_SMTP_PORT" => $port,
			"SERVER_SMTP_SECURITY" => "",
			"SERVER_SMTP_USER" => "",
			"SERVER_SMTP_PASSWD" => "",
		],
	);
	foreach ($pipes as $x) {
		fclose($x);
	}
	proc_close($p);
	return $r;
}
$a = run("accept");
ok($a["accepted"] === true, "accept");
$r = run("451");
ok(!$r["accepted"] && !$r["uncertain"], "451 retry");
$d = run("drop");
ok(!$d["accepted"] && $d["uncertain"], "drop uncertain");
$port = random_int(40000, 45000);
$c = ceasar_send_email_result(
	"to@example.test",
	"s",
	"b",
	"from@example.test",
	"From",
	"",
	"",
	[],
	["USE_SERVER_SMTP" => "true", "SERVER_SMTP_HOST" => "127.0.0.1", "SERVER_SMTP_PORT" => $port],
);
ok(!$c["accepted"] && !$c["uncertain"], "connect retry");
echo "smtp transport tests passed\n";
