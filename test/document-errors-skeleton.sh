#!/usr/bin/env bash
# Exercise the root-read/customer-write skeleton transfer used by rebuild.sh.
set -euo pipefail

[[ $(id -u) -eq 0 ]] || {
	echo 'run as root' >&2
	exit 77
}
command -v setpriv > /dev/null

fixture=$(mktemp -d)
trap 'rm -rf -- "$fixture"' EXIT
source_dir="$fixture/source/document_errors"
destination="$fixture/destination"
outside="$fixture/outside"
mkdir -p "$source_dir" "$destination" "$outside"
chmod 0755 "$fixture"
printf 'trusted error page\n' > "$source_dir/50x.html"
printf 'outside remains unchanged\n' > "$outside/sentinel"
chmod 0700 "$fixture/source" "$source_dir"
chown -R nobody:nogroup "$destination"

# A customer-controlled symlink must not give the root source reader a way to
# write outside the restore destination.
setpriv --reuid nobody --regid nogroup --clear-groups -- ln -s "$outside" "$destination/document_errors"
if (tar -C "$source_dir" -cf - . | setpriv --reuid nobody --regid nogroup --clear-groups -- tar -C "$destination/document_errors" --no-same-owner -xf -) 2> "$fixture/symlink.err"; then
	echo 'symlinked destination unexpectedly accepted writes' >&2
	exit 1
fi
[[ $(cat "$outside/sentinel") == 'outside remains unchanged' ]]

rm "$destination/document_errors"
mkdir "$destination/document_errors"
chown nobody:nogroup "$destination/document_errors"
tar -C "$source_dir" -cf - . | setpriv --reuid nobody --regid nogroup --clear-groups -- tar -C "$destination/document_errors" --no-same-owner -xf -
[[ $(cat "$destination/document_errors/50x.html") == 'trusted error page' ]]
[[ $(stat -c '%U:%G' "$destination/document_errors/50x.html") == 'nobody:nogroup' ]]

printf 'PASS: root-read skeleton is extracted only by the customer user\n'
