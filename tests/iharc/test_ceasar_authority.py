from __future__ import annotations

import os
import pathlib
import select
import subprocess
import sys
import tempfile
import textwrap
import unittest
from io import StringIO
from unittest import mock

from support import LIBEXEC

sys.path.insert(0, str(LIBEXEC))
import iharc_haproxy_cert_sync
from iharc_haproxy_cert_sync import AuthoritySynchronizer, SyncError
from iharc_pam_transfer import derive_mark


class AuthorityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temporary.name)
        self.username = "ih00000000000001"
        self.user_dir = self.root / "usr/local/ceasar/data/users" / self.username
        self.user_dir.mkdir(parents=True)
        self.sync = AuthoritySynchronizer(self.root)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_native_domain_and_aliases_render_one_owned_edge(self) -> None:
        (self.user_dir / "web.conf").write_text(
            "DOMAIN='example.com' ALIAS='www.example.com,api.example.com' SSL='no'\n",
            encoding="utf-8",
        )
        (domain,) = self.sync._parse_web_conf(self.username)
        self.assertEqual(domain.authorities, ("example.com", "www.example.com", "api.example.com"))
        fragment = self.sync.render_fragment(
            {authority: self.username for authority in domain.authorities},
            {self.username: derive_mark(self.username)},
            (),
        )
        self.assertIn("http-request return status 421", fragment)
        self.assertIn("default_backend iharc_private_nginx", fragment)
        self.assertNotIn("accept-proxy", fragment)

    def test_duplicate_domain_and_world_writable_input_are_rejected(self) -> None:
        config = self.user_dir / "web.conf"
        config.write_text(
            "DOMAIN='example.com' ALIAS='' SSL='no'\n"
            "DOMAIN='example.com' ALIAS='' SSL='no'\n",
            encoding="utf-8",
        )
        with self.assertRaises(SyncError):
            self.sync._parse_web_conf(self.username)
        config.write_text("DOMAIN='example.com' ALIAS='' SSL='no'\n", encoding="utf-8")
        os.chmod(config, 0o666)
        with self.assertRaises(SyncError):
            self.sync._parse_web_conf(self.username)

    @unittest.skipIf(os.name == "nt", "symlink creation is not reliably available on Windows")
    def test_symlink_authority_input_is_rejected(self) -> None:
        target = self.root / "target"
        target.write_text("DOMAIN='example.com' ALIAS='' SSL='no'\n", encoding="utf-8")
        os.symlink(target, self.user_dir / "web.conf")
        with self.assertRaises(SyncError):
            self.sync._parse_web_conf(self.username)

    def test_main_reports_the_synchronization_failure_to_systemd(self) -> None:
        stderr = StringIO()
        with (
            mock.patch.object(iharc_haproxy_cert_sync, "sync", side_effect=SyncError("native state is invalid")),
            mock.patch.object(sys, "argv", ["iharc_haproxy_cert_sync.py", "--sync"]),
            mock.patch.object(sys, "stderr", stderr),
        ):
            self.assertEqual(iharc_haproxy_cert_sync.main(), 1)
        self.assertIn("IHARC HAProxy certificate synchronization failed: native state is invalid", stderr.getvalue())

    @unittest.skipUnless(sys.platform.startswith("linux"), "fcntl locking is a Linux runtime contract")
    def test_synchronization_lock_serializes_processes_and_releases_after_failure(self) -> None:
        worker = textwrap.dedent(
            """
            import pathlib, sys, time
            sys.path.insert(0, sys.argv[1])
            from iharc_haproxy_cert_sync import AuthoritySynchronizer
            synchronizer = AuthoritySynchronizer(pathlib.Path(sys.argv[2]))
            with synchronizer._synchronization_lock():
                print("locked", flush=True)
                if sys.argv[3] == "fail":
                    raise OSError("synchronization body failed")
                time.sleep(float(sys.argv[3]))
            """
        )

        def start(delay: str) -> subprocess.Popen[str]:
            return subprocess.Popen(
                [sys.executable, "-c", worker, str(LIBEXEC), str(self.root), delay],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )

        def finish(process: subprocess.Popen[str], expected: int) -> None:
            code = process.wait(timeout=3)
            errors = process.stderr.read()
            process.stdout.close()
            process.stderr.close()
            self.assertEqual(code, expected, errors)

        first = start("0.4")
        self.assertEqual(first.stdout.readline().strip(), "locked")
        second = start("0")
        self.assertEqual(select.select([second.stdout], [], [], 0.15)[0], [])
        finish(first, 0)
        self.assertEqual(second.stdout.readline().strip(), "locked")
        finish(second, 0)

        failed = start("fail")
        self.assertEqual(failed.stdout.readline().strip(), "locked")
        code = failed.wait(timeout=3)
        errors = failed.stderr.read()
        failed.stdout.close()
        failed.stderr.close()
        self.assertNotEqual(code, 0)
        self.assertIn("synchronization body failed", errors)
        recovered = start("0")
        self.assertEqual(recovered.stdout.readline().strip(), "locked")
        finish(recovered, 0)


if __name__ == "__main__":
    unittest.main()
