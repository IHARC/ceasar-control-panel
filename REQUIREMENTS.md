# Ceasar decisions

## Customer-facing language and layout

- Date: 2026-10-27.
- Source: Jordan, task `01a17da1-dd1d-7531-b6ce-85c93df6cc22`, requested correction of the IHARC public site and hosting itself: "There should never be any bullshit risk framing, internal sounding copy, over use of badging/cards, etc".
- Scope: Reusable Ceasar customer-facing account, hosting, onboarding, authentication and support UI. IHARC commercial policy and branding remain installation-specific.
- Decision: Use direct customer language and restrained layouts. Remove internal operational commentary, risk framing, repetitive caveats, decorative badges and excessive cards. Explain an actual blocked action with a useful next step. Preserve accurate prices, entitlements, meaningful statuses and actionable errors; do not change business rules, security behavior or contractual commitments as copy cleanup.
- Clarification: Jordan, same task, 2026-10-27: "We do not under any circumstances need risk framing even remotely close to that ever." Present setup choices and included tools plainly; remove defensive warnings and risk-framed explanations throughout customer screens.

## Public onboarding wizard

- Date: 2026-10-24.
- Source: Jordan, task `01a16ec9-1053-7d30-b619-a29415202003`, "PLEASE IMPLEMENT THIS PLAN: Public Ceasar onboarding wizard".
- Scope: Public Ceasar onboarding; IHARC commercial policy remains installation-specific.
- Decision: Publish a resumable mobile/desktop wizard, native website operations/progress, supported WordPress installation/migration, direct access and domain guidance. Reuse native PHP/JavaScript, commands, file/database tools and branding. Native users can use site setup without IHARC's private repository; optional enrollment uses documented identity/billing/provider interfaces. Replace superseded setup code rather than maintaining two workflows.
- Decision: Use standard WordPress and its own editor/themes, WPvivid's supported migration UI with backup-upload fallback, and a pinned public WP-CLI login package for short-lived single-use access. Preserve imported content/users/passwords and ordinary WordPress login. No AI chatbot, bespoke editor, fabricated starter content, or new standalone billing platform.
- Decision: Add configurable Cloudflare Turnstile Managed CAPTCHA to customer auth and native login/reset where enabled. Verify on the authentication server, keep keys installation-specific, and preserve drafts across recoverable failures. Do not embed IHARC credentials/default recipients or impose IHARC product policy on other operators.
- Decision: Use typed idempotent tenant-bound operations and a small durable SQLite ledger with a bounded native PHP/systemd worker. Keep commercial admission and native website execution ownership distinct. Preserve existing accounts/services and upgrades.
