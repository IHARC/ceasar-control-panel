# Customisation

::: warning
We currently only support changing the layout via CSS. You can customise HTML files and templates, but they **will** be overwritten during updates, so make sure to [set up hooks](#running-commands-before-and-after-updates) to restore your changes after an update.
:::

## Managed-service integrations

This fork provides the canonical-account lifecycle commands
`iharc-customer-isolation`, `v-iharc-resource-isolation`,
`iharc-transfer-uid-floor`, `v-iharc-transfer-policy`, and
`iharc-haproxy-cert-sync`, with their nonsecret Python support files under
Ceasar `libexec/iharc`. A managed hosting deployment must supply its
root-owned account profile, transfer-policy data, service units, and HAProxy
configuration. Those deployment bindings are intentionally outside this
repository. Missing or unsafe deployment configuration makes the affected
canonical-account operation fail; these commands have no fallback path.
Managed behavior requires `MANAGED_SERVICES='yes'` and a canonical managed
account. Ordinary usernames continue to use native Ceasar groups, permissions,
database handling, and per-user quotas.

## Customer account module

The customer account pages are optional and disabled on a normal installation.
Configure them through a validated install profile based on
`install/common/customer/customer.example.json`. The module uses the configured
Supabase project for identity and sends typed customer operations to the
same-origin path in `worker_api_base`. The provider implements that API; Ceasar
does not require or bundle a specific provider backend.

## Adding a new theme

Create a new theme in `/usr/local/ceasar/web/css/themes/custom/my_theme.css`

```css
.page-login,
.page-reset {
	height: auto;
	padding-top: 10%;
	background: rgb(231, 102, 194) !important;
	background: radial-gradient(circle, rgba(231, 102, 197, 1), rgba(174, 43, 177, 1)) !important;
}
```

## Customising a default theme

Changes to default themes are always overwritten during updates. Custom CSS files can be uploaded to `/usr/local/ceasar/web/css/custom` in `.css` or `.min.css` format.

Please note that `default.css` base theme is always loaded. Other default and custom themes override the rules in this file.

## Customising the _Domain not found_ page

The _Domain not found_ page is located in `/var/www/html/index.html`. You can edit it using the following command:

```bash
nano /var/www/html/index.html
```

## Customising the default domain skeleton structure

The default structure that will be added to a domain when it gets created is located in `/usr/local/ceasar/data/templates/web/skel/public_html`.

## Running commands before and after updates

With the release of Ceasar 1.4.6 we have added pre-install and post-install hooks. For example, you can use hooks to:

- Disable and enable demo mode before and after an update.
- Restore a customised skeleton page.

Hooks are located in one of the following files:

- `/etc/ceasar/hooks/pre_install.sh`
- `/etc/ceasar/hooks/post_install.sh`

::: tip
Don’t forget to make the file executable by running `chmod +x /etc/ceasar/hooks/[file].sh`.
:::

For example, to disable demo mode on pre-install:

```bash /etc/ceasar/hooks/pre_install.sh
#!/bin/bash
sed -i "s|^DEMO_MODE=.*'|DEMO_MODE='no'|g" $CEASAR/conf/ceasar.conf
```

::: warning
If you use custom error documents you will have to rebuild all websites again!
:::
