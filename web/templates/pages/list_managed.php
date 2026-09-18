<?php
$columns = [];
foreach (($result["columns"] ?? []) as $column) {
	$key = is_array($column) && isset($column["key"]) && is_string($column["key"]) && preg_match('/^[A-Za-z0-9_]{1,64}$/', $column["key"]) ? $column["key"] : null;
	if ($key !== null) $columns[] = ["key" => $key, "label" => managed_service_text($column["label"] ?? $key)];
}
$rows = is_array($result["rows"] ?? null) ? array_values(array_filter($result["rows"], "is_array")) : [];
?>
<div class="container">
	<h1><?= tohtml(_("Managed services")) ?></h1>
	<?php if ($notice !== "") { ?><div class="inline-alert inline-alert-success"><p><?= tohtml($notice) ?></p></div><?php } ?>
	<?php if ($error !== "") { ?><div class="inline-alert inline-alert-danger"><p><?= tohtml($error) ?></p></div><?php } ?>
	<nav class="toolbar">
		<?php foreach (["overview" => _("Overview"), "customers" => _("Customers"), "services" => _("Services"), "domains" => _("Domains"), "nodes" => _("Nodes"), "reservations" => _("Reservations"), "jobs" => _("Jobs"), "audit" => _("Audit"), "billing" => _("Billing"), "trials" => _("Trials")] as $section => $label) { ?>
			<a class="button button-secondary" href="/list/managed/?section=<?= tohtml($section) ?>"><?= tohtml($label) ?></a>
		<?php } ?>
	</nav>
	<?php if (!empty($result["title"])) { ?><h2><?= tohtml(managed_service_text($result["title"])) ?></h2><?php } ?>
	<?php if ($columns && $rows) { ?>
		<div class="units-table"><div class="units-table-header"><?php foreach ($columns as $column) { ?><div class="units-table-cell"><?= tohtml($column["label"] ?: $column["key"]) ?></div><?php } ?></div>
			<?php foreach ($rows as $row) { ?><div class="units-table-row"><?php foreach ($columns as $column) { ?><div class="units-table-cell"><?= tohtml(managed_service_text($row[$column["key"]] ?? "")) ?></div><?php } ?></div><?php } ?>
		</div>
	<?php } ?>
	<?php if (is_array($result["trial_capacity"] ?? null)) { $capacity = $result["trial_capacity"]; ?><h2><?= tohtml(_("Trial capacity")) ?></h2><p><?= tohtml(sprintf(_("Running: %s  Reserved: %s  Waiting: %s"), managed_service_text($capacity["running_count"] ?? 0), managed_service_text($capacity["reserved_count"] ?? 0), managed_service_text($capacity["waiting_count"] ?? 0))) ?></p><form method="post"><input type="hidden" name="token" value="<?= tohtml($_SESSION["token"]) ?>"><input type="hidden" name="operation" value="set_trial_capacity"><input type="hidden" name="section" value="trials"><input type="hidden" name="idempotency_key" value="<?= tohtml($_SESSION["managed_request_id"]) ?>"><label><?= tohtml(_("Concurrent limit")) ?> <input type="number" min="0" max="2147483647" name="concurrent_limit" value="<?= tohtml(managed_service_text($capacity["concurrent_limit"] ?? 0)) ?>" required></label><button class="button button-secondary" type="submit"><?= tohtml(_("Save")) ?></button></form><?php } ?>
</div>
