import { CustomerBusinessBackend, SupabaseIdentityProvider } from './providers.js';
import { customerSetupSelection, customerSetupUrl } from './navigation.js';
import { createRequestKeys } from './request-keys.js';

const configNode = document.querySelector('#customer-config');
const submissionKeys = createRequestKeys();
if (configNode) {
	const config = JSON.parse(configNode.textContent);
	// The local visual fixture supplies these implementations before this module
	// loads. Normal installations never set this value and use Supabase.
	const preview = globalThis.__CEASAR_CUSTOMER_PREVIEW__;
	const identity = preview?.identity || new SupabaseIdentityProvider(config);
	const backend = preview?.backend || new CustomerBusinessBackend(identity, config.workerApiBase);
	boot(config, identity, backend).catch(showError);
}

async function boot(config, identity, backend) {
	document.querySelector('[data-customer-sign-out]')?.addEventListener('click', async () => {
		await identity.signOut();
		location.assign(config.loginUrl);
	});

	configurePasswordInputs(config);
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
		control.addEventListener('click', () => showAuthView(control.dataset.authView, config));
	}
	for (const form of document.querySelectorAll('[data-customer-auth-form]')) {
		form.addEventListener('submit', async (event) => {
			event.preventDefault();
			clearNotice();
			const data = new FormData(form);
			try {
				setSubmitting(form, true);
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
					showAuthView('sign-in', config);
				} else {
					await identity.requestRecovery(String(data.get('email')));
					showNotice(
						'If the address belongs to an account, a recovery email is on its way.',
						'success',
					);
				}
			} catch (error) {
				showError(error);
			} finally {
				setSubmitting(form, false);
			}
		});
	}

	const passkey = document.querySelector('[data-passkey-sign-in]');
	if (passkey && config.passkeysEnabled) {
		passkey.classList.remove('u-hidden');
		passkey.addEventListener('click', async () => {
			try {
				passkey.disabled = true;
				await identity.signInWithPasskey();
				location.assign(accountUrl);
			} catch (error) {
				showError(error);
				passkey.disabled = false;
			}
		});
	}
}

function showAuthView(view, config) {
	for (const form of document.querySelectorAll('[data-customer-auth-form]')) {
		const active = form.dataset.customerAuthForm === view;
		form.classList.toggle('u-hidden', !active);
		if (active) {
			form.querySelector('input')?.focus();
			const heading = form.querySelector('h1')?.textContent?.trim();
			if (heading) document.title = `${heading} · ${config.brandName || 'Customer account'}`;
		}
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
			setSubmitting(form, true);
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
			setSubmitting(form, false);
		}
	});
}

async function bindAccount(config, identity, backend) {
	const setupSelection = customerSetupSelection(location.search);
	const session = await identity.session();
	if (!session) {
		location.replace(customerSetupUrl(config.loginUrl, setupSelection, ''));
		return;
	}

	const context = {
		accountId: '',
		serviceId: '',
		supportCaseId: '',
		supportPage: 1,
		supportHasMore: false,
		supportSearch: '',
		supportDetail: null,
		userId: '',
		state: emptyState(),
		setupPlanCode: setupSelection.planCode,
		setupIntent: setupSelection.intent,
		pollTimer: undefined,
		pollDeadline: 0,
		pollAccountId: '',
		pollInFlight: false,
		accounts: [],
		identityState: undefined,
		accountRequestToken: 0,
		accountContextToken: 0,
		checkoutRequestToken: 0,
		serviceRequestToken: 0,
		supportRequestToken: 0,
		supportDetailRequestToken: 0,
		backend,
		config,
		identityProvider: identity,
	};
	const user = await identity.user();
	document.querySelector('[data-customer-sign-out]')?.classList.remove('u-hidden');
	setText('[data-customer-email]', user.email || '');
	configureSupportFallback(config);
	bindNavigation(context);
	bindAccountControls(config, identity, backend, context);

	try {
		await loadCustomerState(backend, context);
	} catch {
		renderInitialCustomerStateFailure(context);
	} finally {
		await loadPasskeys(identity, config);
	}
	await loadSupport(backend, context);
	await openSupportTicketFromUrl(backend, context);
	renderCurrentView(context, false);
}

async function openSupportTicketFromUrl(backend, context) {
	const ticketId = new URL(location.href).searchParams.get('ticket') || '';
	if (!/^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(ticketId)) return;
	const token = ++context.supportDetailRequestToken;
	try {
		context.supportCaseId = ticketId;
		const detail = await backend.supportCase(ticketId);
		if (token === context.supportDetailRequestToken && context.supportCaseId === ticketId)
			setSupportDetail(detail, context);
	} catch (error) {
		if (token === context.supportDetailRequestToken) showError(error);
	}
}

function bindNavigation(context) {
	window.addEventListener('hashchange', () => {
		clearNotice();
		renderCurrentView(context, true);
		if (currentView() === 'hosting' && !document.hidden) startSetupPolling(context);
	});
	document.addEventListener('visibilitychange', () => {
		if (!document.hidden && currentView() === 'hosting') startSetupPolling(context);
	});
	for (const link of document.querySelectorAll('[data-customer-view-link]')) {
		link.addEventListener('click', () => {
			clearNotice();
			if (link.dataset.customerViewLink === currentView()) renderCurrentView(context, true);
		});
	}
	document.querySelector('[data-open-onboarding]')?.addEventListener('click', () => {
		setTimeout(() => document.querySelector('#account-name')?.focus(), 0);
	});
}

