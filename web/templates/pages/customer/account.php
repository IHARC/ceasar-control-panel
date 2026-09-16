<div class="toolbar">
	<div class="toolbar-inner">
		<div class="toolbar-buttons">
			<h1>Customer account</h1>
		</div>
		<div class="toolbar-right">
			<p><span data-customer-email>Loading…</span> · <strong data-customer-aal>—</strong></p>
		</div>
	</div>
</div>
<div class="container">
	<div data-customer-notice aria-live="polite"></div>

	<section id="services" class="form-container form-container-wide">
		<h2 class="u-mb20">Services</h2>
		<div class="u-mb20">
			<label class="form-label" for="customer-account-context">Customer account</label>
			<select class="form-select" id="customer-account-context" data-account-select disabled>
				<option>Loading…</option>
			</select>
		</div>

		<h3 class="u-mb10">Your accounts</h3>
		<div class="units-table u-mb20" data-account-rows>
			<div class="units-table-header">
				<div class="units-table-cell"></div>
				<div class="units-table-cell">Account</div>
				<div class="units-table-cell">Role</div>
			</div>
			<p class="units-table-footer">Loading…</p>
		</div>

		<h3 class="u-mb10">Your hosting services</h3>
		<div class="units-table u-mb20" data-service-rows>
			<div class="units-table-header">
				<div class="units-table-cell"></div>
				<div class="units-table-cell">Service</div>
				<div class="units-table-cell">Status</div>
				<div class="units-table-cell">Native account</div>
			</div>
			<p class="units-table-footer">Loading…</p>
		</div>

		<div class="u-mb20">
			<label class="form-label" for="customer-service-context">Selected service</label>
			<select class="form-select" id="customer-service-context" data-service-select disabled>
				<option>No service yet</option>
			</select>
		</div>
		<div data-native-access class="u-mb20"></div>

		<h3 class="u-mb10">Start a hosting service</h3>
		<form data-account-action="admission-trial">
			<div class="u-mb10">
				<label class="form-label" for="trial-plan">Plan</label>
				<select class="form-select" id="trial-plan" name="plan_code" data-plan-select required disabled><option>Loading…</option></select>
			</div>
			<div class="u-mb10">
				<label class="form-label" for="trial-site-type">Site type</label>
				<select class="form-select" id="trial-site-type" name="site_type"><option value="wordpress">WordPress</option><option value="php">PHP</option><option value="static">Static site</option></select>
			</div>
			<div class="u-mb20">
				<label class="form-label" for="trial-domain">Custom domain (optional)</label>
				<input class="form-control" id="trial-domain" name="requested_custom_domain" inputmode="url">
			</div>
			<button class="button" type="submit">Request trial</button>
		</form>

		<form class="u-mt20" data-account-action="admission-paid">
			<div class="u-mb10">
				<label class="form-label" for="checkout-plan">Plan</label>
				<select class="form-select" id="checkout-plan" name="plan_code" data-plan-select required disabled><option>Loading…</option></select>
			</div>
			<div class="u-mb10">
				<label class="form-label" for="checkout-intent">Setup</label>
				<select class="form-select" id="checkout-intent" name="intent"><option value="new_site">New site</option><option value="migration">Import an existing PHP site</option></select>
			</div>
			<div class="u-mb10">
				<label class="form-label" for="checkout-site-type">Site type</label>
				<select class="form-select" id="checkout-site-type" name="site_type"><option value="wordpress">WordPress</option><option value="php">PHP</option><option value="static">Static site</option></select>
			</div>
			<div class="u-mb20">
				<label class="form-label" for="checkout-domain">Custom domain (optional)</label>
				<input class="form-control" id="checkout-domain" name="requested_custom_domain" inputmode="url">
			</div>
			<button class="button button-secondary" type="submit">Continue to Stripe Checkout</button>
		</form>

		<h3 class="u-mt20 u-mb10">Add a website</h3>
		<form data-account-action="service-website">
			<div class="u-mb10">
				<label class="form-label" for="website-site-type">Site type</label>
				<select class="form-select" id="website-site-type" name="site_type"><option value="wordpress">WordPress</option><option value="php">PHP</option><option value="static">Static site</option></select>
			</div>
			<div class="u-mb20">
				<label class="form-label" for="website-domain">Custom domain (optional)</label>
				<input class="form-control" id="website-domain" name="requested_custom_domain" inputmode="url">
			</div>
			<button class="button" type="submit">Add website to selected service</button>
		</form>

		<h3 class="u-mt20 u-mb10">Service operations</h3>
		<form class="u-mb10" data-account-action="migration-confirm">
			<div class="form-check u-mb10">
				<input class="form-check-input" id="migration-complete" type="checkbox" name="customer_attests_import_complete" required>
				<label for="migration-complete">I confirm the import into the selected service is complete.</label>
			</div>
			<button class="button button-secondary" type="submit" data-migration-confirm disabled>Confirm import</button>
		</form>
		<form class="u-mb10" data-account-action="backup">
			<div class="form-check u-mb10">
				<input class="form-check-input" id="backup-replace" type="checkbox" name="replace_existing_manual_backup" required>
				<label for="backup-replace">Replace the previous manual backup for this service.</label>
			</div>
			<button class="button button-secondary" type="submit">Request backup</button>
		</form>
		<form data-account-action="domain-refresh">
			<div class="u-mb10">
				<label class="form-label" for="domain-website">Website</label>
				<select class="form-select" id="domain-website" name="website_id" data-website-select required disabled><option>Select a service first</option></select>
			</div>
			<div class="u-mb10">
				<label class="form-label" for="domain-hostname">Hostname</label>
				<input class="form-control" id="domain-hostname" name="hostname" required>
			</div>
			<div class="u-mb10">
				<label class="form-label" for="domain-record-type">DNS record type</label>
				<select class="form-select" id="domain-record-type" name="dns_record_type"><option>A</option><option>AAAA</option><option>CNAME</option></select>
			</div>
			<div class="form-check u-mb10">
				<input class="form-check-input" id="domain-confirm" type="checkbox" name="confirm_domain_change" required>
				<label for="domain-confirm">Apply this domain change to the selected website.</label>
			</div>
			<button class="button button-secondary" type="submit">Refresh domain</button>
		</form>
	</section>

	<section id="profile" class="form-container form-container-wide">
		<h2 class="u-mb20">Profile and billing</h2>
		<form data-account-action="profile">
			<div class="u-mb20"><label class="form-label" for="display-name">Display name</label><input class="form-control" id="display-name" name="display_name" autocomplete="name" required></div>
			<button class="button" type="submit">Save profile</button>
		</form>
		<form class="u-mt20" data-account-action="account-create">
			<div class="u-mb20"><label class="form-label" for="account-name">New account name</label><input class="form-control" id="account-name" name="display_name" required></div>
			<button class="button button-secondary" type="submit">Create account</button>
		</form>
		<form class="u-mt20" data-account-action="email-change">
			<div class="u-mb20"><label class="form-label" for="new-email">New email</label><input class="form-control" id="new-email" type="email" name="email" autocomplete="email" required></div>
			<button class="button button-secondary" type="submit">Send email confirmation</button>
		</form>
		<form class="u-mt20" data-account-action="password-change">
			<div class="u-mb20"><label class="form-label" for="new-password">New password</label><input class="form-control" id="new-password" type="password" name="password" autocomplete="new-password" minlength="12" required></div>
			<button class="button button-secondary" type="submit">Change password</button>
		</form>
		<form class="u-mt20" data-account-action="billing-portal">
			<p class="u-mb10">Payment methods, invoices, and cancellation are handled on Stripe's hosted portal.</p>
			<button class="button button-secondary" type="submit">Open Stripe customer portal</button>
		</form>
	</section>

	<section id="security" class="form-container form-container-wide">
		<h2 class="u-mb20">Security</h2>
		<h3 class="u-mb10">Authenticator apps</h3>
		<div class="units-table u-mb20" data-mfa-rows>
			<div class="units-table-header"><div class="units-table-cell"></div><div class="units-table-cell">Device</div><div class="units-table-cell">Status</div><div class="units-table-cell">Action</div></div>
			<p class="units-table-footer">Loading…</p>
		</div>
		<form data-account-action="mfa-enroll">
			<div class="u-mb20"><label class="form-label" for="factor-name">Device name</label><input class="form-control" id="factor-name" name="friendly_name" maxlength="120" value="Authenticator"></div>
			<button class="button button-secondary" type="submit">Add authenticator</button>
		</form>
		<img data-mfa-qr class="u-hidden u-mt20 u-max-width300" alt="Authenticator QR code">
		<form class="u-hidden u-mt20" data-account-action="mfa-verify" data-mfa-verify>
			<input type="hidden" name="factor_id">
			<div class="u-mb20"><label class="form-label" for="factor-code">Verification code</label><input class="form-control" id="factor-code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" required></div>
			<button class="button" type="submit">Verify factor</button>
		</form>
		<div data-passkey-section>
			<h3 class="u-mt20 u-mb10">Passkeys</h3>
			<div class="units-table u-mb20" data-passkey-rows>
				<div class="units-table-header"><div class="units-table-cell"></div><div class="units-table-cell">Passkey</div><div class="units-table-cell">Last used</div><div class="units-table-cell">Action</div></div>
			</div>
			<button class="button button-secondary u-hidden" type="button" data-passkey-register>Register passkey</button>
		</div>
	</section>

	<section id="support" class="form-container form-container-wide">
		<h2 class="u-mb20">Support</h2>
		<div class="units-table u-mb20" data-support-rows>
			<div class="units-table-header"><div class="units-table-cell"></div><div class="units-table-cell">Case</div><div class="units-table-cell">Status</div><div class="units-table-cell">Updated</div></div>
			<p class="units-table-footer">Loading…</p>
		</div>
		<div data-support-case-detail class="u-mb20">
			<p>Select a support case to read its messages.</p>
		</div>
		<div class="units-table u-mb20" data-support-message-rows>
			<div class="units-table-header"><div class="units-table-cell"></div><div class="units-table-cell">From</div><div class="units-table-cell">Message</div><div class="units-table-cell">Date</div></div>
			<p class="units-table-footer">No case selected.</p>
		</div>
		<form data-account-action="support-open">
			<div class="u-mb10"><label class="form-label" for="support-service">Service (optional)</label><select class="form-select" id="support-service" name="service_id" data-service-select-optional><option value="">Account question</option></select></div>
			<div class="u-mb10"><label class="form-label" for="support-subject">Subject</label><input class="form-control" id="support-subject" name="subject" maxlength="240" required></div>
			<div class="u-mb20"><label class="form-label" for="support-message">Message</label><textarea class="form-control" id="support-message" name="message" maxlength="10000" required></textarea></div>
			<button class="button" type="submit">Open support case</button>
		</form>
		<form class="u-mt20" data-account-action="support-reply">
			<div class="u-mb10"><label class="form-label" for="support-case">Case</label><select class="form-select" id="support-case" data-support-select required disabled><option>No support cases</option></select></div>
			<div class="u-mb20"><label class="form-label" for="support-reply">Reply</label><textarea class="form-control" id="support-reply" name="message" maxlength="10000" required></textarea></div>
			<button class="button button-secondary" type="submit">Send reply</button>
			<button class="button button-secondary" type="button" data-support-close>Close selected case</button>
		</form>
	</section>
</div>
