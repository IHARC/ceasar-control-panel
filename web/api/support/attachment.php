<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . "/inc/support.php";

$db = support_db();
$actor = support_actor();
$attachmentId = (string) ($_GET["attachmentId"] ?? "");
$stmt = $db->prepare(
	"SELECT a.*, t.account_id, m.visibility FROM support_attachments a JOIN support_tickets t ON t.id=a.ticket_id JOIN support_messages m ON m.id=a.message_id WHERE a.id=?",
);
$stmt->execute([$attachmentId]);
$attachment = $stmt->fetch();
if (!$attachment) {
	support_json_error(404, "not_found", "Attachment not found.");
}
if (!support_can_access($actor, ["account_id" => $attachment["account_id"]])) {
	support_json_error(403, "forbidden", "Attachment access is not permitted.");
}
if ($attachment["visibility"] === "internal" && $actor["role"] !== "staff") {
	support_json_error(403, "forbidden", "Attachment access is not permitted.");
}
$path = rtrim((string) support_config()["attachments"], "/") . "/" . $attachment["storage_key"];
if (!is_file($path)) {
	support_json_error(410, "unavailable", "Attachment data is unavailable.");
}
header("Content-Type: " . $attachment["mime_type"]);
header("Content-Length: " . $attachment["bytes"]);
header(
	"Content-Disposition: attachment; filename=\"" .
		str_replace('"', "", $attachment["filename"]) .
		"\"",
);
header("X-Content-Type-Options: nosniff");
readfile($path);
