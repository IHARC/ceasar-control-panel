<section class="customer-account-heading">
	<div>
		<p class="customer-kicker">Customer account</p>
		<h1>Welcome back</h1>
		<p><span data-customer-email>Loading…</span> · assurance <strong data-customer-aal>—</strong></p>
	</div>
	<nav class="customer-account-nav" aria-label="Account sections">
		<a href="#services">Services</a>
		<a href="#profile">Profile</a>
		<a href="#security">Security</a>
		<a href="#support">Support</a>
	</nav>
</section>
<div data-customer-notice aria-live="polite"></div>
<section id="services" class="customer-grid">
	<div class="customer-card customer-span-two">
		<h2>Your accounts</h2>
		<div data-accounts class="customer-rows"><p>Loading…</p></div>
	</div>
	<div class="customer-card customer-span-two">
		<h2>Your services</h2>
		<div data-services class="customer-rows"><p>Loading…</p></div>
	</div>
	<div class="customer-card">
		<h2>Choose a service</h2>
		<div data-offerings class="customer-rows"></div>
		<form class="customer-form" data-account-action="admission-trial">
			<label>Account ID<input class="form-control" name="account_id" required></label>
			<label>Offering ID<input class="form-control" name="offering_id" required></label>
			<button class="button" type="submit">Request trial</button>
		</form>
		<form class="customer-form" data-account-action="admission-paid">
			<label>Account ID<input class="form-control" name="account_id" required></label>
			<label>Offering ID<input class="form-control" name="offering_id" required></label>
			<button class="button button-secondary" type="submit">Continue to secure checkout</button>
		</form>
	</div>
	<div class="customer-card">
		<h2>Add a website</h2>
		<form class="customer-form" data-account-action="service-website">
			<label>Service ID<input class="form-control" name="service_id" required></label>
			<label>Domain<input class="form-control" name="domain" inputmode="url" required></label>
			<button class="button" type="submit">Add website</button>
		</form>
	</div>
	<div class="customer-card">
		<h2>Service operations</h2>
		<p>Migration confirmation requires a verified second factor.</p>
		<form class="customer-form" data-account-action="migration-confirm">
			<label>Service ID<input class="form-control" name="service_id" required></label>
			<button class="button button-secondary" type="submit">Confirm migration</button>
		</form>
		<form class="customer-form" data-account-action="domain-refresh">
			<label>Service ID<input class="form-control" name="service_id" required></label>
			<button class="button button-secondary" type="submit">Refresh domains</button>
		</form>
		<form class="customer-form" data-account-action="backup">
			<label>Service ID<input class="form-control" name="service_id" required></label>
			<button class="button button-secondary" type="submit">Request backup</button>
		</form>
	</div>
</section>
<section id="profile" class="customer-grid">
	<div class="customer-card">
		<h2>Customer profile</h2>
		<form class="customer-form" data-account-action="profile">
			<label>Display name<input class="form-control" name="display_name" autocomplete="name" required></label>
			<button class="button" type="submit">Save profile</button>
		</form>
		<form class="customer-form" data-account-action="account-create">
			<label>New account name<input class="form-control" name="display_name" required></label>
			<button class="button button-secondary" type="submit">Create account</button>
		</form>
	</div>
	<div class="customer-card">
		<h2>Email and password</h2>
		<form class="customer-form" data-account-action="identity-profile">
			<label>Display name<input class="form-control" name="display_name" autocomplete="name"></label>
			<label>New email<input class="form-control" type="email" name="email" autocomplete="email"></label>
			<label>New password<input class="form-control" type="password" name="password" autocomplete="new-password" minlength="10"></label>
			<button class="button button-secondary" type="submit">Update sign-in details</button>
		</form>
	</div>
	<div class="customer-card">
		<h2>Billing</h2>
		<p>Payment details are entered only on Stripe's hosted pages.</p>
		<form class="customer-form" data-account-action="billing-portal">
			<label>Account ID<input class="form-control" name="account_id" required></label>
			<button class="button button-secondary" type="submit">Open billing portal</button>
		</form>
	</div>
</section>
<section id="security" class="customer-grid">
	<div class="customer-card">
		<h2>Authenticator app</h2>
		<div data-mfa-factors class="customer-rows"></div>
		<form class="customer-form" data-account-action="mfa-enroll">
			<label>Device name<input class="form-control" name="friendly_name" maxlength="120" value="Authenticator"></label>
			<button class="button button-secondary" type="submit">Add authenticator</button>
		</form>
		<img data-mfa-qr class="customer-qr" alt="Authenticator QR code" hidden>
		<form class="customer-form" data-account-action="mfa-verify">
			<input type="hidden" name="factor_id">
			<label>Verification code<input class="form-control" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" required></label>
			<button class="button" type="submit">Verify factor</button>
		</form>
	</div>
	<div class="customer-card">
		<h2>Passkeys</h2>
		<p>Passkeys use this customer's stable secure hostname and your device's protected credential store.</p>
		<div data-passkeys class="customer-rows"></div>
		<button class="button button-secondary" type="button" data-passkey-register>Register passkey</button>
	</div>
</section>
<section id="support" class="customer-grid">
	<div class="customer-card customer-span-two">
		<h2>Support cases</h2>
		<div data-support-cases class="customer-rows"><p>Loading…</p></div>
	</div>
	<div class="customer-card">
		<h2>Ask for help</h2>
		<form class="customer-form" data-account-action="support-open">
			<label>Account ID<input class="form-control" name="account_id" required></label>
			<label>Subject<input class="form-control" name="subject" maxlength="200" required></label>
			<label>Message<textarea class="form-control" name="message" maxlength="10000" required></textarea></label>
			<button class="button" type="submit">Open support case</button>
		</form>
	</div>
	<div class="customer-card">
		<h2>Reply</h2>
		<form class="customer-form" data-account-action="support-reply">
			<label>Case ID<input class="form-control" name="case_id" required></label>
			<label>Message<textarea class="form-control" name="message" maxlength="10000" required></textarea></label>
			<button class="button button-secondary" type="submit">Send reply</button>
		</form>
		<form class="customer-form" data-account-action="support-close">
			<label>Case ID<input class="form-control" name="case_id" required></label>
			<button class="button button-secondary" type="submit">Close case</button>
		</form>
	</div>
</section>
