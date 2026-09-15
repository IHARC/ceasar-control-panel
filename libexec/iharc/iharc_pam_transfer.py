#!/usr/bin/env python3
"""Mark a canonical SFTP socket for durable account traffic accounting.

PAM only marks the authenticated socket. It has no timed runtime policy and
does not decide whether an account is open: nftables and HTB hold the durable
account tier across controller restarts.
"""
from __future__ import annotations

import ctypes
import hashlib
import ipaddress
import os
import pathlib
import platform
import re
import socket
import sys
from dataclasses import dataclass
from typing import Callable, Mapping

CANONICAL_USERNAME = re.compile(r"^ih[0-9a-f]{14}$")
MARK_PREFIX = 0x1A000000
MARK_VALUE_MASK = 0x00FFFFFF
EXPECTED_SSHD = "/usr/sbin/sshd"


class PolicyError(RuntimeError):
    pass


@dataclass(frozen=True)
class AccountPolicy:
    username: str
    uid: int
    mark: int


def is_canonical_username(username: str) -> bool:
    return bool(CANONICAL_USERNAME.fullmatch(username))


def derive_mark(username: str) -> int:
    if not is_canonical_username(username):
        raise PolicyError("noncanonical username")
    value = int.from_bytes(
        hashlib.blake2s(username.encode("ascii"), digest_size=4, person=b"iharcxfr").digest(), "big",
    ) & MARK_VALUE_MASK
    return MARK_PREFIX | (value or 1)


def policy_for_pam_user(username: str) -> AccountPolicy | None:
    """Create only the deterministic mark; the kernel decides the tier."""
    if not is_canonical_username(username):
        return None
    try:
        import pwd
        uid = pwd.getpwnam(username).pw_uid
    except (ImportError, KeyError):
        raise PolicyError("native account is unavailable")
    if isinstance(uid, bool) or not isinstance(uid, int) or uid <= 0:
        raise PolicyError("native account identity is invalid")
    return AccountPolicy(username, uid, derive_mark(username))


def _read_parent_uid(parent: pathlib.Path) -> tuple[int, int]:
    for line in (parent / "status").read_text(encoding="ascii").splitlines():
        if line.startswith("Uid:"):
            values = line.split()[1:3]
            if len(values) == 2 and all(value.isdecimal() for value in values):
                return int(values[0]), int(values[1])
    raise PolicyError("parent uid is unavailable")


def _connection_tuple(value: str) -> tuple[tuple[str, int], tuple[str, int]]:
    fields = value.split()
    if len(fields) != 4:
        raise PolicyError("SSH_CONNECTION is malformed")
    remote, remote_port, local, local_port = fields
    try:
        remote_ip = str(ipaddress.ip_address(remote))
        local_ip = str(ipaddress.ip_address(local))
        remote_number, local_number = int(remote_port), int(local_port)
    except ValueError as error:
        raise PolicyError("SSH_CONNECTION is malformed") from error
    if not 0 < remote_number < 65536 or not 0 < local_number < 65536:
        raise PolicyError("SSH_CONNECTION port is malformed")
    if ipaddress.ip_address(remote_ip).version != ipaddress.ip_address(local_ip).version:
        raise PolicyError("SSH_CONNECTION address family is inconsistent")
    return (local_ip, local_number), (remote_ip, remote_number)


def _pidfd_getfd(pidfd: int, target_fd: int) -> int:
    if platform.machine() not in {"x86_64", "amd64", "aarch64"}:
        raise PolicyError("unsupported pidfd_getfd architecture")
    result = ctypes.CDLL(None, use_errno=True).syscall(438, pidfd, target_fd, 0)
    if result < 0:
        raise OSError(ctypes.get_errno(), "pidfd_getfd")
    return int(result)


def _pidfd_open(pid: int) -> int:
    opener = getattr(os, "pidfd_open", None)
    if opener is None:
        raise PolicyError("pidfd_open is unavailable")
    return opener(pid)


def _socket_endpoint(value: tuple[object, ...]) -> tuple[str, int]:
    if len(value) < 2 or not isinstance(value[0], str) or not isinstance(value[1], int):
        raise PolicyError("socket endpoint is malformed")
    return str(ipaddress.ip_address(value[0])), value[1]


def mark_authenticated_socket(
    account: AccountPolicy, environ: Mapping[str, str] = os.environ, *, proc_root: pathlib.Path = pathlib.Path("/proc"),
    parent_pid: int | None = None, pidfd_open: Callable[[int], int] = _pidfd_open,
    pidfd_getfd: Callable[[int, int], int] = _pidfd_getfd,
) -> int:
    if environ.get("PAM_TYPE") != "open_session" or environ.get("PAM_SERVICE") != "sshd":
        raise PolicyError("unexpected PAM context")
    if environ.get("PAM_USER") != account.username:
        raise PolicyError("PAM user does not match account")
    expected_local, expected_remote = _connection_tuple(environ.get("SSH_CONNECTION", ""))
    parent_id = os.getppid() if parent_pid is None else parent_pid
    parent = proc_root / str(parent_id)
    try:
        if os.path.realpath(os.readlink(parent / "exe")) != EXPECTED_SSHD or _read_parent_uid(parent) != (0, 0):
            raise PolicyError("PAM parent is not the native root sshd")
        descriptors = sorted(int(entry.name) for entry in (parent / "fd").iterdir() if entry.name.isdecimal())
    except OSError as error:
        raise PolicyError("PAM parent state is unavailable") from error
    pidfd = pidfd_open(parent_id)
    matches: list[socket.socket] = []
    try:
        for descriptor in descriptors:
            try:
                if not os.readlink(parent / "fd" / str(descriptor)).startswith("socket:"):
                    continue
                peer = socket.socket(fileno=pidfd_getfd(pidfd, descriptor))
            except OSError as error:
                raise PolicyError("unable to duplicate parent socket") from error
            try:
                if (peer.family not in {socket.AF_INET, socket.AF_INET6} or (peer.type & 0xF) != socket.SOCK_STREAM
                        or _socket_endpoint(peer.getsockname()) != expected_local
                        or _socket_endpoint(peer.getpeername()) != expected_remote):
                    peer.close()
                    continue
                matches.append(peer)
            except Exception:
                peer.close()
                raise
        if len(matches) != 1:
            raise PolicyError("PAM connection socket is ambiguous")
        if parent_pid is None and os.getppid() != parent_id:
            raise PolicyError("PAM parent changed before socket marking")
        target = matches[0]
        target.setsockopt(socket.SOL_SOCKET, socket.SO_MARK, account.mark)
        if target.getsockopt(socket.SOL_SOCKET, socket.SO_MARK) != account.mark:
            raise PolicyError("socket mark did not persist")
        return account.mark
    finally:
        for peer in matches:
            peer.close()
        os.close(pidfd)


def main() -> int:
    username = os.environ.get("PAM_USER", "")
    try:
        if is_canonical_username(username) and os.environ.get("PAM_TYPE") == "close_session":
            return 0
        account = policy_for_pam_user(username)
        if account is not None:
            mark_authenticated_socket(account)
        return 0
    except Exception:
        print("iharc PAM transfer registration failed", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
