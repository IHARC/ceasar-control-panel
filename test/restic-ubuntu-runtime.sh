#!/usr/bin/env bash
# Exercise the Ubuntu 24.04 Restic package and rclone's local backend. This is
# the production dependency contract for initializing a fresh remote prefix.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf -- "$fixture"' EXIT

version="$(restic version)"
[[ "$version" == restic\ 0.16.4\ * ]] || {
	echo "expected Ubuntu 24.04 Restic 0.16.4, got: $version" >&2
	exit 1
}

printf '[proof]\ntype = local\n' > "$fixture/rclone.conf"
printf 'correct horse battery staple\n' > "$fixture/password"
chmod 0600 "$fixture/password"
export RCLONE_CONFIG="$fixture/rclone.conf"
export WEBTPL="$fixture/templates"
source "$repo_root/func/backup.sh"
E_SYSTEM=1
repository="rclone:proof:$fixture/repository"

# A new rclone prefix is initialized and becomes readable.
ensure_restic_repository "$repository" "$fixture/password"
restic --repo "$repository" --password-file "$fixture/password" cat config > /dev/null

# An existing repository with a different password must not be reinitialized.
printf 'wrong password\n' > "$fixture/wrong-password"
chmod 0600 "$fixture/wrong-password"
config_before="$(sha256sum "$fixture/repository/config")"
set +e
ensure_restic_repository "$repository" "$fixture/wrong-password" > /dev/null 2> "$fixture/wrong-password.stderr"
wrong_password_status=$?
set -e
[[ "$wrong_password_status" -ne 0 ]]
[[ "$(sha256sum "$fixture/repository/config")" == "$config_before" ]]
grep -Fq 'wrong password or no key found' "$fixture/wrong-password.stderr"

# A corrupt existing config is also refused and left intact. Restic init owns
# this decision, so the panel never guesses whether a backend error is safe.
printf 'not a restic config\n' > "$fixture/repository/config"
config_before="$(sha256sum "$fixture/repository/config")"
set +e
ensure_restic_repository "$repository" "$fixture/password" > /dev/null 2> "$fixture/corrupt-config.stderr"
corrupt_config_status=$?
set -e
[[ "$corrupt_config_status" -ne 0 ]]
[[ "$(sha256sum "$fixture/repository/config")" == "$config_before" ]]
grep -Fq 'config file already exists' "$fixture/corrupt-config.stderr"

printf 'PASS: Ubuntu 24.04 Restic 0.16.4 safely initializes a new rclone repository and rejects existing invalid state\n'
