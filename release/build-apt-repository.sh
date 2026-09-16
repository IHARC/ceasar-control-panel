#!/bin/bash

set -euo pipefail

readonly expected_fingerprint='CA9AA1D56C448BF5EEB0FB0A2A3C8C6E0AF11058'
deb_dir=${1:?deb directory is required}
site_dir=${2:?Pages site directory is required}
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
apt_dir="$site_dir/apt"

command -v reprepro > /dev/null 2>&1 || {
	echo "reprepro is required." >&2
	exit 2
}
public_fingerprint="$(gpg --batch --show-keys --with-colons "$repo_root/release/ceasar-archive-keyring.asc" \
	| awk -F: '$1 == "fpr" {print $10; exit}')"
[ "$public_fingerprint" = "$expected_fingerprint" ] || {
	echo "Ceasar public APT key fingerprint does not match the release contract." >&2
	exit 1
}
secret_fingerprint="$(gpg --batch --with-colons --fingerprint --list-secret-keys "$expected_fingerprint" \
	| awk -F: '$1 == "fpr" {print $10; exit}')"
[ "$secret_fingerprint" = "$expected_fingerprint" ] || {
	echo "Ceasar APT signing secret for $expected_fingerprint is unavailable." >&2
	exit 1
}

rm -rf "$apt_dir"
mkdir -p "$apt_dir/conf"
cat > "$apt_dir/conf/distributions" << EOF
Origin: Ceasar
Label: Ceasar
Suite: stable
Codename: noble
Architectures: amd64
Components: main
Description: Ceasar packages for Ubuntu 24.04 amd64
SignWith: $expected_fingerprint
EOF

for package in ceasar ceasar-nginx ceasar-php ceasar-web-terminal; do
	mapfile -t matches < <(find "$deb_dir" -maxdepth 1 -type f -name "${package}_*.deb" -print)
	[ "${#matches[@]}" -eq 1 ] || {
		echo "Expected exactly one ${package} package." >&2
		exit 1
	}
	reprepro --basedir "$apt_dir" includedeb noble "${matches[0]}"
done

cp "$repo_root/release/ceasar-archive-keyring.asc" "$apt_dir/ceasar-archive-keyring.asc"
gpg --batch --yes --output "$apt_dir/ceasar-archive-keyring.gpg" --export "$expected_fingerprint"
test -s "$apt_dir/dists/noble/InRelease"
test -s "$apt_dir/dists/noble/Release.gpg"
test -s "$apt_dir/ceasar-archive-keyring.gpg"
