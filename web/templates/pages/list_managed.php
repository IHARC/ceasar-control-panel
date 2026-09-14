<?php
$columns = [];
foreach (($result["columns"] ?? []) as $column) {
	$key = is_array($column) && isset($column["key"]) && is_string($column["key"]) && preg_match('/^[A-Za-z0-9_]{1,64}$/', $column["key"]) ? $column["key"] : null;
	if ($key !== null) $columns[] = ["key" => $key, "label" => managed_service_text($column["label"] ?? $key)];
}
$rows = is_array($result["rows"] ?? null) ? array_values(array_filter($result["rows"], "is_array")) : [];
$supportCase = is_array($result["support_case"] ?? null) ? $result["support_case"] : null;
$supportCaseId = $supportCase ? managed_service_uuid($supportCase["id"] ?? null) : null;
$supportMessages = is_array($supportCase["messages"] ?? null) ? $supportCase["messages"] : [];
?>
<div class="container">
	<h1><?= tohtml(_("Managed services")) ?></h1>
	<?php if ($notice !== "") { ?><div class="inline-alert inline-alert-success"><p><?= tohtml($notice) ?></p></div><?php } ?>
	<?php if ($error !== "") { ?><div class="inline-alert inline-alert-danger"><p><?= tohtml($error) ?></p></div><?php } ?>
	<nav class="toolbar">
		<?php foreach (["overview" => _("Overview"), "customers" => _("Customers"), "services" => _("Services"), "domains" => _("Domains"), "nodes" => _("Nodes"), "reservations" => _("Reservations"), "jobs" => _("Jobs"), "support" => _("Support"), "audit" => _("Audit"), "billing" => _("Billing"), "trials" => _("Trials")] as $section => $label) { ?>
			<a class="button button-secondary" href="/list/managed/?section=<?= tohtml($section) ?>"><?= tohtml($label) ?></a>
		<?php } ?>
	</nav>
	<?php if (!empty($result["title"])) { ?><h2><?= tohtml(managed_service_text($result["title"])) ?></h2><?php } ?>
	<?php if ($columns && $rows) { ?>
		<div class="units-table"><div class="units-table-header"><?php foreach ($columns as $column) { ?><div class="units-table-cell"><?= tohtml($column["label"] ?: $column["key"]) ?></div><?php } ?></div>
			<?php foreach ($rows as $row) { ?><div class="units-table-row"><?php foreach ($columns as $column) { ?><div class="units-table-cell"><?= tohtml(managed_service_text($row[$column["key"]] ?? "")) ?></div><?php } ?></div><?php } ?>
		</div>
	<?php } ?>
	<?php if ($managed_section === "support" && !$supportCase) { foreach ($rows as $row) { $caseId = managed_service_uuid($row["id"] ?? null); if ($caseId !== null) { ?><p><a class="button button-secondary" href="/list/managed/?section=support&amp;record_id=<?= tohtml($caseId) ?>"><?= tohtml(_("Open support case")) ?></a></p><?php } } } ?>
	<?php if (is_array($result["trial_capacity"] ?? null)) { $capacity = $result["trial_capacity"]; ?><h2><?= tohtml(_("Trial capacity")) ?></h2><p><?= tohtml(sprintf(_("Running: %s  Reserved: %s  Waiting: %s"), managed_service_text($capacity["running_count"] ?? 0), managed_service_text($capacity["reserved_count"] ?? 0), managed_service_text($capacity["waiting_count"] ?? 0))) ?></p><form method="post"><input type="hidden" name="token" value="<?= tohtml($_SESSION["token"]) ?>"><input type="hidden" name="operation" value="set_trial_capacity"><input type="hidden" name="section" value="trials"><input type="hidden" name="idempotency_key" value="<?= tohtml($_SESSION["managed_request_id"]) ?>"><label><?= tohtml(_("Concurrent limit")) ?> <input type="number" min="0" max="2147483647" name="concurrent_limit" value="<?= tohtml(managed_service_text($capacity["concurrent_limit"] ?? 0)) ?>" required></label><button class="button button-secondary" type="submit"><?= tohtml(_("Save")) ?></button></form><?php } ?>
	<?php if ($supportCase) { ?><h2><?= tohtml(managed_service_text($supportCase["subject"] ?? _("Support case"))) ?></h2><?php foreach ($supportMessages as $message) { if (is_array($message)) { ?><p><strong><?= tohtml(managed_service_text($message["native_actor"] ?? "")) ?></strong><?php if (isset($message["created_at"])) { ?> <small><?= tohtml(managed_service_text($message["created_at"])) ?></small><?php } ?><br><?= nl2br(tohtml(managed_service_text($message["message"] ?? ""))) ?></p><?php } } ?>
		<?php if ($supportCaseId !== null) { ?><form method="post"><input type="hidden" name="token" value="<?= tohtml($_SESSION["token"]) ?>"><input type="hidden" name="section" value="support"><input type="hidden" name="record_id" value="<?= tohtml($supportCaseId) ?>"><input type="hidden" name="idempotency_key" value="<?= tohtml($_SESSION["managed_request_id"]) ?>"><textarea name="message" maxlength="10000" required></textarea><button name="operation" value="support_reply" class="button button-secondary"><?= tohtml(_("Reply")) ?></button></form><form method="post"><input type="hidden" name="token" value="<?= tohtml($_SESSION["token"]) ?>"><input type="hidden" name="section" value="support"><input type="hidden" name="record_id" value="<?= tohtml($supportCaseId) ?>"><input type="hidden" name="idempotency_key" value="<?= tohtml($_SESSION["managed_request_id"]) ?>"><input type="hidden" name="operation" value="support_status"><?php foreach (["open" => _("Reopen"), "waiting_on_customer" => _("Waiting on customer"), "waiting_on_staff" => _("Waiting on staff"), "resolved" => _("Resolve"), "closed" => _("Close")] as $status => $label) { ?><button name="status" value="<?= tohtml($status) ?>" class="button button-secondary"><?= tohtml($label) ?></button><?php } ?></form><?php } ?>
	<?php } ?>
</div>
