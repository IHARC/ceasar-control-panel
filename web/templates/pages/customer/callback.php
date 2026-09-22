<div class="login">
	<a href="/customer/login/" class="u-block u-mb40">
		<img src="<?= htmlspecialchars($customerLogo, ENT_QUOTES) ?>" alt="<?= htmlspecialchars((string) $config['brand_name'], ENT_QUOTES) ?>">
	</a>
	<div>
		<h1 class="login-title">Secure confirmation</h1>
		<p data-customer-notice data-customer-callback-status aria-live="polite">Checking your confirmation link…</p>
		<button class="button u-hidden" type="button" data-customer-verify-recovery>Continue password reset</button>
		<form class="u-hidden" data-customer-recovery>
			<div class="u-mb20">
				<label for="recovery-password" class="form-label">New password</label>
				<input class="form-control" id="recovery-password" type="password" name="password" autocomplete="new-password" required autofocus data-password-input>
				<p class="customer-form-help" data-password-help></p>
			</div>
			<div class="u-mb20">
				<label for="recovery-password-confirm" class="form-label">Confirm new password</label>
				<input class="form-control" id="recovery-password-confirm" type="password" name="password_confirm" autocomplete="new-password" required data-password-input>
			</div>
			<button class="button" type="submit">Set new password</button>
		</form>
	</div>
</div>
