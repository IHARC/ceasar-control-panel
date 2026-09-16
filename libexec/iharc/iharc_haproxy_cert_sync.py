#!/usr/bin/env python3
"""Generate the private HAProxy edge from native Ceasar web state.

The transfer policy binds a permanent native account identity. Ceasar remains
the authority for web domains, aliases, and certificates: this helper reads
``data/users/<user>/web.conf`` and its issued ``ssl/<domain>.pem`` plus
``.key`` files, then writes the only HAProxy input consumed by the account
edge. It never requests a certificate, accepts a customer Host header as
configuration, or keeps an operator-maintained duplicate authority manifest.
"""
from __future__ import annotations

import argparse
import grp
import os
import pathlib
import re
import shlex
import stat
import sys
import subprocess
import tempfile
from dataclasses import dataclass

# Isolated Python entrypoints load siblings only from this root-owned install directory.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from iharc_pam_transfer import derive_mark, is_canonical_username


AUTHORITY = re.compile(
    r"(?=.{1,253}\Z)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*\Z"
)
CERTIFICATE_NAME = re.compile(r"^(?:operator|ih[0-9a-f]{14})--[a-z0-9.-]+\.pem\Z")
MAX_NATIVE_FILE_BYTES = 4 * 1024 * 1024


class SyncError(RuntimeError):
    pass


@dataclass(frozen=True)
class NativeDomain:
    username: str
    domain: str
    authorities: tuple[str, ...]
    ssl: bool
    operator: bool = False


@dataclass(frozen=True)
class CertificateBundle:
    name: str
    content: bytes


