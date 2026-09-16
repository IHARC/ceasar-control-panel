<section class="customer-auth-layout">
	<div class="customer-intro">
		<p class="customer-kicker">Customer hosting</p>
		<h1>Run your services from one clear account.</h1>
		<p>Choose a service, finish setup, follow status, request an import, and contact support here. Your websites, domains, databases, files, SSH access, backups, and usage stay in Ceasar's native hosting screens.</p>
	</div>
	<div class="customer-card customer-card-auth">
		<div data-customer-notice aria-live="polite"></div>
		<div class="customer-tabs">
			<a href="#sign-in">Sign in</a>
			<a href="#create-account">Create account</a>
			<a href="#recover">Recover</a>
		</div>
		<form id="sign-in" class="customer-form" data-customer-auth-form="sign-in">
			<h2>Sign in</h2>
			<label>Email<input class="form-control" type="email" name="email" autocomplete="email" required></label>
			<label>Password<input class="form-control" type="password" name="password" autocomplete="current-password" required></label>
			<button class="button" type="submit">Sign in</button>
			<button class="button button-secondary" type="button" data-passkey-sign-in hidden>Use a passkey</button>
		</form>
		<form class="customer-form" data-mfa-challenge hidden>
			<h2>Confirm your second factor</h2>
			<p>Enter the six-digit code shown by your authenticator app.</p>
			<input type="hidden" name="factor_id">
			<label>Authentication code<input class="form-control" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label>
			<button class="button" type="submit">Verify and continue</button>
		</form>
		<form id="create-account" class="customer-form" data-customer-auth-form="sign-up">
			<h2>Create account</h2>
			<p>We will email you a confirmation link. You must confirm your address before signing in or selecting a service.</p>
			<label>Email<input class="form-control" type="email" name="email" autocomplete="email" required></label>
			<label>Password<input class="form-control" type="password" name="password" autocomplete="new-password" minlength="10" required></label>
			<label class="customer-check"><input type="checkbox" name="terms" value="yes" required><span>I agree to the <a href="<?= htmlspecialchars((string) $config['terms_url'], ENT_QUOTES) ?>">Terms of Service</a> and acknowledge the <a href="<?= htmlspecialchars((string) $config['privacy_url'], ENT_QUOTES) ?>">Privacy Policy</a>.</span></label>
			<button class="button" type="submit">Create account</button>
		</form>
		<form id="recover" class="customer-form" data-customer-auth-form="recovery">
			<h2>Recover access</h2>
			<label>Email<input class="form-control" type="email" name="email" autocomplete="email" required></label>
			<button class="button button-secondary" type="submit">Send recovery email</button>
		</form>
	</div>
</section>