export function bindAccountControls(config, identity, backend, context) {
	document.querySelector('[data-open-setup]')?.addEventListener('click', () => {
		clearNotice();
		if (!context.accountId) {
			showNotice('Set up your customer account before adding hosting.');
			location.hash = 'hosting';
			document.querySelector('#account-name')?.focus();
			return;
		}
		const setupForm = document.querySelector('[data-setup-form]');
		if (setupForm) submissionKeys.clear(setupForm);
		location.hash = 'setup';
	});
	document.querySelector('[data-back-to-hosting]')?.addEventListener('click', () => {
		location.hash = 'hosting';
	});
	document.querySelector('[data-refresh-setup]')?.addEventListener('click', async (event) => {
		const control = event.currentTarget;
		try {
			control.disabled = true;
			await refreshCustomerState(backend, context);
		} catch (error) {
			showError(error);
		} finally {
			control.disabled = false;
		}
	});
	document.querySelector('[data-hosting-read-retry]')?.addEventListener('click', async (event) => {
		const control = event.currentTarget;
		try {
			control.disabled = true;
			clearNotice();
			await refreshCustomerState(backend, context);
		} catch (error) {
			if (context.initialStateUnavailable) renderInitialCustomerStateFailure(context);
			else showError(error);
		} finally {
			control.disabled = false;
		}
	});
	document.querySelector('[data-support-retry]')?.addEventListener('click', async (event) => {
		const control = event.currentTarget;
		try {
			control.disabled = true;
			clearNotice();
			if (context.initialStateUnavailable) await refreshCustomerState(backend, context);
			else await loadSupport(backend, context);
		} catch (error) {
			if (context.initialStateUnavailable) renderInitialCustomerStateFailure(context);
			else showError(error);
		} finally {
			control.disabled = false;
		}
	});
	document.querySelector('[data-support-search]')?.addEventListener('submit', async (event) => {
		event.preventDefault();
		context.supportPage = 1;
		context.supportSearch = String(new FormData(event.currentTarget).get('search') || '').trim();
		await loadSupport(backend, context);
	});
	document.querySelector('[data-support-next]')?.addEventListener('click', async (event) => {
		if (!context.supportHasMore) return;
		event.currentTarget.disabled = true;
		try {
			context.supportPage += 1;
			await loadSupport(backend, context);
		} catch (error) {
			showError(error);
		} finally {
			event.currentTarget.disabled = false;
		}
	});
	document.querySelector('[data-setup-status]')?.addEventListener('click', async (event) => {
		const view = event.target.closest('[data-view-service]');
		if (view) {
			clearNotice();
			await refreshSelectedServiceDetail(backend, context, required(view.dataset.viewService), {
				clear: true,
				focus: true,
			});
			return;
		}
		const control = event.target.closest('[data-resume-checkout]');
		if (!control) return;
		const accountId = required(context.accountId);
		const requestId = required(control.dataset.resumeCheckout);
		const token = ++context.checkoutRequestToken;
		const accountContextToken = context.accountContextToken;
		try {
			control.disabled = true;
			const checkout = await backend.setupCheckout(accountId, requestId);
			if (
				token !== context.checkoutRequestToken ||
				accountId !== context.accountId ||
				accountContextToken !== context.accountContextToken
			)
				return;
			location.assign(checkedHostedUrl(checkout.checkoutUrl));
		} catch (error) {
			if (
				token === context.checkoutRequestToken &&
				accountId === context.accountId &&
				accountContextToken === context.accountContextToken
			) {
				showError(error);
				control.disabled = false;
			}
		}
	});

	document.querySelector('[data-account-select]')?.addEventListener('change', async (event) => {
		try {
			clearNotice();
			await selectCustomerAccount(backend, context, required(event.currentTarget.value));
		} catch (error) {
			showError(error);
		}
	});

	document.querySelector('[data-service-list]')?.addEventListener('click', async (event) => {
		const row = event.target.closest('[data-service-id]');
		if (!row) return;
		await refreshSelectedServiceDetail(backend, context, required(row.dataset.serviceId), {
			clear: true,
			focus: true,
		});
	});

	document.querySelector('[data-support-case-list]')?.addEventListener('click', async (event) => {
		const row = event.target.closest('[data-support-case-id]');
		if (!row) return;
		const accountId = context.accountId;
		const caseId = required(row.dataset.supportCaseId);
		const token = ++context.supportDetailRequestToken;
		try {
			context.supportCaseId = caseId;
			context.supportDetail = null;
			renderSupportDetail({}, context);
			const detail = await backend.supportCase(caseId);
			if (
				token !== context.supportDetailRequestToken ||
				accountId !== context.accountId ||
				caseId !== context.supportCaseId
			)
				return;
			setSupportDetail(detail, context);
			focusSupportDetail();
		} catch (error) {
			if (
				token === context.supportDetailRequestToken &&
				accountId === context.accountId &&
				caseId === context.supportCaseId
			)
				showError(error);
		}
	});

	document.querySelector('[data-support-earlier]')?.addEventListener('click', async (event) => {
		const control = event.currentTarget;
		const current = context.supportDetail;
		const before = current?.supportCase?.nextBefore;
		const caseId = context.supportCaseId;
		if (!caseId || !before) return;
		const token = ++context.supportDetailRequestToken;
		try {
			control.disabled = true;
			const older = await backend.supportCase(caseId, { before });
			if (token !== context.supportDetailRequestToken || caseId !== context.supportCaseId) return;
			setSupportDetail(mergeSupportDetail(current, older), context);
		} catch (error) {
			if (token === context.supportDetailRequestToken && caseId === context.supportCaseId)
				showError(error);
		} finally {
			if (token === context.supportDetailRequestToken) control.disabled = false;
		}
	});

	document.querySelector('[data-support-close]')?.addEventListener('click', async (event) => {
		const control = event.currentTarget;
		const submission = actionScope('support-close', context);
		const requestScope = requestKeyScope('support-close', context);
		const caseId = required(context.supportCaseId);
		try {
			control.disabled = true;
			control.dataset.requestKey = requestScope;
			await backend.closeSupportCase(caseId, submissionKeys.current(control));
			submissionKeys.clear(control, requestScope);
			if (!actionScopeIsCurrent(context, submission)) return;
			showNotice('Support case closed.', 'success');
			await loadSupport(backend, context);
		} catch (error) {
			if (actionScopeIsCurrent(context, submission)) {
				showError(error);
				control.disabled = false;
			}
		}
	});
	document.querySelector('[data-support-reopen]')?.addEventListener('click', async (event) => {
		const control = event.currentTarget;
		const submission = actionScope('support-reopen', context);
		try {
			control.disabled = true;
			await backend.reopenSupportCase(
				required(context.supportCaseId),
				submissionKeys.current(control),
			);
			submissionKeys.clear(control);
			if (!actionScopeIsCurrent(context, submission)) return;
			showNotice('Support case reopened.', 'success');
			const detail = await backend.supportCase(context.supportCaseId);
			setSupportDetail(detail, context);
			await loadSupport(backend, context);
		} catch (error) {
			if (actionScopeIsCurrent(context, submission)) showError(error);
		} finally {
			if (actionScopeIsCurrent(context, submission)) control.disabled = false;
		}
	});

	for (const form of document.querySelectorAll('[data-account-action]')) {
		let formSubmissionToken = 0;
		form.addEventListener('input', () => {
			if (usesDurableFormDraft(form.dataset.accountAction)) submissionKeys.clear(form);
		});
		form.addEventListener('submit', async (event) => {
			event.preventDefault();
			clearNotice();
			const action = form.dataset.accountAction;
			const formData = new FormData(form);
			const data = Object.fromEntries(formData);
			if (formData.has('attachments')) data.attachments = formData.getAll('attachments');
			prepareFormRequest(form, data, context);
			const requestScope = form.dataset.requestKey;
			const submission = actionScope(action, context);
			const formToken = ++formSubmissionToken;
			data.idempotency_key = submissionKeys.current(form);
			try {
				setSubmitting(form, true);
				const result = await accountAction(
					action,
					data,
					context,
					config,
					identity,
					backend,
					submission,
				);
				const preserveKeyUntilAttachmentsUpload =
					['support-open', 'support-reply'].includes(action) && data.attachments?.length > 0;
				if (!result?.retainKey && action !== 'hosting-setup' && !preserveKeyUntilAttachmentsUpload)
					submissionKeys.clear(form, requestScope);
				if (result?.stale || !actionScopeIsCurrent(context, submission)) return;
				if (result?.supportTicket && data.attachments?.length) {
					await uploadSupportAttachments(
						backend,
						result.supportTicket,
						data.attachments,
						submissionKeys.current(form),
					);
					submissionKeys.clear(form, requestScope);
				}
				if (result?.message) showNotice(result.message, 'success');
				if (action === 'support-open') {
					form.reset();
					await loadSupport(backend, context);
				} else if (action === 'account-create') {
					await loadCustomerState(backend, context);
					await loadSupport(backend, context);
				} else if (action === 'support-reply') {
					form.reset();
					if (context.supportCaseId) {
						const detail = await backend.supportCase(context.supportCaseId);
						if (actionScopeIsCurrent(context, submission)) setSupportDetail(detail, context);
					}
				} else if (
					!['profile', 'email-change', 'password-change', 'billing-portal'].includes(action)
				) {
					await refreshCustomerState(backend, context);
					if (result?.terminal) location.hash = 'hosting';
				}
			} catch (error) {
				if (formToken === formSubmissionToken && actionScopeIsCurrent(context, submission))
					showError(error);
			} finally {
				if (formToken === formSubmissionToken) setSubmitting(form, false);
			}
		});
	}

	const setupForm = document.querySelector('[data-setup-form]');
	setupForm?.querySelectorAll('[name=intent]').forEach((control) => {
		control.addEventListener('change', () => {
			syncMigrationSiteType(setupForm);
			renderSetupReview(context);
		});
	});
	setupForm
		?.querySelectorAll('[name=plan_code], [name=site_type], [name=setup_mode]')
		.forEach((control) => {
			control.addEventListener('change', () => renderSetupReview(context));
		});
	if (context.setupIntent === 'migration') {
		setValueIn(setupForm, '[name=intent]', 'migration');
		syncMigrationSiteType(setupForm);
		renderSetupReview(context);
	}

	const passkey = document.querySelector('[data-passkey-register]');
	if (passkey && config.passkeysEnabled) {
		passkey.classList.remove('u-hidden');
		passkey.addEventListener('click', async () => {
			try {
				passkey.disabled = true;
				await identity.registerPasskey();
				showNotice('Passkey registered.', 'success');
				await loadPasskeys(identity, config);
			} catch (error) {
				showError(error);
			} finally {
				passkey.disabled = false;
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
			showError(error);
			control.disabled = false;
		}
	});
}

export async function accountAction(action, data, context, config, identity, backend, submission) {
	if (action === 'profile') {
		await identity.updateProfile(required(data.display_name));
		return { message: 'Profile saved.' };
	}
	if (action === 'account-create') {
		const created = await backend.createAccount(
			required(data.display_name),
			required(data.idempotency_key),
		);
		if (!actionScopeIsCurrent(context, submission)) return { stale: true, retainKey: true };
		context.accountId = required(created.accountId);
		return { message: 'Customer account created.' };
	}
	if (action === 'email-change') {
		await identity.updateEmail(required(data.email), config.callbackUrl);
		return { message: 'Follow the confirmation instructions sent to your email addresses.' };
	}
	if (action === 'password-change') {
		await identity.updatePassword(passwordValue(data.password));
		return { message: 'Password changed.' };
	}
	const accountId = required(context.accountId);
	if (action === 'hosting-setup') {
		if (data.intent === 'migration' && data.site_type !== 'php') {
			throw new Error('Existing-site imports use the PHP site type.');
		}
		const planCode = required(data.plan_code);
		const offer = context.state.offers?.find((candidate) => candidate.planCode === planCode);
		if (!offer) throw new Error('Choose an available plan.');
		if (typeof context.state.trialEligibility?.canStartTrial !== 'boolean')
			throw new Error('Hosting options are unavailable right now. Try again.');
		if (!['trial', 'paid'].includes(data.setup_mode))
			throw new Error('Choose how you want to continue.');
		const isTrial = data.setup_mode === 'trial';
		if (
			isTrial &&
			(context.state.trialEligibility?.canStartTrial !== true || offer.trialAvailable !== true)
		)
			throw new Error('A trial is not available for this plan.');
		if ((!isTrial || data.intent === 'migration') && offer.paidAvailable !== true)
			throw new Error('Paid hosting is not available for this plan.');
		const setup = isTrial
			? await backend.requestTrialAdmission({
					accountId,
					planCode,
					siteType: required(data.site_type),
					idempotencyKey: required(data.idempotency_key),
				})
			: await backend.requestPaidAdmission({
					accountId,
					planCode,
					intent: required(data.intent),
					siteType: required(data.site_type),
					idempotencyKey: required(data.idempotency_key),
				});
		if (!actionScopeIsCurrent(context, submission)) return { stale: true, retainKey: true };
		context.state.setups = [
			setup,
			...(context.state.setups || []).filter((row) => row.requestId !== setup.requestId),
		];
		renderSetups(context.state.setups, context);
		startSetupPolling(context);
		if (setup.status === 'checkout' && setup.checkoutUrl) {
			location.assign(checkedHostedUrl(setup.checkoutUrl));
			return { retainKey: true };
		}
		return {
			message: setupMessage(setup),
			retainKey: !terminalSetup(setup.status),
			terminal: terminalSetup(setup.status),
		};
	}
	if (action === 'migration-confirm') {
		const migration = context.state.services.find(
			(service) => service.serviceId === context.serviceId,
		)?.migration;
		await backend.confirmMigration(required(context.serviceId), {
			accountId,
			workspaceReadyOperationId: required(migration?.workspaceReadyOperationId),
			idempotencyKey: required(data.idempotency_key),
		});
		if (!actionScopeIsCurrent(context, submission)) return { stale: true, retainKey: true };
		return { message: 'Import completion recorded.' };
	}
	if (action === 'support-open') {
		const ticket = await backend.openSupportCase({
			accountId,
			subject: required(data.subject),
			message: required(data.message),
			idempotencyKey: required(data.idempotency_key),
		});
		return { message: 'Support case opened.', supportTicket: ticket };
	}
	if (action === 'support-reply') {
		const ticket = await backend.replyToSupportCase(
			required(context.supportCaseId),
			required(data.message),
			required(data.idempotency_key),
		);
		return { message: 'Reply sent.', supportTicket: ticket };
	}
	if (action === 'billing-portal') {
		const portalUrl = await backend.billingPortal(accountId);
		if (!actionScopeIsCurrent(context, submission)) return { stale: true, retainKey: true };
		location.assign(portalUrl);
		return { retainKey: true };
	}
	throw new Error('Unsupported customer action.');
}

async function loadCustomerState(backend, context) {
	const sessionState = await backend.sessionState();
	context.initialStateUnavailable = false;
	context.identityState = sessionState.identity;
	context.accounts = sessionState.accounts || [];
	context.userId = sessionState.identity?.userId || context.userId;
	if (sessionState.identity?.displayName)
		setValue('[name=display_name]', sessionState.identity.displayName);
	const accountId = sessionState.selectedAccountId || context.accounts[0]?.accountId || '';
	if (context.accountId !== accountId) {
		context.accountContextToken += 1;
		context.checkoutRequestToken += 1;
	}
	context.accountId = accountId;
	renderCustomerState(
		{ identity: sessionState.identity, accounts: context.accounts, selectedAccountId: accountId },
		context,
	);
	if (accountId) await loadAccountState(backend, context, accountId, ++context.accountRequestToken);
}

async function selectCustomerAccount(backend, context, accountId) {
	const token = ++context.accountRequestToken;
	context.accountContextToken += 1;
	context.checkoutRequestToken += 1;
	context.accountId = accountId;
	context.serviceId = '';
	context.supportCaseId = '';
	context.supportDetail = null;
	context.serviceRequestToken += 1;
	context.supportDetailRequestToken += 1;
	context.supportRequestToken += 1;
	for (const form of document.querySelectorAll('[data-account-action]')) setSubmitting(form, false);
	renderCustomerState(
		{ identity: context.identityState, accounts: context.accounts, selectedAccountId: accountId },
		context,
	);
	renderSupportCases([], context);
	await Promise.all([
		loadAccountState(backend, context, accountId, token),
		loadSupport(backend, context, accountId, token),
	]);
}

async function loadAccountState(backend, context, accountId, accountToken) {
	try {
		const accountState = await backend.accountState(accountId);
		if (accountToken !== context.accountRequestToken || accountId !== context.accountId) return;
		context.hostingUnavailable = false;
		const selectedDetail = context.state.services?.find(
			(service) => service.serviceId === context.serviceId,
		);
		const services = (accountState.services || []).map((service) =>
			service.serviceId === selectedDetail?.serviceId
				? {
						...service,
						...(selectedDetail.nativeAccess ? { nativeAccess: selectedDetail.nativeAccess } : {}),
						...(selectedDetail.migration ? { migration: selectedDetail.migration } : {}),
					}
				: service,
		);
		renderCustomerState(
			{
				...accountState,
				services,
				identity: context.identityState,
				accounts: context.accounts,
				selectedAccountId: accountId,
			},
			context,
		);
	} catch (error) {
		if (accountToken !== context.accountRequestToken || accountId !== context.accountId) return;
		context.hostingUnavailable = true;
		renderCustomerState(
			{ identity: context.identityState, accounts: context.accounts, selectedAccountId: accountId },
			context,
		);
		showNotice('Hosting details are unavailable right now. Try again or use support.');
	}
}

async function refreshCustomerState(backend, context) {
	if (!context.accountId) {
		await loadCustomerState(backend, context);
		await loadSupport(backend, context);
		return;
	}
	const accountId = context.accountId;
	const token = ++context.accountRequestToken;
	await Promise.all([
		loadAccountState(backend, context, accountId, token),
		loadSupport(backend, context, accountId, token),
	]);
	if (
		token !== context.accountRequestToken ||
		accountId !== context.accountId ||
		!context.serviceId
	)
		return;
	await refreshSelectedServiceDetail(backend, context, context.serviceId, { quiet: true });
}

export async function refreshSelectedServiceDetail(
	backend,
	context,
	serviceId,
	{ clear = false, focus = false, quiet = false } = {},
) {
	const accountId = context.accountId;
	const token = ++context.serviceRequestToken;
	context.serviceId = serviceId;
	if (clear) renderServiceDetail(undefined, context);
	try {
		const state = await backend.serviceState(serviceId);
		if (
			token !== context.serviceRequestToken ||
			accountId !== context.accountId ||
			serviceId !== context.serviceId
		)
			return false;
		const selectedService =
			state.service || state.services?.find((item) => item.serviceId === serviceId);
		const services = selectedService
			? context.state.services.map((item) =>
					item.serviceId === selectedService.serviceId ? { ...item, ...selectedService } : item,
				)
			: state.services || context.state.services;
		renderCustomerState({ ...context.state, ...state, services }, context);
		if (focus) focusServiceDetail();
		return true;
	} catch (error) {
		if (
			token === context.serviceRequestToken &&
			accountId === context.accountId &&
			serviceId === context.serviceId &&
			!quiet
		)
			showError(error);
		return false;
	}
}

async function loadSupport(
	backend,
	context,
	accountId = context.accountId,
	accountToken = context.accountRequestToken,
) {
	const token = ++context.supportRequestToken;
	try {
		const result = await backend.supportCases({
			page: context.supportPage,
			search: context.supportSearch,
		});
		if (token !== context.supportRequestToken || accountToken !== context.accountRequestToken)
			return;
		context.supportHasMore = Boolean(
			result.hasMore ||
			result.nextPage ||
			(result.page && result.totalPages && result.page < result.totalPages),
		);
		renderSupportCases(result.cases || [], context);
	} catch (error) {
		if (
			token !== context.supportRequestToken ||
			accountToken !== context.accountRequestToken ||
			accountToken !== context.accountRequestToken
		)
			return;
		renderSupportFailure(error, context);
	}
}

function renderCustomerState(state, context) {
	context.state = { ...emptyState(), ...state };
	context.accountId =
		context.state.selectedAccountId ||
		context.accountId ||
		context.state.accounts?.[0]?.accountId ||
		'';
	const accounts = context.state.accounts || [];
	const needsAccount = accounts.length === 0;
	document.querySelector('[data-account-onboarding]')?.classList.toggle('u-hidden', !needsAccount);
	document
		.querySelector('[data-account-switcher]')
		?.classList.toggle('u-hidden', accounts.length < 2);
	document
		.querySelector('[data-support-account-required]')
		?.classList.toggle('u-hidden', !needsAccount);
	document.querySelector('[data-support-actions]')?.classList.toggle('u-hidden', needsAccount);
	document.querySelector('[data-setup-load-failure]')?.toggleAttribute('hidden', true);
	document.querySelector('[data-setup-form]')?.toggleAttribute('hidden', false);
	populateSelect('[data-account-select]', accounts, {
		value: (row) => row.accountId,
		label: (row) => row.displayName || 'Customer account',
		selected: context.accountId,
		empty: 'No customer account',
	});
	renderServices(context.state.services || [], context);
	renderSetups(context.state.setups || [], context);
	renderOffers(context.state.offers || [], context);
	renderBilling(context.state.billing || [], context);
	restoreSetupDraft(context);
	restoreFormDraft(
		document.querySelector('[data-account-action="account-create"]'),
		'account-create',
		context,
	);
	restoreFormDraft(
		document.querySelector('[data-account-action="support-open"]'),
		'support-open',
		context,
	);
	startSetupPolling(context);
}

export function renderInitialCustomerStateFailure(context) {
	context.initialStateUnavailable = true;
	context.accountId = '';
	context.accounts = [];
	context.state = emptyState();
	document.querySelector('[data-account-onboarding]')?.classList.add('u-hidden');
	document.querySelector('[data-account-switcher]')?.classList.add('u-hidden');
	document.querySelector('[data-support-account-required]')?.classList.add('u-hidden');
	document.querySelector('[data-support-actions]')?.classList.add('u-hidden');
	const accountSelect = document.querySelector('[data-account-select]');
	if (accountSelect) {
		const unavailable = document.createElement('option');
		unavailable.textContent = 'Account unavailable';
		accountSelect.replaceChildren(unavailable);
		accountSelect.disabled = true;
	}
	const serviceList = document.querySelector('[data-service-list]');
	if (serviceList) serviceList.replaceChildren();
	const serviceEmpty = document.querySelector('[data-service-empty]');
	if (serviceEmpty) {
		serviceEmpty.hidden = false;
		serviceEmpty.textContent = 'Account information could not be loaded right now.';
	}
	document.querySelector('[data-open-setup]')?.toggleAttribute('hidden', true);
	document.querySelector('[data-hosting-read-retry]')?.toggleAttribute('hidden', false);
	renderServiceDetail(undefined, context);
	renderSetups([]);
	const billing = document.querySelector('[data-billing-summary]');
	if (billing) {
		billing.replaceChildren(
			element(
				'p',
				{ className: 'customer-empty' },
				'Billing information is unavailable right now.',
			),
		);
	}
	document.querySelector('[data-billing-portal]')?.classList.add('u-hidden');
	const cases = document.querySelector('[data-support-case-list]');
	if (cases) {
		cases.replaceChildren(
			element(
				'p',
				{ className: 'customer-empty' },
				'Account information is unavailable right now.',
			),
		);
	}
	document.querySelector('[data-support-retry]')?.toggleAttribute('hidden', false);
	renderSupportDetail({}, context);
	document.querySelector('[data-setup-load-failure]')?.toggleAttribute('hidden', false);
	document.querySelector('[data-setup-form]')?.toggleAttribute('hidden', true);
}

function renderServices(services, context) {
	const target = document.querySelector('[data-service-list]');
	const empty = document.querySelector('[data-service-empty]');
	if (!target || !empty) return;
	target.replaceChildren();
	const unavailable = context.hostingUnavailable === true;
	empty.hidden = services.length > 0 && !unavailable;
	empty.textContent = unavailable
		? 'Hosting details are unavailable right now.'
		: services.length
			? ''
			: 'No hosting services yet.';
	document.querySelector('[data-open-setup]')?.toggleAttribute('hidden', unavailable);
	document.querySelector('[data-hosting-read-retry]')?.toggleAttribute('hidden', !unavailable);
	if (unavailable) {
		context.serviceId = '';
		renderServiceDetail(undefined, context);
		return;
	}
	if (!services.some((service) => service.serviceId === context.serviceId)) context.serviceId = '';
	for (const service of services) {
		const row = document.createElement('div');
		row.className = 'customer-row customer-service-row';
		const view = document.createElement('button');
		view.type = 'button';
		view.className = 'customer-row-action';
		view.dataset.serviceId = service.serviceId;
		view.textContent = 'View hosting';
		view.setAttribute('aria-expanded', String(service.serviceId === context.serviceId));
		row.append(
			rowPrimary(service.hostname || 'Hosting service', titleCase(service.planCode || 'Hosting')),
			statusNode(service.status),
			view,
		);
		target.append(row);
	}
	renderServiceDetail(
		services.find((service) => service.serviceId === context.serviceId),
		context,
	);
}

function renderServiceDetail(service, context) {
	const target = document.querySelector('[data-service-detail]');
	if (!target) return;
	target.replaceChildren();
	if (!service) {
		target.classList.add('u-hidden');
		return;
	}
	target.classList.remove('u-hidden');
	target.append(element('h3', {}, service.hostname || 'Hosting service'));
	const details = document.createElement('dl');
	details.className = 'customer-detail-grid';
	appendDetail(details, 'Plan', titleCase(service.planCode || '—'));
	appendDetail(details, 'Status', readableStatus(service.status));
	if (service.retentionDueAt)
		appendDetail(details, 'Retention date', formatDate(service.retentionDueAt));
	target.append(details);

	const access = service.nativeAccess;
	const migrationReady =
		service.migration?.status === 'ready' && service.migration.workspaceReadyOperationId;
	if (!migrationReady && access?.accessState === 'ready') {
		const accessHeading = element('h3', {}, 'Hosting access');
		const accessDetails = document.createElement('dl');
		accessDetails.className = 'customer-detail-grid';
		appendDetail(accessDetails, 'Username', access.providerUsername || '—');
		appendDetail(
			accessDetails,
			'SFTP',
			access.sftpHostname && access.sftpPort ? `${access.sftpHostname}:${access.sftpPort}` : '—',
		);
		target.append(accessHeading, accessDetails);
		target.append(accessHelp());
		if (access.panelOrigin) {
			const actions = document.createElement('div');
			actions.className = 'customer-actions';
			actions.append(hostingAccessLink(access.panelOrigin, '/login/', 'Open hosting controls'));
			actions.append(hostingAccessLink(access.panelOrigin, '/reset/', 'Set hosting password'));
			target.append(actions);
		}
	} else if (!migrationReady) {
		target.append(
			element(
				'p',
				{ className: 'customer-form-help' },
				'Hosting access will appear here when setup is complete.',
			),
		);
	}

	if (migrationReady) {
		const migration = service.migration;
		const migrationHeading = element('h3', {}, 'Import workspace');
		const migrationDetails = document.createElement('dl');
		migrationDetails.className = 'customer-detail-grid';
		appendDetail(migrationDetails, 'Preview address', migration.previewHostname || '—');
		appendDetail(migrationDetails, 'Username', migration.providerUsername || '—');
		appendDetail(
			migrationDetails,
			'SFTP',
			migration.sftpHostname && migration.sftpPort
				? `${migration.sftpHostname}:${migration.sftpPort}`
				: '—',
		);
		target.append(migrationHeading, migrationDetails);
		target.append(accessHelp());
		const form = document.createElement('form');
		form.className = 'customer-form customer-section';
		form.dataset.accountAction = 'migration-confirm';
		const copy = element('p', {}, 'Finish the import in the workspace, then confirm it here.');
		const actions = document.createElement('div');
		actions.className = 'customer-actions';
		if (migration.panelOrigin) {
			actions.append(hostingAccessLink(migration.panelOrigin, '/login/', 'Open import workspace'));
			actions.append(hostingAccessLink(migration.panelOrigin, '/reset/', 'Set hosting password'));
		}
		const confirm = document.createElement('button');
		confirm.className = 'button button-secondary';
		confirm.type = 'submit';
		confirm.textContent = 'Confirm import is complete';
		actions.append(confirm);
		form.append(copy, actions);
		bindDynamicAction(form, context);
		target.append(form);
	}
}

function accessHelp() {
	return element(
		'p',
		{ className: 'customer-form-help' },
		'Hosting controls and SFTP use this hosting username. Before first access, set a hosting password. It is separate from your customer account sign-in.',
	);
}

export function renderSetups(setups) {
	const section = document.querySelector('[data-setup-status-section]');
	const target = document.querySelector('[data-setup-status]');
	if (!section || !target) return;
	target.replaceChildren();
	section.classList.toggle('u-hidden', setups.length === 0);
	for (const setup of setups) {
		const row = document.createElement('div');
		row.className = 'customer-row';
		row.append(
			rowPrimary(
				setup.hostname || titleCase(setup.planCode || 'Hosting setup'),
				setupMessage(setup),
			),
		);
		if (setup.nextAction !== 'continue_checkout' && setup.status !== 'import_ready')
			row.append(statusNode(setup.status));
		if (setup.nextAction === 'continue_checkout') {
			const actions = document.createElement('div');
			actions.className = 'customer-actions';
			const resume = document.createElement('button');
			resume.className = 'button button-secondary';
			resume.type = 'button';
			resume.dataset.resumeCheckout = setup.requestId;
			resume.textContent = 'Continue checkout';
			actions.append(resume);
			row.append(actions);
		}
		if (setup.nextAction === 'view_service' && setup.serviceId) {
			const actions = document.createElement('div');
			actions.className = 'customer-actions';
			const view = document.createElement('button');
			view.className = 'button button-secondary';
			view.type = 'button';
			view.dataset.viewService = setup.serviceId;
			view.textContent = 'View hosting';
			actions.append(view);
			row.append(actions);
		}
		target.append(row);
	}
}

function renderOffers(offers, context) {
	populateSelect('[data-plan-select]', offers, {
		value: (row) => row.planCode,
		label: offerLabel,
		selected: offers.some((offer) => offer.planCode === context.setupPlanCode)
			? context.setupPlanCode
			: offers[0]?.planCode || '',
		empty: 'No plan available',
	});
	const trial = document.querySelector('[data-trial-choice]');
	const trialInput = trial?.querySelector('input');
	const paid = document.querySelector('[data-paid-choice]');
	const paidInput = paid?.querySelector('input');
	const form = document.querySelector('[data-setup-form]');
	const selectedOffer = offers.find((offer) => offer.planCode === form?.elements.plan_code?.value);
	const limits = document.querySelector('[data-plan-limits]');
	if (limits) {
		const summary = offerLimits(selectedOffer);
		limits.textContent = summary;
		limits.hidden = !summary;
	}
	const eligibilityKnown =
		context.state.trialEligibility !== null &&
		typeof context.state.trialEligibility?.canStartTrial === 'boolean';
	const trialAvailable =
		eligibilityKnown &&
		context.state.trialEligibility.canStartTrial === true &&
		selectedOffer?.trialAvailable === true;
	const paidAvailable = eligibilityKnown && selectedOffer?.paidAvailable === true;
	if (form) {
		form.dataset.trialEligible = String(trialAvailable);
		form.dataset.paidAvailable = String(paidAvailable);
		form.dataset.setupAvailable = String(trialAvailable || paidAvailable);
		const submit = form.querySelector('button[type="submit"]');
		if (submit) submit.disabled = !trialAvailable && !paidAvailable;
	}
	if (trial) trial.hidden = !trialAvailable;
	if (trialInput) trialInput.disabled = !trialAvailable;
	if (paid) paid.hidden = !(trialAvailable && paidAvailable);
	if (paidInput) paidInput.disabled = !paidAvailable;
	if (trialAvailable && !paidAvailable && trialInput) trialInput.checked = true;
	if (paidAvailable && !trialAvailable && paidInput) paidInput.checked = true;
	syncMigrationSiteType(form);
	renderSetupReview(context);
}

function restoreSetupDraft(context) {
	const form = document.querySelector('[data-setup-form]');
	if (!form || !context.accountId) return;
	form.dataset.requestKey = requestKeyScope('hosting-setup', context);
	const draft = submissionKeys.read(form);
	if (!draft || draft.userId !== context.userId || draft.accountId !== context.accountId) return;
	setValueIn(form, '[name=plan_code]', draft.planCode || '');
	setCheckedValue(form, 'intent', draft.intent || 'new_site');
	setValueIn(form, '[name=site_type]', draft.siteType || 'wordpress');
	setCheckedValue(form, 'setup_mode', draft.setupMode || '');
	syncMigrationSiteType(form);
	renderSetupReview(context);
}

function renderSetupReview(context) {
	const form = document.querySelector('[data-setup-form]');
	const review = document.querySelector('[data-setup-review]');
	if (!form || !review) return;
	const planCode = form.elements.plan_code?.value || '';
	const offer = context.state.offers?.find((candidate) => candidate.planCode === planCode);
	const intent = form.querySelector('[name=intent]:checked')?.value || 'new_site';
	const siteType = form.elements.site_type?.value || '';
	const setupMode = form.querySelector('[name=setup_mode]:checked')?.value || '';
	if (
		form.dataset.setupAvailable !== 'true' ||
		(intent === 'migration' && form.dataset.paidAvailable !== 'true')
	) {
		review.textContent = planCode
			? 'This plan is not available right now. Choose another plan.'
			: 'Choose a plan to continue.';
		return;
	}
	if (!['trial', 'paid'].includes(setupMode)) {
		review.textContent = 'Choose how you want to continue.';
		return;
	}
	const plan = offerLabel(offer || { planCode });
	const site =
		intent === 'migration'
			? 'Import an existing PHP site'
			: `Start a new ${siteTypeLabel(siteType)}`;
	const route = setupMode === 'trial' ? 'Start a free trial' : 'Continue to secure checkout';
	const limits = offerLimits(offer);
	review.textContent = [plan, site, route, limits].filter(Boolean).join(' · ');
}

function siteTypeLabel(siteType) {
	switch (siteType) {
		case 'wordpress':
			return 'WordPress site';
		case 'php':
			return 'PHP site';
		case 'static':
			return 'static site';
		default:
			return 'website';
	}
}

function focusServiceDetail() {
	const heading = document.querySelector('[data-service-detail] h3');
	if (!heading) return;
	heading.tabIndex = -1;
	heading.focus();
}

function offerLimits(offer) {
	if (!offer) return '';
	const items = [];
	if (Number.isFinite(Number(offer.websiteLimit))) {
		const count = Number(offer.websiteLimit);
		items.push(`${count} ${count === 1 ? 'website' : 'websites'}`);
	}
	if (Number.isFinite(Number(offer.storageBytes)) && Number(offer.storageBytes) > 0)
		items.push(`${formatBytes(offer.storageBytes)} storage`);
	if (Number.isFinite(Number(offer.transferBytes)) && Number(offer.transferBytes) > 0)
		items.push(`${formatBytes(offer.transferBytes)} transfer`);
	return items.length ? `Includes ${items.join(', ')}` : '';
}

function prepareSetupDraft(form, data, context) {
	form.dataset.requestKey = requestKeyScope('hosting-setup', context);
	submissionKeys.save(form, {
		userId: context.userId,
		accountId: context.accountId,
		planCode: clean(data.plan_code),
		intent: clean(data.intent),
		siteType: clean(data.site_type),
		setupMode: clean(data.setup_mode),
	});
}

function prepareFormRequest(form, data, context) {
	const action = form.dataset.accountAction || '';
	if (action === 'hosting-setup') {
		prepareSetupDraft(form, data, context);
		return;
	}
	form.dataset.requestKey = requestKeyScope(action, context);
	if (['account-create', 'support-open', 'support-reply'].includes(action)) {
		submissionKeys.save(form, {
			userId: context.userId,
			accountId: context.accountId,
			supportCaseId: context.supportCaseId,
			values: data,
		});
	}
}

function usesDurableFormDraft(action) {
	return ['hosting-setup', 'account-create', 'support-open', 'support-reply'].includes(action);
}

function actionScope(action, context) {
	return {
		action,
		userId: context.userId,
		accountId: context.accountId,
		serviceId: context.serviceId,
		supportCaseId: context.supportCaseId,
		accountContextToken: context.accountContextToken,
	};
}

function actionScopeIsCurrent(context, submission) {
	if (!submission) return true;
	if (submission.userId !== context.userId) return false;
	if (submission.action === 'account-create') return true;
	if (
		submission.accountId !== context.accountId ||
		submission.accountContextToken !== context.accountContextToken
	)
		return false;
	if (['support-reply', 'support-close'].includes(submission.action))
		return submission.supportCaseId === context.supportCaseId;
	if (submission.action === 'migration-confirm') return submission.serviceId === context.serviceId;
	return true;
}

function restoreFormDraft(form, action, context) {
	if (!form) return;
	form.dataset.requestKey = requestKeyScope(action, context);
	const draft = submissionKeys.read(form);
	if (!draft || draft.userId !== context.userId || draft.accountId !== context.accountId) return;
	if (action === 'support-reply' && draft.supportCaseId !== context.supportCaseId) return;
	for (const [name, value] of Object.entries(draft.values || {})) {
		const control = form.elements.namedItem(name);
		if (control && !control.value) control.value = value;
	}
}

function requestKeyScope(action, context) {
	const identity = scopePart(context.userId || 'customer');
	const account = scopePart(context.accountId || 'new-account');
	const supportCase = scopePart(context.supportCaseId || 'no-case');
	if (action === 'account-create') return `account-create:${identity}`;
	if (action === 'support-open') return `support-open:${identity}:${account}`;
	if (action === 'support-reply' || action === 'support-close')
		return `${action}:${identity}:${account}:${supportCase}`;
	if (action === 'migration-confirm')
		return `${action}:${identity}:${account}:${scopePart(context.serviceId || 'no-service')}`;
	return `${action}:${identity}:${account}`;
}

function scopePart(value) {
	return encodeURIComponent(String(value));
}

function renderBilling(billing, context) {
	const target = document.querySelector('[data-billing-summary]');
	const portal = document.querySelector('[data-billing-portal]');
	if (!target || !portal) return;
	target.replaceChildren();
	const rows = Array.isArray(billing) ? billing : billing ? [billing] : [];
	if (!rows.length) {
		target.append(element('p', { className: 'customer-empty' }, 'No current subscription.'));
		portal.classList.add('u-hidden');
		return;
	}
	portal.classList.toggle('u-hidden', !context.accountId);
	for (const subscription of rows) {
		const row = document.createElement('div');
		row.className = 'customer-row';
		const price = currency(subscription.monthlyPriceCadCents);
		const timing = subscription.cancellationEffectiveAt
			? `Ends ${formatDate(subscription.cancellationEffectiveAt)}`
			: subscription.nextChargeAt
				? `Next charge ${formatDate(subscription.nextChargeAt)}`
				: 'Subscription details available in billing';
		row.append(
			rowPrimary(
				titleCase(subscription.planCode || 'Hosting plan'),
				`${price}${price && timing ? ' · ' : ''}${timing}`,
			),
			statusNode(subscription.subscriptionStatus),
		);
		target.append(row);
	}
}

function renderSupportCases(cases, context) {
	const target = document.querySelector('[data-support-case-list]');
	if (!target) return;
	document.querySelector('[data-support-retry]')?.toggleAttribute('hidden', true);
	target.replaceChildren();
	if (!cases.length) {
		context.supportCaseId = '';
		target.append(element('p', { className: 'customer-empty' }, 'No support cases yet.'));
		renderSupportDetail({}, context);
		return;
	}
	if (!cases.some((item) => item.caseId === context.supportCaseId)) context.supportCaseId = '';
	for (const supportCase of cases) {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'customer-case';
		button.dataset.supportCaseId = supportCase.caseId;
		button.setAttribute('aria-current', String(supportCase.caseId === context.supportCaseId));
		button.append(
			rowPrimary(supportCase.subject || 'Support case', formatDate(supportCase.updatedAt)),
			statusNode(supportCase.status),
		);
		target.append(button);
	}
	document.querySelector('[data-support-next]')?.toggleAttribute('hidden', !context.supportHasMore);
}

function renderSupportFailure(_error, context) {
	context.supportCaseId = '';
	const target = document.querySelector('[data-support-case-list]');
	if (target) {
		target.replaceChildren();
		target.append(
			element('p', { className: 'customer-empty' }, 'Support cases could not be loaded right now.'),
		);
	}
	document.querySelector('[data-support-retry]')?.toggleAttribute('hidden', false);
	renderSupportDetail({}, context);
	showNotice('Support cases could not be loaded. Try again or use the contact link.');
}

export function renderSupportDetail(state, context) {
	const detail = document.querySelector('[data-support-case-detail]');
	const messages = document.querySelector('[data-support-message-list]');
	const reply = document.querySelector('[data-support-reply-form]');
	const earlier = document.querySelector('[data-support-earlier]');
	if (!detail || !messages || !reply) return;
	detail.replaceChildren();
	messages.replaceChildren();
	const supportCase = state.supportCase;
	if (!supportCase) {
		detail.append(
			element('p', { className: 'customer-empty' }, 'Choose a case to read the conversation.'),
		);
		reply.hidden = true;
		if (earlier) earlier.hidden = true;
		return;
	}
	if (earlier) earlier.hidden = !supportCase.hasMoreMessages;
	detail.append(
		element('h2', {}, supportCase.subject || 'Support case'),
		statusNode(supportCase.status),
	);
	for (const message of state.messages || []) {
		const item = document.createElement('article');
		item.className = 'customer-message';
		item.append(
			element(
				'p',
				{ className: 'customer-message-meta' },
				`${supportAuthor(message, context)} · ${formatDate(message.createdAt)}`,
			),
			element('p', { className: 'customer-message-copy' }, message.message || ''),
		);
		if (message.attachments?.length) {
			const files = element('p', { className: 'customer-message-attachments' });
			for (const attachment of message.attachments) {
				const link = element(
					'button',
					{ type: 'button', className: 'button button-secondary' },
					attachment.filename || 'Download attachment',
				);
				link.onclick = async () => {
					link.disabled = true;
					try {
						const blob = await context.backend.downloadSupportAttachment(attachment);
						const url = URL.createObjectURL(blob);
						const download = document.createElement('a');
						download.href = url;
						download.download = attachment.filename || 'attachment';
						download.click();
						setTimeout(() => URL.revokeObjectURL(url), 1000);
					} catch (cause) {
						showError(cause);
					} finally {
						link.disabled = false;
					}
				};
				files.append(link, document.createTextNode(' '));
			}
			item.append(files);
		}
		messages.append(item);
	}
	const permitted = supportCase.permittedActions || {};
	const closed = String(supportCase.status || '').toLowerCase() === 'closed';
	const canReply = permitted.reply !== false && !closed;
	reply.hidden = !canReply;
	for (const control of reply.querySelectorAll('textarea, button')) control.disabled = !canReply;
	const reopen = document.querySelector('[data-support-reopen]');
	if (reopen) reopen.hidden = !(closed && permitted.reopen !== false);
	restoreFormDraft(reply, 'support-reply', context);
}

function setSupportDetail(detail, context) {
	context.supportDetail = detail;
	renderSupportDetail(detail, context);
}

function focusSupportDetail() {
	const detail = document.querySelector('[data-support-case-detail]');
	if (!detail) return;
	detail.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
	const heading = detail.querySelector('h2');
	if (heading instanceof HTMLElement) {
		heading.tabIndex = -1;
		heading.focus({ preventScroll: true });
	}
}

function mergeSupportDetail(current, older) {
	const byId = new Map();
	for (const message of [...(older.messages || []), ...(current.messages || [])]) {
		byId.set(message.id, message);
	}
	return {
		...current,
		supportCase: { ...current.supportCase, ...older.supportCase },
		messages: [...byId.values()].sort((left, right) =>
			String(left.createdAt).localeCompare(String(right.createdAt)),
		),
	};
}

function supportAuthor(message, context) {
	if (message.authorName)
		return `${message.authorName} · ${message.authorRole === 'staff' ? 'Support' : 'Customer'}`;
	if (message.author === 'customer') return 'You';
	if (message.authorRole === 'customer') return 'Customer';
	if (message.authorRole === 'staff' || message.author === 'support')
		return `${context.config?.brandName || 'Support'} support`;
	return 'Participant';
}

async function uploadSupportAttachments(backend, ticket, attachments, idempotencyKey) {
	const files = attachments.filter((file) => file instanceof File && file.size > 0);
	if (!files.length) return;
	const messageId = ticket.messages?.at(-1)?.id;
	if (!ticket.id || !messageId)
		throw new Error('Your message was saved, but its attachments could not be added.');
	await backend.uploadSupportAttachments(ticket.id, messageId, files, idempotencyKey);
}

function startSetupPolling(context) {
	clearInterval(context.pollTimer);
	if (!context.state.setups?.some((setup) => pendingSetup(setup.status))) {
		context.pollDeadline = 0;
		context.pollAccountId = '';
		return;
	}
	if (context.pollAccountId !== context.accountId || !context.pollDeadline) {
		context.pollAccountId = context.accountId;
		context.pollDeadline = Date.now() + 120000;
	}
	if (Date.now() >= context.pollDeadline || document.hidden || currentView() !== 'hosting') return;
	context.pollTimer = setInterval(async () => {
		if (Date.now() >= context.pollDeadline || document.hidden || currentView() !== 'hosting') {
			clearInterval(context.pollTimer);
			return;
		}
		if (context.pollInFlight) return;
		try {
			const backend = context.backend;
			context.pollInFlight = true;
			if (backend) await refreshCustomerState(backend, context);
		} catch {
			// Keep the manual refresh action available without repeating an error notice.
		} finally {
			context.pollInFlight = false;
		}
	}, 12000);
}

function bindDynamicAction(form, context) {
	let formSubmissionToken = 0;
	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		const backend = context.backend;
		if (!backend) return;
		let submission;
		let formToken;
		try {
			setSubmitting(form, true);
			const data = Object.fromEntries(new FormData(form));
			form.dataset.requestKey = requestKeyScope('migration-confirm', context);
			const requestScope = form.dataset.requestKey;
			submission = actionScope('migration-confirm', context);
			formToken = ++formSubmissionToken;
			data.idempotency_key = submissionKeys.current(form);
			const result = await accountAction(
				'migration-confirm',
				data,
				context,
				context.config,
				context.identityProvider,
				backend,
				submission,
			);
			submissionKeys.clear(form, requestScope);
			if (result?.stale || !actionScopeIsCurrent(context, submission)) return;
			showNotice(result.message, 'success');
			await refreshCustomerState(backend, context);
		} catch (error) {
			if (formToken === formSubmissionToken && actionScopeIsCurrent(context, submission))
				showError(error);
		} finally {
			if (formToken === formSubmissionToken) setSubmitting(form, false);
		}
	});
}

