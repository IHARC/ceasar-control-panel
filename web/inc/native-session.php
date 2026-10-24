<?php
declare(strict_types=1);

/** Initialize exactly the same ordinary panel session after password login or a consumed grant. */
function native_begin_user_session(
	string $user,
	array $data,
	bool $retainRequestedPage = false,
): void {
	$requested = $retainRequestedPage ? $_SESSION["request_uri"] ?? null : null;
	$_SESSION = []; // Drop prior admin impersonation, MFA, login and policy state.
	load_ceasar_config();
	if (empty($_SESSION["VERSION"])) {
		throw new RuntimeException("Panel configuration unavailable.");
	}
	$_SESSION["user"] = $user;
	$_SESSION["userContext"] = $data["ROLE"];
	$_SESSION["role"] = $data["ROLE"];
	$_SESSION["login_shell"] = $data["SHELL"] ?? "nologin";
	$_SESSION["LAST_ACTIVITY"] = time();
	$_SESSION["user_combined_ip"] = get_real_user_ip();
	$_SESSION["userTheme"] = $data["THEME"] ?? "default";
	if (($_SESSION["POLICY_USER_CHANGE_THEME"] ?? "no") !== "yes") {
		unset($_SESSION["userTheme"]);
	}
	$_SESSION["userSortOrder"] = !empty($data["PREF_UI_SORT"]) ? $data["PREF_UI_SORT"] : "name";
	$output = [];
	$returnCode = 0;
	exec(CEASAR_CMD . "v-list-sys-languages json", $output, $returnCode);
	$languages = $returnCode === 0 ? json_decode(implode("", $output), true) : null;
	$_SESSION["language"] =
		is_array($languages) && in_array($data["LANGUAGE"] ?? "", $languages, true)
			? $data["LANGUAGE"]
			: "en";
	$_SESSION["token"] = bin2hex(random_bytes(16));
	if (
		is_string($requested) &&
		str_starts_with($requested, "/") &&
		!str_starts_with($requested, "//")
	) {
		$_SESSION["request_uri"] = $requested;
	}
	session_regenerate_id(true);
}
