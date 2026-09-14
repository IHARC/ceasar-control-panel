"""Executable checks for the optional managed-service native boundary.

Each check copies Ceasar into an isolated php:8.4-cli container. It never
reads a host Hestia configuration or talks to a provider or database.
"""

import pathlib
import shutil
import subprocess
import textwrap
import unittest


ROOT = pathlib.Path(__file__).parents[1]
DOCKER = shutil.which("docker")


@unittest.skipUnless(DOCKER, "Docker is required for the disposable PHP fixture")
class ManagedServiceProtocol(unittest.TestCase):
    maxDiff = None

    def fixture(self, body: str) -> subprocess.CompletedProcess[str]:
        setup = r'''
            set -eu
            mkdir -p /etc/hestiacp /usr/local/hestia/conf /usr/local/hestia/log /usr/local/hestia/php/bin /opt/managed /var/lib/managed
            ln -s "$(command -v php)" /usr/local/hestia/php/bin/php
            install -D -m 755 /source/bin/v-managed-service /usr/local/hestia/bin/v-managed-service
            install -D -m 644 /source/func/main.sh /usr/local/hestia/func/main.sh
            install -D -m 644 /source/web/inc/managed-service.php /usr/local/hestia/web/inc/managed-service.php
            install -D -m 644 /source/web/templates/pages/list_managed.php /usr/local/hestia/web/templates/pages/list_managed.php
            printf '%s\n' 'HESTIA=/usr/local/hestia' > /etc/hestiacp/hestia.conf
            printf '%s\n' "MANAGED_SERVICES='yes'" > /usr/local/hestia/conf/hestia.conf
            mkdir -p /usr/local/hestia/data/users/admin
            printf '%s\n' "ROLE='admin'" > /usr/local/hestia/data/users/admin/user.conf
            printf '%s\n' '#!/bin/sh' 'cat > /var/lib/managed/request.json' "printf '%s\\n' '{\"ok\":true}'" > /opt/managed/adapter
            chmod 755 /opt/managed/adapter
            printf '%s\n' '{"adapter":"/opt/managed/adapter"}' > /usr/local/hestia/conf/managed-service.json
            chmod 600 /usr/local/hestia/conf/managed-service.json
        '''
        script = textwrap.dedent(setup) + "\n" + textwrap.dedent(body)
        return subprocess.run(
            [
                DOCKER,
                "run",
                "--rm",
                "--mount",
                f"type=bind,source={ROOT},target=/source,readonly",
                "php:8.4-cli",
                "bash",
                "-euc",
                script,
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=90,
            check=False,
        )

    def assert_fixture(self, body: str) -> None:
        result = self.fixture(body)
        self.assertEqual(result.returncode, 0, msg=f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}")

    def test_command_canonicalizes_valid_input_and_rejects_before_adapter_start(self):
        self.assert_fixture(
            r'''
            if ! printf '%s' '{"actor":"forged","operation":"read","section":"overview","extra":"discarded"}' | /usr/local/hestia/bin/v-managed-service admin > /tmp/response.json; then cat /usr/local/hestia/log/error.log >&2; exit 1; fi
            test "$(cat /tmp/response.json)" = '{"ok":true}'
            php -r '$request = json_decode(file_get_contents("/var/lib/managed/request.json"), true, 512, JSON_THROW_ON_ERROR); if ($request !== ["actor" => "admin", "operation" => "read", "section" => "overview"]) exit(1);'

            printf '%s' '{"operation":"set_trial_capacity","section":"trials","idempotency_key":"11111111-1111-4111-8111-111111111111","payload":{"concurrent_limit":7}}' | /usr/local/hestia/bin/v-managed-service admin > /tmp/mutation-response.json
            test "$(cat /tmp/mutation-response.json)" = '{"ok":true}'
            php -r '$request = json_decode(file_get_contents("/var/lib/managed/request.json"), true, 512, JSON_THROW_ON_ERROR); if ($request !== ["actor" => "admin", "operation" => "set_trial_capacity", "section" => "trials", "idempotency_key" => "11111111-1111-4111-8111-111111111111", "payload" => ["concurrent_limit" => 7]]) exit(1);'

            rm -f /var/lib/managed/request.json
            if printf '%s' '{invalid json' | /usr/local/hestia/bin/v-managed-service admin; then exit 1; fi
            test ! -e /var/lib/managed/request.json

            if printf '%s' '{"operation":"set_trial_capacity","section":"trials","idempotency_key":"11111111-1111-4111-8111-111111111111","payload":{"concurrent_limit":"0"}}' | /usr/local/hestia/bin/v-managed-service admin; then exit 1; fi
            test ! -e /var/lib/managed/request.json

            if printf '%s' '{"operation":"support_reply","section":"support","record_id":"11111111-1111-4111-8111-111111111111","payload":{"message":"hello"}}' | /usr/local/hestia/bin/v-managed-service admin; then exit 1; fi
            test ! -e /var/lib/managed/request.json
            '''
        )

    def test_command_rejects_untrusted_actor_authentication_and_paths(self):
        self.assert_fixture(
            r'''
            rm -f /var/lib/managed/request.json /tmp/managed-injected
            if printf '%s' '{"operation":"read","section":"overview"}' | /usr/local/hestia/bin/v-managed-service 'admin;touch /tmp/managed-injected'; then exit 1; fi
            test ! -e /tmp/managed-injected
            test ! -e /var/lib/managed/request.json

            useradd --no-create-home nativeguest
            if runuser -u nativeguest -- /usr/local/hestia/bin/v-managed-service admin </dev/null; then exit 1; fi
            test ! -e /var/lib/managed/request.json

            mv /usr/local/hestia/conf/managed-service.json /tmp/managed-service.json
            ln -s /tmp/managed-service.json /usr/local/hestia/conf/managed-service.json
            if printf '%s' '{"operation":"read","section":"overview"}' | /usr/local/hestia/bin/v-managed-service admin; then exit 1; fi
            test ! -e /var/lib/managed/request.json

            rm /usr/local/hestia/conf/managed-service.json
            mv /tmp/managed-service.json /usr/local/hestia/conf/managed-service.json
            mv /opt/managed/adapter /opt/managed/adapter.real
            ln -s /opt/managed/adapter.real /opt/managed/adapter
            if printf '%s' '{"operation":"read","section":"overview"}' | /usr/local/hestia/bin/v-managed-service admin; then exit 1; fi
            test ! -e /var/lib/managed/request.json

            rm /opt/managed/adapter
            mv /opt/managed/adapter.real /opt/managed/adapter
            chmod 775 /opt/managed
            if printf '%s' '{"operation":"read","section":"overview"}' | /usr/local/hestia/bin/v-managed-service admin; then exit 1; fi
            test ! -e /var/lib/managed/request.json
            '''
        )

    def test_php_session_forms_and_template_use_the_typed_contract(self):
        self.assert_fixture(
            r'''
            php <<'PHP'
            <?php
            function _($value) { return $value; }
            function tohtml($value) { return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
            require '/usr/local/hestia/web/inc/managed-service.php';
            function expect($condition, $message) { if (!$condition) { fwrite(STDERR, $message . "\n"); exit(1); } }
            function rejects($callback) { try { $callback(); return false; } catch (RuntimeException) { return true; } }

            $id = '11111111-1111-4111-8111-111111111111';
            $form = managed_service_form_request(['operation' => 'set_trial_capacity', 'section' => 'trials', 'concurrent_limit' => '42', 'idempotency_key' => $id]);
            expect($form['payload']['concurrent_limit'] === 42, 'capacity should be a typed integer');
            expect(rejects(fn() => managed_service_form_request(['operation' => 'set_trial_capacity', 'section' => 'trials', 'concurrent_limit' => '4.2', 'idempotency_key' => $id])), 'decimal capacity accepted');
            expect(rejects(fn() => managed_service_form_request(['operation' => 'set_trial_capacity', 'section' => 'trials', 'concurrent_limit' => ['42'], 'idempotency_key' => $id])), 'array capacity accepted');
            expect(rejects(fn() => managed_service_form_request(['operation' => 'support_reply', 'section' => 'support', 'record_id' => $id, 'message' => 'hello'])), 'missing idempotency accepted');
            $unicodeMessage = str_repeat('é', 10000);
            $reply = managed_service_form_request(['operation' => 'support_reply', 'section' => 'support', 'record_id' => $id, 'idempotency_key' => $id, 'message' => $unicodeMessage]);
            expect($reply['payload']['message'] === $unicodeMessage, 'character-counted support message rejected');
            expect(rejects(fn() => managed_service_form_request(['operation' => 'support_reply', 'section' => 'support', 'record_id' => $id, 'idempotency_key' => $id, 'message' => str_repeat('é', 10001)])), 'overlong character-counted support message accepted');
            $read = managed_service_read_request(['section' => 'support', 'record_id' => $id]);
            expect($read['record_id'] === $id, 'support detail id omitted');

            $_SESSION = ['MANAGED_SERVICES' => 'yes', 'userContext' => 'admin', 'user' => 'admin', 'look' => ''];
            expect(managed_service_authorized_session(), 'native admin rejected');
            $_SESSION['look'] = 'customer';
            expect(!managed_service_authorized_session(), 'impersonated session accepted');
            $_SESSION['look'] = '';
            $_SESSION['userContext'] = 'user';
            expect(!managed_service_authorized_session(), 'non-admin session accepted');

            $_SESSION = ['token' => 'csrf', 'managed_request_id' => $id];
            $notice = '';
            $error = '<img src=x onerror=alert(1)>';
            $managed_section = 'support';
            $result = [
                'title' => 'Node health',
                'columns' => [['key' => 'health', 'label' => 'Health']],
                'rows' => [['health' => ['state' => '<ok>']]],
                'trial_capacity' => ['running_count' => 2, 'reserved_count' => 3, 'waiting_count' => 4, 'concurrent_limit' => 5],
                'support_case' => ['id' => $id, 'subject' => 'Case', 'messages' => [['native_actor' => 'admin', 'created_at' => '2026-09-14T00:00:00Z', 'message' => '<reply>']]],
            ];
            ob_start(); include '/usr/local/hestia/web/templates/pages/list_managed.php'; $html = ob_get_clean();
            expect(strpos($html, '<img src=x') === false && strpos($html, '&lt;img src=x') !== false, 'error not escaped exactly once');
            expect(strpos($html, '{&quot;state&quot;:&quot;&lt;ok&gt;&quot;}') !== false, 'nested row value not safely rendered');
            expect(strpos($html, 'Running: 2') !== false && strpos($html, 'Reserved: 3') !== false && strpos($html, 'Waiting: 4') !== false, 'new trial count keys not rendered');
            expect(strpos($html, '&lt;reply&gt;') !== false && strpos($html, '2026-09-14T00:00:00Z') !== false, 'support case messages missing');

            $result['support_case'] = null;
            $result['rows'] = [['id' => $id]];
            $result['columns'] = [['key' => 'id', 'label' => 'ID']];
            ob_start(); include '/usr/local/hestia/web/templates/pages/list_managed.php'; $html = ob_get_clean();
            expect(strpos($html, 'record_id=' . $id) !== false, 'support detail link missing');
            PHP
            '''
        )


if __name__ == '__main__':
    unittest.main()