export function syncMigrationSiteType(form) {
	if (!form) return;
	const migration = form.querySelector('[name=intent]:checked')?.value === 'migration';
	const siteType = form.querySelector('[name=site_type]');
	const siteTypeLabel = form.querySelector('[data-site-type-label]');
	const migrationSiteType = form.querySelector('[data-migration-site-type]');
	const trialChoice = form.querySelector('[data-trial-choice]');
	const trial = trialChoice?.querySelector('input');
	const paidChoice = form.querySelector('[data-paid-choice]');
	const paid = paidChoice?.querySelector('input');
	const paidAvailable = form.dataset.paidAvailable === 'true';
	const submit = form.querySelector('button[type="submit"]');
	if (migration) {
		setValueIn(form, '[name=site_type]', 'php');
		if (siteType) siteType.hidden = true;
		if (siteTypeLabel) siteTypeLabel.hidden = true;
		if (migrationSiteType) migrationSiteType.hidden = false;
		if (trialChoice) trialChoice.hidden = true;
		if (trial) trial.disabled = true;
		if (paidChoice) paidChoice.hidden = true;
		if (paid) paid.checked = true;
		if (submit) submit.disabled = !paidAvailable;
		return;
	}
	if (siteType) siteType.hidden = false;
	if (siteTypeLabel) siteTypeLabel.hidden = false;
	if (migrationSiteType) migrationSiteType.hidden = true;
	const canStartTrial = form.dataset.trialEligible === 'true';
	if (trialChoice) trialChoice.hidden = !canStartTrial;
	if (trial) trial.disabled = !canStartTrial;
	if (paidChoice) paidChoice.hidden = !(canStartTrial && paidAvailable);
	if (paid) paid.disabled = !paidAvailable;
	if (submit) submit.disabled = !canStartTrial && !paidAvailable;
}

