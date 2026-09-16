#!/usr/bin/env python3
"""Native public-egress accounting and HTB shaping for schema-2 traffic.

There is one counter per permanent account mark.  The counter rule runs once
in the ``inet`` postrouting hook for packets leaving configured public
interfaces, after local UID marking and HAProxy's SO_MARK have been applied.
It therefore counts IPv4 or IPv6 IP bytes once, rather than summing HTTP,
Apache, SFTP, or tc-layer counters.
"""
from __future__ import annotations

import json
import re
import subprocess
from dataclasses import dataclass
from typing import Iterable, Protocol

from iharc_pam_transfer import derive_mark, is_canonical_username
from iharc_transfer_policy import NORMAL_RATE_BPS, THROTTLED_RATE_BPS


TABLE = "iharc_account_traffic"
FAMILY = "inet"
PUBLIC_INTERFACES = "iharc_public_egress_interfaces"
KNOWN_MARKS = "iharc_account_marks"
BLOCKED_MARKS = "iharc_blocked_marks"
KNOWN_UIDS = "iharc_account_uids"
# This set is deliberately independent of published transfer policies.  A
# canonical Ceasar account is created before its billing worker can publish a
# policy, and it must not be able to obtain the node system identity during
# that interval.
CUSTOMER_IMDS_UIDS = "iharc_customer_imds_uids"
UID_MARKS = "iharc_uid_marks"
OUTPUT_CHAIN = "iharc_account_output"
EGRESS_CHAIN = "iharc_account_egress"
BLOCKED_COUNTER = "iharc_blocked_egress"
COUNTER_PREFIX = "iharc_account_bytes_"
PRIVATE_NGINX_PORTS = "{ 8080, 8443, 9080, 9443 }"
AZURE_IMDS_IPV4 = "169.254.169.254"
MARK_PREFIX = 0x1A000000
MARK_MASK = 0xFFFFFFFF
UINT32_MAX = (1 << 32) - 1
LINUX_UID_MAX = UINT32_MAX - 1
UINT64_MAX = (1 << 64) - 1
MAX_CLASS_MINOR = 0xFFFE
SYSTEM_DEFAULT_RATE_BPS = 1_000_000_000_000


class KernelError(RuntimeError):
    """Native kernel state cannot safely enforce the account contract."""


@dataclass(frozen=True)
class KernelIdentity:
    username: str
    uid: int
    mark: int


@dataclass(frozen=True)
class KernelAccount(KernelIdentity):
    class_minor: int
    traffic_state: str


class Runner(Protocol):
    def run(self, arguments: list[str], input_text: str | None = None) -> str: ...


class SubprocessRunner:
    def run(self, arguments: list[str], input_text: str | None = None) -> str:
        completed = subprocess.run(
            ["nft", *arguments], input=input_text, text=True, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, check=False, timeout=5,
        )
        if completed.returncode != 0:
            raise KernelError("nftables command failed")
        return completed.stdout


class TcRunner(Protocol):
    def run(self, arguments: list[str]) -> str: ...


class SubprocessTcRunner:
    def run(self, arguments: list[str]) -> str:
        completed = subprocess.run(
            ["tc", *arguments], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            check=False, timeout=5,
        )
        if completed.returncode != 0:
            raise KernelError("tc command failed")
        return completed.stdout


def counter_name(account: KernelIdentity) -> str:
    if not is_canonical_username(account.username):
        raise KernelError("counter identity is invalid")
    return COUNTER_PREFIX + account.username


def _quote(value: str) -> str:
    return json.dumps(value)


def _interfaces(interfaces: Iterable[str]) -> tuple[str, ...]:
    result = tuple(interfaces)
    if not result or len(result) != len(set(result)):
        raise KernelError("public egress interface list is invalid")
    if any(not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,15}", name) for name in result):
        raise KernelError("public egress interface is invalid")
    return result


def validate_identities(identities: Iterable[KernelIdentity]) -> tuple[KernelIdentity, ...]:
    result = tuple(identities)
    usernames: set[str] = set()
    uids: set[int] = set()
    marks: set[int] = set()
    for identity in result:
        if not is_canonical_username(identity.username):
            raise KernelError("kernel username is not canonical")
        if (
            isinstance(identity.uid, bool) or not isinstance(identity.uid, int)
            or not 0 < identity.uid <= LINUX_UID_MAX
            or isinstance(identity.mark, bool) or not isinstance(identity.mark, int)
            or not 0 <= identity.mark <= UINT32_MAX
            or identity.mark != derive_mark(identity.username)
        ):
            raise KernelError("kernel identity is invalid")
        if identity.username in usernames or identity.uid in uids or identity.mark in marks:
            raise KernelError("kernel identity collision")
        usernames.add(identity.username)
        uids.add(identity.uid)
        marks.add(identity.mark)
    return result


