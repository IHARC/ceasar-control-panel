#!/bin/bash

set -euo pipefail

version='1.0.24'
commit=''
deb_dir=''
output_dir=''
release_base_url='https://github.com/IHARC/ceasar-control-panel/releases/download/v1.0.24'

while [ "$#" -gt 0 ]; do
	case "$1" in
		--version)
			version=$2
			shift 2
			;;
		--commit)
			commit=$2
			shift 2
			;;
		--deb-dir)
			deb_dir=$2
			shift 2
			;;
		--output-dir)
			output_dir=$2
			shift 2
			;;
		--release-base-url)
			release_base_url=$2
			shift 2
			;;
		*)
			echo "Unknown option: $1" >&2
			exit 2
			;;
	esac
done

if ! [[ "$commit" =~ ^[0-9a-f]{40}$ ]]; then
	echo "--commit must be an exact lowercase 40-character Git commit." >&2
	exit 2
fi
if [ ! -d "$deb_dir" ] || [ -z "$output_dir" ]; then
	echo "--deb-dir and --output-dir are required." >&2
	exit 2
fi
command -v zstd > /dev/null 2>&1 || {
	echo "zstd is required." >&2
	exit 2
}

mkdir -p "$output_dir"
output_dir="$(cd "$output_dir" && pwd)"
deb_dir="$(cd "$deb_dir" && pwd)"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/packages"

packages=(ceasar ceasar-nginx ceasar-php ceasar-web-terminal)
for package in "${packages[@]}"; do
	mapfile -t matches < <(find "$deb_dir" -maxdepth 1 -type f -name "${package}_*.deb" -print)
	if [ "${#matches[@]}" -ne 1 ]; then
		echo "Expected exactly one ${package} package, found ${#matches[@]}." >&2
		exit 1
	fi
	actual_package="$(dpkg-deb -f "${matches[0]}" Package)"
	actual_arch="$(dpkg-deb -f "${matches[0]}" Architecture)"
	[ "$actual_package" = "$package" ] || {
		echo "Unexpected package identity: ${matches[0]}" >&2
		exit 1
	}
	[ "$actual_arch" = 'amd64' ] || {
		echo "Unexpected package architecture: ${matches[0]}" >&2
		exit 1
	}
	cp "${matches[0]}" "$stage/packages/"
done

cp "$(cd "$(dirname "$0")/.." && pwd)/install/ceasar-install.sh" "$stage/install.sh"
chmod 0755 "$stage/install.sh"

python3 - "$stage" "$version" "$commit" << 'PY'
import hashlib
import json
import pathlib
import sys

stage = pathlib.Path(sys.argv[1])
version = sys.argv[2]
commit = sys.argv[3]
packages = []
for path in sorted((stage / "packages").glob("*.deb")):
    packages.append(
        {
            "filename": path.name,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        }
    )
manifest = {
    "schemaVersion": 1,
    "version": version,
    "commit": commit,
    "platform": {
        "os": "ubuntu",
        "version": "24.04",
        "architecture": "amd64",
    },
    "packages": packages,
}
(stage / "ceasar-release.json").write_text(
    json.dumps(manifest, indent=2, sort_keys=True) + "\n",
    encoding="utf-8",
)
PY

bundle_name="ceasar-${version}-ubuntu24.04-amd64.tar.zst"
bundle="$output_dir/$bundle_name"
tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner \
	--zstd -cf "$bundle" -C "$stage" .
bundle_sha256="$(sha256sum "$bundle" | awk '{print $1}')"
printf '%s  %s\n' "$bundle_sha256" "$bundle_name" > "$output_dir/SHA256SUMS"

python3 - "$output_dir/ceasar-release-lock.json" "$version" "$commit" \
	"${release_base_url%/}/$bundle_name" "$bundle_name" "$bundle_sha256" << 'PY'
import json
import pathlib
import sys

lock = {
    "schema": 1,
    "ceasar_version": sys.argv[2],
    "commit": sys.argv[3],
    "platform": "ubuntu24.04",
    "architecture": "amd64",
    "artifact": {
        "url": sys.argv[4],
        "filename": sys.argv[5],
        "sha256": sys.argv[6],
    },
}
pathlib.Path(sys.argv[1]).write_text(
    json.dumps(lock, indent=2, sort_keys=True) + "\n",
    encoding="utf-8",
)
PY

printf '%s\n' "$bundle"
