#!/bin/bash

# Return success when the first Debian package version is newer than the second.
ceasar_version_is_newer() {
	local candidate=$1
	local installed=$2
	[ -n "$candidate" ] && dpkg --compare-versions "$candidate" gt "$installed"
}
