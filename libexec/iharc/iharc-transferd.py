#!/usr/bin/env python3
"""Durable per-account public-transfer accounting and shaping.

Only account traffic is enforced here. The controller has no whole-node
allowance, dated operating window, boot-recovery journal, or timed permission
lease: a restart retains each account's durable period usage and last tier.
"""
from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import fcntl
import json
import os
import pathlib
import pwd
import re
import sqlite3
import stat
import sys
import time
from dataclasses import dataclass
from typing import Callable, Iterable

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from iharc_pam_transfer import derive_mark, is_canonical_username
from iharc_transfer_kernel import HtbShaper, KernelAccount, NftKernelAdapter
from iharc_transfer_policy import TransferPolicy, canonical, parse_policy, validate_successor

CONFIG_SCHEMA_VERSION = 2
SAMPLE_SECONDS = 1
MAX_CONFIG_BYTES = 2 * 1024 * 1024
MAX_CLASS_MINOR = 0xFFFE
SUBJECT_ID = re.compile(r"[A-Za-z0-9-]{1,64}\Z")


class CounterError(RuntimeError):
    pass


@dataclass(frozen=True)
class Binding:
    subject_id: str
    username: str
    uid: int
    mark: int
    class_minor: int


@dataclass(frozen=True)
class Account:
    binding: Binding
    policy: TransferPolicy
    native_present: bool
    fault: str | None = None

    def kernel(self, traffic_state: str) -> KernelAccount:
        return KernelAccount(
            self.binding.username, self.binding.uid, self.binding.mark,
            self.binding.class_minor, traffic_state,
        )


@dataclass(frozen=True)
class LoadedConfig:
    accounts: tuple[TransferPolicy, ...]
    interfaces: tuple[str, ...]
    faulty_subjects: frozenset[str]


def _valid_interfaces(value: object) -> tuple[str, ...]:
    if not isinstance(value, list) or not value:
        raise CounterError("public egress interfaces are required")
    result = tuple(value)
    if len(result) != len(set(result)) or any(
        not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,15}", name)
        for name in result
    ):
        raise CounterError("public egress interfaces are invalid")
    return result


