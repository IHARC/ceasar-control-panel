<?php
declare(strict_types=1);

function ceasar_quick_install_options(string $app, array $data): array {
	if (!array_key_exists("webapp_generate_password", $data)) {
		return $data;
	}
	if (
		$app !== "WordPress" ||
		$data["webapp_generate_password"] !== "true" ||
		!empty($data["webapp_password"])
	) {
		throw new InvalidArgumentException("Invalid generated password option.");
	}
	unset($data["webapp_generate_password"]);
	$data["webapp_password"] = bin2hex(random_bytes(24));
	return $data;
}
