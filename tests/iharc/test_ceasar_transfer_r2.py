from __future__ import annotations

import datetime as dt
import pathlib
import sys
import unittest

from support import LIBEXEC, policy

sys.path.insert(0, str(LIBEXEC))
from iharc_transfer_policy import PolicyError, parse_policy, validate_successor


class TransferPolicyTests(unittest.TestCase):
    def test_schema_is_exact_and_trial_duration_is_seven_days(self) -> None:
        value = policy(
            kind="trial",
            period_id="trial",
            end="2026-01-08T00:00:00Z",
            eligible_until="2026-01-08T00:00:00Z",
        )
        parsed = parse_policy(value)
        self.assertEqual(parsed.block_reason(dt.datetime(2026, 1, 2, tzinfo=dt.timezone.utc)), "")
        value["unexpected"] = True
        with self.assertRaises(PolicyError):
            parse_policy(value)

    def test_period_descriptor_cannot_be_rewritten_or_overlap(self) -> None:
        previous = parse_policy(policy())
        changed = policy(generation=2, threshold=101)
        with self.assertRaises(PolicyError):
            validate_successor(previous, parse_policy(changed))
        overlap = policy(
            generation=2,
            period_id="paid-2026-02",
            start="2026-01-31T00:00:00Z",
            end="2026-03-01T00:00:00Z",
            eligible_until="2026-03-08T00:00:00Z",
        )
        with self.assertRaises(PolicyError):
            validate_successor(previous, parse_policy(overlap))

    def test_terminated_identity_cannot_be_reactivated_or_rebound(self) -> None:
        terminated = parse_policy(policy(state="terminated"))
        with self.assertRaises(PolicyError):
            validate_successor(terminated, parse_policy(policy(generation=2)))
        with self.assertRaises(PolicyError):
            validate_successor(
                parse_policy(policy()),
                parse_policy(policy(username="ih00000000000002", generation=2)),
            )


if __name__ == "__main__":
    unittest.main()
