<div data-customer-notice class="customer-notice" aria-live="polite" hidden></div>

<div class="customer-account-context u-hidden" data-account-switcher>
	<label class="customer-form-label" for="customer-account-context">Account</label>
	<select class="form-select" id="customer-account-context" data-account-select disabled><option>Loading…</option></select>
</div>

<section class="customer-view" data-customer-view="hosting">
	<h1 class="customer-view-heading" tabindex="-1">Hosting</h1>
	<p class="customer-view-intro">Start with a preview address, then connect your domain in the hosting controls when your service is ready.</p>

	<section class="customer-section u-hidden" data-account-onboarding>
		<h2>Set up your customer account</h2>
		<p>Create an account name before starting hosting or opening a support case.</p>
		<form class="customer-form" data-account-action="account-create">
			<div class="customer-form-field">
				<label class="customer-form-label" for="account-name">Account name</label>
				<input class="form-control" id="account-name" name="display_name" autocomplete="organization" required>
			</div>
			<button class="button" type="submit">Continue</button>
		</form>
	</section>

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
	<h1 class="customer-view-heading" tabindex="-1">Add hosting</h1>
	<p class="customer-view-intro">Choose a plan, tell us what you are hosting, then review before continuing.</p>
	<form class="customer-form" data-account-action="hosting-setup" data-setup-form data-request-key="hosting-setup">
		<fieldset class="customer-setup-step">
			<legend>1. Choose a plan</legend>
			<div class="customer-form-field">
				<label class="customer-form-label" for="setup-plan">Plan</label>
				<select class="form-select" id="setup-plan" name="plan_code" data-plan-select required disabled><option>Loading plans…</option></select>
				<p class="customer-form-help" data-plan-limits></p>
			</div>
		</fieldset>
		<fieldset class="customer-setup-step">
			<legend>2. Tell us about your site</legend>
			<div class="customer-choice-list">
				<label class="customer-choice"><input type="radio" name="intent" value="new_site" checked><span><strong>Start a new site</strong><span>Set up WordPress, PHP, or a static site.</span></span></label>
				<label class="customer-choice"><input type="radio" name="intent" value="migration"><span><strong>Import an existing PHP site</strong><span>You will receive import steps after checkout.</span></span></label>
			</div>
			<div class="customer-form-field u-mt20">
				<label class="customer-form-label" for="setup-site-type" data-site-type-label>Site type</label>
				<select class="form-select" id="setup-site-type" name="site_type"><option value="wordpress">WordPress</option><option value="php">PHP</option><option value="static">Static site</option></select>
				<p class="customer-form-help" data-migration-site-type hidden>Site type: PHP</p>
			</div>
		</fieldset>
		<fieldset class="customer-setup-step">
			<legend>3. Review and continue</legend>
			<p class="customer-form-help" data-setup-review>Your selection will appear here.</p>
			<div class="customer-choice-list" data-setup-billing-choice>
				<label class="customer-choice" data-paid-choice hidden><input type="radio" name="setup_mode" value="paid" checked><span><strong>Pay monthly</strong><span>Continue to secure checkout.</span></span></label>
				<label class="customer-choice" data-trial-choice hidden><input type="radio" name="setup_mode" value="trial"><span><strong>Start free trial</strong><span>Payment details are collected before the trial begins.</span></span></label>
			</div>
			<div class="customer-actions"><button class="button" type="submit">Continue</button><button class="button button-secondary" type="button" data-back-to-hosting>Back to hosting</button></div>
		</fieldset>
	</form>
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
	<div class="customer-support-layout">
		<section class="customer-section">
			<h2>Your cases</h2>
			<div class="customer-case-list" data-support-case-list><p class="customer-empty">Loading support cases…</p></div>
			<div class="customer-actions"><button class="button button-secondary" type="button" data-support-retry hidden>Retry cases</button></div>
		</section>
		<section class="customer-section">
			<div data-support-case-detail><p class="customer-empty">Choose a case to read the conversation.</p></div>
			<div class="customer-message-list" data-support-message-list></div>
			<form class="customer-form" data-account-action="support-reply" data-support-reply-form hidden>
				<div class="customer-form-field"><label class="customer-form-label" for="support-reply">Reply</label><textarea class="form-control" id="support-reply" name="message" maxlength="10000" required></textarea></div>
				<div class="customer-actions"><button class="button" type="submit">Send reply</button><button class="button button-secondary" type="button" data-support-close>Close case</button></div>
			</form>
		</section>
	</div>
	<section class="customer-section" data-support-actions>
		<h2>Open a support case</h2>
		<form class="customer-form" data-account-action="support-open">
			<div class="customer-form-field"><label class="customer-form-label" for="support-subject">Subject</label><input class="form-control" id="support-subject" name="subject" maxlength="240" required></div>
			<div class="customer-form-field"><label class="customer-form-label" for="support-message">How can we help?</label><textarea class="form-control" id="support-message" name="message" maxlength="10000" required></textarea></div>
			<button class="button" type="submit">Open case</button>
		</form>
	</section>
	<section class="customer-section u-hidden" data-support-account-required><p>Create your customer account before opening a case. <a href="#hosting" data-open-onboarding>Set up your account.</a></p></section>
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
