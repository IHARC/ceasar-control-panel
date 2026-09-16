"""Executable checks for configured customer entrypoints and passkey scope."""

import json
import pathlib
import shutil
import subprocess
import unittest


ROOT = pathlib.Path(__file__).parents[1]
DOCKER = shutil.which("docker")


@unittest.skipUnless(DOCKER, "Docker is required for the disposable PHP fixture")
class CustomerConfigTests(unittest.TestCase):
    def run_php(self, config: dict) -> subprocess.CompletedProcess[str]:
        script = r'''
            set -eu
            install -d /usr/local/ceasar/conf
            cat > /usr/local/ceasar/conf/customer.json
            php -r '
                $_SERVER["HTTP_HOST"] = "app.iharclabs.ca";
                $_SERVER["HTTPS"] = "on";
                require "/source/web/inc/customer.php";
                echo html_entity_decode(customer_config_json(customer_config()), ENT_NOQUOTES, "UTF-8");
            '
        '''
        return subprocess.run(
            [
                DOCKER,
                "run",
                "--rm",
                "--mount",
                f"type=bind,source={ROOT},target=/source,readonly",
                "-i",
                "php:8.4-cli",
                "sh",
                "-euc",
                script,
            ],
            cwd=ROOT,
            input=json.dumps(config),
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )

    @staticmethod
    def config() -> dict:
        return {
            "schema": 1,
            "enabled": True,
            "brand_name": "IHARC Labs",
            "supabase_url": "https://xissiuxjfilvmfmiowrs.supabase.co",
            "supabase_publishable_key": "sb_publishable_fixture",
            "terms_url": "https://iharclabs.ca/terms",
            "privacy_url": "https://iharclabs.ca/privacy",
            "passkeys_enabled": True,
            "passkey_rp_id": "iharclabs.ca",
            "login_url": "https://app.iharclabs.ca/customer/login",
            "callback_url": "https://login.iharclabs.ca/auth/callback",
            "account_url": "https://app.iharclabs.ca/customer/account",
            "worker_api_base": "/api/iharc/v1/customer",
        }

    def test_preserves_approved_cross_host_callback_and_account_origin(self):
        result = self.run_php(self.config())
        self.assertEqual(result.returncode, 0, result.stderr)
        public = json.loads(result.stdout)
        self.assertEqual(public["loginUrl"], "https://app.iharclabs.ca/customer/login")
        self.assertEqual(public["callbackUrl"], "https://login.iharclabs.ca/auth/callback")
        self.assertEqual(public["accountUrl"], "https://app.iharclabs.ca/customer/account")
        self.assertEqual(public["workerApiBase"], "/api/iharc/v1/customer")

    def test_customer_configuration_is_the_single_module_gate(self):
        script = r'''
            set -eu
            install -d /usr/local/ceasar/conf
            cat > /usr/local/ceasar/conf/customer.json
            php -r '
                $_SERVER["HTTP_HOST"] = "app.iharclabs.ca";
                $_SERVER["HTTPS"] = "on";
                require "/source/web/inc/customer.php";
                echo customer_config()["enabled"] === true ? "enabled" : "disabled";
            '
        '''
        result = subprocess.run(
            [
                DOCKER,
                "run",
                "--rm",
                "--mount",
                f"type=bind,source={ROOT},target=/source,readonly",
                "-i",
                "php:8.4-cli",
                "sh",
                "-euc",
                script,
            ],
            cwd=ROOT,
            input=json.dumps(self.config()),
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "enabled")

    def test_preserves_a_provider_owned_same_origin_worker_path(self):
        config = self.config()
        config["worker_api_base"] = "/api/provider/v2/customer/"
        result = self.run_php(config)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["workerApiBase"], "/api/provider/v2/customer")

    def test_rejects_cross_origin_and_ambiguous_worker_paths(self):
        for worker_api_base in (
            "https://attacker.example/customer",
            "//attacker.example/customer",
            "/api/customer/../admin",
            "/api//customer",
            "/api/customer?admin=true",
        ):
            with self.subTest(worker_api_base=worker_api_base):
                config = self.config()
                config["worker_api_base"] = worker_api_base
                result = self.run_php(config)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("worker API base", result.stdout + result.stderr)

    def test_rejects_account_origin_drift_and_callback_outside_rp(self):
        account_drift = self.config()
        account_drift["account_url"] = "https://other.iharclabs.ca/customer/account"
        result = self.run_php(account_drift)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("must share one origin", result.stdout + result.stderr)

        callback_drift = self.config()
        callback_drift["callback_url"] = "https://attacker.example/auth/callback"
        result = self.run_php(callback_drift)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("relying-party ID", result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