class TransferDaemon:
    def __init__(
        self, config_path: pathlib.Path, root: pathlib.Path = pathlib.Path("/"), *, kernel=None, shaper=None,
        uid_for_username: Callable[[str], int] | None = None, username_for_uid: Callable[[int], str] | None = None,
        boot_id: str | None = None, utcnow: Callable[[], dt.datetime] | None = None,
    ) -> None:
        self.root = pathlib.Path(root)
        self.config_path = pathlib.Path(config_path)
        self.test_mode = self.root != pathlib.Path("/") and kernel is not None and uid_for_username is not None
        if not self.test_mode and os.geteuid() != 0:
            raise CounterError("Linux root context required")
        self.kernel = kernel or NftKernelAdapter()
        self.shaper = shaper or HtbShaper()
        self.uid_for_username = uid_for_username or (lambda username: pwd.getpwnam(username).pw_uid)
        self.username_for_uid = username_for_uid or (lambda uid: pwd.getpwuid(uid).pw_name)
        self.utcnow = utcnow or (lambda: dt.datetime.now(dt.timezone.utc))
        self.boot_id = boot_id or self.under("/proc/sys/kernel/random/boot_id").read_text(encoding="ascii").strip()
        self.state_dir = self.under("/var/lib/iharc-transferd")
        self.runtime_dir = self.under("/run/iharc-transferd")
        self.database_path = self.state_dir / "transfer.sqlite3"
        self._prepare_paths()
        self.database = sqlite3.connect(self.database_path)
        self.database.execute("PRAGMA journal_mode=WAL")
        self.database.execute("PRAGMA synchronous=FULL")
        self._migrate()

    @staticmethod
    def _canonical_customer_uids() -> tuple[int, ...]:
        """Read canonical native accounts, independent of transfer enrollment."""
        return tuple(
            entry.pw_uid for entry in pwd.getpwall()
            if is_canonical_username(entry.pw_name)
        )

    def under(self, absolute: str) -> pathlib.Path:
        return self.root / absolute.lstrip("/")

    def _prepare_paths(self) -> None:
        for path in (self.state_dir, self.runtime_dir):
            path.mkdir(parents=True, mode=0o700, exist_ok=True)
            if not self.test_mode:
                info = os.lstat(path)
                if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_gid != 0 or stat.S_IMODE(info.st_mode) != 0o700:
                    raise CounterError("controller state directory is untrusted")
        if self.database_path.exists() and self.database_path.is_symlink():
            raise CounterError("controller database path is unsafe")

    def _migrate(self) -> None:
        self.database.executescript("""
            DROP TABLE IF EXISTS iharc_node_egress_budget_config;
            DROP TABLE IF EXISTS iharc_node_egress_allocations;
            DROP TABLE IF EXISTS iharc_node_egress_epochs;
            DROP TABLE IF EXISTS iharc_node_egress_funded_allocations;
            CREATE TABLE IF NOT EXISTS ceasar_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS ceasar_account_bindings(
              subject_id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, uid INTEGER NOT NULL UNIQUE,
              mark INTEGER NOT NULL UNIQUE, class_minor INTEGER NOT NULL UNIQUE
            );
            CREATE TABLE IF NOT EXISTS ceasar_service_policies(
              subject_id TEXT PRIMARY KEY, policy TEXT NOT NULL, applied_generation INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ceasar_periods(
              subject_id TEXT NOT NULL, period_id TEXT NOT NULL, descriptor TEXT NOT NULL,
              usage_bytes INTEGER NOT NULL, last_counter_bytes INTEGER NOT NULL,
              traffic_state TEXT NOT NULL, reason TEXT NOT NULL, checkpointed_at TEXT NOT NULL,
              boot_id TEXT NOT NULL DEFAULT '', application_state TEXT NOT NULL DEFAULT 'pending',
              PRIMARY KEY(subject_id, period_id)
            );
            DELETE FROM ceasar_meta
              WHERE key IN (
                'ceasar_node_egress_receipt_v2',
                'hardcut_adoption',
                'retired_receipts',
                'funded_handoff'
              );
        """)
        columns = {row[1] for row in self.database.execute("PRAGMA table_info(ceasar_periods)")}
        if "boot_id" not in columns:
            self.database.execute("ALTER TABLE ceasar_periods ADD COLUMN boot_id TEXT NOT NULL DEFAULT ''")
        if "application_state" not in columns:
            self.database.execute(
                "ALTER TABLE ceasar_periods ADD COLUMN application_state TEXT NOT NULL DEFAULT 'pending'",
            )
        self.database.commit()

    @contextlib.contextmanager
    def _lock(self):
        path = self.runtime_dir / "controller.lock"
        descriptor = os.open(path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
        with os.fdopen(descriptor, "a") as handle:
            fcntl.flock(handle, fcntl.LOCK_EX)
            yield

    def _read_config(self) -> LoadedConfig:
        try:
            descriptor = os.open(self.config_path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
            with os.fdopen(descriptor, "r", encoding="utf-8") as handle:
                info = os.fstat(handle.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_CONFIG_BYTES:
                    raise CounterError("account policy configuration is unsafe")
                if not self.test_mode and (info.st_uid != 0 or info.st_gid != 0 or stat.S_IMODE(info.st_mode) != 0o600):
                    raise CounterError("account policy configuration ownership is unsafe")
                value = json.load(handle)
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise CounterError("account policy configuration is unavailable") from error
        expected = {"schema_version", "public_egress_interfaces", "accounts"}
        if not isinstance(value, dict) or set(value) != expected or value.get("schema_version") != CONFIG_SCHEMA_VERSION:
            raise CounterError("exact schema-2 transfer configuration is required")
        interfaces = _valid_interfaces(value["public_egress_interfaces"])
        raw_accounts = value["accounts"]
        if not isinstance(raw_accounts, list):
            raise CounterError("account policies are invalid")
        policies: list[TransferPolicy] = []
        faulty: set[str] = set()
        seen_subjects: set[str] = set()
        seen_users: set[str] = set()
        for raw in raw_accounts:
            subject = raw.get("subject_id") if isinstance(raw, dict) else None
            try:
                policy = parse_policy(raw)
            except Exception:
                if isinstance(subject, str) and SUBJECT_ID.fullmatch(subject):
                    faulty.add(subject)
                continue
            if policy.subject_id in seen_subjects or policy.username in seen_users:
                faulty.add(policy.subject_id)
                faulty.update(
                    old.subject_id for old in policies
                    if old.subject_id == policy.subject_id or old.username == policy.username
                )
                continue
            policies.append(policy)
            seen_subjects.add(policy.subject_id)
            seen_users.add(policy.username)
        return LoadedConfig(tuple(policies), interfaces, frozenset(faulty))

    def _bindings(self) -> dict[str, Binding]:
        return {
            row[0]: Binding(*row)
            for row in self.database.execute(
                "SELECT subject_id,username,uid,mark,class_minor FROM ceasar_account_bindings ORDER BY subject_id",
            )
        }

    def _previous_policy(self, subject_id: str) -> TransferPolicy | None:
        row = self.database.execute("SELECT policy FROM ceasar_service_policies WHERE subject_id=?", (subject_id,)).fetchone()
        return parse_policy(json.loads(row[0])) if row is not None else None

    def _native_present(self, binding: Binding) -> bool:
        try:
            return self.uid_for_username(binding.username) == binding.uid
        except (KeyError, OSError):
            return False

    def _bind(self, policy: TransferPolicy, bindings: dict[str, Binding]) -> tuple[Binding, bool]:
        existing = bindings.get(policy.subject_id)
        if existing is not None:
            if existing.username != policy.username or existing.mark != derive_mark(policy.username):
                raise CounterError("stored account identity cannot be rebound")
            return existing, self._native_present(existing)
        try:
            uid = self.uid_for_username(policy.username)
        except (KeyError, OSError) as error:
            raise CounterError("native account must exist before enrollment") from error
        if isinstance(uid, bool) or not isinstance(uid, int) or uid <= 0:
            raise CounterError("native account UID is invalid")
        mark = derive_mark(policy.username)
        if any(binding.username == policy.username or binding.uid == uid or binding.mark == mark for binding in bindings.values()):
            raise CounterError("native identity has already been retained")
        next_minor = max((binding.class_minor for binding in bindings.values()), default=1) + 1
        if next_minor > MAX_CLASS_MINOR:
            raise CounterError("HTB account identity space is exhausted")
        binding = Binding(policy.subject_id, policy.username, uid, mark, next_minor)
        self.database.execute(
            "INSERT INTO ceasar_account_bindings(subject_id,username,uid,mark,class_minor) VALUES(?,?,?,?,?)",
            (binding.subject_id, binding.username, binding.uid, binding.mark, binding.class_minor),
        )
        bindings[binding.subject_id] = binding
        return binding, True

    def _stored_accounts(self, faulty: Iterable[str] = ()) -> tuple[Account, ...]:
        bindings = self._bindings()
        faulted = set(faulty)
        accounts: list[Account] = []
        for subject_id, text in self.database.execute("SELECT subject_id,policy FROM ceasar_service_policies ORDER BY subject_id"):
            binding = bindings.get(subject_id)
            if binding is None:
                continue
            try:
                policy = parse_policy(json.loads(text))
            except Exception:
                continue
            accounts.append(Account(
                binding, policy, self._native_present(binding),
                "configuration_invalid" if subject_id in faulted else None,
            ))
        return tuple(accounts)

    def _accept_accounts(self, config: LoadedConfig) -> tuple[Account, ...]:
        bindings = self._bindings()
        prior_accounts = {account.policy.subject_id: account for account in self._stored_accounts(config.faulty_subjects)}
        accepted: dict[str, Account] = {}
        for policy in config.accounts:
            prior_account = prior_accounts.get(policy.subject_id)
            if policy.subject_id in config.faulty_subjects:
                continue
            try:
                prior = self._previous_policy(policy.subject_id)
                validate_successor(prior, policy)
                binding, present = self._bind(policy, bindings)
                self.database.execute(
                    "INSERT INTO ceasar_service_policies(subject_id,policy,applied_generation) VALUES(?,?,?) "
                    "ON CONFLICT(subject_id) DO UPDATE SET policy=excluded.policy,applied_generation=excluded.applied_generation",
                    (policy.subject_id, canonical(policy.payload), policy.generation),
                )
                accepted[policy.subject_id] = Account(binding, policy, present)
            except Exception:
                if prior_account is not None:
                    accepted[policy.subject_id] = Account(
                        prior_account.binding, prior_account.policy, prior_account.native_present, "configuration_invalid",
                    )
        self.database.commit()
        for account in self._stored_accounts(config.faulty_subjects):
            accepted.setdefault(account.policy.subject_id, account)
        return tuple(sorted(accepted.values(), key=lambda account: account.binding.username))

    def _period(self, account: Account, current_counter: int) -> tuple[int, int, bool, str | None]:
        row = self.database.execute(
            "SELECT descriptor,usage_bytes,last_counter_bytes,boot_id FROM ceasar_periods WHERE subject_id=? AND period_id=?",
            (account.policy.subject_id, account.policy.period_id),
        ).fetchone()
        descriptor = account.policy.period_descriptor
        if row is None:
            self.database.execute(
                "INSERT INTO ceasar_periods(subject_id,period_id,descriptor,usage_bytes,last_counter_bytes,traffic_state,reason,checkpointed_at,boot_id,application_state) "
                "VALUES(?,?,?,?,?,?,?,?,?,?)",
                (account.policy.subject_id, account.policy.period_id, descriptor, 0, current_counter, "blocked", "initializing", self._now(), self.boot_id, "pending"),
            )
            return 0, current_counter, True, None
        stored_descriptor, usage, prior_counter, stored_boot = row
        if stored_descriptor != descriptor:
            return int(usage), int(prior_counter), False, "period_descriptor_changed"
        if current_counter < prior_counter:
            if stored_boot and stored_boot != self.boot_id:
                return int(usage), current_counter, True, None
            return int(usage), int(prior_counter), False, "counter_regressed"
        return int(usage) + current_counter - int(prior_counter), current_counter, True, None

    def _now(self) -> str:
        return self.utcnow().astimezone(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

    def _state(self, account: Account, *, usage: int | None, known: bool, fault: str | None) -> tuple[str, str]:
        reason = account.policy.block_reason(self.utcnow())
        if reason:
            return "blocked", reason
        if not account.native_present:
            return "blocked", "native_identity_absent"
        if account.policy.kind == "paid" and self.utcnow() >= account.policy.end:
            return "throttled", "period_rollover_pending"
        issue = account.fault or fault
        if issue:
            return "throttled", issue
        if not known or usage is None:
            return "throttled", "usage_unknown"
        if usage >= account.policy.threshold_bytes:
            return "throttled", "threshold_reached"
        return "normal", ""

    def _last_interfaces(self) -> tuple[str, ...] | None:
        row = self.database.execute("SELECT value FROM ceasar_meta WHERE key='public_egress_interfaces'").fetchone()
        if row is None:
            return None
        try:
            return _valid_interfaces(json.loads(row[0]))
        except Exception as error:
            raise CounterError("retained public interfaces are invalid") from error

    def _remember_interfaces(self, interfaces: tuple[str, ...]) -> None:
        self.database.execute(
            "INSERT INTO ceasar_meta(key,value) VALUES('public_egress_interfaces',?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (json.dumps(interfaces),),
        )

    def _checkpoint(self, final: Iterable[tuple[Account, str, int, str]], application_state: str) -> None:
        for account, state, usage, reason in final:
            self.database.execute(
            "UPDATE ceasar_periods SET usage_bytes=?,traffic_state=?,reason=?,checkpointed_at=?,boot_id=?,application_state=? "
                "WHERE subject_id=? AND period_id=?",
                (usage, state, reason, self._now(), self.boot_id, application_state, account.policy.subject_id, account.policy.period_id),
            )
        self.database.commit()

    @staticmethod
    def _result(final: Iterable[tuple[Account, str, int, str]], application_state: str) -> list[dict]:
        return [
            {"subject_id": account.policy.subject_id, "username": account.binding.username,
             "period_id": account.policy.period_id, "usage_bytes": usage, "traffic_state": state,
             "application_state": application_state, "reason": reason}
            for account, state, usage, reason in final
        ]

    def _degrade_stored(self, reason: str) -> list[dict]:
        accounts = self._stored_accounts()
        final = []
        for account in accounts:
            state, state_reason = self._state(account, usage=None, known=False, fault=reason)
            final.append((account, state, self._prior_usage(account), state_reason))
        interfaces = self._last_interfaces()
        if interfaces is not None:
            kernels = [account.kernel(state) for account, state, _, _ in final]
            try:
                self.kernel.reconcile(kernels, interfaces, customer_uids=self._canonical_customer_uids())
                self.shaper.reconcile(kernels, interfaces)
            except Exception:
                pass
        self._checkpoint(final, "pending")
        return self._result(final, "pending")

    def once(self, *, initialize: bool = False) -> list[dict]:
        with self._lock():
            try:
                config = self._read_config()
                accounts = self._accept_accounts(config)
            except Exception:
                return self._degrade_stored("configuration_invalid")
            self._remember_interfaces(config.interfaces)
            customer_uids = self._canonical_customer_uids()
            provisional = []
            for account in accounts:
                blocked = bool(account.policy.block_reason(self.utcnow())) or not account.native_present
                provisional.append((account, "blocked" if blocked else "throttled"))
            kernels = [account.kernel(state) for account, state in provisional]
            try:
                self.kernel.reconcile(
                    kernels, config.interfaces, initialize=initialize, customer_uids=customer_uids,
                )
                counts = self.kernel.counts(kernels)
            except Exception:
                counts = {}
            final: list[tuple[Account, str, int, str]] = []
            for account, _ in provisional:
                current = counts.get(account.binding.username)
                if current is None:
                    state, reason = self._state(account, usage=None, known=False, fault="usage_unknown")
                    usage = self._prior_usage(account)
                else:
                    usage, counter, known, fault = self._period(account, current)
                    state, reason = self._state(account, usage=usage, known=known, fault=fault)
                    if known:
                        self.database.execute(
                            "UPDATE ceasar_periods SET usage_bytes=?,last_counter_bytes=?,traffic_state=?,reason=?,checkpointed_at=?,boot_id=? "
                            "WHERE subject_id=? AND period_id=?",
                            (usage, counter, state, reason, self._now(), self.boot_id, account.policy.subject_id, account.policy.period_id),
                        )
                final.append((account, state, usage, reason))
            self.database.commit()
            final_kernels = [account.kernel(state) for account, state, _, _ in final]
            try:
                self.kernel.reconcile(
                    final_kernels, config.interfaces, initialize=initialize, customer_uids=customer_uids,
                )
                self.shaper.reconcile(final_kernels, config.interfaces)
            except Exception:
                self._checkpoint(final, "pending")
                return self._result(final, "pending")
            self._checkpoint(final, "applied")
            return self._result(final, "applied")

    def _prior_usage(self, account: Account) -> int:
        row = self.database.execute(
            "SELECT usage_bytes FROM ceasar_periods WHERE subject_id=? AND period_id=?",
            (account.policy.subject_id, account.policy.period_id),
        ).fetchone()
        return int(row[0]) if row is not None else 0

    def initialize_kernel(self) -> list[dict]:
        self.kernel.retire_legacy_table()
        return self.once(initialize=True)

    def status(self) -> list[dict]:
        rows: list[dict] = []
        for account in self._stored_accounts():
            period = self.database.execute(
                "SELECT usage_bytes,traffic_state,reason,application_state FROM ceasar_periods WHERE subject_id=? AND period_id=?",
                (account.policy.subject_id, account.policy.period_id),
            ).fetchone()
            rows.append({
                "subject_id": account.policy.subject_id, "username": account.binding.username,
                "period_id": account.policy.period_id, "usage_bytes": int(period[0]) if period else 0,
                "traffic_state": period[1] if period else "blocked",
                "application_state": period[3] if period else "pending",
                "reason": period[2] if period else "usage_unknown",
            })
        return rows


def notify_systemd_ready() -> None:
    socket_path = os.environ.get("NOTIFY_SOCKET")
    if not socket_path:
        return
    import socket
    address = "\x00" + socket_path[1:] if socket_path.startswith("@") else socket_path
    with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as connection:
        connection.connect(address)
        connection.sendall(b"READY=1")


def serve(daemon: TransferDaemon, *, once: bool = False) -> int:
    notify_systemd_ready()
    while True:
        daemon.once()
        if once:
            return 0
        time.sleep(SAMPLE_SECONDS)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=pathlib.Path, default=pathlib.Path("/etc/iharc/transfer-accounts.json"))
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--initialize-kernel", action="store_true")
    parser.add_argument("--status", action="store_true")
    imds = parser.add_mutually_exclusive_group()
    imds.add_argument("--protect-imds-uid", type=int)
    args = parser.parse_args()
    try:
        if sum((args.once, args.initialize_kernel, args.status, args.protect_imds_uid is not None)) > 1:
            parser.error("choose only one controller mode")
        if args.protect_imds_uid is not None:
            NftKernelAdapter().protect_customer_imds_uid(args.protect_imds_uid)
            return 0
        daemon = TransferDaemon(args.config)
        if args.initialize_kernel:
            daemon.initialize_kernel()
            return 0
        if args.status:
            print(json.dumps(daemon.status(), sort_keys=True, separators=(",", ":")))
            return 0
        return serve(daemon, once=args.once)
    except Exception as error:
        print(f"iharc transfer controller failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
