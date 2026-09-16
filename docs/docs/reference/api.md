# API

::: info
This page is work in progress. A lot of information will be missing.
:::

## Examples

Examples can be found in a separate [repo](https://github.com/iharc-jordan/ceasar-control-panel-api-examples).

## Upgrading from username/password authentication to access/secret keys

Replace the following code:

```php
// Prepare POST query
$postvars = [
	"user" => $ceasar_username,
	"password" => $ceasar_password,
	"returncode" => $ceasar_returncode,
	"cmd" => $ceasar_command,
	"arg1" => $username,
];
```

With the following:

```php
// Prepare POST query
$postvars = [
	"hash" => "access_code:secret_code",
	"returncode" => $ceasar_returncode,
	"cmd" => $ceasar_command,
	"arg1" => $username,
];
```
