import { createClient } from '@supabase/supabase-js';

export class SupabaseIdentityProvider {
	constructor(config, clientFactory = createClient) {
		this.config = config;
		this.client = clientFactory(config.supabaseUrl, config.supabasePublishableKey, {
			auth: {
				autoRefreshToken: true,
				detectSessionInUrl: false,
				experimental: { passkey: true },
				flowType: 'pkce',
				persistSession: true,
			},
		});
	}

	async signUp(email, password, acceptedTerms) {
		if (!acceptedTerms) {
			throw new Error('Accept the Terms of Service and Privacy Policy to continue.');
		}
		const { data, error } = await this.client.auth.signUp({
			email,
			password,
			options: { emailRedirectTo: this.config.callbackUrl },
		});
		throwIfError(error);
		if (data.session) {
			await this.client.auth.signOut();
			throw new Error('Email confirmation must be enabled before customer signup can be used.');
		}
		return data.user;
	}

	async signIn(email, password) {
		const { data, error } = await this.client.auth.signInWithPassword({
			email,
			password,
		});
		throwIfError(error);
		return data.session;
	}

	async signInWithPasskey() {
		if (!this.config.passkeysEnabled) {
			throw new Error('Passkey sign-in is not enabled.');
		}
		const { data, error } = await this.client.auth.signInWithPasskey();
		throwIfError(error);
		return data.session;
	}

	async exchangeConfirmation(code) {
		const { data, error } = await this.client.auth.exchangeCodeForSession(code);
		throwIfError(error);
		return data.session;
	}

	async requestRecovery(email) {
		const redirectTo = new URL(this.config.callbackUrl);
		redirectTo.searchParams.set('mode', 'recovery');
		const { error } = await this.client.auth.resetPasswordForEmail(email, {
			redirectTo: redirectTo.toString(),
		});
		throwIfError(error);
	}

	async session() {
		const { data, error } = await this.client.auth.getSession();
		throwIfError(error);
		return data.session;
	}

	async user() {
		const { data, error } = await this.client.auth.getUser();
		throwIfError(error);
		return data.user;
	}

	async updateProfile({ displayName, email, password }) {
		const attributes = {};
		if (displayName) attributes.data = { display_name: displayName };
		if (email) attributes.email = email;
		if (password) attributes.password = password;
		const { data, error } = await this.client.auth.updateUser(attributes);
		throwIfError(error);
		return data.user;
	}

	async assurance() {
		const { data, error } = await this.client.auth.mfa.getAuthenticatorAssuranceLevel();
		throwIfError(error);
		return data;
	}

	async listFactors() {
		const { data, error } = await this.client.auth.mfa.listFactors();
		throwIfError(error);
		return data;
	}

	async enrollTotp(friendlyName) {
		const { data, error } = await this.client.auth.mfa.enroll({
			factorType: 'totp',
			friendlyName,
		});
		throwIfError(error);
		return data;
	}

	async verifyTotp(factorId, code) {
		const { data, error } = await this.client.auth.mfa.challengeAndVerify({
			factorId,
			code,
		});
		throwIfError(error);
		return data;
	}

	async unenrollFactor(factorId) {
		await this.requireAal2();
		const { data, error } = await this.client.auth.mfa.unenroll({ factorId });
		throwIfError(error);
		return data;
	}

	async listPasskeys() {
		if (!this.config.passkeysEnabled) return [];
		const { data, error } = await this.client.auth.passkey.list();
		throwIfError(error);
		return data;
	}

	async registerPasskey() {
		if (!this.config.passkeysEnabled) throw new Error('Passkeys are not enabled.');
		await this.requireAal2();
		const { data, error } = await this.client.auth.registerPasskey();
		throwIfError(error);
		return data;
	}

	async deletePasskey(passkeyId) {
		await this.requireAal2();
		const { data, error } = await this.client.auth.passkey.delete({
			passkeyId,
		});
		throwIfError(error);
		return data;
	}

	async requireAal2() {
		const assurance = await this.assurance();
		if (assurance.currentLevel !== 'aal2') {
			throw new Error('Confirm a second factor before making this change.');
		}
	}

	async signOut() {
		const { error } = await this.client.auth.signOut();
		throwIfError(error);
	}
}

export class CustomerBusinessBackend {
	constructor(
		identity,
		apiBase,
		fetchImplementation = (...arguments_) => globalThis.fetch(...arguments_),
	) {
		this.identity = identity;
		this.apiBase = customerApiBase(apiBase);
		this.fetch = fetchImplementation;
	}

	sessionState() {
		return this.#request('GET', '/session');
	}

	accountState(accountId) {
		return this.#request('GET', `/accounts/${pathId(accountId)}/state`);
	}

	serviceState(serviceId) {
		return this.#request('GET', `/services/${pathId(serviceId)}/state`);
	}

	supportCase(caseId) {
		return this.#request('GET', `/support/${pathId(caseId)}`);
	}

	createAccount(displayName) {
		return this.#request('POST', '/accounts', { displayName });
	}

	updateProfile(displayName) {
		return this.#request('PATCH', '/profile', { displayName });
	}

