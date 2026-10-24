import { CustomerBusinessBackend } from '../../../web/js/src/customer/providers.js';

// This fixture uses the real customer templates and compiled customer bundle.
// All hosting, billing and identity actions remain in the browser fixture.
const key = 'ceasar:customer-preview';
const parameters = new URLSearchParams(location.search);
let state;
try {
	state = JSON.parse(sessionStorage.getItem(key) || '{}');
} catch {
	state = {};
}
if (parameters.has('previewReset')) state = {};
if (parameters.has('previewNew')) state.mode = 'new';
if (parameters.has('previewReset') || parameters.has('previewNew')) {
	const url = new URL(location.href);
	url.searchParams.delete('previewReset');
	url.searchParams.delete('previewNew');
	history.replaceState(history.state, '', url);
}
state ||= {};
state.account ||=
	state.mode === 'new' ? null : { accountId: 'account-1', displayName: 'Example Studio' };
state.signedIn ??= state.mode !== 'new';
state.draft ||= null;
state.setups ||= [];
state.services ||= [];
state.progressReads ||= 0;
function save() {
	sessionStorage.setItem(key, JSON.stringify(state));
}
save();

if (parameters.has('previewCaptcha')) {
	const widgets = new Map();
	globalThis.turnstile = {
		render(mount, options) {
			const id = `fixture-turnstile-${widgets.size + 1}`;
			const label = document.createElement('label');
			const check = document.createElement('input');
			check.type = 'checkbox';
			check.addEventListener('change', () => {
				if (check.checked) options.callback(`fixture-token-${id}`);
			});
			label.append(check, document.createTextNode(' Complete the preview security check'));
			const expire = document.createElement('button');
			expire.type = 'button';
			expire.textContent = 'Expire preview challenge';
			expire.addEventListener('click', () => options['expired-callback']());
			mount.append(label, expire);
			widgets.set(id, check);
			return id;
		},
		reset(id) {
			const check = widgets.get(id);
			if (check) check.checked = false;
		},
	};
}

const identity = {
	async session() {
		return state.signedIn ? { access_token: 'fixture-customer-token' } : null;
	},
	async user() {
		return {
			id: 'customer-1',
			email: 'customer@example.test',
			user_metadata: { display_name: state.accountName || '' },
		};
	},
	async signIn() {
		if (state.pendingConfirmation)
			throw new Error('Use the preview email confirmation link first.');
		state.signedIn = true;
		save();
		return { access_token: 'fixture-customer-token' };
	},
	async signUp(_email, _password, _accepted, _callback, _captcha, accountName) {
		state.mode = 'new';
		state.account = null;
		state.accountName = accountName;
		state.signedIn = false;
		state.pendingConfirmation = true;
		save();
		return { id: 'customer-1' };
	},
	async exchangeConfirmation() {
		state.pendingConfirmation = false;
		state.signedIn = true;
		save();
		return { access_token: 'fixture-customer-token' };
	},
	async requestRecovery() {},
	async signOut() {
		state.signedIn = false;
		save();
	},
	async listPasskeys() {
		return [];
	},
	async updateProfile() {},
	async updateEmail() {},
	async updatePassword() {},
	async registerPasskey() {},
	async deletePasskey() {},
};

const backend = new CustomerBusinessBackend(identity, '/fixture/customer-api');
const capabilities = {
	trialDays: 7,
	setupMethods: {
		'wordpress-new': { trial: true, paid: true },
		'wordpress-move': { trial: true, paid: true },
		'php-import': { trial: false, paid: true },
		'php-static': { trial: true, paid: true },
	},
};
function offer() {
	const full = new URLSearchParams(location.search).get('previewCap') === 'full';
	return {
		planCode: 'starter',
		displayName: 'Starter',
		monthlyPriceCadCents: 1295,
		currency: 'CAD',
		websiteLimit: 1,
		storageBytes: 5368709120,
		transferBytes: 10737418240,
		trialAvailable: !full,
		paidAvailable: true,
	};
}
function offers() {
	return [
		offer(),
		{
			...offer(),
			planCode: 'plus',
			displayName: 'Plus',
			monthlyPriceCadCents: 2495,
			storageBytes: 10737418240,
		},
	];
}
function account() {
	return state.account;
}
function service(serviceId) {
	return state.services.find((item) => item.serviceId === serviceId);
}
function progress(serviceId) {
	const selected =
		state.services.find((service) => service.serviceId === serviceId) || state.services[0];
	if (!selected)
		return { status: 'queued', stage: 'allocation', message: 'Waiting for a hosting request.' };
	selected.progressReads = (selected.progressReads || 0) + 1;
	const migration = selected.intent === 'migration';
	const ready = selected.progressReads >= 2;
	if (ready) {
		selected.status = migration && !state.migrationVerified ? 'import_ready' : 'active';
		state.setups = state.setups.map((row) =>
			row.serviceId === selected.serviceId ? { ...row, status: selected.status } : row,
		);
	}
	save();
	return {
		status: !ready ? 'running' : migration && !state.migrationVerified ? 'needs_action' : 'ready',
		stage: !ready
			? 'installing'
			: migration && !state.migrationVerified
				? 'transfer'
				: migration
					? 'verified'
					: 'ready',
		message: !ready
			? 'Preparing the website workspace.'
			: migration && !state.migrationVerified
				? 'Destination is ready. Transfer through WPvivid or upload your PHP files.'
				: 'The website is ready.',
		nextAction: !ready
			? 'Refresh progress'
			: migration && !state.migrationVerified
				? 'Complete and verify the import.'
				: 'Preview and connect a domain.',
		operationId: 'fixture-operation-1',
		serviceId: selected.serviceId,
		previewUrl: 'https://preview.example.test/',
		siteType: selected.siteType,
		intent: selected.intent,
	};
}
function domain(domain, connected = false) {
	return {
		status: connected ? 'connected' : 'awaiting_dns',
		dnsReady: connected,
		ownershipReady: connected,
		wwwReady: connected,
		certificateReady: connected,
		certificateStatus: connected ? 'ready' : 'pending',
		message: connected
			? 'Domain connected over HTTPS.'
			: 'Add these web records and keep your existing mail records.',
		records: [
			{ type: 'A', name: domain, value: '192.0.2.24' },
			{ type: 'CNAME', name: `www.${domain}`, value: domain },
			{ type: 'TXT', name: `_ceasar-verification.${domain}`, value: 'ceasar=fixture-domain-proof' },
		],
	};
}

