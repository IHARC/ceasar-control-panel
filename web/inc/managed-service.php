<?php

function managed_service_enabled(): bool {
	return ($_SESSION["MANAGED_SERVICES"] ?? "no") === "yes";
}

function managed_service_uuid(mixed $value): ?string {
	if (!is_string($value) || !preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $value)) return null;
	return strtolower($value);
}

function managed_service_text(mixed $value): string {
	if (is_string($value) || is_int($value) || is_float($value) || is_bool($value)) return (string) $value;
	if (!is_array($value) && !is_object($value)) return "";
	try {
		return json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
	} catch (JsonException) {
		return "";
	}
}

function managed_service_character_length(string $value): int {
	$characters = preg_match_all('/./us', $value);
	return $characters === false ? -1 : $characters;
}

function managed_service_authorized_session(): bool {
	$user = $_SESSION["user"] ?? null;
	return managed_service_enabled()
		&& ($_SESSION["userContext"] ?? null) === "admin"
		&& ($_SESSION["look"] ?? "") === ""
		&& is_string($user)
		&& preg_match('/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/', $user) === 1;
}

function managed_service_require_authorized_session(): void {
	if (!managed_service_authorized_session()) {
		throw new RuntimeException(_("Managed services require a direct administrator session. Sign in again."));
	}
}

function managed_service_section(mixed $value): ?string {
	$sections = ["overview", "customers", "services", "domains", "nodes", "reservations", "jobs", "support", "audit", "billing", "trials"];
	return is_string($value) && in_array($value, $sections, true) ? $value : null;
}

function managed_service_idempotency_key(array $input): string {
	$key = managed_service_uuid($input["idempotency_key"] ?? null);
	if ($key === null) throw new RuntimeException(_("Refresh the page before submitting this managed-service request."));
	return $key;
}

/** Build the finite native form protocol; browser values never pass through unchanged. */
function managed_service_form_request(array $input): array {
	$operation = $input["operation"] ?? null;
	$section = managed_service_section($input["section"] ?? null);
	if (!is_string($operation) || $section === null) throw new RuntimeException(_("The managed-service request is invalid."));
	if ($operation === "set_trial_capacity") {
		$limit = $input["concurrent_limit"] ?? null;
		if ($section !== "trials" || !is_string($limit) || !preg_match('/^(?:0|[1-9][0-9]*)$/', $limit) || (int) $limit > 2147483647) {
			throw new RuntimeException(_("Enter a non-negative whole number for trial capacity."));
		}
		return ["operation" => $operation, "section" => $section, "idempotency_key" => managed_service_idempotency_key($input), "payload" => ["concurrent_limit" => (int) $limit]];
	}

	$recordId = managed_service_uuid($input["record_id"] ?? null);
	if ($section !== "support" || $recordId === null) throw new RuntimeException(_("Select a valid support case."));
	if ($operation === "support_reply") {
		$message = $input["message"] ?? null;
		if (!is_string($message) || !($message = trim($message))) throw new RuntimeException(_("Enter a message of up to 10,000 characters."));
		$length = managed_service_character_length($message);
		if ($length < 1 || $length > 10000) throw new RuntimeException(_("Enter a message of up to 10,000 characters."));
		return ["operation" => $operation, "section" => $section, "record_id" => $recordId, "idempotency_key" => managed_service_idempotency_key($input), "payload" => ["message" => $message]];
	}
	$statuses = ["open", "waiting_on_customer", "waiting_on_staff", "resolved", "closed"];
	$status = $input["status"] ?? null;
	if ($operation !== "support_status" || !is_string($status) || !in_array($status, $statuses, true)) throw new RuntimeException(_("Choose a valid support status."));
	return ["operation" => $operation, "section" => $section, "record_id" => $recordId, "idempotency_key" => managed_service_idempotency_key($input), "payload" => ["status" => $status]];
}

function managed_service_read_request(array $input): array {
	$section = managed_service_section($input["section"] ?? "overview");
	if ($section === null) throw new RuntimeException(_("The requested managed-service view is unavailable."));
	$request = ["operation" => "read", "section" => $section];
	if (array_key_exists("record_id", $input)) {
		$recordId = managed_service_uuid($input["record_id"]);
		if ($recordId === null) throw new RuntimeException(_("The requested managed-service record is unavailable."));
		$request["record_id"] = $recordId;
	}
	return $request;
}

function managed_service_request(array $request): array {
	managed_service_require_authorized_session();
	$payload = json_encode($request, JSON_THROW_ON_ERROR);
	if (strlen($payload) > 32768) throw new RuntimeException(_("Managed-service request is too large."));
	$pipes = [];
	$process = proc_open(["/usr/bin/sudo", CEASAR_DIR_BIN . "v-managed-service", $_SESSION["user"]], [["pipe", "r"], ["pipe", "w"], ["pipe", "w"]], $pipes);
	if (!is_resource($process)) throw new RuntimeException(_("Managed-service adapter is unavailable."));
	fwrite($pipes[0], $payload);
	fclose($pipes[0]);
	$stdout = stream_get_contents($pipes[1]);
	fclose($pipes[1]);
	stream_get_contents($pipes[2]);
	fclose($pipes[2]);
	if (proc_close($process) !== 0) throw new RuntimeException(_("Managed-service request failed."));
	try {
		$result = json_decode($stdout, true, 512, JSON_THROW_ON_ERROR);
	} catch (JsonException) {
		throw new RuntimeException(_("Managed-service response is invalid."));
	}
	if (!is_array($result) || array_key_exists("error", $result)) throw new RuntimeException(_("Managed-service response is invalid."));
	return $result;
}
