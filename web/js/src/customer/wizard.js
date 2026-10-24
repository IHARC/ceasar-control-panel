import { domainConnectionView } from './domain.js';

const steps = ['website', 'account', 'hosting', 'preparation', 'website-setup', 'domain', 'ready'];

const choices = [
	[
		'wordpress-new',
		'Create a WordPress website',
		'Install standard WordPress. Choose its design and edit pages in WordPress.',
	],
	[
		'wordpress-move',
		'Move a WordPress website',
		'Prepare a destination, then transfer your existing content, users, plugins, and themes.',
	],
	[
		'php-import',
		'Import a PHP website',
		'Move your existing PHP files and database into a prepared workspace.',
	],
	[
		'php-static',
		'Set up PHP or static files',
		'Start with hosting and upload files through the file manager or SFTP.',
	],
];

export function websiteSelection(setupKind) {
	switch (setupKind) {
		case 'wordpress-new':
			return { intent: 'new_site', siteType: 'wordpress' };
		case 'wordpress-move':
			return { intent: 'migration', siteType: 'wordpress' };
		case 'php-import':
			return { intent: 'migration', siteType: 'php' };
		case 'php-static':
			return { intent: 'new_site', siteType: 'php' };
		default:
			throw new Error('Choose what you want to do with your website.');
	}
}

export function trialAllowed(setupKind, capabilities) {
	return capabilities?.setupMethods?.[setupKind]?.trial === true;
}

function initialDraft() {
	return {
		step: 'website',
		setupKind: '',
		intent: '',
		siteType: '',
		planCode: '',
		setupMode: '',
		websiteTitle: '',
		administratorEmail: '',
		importedAdministrator: '',
		hostname: '',
		domain: '',
		serviceId: '',
		requestId: '',
	};
}

function isReady(status) {
	return ['ready', 'active', 'import_ready'].includes(status);
}

