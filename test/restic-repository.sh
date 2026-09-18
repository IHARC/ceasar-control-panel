#!/usr/bin/env bash
# Focused Restic repository initialization behavior. It exercises the native
# helper with the legacy 0.16 exit-1 diagnostic and newer exit-10 contract
# without contacting a provider or creating an account.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf -- "$fixture"' EXIT

source "$repo_root/func/backup.sh"
E_SYSTEM=1

calls="$fixture/calls"
restic() {
	printf '%s\n' "$*" >> "$calls"
	if [[ "$*" == *' cat config' ]]; then
		printf '%s\n' "${RESTIC_PROBE_ERROR:-}" >&2
		return "${RESTIC_PROBE_STATUS:-0}"
	fi
	if [[ "$*" == *' init' ]]; then
		return "${RESTIC_INIT_STATUS:-0}"
	fi
	echo "unexpected restic command: $*" >&2
	return 99
}

assert_init() {
	grep -Fq ' init' "$calls" || {
		echo 'expected repository initialization' >&2
		exit 1
	}
}

assert_no_init() {
	if grep -Fq ' init' "$calls"; then
		echo 'unexpected repository initialization' >&2
		exit 1
	fi
}

run_case() {
	: > "$calls"
	set +e
	ensure_restic_repository 'rclone:example:repo/user' "$fixture/password" > /dev/null 2> "$fixture/stderr"
	status=$?
	set -e
}

# A failed probe resumes a first backup by using Restic's safe init contract.
RESTIC_PROBE_STATUS=1
RESTIC_PROBE_ERROR='Fatal: unable to open config file'
RESTIC_INIT_STATUS=0
run_case
[[ "$status" -eq 0 ]] || {
	cat "$fixture/stderr" >&2
	exit 1
}
assert_init

# Restic 0.17+ has a dedicated exit code and does not depend on error text.
RESTIC_PROBE_STATUS=10
RESTIC_PROBE_ERROR='repository missing'
run_case
[[ "$status" -eq 0 ]] || {
	cat "$fixture/stderr" >&2
	exit 1
}
assert_init

# Failed probes attempt Restic init, which must refuse existing/inaccessible
# repositories instead of replacing them.
RESTIC_PROBE_STATUS=1
RESTIC_PROBE_ERROR='Fatal: wrong password or no key found'
RESTIC_INIT_STATUS=1
run_case
[[ "$status" -eq 1 ]] || exit 1
assert_init

RESTIC_PROBE_STATUS=1
RESTIC_PROBE_ERROR='Fatal: unable to open config file: dial tcp: network is unreachable'
RESTIC_INIT_STATUS=17
run_case
[[ "$status" -eq 17 ]] || exit 1
assert_init

RESTIC_PROBE_STATUS=1
RESTIC_PROBE_ERROR='Fatal: unable to open config file'
RESTIC_INIT_STATUS=17
run_case
[[ "$status" -eq 17 ]] || exit 1
assert_init

printf 'PASS: Restic repository initialization delegates failed probes to safe native init\n'

WEBTPL="$fixture/templates"
mkdir -p "$WEBTPL/apache2/php-fpm"
touch "$WEBTPL/apache2/iharc.tpl" "$WEBTPL/apache2/iharc.stpl"
touch "$WEBTPL/apache2/php-fpm/default.tpl" "$WEBTPL/apache2/php-fpm/default.stpl"

[[ "$(backup_web_template_dir apache2 php-fpm iharc)" == "$WEBTPL/apache2" ]] \
	|| {
		echo 'root-level PHP-FPM-compatible template was not selected' >&2
		exit 1
	}
[[ "$(backup_web_template_dir apache2 php-fpm default)" == "$WEBTPL/apache2/php-fpm" ]] \
	|| {
		echo 'PHP-FPM template was not selected' >&2
		exit 1
	}
if backup_web_template_dir apache2 php-fpm missing > /dev/null; then
	echo 'missing template was accepted' >&2
	exit 1
fi

printf 'PASS: backup template selection supports IHARC and standard PHP-FPM templates\n'