class AuthoritySynchronizer:
    """Read the root-owned native source and write one static edge fragment."""

    def __init__(self, root: pathlib.Path = pathlib.Path("/")) -> None:
        self.root = pathlib.Path(root)
        self.runtime = self.root == pathlib.Path("/")
        self.ceasar = self.path("/usr/local/ceasar")
        self.output = self.path("/etc/haproxy/iharc")
        self.certificates = self.output / "certs"
        self.fragment = self.path("/etc/haproxy/conf.d/iharc-account-traffic.cfg")
        self.haproxy_gid = grp.getgrnam("haproxy").gr_gid if self.runtime else 0

    def path(self, absolute: str) -> pathlib.Path:
        return self.root / absolute.lstrip("/")

    def _safe_regular(self, path: pathlib.Path, *, maximum: int, exact_mode: int | None = None) -> os.stat_result:
        try:
            info = os.lstat(path)
        except OSError as error:
            raise SyncError("required native authority input is unavailable") from error
        if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode) or info.st_size > maximum:
            raise SyncError("native authority input is unsafe")
        if self.runtime and (info.st_uid != 0 or info.st_gid not in {0, self.haproxy_gid}):
            raise SyncError("native authority input is not root-owned")
        if exact_mode is not None:
            if stat.S_IMODE(info.st_mode) != exact_mode:
                raise SyncError("native authority input mode is unsafe")
        elif stat.S_IMODE(info.st_mode) & 0o002:
            raise SyncError("native authority input is world-writable")
        return info

    def _read(self, path: pathlib.Path, *, maximum: int, exact_mode: int | None = None) -> bytes:
        before = self._safe_regular(path, maximum=maximum, exact_mode=exact_mode)
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
        try:
            descriptor = os.open(path, flags)
        except OSError as error:
            raise SyncError("required native authority input is unavailable") from error
        try:
            with os.fdopen(descriptor, "rb") as handle:
                after = os.fstat(handle.fileno())
                if not stat.S_ISREG(after.st_mode) or (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino):
                    raise SyncError("native authority input changed while read")
                value = handle.read(maximum + 1)
        except OSError as error:
            raise SyncError("required native authority input is unavailable") from error
        if len(value) > maximum:
            raise SyncError("native authority input is too large")
        return value

    @staticmethod
    def _authority(value: object) -> str:
        if not isinstance(value, str) or value != value.lower() or not AUTHORITY.fullmatch(value):
            raise SyncError("native Ceasar authority is invalid")
        return value

    def _parse_web_conf(self, username: str, *, operator: bool = False) -> tuple[NativeDomain, ...]:
        path = self.ceasar / "data" / "users" / username / "web.conf"
        raw = self._read(path, maximum=MAX_NATIVE_FILE_BYTES)
        try:
            lines = raw.decode("utf-8").splitlines()
        except UnicodeDecodeError as error:
            raise SyncError("native Ceasar web state is invalid") from error
        domains: list[NativeDomain] = []
        seen: set[str] = set()
        for line in lines:
            if not line.strip():
                continue
            try:
                words = shlex.split(line, comments=False, posix=True)
            except ValueError as error:
                raise SyncError("native Ceasar web state is invalid") from error
            fields: dict[str, str] = {}
            for word in words:
                key, separator, value = word.partition("=")
                if not separator or not key or key in fields:
                    raise SyncError("native Ceasar web state is invalid")
                fields[key] = value
            domain = self._authority(fields.get("DOMAIN"))
            if domain in seen:
                raise SyncError("native Ceasar domain is duplicated")
            seen.add(domain)
            aliases = fields.get("ALIAS", "")
            if not isinstance(aliases, str):
                raise SyncError("native Ceasar aliases are invalid")
            names = [domain]
            if aliases:
                names.extend(self._authority(alias) for alias in aliases.split(","))
            if len(set(names)) != len(names):
                raise SyncError("native Ceasar aliases are duplicated")
            ssl = fields.get("SSL")
            if ssl not in {"yes", "no"}:
                raise SyncError("native Ceasar SSL state is invalid")
            domains.append(NativeDomain(username, domain, tuple(names), ssl == "yes", operator))
        return tuple(domains)

    def _native_domains(self) -> tuple[NativeDomain, ...]:
        users = self.ceasar / "data" / "users"
        try:
            entries = sorted(path.name for path in users.iterdir()
                             if path.is_dir() and not path.is_symlink() and is_canonical_username(path.name))
        except OSError as error:
            raise SyncError("native Ceasar account inventory is unavailable") from error
        result: list[NativeDomain] = []
        for username in entries:
            # A stale certificate or malformed web.conf belongs to one Ceasar
            # account. It must never prevent healthy neighbours from receiving
            # their renewed certificate and hostname map.
            try:
                result.extend(self._parse_web_conf(username))
            except SyncError:
                continue
        # The native root account owns administrator routes independently of
        # paid/trial accounts. Read that existing authority, never a second map.
        config = self._read(self.ceasar / "conf/ceasar.conf", maximum=MAX_NATIVE_FILE_BYTES).decode("utf-8")
        roots = re.findall(r"^ROOT_USER='([a-z_][a-z0-9_-]{0,31})'$", config, re.M)
        if len(roots) != 1 or is_canonical_username(roots[0]):
            raise SyncError("native operator identity is invalid")
        result.extend(self._parse_web_conf(roots[0], operator=True))
        return tuple(result)

    def _bundle(self, domain: NativeDomain) -> CertificateBundle:
        directory = self.ceasar / "data" / "users" / domain.username / "ssl"
        certificate = self._read(directory / f"{domain.domain}.pem", maximum=MAX_NATIVE_FILE_BYTES)
        key = self._read(directory / f"{domain.domain}.key", maximum=MAX_NATIVE_FILE_BYTES)
        if b"-----BEGIN CERTIFICATE-----" not in certificate or b"PRIVATE KEY-----" not in key:
            raise SyncError("native Ceasar certificate bundle is incomplete")
        if not certificate.endswith(b"\n"):
            certificate += b"\n"
        if not key.endswith(b"\n"):
            key += b"\n"
        return CertificateBundle(f"{'operator' if domain.operator else domain.username}--{domain.domain}.pem", certificate + key)

    def load(self) -> tuple[dict[str, str], dict[str, int], tuple[CertificateBundle, ...]]:
        owners: dict[str, str] = {}
        marks: dict[str, int] = {}
        bundles: dict[str, CertificateBundle] = {}
        for domain in self._native_domains():
            owner = "operator" if domain.operator else domain.username
            if not domain.operator:
                marks[owner] = derive_mark(domain.username)
            for authority in domain.authorities:
                if authority in owners:
                    continue
                owners[authority] = owner
            if domain.ssl:
                try:
                    bundle = self._bundle(domain)
                except SyncError:
                    continue
                bundles[bundle.name] = bundle
        if len(set(marks.values())) != len(marks):
            raise SyncError("native account marks collide")
        return owners, marks, tuple(bundles[name] for name in sorted(bundles))

    def _ensure_directory(self, path: pathlib.Path, mode: int) -> None:
        try:
            path.mkdir(mode=mode, parents=True, exist_ok=True)
        except OSError as error:
            raise SyncError("HAProxy authority output directory is unavailable") from error
        try:
            info = os.lstat(path)
        except OSError as error:
            raise SyncError("HAProxy authority output directory is unavailable") from error
        if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode):
            raise SyncError("HAProxy authority output directory is unsafe")
        if self.runtime:
            os.chown(path, 0, self.haproxy_gid)
            os.chmod(path, mode)
            info = os.lstat(path)
        if self.runtime and (info.st_uid != 0 or info.st_gid != self.haproxy_gid):
            raise SyncError("HAProxy authority output directory ownership is unsafe")
        if stat.S_IMODE(info.st_mode) & 0o022:
            raise SyncError("HAProxy authority output directory is writable by a non-root class")

    def _atomic(self, path: pathlib.Path, content: bytes, mode: int) -> None:
        self._ensure_directory(path.parent, 0o750)
        descriptor, temporary = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
        try:
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
            if self.runtime:
                os.chown(temporary, 0, self.haproxy_gid)
            os.chmod(temporary, mode)
            os.replace(temporary, path)
        except Exception:
            try:
                os.unlink(temporary)
            except OSError:
                pass
            raise

    def _retire_generated_file(self, path: pathlib.Path) -> None:
        if not path.exists() and not path.is_symlink():
            return
        self._safe_regular(path, maximum=MAX_NATIVE_FILE_BYTES)
        try:
            path.unlink()
        except OSError as error:
            raise SyncError("superseded HAProxy input could not be removed") from error

    def _write_certificates(self, bundles: tuple[CertificateBundle, ...]) -> tuple[pathlib.Path, ...]:
        self._ensure_directory(self.certificates, 0o750)
        desired = {bundle.name for bundle in bundles}
        for bundle in bundles:
            self._atomic(self.certificates / bundle.name, bundle.content, 0o640)
        try:
            existing = tuple(self.certificates.iterdir())
        except OSError as error:
            raise SyncError("HAProxy certificate directory is unavailable") from error
        for path in existing:
            if path.name in desired:
                continue
            if not CERTIFICATE_NAME.fullmatch(path.name):
                raise SyncError("HAProxy certificate directory contains an unknown file")
            self._retire_generated_file(path)
        return tuple(self.certificates / bundle.name for bundle in bundles)

    @staticmethod
    def render_fragment(owners: dict[str, str], marks: dict[str, int], certificates: tuple[pathlib.Path, ...]) -> str:
        if not owners:
            return (
                "# Generated by iharc_haproxy_cert_sync.py from native Ceasar state.\n"
                "# No canonical customer web authorities are currently published.\n"
                "# Native/operator management listeners remain owned by the existing HAProxy configuration.\n"
            )
        lines = [
            "# Generated by iharc_haproxy_cert_sync.py; do not edit.",
            "frontend iharc_account_http",
            "    mode http",
            "    bind :80",
            "    bind [::]:80 v6only",
            "    option httpclose",
            "    http-request set-var(txn.iharc_authority) req.hdr(Host),lower,regsub(:[0-9]+$,,),map_str(/etc/haproxy/iharc/account-owner.map)",
            "    http-request return status 421 if !{ var(txn.iharc_authority) -m found }",
        ]
        for username, mark in sorted(marks.items()):
            lines.append(f"    http-request set-mark 0x{mark:08x} if {{ var(txn.iharc_authority) -m str {username} }}")
        lines.extend(
            [
                "    http-request del-header X-Forwarded-For",
                "    http-request set-header X-Forwarded-For %[src]",
                "    http-request set-header X-Forwarded-Proto http",
                "    http-request set-header X-Forwarded-Host %[req.hdr(Host)]",
                "    http-request set-header X-IHARC-Private-Edge 1",
                "    use_backend iharc_operator_http if { var(txn.iharc_authority) -m str operator }",
                "    default_backend iharc_private_nginx",
            ]
        )
        if certificates:
            lines.extend(
                [
                    "",
                    "frontend iharc_account_https",
                    "    mode http",
                    "    bind :443 ssl crt-list /etc/haproxy/iharc/account-crt-list.txt strict-sni alpn h2,http/1.1",
                    "    bind [::]:443 v6only ssl crt-list /etc/haproxy/iharc/account-crt-list.txt strict-sni alpn h2,http/1.1",
                    "    option http-keep-alive",
                    "    http-request set-var(txn.iharc_authority) req.hdr(Host),lower,regsub(:[0-9]+$,,),map_str(/etc/haproxy/iharc/account-owner.map)",
                    "    http-request set-var(txn.iharc_sni_owner) ssl_fc_sni,lower,map_str(/etc/haproxy/iharc/account-owner.map)",
                    "    http-request return status 421 if !{ var(txn.iharc_authority) -m found }",
                    "    http-request return status 421 if !{ var(txn.iharc_sni_owner) -m found }",
                ]
            )
            # HAProxy 2.4 does not support comparing two fetched variables
            # through strcmp().  Emit one static owner equality guard per
            # native account so TLS SNI and HTTP authority can never route
            # across customer boundaries on a reused HTTP/2 connection.
            for owner in sorted(set(owners.values())):
                lines.append(
                    f"    http-request return status 421 if {{ var(txn.iharc_sni_owner) -m str {owner} }} "
                    f"!{{ var(txn.iharc_authority) -m str {owner} }}"
                )
            for username, mark in sorted(marks.items()):
                lines.append(f"    http-request set-mark 0x{mark:08x} if {{ var(txn.iharc_authority) -m str {username} }}")
            lines.extend(
                [
                    "    http-request del-header X-Forwarded-For",
                    "    http-request set-header X-Forwarded-For %[src]",
                    "    http-request set-header X-Forwarded-Proto https",
                    "    http-request set-header X-Forwarded-Host %[req.hdr(Host)]",
                    "    http-request set-header X-IHARC-Private-Edge 1",
                    "    use_backend iharc_operator_https if { var(txn.iharc_authority) -m str operator }",
                    "    default_backend iharc_private_nginx",
                ]
            )
        lines.extend(
            [
                "",
                "backend iharc_operator_http",
                "    mode http",
                "    server operator_origin 127.0.0.1:9080",
                "",
                "backend iharc_operator_https",
                "    mode http",
                "    server operator_origin 127.0.0.1:9080",
                "",
                "backend iharc_private_nginx",
                "    mode http",
                "    # The Ceasar templates bind this origin only to loopback; forwarded headers originate at this edge.",
                "    server nginx_origin 127.0.0.1:9080 check",
                "",
            ]
        )
        return "\n".join(lines)

    def sync(self, *, reload_haproxy: bool = True) -> None:
        if self.runtime and os.geteuid() != 0:
            raise SyncError("root is required")
        owners, marks, bundles = self.load()
        self._ensure_directory(self.output, 0o750)
        certificate_paths = self._write_certificates(bundles)
        self._atomic(
            self.output / "account-owner.map",
            "".join(f"{authority} {owner}\n" for authority, owner in sorted(owners.items())).encode("ascii"),
            0o640,
        )
        self._atomic(
            self.output / "account-crt-list.txt",
            "".join(f"{path}\n" for path in certificate_paths).encode("ascii"),
            0o640,
        )
        self._retire_generated_file(self.output / "account-mark.map")
        self._atomic(self.fragment, self.render_fragment(owners, marks, certificate_paths).encode("ascii"), 0o640)
        if reload_haproxy:
            result = subprocess.run(["/usr/bin/systemctl", "reload", "haproxy.service"], check=False, timeout=20)
            if result.returncode != 0:
                raise SyncError("HAProxy reload failed")


def sync(*, reload_haproxy: bool = True) -> None:
    AuthoritySynchronizer().sync(reload_haproxy=reload_haproxy)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sync", action="store_true")
    parser.add_argument("--no-reload", action="store_true")
    args = parser.parse_args()
    if not args.sync:
        return 2
    try:
        sync(reload_haproxy=not args.no_reload)
        return 0
    except Exception:
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
