import { CustomerBusinessBackend, SupabaseIdentityProvider } from './providers.js';

const configNode = document.querySelector('#customer-config');
if (configNode) {
	const config = JSON.parse(configNode.textContent);
	const identity = new SupabaseIdentityProvider(config);
	const backend = new CustomerBusinessBackend(identity);
	boot(config, identity, backend).catch(showError);
}

async function boot(config, identity, backend) {
	document.querySelector('[data-customer-sign-out]')?.addEventListener('click', async () => {
		await identity.signOut();
		location.assign('/customer/login/');
	});

	if (document.body.dataset.customerPage === 'login') {
		bindLogin(config, identity);
		return;
	}
	if (document.body.dataset.customerPage === 'callback') {
		await handleCallback(identity);
		return;
	}
	if (document.body.dataset.customerPage === 'account') {
		await bindAccount(config, identity, backend);
	}
}

function bindLogin(config, identity) {
	for (const form of document.querySelectorAll('[data-customer-auth-form]')) {
		form.addEventListener('submit', async (event) => {
			event.preventDefault();
			clearNotice();
			const data = new FormData(form);
			try {
				if (form.dataset.customerAuthForm === 'sign-in') {
					await identity.signIn(String(data.get('email')), String(data.get('password')));
					if (!(await beginMfaChallenge(identity))) location.assign('/customer/account/');
				} else if (form.dataset.customerAuthForm === 'sign-up') {
					await identity.signUp(
						String(data.get('email')),
						String(data.get('password')),
						data.get('terms') === 'yes',
					);
					showNotice('Check your email and confirm your address before signing in.', 'success');
					form.reset();
				} else {
					await identity.requestRecovery(String(data.get('email')));
					showNotice('If the address belongs to an account, a recovery email is on its way.', 'success');
				}
			} catch (error) {
				showError(error);
			}
		});
	}

	document.querySelector('[data-mfa-challenge]')?.addEventListener('submit', async (event) => {
		event.preventDefault();
		const data = new FormData(event.currentTarget);
		try {
			await identity.verifyTotp(String(data.get('factor_id')), String(data.get('code')));
			location.assign('/customer/account/');
		} catch (error) {
			showError(error);
		}
	});

	const passkey = document.querySelector('[data-passkey-sign-in]');
	if (passkey && config.passkeysEnabled) {
		passkey.hidden = false;
		passkey.addEventListener('click', async () => {
			try {
				await identity.signInWithPasskey();
				location.assign('/customer/account/');
			} catch (error) {
				showError(error);
			}
		});
	}
}

async function beginMfaChallenge(identity) {
	const assurance = await identity.assurance();
	if (assurance.currentLevel !== 'aal1' || assurance.nextLevel !== 'aal2') return false;
	const factors = await identity.listFactors();
	const factor = factors.totp?.find((item) => item.status === 'verified');
	if (!factor) throw new Error('A verified second factor is required.');
	const form = document.querySelector('[data-mfa-challenge]');
	form.querySelector('[name=factor_id]').value = factor.id;
	form.hidden = false;
	form.querySelector('[name=code]').focus();
	return true;
}

async function handleCallback(identity) {
	const parameters = new URLSearchParams(location.search);
	const code = parameters.get('code');
	if (!code) throw new Error('The confirmation link is incomplete.');
	await identity.exchangeConfirmation(code);
	location.replace(parameters.get('mode') === 'recovery' ? '/customer/account/#security' : '/customer/account/');
}

async function bindAccount(config, identity, backend) {
	const session = await identity.session();
	if (!session) {
		location.replace('/customer/login/');
		return;
	}
	const user = await identity.user();
	const assurance = await identity.assurance();
	document.querySelector('[data-customer-sign-out]').hidden = false;
	setText('[data-customer-email]', user.email || '');
	setText('[data-customer-aal]', assurance.currentLevel || 'aal1');

	for (const form of document.querySelectorAll('[data-account-action]')) {
		form.addEventListener('submit', async (event) => {
			event.preventDefault();
			const data = Object.fromEntries(new FormData(form));
			try {
				await accountAction(form.dataset.accountAction, data, identity, backend);
				showNotice('Your change was saved.', 'success');
			} catch (error) {
				showError(error);
			}
		});
	}

	document.querySelector('[data-passkey-register]')?.addEventListener('click', async () => {
		try {
			await identity.registerPasskey();
			showNotice('Passkey registered.', 'success');
			await loadSecurity(identity, config);
		} catch (error) {
			showError(error);
		}
	});
	if (!config.passkeysEnabled) document.querySelector('[data-passkey-register]')?.remove();

	await Promise.allSettled([loadCustomerState(backend), loadSecurity(identity, config)]);
}

