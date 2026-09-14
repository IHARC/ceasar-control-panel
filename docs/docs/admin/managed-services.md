# Managed services

Set `MANAGED_SERVICES='yes'` in the native system configuration to show the optional administrator-only Managed page. The module requires a direct native administrator session; impersonated sessions are denied.

`/usr/local/hestia/conf/managed-service.json` must be a root-owned `0600` regular file, without symlinks or group/other-writable ancestors, and contain an absolute executable `adapter` path with the same ownership and path requirements. `v-managed-service` requires root execution and a current native administrator account, replaces the actor in the JSON request, validates the finite request schema before starting the adapter, limits it to 32 KiB, and invokes the adapter using JSON on standard input. It accepts reads for the managed sections and only typed trial-capacity and support-case mutations with UUID idempotency keys. The panel remains unchanged when the feature is disabled or the adapter is absent.