def validate_accounts(accounts: Iterable[KernelAccount]) -> tuple[KernelAccount, ...]:
    result = tuple(accounts)
    validate_identities(result)
    minors: set[int] = set()
    for account in result:
        if (
            isinstance(account.class_minor, bool) or not isinstance(account.class_minor, int)
            or not 2 <= account.class_minor <= MAX_CLASS_MINOR
            or account.class_minor in minors
        ):
            raise KernelError("HTB class identity is invalid")
        if account.traffic_state not in {"normal", "throttled", "blocked"}:
            raise KernelError("traffic state is invalid")
        minors.add(account.class_minor)
    return result


def validate_customer_uids(uids: Iterable[int]) -> tuple[int, ...]:
    """Validate the complete canonical-customer IMDS-deny identity set."""
    result = tuple(uids)
    if len(result) != len(set(result)) or any(
        isinstance(uid, bool) or not isinstance(uid, int) or not 0 < uid <= LINUX_UID_MAX
        for uid in result
    ):
        raise KernelError("customer IMDS identity is invalid")
    return result


def bootstrap_ruleset() -> str:
    """Create the fixed hooks; account counters are added separately once."""
    return f"""table {FAMILY} {TABLE} {{
  set {PUBLIC_INTERFACES} {{ type ifname; }}
  set {KNOWN_MARKS} {{ type mark; }}
  set {BLOCKED_MARKS} {{ type mark; }}
  set {KNOWN_UIDS} {{ type uid; }}
  set {CUSTOMER_IMDS_UIDS} {{ type uid; }}
  map {UID_MARKS} {{ type uid : mark; }}
  counter {BLOCKED_COUNTER} {{ }}
  chain {OUTPUT_CHAIN} {{
    type filter hook output priority mangle; policy accept;
    # The node's system identity is for root-owned bootstrap and backup
    # processes. This customer inventory is maintained independently of
    # transfer publication so a newly created customer cannot query IMDS.
    meta skuid @{CUSTOMER_IMDS_UIDS} ip daddr {AZURE_IMDS_IPV4} drop
    meta skuid @{KNOWN_UIDS} meta mark set meta skuid map @{UID_MARKS}
    # The node's system identity is for root-owned bootstrap and backup
    # processes. Customer UIDs must never be able to request its IMDS token.
    meta skuid @{KNOWN_UIDS} ip daddr {AZURE_IMDS_IPV4} drop
    # Customer UIDs must use HAProxy's public edge. This prevents a local
    # PHP/cron/SFTP process from forging forwarded headers into the private
    # loopback origin; HAProxy itself runs as root and is not in this map.
    meta skuid @{KNOWN_UIDS} ip daddr 127.0.0.1 tcp dport {PRIVATE_NGINX_PORTS} drop
    meta skuid @{KNOWN_UIDS} ip6 daddr ::1 tcp dport {PRIVATE_NGINX_PORTS} drop
    meta mark @{BLOCKED_MARKS} counter name {BLOCKED_COUNTER} drop
  }}
  chain {EGRESS_CHAIN} {{
    type filter hook postrouting priority mangle; policy accept;
  }}
}}
"""


def _counter_declarations(existing: set[str], accounts: tuple[KernelAccount, ...]) -> str:
    return "".join(
        f"add counter {FAMILY} {TABLE} {counter_name(account)} {{ }}\n"
        for account in accounts if counter_name(account) not in existing
    )


