<div class="login">
	<a href="/" class="u-block u-mb40">
		<img src="<?= tohtml(branding_asset_url("logo")) ?>" alt="<?= tohtml(branding_name()) ?>" class="branding-login-logo">
	</a>
	<form id="login-form" method="post" action="/login/">
		<input type="hidden" name="token" value="<?= tohtml($_SESSION["token"]) ?>">
		<h1 class="login-title">
			<?= tohtml(sprintf(_("Welcome to %s"), branding_name())) ?>
		</h1>
		<?php if (!empty($error)) { ?>
			<p class="error"><?= tohtml($error) ?></p>
		<?php } ?>
		<div class="u-mb20">
			<label for="username" class="form-label"><?= tohtml( _("Username")) ?></label>
			<input type="text" class="form-control" name="user" id="username" autocomplete="username" required autofocus>
		</div>
		<button type="submit" class="button">
			<i class="fas fa-right-to-bracket"></i><?= tohtml( _("Next")) ?>
		</button>
	</form>
</div>
