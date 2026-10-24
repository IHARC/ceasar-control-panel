#!/usr/bin/env bash
# Exercise the installed public workflow in the disposable CI container.
set -Eeuo pipefail
set +x
[[ ${CEASAR_ONBOARDING_TEST:-} == 1 && -f /.dockerenv && -d /ceasar-git ]] \
	|| {
		echo 'This fixture only runs in the owned Ceasar CI container.' >&2
		exit 1
	}
export PATH="/usr/local/ceasar/bin:$PATH"
ceasar=/usr/local/ceasar
owner=onboardtest
domain=onboarding.example.test
php=/usr/bin/php8.5
[[ -x "$php" ]]
systemctl stop ceasar-onboarding.timer ceasar-onboarding.service
v-add-user "$owner" 'Fixture-Only-Password-2026!' owner@example.test default
v-add-web-domain "$owner" "$domain"
v-change-web-domain-backend-tpl "$owner" "$domain" PHP-8_5 yes
address=$(v-list-web-domains "$owner" json | python3 -c 'import json,sys; print(json.load(sys.stdin)["onboarding.example.test"]["IP"])')
printf '%s %s\n' "$address" "$domain" >> /etc/hosts

# Trust this fixture certificate in this disposable OS; no public ACME/DNS or
# production identity is involved. The separate native fixture covers issuance.
certdir=$(mktemp -d /tmp/ceasar-onboarding-cert.XXXXXX)
openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
	-subj "/CN=$domain" -addext "subjectAltName=DNS:$domain" \
	-keyout "$certdir/$domain.key" -out "$certdir/$domain.crt" > /dev/null 2>&1
v-add-web-domain-ssl "$owner" "$domain" "$certdir"
install -m 0644 "$certdir/$domain.crt" /usr/local/share/ca-certificates/ceasar-onboarding-fixture.crt
update-ca-certificates > /dev/null 2>&1
curl --fail --silent --show-error "https://$domain/" > /dev/null

payload=$(python3 -c 'import base64,json; print(base64.b64encode(json.dumps({"idempotencyKey":"installed-wordpress-fixture","hostname":"onboarding.example.test","siteType":"wordpress","intent":"new_site","siteTitle":"Onboarding fixture","contactEmail":"owner@example.test"}).encode()).decode())')
started=$(v-onboarding-request "$owner" prepare "$payload")
operation=$(printf '%s' "$started" | python3 -c 'import json,sys; print(json.load(sys.stdin)["operationId"])')
"$ceasar/php/bin/php" "$ceasar/libexec/onboarding-worker.php"
status_payload=$(printf '{"operationId":"%s"}' "$operation" | base64 -w0)
v-onboarding-request "$owner" status "$status_payload" | python3 -c '
import json,sys
status=json.load(sys.stdin)
assert status["status"]=="ready", status
'
v-list-web-domains "$owner" json | python3 -c '
import json,sys
site=json.load(sys.stdin)["onboarding.example.test"]
assert site["BACKEND"]=="PHP-8_5", site["BACKEND"]
assert site["SSL"]=="yes"
'
sudo -H -u "$owner" "$php" "/home/$owner/.wp-cli/wp" core is-installed --path="/home/$owner/web/$domain/public_html"
access_payload=$(printf '{"hostname":"%s","administrator":"wpadmin"}' "$domain" | base64 -w0)
access=$(v-onboarding-request "$owner" wordpress-access "$access_payload")
login_url=$(printf '%s' "$access" | python3 -c '
import json,sys
access=json.load(sys.stdin)
assert access["method"]=="single_use", access["method"]
assert access["url"].startswith("https://onboarding.example.test/")
print(access["url"])
')
curl --fail --silent --show-error --location --cookie-jar "$certdir/cookies" --cookie "$certdir/cookies" \
	"$login_url" --output "$certdir/editor.html"
grep -Fq 'wp-admin-bar-my-account' "$certdir/editor.html"
curl --silent --show-error --location --dump-header "$certdir/replay.headers" \
	"$login_url" --output "$certdir/replay.html"
! grep -Eiq '^Set-Cookie: wordpress_logged_in_' "$certdir/replay.headers"
! grep -Fq 'wp-admin-bar-my-account' "$certdir/replay.html"
echo 'Installed standalone WordPress onboarding, PHP 8.5, HTTPS and editor access passed.'
