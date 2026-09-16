from __future__ import annotations

import os
import pathlib
import tempfile
import unittest

from support import LIBEXEC

import sys

sys.path.insert(0, str(LIBEXEC))
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


if __name__ == "__main__":
    unittest.main()
