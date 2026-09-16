#!/usr/bin/env bash
# Focused native archive lifecycle with real rclone's local backend. No accounts,
# provider credentials or network targets are created.
set -euo pipefail
source_file=${1:-$(dirname "$0")/../func/backup.sh}
fixture=$(mktemp -d)
trap 'rm -rf -- "$fixture"' EXIT
tr -d '\r' < "$source_file" > "$fixture/backup.sh"
source "$fixture/backup.sh"
source_conf() { :; }
check_result() { if [[ "$1" != 0 ]]; then
	printf '%s\n' "$2" >&2
	exit "$1"
fi; }
fail() {
	printf 'FAIL: %s\n' "$*" >&2
	exit 1
}
mkdir -p "$fixture/source" "$fixture/staging" "$fixture/remote" "$fixture/restore"
printf '[proof]\ntype = local\n' > "$fixture/rclone.conf"
export RCLONE_CONFIG="$fixture/rclone.conf"
CEASAR="$fixture"
HOST=proof
BPATH="$fixture/remote"
BACKUP="$fixture/staging"
BACKUPS=1
E_CONNECT=12
tmpdir="$fixture/source"
user=disposable
localbackup=no
printf 'original file\n' > "$tmpdir/site.txt"
backup_new_date=2026-09-11_01-00-00
rclone_backup
archive="$user.$backup_new_date.tar"
[[ -f "$BPATH/$archive" && ! -e "$BACKUP/$archive" ]] || fail remote-only
rclone_download "$archive"
tar -xf "$BACKUP/$archive" -C "$fixture/restore"
cmp "$tmpdir/site.txt" "$fixture/restore/site.txt" || fail restore
rm -- "$BACKUP/$archive"
first_archive=$archive
backup_new_date=2026-09-11_02-00-00
rclone_backup
archive="$user.$backup_new_date.tar"
[[ ! -e "$BPATH/$first_archive" && -f "$BPATH/$archive" ]] || fail one-archive-retention

# A failed object verification preserves the owned staging archive.
rclone() {
	if [[ "$1" == lsjson ]]; then printf '{"IsDir":false,"Size":1}\n'; else command rclone "$@"; fi
}
backup_new_date=2026-09-11_03-00-00
if (rclone_backup) > /dev/null 2>&1; then fail accepted-size-mismatch; fi
[[ -f "$BACKUP/$user.$backup_new_date.tar" ]] || fail lost-unverified-staging
unset -f rclone
rm -- "$BACKUP/$user.$backup_new_date.tar" "$BPATH/$user.$backup_new_date.tar"

rclone() { return 17; }
if (rclone_delete "$archive") > /dev/null 2>&1; then fail accepted-delete-failure; fi
if (rclone_download "$archive") > /dev/null 2>&1; then fail accepted-download-failure; fi
[[ -f "$BPATH/$archive" && ! -e "$BACKUP/$archive" ]] || fail false-download
[[ -z "$(find "$BACKUP" -name '.restore.*' -print -quit)" ]] || fail partial-download-left
unset -f rclone
mv() { return 17; }
if (rclone_download "$archive") > /dev/null 2>&1; then fail accepted-publish-failure; fi
[[ -z "$(find "$BACKUP" -name '.restore.*' -print -quit)" ]] || fail unpublished-download-left
unset -f mv
rclone_delete "$archive"
[[ ! -e "$BPATH/$archive" ]] || fail delete
printf 'PASS: remote archive upload, list, retention, download/restore and failure cleanup\n'
