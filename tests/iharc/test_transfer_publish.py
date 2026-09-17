from __future__ import annotations

import json
import pathlib
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

from support import LIBEXEC, encoded_policy, policy

sys.path.insert(0, str(LIBEXEC))
from iharc_transfer_policy import PolicyError
from iharc_transfer_publish import Publisher


class PublisherTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temporary.name)
        self.config = self.root / "etc/iharc/transfer-accounts.json"
        self.config.parent.mkdir(parents=True)
        self.config.write_text(
            json.dumps(
                {
                    "schema_version": 2,
                    "public_egress_interfaces": ["eth0"],
                    "accounts": [],
                }
            ),
            encoding="utf-8",
        )
        self.synced = 0
        self.rows: list[dict] = []
        self.publisher = Publisher(
            self.root,
            uid_for_username=lambda username: {
                "ih00000000000001": 1001,
                "ih00000000000002": 1002,
            }[username],
            controller_status=lambda: self.rows,
            authority_sync=self._sync,
            partial_deletion_status=lambda username: False,
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _sync(self) -> None:
        self.synced += 1

    def test_publish_is_atomic_and_permanent_identity_cannot_rebind(self) -> None:
        value = policy()
        self.publisher.publish(value["username"], encoded_policy(value))
        stored = json.loads(self.config.read_text(encoding="utf-8"))
        self.assertEqual(stored["accounts"], [value])
        self.assertEqual(self.synced, 1)
        rebound = policy(username="ih00000000000002", generation=2)
        with self.assertRaises(PolicyError):
            self.publisher.publish(rebound["username"], encoded_policy(rebound))
        self.assertEqual(json.loads(self.config.read_text(encoding="utf-8"))["accounts"], [value])

    def test_status_requires_the_published_period_and_valid_usage(self) -> None:
        value = policy()
        self.publisher.publish(value["username"], encoded_policy(value))
        self.rows = [
            {
                "username": value["username"],
                "period_id": value["period_id"],
                "application_state": "applied",
                "traffic_state": "normal",
                "usage_bytes": 42,
            }
        ]
        self.assertEqual(self.publisher.status(value["username"])["usage_bytes"], 42)
        self.rows[0]["period_id"] = "other"
        with self.assertRaises(PolicyError):
            self.publisher.status(value["username"])

    def test_native_deletion_requires_terminated_applied_blocked_state(self) -> None:
        value = policy(state="terminated")
        self.publisher.publish(value["username"], encoded_policy(value))
        self.rows = [
            {
                "username": value["username"],
                "period_id": value["period_id"],
                "application_state": "pending",
                "traffic_state": "blocked",
                "usage_bytes": 10,
            }
        ]
        with self.assertRaises(PolicyError):
            self.publisher.assert_terminal_ready(value["username"])
        self.rows[0]["application_state"] = "applied"
        self.publisher.assert_terminal_ready(value["username"])

    @mock.patch("iharc_transfer_publish.subprocess.run")
    def test_native_authority_sync_waits_for_the_existing_systemd_oneshot(self, run: mock.Mock) -> None:
        run.return_value = SimpleNamespace(returncode=0)
        self.publisher.native_authority_sync()
        run.assert_called_once_with(
            ["/usr/bin/systemctl", "start", "--wait", "iharc-haproxy-cert-sync.service"],
            check=False,
            timeout=20,
            env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C"},
        )

    @mock.patch("iharc_transfer_publish.subprocess.run")
    def test_native_authority_sync_fails_closed_when_the_systemd_oneshot_fails(self, run: mock.Mock) -> None:
        run.return_value = SimpleNamespace(returncode=1)
        with self.assertRaisesRegex(PolicyError, "HAProxy authority synchronization is unavailable"):
            self.publisher.native_authority_sync()


if __name__ == "__main__":
    unittest.main()
