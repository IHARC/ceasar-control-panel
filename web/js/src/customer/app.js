import { CustomerBusinessBackend, SupabaseIdentityProvider } from './providers.js';
import { customerSetupSelection, customerSetupUrl } from './navigation.js';
import { createRequestKeys } from './request-keys.js';

const configNode = document.querySelector('#customer-config');
const submissionKeys = createRequestKeys();
if (configNode) {
	const config = JSON.parse(configNode.textContent);
	const identity = new SupabaseIdentityProvider(config);
	const backend = new CustomerBusinessBackend(identity, config.workerApiBase);
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
	const setup = customerSetupSelection(location.search);
	const accountUrl = customerSetupUrl(config.accountUrl, setup);
	const callbackUrl = customerSetupUrl(config.callbackUrl, setup, '');
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
					location.assign(accountUrl);
				} else if (form.dataset.customerAuthForm === 'sign-up') {
					await identity.signUp(
						String(data.get('email')),
						String(data.get('password')),
						data.get('terms') === 'yes',
						callbackUrl,
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

	const passkey = document.querySelector('[data-passkey-sign-in]');
	if (passkey && config.passkeysEnabled) {
		passkey.classList.remove('u-hidden');
		passkey.addEventListener('click', async () => {
			try {
				await identity.signInWithPasskey();
				location.assign(accountUrl);
			} catch (error) {
				showError(error);
			}
		});
	}
}

function showAuthView(view) {
	for (const form of document.querySelectorAll('[data-customer-auth-form]')) {
		const active = form.dataset.customerAuthForm === view;
		form.classList.toggle('u-hidden', !active);
	}
}

async function handleCallback(config, identity) {
	const parameters = new URLSearchParams(location.search);
	const code = parameters.get('code');
	if (!code) throw new Error('The confirmation link is incomplete.');
	await identity.exchangeConfirmation(code);
	const setup = customerSetupSelection(location.search);
	if (parameters.get('mode') === 'recovery') {
		bindRecovery(config, identity);
		return;
	}
	location.replace(customerSetupUrl(config.accountUrl, setup));
}

export function bindRecovery(config, identity) {
	const form = document.querySelector('[data-customer-recovery]');
	if (!form) throw new Error('Password reset form is unavailable.');
	clearNotice();
	form.classList.remove('u-hidden');
	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		try {
			const data = new FormData(form);
			const password = passwordValue(data.get('password'));
			if (password !== passwordValue(data.get('password_confirm'))) {
				throw new Error('Passwords do not match.');
			}
			await identity.updatePassword(password);
			showNotice('Password updated. You can now sign in.', 'success');
			form.remove();
			setTimeout(() => location.replace(config.loginUrl), 1000);
		} catch (error) {
			showError(error);
		}
	});
}

