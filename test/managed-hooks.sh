#!/usr/bin/env bash

set -eo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT

export CEASAR="$fixture/ceasar"
export ROOT_USER=admin
export user=fixture
source "$repo_root/func/main.sh"

quotaon() {
	printf '%s\n' 'group quota on / (/dev/root) is on'
	return 1
}
is_group_quota_enabled /

quotaon() {
	printf '%s\n' 'group quota on /other (/dev/root) is on'
}
if is_group_quota_enabled /; then
	echo 'group quota helper accepted a different mount' >&2
	exit 1
fi

WEBTPL="$fixture/templates/web"
WEB_SYSTEM=apache2
WEB_BACKEND=php-fpm
mkdir -p "$WEBTPL/apache2"
touch "$WEBTPL/apache2/iharc.tpl" "$WEBTPL/apache2/iharc.stpl"
source "$repo_root/func/domain.sh"
is_web_template_valid iharc

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

for relative in ("func/db.sh", "func/rebuild.sh"):
    lines = (root / relative).read_text(encoding="utf-8").splitlines()
    calls = [
        number
        for number, line in enumerate(lines, start=1)
        if "prepare_mysql_group_quota_dir" in line
        and not line.lstrip().startswith("#")
        and not line.rstrip().endswith("() {")
    ]
    for number in calls:
        nearby = lines[max(0, number - 7) : number]
        if not any("is_iharc_managed_user" in candidate for candidate in nearby):
            errors.append(f"{relative}:{number}: pooled database quota is not guarded by managed mode")

for relative in ("bin/v-add-user", "bin/v-delete-user", "bin/v-update-user-quota"):
    lines = (root / relative).read_text(encoding="utf-8").splitlines()
    for number, line in enumerate(lines, start=1):
        if "update_user_group_quota" not in line or line.lstrip().startswith("#"):
            continue
        nearby = lines[max(0, number - 7) : number]
        if not any("is_iharc_managed_user" in candidate for candidate in nearby):
            errors.append(f"{relative}:{number}: pooled group quota is not guarded by managed mode")

managed_storage_markers = {
    "bin/v-add-user": (
        "quota_useradd_options=(-e 1)",
        "usermod -e ''",
        'setfacl -m "u:www-data:--x"',
    ),
    "func/rebuild.sh": (
        "gpasswd -d",
        'setfacl -m "u:www-data:--x"',
    ),
}
for relative, markers in managed_storage_markers.items():
    lines = (root / relative).read_text(encoding="utf-8").splitlines()
    for number, line in enumerate(lines, start=1):
        if not any(marker in line for marker in markers):
            continue
        nearby = lines[max(0, number - 12) : number]
        if not any("is_iharc_managed_user" in candidate for candidate in nearby):
            errors.append(f"{relative}:{number}: managed storage policy is not guarded by managed mode")

database_sources = "\n".join(
    (root / relative).read_text(encoding="utf-8")
    for relative in ("func/db.sh", "bin/iharc-customer-isolation")
)
if "iharc-database-hosts.lock" in database_sources:
    errors.append("native database inventory still uses the managed-service lock namespace")

add_user_lines = (root / "bin/v-add-user").read_text(encoding="utf-8").splitlines()
useradd_line = next(
    (number for number, line in enumerate(add_user_lines, start=1) if "/usr/sbin/useradd" in line),
    None,
)
if useradd_line is None:
    errors.append("bin/v-add-user: missing useradd invocation")
else:
    pre_useradd = "\n".join(add_user_lines[: useradd_line - 1])
    if "is_group_quota_enabled" not in pre_useradd:
        errors.append("bin/v-add-user: managed group quota is not preflighted before useradd")
    if '[ "$DISK_QUOTA" != \'yes\' ]' not in pre_useradd:
        errors.append("bin/v-add-user: system disk quota state is not checked before useradd")

main_source = (root / "func/main.sh").read_text(encoding="utf-8")
if "is_group_quota_enabled()" not in main_source or 'quotaon -pa' not in main_source:
    errors.append("func/main.sh: managed group quota status helper is missing")

quota_installer = (root / "bin/v-add-sys-quota").read_text(encoding="utf-8")
if "linux-image-extra-virtual" in quota_installer:
    errors.append("bin/v-add-sys-quota: generic virtual-kernel quota fallback remains")
if 'linux-modules-extra-$(uname -r)' not in quota_installer:
    errors.append("bin/v-add-sys-quota: running-kernel module package is not selected")
if quota_installer.count("modprobe quota_v2") < 2:
    errors.append("bin/v-add-sys-quota: quota module is not retried after installation")

for suffix in ("tpl", "stpl"):
    managed_apache_template = root / f"install/deb/templates/web/apache2/iharc.{suffix}"
    if not managed_apache_template.is_file():
        errors.append(f"{managed_apache_template.relative_to(root)}: managed Apache template is missing")
        continue
    content = managed_apache_template.read_text(encoding="utf-8")
    if "<VirtualHost " not in content or "%backend_lsnr%" not in content:
        errors.append(f"{managed_apache_template.relative_to(root)}: managed Apache template cannot render a PHP vhost")
if errors:
    raise SystemExit("\n".join(errors))
PY

echo 'Managed hook mode and source audit passed.'
