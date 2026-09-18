export async function initSupportSettings({ request, error }) {
	const mount = document.querySelector('[data-support-settings-editor]');
	if (!mount) return;
	const render = (settings) => {
		const value = settings.settings || {};
		const imap = value.imap || {};
		const oauthConfig = imap.oauth || {};
		mount.replaceChildren();
		const smtp = settings.smtp || {};
		const smtpHeading = document.createElement('h2');
		smtpHeading.textContent = 'Outgoing email';
		const smtpForm = document.createElement('form');
		smtpForm.className = 'smtp-settings-form';
		smtpForm.innerHTML = `
			<p>Used by this installation for support notifications and other panel emails.</p>
			<label>Delivery method<select class="form-select" name="enabled"><option value="true">SMTP server</option><option value="false">Local mail service</option></select></label>
			<fieldset data-smtp-fields><legend>SMTP connection</legend>
			<label>Host<input class="form-control" name="host" autocomplete="off" required></label>
			<label>Port<input class="form-control" type="number" name="port" min="1" max="65535" required></label>
			<label>Encryption<select class="form-select" name="security"><option value="tls">STARTTLS</option><option value="ssl">TLS</option><option value="">None</option></select></label>
			<label>Username<input class="form-control" name="username" autocomplete="off" required></label>
			<label>Password<input class="form-control" type="password" name="password" autocomplete="new-password"><small data-smtp-password-help></small></label>
			<label>Sender email address<input class="form-control" type="email" name="fromAddress" required><small>Use an address allowed by your mail provider. The display name is set in White Label Options.</small></label>
			</fieldset><p data-smtp-feedback aria-live="polite"></p>
			<div class="toolbar"><button class="button" type="submit">Save outgoing email</button></div>`;
		for (const [name, fieldValue] of Object.entries({
			enabled: String(Boolean(smtp.enabled ?? smtp.configured)),
			host: smtp.host || '',
			port: smtp.port || 587,
			security: smtp.enabled || smtp.configured ? smtp.security || '' : 'tls',
			username: smtp.username || '',
			fromAddress: smtp.fromAddress || '',
		}))
			smtpForm.elements[name].value = fieldValue;
		smtpForm.querySelector('[data-smtp-password-help]').textContent = smtp.passwordConfigured
			? 'A password is saved. Leave blank to keep it.'
			: 'No password is saved.';
		const syncSmtp = () => {
			const fields = smtpForm.querySelector('[data-smtp-fields]');
			fields.hidden = smtpForm.elements.enabled.value !== 'true';
			fields.disabled = fields.hidden;
		};
		smtpForm.elements.enabled.onchange = syncSmtp;
		syncSmtp();
		smtpForm.onsubmit = async (event) => {
			event.preventDefault();
			const button = smtpForm.querySelector('[type=submit]');
			const feedback = smtpForm.querySelector('[data-smtp-feedback]');
			button.disabled = true;
			feedback.textContent = '';
			try {
				const fields = Object.fromEntries(new FormData(smtpForm));
				const smtp = { ...fields, enabled: fields.enabled === 'true' };
				if (!smtp.password) delete smtp.password;
				await request('smtp-settings', 'POST', { smtp });
				smtpForm.elements.password.value = '';
				feedback.textContent =
					'Outgoing email settings saved. Use Test SMTP below to check delivery.';
			} catch (cause) {
				feedback.textContent = cause.message;
			} finally {
				button.disabled = false;
			}
		};
		const heading = document.createElement('h2');
		heading.textContent = 'Support delivery settings';
		const form = document.createElement('form');
		form.className = 'support-settings-form';
		form.innerHTML =
			'<label>Staff notification recipients<textarea class="form-control" name="staff_recipients" required></textarea></label><label>Inbound reply address<input class="form-control" type="email" name="inbound_address"></label><label>Customer ticket URL<input class="form-control" type="url" name="support_url" placeholder="https://support.example.test/customer/support"></label><label>Staff ticket URL<input class="form-control" type="url" name="admin_support_url" placeholder="https://support.example.test/list/support"></label><h3>Inbound mailbox</h3><label>IMAP host<input class="form-control" name="imap_host"></label><label>IMAP port<input class="form-control" inputmode="numeric" name="imap_port"></label><label>Encryption<select class="form-select" name="imap_encryption"><option value="ssl">SSL</option><option value="tls">TLS</option><option value="none">None</option></select></label><label>Username<input class="form-control" name="imap_username"></label><label>Authentication<select class="form-select" name="imap_authentication"><option value="basic">Username and password</option><option value="oauth2">Microsoft 365 OAuth</option></select></label><label>Password<input class="form-control" type="password" name="imap_password" autocomplete="new-password"><small>Leave blank to keep the current password.</small></label><label>Folder<input class="form-control" name="imap_folder"></label><fieldset data-imap-oauth><legend>Microsoft 365 OAuth</legend><label>Sign-in method<select class="form-select" name="imap_oauth_grant_type"><option value="client_credentials">Application access</option><option value="refresh_token">Delegated refresh token</option></select></label><label>Tenant ID<input class="form-control" name="imap_oauth_tenant"></label><label>Client ID<input class="form-control" name="imap_oauth_client_id"></label><label>Client secret<input class="form-control" type="password" name="imap_oauth_client_secret" autocomplete="new-password"><small>Leave blank to keep the current secret.</small></label><label data-imap-refresh-token>Refresh token<input class="form-control" type="password" name="imap_oauth_refresh_token" autocomplete="new-password"><small>Leave blank to keep the current token.</small></label><label>Scope<input class="form-control" name="imap_oauth_scope"></label></fieldset><p data-settings-feedback aria-live="polite"></p><div class="toolbar"><button class="button" type="submit">Save support settings</button><button class="button button-secondary" type="button" data-test-smtp>Test SMTP</button><button class="button button-secondary" type="button" data-test-imap>Test IMAP</button></div>';
		const fields = {
			staff_recipients: Array.isArray(value.staffRecipients)
				? value.staffRecipients.join(', ')
				: value.staffRecipients || '',
			inbound_address: value.inboundAddress || '',
			support_url: value.supportUrl || '',
			admin_support_url: value.adminSupportUrl || '',
			imap_host: imap.host || '',
			imap_port: imap.port || '993',
			imap_encryption: imap.encryption || 'ssl',
			imap_username: imap.username || '',
			imap_authentication: imap.authentication || 'basic',
			imap_oauth_grant_type: oauthConfig.grant_type || 'client_credentials',
			imap_oauth_tenant: oauthConfig.tenant || '',
			imap_oauth_client_id: oauthConfig.client_id || '',
			imap_oauth_scope: oauthConfig.scope || 'https://outlook.office365.com/.default',
			imap_folder: imap.folder || 'INBOX',
		};
		for (const [name, fieldValue] of Object.entries(fields)) form.elements[name].value = fieldValue;
		const auth = form.elements.imap_authentication;
		const oauth = form.querySelector('[data-imap-oauth]');
		const grantType = form.elements.imap_oauth_grant_type;
		const refreshToken = form.querySelector('[data-imap-refresh-token]');
		const syncAuth = () => {
			oauth.hidden = auth.value !== 'oauth2';
			refreshToken.hidden = grantType.value !== 'refresh_token';
		};
		auth.onchange = syncAuth;
		grantType.onchange = syncAuth;
		syncAuth();
		const feedback = form.querySelector('[data-settings-feedback]');
		const run = async (button, callback, success) => {
			button.disabled = true;
			feedback.textContent = '';
			try {
				await callback();
				feedback.textContent = success;
			} catch (cause) {
				error(cause.message);
			} finally {
				button.disabled = false;
			}
		};
		form.onsubmit = async (event) => {
			event.preventDefault();
			await run(
				form.querySelector('[type=submit]'),
				async () => {
					const formValues = Object.fromEntries(new FormData(form));
					const oauth = {
						tenant: formValues.imap_oauth_tenant,
						client_id: formValues.imap_oauth_client_id,
						client_secret: formValues.imap_oauth_client_secret,
						refresh_token: formValues.imap_oauth_refresh_token,
						scope: formValues.imap_oauth_scope,
						grant_type: formValues.imap_oauth_grant_type,
					};
					for (const key of Object.keys(oauth)) if (!oauth[key]) delete oauth[key];
					const settings = {
						staff_recipients: String(formValues.staff_recipients || '')
							.split(',')
							.map((email) => email.trim())
							.filter(Boolean),
						inbound_address: formValues.inbound_address,
						support_url: formValues.support_url,
						admin_support_url: formValues.admin_support_url,
						imap: {
							host: formValues.imap_host,
							port: formValues.imap_port,
							encryption: formValues.imap_encryption,
							username: formValues.imap_username,
							authentication: formValues.imap_authentication,
							folder: formValues.imap_folder,
							...(formValues.imap_password ? { password: formValues.imap_password } : {}),
							...(formValues.imap_authentication === 'oauth2' ? { oauth } : {}),
						},
					};
					await request('settings', 'POST', { settings });
				},
				'Support settings saved.',
			);
		};
		form.querySelector('[data-test-smtp]').onclick = (event) =>
			run(event.currentTarget, () => test('test-smtp'), 'SMTP accepted the test message.');
		form.querySelector('[data-test-imap]').onclick = (event) =>
			run(event.currentTarget, () => test('test-imap'), 'IMAP mailbox connection succeeded.');
		mount.append(smtpHeading, smtpForm, heading, form);
	};
	const test = async (action) => request(action, 'POST', {});
	const load = async () => {
		try {
			render(await request('settings'));
		} catch (cause) {
			error(cause.message);
		}
	};
	await load();
}