def reconcile_ruleset(
    accounts: Iterable[KernelAccount], interfaces: Iterable[str], *, existing_counters: set[str],
    customer_uids: Iterable[int] = (),
) -> str:
    """Replace classifications without recreating any named byte counter."""
    accounts = validate_accounts(accounts)
    interfaces = _interfaces(interfaces)
    customer_uids = validate_customer_uids(customer_uids)
    lines = [_counter_declarations(existing_counters, accounts)]
    lines.append(f"flush map {FAMILY} {TABLE} {UID_MARKS}\n")
    for name in (PUBLIC_INTERFACES, KNOWN_MARKS, BLOCKED_MARKS, KNOWN_UIDS, CUSTOMER_IMDS_UIDS):
        lines.append(f"flush set {FAMILY} {TABLE} {name}\n")
    lines.append(f"flush chain {FAMILY} {TABLE} {OUTPUT_CHAIN}\n")
    lines.append(f"flush chain {FAMILY} {TABLE} {EGRESS_CHAIN}\n")
    lines.append(
        f"add element {FAMILY} {TABLE} {PUBLIC_INTERFACES} {{ {', '.join(_quote(name) for name in interfaces)} }}\n"
    )
    if accounts:
        lines.append(
            f"add element {FAMILY} {TABLE} {KNOWN_MARKS} {{ {', '.join(hex(account.mark) for account in accounts)} }}\n"
        )
        lines.append(
            f"add element {FAMILY} {TABLE} {KNOWN_UIDS} {{ {', '.join(str(account.uid) for account in accounts)} }}\n"
        )
        lines.append(
            f"add element {FAMILY} {TABLE} {UID_MARKS} {{ {', '.join(f'{account.uid} : {hex(account.mark)}' for account in accounts)} }}\n"
        )
    if customer_uids:
        lines.append(
            f"add element {FAMILY} {TABLE} {CUSTOMER_IMDS_UIDS} {{ {', '.join(str(uid) for uid in customer_uids)} }}\n"
        )
    blocked = tuple(account for account in accounts if account.traffic_state == "blocked")
    if blocked:
        lines.append(
            f"add element {FAMILY} {TABLE} {BLOCKED_MARKS} {{ {', '.join(hex(account.mark) for account in blocked)} }}\n"
        )
    lines.extend(
        [
            f"add rule {FAMILY} {TABLE} {OUTPUT_CHAIN} meta skuid @{CUSTOMER_IMDS_UIDS} ip daddr {AZURE_IMDS_IPV4} drop\n",
            f"add rule {FAMILY} {TABLE} {OUTPUT_CHAIN} meta skuid @{KNOWN_UIDS} meta mark set meta skuid map @{UID_MARKS}\n",
            f"add rule {FAMILY} {TABLE} {OUTPUT_CHAIN} meta skuid @{KNOWN_UIDS} ip daddr {AZURE_IMDS_IPV4} drop\n",
            f"add rule {FAMILY} {TABLE} {OUTPUT_CHAIN} meta skuid @{KNOWN_UIDS} ip daddr 127.0.0.1 tcp dport {PRIVATE_NGINX_PORTS} drop\n",
            f"add rule {FAMILY} {TABLE} {OUTPUT_CHAIN} meta skuid @{KNOWN_UIDS} ip6 daddr ::1 tcp dport {PRIVATE_NGINX_PORTS} drop\n",
            f"add rule {FAMILY} {TABLE} {OUTPUT_CHAIN} meta mark @{BLOCKED_MARKS} counter name {BLOCKED_COUNTER} drop\n",
        ]
    )
    lines.append(
        f"add rule {FAMILY} {TABLE} {EGRESS_CHAIN} oifname @{PUBLIC_INTERFACES} meta mark @{BLOCKED_MARKS} counter name {BLOCKED_COUNTER} drop\n"
    )
    for account in accounts:
        lines.append(
            f"add rule {FAMILY} {TABLE} {EGRESS_CHAIN} oifname @{PUBLIC_INTERFACES} meta mark {hex(account.mark)} counter name {counter_name(account)} comment {_quote('iharc-account-ip-bytes-once')}\n"
        )
    return "".join(lines)