Object.assign(backend, {
	async sessionState() {
		return {
			identity: {
				userId: 'customer-1',
				email: 'customer@example.test',
				displayName: 'Alex Morgan',
			},
			accounts: account() ? [account()] : [],
			selectedAccountId: account()?.accountId || null,
		};
	},
	async accountState() {
		const selectedOffer = offer();
		return {
			services: state.services,
			setups: state.setups,
			billing: [],
			trialEligibility: selectedOffer.trialAvailable
				? { status: 'eligible', canStartTrial: true, reason: 'trial_available' }
				: { status: 'unavailable', canStartTrial: false, reason: 'trial_capacity_full' },
			offers: offers(),
		};
	},
	async createAccount(displayName) {
		state.account = { accountId: 'account-1', displayName };
		save();
		return state.account;
	},
	async readOnboarding() {
		return { draft: state.draft, capabilities };
	},
	async saveOnboarding(_accountId, draft) {
		state.draft = { ...draft };
		save();
		return { draft: state.draft, capabilities };
	},
	async requestTrialAdmission(input) {
		return admission(input, 'trial');
	},
	async requestPaidAdmission(input) {
		return admission(input, 'paid');
	},
	async serviceOnboarding(_accountId, serviceId) {
		return progress(serviceId);
	},
	async serviceState(serviceId) {
		return { service: service(serviceId) };
	},
	async hostingAccess() {
		return {
			actionUrl: `${location.origin}/onboarding/access/`,
			token: 'fixture-single-use-grant',
			expiresAt: new Date(Date.now() + 60000).toISOString(),
		};
	},
	async wordpressAccess() {
		return { url: 'https://preview.example.test/wp-admin/', method: 'single_use' };
	},
	async confirmMigration() {
		state.migrationVerified = true;
		save();
		return progress();
	},
	async domainStatus(_accountId, _serviceId, name) {
		return domain(name, state.domain === name);
	},
	async connectDomain(_accountId, _serviceId, name) {
		state.domain = name;
		save();
		return domain(name, true);
	},
	async supportCases() {
		return { cases: [], page: 1, totalPages: 1 };
	},
});
function admission(input, mode) {
	const existing = state.setups.find((setup) => setup.idempotencyKey === input.idempotencyKey);
	if (existing) return existing;
	if (mode === 'trial' && !offer().trialAvailable)
		throw new Error('Trial capacity is full. Review monthly hosting.');
	if (mode === 'trial' && input.intent === 'migration' && input.siteType === 'php')
		throw new Error('PHP import uses monthly hosting.');
	const requestId = `fixture-${state.setups.length + 1}`;
	const serviceId = `service-${state.services.length + 1}`;
	const item = {
		idempotencyKey: input.idempotencyKey,
		requestId,
		serviceId,
		planCode: input.planCode,
		status: 'preparing',
		kind: mode,
		hostname: 'preview.example.test',
	};
	state.setups.unshift(item);
	state.services.unshift({
		serviceId,
		hostname: 'preview.example.test',
		planCode: input.planCode,
		status: 'preparing',
		intent: input.intent,
		siteType: input.siteType,
	});
	state.progressReads = 0;
	state.migrationVerified = false;
	save();
	return item;
}

window.__CEASAR_CUSTOMER_PREVIEW__ = { identity, backend };
document.addEventListener('click', (event) => {
	if (!event.target.closest('[data-preview-confirm]')) return;
	event.preventDefault();
	const parameters = new URLSearchParams(location.search);
	for (const flag of ['previewReset', 'previewNew', 'previewCaptcha', 'customer']) {
		parameters.delete(flag);
	}
	location.assign(`/customer-preview-callback?code=preview-code&${parameters}`);
});
