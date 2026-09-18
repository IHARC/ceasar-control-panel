#!/bin/bash

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
installer="$repo_root/install/ceasar-install.sh"
tmp_dir="$(mktemp -d)"
legacy_dir='/usr/local/hestia'
legacy_created='no'

cleanup() {
	rm -rf "$tmp_dir"
	if [ "$legacy_created" = 'yes' ] && [ -d "$legacy_dir" ]; then
		rmdir "$legacy_dir"
	fi
}
trap cleanup EXIT

grep -Fxq 'umask 022' "$installer"
grep -Fq 'apt-mark hold "${local_ceasar_package_names[@]}"' "$installer"
grep -Fq 'apt-mark unhold "${local_ceasar_package_names[@]}"' "$installer"
if grep -Fq 'apt-get -y upgrade >> "$LOG" &' "$installer"; then
	echo 'Installer must not return while a background package upgrade is still running.' >&2
	exit 1
fi

cat > "$tmp_dir/noble" << 'EOF'
ID=ubuntu
VERSION_ID="24.04"
VERSION_CODENAME=noble
EOF
cat > "$tmp_dir/jammy" << 'EOF'
ID=ubuntu
VERSION_ID="22.04"
VERSION_CODENAME=jammy
EOF

run_installer() {
	local os_release=$1
	local architecture=$2
	shift 2
	CEASAR_OS_RELEASE_FILE="$os_release" CEASAR_ARCH="$architecture" \
		bash "$installer" --validate-only "$@"
}

expect_failure() {
	local expected=$1
	shift
	local output
	if output="$("$@" 2>&1)"; then
		echo "Expected installer validation to fail: $*" >&2
		exit 1
	fi
	grep -Fq "$expected" <<< "$output" || {
		printf 'Expected error containing %q, got:\n%s\n' "$expected" "$output" >&2
		exit 1
	}
}

run_installer "$tmp_dir/noble" amd64 --public-address 203.0.113.10 \
	| grep -Fq 'Ceasar platform validation passed: Ubuntu 24.04 amd64.'
run_installer "$tmp_dir/noble" amd64 --managed-profile "$repo_root/release/install-profile.example.json" \
	| grep -Fq 'Ceasar platform validation passed: Ubuntu 24.04 amd64.'
run_installer "$tmp_dir/noble" amd64 --managed-profile "$repo_root/release/iharc-profile.example.json" \
	| grep -Fq 'Ceasar platform validation passed: Ubuntu 24.04 amd64.'

python3 - "$repo_root/release/iharc-profile.example.json" "$tmp_dir" << 'PY'
import json
import pathlib
import sys

profile = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
profile["customer"].update(password_min_length=6)
directory = pathlib.Path(sys.argv[2])
(directory / "customer-password.json").write_text(json.dumps(profile), encoding="utf-8")
for field, value in [("password_min_length", True), ("brand_name", "Legacy Brand"), ("support_url", "https://example.com/support")]:
    invalid = json.loads(json.dumps(profile))
    invalid["customer"][field] = value
    (directory / f"customer-invalid-{field}.json").write_text(json.dumps(invalid), encoding="utf-8")
PY
run_installer "$tmp_dir/noble" amd64 --managed-profile "$tmp_dir/customer-password.json" \
	| grep -Fq 'Ceasar platform validation passed: Ubuntu 24.04 amd64.'
for field in password_min_length brand_name support_url; do
	expect_failure "customer.$field" \
		run_installer "$tmp_dir/noble" amd64 --managed-profile "$tmp_dir/customer-invalid-$field.json"
done

python3 - "$repo_root/release/iharc-profile.example.json" "$tmp_dir/customer-callback-host.json" << 'PY'
import json
import pathlib
import sys