async function loadPasskeys(identity, config) {
	if (!config.passkeysEnabled) return;
	const rows = await identity.listPasskeys();
	const target = document.querySelector('[data-passkey-rows]');
	const empty = document.querySelector('[data-passkey-empty]');
	if (!target || !empty) return;
	target.replaceChildren();
	empty.hidden = Boolean(rows?.length);
	for (const passkey of rows || []) {
		const row = document.createElement('div');
		row.className = 'customer-row';
		const remove = document.createElement('button');
		remove.type = 'button';
		remove.className = 'button button-secondary';
		remove.dataset.passkeyRemove = String(passkey.id || '');
		remove.textContent = 'Remove';
		remove.setAttribute('aria-label', `Remove ${passkey.friendly_name || 'passkey'}`);
		row.append(
			rowPrimary(
				passkey.friendly_name || 'Passkey',
				`Last used ${formatDate(passkey.last_used_at || passkey.created_at)}`,
			),
			remove,
		);
		target.append(row);
	}
}

function renderCurrentView(context, focus) {
	const view = currentView();
	for (const element of document.querySelectorAll('[data-customer-view]')) {
		const visible = element.dataset.customerView === view;
		element.hidden = !visible;
		if (visible && focus) element.querySelector('h1')?.focus();
	}
	for (const link of document.querySelectorAll('[data-customer-view-link]')) {
		if (link.dataset.customerViewLink === view) {
			link.setAttribute('aria-current', 'page');
		} else {
			link.removeAttribute('aria-current');
		}
	}
	const brand = context.config?.brandName || 'Customer account';
	document.title = `${readableStatus(view)} · ${brand}`;
}

