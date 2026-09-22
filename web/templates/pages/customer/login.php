<div class="login">
	<a href="/customer/login/" class="u-block u-mb40">
		<img src="<?= htmlspecialchars($customerLogo, ENT_QUOTES) ?>" alt="<?= htmlspecialchars((string) $config['brand_name'], ENT_QUOTES) ?>">
	</a>
	<div class="u-width-full">
		<div data-customer-notice aria-live="polite"></div>
		<p class="customer-form-help" data-selected-plan hidden></p>
		<form id="sign-in" data-customer-auth-form="sign-in">
			<h1 class="login-title">Sign in to <?= htmlspecialchars((string) $config['brand_name'], ENT_QUOTES) ?></h1>
			<div class="u-mb20">
				<label for="customer-email" class="form-label">Email</label>
				<input class="form-control" id="customer-email" type="email" name="email" autocomplete="email" required autofocus>
			</div>
			<div class="u-mb20">
				<label for="customer-password" class="form-label">Password</label>
				<input class="form-control" id="customer-password" type="password" name="password" autocomplete="current-password" required>
			</div>
			<button class="button" type="submit">Sign in</button>
			<button class="button button-secondary u-hidden" type="button" data-passkey-sign-in>Use a passkey</button>
			<p class="u-mt20">
				<button class="u-button-reset login-form-link" type="button" data-auth-view="sign-up">Create account</button>
				 · <button class="u-button-reset login-form-link" type="button" data-auth-view="recovery">Forgot password?</button>
			</p>
		</form>
		<form id="create-account" class="u-hidden" data-customer-auth-form="sign-up">
			<h1 class="login-title">Create your sign-in</h1>
			<p class="u-mb20">We will email a confirmation link before you can sign in.</p>
			<div class="u-mb20">
				<label for="signup-email" class="form-label">Email</label>
				<input class="form-control" id="signup-email" type="email" name="email" autocomplete="email" required>
			</div>
			<div class="u-mb20">
				<label for="signup-password" class="form-label">Password</label>
				<input class="form-control" id="signup-password" type="password" name="password" autocomplete="new-password" required data-password-input>
				<p class="customer-form-help" data-password-help></p>
			</div>
			<div class="form-check u-mb20">
				<input class="form-check-input" id="signup-terms" type="checkbox" name="terms" value="yes" required>
				<label for="signup-terms">I agree to the <a href="<?= htmlspecialchars((string) $config['terms_url'], ENT_QUOTES) ?>">Terms of Service</a> and acknowledge the <a href="<?= htmlspecialchars((string) $config['privacy_url'], ENT_QUOTES) ?>">Privacy Policy</a>.</label>
			</div>
			<button class="button" type="submit">Create account</button>
			<button class="button button-secondary" type="button" data-auth-view="sign-in">Back</button>
		</form>
		<form id="recover" class="u-hidden" data-customer-auth-form="recovery">
			<h1 class="login-title">Recover access</h1>
			<div class="u-mb20">
				<label for="recovery-email" class="form-label">Email</label>
				<input class="form-control" id="recovery-email" type="email" name="email" autocomplete="email" required>
			</div>
			<button class="button" type="submit">Send recovery email</button>
			<button class="button button-secondary" type="button" data-auth-view="sign-in">Back</button>
		</form>
	</div>
</div>
