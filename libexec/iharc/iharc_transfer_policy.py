#!/usr/bin/env python3
"""Schema-2 service traffic policy validation.

The controller deliberately accepts one small, immutable period descriptor.
Usage is held by the native public-egress counter, never by this policy
document. A new eligible period is therefore the only operation that can
start a new allowance window.
"""
from __future__ import annotations

import datetime as dt
import json
import re
from dataclasses import dataclass

from iharc_pam_transfer import is_canonical_username


MAX_INTEGER = 9_007_199_254_740_991
NORMAL_RATE_BPS = 100_000_000
THROTTLED_RATE_BPS = 256_000
FIELDS = frozenset({
    "schema_version", "subject_id", "username", "generation", "state", "kind",
    "period_id", "period_start_at", "period_end_at", "eligible_until",
    "threshold_bytes", "normal_rate_bps", "throttled_rate_bps",
})


class PolicyError(ValueError):
    """An untrusted or replay-unsafe service policy."""


def timestamp(value: object) -> dt.datetime:
    if not isinstance(value, str) or not re.fullmatch(
        r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)", value,
    ):
        raise PolicyError("policy timestamps must be explicit UTC instants")
    try:
        return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise PolicyError("invalid policy timestamp") from error


def canonical(payload: dict) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


@dataclass(frozen=True)
class TransferPolicy:
    payload: dict
    start: dt.datetime
    end: dt.datetime
    eligible_until: dt.datetime

    @property
    def subject_id(self) -> str:
        return self.payload["subject_id"]

    @property
    def username(self) -> str:
        return self.payload["username"]

    @property
    def generation(self) -> int:
        return self.payload["generation"]

    @property
    def state(self) -> str:
        return self.payload["state"]

    @property
    def kind(self) -> str:
        return self.payload["kind"]

    @property
    def period_id(self) -> str:
        return self.payload["period_id"]

    @property
    def threshold_bytes(self) -> int:
        return self.payload["threshold_bytes"]

    @property
    def normal_rate_bps(self) -> int:
        return self.payload["normal_rate_bps"]

    @property
    def throttled_rate_bps(self) -> int:
        return self.payload["throttled_rate_bps"]

    @property
    def period_descriptor(self) -> str:
        """Fields that may never mutate while this period remains current."""
        return canonical({key: self.payload[key] for key in (
            "kind", "period_id", "period_start_at", "period_end_at", "threshold_bytes",
            "normal_rate_bps", "throttled_rate_bps",
        )})

    def block_reason(self, now: dt.datetime) -> str:
        if self.state != "active":
            return "policy_" + self.state
        if now < self.start:
            return "policy_not_started"
        # A paid period remains service-eligible through the approved
        # seven-day recovery window. The daemon uses its account-local
        # degraded tier when the replacement period or its counter is not
        # known; trial traffic still stops at its seven-day boundary.
        if self.kind != "paid" and now >= self.end:
            return "policy_period_expired"
        if now >= self.eligible_until:
            return "policy_eligibility_expired"
        return ""


def parse_policy(value: object) -> TransferPolicy:
    if (
        not isinstance(value, dict)
        or set(value) != FIELDS
        or type(value.get("schema_version")) is not int
        or value["schema_version"] != 2
    ):
        raise PolicyError("exact service policy schema_version 2 required")
    payload = dict(value)
    if not isinstance(payload["subject_id"], str) or not re.fullmatch(r"[A-Za-z0-9-]{1,64}", payload["subject_id"]):
        raise PolicyError("invalid permanent service identity")
    if not isinstance(payload["username"], str) or not is_canonical_username(payload["username"]):
        raise PolicyError("policy requires a canonical native account")
    if type(payload["generation"]) is not int or not 0 < payload["generation"] <= MAX_INTEGER:
        raise PolicyError("policy generation must be a positive safe integer")
    if type(payload["threshold_bytes"]) is not int or not 0 <= payload["threshold_bytes"] <= MAX_INTEGER:
        raise PolicyError("threshold_bytes must be a safe non-negative integer")
    if payload["state"] not in {"active", "paused", "terminated"}:
        raise PolicyError("invalid policy state")
    if payload["kind"] not in {"trial", "paid"}:
        raise PolicyError("invalid policy kind")
    if not isinstance(payload["period_id"], str) or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,160}", payload["period_id"]):
        raise PolicyError("invalid immutable period identity")
    if payload["normal_rate_bps"] != NORMAL_RATE_BPS or payload["throttled_rate_bps"] != THROTTLED_RATE_BPS:
        raise PolicyError("policy rates must use the accepted account tiers")
    if any(type(payload[name]) is not int for name in ("normal_rate_bps", "throttled_rate_bps")):
        raise PolicyError("policy rate values must be integers")
    start, end, eligible_until = (timestamp(payload[name]) for name in (
        "period_start_at", "period_end_at", "eligible_until",
    ))
    if end <= start or eligible_until <= start:
        raise PolicyError("policy period and eligibility must have positive durations")
    if payload["kind"] == "trial" and end - start != dt.timedelta(days=7):
        raise PolicyError("trial period must be exactly seven days")
    maximum_eligibility = end + (dt.timedelta(days=7) if payload["kind"] == "paid" else dt.timedelta())
    if eligible_until > maximum_eligibility:
        raise PolicyError("eligibility exceeds the service period or paid grace")
    return TransferPolicy(payload, start, end, eligible_until)


def validate_successor(previous: TransferPolicy | None, incoming: TransferPolicy) -> None:
    """Reject replay, identity reuse, and in-place allowance rewrites."""
    if previous is None:
        return
    if (previous.subject_id, previous.username) != (incoming.subject_id, incoming.username):
        raise PolicyError("permanent service/native identity cannot be rebound")
    if incoming.generation < previous.generation:
        raise PolicyError("policy generation regressed")
    if incoming.generation == previous.generation:
        if canonical(incoming.payload) != canonical(previous.payload):
            raise PolicyError("same policy generation has different content")
        return
    if previous.state == "terminated" and incoming.state != "terminated":
        raise PolicyError("a terminated service cannot regain traffic")
    order = {"trial": 0, "paid": 1}
    if order[incoming.kind] < order[previous.kind]:
        raise PolicyError("service phase cannot regress")
    if incoming.period_id == previous.period_id:
        if incoming.period_descriptor != previous.period_descriptor:
            raise PolicyError("an existing period cannot receive a different threshold or boundary")
        return
    # A distinct period is the sole allowance-reset authority.  It cannot
    # overlap the old period, regardless of whether the service is moving
    # from trial to paid or paid to a paid renewal.
    if incoming.start < previous.end:
        raise PolicyError("a successor service period cannot overlap its predecessor")
    if incoming.kind == previous.kind and incoming.kind != "paid":
        raise PolicyError("only a completed paid period may renew")
