# Ceasar release contract

Ceasar 1.0.0 publishes one immutable Ubuntu 24.04 amd64 bundle named
ceasar-1.0.0-ubuntu24.04-amd64.tar.zst.

The archive contains executable install.sh, ceasar-release.json, and exactly one
build of each package: ceasar, ceasar-nginx, ceasar-php, and the optional
ceasar-web-terminal. The installer verifies the manifest and every package
digest before platform validation or system mutation.

The corresponding ceasar-release-lock.json records schema 1, the exact
40-character source commit, platform, architecture, artifact URL, filename, and
SHA-256. GitHub Pages serves the signed APT repository from
https://iharc-jordan.github.io/ceasar-control-panel/apt.

The archive signing key fingerprint is
CA9A A1D5 6C44 8BF5 EEB0 FB0A 2A3C 8C6E 0AF1 1058.
