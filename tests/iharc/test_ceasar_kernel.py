from __future__ import annotations

import json
import pathlib
import sys
import unittest

from support import LIBEXEC

sys.path.insert(0, str(LIBEXEC))
from iharc_pam_transfer import derive_mark
from iharc_transfer_kernel import (
    AZURE_IMDS_IPV4,
    HtbShaper,
    KernelAccount,
    KernelError,
    KernelIdentity,
    THROTTLED_RATE_BPS,
    bootstrap_ruleset,
    reconcile_ruleset,
    validate_identities,
)


class TcRecorder:
    def __init__(self) -> None:
        self.calls: list[list[str]] = []

    def run(self, arguments: list[str]) -> str:
        self.calls.append(arguments)
        if arguments[:3] == ["-j", "qdisc", "show"]:
            return json.dumps([])
        return ""


class KernelTests(unittest.TestCase):
    def setUp(self) -> None:
        self.username = "ih00000000000001"
        self.mark = derive_mark(self.username)
        self.account = KernelAccount(self.username, 1001, self.mark, 2, "normal")

    def test_identity_collisions_and_invalid_marks_fail_closed(self) -> None:
        with self.assertRaises(KernelError):
            validate_identities(
                (
                    KernelIdentity(self.username, 1001, self.mark),
                    KernelIdentity("ih00000000000002", 1001, derive_mark("ih00000000000002")),
                )
            )
        with self.assertRaises(KernelError):
            validate_identities((KernelIdentity(self.username, 1001, self.mark + 1),))

    def test_ruleset_counts_once_and_blocks_customer_imds_and_private_origin(self) -> None:
        self.assertIn(AZURE_IMDS_IPV4, bootstrap_ruleset())
        rules = reconcile_ruleset(
            (self.account,),
            ("eth0",),
            existing_counters=set(),
            customer_uids=(1001, 1002),
        )
        self.assertEqual(rules.count("comment \"iharc-account-ip-bytes-once\""), 1)
        self.assertIn("meta skuid @iharc_customer_imds_uids", rules)
        self.assertIn("ip daddr 127.0.0.1 tcp dport", rules)
        preserved = reconcile_ruleset(
            (self.account,),
            ("eth0",),
            existing_counters={"iharc_account_bytes_" + self.username},
        )
        self.assertNotIn("add counter", preserved)

    def test_throttled_account_gets_the_enforced_throttled_rate(self) -> None:
        recorder = TcRecorder()
        account = KernelAccount(self.username, 1001, self.mark, 2, "throttled")
        HtbShaper(recorder).reconcile((account,), ("eth0",))
        joined = [" ".join(call) for call in recorder.calls]
        self.assertTrue(any(f"rate {THROTTLED_RATE_BPS}bit" in call for call in joined))
        self.assertTrue(any(f"handle {self.mark:#x}/0xffffffff" in call for call in joined))


if __name__ == "__main__":
    unittest.main()
