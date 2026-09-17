import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]


class ForceSslProxyContractTests(unittest.TestCase):
    def test_nginx_force_ssl_honors_the_sanitized_edge_protocol(self) -> None:
        command = (ROOT / "bin" / "v-add-web-domain-ssl-force").read_text(encoding="utf-8")
        self.assertNotIn("echo 'return 301 https://$host$request_uri;'", command)
        self.assertIn('if ($http_x_forwarded_proto != "https") {', command)
        self.assertIn("return 301 https://$host$request_uri;", command)

    def test_haproxy_sets_the_protocol_header_on_both_edge_listeners(self) -> None:
        synchronizer = (ROOT / "libexec" / "iharc" / "iharc_haproxy_cert_sync.py").read_text(
            encoding="utf-8"
        )
        self.assertIn('"    http-request set-header X-Forwarded-Proto http"', synchronizer)
        self.assertIn('"    http-request set-header X-Forwarded-Proto https"', synchronizer)

    def test_package_upgrade_refreshes_existing_force_ssl_configs(self) -> None:
        postinst = (ROOT / "src" / "deb" / "ceasar" / "postinst").read_text(
            encoding="utf-8"
        )
        self.assertIn(
            '"$BIN/v-add-web-domain-ssl-force" "$user" "$DOMAIN" no yes', postinst
        )
        self.assertIn('"$BIN/v-restart-web" yes', postinst)
        self.assertIn('"$BIN/v-restart-proxy" yes', postinst)


if __name__ == "__main__":
    unittest.main()
