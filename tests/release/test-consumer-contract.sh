#!/bin/bash

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
release_workflow="$repo_root/.github/workflows/release.yml"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

python3 - "$release_workflow" << 'PY'
import pathlib
import sys

workflow = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
required = (
    "id: draft_release",
    "tag_name: v${{ steps.identity.outputs.version }}",
    "RELEASE_ID: ${{ steps.draft_release.outputs.id }}",
    "Publish verified immutable GitHub release",
    'gh api --method PATCH "repos/${GITHUB_REPOSITORY}/releases/${RELEASE_ID}"',
)
for value in required:
    if value not in workflow:
        raise SystemExit(f"release workflow must publish the exact verified draft: {value}")
PY

deb_dir="$tmp_dir/debs"
output_dir="$tmp_dir/output"
release_root="$tmp_dir/release"
profile="$tmp_dir/etc/iharc/ceasar-managed-hosting.json"
commit='0123456789abcdef0123456789abcdef01234567'
mkdir -p "$deb_dir" "$output_dir" "$(dirname "$profile")"
cp "$repo_root/release/iharc-profile.example.json" "$profile"

make_package() {
	local name=$1
	local version=$2
	local root="$tmp_dir/package-$name"
	mkdir -p "$root/DEBIAN" "$root/usr/share/$name"
	cat > "$root/DEBIAN/control" << EOF
Package: $name
Version: $version
Architecture: amd64
Maintainer: Ceasar release test
Description: Minimal package for the Ceasar producer-consumer contract test
EOF
	printf '%s\n' "$name" > "$root/usr/share/$name/identity"
	dpkg-deb --root-owner-group --build "$root" "$deb_dir/${name}_${version}_amd64.deb" > /dev/null
}

make_package ceasar '1.0.25-1+ubuntu24.04'
make_package ceasar-nginx '1.30.4-1+ubuntu24.04'
make_package ceasar-php '8.5.9-1+ubuntu24.04'
make_package ceasar-web-terminal '1.0.25-1+ubuntu24.04'

bash "$repo_root/release/build-release.sh" \
	--version 1.0.25 \
	--commit "$commit" \
	--deb-dir "$deb_dir" \
	--output-dir "$output_dir" > /dev/null

mkdir -p "$release_root"
tar --zstd -xf "$output_dir/ceasar-1.0.25-ubuntu24.04-amd64.tar.zst" -C "$release_root"
test -x "$release_root/install.sh"

mapfile -t root_entries < <(find "$release_root" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort)
expected_entries=(ceasar-release.json install.sh packages)
[ "${root_entries[*]}" = "${expected_entries[*]}" ] || {
	printf 'Unexpected release archive root: %s\n' "${root_entries[*]}" >&2
	exit 1
}

python3 - "$release_root" "$commit" << 'PY'
import hashlib
import json
import pathlib
import re
import sys

root = pathlib.Path(sys.argv[1])
expected_commit = sys.argv[2]
manifest = json.loads((root / "ceasar-release.json").read_text(encoding="utf-8"))
if set(manifest) != {"schemaVersion", "version", "commit", "platform", "packages"}:
    raise SystemExit("manifest top-level fields do not match the private v1 consumer")
if manifest["schemaVersion"] != 1 or manifest["version"] != "1.0.25":
    raise SystemExit("manifest version contract mismatch")
if manifest["commit"] != expected_commit or not re.fullmatch(r"[0-9a-f]{40}", manifest["commit"]):
    raise SystemExit("manifest commit contract mismatch")
if manifest["platform"] != {"os": "ubuntu", "version": "24.04", "architecture": "amd64"}:
    raise SystemExit("manifest platform contract mismatch")

packages = manifest["packages"]
if not isinstance(packages, list) or len(packages) != 4:
    raise SystemExit("manifest must contain exactly four packages")
manifest_files = set()
for package in packages:
    if not isinstance(package, dict) or set(package) != {"filename", "sha256"}:
        raise SystemExit("package object fields do not match the private v1 consumer")
    filename = package["filename"]
    digest = package["sha256"]
    if pathlib.Path(filename).name != filename or not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise SystemExit("invalid package filename or digest")
    path = root / "packages" / filename
    if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        raise SystemExit(f"package digest mismatch: {filename}")
    manifest_files.add(filename)

actual_files = {path.name for path in (root / "packages").iterdir() if path.is_file()}
if actual_files != manifest_files:
    raise SystemExit("packages directory does not exactly match the manifest")
PY

cat > "$tmp_dir/os-release" << 'EOF'
ID=ubuntu
VERSION_ID="24.04"
VERSION_CODENAME=noble
EOF

CEASAR_OS_RELEASE_FILE="$tmp_dir/os-release" CEASAR_ARCH=amd64 \
	bash "$release_root/install.sh" \
	--non-interactive \
	--packages "$release_root/packages" \
	--managed-profile "$profile" \
	--validate-only \
	| grep -Fq 'Ceasar platform validation passed: Ubuntu 24.04 amd64.'

echo 'Ceasar producer-consumer release contract passed.'
