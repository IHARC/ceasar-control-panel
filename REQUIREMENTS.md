# Ceasar decisions

## Public onboarding wizard

- Date: 2026-10-24.
- Source: Jordan, task `01a16ec9-1053-7d30-b619-a29415202003`, "PLEASE IMPLEMENT THIS PLAN: Public Ceasar onboarding wizard".
- Scope: Public Ceasar onboarding; IHARC commercial policy remains installation-specific.
- Decision: Publish a resumable mobile/desktop wizard, native website operations/progress, supported WordPress installation/migration, direct access and domain guidance. Reuse native PHP/JavaScript, commands, file/database tools and branding. Native users can use site setup without IHARC's private repository; optional enrollment uses documented identity/billing/provider interfaces. Replace superseded setup code rather than maintaining two workflows.
- Decision: Use standard WordPress and its own editor/themes, WPvivid's supported migration UI with backup-upload fallback, and a pinned public WP-CLI login package for short-lived single-use access. Preserve imported content/users/passwords and ordinary WordPress login. No AI chatbot, bespoke editor, fabricated starter content, or new standalone billing platform.
- Decision: Add configurable Cloudflare Turnstile Managed CAPTCHA to customer auth and native login/reset where enabled. Verify on the authentication server, keep keys installation-specific, and preserve drafts across recoverable failures. Do not embed IHARC credentials/default recipients or impose IHARC product policy on other operators.
- Decision: Use typed idempotent tenant-bound operations and a small durable SQLite ledger with a bounded native PHP/systemd worker. Keep commercial admission and native website execution ownership distinct. Preserve existing accounts/services and upgrades.