class NftKernelAdapter:
    def __init__(self, runner: Runner | None = None) -> None:
        self.runner = runner or SubprocessRunner()

    def _table(self) -> dict[str, object] | None:
        try:
            text = self.runner.run(["-j", "list", "table", FAMILY, TABLE])
        except KernelError:
            return None
        try:
            value = json.loads(text)
        except json.JSONDecodeError as error:
            raise KernelError("nftables inventory is malformed") from error
        if not isinstance(value, dict) or not isinstance(value.get("nftables"), list):
            raise KernelError("nftables inventory is malformed")
        return value

    @staticmethod
    def _counter_names(table: dict[str, object]) -> set[str]:
        names: set[str] = set()
        for entry in table["nftables"]:  # type: ignore[index]
            if isinstance(entry, dict) and isinstance(entry.get("counter"), dict):
                name = entry["counter"].get("name")
                if isinstance(name, str):
                    names.add(name)
        return names

    @staticmethod
    def _set_names(table: dict[str, object]) -> set[str]:
        names: set[str] = set()
        for entry in table["nftables"]:  # type: ignore[index]
            if isinstance(entry, dict) and isinstance(entry.get("set"), dict):
                name = entry["set"].get("name")
                if isinstance(name, str):
                    names.add(name)
        return names

    def _ensure_customer_imds_set(self, table: dict[str, object]) -> None:
        """Upgrade a prior account-only table without resetting its counters."""
        if CUSTOMER_IMDS_UIDS not in self._set_names(table):
            self.runner.run(
                ["-f", "-"], f"add set {FAMILY} {TABLE} {CUSTOMER_IMDS_UIDS} {{ type uid; }}\n",
            )

    def reconcile(
        self, accounts: Iterable[KernelAccount], interfaces: Iterable[str], *, initialize: bool = False,
        customer_uids: Iterable[int] = (),
    ) -> None:
        accounts = validate_accounts(accounts)
        _interfaces(interfaces)
        customer_uids = validate_customer_uids(customer_uids)
        table = self._table()
        if table is None:
            if not initialize:
                raise KernelError("account traffic table is absent")
            self.runner.run(["-f", "-"], bootstrap_ruleset())
            table = self._table()
            if table is None:
                raise KernelError("account traffic table was not created")
        self._ensure_customer_imds_set(table)
        self.runner.run(
            ["-f", "-"],
            reconcile_ruleset(
                accounts, interfaces, existing_counters=self._counter_names(table), customer_uids=customer_uids,
            ),
        )

    def protect_customer_imds_uid(self, uid: int) -> None:
        """Add one newly-created canonical customer before policy publication."""
        (uid,) = validate_customer_uids((uid,))
        table = self._table()
        if table is None:
            raise KernelError("account traffic table is absent")
        self._ensure_customer_imds_set(table)
        self.runner.run(
            ["add", "element", FAMILY, TABLE, CUSTOMER_IMDS_UIDS, "{", str(uid), "}"],
        )

    def counts(self, accounts: Iterable[KernelAccount]) -> dict[str, int]:
        accounts = validate_accounts(accounts)
        table = self._table()
        if table is None:
            raise KernelError("account traffic table is absent")
        counters: dict[str, int] = {}
        for entry in table["nftables"]:  # type: ignore[index]
            if not isinstance(entry, dict) or not isinstance(entry.get("counter"), dict):
                continue
            counter = entry["counter"]
            name, value = counter.get("name"), counter.get("bytes")
            if isinstance(name, str) and name.startswith(COUNTER_PREFIX):
                if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= UINT64_MAX:
                    raise KernelError("account IP byte counter is malformed")
                counters[name] = value
        result: dict[str, int] = {}
        for account in accounts:
            name = counter_name(account)
            # A missing counter is an account-local observation gap.  Returning
            # the remaining counters lets the controller throttle only that
            # account instead of interrupting unrelated customers.
            if name in counters:
                result[account.username] = counters[name]
        return result

    def retire_legacy_table(self) -> None:
        """Delete every known superseded IHARC traffic table when present."""
        for table in (
            "iharc_transfer_kernel",
            "iharc_node_egress_boot",
            "iharc_node_egress",
        ):
            try:
                self.runner.run(["-j", "list", "table", FAMILY, table])
            except KernelError:
                # A table that was never installed is absent on a fresh hard
                # cut. If it is present, deletion below must succeed or the
                # caller fails before it can start the new account-only rules.
                continue
            self.runner.run(["delete", "table", FAMILY, table])


class HtbShaper:
    """One mark-matched HTB class per account on every public egress device."""
    def __init__(self, runner: TcRunner | None = None) -> None:
        self.runner = runner or SubprocessTcRunner()

    @staticmethod
    def _rate(account: KernelAccount) -> int:
        if account.traffic_state == "normal":
            return NORMAL_RATE_BPS
        if account.traffic_state == "throttled":
            return THROTTLED_RATE_BPS
        # nftables drops blocked marks before postrouting. Keeping the class at
        # the throttled tier avoids a transient default-class escape while a
        # ruleset update and tc update cross process boundaries.
        return THROTTLED_RATE_BPS

    def reconcile(self, accounts: Iterable[KernelAccount], interfaces: Iterable[str]) -> None:
        accounts = validate_accounts(accounts)
        interfaces = _interfaces(interfaces)
        for interface in interfaces:
            try:
                qdiscs = json.loads(self.runner.run(["-j", "qdisc", "show", "dev", interface]))
            except (ValueError, TypeError) as error:
                raise KernelError("tc root qdisc state is unreadable") from error
            root = next((q for q in qdiscs if q.get("root") is True), None)
            if not (root and root.get("kind") == "htb" and root.get("handle") == "1:"
                    and root.get("options", {}).get("default") == "0xffff"):
                self.runner.run(["qdisc", "replace", "dev", interface, "root", "handle", "1:", "htb", "default", "ffff"])
            self.runner.run([
                "class", "replace", "dev", interface, "parent", "1:", "classid", "1:ffff", "htb",
                "rate", f"{SYSTEM_DEFAULT_RATE_BPS}bit", "ceil", f"{SYSTEM_DEFAULT_RATE_BPS}bit",
            ])
            for account in accounts:
                classid = f"1:{account.class_minor:x}"
                rate = self._rate(account)
                self.runner.run([
                    "class", "replace", "dev", interface, "parent", "1:", "classid", classid, "htb",
                    "rate", f"{rate}bit", "ceil", f"{rate}bit",
                ])
                self.runner.run([
                    "filter", "replace", "dev", interface, "parent", "1:", "protocol", "all", "prio", "100",
                    "handle", f"{account.mark:#x}/{MARK_MASK:#x}", "fw", "flowid", classid,
                ])
