<div data-customer-notice class="customer-notice" aria-live="polite" hidden></div>

<div class="customer-account-context u-hidden" data-account-switcher>
	<label class="customer-form-label" for="customer-account-context">Account</label>
	<select class="form-select" id="customer-account-context" data-account-select disabled><option>Loading…</option></select>
</div>

<section class="customer-view" data-customer-view="hosting">
	<h1 class="customer-view-heading" tabindex="-1">Hosting</h1>
	<p class="customer-view-intro">Set up a website, follow its progress, and connect your domain when it is ready.</p>

	<section class="customer-section">
		<h2>Your hosting</h2>
		<p class="customer-empty" data-service-empty>Loading hosting services…</p>
		<div class="customer-row-list" data-service-list></div>
		<div class="customer-actions"><button class="button" type="button" data-open-setup>Add hosting</button><button class="button button-secondary" type="button" data-hosting-read-retry hidden>Retry</button></div>
		<div class="customer-service-detail u-hidden" data-service-detail></div>
	</section>

	<section class="customer-section u-hidden" data-setup-status-section>
		<h2>Setup status</h2>
		<div data-setup-status></div>
		<div class="customer-actions"><button class="button button-secondary" type="button" data-refresh-setup>Refresh status</button></div>
	</section>
</section>

<section class="customer-view" data-customer-view="setup" hidden>
	<p class="customer-empty" data-setup-load-failure hidden>Hosting options are unavailable right now. Return to hosting and try again.</p>
	<div data-onboarding-wizard></div>
</section>

<section class="customer-view" data-customer-view="billing" hidden>
	<h1 class="customer-view-heading" tabindex="-1">Billing</h1>
	<p class="customer-view-intro">Review your current subscription, invoices, and payment method.</p>
	<section class="customer-section">
		<div data-billing-summary><p class="customer-empty">Loading billing information…</p></div>
		<form class="customer-actions u-hidden" data-account-action="billing-portal" data-billing-portal><button class="button" type="submit">Manage billing</button></form>
	</section>
</section>

<section class="customer-view" data-customer-view="support" hidden>
	<h1 class="customer-view-heading" tabindex="-1">Support</h1>
	<p class="customer-view-intro">Ask for help with your hosting or account.</p>
	<p class="customer-empty u-hidden" data-support-fallback>Need help now? <a data-support-contact>Contact <?= htmlspecialchars((string) $config['brand_name'], ENT_QUOTES) ?>.</a></p>
	<div class="customer-support-layout" data-support-layout>
		<section class="customer-section" data-support-list-section>
			<h2>Your cases</h2>
			<form class="customer-form customer-support-search" data-support-search>
				<label class="customer-form-label" for="support-search">Find a case</label>
				<div class="customer-actions"><input class="form-control" id="support-search" name="search" type="search" maxlength="160" autocomplete="off"><button class="button button-secondary" type="submit">Search</button></div>
			</form>
			<div class="customer-case-list" data-support-case-list><p class="customer-empty">Loading support cases…</p></div>
			<div class="customer-actions"><button class="button button-secondary" type="button" data-support-next hidden>More cases</button><button class="button button-secondary" type="button" data-support-retry hidden>Retry cases</button></div>
		</section>
		<section class="customer-section" data-support-detail-section>
			<div data-support-case-detail><p class="customer-empty">Choose a case to read the conversation.</p></div>
			<p><button class="button button-secondary" type="button" data-support-earlier hidden>Load earlier messages</button></p>
			<div class="customer-message-list" data-support-message-list></div>
			<form class="customer-form" data-account-action="support-reply" data-support-reply-form hidden>
				<div class="customer-form-field"><label class="customer-form-label" for="support-reply">Reply</label><textarea class="form-control" id="support-reply" name="message" maxlength="10000" required></textarea></div>
				<div class="customer-form-field"><label class="customer-form-label" for="support-reply-attachments">Attachments</label><input id="support-reply-attachments" name="attachments" type="file" multiple><p class="customer-form-help">Files are checked before they are added to the conversation.</p></div>
				<div class="customer-actions"><button class="button" type="submit">Send reply</button><button class="button button-secondary" type="button" data-support-close>Close case</button><button class="button button-secondary" type="button" data-support-reopen hidden>Reopen case</button></div>
			</form>
		</section>
	</div>
	<section class="customer-section" data-support-actions>
		<h2>Open a support case</h2>
		<form class="customer-form" data-account-action="support-open">
			<div class="customer-form-field"><label class="customer-form-label" for="support-subject">Subject</label><input class="form-control" id="support-subject" name="subject" maxlength="240" required></div>
			<div class="customer-form-field"><label class="customer-form-label" for="support-message">How can we help?</label><textarea class="form-control" id="support-message" name="message" maxlength="10000" required></textarea></div>
			<div class="customer-form-field"><label class="customer-form-label" for="support-attachments">Attachments</label><input id="support-attachments" name="attachments" type="file" multiple><p class="customer-form-help">Files are checked before they are added to the case.</p></div>
			<button class="button" type="submit">Open case</button>
		</form>
	</section>
	<section class="customer-section u-hidden" data-support-account-required><p>Name your customer account before opening a case. <a href="#setup" data-open-onboarding>Name your account.</a></p></section>
</section>

<section class="customer-view" data-customer-view="profile" hidden>
	<h1 class="customer-view-heading" tabindex="-1">Profile</h1>
	<p class="customer-view-intro">Keep your name and email address current.</p>
	<section class="customer-section">
		<form class="customer-form" data-account-action="profile"><div class="customer-form-field"><label class="customer-form-label" for="display-name">Name</label><input class="form-control" id="display-name" name="display_name" autocomplete="name" required></div><button class="button" type="submit">Save profile</button></form>
	</section>
	<section class="customer-section">
		<h2>Change email</h2>
		<form class="customer-form" data-account-action="email-change"><div class="customer-form-field"><label class="customer-form-label" for="new-email">New email address</label><input class="form-control" id="new-email" type="email" autocomplete="email" required><p class="customer-form-help">Follow the confirmation instructions sent to your email addresses.</p></div><button class="button button-secondary" type="submit">Send confirmation</button></form>
	</section>
</section>

<section class="customer-view" data-customer-view="security" hidden>
	<h1 class="customer-view-heading" tabindex="-1">Security</h1>
	<p class="customer-view-intro">Manage your password and passkeys.</p>
	<section class="customer-section">
		<h2>Change password</h2>
		<form class="customer-form" data-account-action="password-change"><div class="customer-form-field"><label class="customer-form-label" for="new-password">New password</label><input class="form-control" id="new-password" type="password" name="password" autocomplete="new-password" required data-password-input><p class="customer-form-help" data-password-help></p></div><button class="button" type="submit">Change password</button></form>
	</section>
	<section class="customer-section" data-passkey-section>
		<h2>Passkeys</h2>
		<p class="customer-empty" data-passkey-empty>No passkeys registered.</p>
		<div class="customer-row-list" data-passkey-rows></div>
		<div class="customer-actions"><button class="button button-secondary u-hidden" type="button" data-passkey-register>Add a passkey</button></div>
	</section>
</section>
