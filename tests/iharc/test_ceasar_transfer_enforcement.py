from __future__ import annotations

import datetime as dt
import json
import pathlib
import tempfile
import unittest

from support import load_daemon, policy


transferd = load_daemon()


class FakeKernel:
    def __init__(self) -> None:
        self.values: dict[str, int] = {}
        self.reconciliations: list[tuple] = []
        self.retired = False

    def reconcile(self, accounts, interfaces, *, initialize=False, customer_uids=()):
        self.reconciliations.append((tuple(accounts), tuple(interfaces), initialize, tuple(customer_uids)))

    def counts(self, accounts):
        return {
            account.username: self.values[account.username]
            for account in accounts
            if account.username in self.values
        }

    def retire_legacy_table(self):
        self.retired = True


class FakeShaper:
    def __init__(self) -> None:
        self.reconciliations: list[tuple] = []

    def reconcile(self, accounts, interfaces):
        self.reconciliations.append((tuple(accounts), tuple(interfaces)))


class EnforcementTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temporary.name)
        self.config = self.root / "etc/iharc/transfer-accounts.json"
        self.config.parent.mkdir(parents=True)
        self.value = policy()
        self._write([self.value])
        self.kernel = FakeKernel()
        self.shaper = FakeShaper()
        self.daemon = transferd.TransferDaemon(
            self.config,
            self.root,
            kernel=self.kernel,
            shaper=self.shaper,
            uid_for_username=lambda username: {"ih00000000000001": 1001}[username],
            username_for_uid=lambda uid: {1001: "ih00000000000001"}[uid],
            boot_id="boot-a",
            utcnow=lambda: dt.datetime(2026, 1, 15, tzinfo=dt.timezone.utc),
        )

    def tearDown(self) -> None:
        self.daemon.database.close()
        self.temporary.cleanup()

    def _write(self, accounts) -> None:
        self.config.write_text(
            json.dumps(
                {
                    "schema_version": 2,
                    "public_egress_interfaces": ["eth0"],
                    "accounts": accounts,
                }
            ),
            encoding="utf-8",
        )

    def test_usage_is_durable_and_threshold_changes_the_kernel_tier(self) -> None:
        self.kernel.values[self.value["username"]] = 10
        first = self.daemon.initialize_kernel()
        self.assertTrue(self.kernel.retired)
        self.assertEqual(first[0]["traffic_state"], "normal")
        self.assertEqual(first[0]["usage_bytes"], 0)
        self.kernel.values[self.value["username"]] = 120
        second = self.daemon.once()
        self.assertEqual(second[0]["usage_bytes"], 110)
        self.assertEqual(second[0]["traffic_state"], "throttled")
        self.assertEqual(second[0]["reason"], "threshold_reached")
        self.assertEqual(second[0]["application_state"], "applied")

    def test_missing_counter_degrades_only_the_known_account(self) -> None:
        self.kernel.values[self.value["username"]] = 10
        self.daemon.once(initialize=True)
        self.kernel.values.clear()
        result = self.daemon.once()
        self.assertEqual(
            (result[0]["traffic_state"], result[0]["reason"], result[0]["application_state"]),
            ("throttled", "usage_unknown", "applied"),
        )

    def test_same_boot_counter_regression_is_fail_closed(self) -> None:
        self.kernel.values[self.value["username"]] = 50
        self.daemon.once(initialize=True)
        self.kernel.values[self.value["username"]] = 10
        result = self.daemon.once()
        self.assertEqual(result[0]["traffic_state"], "throttled")
        self.assertEqual(result[0]["reason"], "counter_regressed")

    def test_malformed_configuration_retains_and_degrades_prior_policy(self) -> None:
        self.kernel.values[self.value["username"]] = 10
        self.daemon.once(initialize=True)
        self.config.write_text("{", encoding="utf-8")
        result = self.daemon.once()
        self.assertEqual(result[0]["traffic_state"], "throttled")
        self.assertEqual(result[0]["reason"], "configuration_invalid")
        self.assertEqual(result[0]["application_state"], "pending")

    def test_permanent_subject_cannot_move_to_another_native_username(self) -> None:
        self.kernel.values[self.value["username"]] = 10
        self.daemon.once(initialize=True)
        rebound = policy(username="ih00000000000002", generation=2)
        self._write([rebound])
        result = self.daemon.once()
        self.assertEqual(result[0]["username"], self.value["username"])
        self.assertEqual(result[0]["traffic_state"], "throttled")
        self.assertEqual(result[0]["reason"], "configuration_invalid")


if __name__ == "__main__":
    unittest.main()
