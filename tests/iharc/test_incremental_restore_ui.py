#!/usr/bin/env python3
"""Guard the customer incremental-restore form's native queue commands."""
from __future__ import annotations

import pathlib
import unittest


SOURCE = (
    pathlib.Path(__file__).resolve().parents[2]
    / "web"
    / "bulk"
    / "restore"
    / "incremental"
    / "index.php"
).read_text(encoding="utf-8")
REBUILD = (
    pathlib.Path(__file__).resolve().parents[2] / "func" / "rebuild.sh"
).read_text(encoding="utf-8")


class IncrementalRestoreUiTests(unittest.TestCase):
    def test_mail_selection_schedules_mail_once(self) -> None:
        mail_block = SOURCE.split('if (!empty($mail)) {', 1)[1].split('if (!empty($cron)) {', 1)[0]
        self.assertIn('"mail"', mail_block)
        self.assertIn('$mail,', mail_block)
        self.assertNotIn('"dns"', mail_block)
        self.assertNotIn('$db,', mail_block)

    def test_endpoint_does_not_dump_posted_restore_data(self) -> None:
        self.assertNotIn("var_dump(", SOURCE)

    def test_root_reads_the_root_only_error_document_skeleton(self) -> None:
        self.assertIn('tar -C "$WEBTPL/skel/document_errors" -cf - .', REBUILD)
        self.assertIn('user_exec tar -C "$HOMEDIR/$user/web/$domain/document_errors" --no-same-owner -xf -', REBUILD)


if __name__ == "__main__":
    unittest.main()
