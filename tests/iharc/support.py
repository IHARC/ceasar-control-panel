from __future__ import annotations

import base64
import importlib.util
import json
import pathlib
import sys


ROOT = pathlib.Path(__file__).resolve().parents[2]
LIBEXEC = ROOT / "libexec" / "iharc"
sys.path.insert(0, str(LIBEXEC))


def load_daemon():
    spec = importlib.util.spec_from_file_location("iharc_transferd", LIBEXEC / "iharc-transferd.py")
    if spec is None or spec.loader is None:
        raise RuntimeError("transfer daemon module is unavailable")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def policy(
    *,
    subject: str = "service-a",
    username: str = "ih00000000000001",
    generation: int = 1,
    state: str = "active",
    kind: str = "paid",
    period_id: str = "paid-2026-01",
    start: str = "2026-01-01T00:00:00Z",
    end: str = "2026-02-01T00:00:00Z",
    eligible_until: str = "2026-02-08T00:00:00Z",
    threshold: int = 100,
) -> dict:
    return {
        "schema_version": 2,
        "subject_id": subject,
        "username": username,
        "generation": generation,
        "state": state,
        "kind": kind,
        "period_id": period_id,
        "period_start_at": start,
        "period_end_at": end,
        "eligible_until": eligible_until,
        "threshold_bytes": threshold,
        "normal_rate_bps": 100_000_000,
        "throttled_rate_bps": 256_000,
    }


def encoded_policy(value: dict) -> str:
    return base64.urlsafe_b64encode(
        json.dumps(value, separators=(",", ":")).encode("utf-8"),
    ).decode("ascii").rstrip("=")
