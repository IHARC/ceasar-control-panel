#!/usr/bin/env bats

setup() {
	source "$BATS_TEST_DIRNAME/../func/package.sh"
}

@test "patch release 1.0.1 supersedes 1.0.0" {
	run ceasar_version_is_newer '1.0.1-1+ubuntu24.04' '1.0.0-1+ubuntu24.04'
	[ "$status" -eq 0 ]
}

@test "release 1.0.0 supersedes an RC" {
	run ceasar_version_is_newer '1.0.0-1+ubuntu24.04' '1.0.0~rc1-1+ubuntu24.04'
	[ "$status" -eq 0 ]
}

@test "Debian revision 10 supersedes revision 9" {
	run ceasar_version_is_newer '1.0.0-10+ubuntu24.04' '1.0.0-9+ubuntu24.04'
	[ "$status" -eq 0 ]
}

@test "an epoch supersedes an unversioned release" {
	run ceasar_version_is_newer '1:1.0.0-1' '9.9.9-1'
	[ "$status" -eq 0 ]
}

@test "the installed version is not reported as newer" {
	run ceasar_version_is_newer '1.0.0-1+ubuntu24.04' '1.0.0-1+ubuntu24.04'
	[ "$status" -ne 0 ]
}
