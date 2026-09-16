#!/usr/bin/env bash

set -eo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT

export CEASAR="$fixture/ceasar"
export ROOT_USER=admin
export user=fixture
source "$repo_root/func/main.sh"

marker="$fixture/invoked"
fake_hook() {
	printf '%s\n' "${hook_label:?}" >> "$marker"
	return 37
}
guard_resource_hook() {
	if is_iharc_managed_user "$1"; then
		fake_hook
	fi
}
guard_authority_hook() {
	if is_iharc_managed_authority_user "$1"; then
		fake_hook
	fi
}
guard_global_hook() {
	if managed_services_enabled; then
		fake_hook
	fi
}

assert_standalone_skips_hooks() {
	rm -f "$marker"
	for account in ordinary "$ROOT_USER" ih0123456789abcd; do
		hook_label="resource:$account" guard_resource_hook "$account"
		hook_label="authority:$account" guard_authority_hook "$account"
	done
	hook_label=global guard_global_hook
	[[ ! -e "$marker" ]]
}

unset MANAGED_SERVICES
assert_standalone_skips_hooks
MANAGED_SERVICES=no
assert_standalone_skips_hooks

MANAGED_SERVICES=yes
rm -f "$marker"
hook_label=ordinary guard_resource_hook ordinary
hook_label=ordinary guard_authority_hook ordinary
[[ ! -e "$marker" ]]

assert_managed_failure_propagates() {
	local expected=$1
	shift
	rm -f "$marker"
	set +e
	hook_label="$expected" "$@"
	status=$?
	set -e
	[[ "$status" -eq 37 ]]
	[[ "$(cat "$marker")" == "$expected" ]]
}

assert_managed_failure_propagates resource:ih0123456789abcd guard_resource_hook ih0123456789abcd
assert_managed_failure_propagates authority:admin guard_authority_hook admin
assert_managed_failure_propagates global guard_global_hook

python3 - "$repo_root" << 'PY'
import pathlib
import re
import sys

root = pathlib.Path(sys.argv[1])
automatic = [path for path in (root / "bin").glob("v-*") if not path.name.startswith("v-iharc-")]
hook_pattern = re.compile(
    r"iharc-customer-isolation|iharc-haproxy-cert-sync|"
    r"v-iharc-transfer-policy|iharc-transfer-uid-floor|(?:WEB_TEMPLATE|PROXY_TEMPLATE|template)=iharc"
)
canonical_pattern = re.compile(r"\^ih\[0-9a-f\]\{14\}\$")
gate_pattern = re.compile(
    r"\b(?:managed_services_enabled|is_iharc_managed_user|is_iharc_managed_authority_user)\b"
)
expected_files = {
    "v-add-database",
    "v-add-user",
    "v-add-web-domain",
    "v-add-web-domain-alias",
    "v-add-web-domain-ssl",
    "v-backup-user",
    "v-change-web-domain-backend-tpl",
    "v-change-web-domain-name",
    "v-change-web-domain-tpl",
    "v-delete-user",
    "v-delete-web-domain",
    "v-delete-web-domain-alias",
    "v-rebuild-web-domain",
    "v-rebuild-web-domains",
    "v-restart-service",
    "v-restore-user",
    "v-restore-user-restic",
    "v-restore-web-domain-restic",
    "v-suspend-user",
    "v-unsuspend-user",
    "v-update-web-domain-ssl",
}

found_files = set()
errors = []
for path in automatic:
    lines = path.read_text(encoding="utf-8").splitlines()
    for number, line in enumerate(lines, start=1):
        if canonical_pattern.search(line):
            errors.append(f"{path.name}:{number}: automatic hook retains a raw IHARC username branch")
        if line.lstrip().startswith("#") or not hook_pattern.search(line):
            continue
        found_files.add(path.name)
        start = max(0, number - 7)
        nearby = lines[start:number]
        if not any(gate_pattern.search(candidate) for candidate in nearby):
            errors.append(f"{path.name}:{number}: IHARC hook is not guarded by managed mode")

if found_files != expected_files:
    errors.append(
        "automatic IHARC hook file set changed: "
        f"missing={sorted(expected_files - found_files)!r} extra={sorted(found_files - expected_files)!r}"
    )
if errors:
    raise SystemExit("\n".join(errors))
PY

echo 'Managed hook mode and source audit passed.'
