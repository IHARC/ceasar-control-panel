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
		location.assign(config.loginUrl);
	});

	const page = document.body.dataset.customerPage;
	if (page === 'login') {
		bindLogin(config, identity);
	} else if (page === 'callback') {
		await handleCallback(config, identity);
	} else if (page === 'account') {
		await bindAccount(config, identity, backend);
	}
}

function bindLogin(config, identity) {
	for (const control of document.querySelectorAll('[data-auth-view]')) {
		control.addEventListener('click', () => showAuthView(control.dataset.authView));
	}
	for (const form of document.querySelectorAll('[data-customer-auth-form]')) {
		form.addEventListener('submit', async (event) => {
			event.preventDefault();
			clearNotice();
			const data = new FormData(form);
			try {
				if (form.dataset.customerAuthForm === 'sign-in') {
					await identity.signIn(String(data.get('email')), String(data.get('password')));
					if (!(await beginMfaChallenge(identity))) location.assign(config.accountUrl);
				} else if (form.dataset.customerAuthForm === 'sign-up') {
					await identity.signUp(
						String(data.get('email')),
						String(data.get('password')),
						data.get('terms') === 'yes',
					);
					showNotice('Check your email and confirm your address before signing in.', 'success');
					form.reset();
					showAuthView('sign-in');
				} else {
					await identity.requestRecovery(String(data.get('email')));
					showNotice(
						'If the address belongs to an account, a recovery email is on its way.',
						'success',
					);
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
			location.assign(config.accountUrl);
		} catch (error) {
			showError(error);
		}
	});

	const passkey = document.querySelector('[data-passkey-sign-in]');
	if (passkey && config.passkeysEnabled) {
		passkey.classList.remove('u-hidden');
		passkey.addEventListener('click', async () => {
			try {
				await identity.signInWithPasskey();
				location.assign(config.accountUrl);
			} catch (error) {
				showError(error);
			}
		});
	}
}

function showAuthView(view) {
	for (const form of document.querySelectorAll('[data-customer-auth-form], [data-mfa-challenge]')) {
		const active =
			(view === 'sign-in' && form.dataset.customerAuthForm === 'sign-in') ||
			form.dataset.customerAuthForm === view;
		form.classList.toggle('u-hidden', !active);
	}
}

async function beginMfaChallenge(identity) {
	const assurance = await identity.assurance();
	if (assurance.currentLevel !== 'aal1' || assurance.nextLevel !== 'aal2') return false;
	const factors = await identity.listFactors();
	const factor = factors.totp?.find((item) => item.status === 'verified');
	if (!factor) throw new Error('A verified second factor is required.');
	const form = document.querySelector('[data-mfa-challenge]');
	for (const other of document.querySelectorAll('[data-customer-auth-form]')) {
		other.classList.add('u-hidden');
	}
	form.querySelector('[name=factor_id]').value = factor.id;
	form.classList.remove('u-hidden');
	form.querySelector('[name=code]').focus();
	return true;
}

async function handleCallback(config, identity) {
	const parameters = new URLSearchParams(location.search);
	const code = parameters.get('code');
	if (!code) throw new Error('The confirmation link is incomplete.');
	await identity.exchangeConfirmation(code);
	const destination = new URL(config.accountUrl);
	if (parameters.get('mode') === 'recovery') destination.hash = 'profile';
	location.replace(destination.toString());
}

async function bindAccount(config, identity, backend) {
	const session = await identity.session();
	if (!session) {
		location.replace(config.loginUrl);
		return;
	}

	const context = {
		accountId: '',
		serviceId: '',
		supportCaseId: '',
		userId: '',
		state: {},
	};
	const [user, assurance] = await Promise.all([identity.user(), identity.assurance()]);
	document.querySelector('[data-customer-sign-out]')?.classList.remove('u-hidden');
	setText('[data-customer-email]', user.email || '');
	setText('[data-customer-aal]', assurance.currentLevel || 'aal1');

	for (const form of document.querySelectorAll('[data-account-action]')) {
		form.addEventListener('submit', async (event) => {
			event.preventDefault();
			clearNotice();
			const data = Object.fromEntries(new FormData(form));
			try {
				const message = await accountAction(
					form.dataset.accountAction,
					data,
					context,
					identity,
					backend,
				);
				if (message) showNotice(message, 'success');
				if (['support-open', 'support-reply'].includes(form.dataset.accountAction)) {
					for (const field of form.querySelectorAll('input:not([type="hidden"]), textarea')) {
						field.value = '';
					}
				}
				if (!['admission-paid', 'billing-portal'].includes(form.dataset.accountAction)) {
					await refreshSelectedAccount(backend, context);
				}
			} catch (error) {
				showError(error);
			}
		});
	}

	document.querySelector('[data-account-select]')?.addEventListener('change', async (event) => {
		try {
			context.accountId = required(event.currentTarget.value);
			context.serviceId = '';
			context.supportCaseId = '';
			renderCustomerState(await backend.accountState(context.accountId), context);
		} catch (error) {
			showError(error);
		}
	});
	document.querySelector('[data-service-select]')?.addEventListener('change', async (event) => {
		try {
			context.serviceId = clean(event.currentTarget.value);
			if (context.serviceId) {
				renderCustomerState(
					await backend.serviceState(context.serviceId),
					context,
					context.serviceId,
				);
			} else {
				renderCustomerState(context.state, context);
			}
		} catch (error) {
			showError(error);
		}
	});
	document.querySelector('[data-support-select]')?.addEventListener('change', async (event) => {
		context.supportCaseId = clean(event.currentTarget.value);
		try {
			if (context.supportCaseId) {
				renderSupportDetail(await backend.supportCase(context.supportCaseId), context);
			} else {
				renderSupportDetail({}, context);
			}
		} catch (error) {
			showError(error);
		}
	});
	document.querySelector('[data-support-close]')?.addEventListener('click', async () => {
		try {
			await backend.closeSupportCase(required(context.supportCaseId), crypto.randomUUID());
			showNotice('Support case closed.', 'success');
			await refreshSelectedAccount(backend, context);
		} catch (error) {
			showError(error);
		}
	});

	const passkey = document.querySelector('[data-passkey-register]');
	if (passkey && config.passkeysEnabled) {
		passkey.classList.remove('u-hidden');
		passkey.addEventListener('click', async () => {
			try {
				await identity.registerPasskey();
				showNotice('Passkey registered.', 'success');
				await loadSecurity(identity, config);
			} catch (error) {
				showError(error);
			}
		});
	} else {
		document.querySelector('[data-passkey-section]')?.remove();
	}

	document.querySelector('[data-mfa-rows]')?.addEventListener('click', async (event) => {
		const control = event.target.closest('[data-mfa-remove]');
		if (!control || !confirm('Remove this authenticator from your account?')) return;
		try {
			control.disabled = true;
			await identity.unenrollFactor(required(control.dataset.mfaRemove));
			showNotice('Authenticator removed.', 'success');
			await loadSecurity(identity, config);
		} catch (error) {
			control.disabled = false;
			showError(error);
		}
	});
	document.querySelector('[data-passkey-rows]')?.addEventListener('click', async (event) => {
		const control = event.target.closest('[data-passkey-remove]');
		if (!control || !confirm('Remove this passkey from your account?')) return;
		try {
			control.disabled = true;
			await identity.deletePasskey(required(control.dataset.passkeyRemove));
			showNotice('Passkey removed.', 'success');
			await loadSecurity(identity, config);
		} catch (error) {
			control.disabled = false;
			showError(error);
		}
	});

	const result = await backend.sessionState();
	context.userId = result.identity?.userId || '';
	setValue('[name=display_name]', result.identity?.displayName || '');
	renderCustomerState(result.state || {}, context);
	if (context.serviceId) {
		renderCustomerState(await backend.serviceState(context.serviceId), context, context.serviceId);
	}
	if (context.supportCaseId) {
		renderSupportDetail(await backend.supportCase(context.supportCaseId), context);
	}
	await loadSecurity(identity, config);
}

async function accountAction(action, data, context, identity, backend) {
	const accountId = required(context.accountId);
	const serviceId = clean(context.serviceId);
	if (action === 'profile') {
		await backend.updateProfile(required(data.display_name));
		return 'Profile saved.';
	}
	if (action === 'account-create') {
		await backend.createAccount(required(data.display_name));
		return 'Customer account created.';
	}
	if (action === 'email-change') {
		await backend.requestEmailChange(required(data.email));
		return 'Check the new address to confirm the change.';
	}
	if (action === 'password-change') {
		await backend.changePassword(required(data.password));
		return 'Password changed.';
	}
	if (action === 'admission-trial') {
		await backend.requestTrialAdmission({
			accountId,
			planCode: required(data.plan_code),
			siteType: required(data.site_type),
			requestedCustomDomain: clean(data.requested_custom_domain),
			idempotencyKey: crypto.randomUUID(),
		});
		return 'Trial request accepted.';
	}
	if (action === 'admission-paid') {
		if (data.intent === 'migration' && data.site_type !== 'php') {
			throw new Error('Existing-site imports use the PHP site type.');
		}
		const checkout = await backend.requestPaidAdmission({
			accountId,
			planCode: required(data.plan_code),
			intent: required(data.intent),
			siteType: required(data.site_type),
			requestedCustomDomain: clean(data.requested_custom_domain),
			idempotencyKey: crypto.randomUUID(),
		});
		if (checkout.state === 'ready' && checkout.url) {
			location.assign(checkout.url);
			return '';
		}
		return 'Stripe Checkout is preparing. Try again in a moment.';
	}
	if (action === 'service-website') {
		await backend.addWebsite(required(serviceId), {
			accountId,
			siteType: required(data.site_type),
			requestedCustomDomain: clean(data.requested_custom_domain),
			idempotencyKey: crypto.randomUUID(),
		});
		return 'Website request accepted.';
	}
	if (action === 'migration-confirm') {
		const handoff = context.state.migrationWorkspace?.[0];
		await backend.confirmMigration(required(serviceId), {
			accountId,
			workspaceReadyOperationId: required(handoff?.workspace_ready_operation_id),
			idempotencyKey: crypto.randomUUID(),
		});
		return 'Import completion recorded.';
	}
	if (action === 'domain-refresh') {
		await backend.refreshDomain(required(serviceId), {
			accountId,
			websiteId: required(data.website_id),
			hostname: required(data.hostname),
			dnsRecordType: required(data.dns_record_type),
			idempotencyKey: crypto.randomUUID(),
		});
		return 'Domain refresh requested.';
	}
	if (action === 'backup') {
		await backend.requestBackup(required(serviceId), {
			accountId,
			idempotencyKey: crypto.randomUUID(),
		});
		return 'Backup requested.';
	}
	if (action === 'support-open') {
		await backend.openSupportCase({
			accountId,
			serviceId: clean(data.service_id),
			subject: required(data.subject),
			message: required(data.message),
			idempotencyKey: crypto.randomUUID(),
		});
		return 'Support case opened.';
	}
	if (action === 'support-reply') {
		await backend.replyToSupportCase(
			required(context.supportCaseId),
			required(data.message),
			crypto.randomUUID(),
		);
		return 'Reply sent.';
	}
	if (action === 'billing-portal') {
		location.assign(await backend.billingPortal(accountId));
		return '';
	}
	if (action === 'mfa-enroll') {
		const enrollment = await identity.enrollTotp(clean(data.friendly_name) || 'Authenticator');
		const qr = document.querySelector('[data-mfa-qr]');
		qr.src = enrollment.totp.qr_code;
		qr.classList.remove('u-hidden');
		const verify = document.querySelector('[data-mfa-verify]');
		verify.querySelector('[name=factor_id]').value = enrollment.id;
		verify.classList.remove('u-hidden');
		return 'Scan the code, then enter the six-digit value.';
	}
	if (action === 'mfa-verify') {
		await identity.verifyTotp(required(data.factor_id), required(data.code));
		return 'Authenticator verified.';
	}
	throw new Error('Unsupported customer action.');
}

async function refreshSelectedAccount(backend, context) {
	const state = await backend.accountState(required(context.accountId));
	renderCustomerState(state, context, context.serviceId);
	if (context.serviceId) {
		renderCustomerState(await backend.serviceState(context.serviceId), context, context.serviceId);
	}
	if (context.supportCaseId) {
		renderSupportDetail(await backend.supportCase(context.supportCaseId), context);
	}
}

function renderCustomerState(state, context, preferredServiceId = '') {
	context.state = state;
	context.accountId =
		state.selectedAccountId || context.accountId || state.contexts?.[0]?.customer_account_id || '';

	const accounts = state.contexts || [];
	renderTable(
		'[data-account-rows]',
		accounts.map((row, index) => [
			' ',
			row.display_name || `Customer account ${index + 1}`,
			row.membership_role || row.role || 'member',
		]),
	);
	populateSelect('[data-account-select]', accounts, {
		value: (row) => row.customer_account_id,
		label: (row, index) => row.display_name || `Customer account ${index + 1}`,
		selected: context.accountId,
		empty: 'No customer account',
	});

	const services = state.services || [];
	context.serviceId =
		(preferredServiceId && services.some((row) => row.id === preferredServiceId)
			? preferredServiceId
			: services.some((row) => row.id === context.serviceId)
				? context.serviceId
				: services[0]?.id) || '';
	renderTable(
		'[data-service-rows]',
		services.map((row, index) => [
			' ',
			`Hosting service ${index + 1}`,
			row.status || 'pending',
			row.provider_service_ref || 'Preparing',
		]),
	);
	populateSelect('[data-service-select]', services, {
		value: (row) => row.id,
		label: (row, index) =>
			`${row.provider_service_ref || `Hosting service ${index + 1}`} · ${row.status || 'pending'}`,
		selected: context.serviceId,
		empty: 'No service yet',
	});
	populateSelect('[data-service-select-optional]', services, {
		value: (row) => row.id,
		label: (row, index) => row.provider_service_ref || `Hosting service ${index + 1}`,
		selected: '',
		empty: 'Account question',
	});

	const offers = state.offers || [];
	populateSelect('[data-plan-select]', offers, {
		value: (row) => row.plan_code,
		label: (row) => offerLabel(row),
		selected: '',
		empty: 'No plan available',
	});

	const supportCases = state.supportCases || [];
	context.supportCaseId = supportCases.some((row) => row.id === context.supportCaseId)
		? context.supportCaseId
		: supportCases[0]?.id || '';
	renderTable(
		'[data-support-rows]',
		supportCases.map((row) => [
			' ',
			row.subject || 'Support case',
			row.status || 'open',
			formatDate(row.updated_at),
		]),
	);
	populateSelect('[data-support-select]', supportCases, {
		value: (row) => row.id,
		label: (row) => `${row.subject || 'Support case'} · ${row.status || 'open'}`,
		selected: context.supportCaseId,
		empty: 'No support cases',
	});

	const websites = (state.websites || []).filter(
		(row) => !context.serviceId || row.service_id === context.serviceId,
	);
	populateSelect('[data-website-select]', websites, {
		value: (row) => row.id,
		label: (row) => row.hostname || 'Website',
		selected: '',
		empty: 'No website available',
	});

	const handoff = state.migrationWorkspace?.[0];
	const migrationButton = document.querySelector('[data-migration-confirm]');
	if (migrationButton) migrationButton.disabled = !handoff?.workspace_ready_operation_id;
	renderNativeAccess(state.serviceNativeAccess || []);
}

function renderNativeAccess(rows) {
	const target = document.querySelector('[data-native-access]');
	if (!target) return;
	target.replaceChildren();
	const row = rows[0];
	if (!row || row.access_state !== 'ready') return;
	const candidate = row.panel_origin || row.url || row.login_url || row.panel_url;
	if (typeof candidate !== 'string') return;
	try {
		const url = new URL(candidate);
		if (url.protocol !== 'https:') return;
		const link = document.createElement('a');
		link.className = 'button button-secondary';
		link.href = url.toString();
		link.rel = 'noopener';
		link.target = '_blank';
		link.textContent = 'Open native hosting controls';
		target.append(link);
	} catch {
		// The backend did not provide a usable native access URL.
	}
}

function renderSupportDetail(state, context) {
	const detail = document.querySelector('[data-support-case-detail]');
	if (detail) {
		detail.replaceChildren();
		if (state.supportCase) {
			const heading = document.createElement('h3');
			heading.className = 'u-mb10';
			heading.textContent = state.supportCase.subject || 'Support case';
			const status = document.createElement('p');
			status.textContent = `Status: ${state.supportCase.status || 'open'}`;
			detail.append(heading, status);
		} else {
			const empty = document.createElement('p');
			empty.textContent = 'Select a support case to read its messages.';
			detail.append(empty);
		}
	}
	renderTable(
		'[data-support-message-rows]',
		(state.supportMessages || []).map((row) => [
			' ',
			row.author_user_id === context.userId ? 'You' : 'IHARC support',
			row.message || '',
			formatDate(row.created_at),
		]),
	);
}

async function loadSecurity(identity, config) {
	const factors = await identity.listFactors();
	renderTable(
		'[data-mfa-rows]',
		(factors.all || []).map((row) => [
			' ',
			row.friendly_name || 'Authenticator',
			row.status || 'unverified',
			removeControl('Remove', 'mfaRemove', row.id, row.friendly_name || 'authenticator'),
		]),
	);
	if (config.passkeysEnabled) {
		const passkeys = await identity.listPasskeys();
		renderTable(
			'[data-passkey-rows]',
			(passkeys || []).map((row) => [
				' ',
				row.friendly_name || 'Passkey',
				formatDate(row.last_used_at || row.created_at),
				removeControl('Remove', 'passkeyRemove', row.id, row.friendly_name || 'passkey'),
			]),
		);
	}
}

function removeControl(label, datasetName, id, itemName) {
	const button = document.createElement('button');
	button.className = 'button button-secondary';
	button.type = 'button';
	button.dataset[datasetName] = String(id || '');
	button.textContent = label;
	button.setAttribute('aria-label', `${label} ${itemName}`);
	return button;
}

function renderTable(selector, rows) {
	const target = document.querySelector(selector);
	if (!target) return;
	const header = target.querySelector(':scope > .units-table-header');
	target.replaceChildren();
	if (header) target.append(header);
	if (!rows.length) {
		const empty = document.createElement('p');
		empty.className = 'units-table-footer';
		empty.textContent = 'Nothing to show yet.';
		target.append(empty);
		return;
	}
	for (const row of rows) {
		const item = document.createElement('div');
		item.className = 'units-table-row';
		for (const [index, entry] of row.entries()) {
			const value = document.createElement('div');
			value.className =
				index === 0 ? 'units-table-cell units-table-heading-cell u-text-bold' : 'units-table-cell';
			if (entry instanceof Node) {
				value.append(entry);
			} else {
				value.textContent = String(entry || '—');
			}
			item.append(value);
		}
		target.append(item);
	}
}

function populateSelect(selector, rows, options) {
	for (const select of document.querySelectorAll(selector)) {
		select.replaceChildren();
		if (!rows.length) {
			select.append(new Option(options.empty, ''));
			select.disabled = true;
			continue;
		}
		rows.forEach((row, index) => {
			const option = new Option(options.label(row, index), options.value(row));
			option.selected = option.value === options.selected;
			select.append(option);
		});
		select.disabled = false;
	}
}

function offerLabel(row) {
	const name = row.display_name || titleCase(row.plan_code || 'Hosting');
	const price = Number(row.monthly_price_cad_cents);
	return Number.isFinite(price) ? `${name} · $${(price / 100).toFixed(2)} CAD/month` : name;
}

function titleCase(value) {
	return String(value)
		.replaceAll(/[_-]+/g, ' ')
		.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value) {
	if (!value) return '—';
	const date = new Date(value);
	return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleDateString();
}

function setText(selector, value) {
	for (const element of document.querySelectorAll(selector)) {
		element.textContent = value;
	}
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
