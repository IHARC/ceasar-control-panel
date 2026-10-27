import { CustomerBusinessBackend, SupabaseIdentityProvider } from './providers.js';
import { customerSetupSelection, customerSetupUrl } from './navigation.js';
import { createRequestKeys } from './request-keys.js';
import { configureAnalytics } from './analytics.js';
import { createAuthCaptcha } from './captcha.js';
import { createOnboardingWizard } from './wizard.js';

const configNode = document.querySelector('#customer-config');
const submissionKeys = createRequestKeys();
const trialCheckoutReturnKey = 'ceasar:trial-checkout-return';
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
	const page = document.body.dataset.customerPage;
	const callbackParameters = page === 'callback' ? new URLSearchParams(location.search) : null;
	if (callbackParameters?.has('token_hash')) {
		const cleanUrl = new URL(location.href);
		cleanUrl.searchParams.delete('token_hash');
		history.replaceState(history.state, '', cleanUrl);
	}
	const analytics = configureAnalytics(config);
	document.querySelector('[data-customer-sign-out]')?.addEventListener('click', async () => {
		await identity.signOut();
		location.assign(config.loginUrl);
	});

	configurePasswordInputs(config);
	if (page === 'login') {
		bindLogin(config, identity, analytics);
	} else if (page === 'callback') {
		await handleCallback(config, identity, callbackParameters);
	} else if (page === 'account') {
		await bindAccount(config, identity, backend, analytics);
	}
}