	requestTrialAdmission({ accountId, planCode, siteType, requestedCustomDomain, idempotencyKey }) {
		return this.#request('POST', '/admissions/trial', {
			accountId,
			planCode,
			siteType,
			requestedCustomDomain: requestedCustomDomain || null,
			idempotencyKey,
		});
	}

	async requestPaidAdmission({
		accountId,
		planCode,
		intent,
		siteType,
		requestedCustomDomain,
		idempotencyKey,
	}) {
		const result = await this.#request(
			'POST',
			'/billing/checkout-sessions',
			{
				accountId,
				planCode,
				intent,
				siteType,
				requestedCustomDomain: requestedCustomDomain || null,
				idempotencyKey,
			},
			true,
		);
		return result.url ? { ...result, url: this.#hostedUrl(result.url) } : result;
	}

	addWebsite(serviceId, { accountId, siteType, requestedCustomDomain, idempotencyKey }) {
		return this.#request('POST', `/services/${pathId(serviceId)}/websites`, {
			accountId,
			siteType,
			requestedCustomDomain: requestedCustomDomain || null,
			idempotencyKey,
		});
	}

	confirmMigration(serviceId, { accountId, workspaceReadyOperationId, idempotencyKey }) {
		return this.#request(
			'POST',
			`/migrations/${pathId(serviceId)}/confirm`,
			{
				accountId,
				workspaceReadyOperationId,
				customerAttestsImportComplete: true,
				idempotencyKey,
			},
			true,
		);
	}

	async billingPortal(accountId) {
		const result = await this.#request('POST', '/billing/portal-sessions', { accountId }, true);
		return this.#hostedUrl(result.portalUrl || result.url);
	}

	refreshDomain(serviceId, { accountId, websiteId, hostname, dnsRecordType, idempotencyKey }) {
		return this.#request(
			'POST',
			`/services/${pathId(serviceId)}/domain-refresh`,
			{
				accountId,
				websiteId,
				hostname,
				dnsRecordType,
				confirmDomainChange: true,
				idempotencyKey,
			},
			true,
		);
	}

	requestBackup(serviceId, { accountId, idempotencyKey }) {
		return this.#request(
			'POST',
			`/services/${pathId(serviceId)}/backups`,
			{ accountId, replaceExistingManualBackup: true, idempotencyKey },
			true,
		);
	}

	openSupportCase({ accountId, serviceId, subject, message, idempotencyKey }) {
		return this.#request('POST', '/support', {
			accountId,
			serviceId: serviceId || null,
			subject,
			message,
			idempotencyKey,
		});
	}

	replyToSupportCase(caseId, message, idempotencyKey) {
		return this.#request('POST', `/support/${pathId(caseId)}/replies`, {
			message,
			idempotencyKey,
		});
	}

	closeSupportCase(caseId, idempotencyKey) {
		return this.#request('POST', `/support/${pathId(caseId)}/close`, {
			idempotencyKey,
		});
	}

	requestEmailChange(email) {
		return this.#request('POST', '/profile/email-change', { email }, true);
	}

	changePassword(password) {
		return this.#request('POST', '/profile/password', { password }, true);
	}

	#hostedUrl(value) {
		const destination = new URL(value);
		if (destination.protocol !== 'https:') {
			throw new Error('Billing provider returned an invalid hosted URL.');
		}
		return destination.toString();
	}

	async #request(method, path, payload, aal2 = false) {
		if (aal2) await this.identity.requireAal2();
		const session = await this.identity.session();
		if (!session?.access_token) throw new Error('Sign in to continue.');
		const options = {
			method,
			headers: {
				Accept: 'application/json',
				Authorization: `Bearer ${session.access_token}`,
			},
			redirect: 'error',
		};
		if (payload !== undefined) {
			options.headers['Content-Type'] = 'application/json';
			options.body = JSON.stringify(payload);
		}
		const response = await this.fetch(`${this.apiBase}${path}`, options);
		const contentType = response.headers.get('content-type') || '';
		if (!contentType.includes('application/json')) {
			throw new Error('Customer backend returned an invalid response.');
		}
		const body = await response.json();
		if (!response.ok) {
			throw new Error(body?.error?.code || body?.error || 'Customer request was rejected.');
		}
		if (!Object.hasOwn(body, 'data')) {
			throw new Error('Customer backend returned an invalid response.');
		}
		return body.data;
	}
}

function customerApiBase(value) {
	if (
		typeof value !== 'string' ||
		value.length > 200 ||
		!/^\/[A-Za-z0-9][A-Za-z0-9._~!$&'()*+,;=:@\/-]*\/?$/.test(value)
	) {
		throw new Error('Customer backend path is invalid.');
	}
	const normalized = value.replace(/\/$/, '');
	const segments = normalized.slice(1).split('/');
	if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
		throw new Error('Customer backend path is invalid.');
	}
	return normalized;
}

function pathId(value) {
	const id = typeof value === 'string' ? value.trim() : '';
	if (!id || id.length > 200) throw new Error('A valid record ID is required.');
	return encodeURIComponent(id);
}

function throwIfError(error) {
	if (error) throw new Error(error.message || 'Authentication request failed.');
}