async function accountAction(action, data, identity, backend) {
	if (action === 'identity-profile') {
		await identity.updateProfile({
			displayName: clean(data.display_name),
			email: clean(data.email),
			password: clean(data.password),
		});
	} else if (action === 'profile') {
		await backend.updateProfile(required(data.display_name));
	} else if (action === 'account-create') {
		await backend.createAccount(required(data.display_name));
	} else if (action === 'admission-trial') {
		await backend.requestTrialAdmission({
			accountId: required(data.account_id),
			offeringId: required(data.offering_id),
			idempotencyKey: crypto.randomUUID(),
		});
	} else if (action === 'admission-paid') {
		location.assign(
			await backend.requestPaidAdmission({
				accountId: required(data.account_id),
				offeringId: required(data.offering_id),
				idempotencyKey: crypto.randomUUID(),
			}),
		);
	} else if (action === 'service-website') {
		await backend.addWebsite(required(data.service_id), required(data.domain));
	} else if (action === 'migration-confirm') {
		await backend.confirmMigration(required(data.service_id), crypto.randomUUID());
	} else if (action === 'domain-refresh') {
		await backend.refreshDomain(required(data.service_id), crypto.randomUUID());
	} else if (action === 'backup') {
		await backend.requestBackup(required(data.service_id), crypto.randomUUID());
	} else if (action === 'support-open') {
		await backend.openSupportCase({
			accountId: required(data.account_id),
			subject: required(data.subject),
			message: required(data.message),
			idempotencyKey: crypto.randomUUID(),
		});
	} else if (action === 'support-reply') {
		await backend.replyToSupportCase(
			required(data.case_id),
			required(data.message),
			crypto.randomUUID(),
		);
	} else if (action === 'support-close') {
		await backend.closeSupportCase(required(data.case_id), crypto.randomUUID());
	} else if (action === 'billing-portal') {
		location.assign(await backend.billingPortal(required(data.account_id)));
	} else if (action === 'mfa-enroll') {
		const enrollment = await identity.enrollTotp(clean(data.friendly_name) || 'Authenticator');
		const qr = document.querySelector('[data-mfa-qr]');
		qr.src = enrollment.totp.qr_code;
		qr.hidden = false;
		document.querySelector('[name=factor_id]').value = enrollment.id;
	} else if (action === 'mfa-verify') {
		await identity.verifyTotp(required(data.factor_id), required(data.code));
	} else {
		throw new Error('Unsupported customer action.');
	}
}

async function loadCustomerState(backend) {
	const result = await backend.sessionState();
	setValue('[name=display_name]', result.profile?.displayName || '');
	renderRows('[data-accounts]', result.accounts || [], ['displayName', 'status']);
	renderRows('[data-services]', result.services || [], ['name', 'status', 'domain']);
	renderRows('[data-offerings]', result.offerings || [], ['name', 'summary']);
	renderRows('[data-support-cases]', result.supportCases || [], [
		'subject',
		'status',
		'updatedAt',
	]);
}

async function loadSecurity(identity, config) {
	const factors = await identity.listFactors();
	renderRows('[data-mfa-factors]', factors.all || [], ['friendly_name', 'factor_type', 'status']);
	if (config.passkeysEnabled) {
		const passkeys = await identity.listPasskeys();
		renderRows('[data-passkeys]', passkeys || [], ['friendly_name', 'created_at', 'last_used_at']);
	}
}

function renderRows(selector, rows, fields) {
	const target = document.querySelector(selector);
	if (!target) return;
	target.replaceChildren();
	if (!rows.length) {
		const empty = document.createElement('p');
		empty.textContent = 'Nothing to show yet.';
		target.append(empty);
		return;
	}
	for (const row of rows) {
		const item = document.createElement('article');
		item.className = 'customer-row';
		for (const field of fields) {
			const value = document.createElement('span');
			value.textContent = String(row[field] || '');
			item.append(value);
		}
		target.append(item);
	}
}

function setText(selector, value) {
	const element = document.querySelector(selector);
	if (element) element.textContent = value;
}

function setValue(selector, value) {
	const element = document.querySelector(selector);
	if (element) element.value = value;
}

function required(value) {
	const text = clean(value);
	if (!text) throw new Error('Complete all required fields.');
	return text;
}

function clean(value) {
	return typeof value === 'string' ? value.trim() : '';
}

function clearNotice() {
	const notice = document.querySelector('[data-customer-notice]');
	if (notice) notice.replaceChildren();
}

function showNotice(message, type = 'danger') {
	const notice = document.querySelector('[data-customer-notice]');
	if (!notice) return;
	notice.textContent = message;
	notice.className = `inline-alert inline-alert-${type}`;
}

function showError(error) {
	showNotice(error instanceof Error ? error.message : 'The request could not be completed.');
}