function bindLogin(config, identity, analytics) {
	let captcha;
	let captchaLoad;
	function getCaptcha() {
		if (captcha) return Promise.resolve(captcha);
		captchaLoad ||= createAuthCaptcha(
			config,
			document.querySelectorAll('[data-customer-auth-form]'),
		)
			.then((loaded) => {
				captcha = loaded;
				return loaded;
			})
			.catch((error) => {
				captchaLoad = undefined;
				throw error;
			});
		return captchaLoad;
	}
	void getCaptcha().catch(showError);
	const setup = customerSetupSelection(location.search);
	for (const choice of document.querySelectorAll('[name=login_setup_kind]')) {
		choice.checked = choice.value === setup.setupKind;
		choice.addEventListener('change', () => {
			setup.setupKind = choice.value;
			setup.intent = ['wordpress-move', 'php-import'].includes(choice.value)
				? 'migration'
				: 'new_site';
			const url = new URL(location.href);
			url.searchParams.set('setupKind', choice.value);
			url.searchParams.set('intent', setup.intent);
			history.replaceState(history.state, '', url);
		});
	}
	const selectedPlan = document.querySelector('[data-selected-plan]');
	if (selectedPlan && setup.planCode) {
		selectedPlan.textContent = `Continue with the ${titleCase(setup.planCode)} hosting plan after signing in.`;
		selectedPlan.hidden = false;
	}
	for (const control of document.querySelectorAll('[data-auth-view]')) {
		control.addEventListener('click', () => {
			captcha?.reset(document.querySelector('[data-customer-auth-form]:not(.u-hidden)'));
			showAuthView(control.dataset.authView, config);
			void getCaptcha()
				.then((loaded) =>
					loaded.activate(
						document.querySelector(`[data-customer-auth-form="${control.dataset.authView}"]`),
					),
				)
				.catch(showError);
		});
	}
	for (const form of document.querySelectorAll('[data-customer-auth-form]')) {
		form.addEventListener('submit', async (event) => {
			event.preventDefault();
			clearNotice();
			const data = new FormData(form);
			try {
				setSubmitting(form, true);
				const challenge = await getCaptcha();
				const captchaToken = challenge.token(form);
				if (form.dataset.customerAuthForm === 'sign-in') {
					await identity.signIn(
						String(data.get('email')),
						String(data.get('password')),
						captchaToken,
					);
					location.assign(customerSetupUrl(config.accountUrl, setup));
				} else if (form.dataset.customerAuthForm === 'sign-up') {
					await identity.signUp(
						String(data.get('email')),
						String(data.get('password')),
						data.get('terms') === 'yes',
						customerSetupUrl(config.callbackUrl, setup, ''),
						captchaToken,
						String(data.get('account_name') || ''),
					);
					analytics.track('sign_up');
					showNotice('Check your email and confirm your address before signing in.', 'success');
					form.querySelector('[name=password]').value = '';
					showAuthView('sign-in', config);
					captcha?.activate(document.querySelector('[data-customer-auth-form="sign-in"]'));
				} else {
					await identity.requestRecovery(String(data.get('email')), captchaToken);
					showNotice(
						'If the address belongs to an account, a recovery email is on its way.',
						'success',
					);
				}
			} catch (error) {
				showError(error);
			} finally {
				captcha?.reset(form);
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
				location.assign(customerSetupUrl(config.accountUrl, setup));
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

async function handleCallback(config, identity, parameters) {
	const tokenHash = parameters.get('token_hash');
	if (parameters.get('mode') === 'recovery' && tokenHash) {
		bindRecoveryVerification(config, identity, tokenHash);
		return;
	}
	const code = parameters.get('code');
	if (!code)
		throw new Error(parameters.get('error_description') || 'The confirmation link is incomplete.');
	await identity.exchangeConfirmation(code);
	const setup = customerSetupSelection(location.search);
	if (parameters.get('mode') === 'recovery') {
		bindRecovery(config, identity);
		return;
	}
	location.replace(customerSetupUrl(config.accountUrl, setup));
}

export function bindRecoveryVerification(config, identity, tokenHash) {
	const button = document.querySelector('[data-customer-verify-recovery]');
	if (!button) throw new Error('Password reset confirmation is unavailable.');
	const notice = document.querySelector('[data-customer-notice]');
	if (notice) notice.textContent = 'Continue to verify your recovery link.';
	button.classList.remove('u-hidden');
	button.addEventListener('click', async () => {
		button.disabled = true;
		clearNotice();
		try {
			await identity.verifyRecovery(tokenHash);
			button.remove();
			bindRecovery(config, identity);
		} catch (error) {
			showError(error);
			button.disabled = false;
		}
	});
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

async function bindAccount(config, identity, backend, analytics) {
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
		setupAvailabilityTimer: undefined,
		setupAvailabilityInFlight: false,
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
		analytics,
		analyticsConsentVersion: 0,
		analyticsAttributionLastKey: '',
		analyticsAttributionChain: Promise.resolve(),
		analyticsViewedPlans: new Set(),
	};
	const user = await identity.user();
	context.wizard = createOnboardingWizard({
		root: document.querySelector('[data-onboarding-wizard]'),
		provider: backend,
		onCreateAccount: async (name) => {
			const target = document.querySelector('[data-onboarding-wizard]');
			target.dataset.requestKey = `account-create:${context.userId}`;
			const created = await backend.createAccount(name, submissionKeys.current(target));
			context.accountId = created.accountId;
			return created.accountId;
		},
		onRefreshOffers: async () => backend.accountState(context.accountId),
		onNewSetup: () => {
			const target = document.querySelector('[data-onboarding-wizard]');
			const scope = requestKeyScope('hosting-setup', context);
			submissionKeys.clear(target, scope);
		},
		onCommit: async (draft) => {
			const target = document.querySelector('[data-onboarding-wizard]');
			target.dataset.requestKey = requestKeyScope('hosting-setup', context);
			const input = {
				accountId: context.accountId,
				planCode: draft.planCode,
				intent: draft.intent,
				siteType: draft.siteType,
				idempotencyKey: submissionKeys.current(target),
			};
			const result =
				draft.setupMode === 'trial'
					? await backend.requestTrialAdmission(input)
					: await backend.requestPaidAdmission(input);
			context.state.setups = [
				result,
				...(context.state.setups || []).filter((row) => row.requestId !== result.requestId),
			];
			renderSetups(context.state.setups);
			startSetupPolling(context);
			if (draft.setupMode === 'trial' && result.requestId)
				rememberTrialCheckoutReturn(context.accountId, result.requestId);
			return result;
		},
		onUpdate: () => {
			if (context.accountId && (setupSelection.planCode || setupSelection.setupKind))
				consumeSetupSelection();
			void (context.accounts.length
				? refreshCustomerState(backend, context)
				: loadCustomerState(backend, context));
		},
	});
	context.wizard.state.draft.planCode = setupSelection.planCode;
	context.wizard.state.draft.setupKind =
		setupSelection.setupKind ||
		(setupSelection.planCode && setupSelection.intent === 'migration' ? 'php-import' : '');
	context.wizard.render();
	document.querySelector('[data-customer-sign-out]')?.classList.remove('u-hidden');
	setText('[data-customer-email]', user.email || '');
	configureSupportFallback(config);
	bindNavigation(context);
	bindAccountControls(config, identity, backend, context);
	analytics.onChange((_, version) => {
		context.analyticsConsentVersion = version;
		void syncAnalyticsAttribution(context);
	});

	try {
		await loadCustomerState(backend, context);
		if (!context.accountId && typeof user.user_metadata?.display_name === 'string') {
			const accountName = user.user_metadata.display_name.trim().slice(0, 120);
			if (accountName) {
				try {
					const target = document.querySelector('[data-onboarding-wizard]');
					target.dataset.requestKey = `account-create:${context.userId}`;
					await backend.createAccount(accountName, submissionKeys.current(target));
					await loadCustomerState(backend, context);
				} catch (error) {
					showError(error);
				}
			}
		}
		if (context.accountId && (setupSelection.setupKind || setupSelection.planCode)) {
			await context.wizard.update({
				accountId: context.accountId,
				offers: context.state.offers || [],
				trialEligibility: context.state.trialEligibility,
				setups: context.state.setups || [],
			});
			await context.wizard.startNew(setupSelection);
			consumeSetupSelection();
		}
		if ((setupSelection.planCode || setupSelection.setupKind) && !context.initialStateUnavailable)
			location.hash = 'setup';
	} catch {
		renderInitialCustomerStateFailure(context);
	} finally {
		await loadPasskeys(identity, config);
	}
	await loadSupport(backend, context);
	await openSupportTicketFromUrl(backend, context);
	renderCurrentView(context, false);
	startSetupAvailabilityPolling(context);
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

function consumeSetupSelection() {
	const url = new URL(location.href);
	for (const name of ['planCode', 'setupKind', 'siteType', 'intent']) url.searchParams.delete(name);
	history.replaceState(history.state, '', url);
}

function bindNavigation(context) {
	window.addEventListener('hashchange', () => {
		clearNotice();
		renderCurrentView(context, true);
		context.analytics?.pageView();
		if (['hosting', 'setup'].includes(currentView()) && !document.hidden)
			startSetupPolling(context);
		startSetupAvailabilityPolling(context);
	});
	document.addEventListener('visibilitychange', () => {
		if (!document.hidden && ['hosting', 'setup'].includes(currentView()))
			startSetupPolling(context);
		if (!document.hidden && currentView() === 'setup') void refreshSetupAvailability(context);
		startSetupAvailabilityPolling(context);
	});
	window.addEventListener('focus', () => {
		if (currentView() === 'setup' && !document.hidden) void refreshSetupAvailability(context);
	});
	for (const link of document.querySelectorAll('[data-customer-view-link]')) {
		link.addEventListener('click', () => {
			clearNotice();
			if (link.dataset.customerViewLink === currentView()) renderCurrentView(context, true);
		});
	}
	document.querySelector('[data-open-onboarding]')?.addEventListener('click', () => {
		setTimeout(() => document.querySelector('[data-onboarding-wizard] h1')?.focus(), 0);
	});
}

export function bindAccountControls(config, identity, backend, context) {
	document.addEventListener('click', async (event) => {
		const control = event.target.closest('[data-open-setup], [data-start-new-setup]');
		if (!control) return;
		event.preventDefault();
		try {
			control.disabled = true;
			clearNotice();
			await context.wizard.startNew();
			location.hash = 'setup';
			startSetupAvailabilityPolling(context);
		} catch (error) {
			showError(error);
		} finally {
			control.disabled = false;
		}
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
			if (
				context.state.setups?.some(
					(setup) => setup.requestId === requestId && setup.kind === 'trial',
				)
			)
				rememberTrialCheckoutReturn(accountId, requestId);
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
	document.querySelector('[data-service-detail]')?.addEventListener('click', async (event) => {
		const control = event.target.closest('[data-resume-service]');
		if (!control) return;
		try {
			control.disabled = true;
			const serviceId = required(control.dataset.resumeService);
			const service = context.state.services?.find((item) => item.serviceId === serviceId);
			const setup = context.state.setups?.find((item) => item.serviceId === serviceId);
			await context.wizard.openService(serviceId, {
				requestId: setup?.requestId || null,
				planCode: setup?.planCode || service?.planCode || '',
				setupMode: setup?.kind || '',
				siteType: service?.siteType || setup?.siteType || '',
				intent: service?.intent || setup?.intent || '',
			});
			location.hash = 'setup';
		} catch (error) {
			showError(error);
		} finally {
			control.disabled = false;
		}
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
				if (!result?.retainKey && !preserveKeyUntilAttachmentsUpload)
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
	if (action === 'email-change') {
		await identity.updateEmail(required(data.email), config.callbackUrl);
		return { message: 'Follow the confirmation instructions sent to your email addresses.' };
	}
	if (action === 'password-change') {
		await identity.updatePassword(passwordValue(data.password));
		return { message: 'Password changed.' };
	}
	const accountId = required(context.accountId);
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
	void syncAnalyticsAttribution(context);
	renderCustomerState(
		{ identity: sessionState.identity, accounts: context.accounts, selectedAccountId: accountId },
		context,
	);
	if (accountId) await loadAccountState(backend, context, accountId, ++context.accountRequestToken);
}

export function syncAnalyticsAttribution(context) {
	if (!context.accountId || !context.analytics?.configured) return Promise.resolve();
	const run = async () => {
		const accountId = context.accountId;
		const analyticsConsent = context.analytics.consent();
		const consentVersion = context.analyticsConsentVersion || 0;
		const key = `${accountId}.${analyticsConsent}.${consentVersion}`;
		if (context.analyticsAttributionLastKey === key) return;
		try {
			const identifiers = analyticsConsent ? await context.analytics.identifiers() : {};
			if (
				accountId !== context.accountId ||
				analyticsConsent !== context.analytics.consent() ||
				consentVersion !== (context.analyticsConsentVersion || 0)
			)
				return;
			const result = await context.backend.updateAnalyticsAttribution(accountId, {
				analyticsConsent,
				...identifiers,
				...(analyticsConsent ? { capturedAt: new Date().toISOString() } : {}),
			});
			context.analyticsAttributionLastKey = key;
			if (analyticsConsent) context.analytics.storeRevocationToken(result?.revokeToken);
			else context.analytics.clearRevocationToken();
		} catch {
			// Attribution must never interrupt a signed-in customer's account workflow.
		}
	};
	context.analyticsAttributionChain = (context.analyticsAttributionChain || Promise.resolve()).then(
		run,
		run,
	);
	return context.analyticsAttributionChain;
}

async function selectCustomerAccount(backend, context, accountId) {
	const token = ++context.accountRequestToken;
	context.accountContextToken += 1;
	context.checkoutRequestToken += 1;
	context.accountId = accountId;
	void syncAnalyticsAttribution(context);
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
	_accountId = context.accountId,
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
	document
		.querySelector('[data-account-switcher]')
		?.classList.toggle('u-hidden', accounts.length < 2);
	document
		.querySelector('[data-support-account-required]')
		?.classList.toggle('u-hidden', !needsAccount);
	document.querySelector('[data-support-actions]')?.classList.toggle('u-hidden', needsAccount);
	document.querySelector('[data-setup-load-failure]')?.toggleAttribute('hidden', true);
	document.querySelector('[data-onboarding-wizard]')?.toggleAttribute('hidden', false);
	populateSelect('[data-account-select]', accounts, {
		value: (row) => row.accountId,
		label: (row) => row.displayName || 'Customer account',
		selected: context.accountId,
		empty: 'No customer account',
	});
	renderServices(context.state.services || [], context);
	renderSetups(context.state.setups || [], context);
	void context.wizard?.update({
		accountId: context.accountId,
		offers: context.state.offers || [],
		trialEligibility: context.state.trialEligibility,
		setups: context.state.setups || [],
	});
	renderBilling(context.state.billing || [], context);
	reconcileTrialCheckoutReturn(context);
	restoreFormDraft(
		document.querySelector('[data-account-action="support-open"]'),
		'support-open',
		context,
	);
	startSetupPolling(context);
}

export function reconcileTrialCheckoutReturn(context) {
	let remembered;
	try {
		remembered = sessionStorage.getItem(trialCheckoutReturnKey);
	} catch {
		return;
	}
	if (!remembered || !context.accountId) return;
	const [accountId, requestId] = remembered.split(':');
	if (accountId !== context.accountId || !requestId) return;
	const setup = context.state.setups?.find((row) => row.requestId === requestId);
	if (!setup || !terminalSetup(setup.status)) return;
	try {
		sessionStorage.removeItem(trialCheckoutReturnKey);
	} catch {
		// The terminal setup state remains visible in Hosting.
	}
	if (setup.failureReason === 'trial_capacity_full') {
		location.hash = 'setup';
		showNotice(setupMessage(setup));
	}
}

function rememberTrialCheckoutReturn(accountId, requestId) {
	try {
		sessionStorage.setItem(trialCheckoutReturnKey, `${accountId}:${requestId}`);
	} catch {
		// Card setup can continue when browser storage is unavailable.
	}
}

export function renderInitialCustomerStateFailure(context) {
	context.initialStateUnavailable = true;
	context.accountId = '';
	context.accounts = [];
	context.state = emptyState();
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
	document.querySelector('[data-onboarding-wizard]')?.toggleAttribute('hidden', true);
	document.querySelector('[data-setup-load-failure]')?.toggleAttribute('hidden', false);
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
	document.querySelector('[data-support-layout]')?.toggleAttribute('hidden', false);
	renderSupportDetail({}, context);
	document.querySelector('[data-setup-load-failure]')?.toggleAttribute('hidden', false);
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

function renderServiceDetail(service, _context) {
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
	if (service.nativeAccess?.providerUsername)
		appendDetail(details, 'SFTP username', service.nativeAccess.providerUsername);
	if (service.nativeAccess?.sftpHostname)
		appendDetail(
			details,
			'SFTP host',
			`${service.nativeAccess.sftpHostname}:${service.nativeAccess.sftpPort || 22}`,
		);
	target.append(details);
	const resume = element(
		'button',
		{ className: 'button button-secondary' },
		'Continue website setup',
	);
	resume.type = 'button';
	resume.dataset.resumeService = service.serviceId;
	target.append(resume);
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

function focusServiceDetail() {
	const heading = document.querySelector('[data-service-detail] h3');
	if (!heading) return;
	heading.tabIndex = -1;
	heading.focus();
}

function prepareFormRequest(form, data, context) {
	const action = form.dataset.accountAction || '';
	form.dataset.requestKey = requestKeyScope(action, context);
	if (['support-open', 'support-reply'].includes(action)) {
		submissionKeys.save(form, {
			userId: context.userId,
			accountId: context.accountId,
			supportCaseId: context.supportCaseId,
			values: data,
		});
	}
}

function usesDurableFormDraft(action) {
	return ['support-open', 'support-reply'].includes(action);
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
	if (
		submission.accountId !== context.accountId ||
		submission.accountContextToken !== context.accountContextToken
	)
		return false;
	if (['support-reply', 'support-close'].includes(submission.action))
		return submission.supportCaseId === context.supportCaseId;
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
	if (action === 'support-open') return `support-open:${identity}:${account}`;
	if (action === 'support-reply' || action === 'support-close')
		return `${action}:${identity}:${account}:${supportCase}`;
	return `${action}:${identity}:${account}`;
}

function scopePart(value) {
	return encodeURIComponent(String(value));
}

export function renderBilling(billing, context) {
	const target = document.querySelector('[data-billing-summary]');
	const portal = document.querySelector('[data-billing-portal]');
	if (!target || !portal) return;
	target.replaceChildren();
	const rows = Array.isArray(billing) ? billing : billing ? [billing] : [];
	if (!rows.length) {
		const pending = context.state.setups?.some((setup) => pendingSetup(setup.status));
		target.append(
			element(
				'p',
				{ className: 'customer-empty' },
				pending ? 'Your hosting setup is still in progress.' : 'No current subscription.',
			),
		);
		if (context.accountId) {
			const link = element(
				'a',
				{ className: 'button button-secondary' },
				pending ? 'View setup status' : 'Add hosting',
			);
			link.href = pending ? '#hosting' : '#setup';
			if (!pending) link.dataset.startNewSetup = '';
			target.append(link);
		}
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

export function renderSupportCases(cases, context) {
	const target = document.querySelector('[data-support-case-list]');
	if (!target) return;
	document.querySelector('[data-support-retry]')?.toggleAttribute('hidden', true);
	document
		.querySelector('[data-support-layout]')
		?.toggleAttribute(
			'hidden',
			!cases.length &&
				!context.supportSearch &&
				!context.supportHasMore &&
				context.supportPage === 1 &&
				!new URLSearchParams(location.search).has('ticket'),
		);
	target.replaceChildren();
	if (!cases.length) {
		context.supportCaseId = '';
		target.append(
			element(
				'p',
				{ className: 'customer-empty' },
				context.supportSearch ? 'No cases match your search.' : 'No support cases yet.',
			),
		);
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
	document.querySelector('[data-support-layout]')?.toggleAttribute('hidden', false);
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
	if (
		Date.now() >= context.pollDeadline ||
		document.hidden ||
		!['hosting', 'setup'].includes(currentView())
	)
		return;
	context.pollTimer = setInterval(async () => {
		if (
			Date.now() >= context.pollDeadline ||
			document.hidden ||
			!['hosting', 'setup'].includes(currentView())
		) {
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

function startSetupAvailabilityPolling(context) {
	clearInterval(context.setupAvailabilityTimer);
	if (!context.accountId || document.hidden || currentView() !== 'setup') return;
	void refreshSetupAvailability(context).catch(() => {});
	context.setupAvailabilityTimer = setInterval(() => {
		if (document.hidden || currentView() !== 'setup') {
			clearInterval(context.setupAvailabilityTimer);
			return;
		}
		void refreshSetupAvailability(context).catch(() => {});
	}, 10000);
}

async function refreshSetupAvailability(context) {
	if (!context.accountId) return;
	if (context.setupAvailabilityPromise) return context.setupAvailabilityPromise;
	const accountId = context.accountId;
	context.setupAvailabilityPromise = (async () => {
		const state = await context.backend.accountState(accountId);
		if (accountId !== context.accountId) return;
		context.state.offers = state.offers || [];
		context.state.trialEligibility = state.trialEligibility;
		void context.wizard?.update({
			offers: context.state.offers,
			trialEligibility: context.state.trialEligibility,
		});
	})();
	try {
		await context.setupAvailabilityPromise;
	} finally {
		context.setupAvailabilityPromise = undefined;
	}
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
	if (setup.failureReason === 'trial_capacity_full')
		return 'Trials filled before your setup started. Choose another option or try again later. No charge was made.';
	if (setup.status === 'import_ready') return 'Your website is ready for import.';
	if (action === 'continue_checkout') return 'Checkout is ready to continue.';
	if (action === 'view_service') return 'Hosting is ready.';
	if (action === 'start_new_setup') return 'This setup ended. You can start a new one.';
	if (setup.status === 'provisioning') return 'Your hosting is being prepared.';
	if (setup.status === 'preparing') return 'Your setup is being prepared.';
	return readableStatus(setup.status);
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
	if (message === 'trial_capacity_full')
		return 'Trials filled before your setup started. Choose another option or try again later.';
	if (message === 'upstream_rejected')
		return 'That request could not be completed. Review the details and try again.';
	return message || 'The request could not be completed.';
}