function currentView() {
	const candidate = location.hash.slice(1).toLowerCase();
	return ['hosting', 'billing', 'support', 'profile', 'security', 'setup'].includes(candidate)
		? candidate
		: 'hosting';
}

function configurePasswordInputs(config) {
	const minimum = passwordMinimum(config);
	for (const control of document.querySelectorAll('[data-password-input]')) {
		control.minLength = minimum;
	}
	for (const help of document.querySelectorAll('[data-password-help]')) {
		help.textContent = `Use at least ${minimum} characters.`;
	}
}

function configureSupportFallback(config) {
	const link = document.querySelector('[data-support-contact]');
	const fallback = document.querySelector('[data-support-fallback]');
	if (!link || !fallback || typeof config.supportUrl !== 'string') return;
	try {
		const url = new URL(config.supportUrl);
		if (url.protocol !== 'https:' || url.username || url.password) return;
		link.href = url.toString();
		fallback.classList.remove('u-hidden');
	} catch {
		// Omit an invalid operator contact URL from the customer page.
	}
}

function passwordMinimum(config) {
	const value = Number(config.passwordMinLength);
	return Number.isInteger(value) && value >= 6 && value <= 128 ? value : 6;
}

function populateSelect(selector, rows, options) {
	for (const select of document.querySelectorAll(selector)) {
		select.replaceChildren();
		if (!rows.length) {
			select.append(new Option(options.empty, ''));
			select.disabled = true;
			continue;
		}
		for (const row of rows) {
			const option = new Option(options.label(row), options.value(row));
			option.selected = option.value === options.selected;
			select.append(option);
		}
		select.disabled = false;
	}
}

