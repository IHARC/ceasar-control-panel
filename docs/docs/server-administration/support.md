# Support desk

Ceasar includes an installation-local support desk at **Support**. Customers can create and reply to tickets in the customer portal. Administrators can assign tickets, set priority and status, and add internal notes that customers cannot view.

Configure support recipients, inbound IMAP, SMTP, and connection tests in **Support > Email delivery**. The SMTP account is configured in its **Outgoing email** section. Each Ceasar installation starts with no support recipients, SMTP sender, or IMAP mailbox: configure its own mail service before sending ticket email. Ceasar has no IHARC email fallback. The configured SMTP transport is reused for ticket notifications. A successful SMTP send records transport acceptance; it does not prove final mailbox delivery.

The `ceasar-support.timer` runs delivery and inbound-mail processing. Inspect queued or failed notifications in Support and use its retry action after correcting mail configuration. The service runs as `ceasarweb` and stores ticket data at `/var/lib/ceasar/support`; attachments remain outside the web root.

Use `v-support-backup ARCHIVE.tar` to create a consistent support snapshot, including the SQLite database, attachments, support configuration, and branding assets. `v-support-restore ARCHIVE.tar` validates the snapshot, stops the worker while restoring it, and restores restrictive ownership. Restore into a matching Ceasar installation.

## Branding

**Server > White Label Options** is the single branding configuration for the panel, customer portal, authentication screens, and ticket email display name. It configures the installation name, color, legal/support links, logos, and favicon. Upload PNG, WebP, or safe SVG assets in the page; they are retained at `/usr/local/ceasar/data/branding` across package upgrades.

The SMTP sender address is shown separately because it is transport configuration, while the sender display name is branding. Some SMTP providers override the display name, so configure the provider sender to match the intended branded sender. Every application and authentication page retains the small **Powered by IHARC Labs** link.
