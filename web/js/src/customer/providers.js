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

	async signUp(email, password, acceptedTerms, callbackUrl) {
		if (!acceptedTerms) {
			throw new Error('Accept the Terms of Service and Privacy Policy to continue.');
		}
		const { data, error } = await this.client.auth.signUp({
			email,
			password,
			options: { emailRedirectTo: callbackUrl },
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

	async updatePassword(password) {
		const { data, error } = await this.client.auth.updateUser({ password });
		throwIfError(error);
		return data.user;
	}

	async updateProfile(displayName) {
		const { data, error } = await this.client.auth.updateUser({
			data: { display_name: displayName },
		});
		throwIfError(error);
		return data.user;
	}

	async updateEmail(email, callbackUrl) {
		const { data, error } = await this.client.auth.updateUser(
			{ email },
			{ emailRedirectTo: callbackUrl },
		);
		throwIfError(error);
		return data.user;
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

	async listPasskeys() {
		if (!this.config.passkeysEnabled) return [];
		const { data, error } = await this.client.auth.passkey.list();
		throwIfError(error);
		return data;
	}

	async registerPasskey() {
		if (!this.config.passkeysEnabled) throw new Error('Passkeys are not enabled.');
		const { data, error } = await this.client.auth.registerPasskey();
		throwIfError(error);
		return data;
	}

	async deletePasskey(passkeyId) {
		const { data, error } = await this.client.auth.passkey.delete({
			passkeyId,
		});
		throwIfError(error);
		return data;
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
		this.supportApiBase = '/api/support/v1';
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

	async setupCheckout(accountId, requestId) {
		const result = await this.#request(
			'GET',
			`/accounts/${pathId(accountId)}/setups/${pathId(requestId)}/checkout`,
		);
		return { ...result, checkoutUrl: this.#hostedUrl(result.checkoutUrl) };
	}

	supportCase(caseId, { before = '' } = {}) {
		const query = new URLSearchParams({ id: caseId });
		if (before) query.set('before', before);
		return this.#supportRequest('GET', `/tickets/?${query}`).then((ticket) => ({
			supportCase: supportTicket(ticket),
			messages: (ticket.messages || [])
				.filter((message) => message.visibility !== 'internal')
				.map(supportMessage),
		}));
	}

	supportCases(options = {}) {
		const { page = 1, search = '' } = typeof options === 'object' && options ? options : {};
		const query = new URLSearchParams();
		query.set('page', String(page));
		query.set('perPage', '25');
		if (search) query.set('query', search);
		const suffix = query.size ? `?${query}` : '';
		return this.#supportRequest('GET', `/tickets/${suffix}`).then((result) => {
			const { tickets, items, ...page } = result;
			return { ...page, cases: (tickets || items || []).map(supportTicket) };
		});
	}

	createAccount(displayName, idempotencyKey) {
		return this.#request('POST', '/accounts', { displayName, idempotencyKey });
	}

	async requestTrialAdmission({ accountId, planCode, siteType, idempotencyKey }) {
		const result = await this.#request('POST', '/admissions/trial', {
			accountId,
			planCode,
			siteType,
			idempotencyKey,
		});
		return result.checkoutUrl
			? { ...result, checkoutUrl: this.#hostedUrl(result.checkoutUrl) }
			: result;
	}

	async requestPaidAdmission({ accountId, planCode, intent, siteType, idempotencyKey }) {
		const result = await this.#request('POST', '/billing/checkout-sessions', {
			accountId,
			planCode,
			intent,
			siteType,
			idempotencyKey,
		});
		return result.checkoutUrl
			? { ...result, checkoutUrl: this.#hostedUrl(result.checkoutUrl) }
			: result;
	}

	confirmMigration(serviceId, { accountId, workspaceReadyOperationId, idempotencyKey }) {
		return this.#request('POST', `/migrations/${pathId(serviceId)}/confirm`, {
			accountId,
			workspaceReadyOperationId,
			customerAttestsImportComplete: true,
			idempotencyKey,
		});
	}

	async billingPortal(accountId) {
		const result = await this.#request('POST', '/billing/portal-sessions', { accountId });
		return this.#hostedUrl(result.portalUrl || result.url);
	}

	openSupportCase({ accountId, subject, message, idempotencyKey }) {
		return this.#supportRequest('POST', '/tickets/', {
			action: 'create',
			accountId,
			subject,
			body: message,
			idempotencyKey,
		});
	}

	replyToSupportCase(caseId, message, idempotencyKey) {
		return this.#supportRequest('POST', '/tickets/', {
			action: 'reply',
			id: caseId,
			body: message,
			idempotencyKey,
		});
	}

	closeSupportCase(caseId, idempotencyKey) {
		return this.#supportRequest('POST', '/tickets/', {
			action: 'status',
			id: caseId,
			status: 'closed',
			idempotencyKey,
		});
	}

	reopenSupportCase(caseId, idempotencyKey) {
		return this.#supportRequest('POST', '/tickets/', {
			action: 'status',
			id: caseId,
			status: 'open',
			idempotencyKey,
		});
	}

	async uploadSupportAttachments(caseId, messageId, attachments, idempotencyKey = '') {
		const session = await this.identity.session();
		if (!session?.access_token) throw new Error('Sign in to continue.');
		for (const [index, file] of attachments.entries()) {
			const requestId = idempotencyKey
				? `${idempotencyKey}:attachment:${index}`
				: crypto.randomUUID();
			const form = new FormData();
			form.set('action', 'attachment');
			form.set('id', caseId);
			form.set('messageId', messageId);
			form.set('file', file);
			const response = await this.fetch(`${this.supportApiBase}/attachment/`, {
				method: 'POST',
				headers: {
					Accept: 'application/json',
					Authorization: `Bearer ${session.access_token}`,
					'Idempotency-Key': requestId,
				},
				body: form,
				redirect: 'error',
			});
			const body = await response.json();
			if (!response.ok || !body?.data) throw new Error(customerErrorMessage(body?.error));
		}
	}

	async downloadSupportAttachment(attachment) {
		const session = await this.identity.session();
		if (!session?.access_token) throw new Error('Sign in to continue.');
		const response = await this.fetch(
			`${this.supportApiBase}/attachment/?attachmentId=${encodeURIComponent(attachment.id)}`,
			{
				headers: { Authorization: `Bearer ${session.access_token}` },
				redirect: 'error',
			},
		);
		if (!response.ok) throw new Error('This attachment could not be downloaded.');
		return response.blob();
	}

	#hostedUrl(value) {
		const destination = new URL(value);
		if (destination.protocol !== 'https:') {
			throw new Error('Billing provider returned an invalid hosted URL.');
		}
		return destination.toString();
	}

	async #request(method, path, payload) {
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
			throw new Error(customerErrorMessage(body?.error));
		}
		if (!Object.hasOwn(body, 'data')) {
			throw new Error('Customer backend returned an invalid response.');
		}
		return body.data;
	}

	async #supportRequest(method, path, payload) {
		const session = await this.identity.session();
		if (!session?.access_token) throw new Error('Sign in to continue.');
		const options = {
			method,
			headers: { Accept: 'application/json', Authorization: `Bearer ${session.access_token}` },
			redirect: 'error',
		};
		if (payload !== undefined) {
			const requestId = payload.idempotencyKey;
			options.headers['Content-Type'] = 'application/json';
			if (requestId) options.headers['Idempotency-Key'] = requestId;
			options.body = JSON.stringify({
				...payload,
				...(requestId ? { requestId } : {}),
			});
		}
		const response = await this.fetch(`${this.supportApiBase}${path}`, options);
		const contentType = response.headers.get('content-type') || '';
		if (!contentType.includes('application/json'))
			throw new Error('Support service returned an invalid response.');
		const body = await response.json();
		if (!response.ok) throw new Error(customerErrorMessage(body?.error));
		if (!Object.hasOwn(body, 'data'))
			throw new Error('Support service returned an invalid response.');
		return body.data;
	}
}