function rowPrimary(title, detail) {
	const primary = document.createElement('div');
	primary.append(
		element('div', { className: 'customer-row-title' }, title),
		element('div', { className: 'customer-row-detail' }, detail),
	);
	return primary;
}

function statusNode(status) {
	return element(
		'span',
		{ className: 'customer-status', dataset: { state: String(status || '').toLowerCase() } },
		readableStatus(status),
	);
}

function element(name, options = {}, content = '') {
	const node = document.createElement(name);
	if (options.className) node.className = options.className;
	if (options.dataset) Object.assign(node.dataset, options.dataset);
	if (content) node.textContent = content;
	return node;
}

function appendDetail(target, term, description) {
	target.append(element('dt', {}, term), element('dd', {}, description));
}

function hostingAccessLink(originValue, path, label) {
	const origin = new URL(originValue);
	if (
		origin.protocol !== 'https:' ||
		origin.username ||
		origin.password ||
		origin.pathname !== '/' ||
		origin.search ||
		origin.hash
	) {
		throw new Error('Hosting access is unavailable.');
	}
	const link = document.createElement('a');
	link.className = 'button button-secondary';
	link.href = new URL(path, origin).toString();
	link.target = '_blank';
	link.rel = 'noopener';
	link.textContent = label;
	return link;
}

