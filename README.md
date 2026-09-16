# Ceasar Control Panel

Ceasar Control Panel is the IHARC Labs maintained white-label checkout for a
hosting control panel. It preserves the upstream Ceasar Control Panel source,
filesystem layout, commands, and APIs so that upstream security and maintenance
work can be reviewed against a pinned source baseline.

## Source status

- Upstream project: <https://github.com/iharc-jordan/ceasar-control-panel.git>
- Baseline tag: `1.10.4`
- Baseline commit: `733dd4453ae358b587d61b3f2faedf6e24c4db51`
- Current checkout: native white-label changes are kept in separate IHARC
  commits on top of that source baseline.

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

## Hosting integration

IHARC Labs pins this repository at `vendor/ceasar`. Its
`infra/common/bootstrap-ceasar.sh` and `infra/common/install-hosting-payload.sh`
install the native panel and host controls. The portal, authentication,
database, billing, background workers, and Azure deployment code live in the
Labs repository. `install/common/api/iharc-control` contains the native API
command profile used by that integration.

## Upstream notices and license

Upstream attribution, copyright language, source provenance, and license
information are recorded in [UPSTREAM_NOTICES.md](UPSTREAM_NOTICES.md). The
upstream `LICENSE` file remains unchanged.
