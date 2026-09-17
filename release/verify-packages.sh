#!/bin/bash

set -euo pipefail

deb_dir=${1:?deb directory is required}
expected_commit=${2:?exact source commit is required}
if ! [[ "$expected_commit" =~ ^[0-9a-f]{40}$ ]]; then
	echo "Expected commit must contain exactly 40 lowercase hexadecimal characters." >&2
	exit 2
fi

packages=(ceasar ceasar-nginx ceasar-php ceasar-web-terminal)
declare -A package_files
for package in "${packages[@]}"; do
	mapfile -t matches < <(find "$deb_dir" -maxdepth 1 -type f -name "${package}_*.deb" -print)
	[ "${#matches[@]}" -eq 1 ] || {
		echo "Expected exactly one ${package} package." >&2
		exit 1
	}
	[ "$(dpkg-deb -f "${matches[0]}" Package)" = "$package" ] || exit 1
	[ "$(dpkg-deb -f "${matches[0]}" Architecture)" = 'amd64' ] || exit 1
	package_files[$package]="${matches[0]}"
done

core_listing="$(dpkg-deb -c "${package_files[ceasar]}")"
for required in \
	'./usr/local/ceasar/bin/' \
	'./usr/local/ceasar/func/' \
	'./usr/local/ceasar/install/' \
	'./usr/local/ceasar/libexec/iharc/' \
	'./usr/local/ceasar/vendor/filegator/filegator_v7.15.1.zip' \
	'./usr/local/ceasar/vendor/phppgadmin/phppgadmin-7.14.6.tar.gz' \
	'./usr/local/ceasar/web/inc/vendor/autoload.php' \
	'./usr/local/ceasar/web/src/vendor/autoload.php' \
	'./usr/local/ceasar/share/build-info.json'; do
	grep -Fq "$required" <<< "$core_listing" || {
		echo "Core package is missing $required" >&2
		exit 1
	}
done
if grep -Eiq '/(usr/local|etc|var/(log|run)|lib/systemd/system)/[^ ]*hestia' <<< "$core_listing"; then
	echo "Core package contains a legacy Hestia runtime path." >&2
	exit 1
fi

root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT
dpkg-deb -x "${package_files[ceasar]}" "$root"
dpkg-deb -x "${package_files["ceasar-nginx"]}" "$root"
dpkg-deb -x "${package_files["ceasar-php"]}" "$root"

grep -Eq '^[[:space:]]*absolute_redirect[[:space:]]+off;' \
	"$root/usr/local/ceasar/nginx/conf/nginx.conf"

python3 - "$root/usr/local/ceasar/share/build-info.json" "$expected_commit" << 'PY'
import json
import pathlib
import sys

data = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
expected = {
    "schema": 1,
    "version": "1.0.16",
    "commit": sys.argv[2],
    "platform": "ubuntu24.04",
    "architecture": "amd64",
}
if data != expected:
    raise SystemExit(f"unexpected build identity: {data!r}")
PY

php_bin="$root/usr/local/ceasar/php/bin/php"
fpm_bin="$root/usr/local/ceasar/php/sbin/ceasar-php"
php_ini="$root/usr/local/ceasar/php/lib/php.ini"
[ -x "$php_bin" ] && [ -x "$fpm_bin" ] && [ -f "$php_ini" ]
"$php_bin" -c "$php_ini" -r 'exit(PHP_VERSION === "8.5.9" ? 0 : 1);'
"$fpm_bin" -v | grep -Fq 'PHP 8.5.9'

composer_bin="${COMPOSER_BIN:-$(command -v composer)}"
[ -n "$composer_bin" ] && [ -f "$composer_bin" ]
for tree in \
	"$root/usr/local/ceasar/web/inc" \
	"$root/usr/local/ceasar/web/src"; do
	"$php_bin" -c "$php_ini" "$composer_bin" \
		--no-interaction --working-dir="$tree" check-platform-reqs --no-dev
done

"$php_bin" -c "$php_ini" -r \
	"require '$root/usr/local/ceasar/web/inc/vendor/autoload.php'; exit(function_exists('Ceasar\\Shell\\quoteshellarg') ? 0 : 1);"
"$php_bin" -c "$php_ini" -r \
	"require '$root/usr/local/ceasar/web/src/vendor/autoload.php'; exit(class_exists('Ceasar\\System\\CeasarApp') ? 0 : 1);"
fm_root="$root/filemanager-runtime"
mkdir -p "$fm_root"
unzip -qq "$root/usr/local/ceasar/vendor/filegator/filegator_v7.15.1.zip" -d "$fm_root"
cp -a "$root/usr/local/ceasar/install/deb/filemanager/filegator/." "$fm_root/filegator/"
"$php_bin" -c "$php_ini" "$composer_bin" \
	--no-interaction --working-dir="$fm_root/filegator" check-platform-reqs --no-dev
"$php_bin" -c "$php_ini" -r \
	"require '$fm_root/filegator/vendor/autoload.php'; exit(function_exists('Ceasar\\Shell\\quoteshellarg') && class_exists('Filegator\\App') && class_exists('Filegator\\Services\\Auth\\Adapters\\CeasarAuth') && class_exists('League\\Flysystem\\Filesystem') && class_exists('League\\Flysystem\\Sftp\\SftpAdapter') ? 0 : 1);"

dpkg-deb -c "${package_files["ceasar-nginx"]}" | grep -Fq './usr/local/ceasar/nginx/sbin/ceasar-nginx'
dpkg-deb -c "${package_files["ceasar-web-terminal"]}" | grep -Fq './usr/local/ceasar/web-terminal/server.js'
echo "Ceasar package contents and PHP 8.5.9 platform requirements passed."
