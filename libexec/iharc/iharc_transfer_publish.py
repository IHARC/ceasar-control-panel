#!/usr/bin/env python3
"""Root-only publication of schema-2 traffic permissions.

This command transports an already-authoritative policy from the native Hestia
bridge. It has no pricing, provider, allowance-issuance, or controller-lease
authority. Publication never writes usage or refreshes traffic permission.
"""
from __future__ import annotations

import base64
import json
import os
import pathlib
import pwd
import sqlite3
import stat
import subprocess
import sys
import tempfile
from typing import Callable

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from iharc_pam_transfer import derive_mark, is_canonical_username
from iharc_transfer_policy import PolicyError, parse_policy, validate_successor


CONFIG_SCHEMA_VERSION = 2
MAX_CONFIG_BYTES = 2 * 1024 * 1024


class Publisher:
    def __init__(
        self, root: pathlib.Path = pathlib.Path("/"), *, uid_for_username: Callable[[str], int] | None = None,
        controller_status: Callable[[], list[dict]] | None = None,
        authority_sync: Callable[[], None] | None = None,
        partial_deletion_status: Callable[[str], bool] | None = None,
    ) -> None:
        self.root = pathlib.Path(root)
        self.test_mode = self.root != pathlib.Path("/") and uid_for_username is not None
        if not self.test_mode and os.geteuid() != 0:
            raise PolicyError("Linux root context required")
        self.uid_for_username = uid_for_username or (lambda username: pwd.getpwnam(username).pw_uid)
        self.controller_status = controller_status or self.native_controller_status
        self.authority_sync = authority_sync or (lambda: None if self.test_mode else self.native_authority_sync())
        self.partial_deletion_status = partial_deletion_status or self.native_partial_deletion_status
        self.config_path = self.path("/etc/iharc/transfer-accounts.json")
        self.database = self.path("/var/lib/iharc-transferd/transfer.sqlite3")

    def path(self, absolute: str) -> pathlib.Path:
        return self.root / absolute.lstrip("/")

    def _trusted_config(self) -> dict:
        try:
            info = os.lstat(self.config_path)
            if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_CONFIG_BYTES:
                raise PolicyError("transfer policy configuration is unsafe")
            if not self.test_mode and (info.st_uid != 0 or info.st_gid != 0 or stat.S_IMODE(info.st_mode) != 0o600):
                raise PolicyError("transfer policy configuration ownership is unsafe")
            with self.config_path.open("r", encoding="utf-8") as handle:
                value = json.load(handle)
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise PolicyError("transfer policy configuration is unavailable") from error
        expected = {"schema_version", "public_egress_interfaces", "accounts"}
        keys = set(value) if isinstance(value, dict) else set()
        if (
            not isinstance(value, dict)
            or keys != expected
            or value.get("schema_version") != CONFIG_SCHEMA_VERSION
        ):
            raise PolicyError("schema-2 transfer policy configuration is required")
        accounts = value.get("accounts")
        interfaces = value.get("public_egress_interfaces")
        if not isinstance(accounts, list) or not isinstance(interfaces, list) or not interfaces:
            raise PolicyError("transfer policy accounts are invalid")
        policies = [parse_policy(item) for item in accounts]
        if len({policy.subject_id for policy in policies}) != len(policies) or len({policy.username for policy in policies}) != len(policies):
            raise PolicyError("transfer policy account identity is duplicated")
        return value

    def _known_binding(self, username: str, subject_id: str) -> bool:
        if not self.database.is_file():
            return False
        try:
            with sqlite3.connect(self.database.as_uri() + "?mode=ro", uri=True) as database:
                row = database.execute(
                    "SELECT username FROM ceasar_account_bindings WHERE subject_id=?", (subject_id,),
                ).fetchone()
        except sqlite3.Error:
            return False
        return row == (username,)

    def _write_config(self, value: dict) -> None:
        self.config_path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
        descriptor, temporary = tempfile.mkstemp(prefix=".transfer-accounts.", dir=self.config_path.parent)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                json.dump(value, handle, sort_keys=True, separators=(",", ":"))
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(temporary, 0o600)
            if not self.test_mode:
                os.chown(temporary, 0, 0)
            os.replace(temporary, self.config_path)
        except Exception:
            try:
                os.unlink(temporary)
            except OSError:
                pass
            raise

    @staticmethod
    def _decode(encoded: str) -> dict:
        if not isinstance(encoded, str) or not encoded or any(char.isspace() for char in encoded):
            raise PolicyError("policy payload is invalid")
        try:
            padded = encoded + "=" * (-len(encoded) % 4)
            payload = json.loads(base64.b64decode(padded, altchars=b"-_", validate=True).decode("utf-8"))
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise PolicyError("policy payload is invalid") from error
        if not isinstance(payload, dict):
            raise PolicyError("policy payload is invalid")
        return payload

    def publish(self, username: str, encoded: str) -> None:
        if not is_canonical_username(username):
            raise PolicyError("native account is invalid")
        incoming = parse_policy(self._decode(encoded))
        if incoming.username != username:
            raise PolicyError("policy/native account mismatch")
        try:
            uid = self.uid_for_username(username)
        except (KeyError, OSError):
            if incoming.state != "terminated" or not self._known_binding(username, incoming.subject_id):
                raise PolicyError("native account must exist before enrollment")
        else:
            if isinstance(uid, bool) or not isinstance(uid, int) or uid <= 0:
                raise PolicyError("native account identity is invalid")

        config = self._trusted_config()
        accounts = config["accounts"]
        replacement = False
        prior: object | None = None
        for index, value in enumerate(accounts):
            candidate = parse_policy(value)
            if candidate.subject_id == incoming.subject_id or candidate.username == username:
                if candidate.subject_id != incoming.subject_id or candidate.username != username:
                    raise PolicyError("policy would rebind a permanent identity")
                prior = candidate
                accounts[index] = incoming.payload
                replacement = True
                break
        validate_successor(prior, incoming)  # type: ignore[arg-type]
        if not replacement:
            accounts.append(incoming.payload)
        self._write_config(config)
        # The map/fragment is derived from the just-published policy and
        # Hestia's own web.conf/ssl tree. A failed sync leaves the new policy
        # fail-closed in the controller rather than reviving a manual map.
        self.authority_sync()

    def native_authority_sync(self) -> None:
        result = subprocess.run(
            ["/usr/local/hestia/bin/iharc-haproxy-cert-sync"],
            check=False,
            timeout=20,
            env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C"},
        )
        if result.returncode != 0:
            raise PolicyError("HAProxy authority synchronization is unavailable")

    def native_controller_status(self) -> list[dict]:
        daemon = pathlib.Path(__file__).resolve().with_name("iharc-transferd.py")
        if not daemon.is_absolute() or daemon.name != "iharc-transferd.py":
            raise PolicyError("public transfer daemon path is invalid")
        result = subprocess.run(
            ["/usr/bin/python3", str(daemon), "--status"],
            check=False, capture_output=True, text=True, timeout=5,
            env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C"},
        )
        if result.returncode != 0:
            raise PolicyError("transfer controller status is unavailable")
        try:
            value = json.loads(result.stdout)
        except json.JSONDecodeError as error:
            raise PolicyError("transfer controller status is malformed") from error
        if not isinstance(value, list) or not all(isinstance(row, dict) for row in value):
            raise PolicyError("transfer controller status is malformed")
        return value

    def _require_owned_path(self, path: pathlib.Path, *, directory: bool, mode: int) -> os.stat_result:
        try:
            info = os.lstat(path)
        except OSError as error:
            raise PolicyError("native retention deletion is not prepared") from error
        expected_type = stat.S_ISDIR if directory else stat.S_ISREG
        if not expected_type(info.st_mode) or stat.S_IMODE(info.st_mode) != mode:
            raise PolicyError("native retention deletion state is unsafe")
        if not self.test_mode and (info.st_uid != 0 or info.st_gid != 0):
            raise PolicyError("native retention deletion ownership is unsafe")
        return info

    @staticmethod
    def _native_value(path: pathlib.Path, key: str) -> str:
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except (OSError, UnicodeDecodeError) as error:
            raise PolicyError("native account state is unavailable") from error
        prefix = f"{key}='"
        values = [line[len(prefix):-1] for line in lines if line.startswith(prefix) and line.endswith("'")]
        if len(values) != 1:
            raise PolicyError("native account state is malformed")
        return values[0]

    def native_partial_deletion_status(self, username: str) -> bool:
        """Recognize an interrupted account that retention already owns.

        A short-lived account may fail after native isolation is bound but
        before its first authoritative transfer policy is published. Only the
        existing retention transaction, its live delete marker, the suspended
        Hestia record, and an inactive isolation observation may authorize that
        no-policy identity cleanup.
        """
        transaction = self.path(f"/usr/local/hestia/data/iharc-retention/{username}.deletion")
        intent = transaction / "intent"
        delete_root = self.path("/run/iharc-customer-isolation/delete")
        delete_marker = delete_root / username
        user_config = self.path(f"/usr/local/hestia/data/users/{username}/user.conf")

        self._require_owned_path(transaction, directory=True, mode=0o700)
        intent_info = self._require_owned_path(intent, directory=False, mode=0o600)
        self._require_owned_path(delete_root, directory=True, mode=0o700)
        marker_info = self._require_owned_path(delete_marker, directory=False, mode=0o600)
        user_info = self._require_owned_path(user_config, directory=False, mode=0o660)
        if intent_info.st_size > 256 * 1024 or marker_info.st_size != 0 or user_info.st_size > MAX_CONFIG_BYTES:
            raise PolicyError("native retention deletion state is unsafe")

        try:
            fields: dict[str, list[str]] = {}
            for line in intent.read_text(encoding="utf-8").splitlines():
                key, separator, value = line.partition("=")
                if not separator or not key or "\x00" in value:
                    raise PolicyError("native retention transaction is malformed")
                fields.setdefault(key, []).append(value)
        except (OSError, UnicodeDecodeError) as error:
            raise PolicyError("native retention transaction is unavailable") from error
        try:
            uid = self.uid_for_username(username)
        except (KeyError, OSError) as error:
            raise PolicyError("native account identity is unavailable") from error
        if (
            fields.get("version") != ["1"]
            or fields.get("account") != [username]
            or fields.get("uid") != [str(uid)]
            or self._native_value(user_config, "ROLE") != "user"
            or self._native_value(user_config, "SUSPENDED") != "yes"
        ):
            raise PolicyError("native retention transaction does not match the suspended account")

        result = subprocess.run(
            ["/usr/local/hestia/bin/iharc-customer-isolation", "status", username, "/usr/local/hestia"],
            check=False, capture_output=True, text=True, timeout=5,
            env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C"},
        )
        if result.returncode != 0:
            raise PolicyError("native isolation status is unavailable")
        try:
            observation = json.loads(result.stdout)
        except json.JSONDecodeError as error:
            raise PolicyError("native isolation status is malformed") from error
        return observation == {"account_bound": True, "active": False}

    def status(self, username: str) -> dict:
        if not is_canonical_username(username):
            raise PolicyError("native account is invalid")
        config = self._trusted_config()
        policies = [parse_policy(value) for value in config["accounts"]]
        policy = next((value for value in policies if value.username == username), None)
        if policy is None:
            raise PolicyError("native account has no policy")
        rows = self.controller_status()
        row = next((value for value in rows if value.get("username") == username), None)
        if row is None:
            return {
                "policy": policy.payload,
                "application_state": "pending", "traffic_state": "blocked", "usage_bytes": 0,
            }
        if row.get("period_id") != policy.period_id:
            raise PolicyError("controller status does not match the published period")
        if row.get("traffic_state") not in {"normal", "throttled", "blocked"}:
            raise PolicyError("controller traffic state is invalid")
        usage = row.get("usage_bytes")
        if isinstance(usage, bool) or not isinstance(usage, int) or usage < 0:
            raise PolicyError("controller usage is invalid")
        return {
            "policy": policy.payload,
            "application_state": row.get("application_state", "pending"),
            "traffic_state": row["traffic_state"],
            "usage_bytes": usage,
        }

    def assert_terminal_ready(self, username: str) -> None:
        """Refuse native identity removal until terminal traffic closure is observed.

        This verifier has no policy-writing authority. Hestia's delete hook
        calls it before stopping/deleting a canonical identity, so the
        authoritative publisher must first record a terminal policy and the
        local controller must have applied its blocked observation.
        """
        if not is_canonical_username(username):
            raise PolicyError("native account is invalid")
        config = self._trusted_config()
        policies = [parse_policy(value) for value in config["accounts"]]
        policy = next((value for value in policies if value.username == username), None)
        if policy is None:
            if self.partial_deletion_status(username):
                return
            raise PolicyError("terminal transfer policy is required before native deletion")
        if policy.state != "terminated":
            raise PolicyError("terminal transfer policy is required before native deletion")
        observation = self.status(username)
        if observation["application_state"] != "applied" or observation["traffic_state"] != "blocked":
            raise PolicyError("terminal transfer policy has not reached native closure")


def main() -> int:
    if len(sys.argv) not in {3, 4}:
        print("usage: iharc_transfer_publish.py USER status|terminal-ready | USER publish BASE64_POLICY", file=sys.stderr)
        return 2
    username, action = sys.argv[1:3]
    try:
        publisher = Publisher()
        if action == "status" and len(sys.argv) == 3:
            print(json.dumps(publisher.status(username), sort_keys=True, separators=(",", ":")))
            return 0
        if action == "terminal-ready" and len(sys.argv) == 3:
            publisher.assert_terminal_ready(username)
            return 0
        if action == "publish" and len(sys.argv) == 4:
            publisher.publish(username, sys.argv[3])
            return 0
        raise PolicyError("invalid transfer policy command")
    except Exception:
        print("iharc transfer policy command failed", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