function checkedHostedUrl(value) {
	const url = new URL(value);
	if (
		url.protocol !== 'https:' ||
		url.username ||
		url.password ||
		(url.hostname !== 'stripe.com' && !url.hostname.endsWith('.stripe.com'))
	) {
		throw new Error('Checkout is unavailable.');
	}
	return url.toString();
}

function emptyState() {
	return {
		accounts: [],
		selectedAccountId: '',
		offers: [],
		trialEligibility: { canStartTrial: false },
		services: [],
		setups: [],
		billing: [],
	};
}

function pendingSetup(status) {
	return ['preparing', 'checkout', 'provisioning'].includes(String(status).toLowerCase());
}

function terminalSetup(status) {
	return ['completed', 'failed', 'expired', 'cancelled'].includes(String(status).toLowerCase());
}

function setupMessage(setup) {
	const action = setup.nextAction;
	if (setup.status === 'import_ready') return 'Import workspace is ready.';
	if (action === 'continue_checkout') return 'Checkout is ready to continue.';
	if (action === 'view_service') return 'Hosting is ready.';
	if (action === 'start_new_setup') return 'This setup ended. You can start a new one.';
	if (setup.status === 'provisioning') return 'Your hosting is being prepared.';
	if (setup.status === 'preparing') return 'Your setup is being prepared.';
	return readableStatus(setup.status);
}