profile = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
profile["customer"]["passkey_rp_id"] = "example.com"
profile["customer"]["callback_url"] = "https://login.example.com/auth/callback"
pathlib.Path(sys.argv[2]).write_text(json.dumps(profile), encoding="utf-8")
PY
run_installer "$tmp_dir/noble" amd64 --managed-profile "$tmp_dir/customer-callback-host.json" \
	| grep -Fq 'Ceasar platform validation passed: Ubuntu 24.04 amd64.'

python3 - "$tmp_dir/customer-callback-host.json" "$tmp_dir/customer-provider-api.json" << 'PY'
import json
import pathlib
import sys

profile = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
profile["customer"]["worker_api_base"] = "/api/provider/v2/customer/"
pathlib.Path(sys.argv[2]).write_text(json.dumps(profile), encoding="utf-8")
PY
run_installer "$tmp_dir/noble" amd64 --managed-profile "$tmp_dir/customer-provider-api.json" \
	| grep -Fq 'Ceasar platform validation passed: Ubuntu 24.04 amd64.'

python3 - "$tmp_dir/customer-callback-host.json" "$tmp_dir/customer-worker-api-invalid.json" << 'PY'
import json
import pathlib
import sys

profile = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
profile["customer"]["worker_api_base"] = "https://attacker.example/customer"
pathlib.Path(sys.argv[2]).write_text(json.dumps(profile), encoding="utf-8")
PY
expect_failure 'customer.worker_api_base must be a same-origin path' \
	run_installer "$tmp_dir/noble" amd64 --managed-profile "$tmp_dir/customer-worker-api-invalid.json"

python3 - "$tmp_dir/customer-callback-host.json" "$tmp_dir/customer-account-origin-invalid.json" << 'PY'
import json
import pathlib
import sys

profile = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
profile["customer"]["account_url"] = "https://account.example.com/customer/account"
pathlib.Path(sys.argv[2]).write_text(json.dumps(profile), encoding="utf-8")
PY
expect_failure 'customer login and account URLs must share one origin' \
	run_installer "$tmp_dir/noble" amd64 --managed-profile "$tmp_dir/customer-account-origin-invalid.json"

python3 - "$tmp_dir/customer-callback-host.json" "$tmp_dir/customer-callback-rp-invalid.json" << 'PY'
import json
import pathlib
import sys

profile = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
profile["customer"]["callback_url"] = "https://login.other.example/auth/callback"
pathlib.Path(sys.argv[2]).write_text(json.dumps(profile), encoding="utf-8")
PY
expect_failure 'customer.passkey_rp_id must cover the login, account, and callback hostnames' \
	run_installer "$tmp_dir/noble" amd64 --managed-profile "$tmp_dir/customer-callback-rp-invalid.json"

python3 - "$tmp_dir/customer-callback-host.json" "$tmp_dir/customer-callback-scheme-invalid.json" << 'PY'
import json
import pathlib
import sys

profile = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
profile["customer"]["callback_url"] = "http://login.example.com/auth/callback"
pathlib.Path(sys.argv[2]).write_text(json.dumps(profile), encoding="utf-8")
PY
expect_failure 'customer.callback_url must be an HTTPS URL without credentials' \
	run_installer "$tmp_dir/noble" amd64 --managed-profile "$tmp_dir/customer-callback-scheme-invalid.json"

expect_failure 'supports only Ubuntu 24.04 LTS' \
	run_installer "$tmp_dir/jammy" amd64
expect_failure 'supports only amd64 systems' \
	run_installer "$tmp_dir/noble" arm64
expect_failure 'public address must be a valid IPv4 address' \
	run_installer "$tmp_dir/noble" amd64 --public-address 203.0.113.999

[ ! -e "$legacy_dir" ] || {
	echo "Legacy rejection test requires a disposable container without $legacy_dir." >&2
	exit 1
}
mkdir "$legacy_dir"
legacy_created='yes'
expect_failure 'existing Hestia installation was detected' \
	run_installer "$tmp_dir/noble" amd64
rmdir "$legacy_dir"
legacy_created='no'

echo 'Ceasar installer validation tests passed.'