function formatBytes(bytes) {
	if (!Number.isFinite(bytes) || bytes <= 0) return '';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
	return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(bytes / 1024 ** exponent)} ${units[exponent]}`;
}

function safeUrl(value) {
	try {
		const url = new URL(value);
		if (url.protocol === 'https:') return url.toString();
	} catch {
		/* A missing destination is handled in the UI. */
	}
	return '';
}

function make(tag, className = '', text = '') {
	const node = document.createElement(tag);
	if (className) node.className = className;
	node.textContent = text;
	return node;
}

function button(label, action, secondary = false) {
	const node = make('button', secondary ? 'button button-secondary' : 'button', label);
	node.type = 'button';
	node.dataset.wizardAction = action;
	return node;
}

function field(label, name, value = '', type = 'text') {
	const wrapper = make('div', 'customer-form-field');
	const caption = make('label', 'customer-form-label', label);
	const input = make('input', 'form-control');
	input.type = type;
	input.name = name;
	input.id = `wizard-${name}`;
	input.value = value || '';
	input.required = true;
	if (name === 'domain') {
		input.autocapitalize = 'off';
		input.spellcheck = false;
	}
	caption.htmlFor = input.id;
	wrapper.append(caption, input);
	return wrapper;
}

function actions(...nodes) {
	const wrapper = make('div', 'customer-wizard-actions');
	wrapper.append(...nodes);
	return wrapper;
}

function detail(label, value) {
	const row = make('div');
	row.append(make('dt', '', label), make('dd', '', value || '—'));
	return row;
}

export function createOnboardingWizard({
	root,
	provider,
	mode = 'managed',
	accountId = '',
	offers = [],
	trialEligibility = null,
	capabilities = {},
	onCommit,
	onCreateAccount,
	onRefreshOffers,
	onUpdate,
	onError,
}) {
	if (!root) throw new Error('Onboarding view is missing.');
	const state = {
		accountId,
		offers,
		trialEligibility,
		capabilities,
		draft: initialDraft(),
		accountName: '',
		progress: null,
		domain: null,
		busy: false,
		error: '',
		notice: '',
	};
	let loadId = 0;
	let save = Promise.resolve();
	let draftSaveTimer;
	function editingText() {
		const active = document.activeElement;
		return (
			root.contains(active) &&
			(active.tagName === 'TEXTAREA' ||
				(active.tagName === 'INPUT' && ['text', 'email', 'url'].includes(active.type)))
		);
	}

	function displayError(error) {
		state.error = error?.message || 'This step could not be completed. Try again.';
		onError?.(error);
		render();
	}

	async function persist() {
		if (!state.accountId || !provider.saveOnboarding) return;
		const account = state.accountId;
		const draft = { ...state.draft };
		save = save.catch(() => {}).then(() => provider.saveOnboarding(account, draft));
		await save;
	}

	function navigate(step) {
		state.draft.step = step;
		state.error = '';
		render(true);
		void persist().catch(displayError);
	}

	async function load() {
		const id = ++loadId;
		if (!state.accountId || !provider.readOnboarding) {
			render();
			return;
		}
		try {
			const result = await provider.readOnboarding(state.accountId);
			if (id !== loadId) return;
			state.capabilities = result?.capabilities || {};
			if (result?.draft && steps.includes(result.draft.step)) {
				state.draft = { ...state.draft, ...result.draft };
			}
			if (
				state.draft.serviceId &&
				steps.indexOf(state.draft.step) >= steps.indexOf('preparation')
			) {
				await refreshProgress();
			}
			render();
		} catch (error) {
			displayError(error);
		}
	}

	async function refreshProgress() {
		if (!state.draft.serviceId || !provider.serviceOnboarding) return;
		const account = state.accountId;
		const service = state.draft.serviceId;
		const progress = await provider.serviceOnboarding(account, service);
		if (account !== state.accountId || service !== state.draft.serviceId) return;
		state.progress = progress;
		if (isReady(progress?.status) || progress?.status === 'needs_action') state.notice = '';
		if (
			(isReady(progress?.status) || progress?.status === 'needs_action') &&
			state.draft.step === 'preparation'
		) {
			state.draft.step = 'website-setup';
			await persist();
		}
	}

	async function update({
		accountId: nextAccount,
		offers: nextOffers,
		trialEligibility: nextEligibility,
		setups,
	} = {}) {
		if (nextAccount !== undefined && nextAccount !== state.accountId) {
			if (state.accountId) {
				state.draft = initialDraft();
				state.accountName = '';
				state.domain = null;
				state.capabilities = {};
				state.notice = '';
				state.error = '';
			}
			state.accountId = nextAccount;
			state.progress = null;
			state.checkoutPending = false;
			state.migrationConfirming = false;
			render(true);
			await load();
		}
		if (nextOffers !== undefined) state.offers = nextOffers;
		if (nextEligibility !== undefined) state.trialEligibility = nextEligibility;
		const request = setups?.find((item) => item.requestId === state.draft.requestId);
		if (request) {
			state.checkoutPending =
				request.status === 'checkout' || request.nextAction === 'continue_checkout';
			if (request.serviceId && !state.draft.serviceId) {
				state.draft.serviceId = request.serviceId;
				void persist().catch(displayError);
				try {
					await refreshProgress();
				} catch (error) {
					state.error = error.message;
				}
			}
			if (request.failureReason === 'trial_capacity_full') {
				state.error =
					'The free trial filled during card setup. Review the available monthly option before continuing.';
				state.draft.step = 'hosting';
				state.draft.setupMode = '';
				void persist().catch(displayError);
			} else if (request.status === 'checkout') {
				state.notice = 'Complete secure card setup to continue. Your website choices are saved.';
			} else if (
				request.serviceId &&
				isReady(request.status) &&
				state.draft.step === 'preparation'
			) {
				state.draft.step = 'website-setup';
				void persist().catch(displayError);
			} else if (request.status === 'failed') {
				state.error =
					request.message || 'Preparation did not complete. Refresh status or contact support.';
			}
		}
		if (!editingText()) render();
	}

	async function openService(serviceId, setupKind = '') {
		state.draft.serviceId = serviceId;
		if (setupKind) state.draft.setupKind = setupKind;
		state.draft.step = 'preparation';
		await persist();
		await refreshProgress();
		render(true);
	}

	function normalizeHostingSelection() {
		if (mode === 'native' || state.draft.step !== 'hosting') return;
		const draft = state.draft;
		const previous = `${draft.planCode}:${draft.setupMode}`;
		if (!state.offers.some((offer) => offer.planCode === draft.planCode))
			draft.planCode = state.offers[0]?.planCode || '';
		const offer = state.offers.find((item) => item.planCode === draft.planCode);
		const method = state.capabilities.setupMethods?.[draft.setupKind];
		const trial =
			method?.trial === true &&
			state.trialEligibility?.canStartTrial === true &&
			offer?.trialAvailable === true;
		const paid = method?.paid === true && offer?.paidAvailable === true;
		if (
			(draft.setupMode === 'trial' && !trial) ||
			(draft.setupMode === 'paid' && !paid) ||
			!draft.setupMode
		)
			draft.setupMode = trial ? 'trial' : paid ? 'paid' : '';
		if (`${draft.planCode}:${draft.setupMode}` !== previous) void persist().catch(displayError);
	}

	function render(focus = false) {
		if (!focus && editingText()) return;
		normalizeHostingSelection();
		const step = state.draft.step;
		root.replaceChildren();
		const layout = make('div', 'customer-wizard-layout');
		const main = make('div', 'customer-wizard-main');
		const header = make('header', 'customer-wizard-header');
		const visibleSteps = mode === 'native' ? steps.filter((name) => name !== 'account') : steps;
		const index = visibleSteps.indexOf(step) + 1;
		const meter = make('p', 'customer-wizard-progress', `Step ${index} of ${visibleSteps.length}`);
		meter.setAttribute('aria-live', 'polite');
		const bar = make('progress');
		bar.max = visibleSteps.length;
		bar.value = index;
		bar.setAttribute('aria-label', 'Setup progress');
		const headings = {
			website: 'Your website',
			account: 'Your account',
			hosting: 'Hosting',
			preparation: 'Preparing your hosting',
			'website-setup': 'Website setup',
			domain: 'Your domain',
			ready: 'Ready',
		};
		const title = make('h1', 'customer-view-heading', headings[step]);
		title.tabIndex = -1;
		header.append(meter, bar, title);
		main.append(header);
		if (state.error) {
			const error = make('p', 'customer-wizard-error', state.error);
			error.setAttribute('role', 'alert');
			main.append(error);
		}
		if (state.notice) {
			const notice = make('p', 'customer-form-help', state.notice);
			notice.setAttribute('role', 'status');
			main.append(notice);
		}
		if (step === 'website') renderWebsite(main);
		if (step === 'account') renderAccount(main);
		if (step === 'hosting') renderHosting(main);
		if (step === 'preparation') renderPreparation(main);
		if (step === 'website-setup') renderWebsiteSetup(main);
		if (step === 'domain') renderDomain(main);
		if (step === 'ready') renderReady(main);
		const summary = make('aside', 'customer-wizard-summary');
		summary.append(make('h2', '', 'Your choices'));
		const list = make('dl', 'customer-detail-grid');
		list.append(
			detail(
				'Website',
				choices.find(([key]) => key === state.draft.setupKind)?.[1] || 'Choose a website',
			),
		);
		if (mode !== 'native') {
			list.append(
				detail(
					'Plan',
					state.offers.find((offer) => offer.planCode === state.draft.planCode)?.displayName ||
						state.draft.planCode ||
						'Choose a plan',
				),
				detail(
					'Payment',
					state.draft.setupMode === 'trial'
						? trialLabel(state.capabilities)
						: state.draft.setupMode === 'paid'
							? 'Monthly'
							: 'Choose an option',
				),
			);
		}
		if (mode === 'native' && state.draft.hostname)
			list.append(detail('Preview hostname', state.draft.hostname));
		if (state.draft.domain) list.append(detail('Domain', state.draft.domain));
		summary.append(list);
		layout.append(main, summary);
		root.append(layout);
		if (focus) title.focus();
	}

	function renderWebsite(main) {
		main.append(
			make(
				'p',
				'customer-view-intro',
				'Choose the best starting point. You can connect a domain after your website is ready.',
			),
		);
		const group = make('fieldset', 'customer-wizard-fieldset');
		group.append(make('legend', '', 'What would you like to do?'));
		const list = make('div', 'customer-choice-list');
		for (const [key, title, help] of choices.filter(
			([key]) =>
				!state.capabilities.setupMethods ||
				state.capabilities.setupMethods[key]?.trial ||
				state.capabilities.setupMethods[key]?.paid ||
				mode === 'native',
		)) {
			const label = make('label', 'customer-choice');
			const input = make('input');
			input.type = 'radio';
			input.name = 'setupKind';
			input.value = key;
			input.checked = state.draft.setupKind === key;
			const body = make('span');
			body.append(make('strong', '', title), make('span', '', help));
			label.append(input, body);
			list.append(label);
		}
		group.append(list);
		main.append(group, actions(button('Continue', 'website-next')));
	}

	function renderAccount(main) {
		if (state.accountId) {
			main.append(make('p', 'customer-view-intro', 'Your sign-in and customer account are ready.'));
			main.append(actions(button('Back', 'back', true), button('Continue', 'account-next')));
			return;
		}
		main.append(
			make(
				'p',
				'customer-view-intro',
				'Name your customer account. This name can be your own name or your organization.',
			),
		);
		main.append(field('Account name', 'accountName', state.accountName));
		main.append(
			actions(
				button('Back', 'back', true),
				button('Create account and continue', 'account-create'),
			),
		);
	}

	function renderHosting(main) {
		if (mode === 'native') {
			main.append(
				make(
					'p',
					'customer-view-intro',
					'Review your website details before preparing the hosting workspace.',
				),
			);
			main.append(field('Website hostname', 'hostname', state.draft.hostname));
			main.append(
				make(
					'p',
					'customer-form-help',
					'Use a hostname you control. You can connect this domain or add another domain after preparation.',
				),
			);
			if (state.draft.setupKind === 'php-static') {
				const type = make('div', 'customer-form-field');
				const caption = make('label', 'customer-form-label', 'Website type');
				caption.htmlFor = 'wizard-site-type';
				const selectType = make('select', 'form-select');
				selectType.name = 'siteType';
				selectType.id = 'wizard-site-type';
				for (const [value, label] of [
					['php', 'PHP application'],
					['static', 'Static files'],
				]) {
					const option = make('option', '', label);
					option.value = value;
					selectType.append(option);
				}
				selectType.value = state.draft.siteType;
				type.append(caption, selectType);
				main.append(type);
			}
			if (state.draft.siteType === 'wordpress') {
				main.append(field('Website title', 'websiteTitle', state.draft.websiteTitle));
				main.append(
					field(
						'Administrator email',
						'administratorEmail',
						state.draft.administratorEmail,
						'email',
					),
				);
			}
			main.append(
				actions(button('Back', 'back', true), button('Prepare website', 'hosting-commit')),
			);
			return;
		}
		main.append(
			make(
				'p',
				'customer-view-intro',
				'Choose a hosting plan and review its terms before secure card setup.',
			),
		);
		const plan = make('div', 'customer-form-field');
		const label = make('label', 'customer-form-label', 'Plan');
		label.htmlFor = 'wizard-plan';
		const select = make('select', 'form-select');
		select.name = 'planCode';
		select.id = 'wizard-plan';
		for (const offer of state.offers) {
			const option = make(
				'option',
				'',
				`${offer.displayName || offer.planCode} — ${money(offer)}/month`,
			);
			option.value = offer.planCode;
			select.append(option);
		}
		if (!state.offers.length) select.append(make('option', '', 'No plans available'));
		select.value = state.draft.planCode || state.offers[0]?.planCode || '';
		plan.append(label, select);
		const offer = state.offers.find((item) => item.planCode === select.value);
		const limits = offerLimits(offer);
		if (limits) plan.append(make('p', 'customer-form-help', limits));
		main.append(plan);
		const group = make('fieldset', 'customer-wizard-fieldset');
		group.append(make('legend', '', 'How would you like to start?'));
		const list = make('div', 'customer-choice-list');
		const method = state.capabilities.setupMethods?.[state.draft.setupKind];
		const trial =
			trialAllowed(state.draft.setupKind, state.capabilities) &&
			state.trialEligibility?.canStartTrial === true &&
			offer?.trialAvailable === true;
		const paid = method?.paid === true && offer?.paidAvailable === true;
		if (trial)
			list.append(
				modeChoice(
					'trial',
					`Start ${trialLabel(state.capabilities).toLowerCase()}`,
					'A card is required. The trial starts when your hosting and setup tools are ready.',
				),
			);
		if (paid) list.append(modeChoice('paid', 'Pay monthly', 'Continue to secure checkout.'));
		if (!trial && !paid)
			list.append(
				make(
					'p',
					'customer-wizard-error',
					'This plan is unavailable right now. Choose another plan or return later.',
				),
			);
		if (
			state.trialEligibility?.reason === 'trial_capacity_full' &&
			trialAllowed(state.draft.setupKind, state.capabilities)
		)
			list.append(
				make(
					'p',
					'customer-form-help',
					'Trial places are currently full. Monthly hosting may still be available.',
				),
			);
		group.append(list);
		main.append(group);
		if (state.draft.setupKind === 'wordpress-new') {
			main.append(field('Website title', 'websiteTitle', state.draft.websiteTitle));
			main.append(
				field(
					'WordPress administrator email',
					'administratorEmail',
					state.draft.administratorEmail,
					'email',
				),
			);
			main.append(
				make(
					'p',
					'customer-form-help',
					'These details are used when standard WordPress is installed.',
				),
			);
		}
		if (state.draft.setupKind === 'php-static') {
			const type = make('div', 'customer-form-field');
			const caption = make('label', 'customer-form-label', 'Website type');
			caption.htmlFor = 'wizard-site-type';
			const selectType = make('select', 'form-select');
			selectType.name = 'siteType';
			selectType.id = 'wizard-site-type';
			for (const [value, label] of [
				['php', 'PHP application'],
				['static', 'Static files'],
			]) {
				const option = make('option', '', label);
				option.value = value;
				selectType.append(option);
			}
			selectType.value = state.draft.siteType;
			type.append(caption, selectType);
			main.append(type);
		}
		const review = make('section', 'customer-wizard-review');
		review.append(make('h2', '', 'Review before continuing'));
		const details = make('dl', 'customer-setup-review');
		details.append(
			detail('Website', choices.find(([key]) => key === state.draft.setupKind)?.[1]),
			detail(
				'Plan',
				`${offer?.displayName || offer?.planCode || 'Choose a plan'}${limits ? ` — ${limits}` : ''}`,
			),
			detail(
				'Billing',
				state.draft.setupMode === 'trial'
					? `${trialLabel(state.capabilities)}, then ${money(offer)}/month plus applicable taxes unless cancelled before it ends.`
					: `${money(offer)}/month plus applicable taxes.`,
			),
		);
		review.append(details);
		main.append(review);
		main.append(
			actions(
				button('Back', 'back', true),
				button('Continue to secure card setup', 'hosting-commit'),
			),
		);
	}

	function modeChoice(value, title, help) {
		const label = make('label', 'customer-choice');
		const input = make('input');
		input.type = 'radio';
		input.name = 'setupMode';
		input.value = value;
		input.checked = state.draft.setupMode === value;
		const body = make('span');
		body.append(make('strong', '', title), make('span', '', help));
		label.append(input, body);
		return label;
	}

	function renderPreparation(main) {
		main.append(
			make(
				'p',
				'customer-view-intro',
				'Your choices are saved. You can close this page and return later.',
			),
		);
		const progress = state.progress;
		const stages =
			mode === 'native'
				? ['Hosting workspace', 'Website preparation', 'Ready for your next step']
				: ['Card setup', 'Hosting allocation', 'Website preparation', 'Ready for your next step'];
		const list = make('ol', 'customer-wizard-stages');
		for (const stage of stages) list.append(make('li', '', stage));
		main.append(list);
		if (progress?.stage) {
			const stage = make(
				'h2',
				'customer-wizard-current-stage',
				`Current stage: ${String(progress.stage).replaceAll(/[_-]+/g, ' ')}`,
			);
			stage.setAttribute('aria-live', 'polite');
			main.append(stage);
		}
		main.append(
			make(
				'p',
				progress?.status === 'failed' ? 'customer-wizard-error' : 'customer-form-help',
				progress?.message || state.notice || 'Waiting for hosting progress.',
			),
		);
		if (progress?.nextAction) {
			const instruction =
				{
					continue_checkout: 'Continue secure card setup.',
					contact_support: 'Contact support with the setup details shown here.',
					support: 'Contact support with the setup details shown here.',
					retry: 'Review the error, then retry this step.',
					wait: 'Preparation is running. Refresh to see the latest stage.',
					confirm_migration: 'Complete the restore and check the website.',
					domain: 'Connect your domain when you are ready.',
				}[progress.nextAction] || 'Refresh progress to see the next step.';
			main.append(make('p', 'customer-form-help', instruction));
		}
		main.append(
			actions(
				...(state.checkoutPending ? [button('Continue secure card setup', 'resume-checkout')] : []),
				button('Refresh progress', 'refresh-progress'),
				...(progress?.status === 'failed' &&
				progress.nextAction === 'retry' &&
				provider.retryOnboarding
					? [button('Retry preparation', 'retry-preparation')]
					: []),
				...(progress?.status === 'failed' ? [button('Contact support', 'support', true)] : []),
				button('Back to hosting', 'back', true),
			),
		);
	}

	function renderWebsiteSetup(main) {
		const kind = state.draft.setupKind;
		const progress = state.progress;
		if (progress?.message) {
			const status = make('p', 'customer-form-help', progress.message);
			status.setAttribute('role', 'status');
			main.append(status);
		}
		if (progress?.previewUrl && safeUrl(progress.previewUrl)) {
			const preview = make('a', 'button button-secondary', 'Preview website');
			preview.href = safeUrl(progress.previewUrl);
			preview.target = '_blank';
			preview.rel = 'noopener';
			main.append(preview);
		}
		if (kind === 'wordpress-new') {
			main.append(
				make(
					'p',
					'customer-view-intro',
					'Standard WordPress is installed. Use its editor to make your site your own.',
				),
			);
			main.append(
				actions(
					button('Edit WordPress', 'wordpress-access'),
					button('Continue to domain', 'website-next', true),
				),
			);
		} else if (kind === 'wordpress-move') {
			main.append(
				make(
					'p',
					'customer-view-intro',
					'Install WPvivid Backup & Migration on your source and destination. Transfer and restore through WPvivid, then check the imported website before changing DNS.',
				),
			);
			const list = make('ol', 'customer-wizard-stages');
			for (const line of [
				'Open the destination WordPress dashboard.',
				'Install WPvivid on both websites and follow its supported transfer steps.',
				'If direct transfer fails, upload a WPvivid backup at the destination.',
				'Check pages, users, plugins, themes, storage and links before confirming.',
			])
				list.append(make('li', '', line));
			main.append(list);
			const guide = make('a', 'customer-wizard-guide', 'Read the WPvivid migration guide');
			guide.href = 'https://docs.wpvivid.com/migration-site-a-to-site-b-via-local.html';
			guide.target = '_blank';
			guide.rel = 'noopener';
			main.append(guide);
			const offer = state.offers.find((item) => item.planCode === state.draft.planCode);
			main.append(
				make(
					'p',
					'customer-form-help',
					offer?.storageBytes
						? `This plan includes ${formatBytes(offer.storageBytes)} storage. Check that your source files and backup fit before transfer.`
						: 'Check available destination storage before transfer.',
				),
			);
			main.append(
				make(
					'p',
					'customer-form-help',
					state.capabilities.phpVersion
						? `The destination uses PHP ${state.capabilities.phpVersion}. Check your source plugins and themes for compatibility; contact support if they need a different version.`
						: 'Check your source PHP version, plugins, and themes against the destination before transfer. Contact support if compatibility is unclear.',
				),
			);
			if (progress?.stage === 'verified') {
				main.append(
					field(
						'Imported administrator username or email',
						'importedAdministrator',
						state.draft.importedAdministrator,
					),
				);
				main.append(
					make(
						'p',
						'customer-form-help',
						'Select an existing administrator from the imported website. No additional administrator is created.',
					),
				);
			} else
				main.append(
					make(
						'p',
						'customer-form-help',
						'Complete the transfer and restore in WPvivid, then confirm below. Ceasar checks that WordPress is usable. Access then uses an administrator from the imported website.',
					),
				);
			main.append(
				actions(
					button(
						progress?.stage === 'verified'
							? 'Open imported WordPress'
							: 'Open destination WordPress',
						'wordpress-access',
					),
					...(progress?.stage === 'verified' || state.migrationConfirming
						? []
						: [button('Restore complete — check website', 'migration-confirm', true)]),
					...(progress?.stage === 'verified'
						? [button('Continue to domain', 'website-next', true)]
						: [button('Refresh verification', 'refresh-progress', true)]),
				),
			);
		} else {
			main.append(
				make(
					'p',
					'customer-view-intro',
					kind === 'php-import'
						? 'Upload your PHP files and database to the prepared workspace, then test the preview before switching DNS.'
						: 'Use the file manager or SFTP to upload PHP or static files. Database tools are available when your plan includes a database.',
				),
			);
			main.append(
				actions(
					button('Manage files and database', 'hosting-access'),
					...(kind === 'php-import' && !isReady(progress?.status)
						? [button('Confirm import is complete', 'migration-confirm', true)]
						: []),
					...(kind !== 'php-import' || isReady(progress?.status)
						? [button('Continue to domain', 'website-next', true)]
						: [button('Refresh verification', 'refresh-progress', true)]),
				),
			);
		}
	}

	function renderDomain(main) {
		main.append(
			make(
				'p',
				'customer-view-intro',
				'Connect a domain you own, or keep using the preview address for now. Change DNS only after your website is ready. Keep existing mail records.',
			),
		);
		main.append(field('Your domain', 'domain', state.draft.domain));
		const records = state.domain?.records || [];
		if (records.length) {
			const heading = make('h2', '', 'DNS records to add');
			main.append(heading);
			const table = make('div', 'customer-wizard-dns');
			for (const record of records) {
				const row = make('div', 'customer-wizard-dns-row');
				row.append(
					make('strong', '', `${record.type} ${record.name}`),
					make('code', '', record.value),
				);
				const copy = button('Copy value', 'copy-dns', true);
				copy.setAttribute('aria-label', `Copy ${record.type} record for ${record.name}`);
				copy.dataset.copyValue = record.value;
				row.append(copy);
				table.append(row);
			}
			main.append(table);
		}
		if (state.domain?.message) main.append(make('p', 'customer-form-help', state.domain.message));
		for (const check of state.domain?.checks || [])
			main.append(make('p', 'customer-form-help', check));
		if (state.domain?.certificateStatus)
			main.append(
				make('p', 'customer-form-help', `Certificate: ${state.domain.certificateStatus}`),
			);
		main.append(
			actions(
				button('Back', 'back', true),
				button('Check DNS', 'domain-check'),
				button('Connect domain', 'domain-connect'),
				button('Use preview address for now', 'domain-skip', true),
			),
		);
	}

	function renderReady(main) {
		main.append(
			make(
				'p',
				'customer-view-intro',
				'Your hosting is ready. You can return to these tools whenever you need them.',
			),
		);
		const rows = actions(
			button('Open hosting controls', 'hosting-access'),
			...(state.draft.siteType === 'wordpress'
				? [button('Edit WordPress', 'wordpress-access')]
				: []),
			button('Domain settings', 'domain-back', true),
			...(mode === 'managed' ? [button('Billing', 'billing', true)] : []),
			button('Support', 'support', true),
		);
		if (state.progress?.previewUrl && safeUrl(state.progress.previewUrl)) {
			const preview = make('a', 'button button-secondary', 'Preview website');
			preview.href = safeUrl(state.progress.previewUrl);
			preview.target = '_blank';
			preview.rel = 'noopener';
			rows.prepend(preview);
		}
		main.append(rows);
	}

	async function handleAction(action, target) {
		if (state.busy) return;
		state.error = '';
		const draft = state.draft;
		if (action === 'website-next') {
			if (draft.step === 'website') {
				const choice = root.querySelector('[name=setupKind]:checked')?.value;
				if (!choice) {
					displayError(new Error('Choose what you want to do with your website.'));
					return;
				}
				Object.assign(draft, { setupKind: choice, ...websiteSelection(choice), setupMode: '' });
				navigate(mode === 'native' ? 'hosting' : 'account');
			} else navigate('domain');
			return;
		}
		if (action === 'back') {
			const sequence = mode === 'native' ? steps.filter((name) => name !== 'account') : steps;
			navigate(sequence[Math.max(0, sequence.indexOf(draft.step) - 1)]);
			return;
		}
		if (action === 'account-next') {
			navigate('hosting');
			return;
		}
		if (action === 'domain-back') {
			navigate('domain');
			return;
		}
		if (action === 'domain-skip') {
			navigate('ready');
			return;
		}
		if (action === 'billing' || action === 'support') {
			if (mode === 'native') location.assign('/list/support/');
			else location.hash = action;
			return;
		}
		if (action === 'copy-dns') {
			try {
				await navigator.clipboard.writeText(target.dataset.copyValue);
				state.notice = 'DNS value copied.';
				render();
			} catch {
				displayError(new Error('Copy failed. Select the DNS value and copy it manually.'));
			}
			return;
		}
		state.busy = true;
		target.disabled = true;
		try {
			if (action === 'account-create') {
				const name = root.querySelector('[name=accountName]')?.value.trim();
				if (!name) throw new Error('Enter an account name.');
				state.accountId = await onCreateAccount?.(name);
				if (!state.accountId) throw new Error('The account could not be created.');
				draft.step = 'hosting';
				await persist();
				render(true);
				onUpdate?.();
			} else if (action === 'hosting-commit') {
				if (mode === 'native') {
					if (draft.setupKind === 'php-static')
						draft.siteType = root.querySelector('[name=siteType]')?.value || 'php';
					draft.hostname = root.querySelector('[name=hostname]')?.value.trim().toLowerCase() || '';
					draft.websiteTitle = root.querySelector('[name=websiteTitle]')?.value.trim() || '';
					draft.administratorEmail =
						root.querySelector('[name=administratorEmail]')?.value.trim() || '';
					if (!/^[a-z0-9][a-z0-9.-]{1,251}[a-z0-9]$/.test(draft.hostname))
						throw new Error('Enter a valid website hostname.');
					if (draft.siteType === 'wordpress' && (!draft.websiteTitle || !draft.administratorEmail))
						throw new Error('Enter a website title and administrator email.');
					await persist();
					const result = await onCommit({ ...draft, accountId: state.accountId });
					draft.serviceId = result.serviceId || result.hostname || draft.hostname;
					draft.requestId = result.operationId || draft.requestId;
					state.progress = result;
					navigate('preparation');
					return;
				}
				draft.planCode = root.querySelector('[name=planCode]')?.value || '';
				draft.setupMode = root.querySelector('[name=setupMode]:checked')?.value || '';
				if (draft.setupKind === 'wordpress-new') {
					draft.websiteTitle = root.querySelector('[name=websiteTitle]')?.value.trim() || '';
					draft.administratorEmail =
						root.querySelector('[name=administratorEmail]')?.value.trim() || '';
					if (!draft.websiteTitle || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.administratorEmail))
						throw new Error('Enter a website title and valid administrator email.');
				}
				if (draft.setupKind === 'php-static')
					draft.siteType = root.querySelector('[name=siteType]')?.value || 'php';
				const offer = state.offers.find((item) => item.planCode === draft.planCode);
				if (!offer) throw new Error('Choose an available plan.');
				if (!['trial', 'paid'].includes(draft.setupMode))
					throw new Error('Choose a trial or monthly option.');
				if (
					draft.setupMode === 'trial' &&
					(!trialAllowed(draft.setupKind, state.capabilities) ||
						state.trialEligibility?.canStartTrial !== true ||
						offer.trialAvailable !== true)
				)
					throw new Error(
						'The free trial is no longer available. Review the monthly option before continuing.',
					);
				if (
					draft.setupMode === 'paid' &&
					(state.capabilities.setupMethods?.[draft.setupKind]?.paid !== true ||
						offer.paidAvailable !== true)
				)
					throw new Error('Monthly hosting is unavailable for this plan.');
				const latest = await onRefreshOffers?.();
				if (latest) {
					state.offers = latest.offers || state.offers;
					state.trialEligibility = latest.trialEligibility || state.trialEligibility;
				}
				const fresh = state.offers.find((item) => item.planCode === draft.planCode);
				if (
					draft.setupMode === 'trial' &&
					(state.trialEligibility?.canStartTrial !== true || fresh?.trialAvailable !== true)
				)
					throw new Error('The free trial filled. Review the monthly option before continuing.');
				if (draft.setupMode === 'paid' && fresh?.paidAvailable !== true)
					throw new Error('Monthly hosting is unavailable for this plan.');
				await persist();
				const result = await onCommit({ ...draft, accountId: state.accountId });
				draft.requestId = result?.requestId || draft.requestId;
				draft.serviceId = result?.serviceId || draft.serviceId;
				state.notice = result?.message || 'Your hosting request is in progress.';
				if (result?.checkoutUrl) {
					draft.step = 'preparation';
					await persist();
					const url = safeUrl(result.checkoutUrl);
					if (!url) throw new Error('The billing provider returned an invalid link.');
					location.assign(url);
				} else navigate('preparation');
			} else if (action === 'retry-preparation') {
				if (!provider.retryOnboarding || !state.progress?.operationId)
					throw new Error('Refresh progress before retrying.');
				await provider.retryOnboarding(
					state.accountId,
					draft.serviceId,
					state.progress.operationId,
				);
				await refreshProgress();
				render();
			} else if (action === 'refresh-progress') {
				await refreshProgress();
				onUpdate?.();
				render();
			} else if (action === 'resume-checkout') {
				if (!provider.setupCheckout || !draft.requestId)
					throw new Error('Card setup is not available yet. Refresh progress.');
				const checkout = await provider.setupCheckout(state.accountId, draft.requestId);
				const url = safeUrl(checkout.checkoutUrl);
				if (!url) throw new Error('The billing provider returned an invalid link.');
				location.assign(url);
			} else if (action === 'hosting-access' || action === 'wordpress-access') {
				const userId =
					draft.setupKind === 'wordpress-move'
						? root.querySelector('[name=importedAdministrator]')?.value.trim() || ''
						: '';
				if (
					action === 'wordpress-access' &&
					draft.setupKind === 'wordpress-move' &&
					state.progress?.stage === 'verified' &&
					!userId
				)
					throw new Error('Select an existing imported administrator first.');
				if (userId) {
					draft.importedAdministrator = userId;
					await persist();
				}
				const access =
					action === 'hosting-access'
						? await provider.hostingAccess(state.accountId, draft.serviceId)
						: await provider.wordpressAccess(state.accountId, draft.serviceId, userId);
				openAccess(access);
			} else if (action === 'migration-confirm') {
				const operationId = state.progress?.operationId;
				if (draft.setupKind === 'php-import' && !operationId)
					throw new Error('Wait until the import workspace is ready.');
				state.migrationConfirmKey ||= crypto.randomUUID();
				const result = await provider.confirmMigration(draft.serviceId, {
					accountId: state.accountId,
					...(draft.setupKind === 'php-import' ? { workspaceReadyOperationId: operationId } : {}),
					idempotencyKey: state.migrationConfirmKey,
				});
				state.progress = result?.stage ? result : state.progress;
				state.migrationConfirming = true;
				await refreshProgress();
				state.notice =
					'Migration verification requested. Check the preview before switching your domain.';
				render();
			} else if (action === 'domain-check' || action === 'domain-connect') {
				const domain = root.querySelector('[name=domain]')?.value.trim().toLowerCase() || '';
				if (
					!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(
						domain,
					)
				)
					throw new Error('Enter a valid domain such as example.com.');
				draft.domain = domain;
				await persist();
				state.domainConnectKeys ||= new Map();
				if (!state.domainConnectKeys.has(domain))
					state.domainConnectKeys.set(domain, crypto.randomUUID());
				state.domain = domainConnectionView(
					action === 'domain-check'
						? await provider.domainStatus(state.accountId, draft.serviceId, domain)
						: await provider.connectDomain(
								state.accountId,
								draft.serviceId,
								domain,
								state.domainConnectKeys.get(domain),
							),
				);
				if (['ready', 'connected'].includes(state.domain?.status)) navigate('ready');
				else render();
			}
		} catch (error) {
			displayError(error);
		} finally {
			state.busy = false;
			target.disabled = false;
		}
	}

	function openAccess(access) {
		if (access?.token && access?.actionUrl) {
			const url = new URL(access.actionUrl, location.origin);
			if (
				url.pathname !== '/onboarding/access/' ||
				(url.protocol !== 'https:' && !(url.origin === location.origin && url.protocol === 'http:'))
			)
				throw new Error('The access destination is invalid.');
			const form = make('form');
			form.method = 'POST';
			form.action = url.toString();
			form.target = '_self';
			const token = make('input');
			token.type = 'hidden';
			token.name = 'grant';
			token.value = access.token;
			form.append(token);
			document.body.append(form);
			form.submit();
			form.remove();
			return;
		}
		const url = safeUrl(access?.url || access?.actionUrl);
		if (!url) throw new Error('Access is not ready yet. Refresh progress and try again.');
		const tab = window.open(url, '_blank', 'noopener');
		if (!tab) location.assign(url);
	}

	root.addEventListener('click', (event) => {
		const target = event.target.closest('[data-wizard-action]');
		if (target && root.contains(target)) void handleAction(target.dataset.wizardAction, target);
	});
	root.addEventListener('change', (event) => {
		const target = event.target;
		if (!target.name) return;
		if (target.name === 'planCode') {
			state.draft.planCode = target.value;
			state.draft.setupMode = '';
			render();
			void persist().catch(displayError);
		}
		if (target.name === 'setupMode') {
			state.draft.setupMode = target.value;
			render();
			void persist().catch(displayError);
		}
		if (target.name === 'siteType') {
			state.draft.siteType = target.value;
			render();
			void persist().catch(displayError);
		}
		if (target.name === 'importedAdministrator') {
			state.draft.importedAdministrator = target.value.trim();
			void persist().catch(displayError);
		}
	});
	root.addEventListener('input', (event) => {
		const target = event.target;
		if (target.name === 'accountName') {
			state.accountName = target.value;
			return;
		}
		if (
			![
				'websiteTitle',
				'administratorEmail',
				'importedAdministrator',
				'hostname',
				'domain',
			].includes(target.name)
		)
			return;
		state.draft[target.name] = target.value;
		clearTimeout(draftSaveTimer);
		draftSaveTimer = setTimeout(() => void persist().catch(displayError), 350);
	});
	return { state, load, update, render, openService, refreshProgress };
}

function trialLabel(capabilities) {
	const days = Number(capabilities?.trialDays);
	return Number.isInteger(days) && days > 0 ? `${days}-day trial` : 'Trial';
}

function money(offer) {
	if (offer?.monthlyPriceLabel) return offer.monthlyPriceLabel;
	const cents = Number(offer?.monthlyPriceMinor ?? offer?.monthlyPriceCadCents);
	const currency = offer?.currency || (offer?.monthlyPriceCadCents !== undefined ? 'CAD' : '');
	return Number.isFinite(cents) && /^[A-Z]{3}$/.test(currency)
		? new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100)
		: 'the listed price';
}

function offerLimits(offer) {
	if (!offer) return '';
	const parts = [];
	if (offer.websiteLimit)
		parts.push(`${offer.websiteLimit} ${offer.websiteLimit === 1 ? 'website' : 'websites'}`);
	if (offer.storageBytes) parts.push(`${Math.round(offer.storageBytes / 1073741824)} GB storage`);
	if (offer.transferBytes)
		parts.push(`${Math.round(offer.transferBytes / 1073741824)} GB transfer`);
	return parts.length ? `Includes ${parts.join(', ')}` : '';
}