function offerLabel(offer) {
	const name = offer.displayName || titleCase(offer.planCode || 'Hosting');
	const price = currency(offer.monthlyPriceCadCents);
	return price ? `${name} · ${price}/month` : name;
}

function readableStatus(value) {
	const text = String(value || 'pending')
		.replaceAll(/[_-]+/g, ' ')
		.trim();
	return text ? text.replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Pending';
}

function currency(value) {
	const cents = Number(value);
	return Number.isFinite(cents) ? `$${(cents / 100).toFixed(2)} CAD` : '';
}

function formatBytes(value) {
	const bytes = Number(value);
	if (!Number.isFinite(bytes) || bytes <= 0) return '';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
	const amount = bytes / 1024 ** index;
	return `${Number(amount.toFixed(amount >= 10 || index === 0 ? 0 : 1))} ${units[index]}`;
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
	for (const element of document.querySelectorAll(selector)) element.textContent = value;
}

function setValue(selector, value) {
	for (const element of document.querySelectorAll(selector)) element.value = value;
}

function setValueIn(container, selector, value) {
	const element = container?.querySelector(selector);
	if (element) element.value = value;
}

function setCheckedValue(container, name, value) {
	for (const control of container?.querySelectorAll(`[name="${name}"]`) || []) {
		control.checked = control.value === value;
	}
}

function setSubmitting(form, submitting) {
	for (const control of form.querySelectorAll('button[type="submit"]'))
		control.disabled = submitting;
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
	if (typeof value !== 'string' || value.length === 0)
		throw new Error('Complete all required fields.');
	return value;
}

function clearNotice() {
	const notice = document.querySelector('[data-customer-notice]');
	if (!notice) return;
	notice.hidden = true;
	notice.replaceChildren();
	notice.className = 'customer-notice';
}

function showNotice(message, type = 'danger') {
	const notice = document.querySelector('[data-customer-notice]');
	if (!notice) return;
	notice.hidden = false;
	notice.textContent = message;
	notice.className = `customer-notice inline-alert-${type}`;
}

function showError(error) {
	showNotice(humanError(error));
}

function humanError(error) {
	const message = error instanceof Error ? error.message : '';
	if (message === 'upstream_rejected')
		return 'That request could not be completed. Review the details and try again.';
	return message || 'The request could not be completed.';
}