async function bindAccount(config, identity, backend) {
	const setup = customerSetupSelection(location.search);
	const session = await identity.session();
	if (!session) {
		location.replace(customerSetupUrl(config.loginUrl, setup, ''));
		return;
	}

	const context = {
		accountId: '',
		serviceId: '',
		supportCaseId: '',
		userId: '',
		setupPlanCode: setup.planCode,
		state: {},
	};
	const user = await identity.user();
	document.querySelector('[data-customer-sign-out]')?.classList.remove('u-hidden');
	setText('[data-customer-email]', user.email || '');
	setValue('[name=intent]', setup.intent);

	for (const form of document.querySelectorAll('[data-account-action]')) {
		form.addEventListener('input', () => submissionKeys.clear(form));
		form.addEventListener('submit', async (event) => {
			event.preventDefault();
			clearNotice();
			const data = Object.fromEntries(new FormData(form));
			data.idempotency_key = submissionKeys.current(form);
			try {
				const result = await accountAction(
					form.dataset.accountAction,
					data,
					context,
					config,
					identity,
					backend,
				);
				const message = typeof result === 'string' ? result : result.message;
				if (typeof result === 'string' || !result.retry) submissionKeys.clear(form);
				if (message) showNotice(message, 'success');
				if (['support-open', 'support-reply'].includes(form.dataset.accountAction)) {
					for (const field of form.querySelectorAll('input:not([type="hidden"]), textarea')) {
						field.value = '';
					}
				}
				if (
					context.accountId &&
					!['admission-trial', 'admission-paid', 'billing-portal'].includes(
						form.dataset.accountAction,
					)
				) {
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
	const supportClose = document.querySelector('[data-support-close]');
	supportClose?.addEventListener('click', async () => {
		try {
			await backend.closeSupportCase(
				required(context.supportCaseId),
				submissionKeys.current(supportClose),
			);
			submissionKeys.clear(supportClose);
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
				await loadPasskeys(identity, config);
			} catch (error) {
				showError(error);
			}
		});
	} else {
		document.querySelector('[data-passkey-section]')?.remove();
	}

	document.querySelector('[data-passkey-rows]')?.addEventListener('click', async (event) => {
		const control = event.target.closest('[data-passkey-remove]');
		if (!control || !confirm('Remove this passkey from your account?')) return;
		try {
			control.disabled = true;
			await identity.deletePasskey(required(control.dataset.passkeyRemove));
			showNotice('Passkey removed.', 'success');
			await loadPasskeys(identity, config);
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
	await loadPasskeys(identity, config);
}

export async function accountAction(action, data, context, config, identity, backend) {
	if (action === 'profile') {
		await identity.updateProfile(required(data.display_name));
		return 'Profile saved.';
	}
	if (action === 'account-create') {
		const created = await backend.createAccount(required(data.display_name));
		context.accountId = required(Array.isArray(created) ? created[0]?.customer_account_id : '');
		return 'Customer account created.';
	}
	if (action === 'email-change') {
		await identity.updateEmail(required(data.email), config.callbackUrl);
		return 'Check the new address to confirm the change.';
	}
	if (action === 'password-change') {
		await identity.updatePassword(passwordValue(data.password));
		return 'Password changed.';
	}
	const accountId = required(context.accountId);
	const serviceId = clean(context.serviceId);
	if (action === 'admission-trial') {
		const checkout = await backend.requestTrialAdmission({
			accountId,
			planCode: required(data.plan_code),
			siteType: required(data.site_type),
			requestedCustomDomain: clean(data.requested_custom_domain),
			idempotencyKey: required(data.idempotency_key),
		});
		if (checkout.state === 'ready' && checkout.url) {
			location.assign(checkout.url);
			return '';
		}
		return { message: 'Secure trial checkout is preparing. Try again in a moment.', retry: true };
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
			idempotencyKey: required(data.idempotency_key),
		});
		if (checkout.state === 'ready' && checkout.url) {
			location.assign(checkout.url);
			return '';
		}
		return { message: 'Stripe Checkout is preparing. Try again in a moment.', retry: true };
	}
	if (action === 'migration-confirm') {
		const handoff = context.state.migrationWorkspace?.[0];
		await backend.confirmMigration(required(serviceId), {
			accountId,
			workspaceReadyOperationId: required(handoff?.workspace_ready_operation_id),
			idempotencyKey: required(data.idempotency_key),
		});
		return 'Import completion recorded.';
	}
	if (action === 'support-open') {
		await backend.openSupportCase({
			accountId,
			subject: required(data.subject),
			message: required(data.message),
			idempotencyKey: required(data.idempotency_key),
		});
		return 'Support case opened.';
	}
	if (action === 'support-reply') {
		await backend.replyToSupportCase(
			required(context.supportCaseId),
			required(data.message),
			required(data.idempotency_key),
		);
		return 'Reply sent.';
	}
	if (action === 'billing-portal') {
		location.assign(await backend.billingPortal(accountId));
		return '';
	}
	throw new Error('Unsupported customer action.');
}

async function refreshSelectedAccount(backend, context) {
	const state = context.serviceId
		? await backend.serviceState(context.serviceId)
		: await backend.accountState(required(context.accountId));
	renderCustomerState(state, context, context.serviceId);
	if (context.supportCaseId) {
		renderSupportDetail(await backend.supportCase(context.supportCaseId), context);
	}
}

function renderCustomerState(state, context, preferredServiceId = '') {
	context.state = state;
	context.accountId =
		state.selectedAccountId || context.accountId || state.contexts?.[0]?.customer_account_id || '';

	const accounts = state.contexts || [];
	const needsAccount = accounts.length === 0;
	document.querySelector('[data-account-onboarding]')?.classList.toggle('u-hidden', !needsAccount);
	document
		.querySelector('[data-support-account-required]')
		?.classList.toggle('u-hidden', !needsAccount);
	document.querySelector('[data-support-actions]')?.classList.toggle('u-hidden', needsAccount);
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
	const offers = state.offers || [];
	populateSelect('[data-plan-select]', offers, {
		value: (row) => row.plan_code,
		label: (row) => offerLabel(row),
		selected: offers.some((row) => row.plan_code === context.setupPlanCode)
			? context.setupPlanCode
			: '',
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
	const candidate = row.panel_origin;
	if (typeof candidate !== 'string') return;
	try {
		const origin = new URL(candidate);
		const hostname = typeof row.sftp_hostname === 'string' ? row.sftp_hostname : '';
		const port = Number(row.sftp_port);
		const username = typeof row.provider_username === 'string' ? row.provider_username : '';
		if (
			origin.protocol !== 'https:' ||
			origin.username ||
			origin.password ||
			origin.pathname !== '/' ||
			origin.search ||
			origin.hash ||
			!hostname ||
			!Number.isInteger(port) ||
			port < 1 ||
			port > 65535 ||
			!username
		)
			return;
		const heading = document.createElement('h3');
		heading.className = 'u-mb10';
		heading.textContent = 'Native hosting access';
		const credentials = document.createElement('p');
		credentials.className = 'u-mb10';
		credentials.textContent = `Username: ${username} · SFTP: ${hostname}:${port}`;
		const controls = document.createElement('p');
		const login = document.createElement('a');
		login.className = 'button button-secondary';
		login.href = new URL('/login/', origin).toString();
		login.rel = 'noopener';
		login.target = '_blank';
		login.textContent = 'Open hosting controls';
		const reset = document.createElement('a');
		reset.className = 'button button-secondary';
		reset.href = new URL('/reset/', origin).toString();
		reset.rel = 'noopener';
		reset.target = '_blank';
		reset.textContent = 'Set or reset hosting password';
		controls.append(login, document.createTextNode(' '), reset);
		target.append(heading, credentials, controls);
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

async function loadPasskeys(identity, config) {
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

function passwordValue(value) {
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error('Complete all required fields.');
	}
	return value;
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