function supportTicket(ticket) {
	return {
		...ticket,
		caseId: ticket.id,
		permittedActions: ticket.permissions || {},
	};
}

function supportMessage(message) {
	return {
		...message,
		message: message.body || '',
		createdAt: message.createdAt,
		authorName: message.author?.displayName || message.author?.email || '',
		authorRole: message.author?.role || '',
		attachments: message.attachments || [],
	};
}

function customerApiBase(value) {
	if (
		typeof value !== 'string' ||
		value.length > 200 ||
		!/^\/[A-Za-z0-9][A-Za-z0-9._~!$&'()*+,;=:@/-]*\/?$/.test(value)
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

function customerErrorMessage(error) {
	const code = typeof error === 'object' && error ? error.code : error;
	if (code === 'authentication_required') return 'Sign in to continue.';
	if (code === 'account_context_forbidden') return 'Choose an account you can access.';
	if (code === 'trial_ineligible') return 'A trial is not available for this account.';
	if (code === 'setup_not_found') return 'That hosting setup is no longer available.';
	if (code === 'idempotency_conflict')
		return 'This setup is already in progress. Refresh its status before trying again.';
	if (code === 'upstream_rejected')
		return 'That request could not be completed. Review the details and try again.';
	return 'The request could not be completed. Please try again.';
}
