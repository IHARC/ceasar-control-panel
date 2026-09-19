# Ceasar Control Panel

Ceasar Control Panel is an independent GPL hosting control panel for Ubuntu
24.04 amd64. It ships its own packages, installer, runtime paths, commands, web
interface, and release updates.

## Source status

- Upstream project: <https://github.com/hestiacp/hestiacp.git>
- Baseline tag: `1.10.4`
- Baseline commit: `733dd4453ae358b587d61b3f2faedf6e24c4db51`
- Ceasar releases preserve the upstream GPL license and attribution while using
  Ceasar-owned package, command, service, and filesystem names.

## Server-owned branding

Fresh installs default to **Ceasar Control Panel** through `APP_NAME`. An
administrator can change the name, title, sender details, documentation
visibility, and logo from the native **Server -> White Label** page. The
corresponding native commands are `v-change-sys-config-value` and
`v-update-white-label-logo`.

The default logo and favicon are text-first Ceasar assets. A server owner can
replace them through the existing `web/images/custom/` white-label flow.
The native source exposes `HIDE_DOCS` as the documentation visibility control;
it does not expose a configurable Ceasar support URL. It defaults to `yes` for
a white-label install, so the upstream documentation entry point is hidden
until an administrator enables it.

## Local preview

The native PHP template preview renders the actual header, login, footer, and
generated theme assets with the default Ceasar configuration. Run it from the
repository root on a machine with Node.js and PHP:

```bash
npm run build
php -S 127.0.0.1:8099 -t . tools/branding-preview.php
```

Open <http://127.0.0.1:8099/> for the default and
<http://127.0.0.1:8099/?brand=iharc> for the `IHARC Labs Hosting` server-owned
override. The preview is a QA fixture; it does not connect to a host, cloud
provider, database, or authentication service.

## Optional customer and managed-hosting integrations

The optional customer module uses Supabase Auth in the browser and a configured
same-origin business API. It is disabled by default. Start with
`install/common/customer/customer.example.json`; `worker_api_base` selects the
provider-owned API path without embedding provider code in Ceasar.
An installation can also opt into consent-aware GA4 for customer pages by adding
an `analytics` object with its own `measurement_id` and, when the portal shares
a parent domain with another site, `consent_cookie_domain`. It is omitted by
default and collects no analytics until the customer grants consent.

Managed-hosting hooks are also disabled by default. Enabling them requires an
explicit managed profile and external root-owned provider configuration.
Ordinary Ceasar account names retain native panel behavior even on a managed
host. `release/iharc-profile.example.json` is one concrete integration example.

## Upstream notices and license

Upstream attribution, copyright language, source provenance, and license
information are recorded in [UPSTREAM_NOTICES.md](UPSTREAM_NOTICES.md). The
upstream `LICENSE` file remains unchanged.
