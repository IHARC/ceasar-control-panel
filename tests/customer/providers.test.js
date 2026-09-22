import { describe, expect, it, vi } from 'vitest';
import {
	CustomerBusinessBackend,
	SupabaseIdentityProvider,
} from '../../web/js/src/customer/providers.js';

const config = {
	supabaseUrl: 'https://project.supabase.co',
	supabasePublishableKey: 'sb_publishable_test',
	callbackUrl: 'https://app.example.com/auth/callback/',
	passkeysEnabled: true,
	workerApiBase: '/api/provider/v1/customer',
};

function identityFixture(overrides = {}) {
	const auth = {
		signUp: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' }, session: null } }),
		signInWithPassword: vi.fn().mockResolvedValue({ data: { session: { access_token: 'token' } } }),
		signInWithPasskey: vi
			.fn()
			.mockResolvedValue({ data: { session: { access_token: 'passkey' } } }),
		signOut: vi.fn().mockResolvedValue({ error: null }),
		updateUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
		...overrides,
	};
	const factory = vi.fn().mockReturnValue({ auth });
	return {
		identity: new SupabaseIdentityProvider(config, factory),
		auth,
		factory,
	};
}

describe('SupabaseIdentityProvider', () => {
	it('pins browser auth to PKCE and the experimental passkey API', async () => {
		const { identity, auth, factory } = identityFixture();
		await identity.signInWithPasskey();
		expect(factory).toHaveBeenCalledWith(
			config.supabaseUrl,
			config.supabasePublishableKey,
			expect.objectContaining({
				auth: expect.objectContaining({
					experimental: { passkey: true },
					flowType: 'pkce',
				}),
			}),
		);
		expect(auth.signInWithPasskey).toHaveBeenCalledOnce();
	});

	it('requires public terms acceptance and preserves email confirmation', async () => {
		const { identity, auth } = identityFixture();
		await expect(
			identity.signUp('customer@example.com', 'correct horse battery', false, config.callbackUrl),
		).rejects.toThrow('Terms of Service');
		await expect(
			identity.signUp('customer@example.com', 'correct horse battery', true, config.callbackUrl),
		).resolves.toEqual({
			id: 'user-1',
		});
		expect(auth.signUp).toHaveBeenCalledWith({
			email: 'customer@example.com',
			password: 'correct horse battery',
			options: { emailRedirectTo: config.callbackUrl },
		});
	});

	it('rejects an auth project that auto-confirms customer signup', async () => {
		const { identity, auth } = identityFixture({
			signUp: vi.fn().mockResolvedValue({
				data: {
					user: { id: 'user-1' },
					session: { access_token: 'unexpected' },
				},
			}),
		});
		await expect(
			identity.signUp('customer@example.com', 'correct horse battery', true, config.callbackUrl),
		).rejects.toThrow('Email confirmation must be enabled');
		expect(auth.signOut).toHaveBeenCalledOnce();
	});

	it('updates profile, email, and recovery password through Supabase without customer backend calls', async () => {
		const { identity, auth } = identityFixture();
		await expect(identity.updateProfile('Example customer')).resolves.toEqual({ id: 'user-1' });
		await expect(identity.updateEmail('new@example.com', config.callbackUrl)).resolves.toEqual({
			id: 'user-1',
		});
		await expect(identity.updatePassword('correct horse battery staple')).resolves.toEqual({
			id: 'user-1',
		});
		expect(auth.updateUser).toHaveBeenNthCalledWith(1, {
			data: { display_name: 'Example customer' },
		});
		expect(auth.updateUser).toHaveBeenNthCalledWith(
			2,
			{ email: 'new@example.com' },
			{ emailRedirectTo: config.callbackUrl },
		);
		expect(auth.updateUser).toHaveBeenCalledWith({ password: 'correct horse battery staple' });
	});

	it('verifies a recovery token hash through a POST before updating the password', async () => {
		const verifyOtp = vi.fn().mockResolvedValue({
			data: { session: { access_token: 'recovery-session' } },
			error: null,
		});
		const { identity } = identityFixture({ verifyOtp });
		await expect(identity.verifyRecovery('token-hash')).resolves.toEqual({
			access_token: 'recovery-session',
		});
		expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'token-hash', type: 'recovery' });
	});

	it('uses maintained passkey methods without an MFA assurance check', async () => {
		const deletePasskey = vi.fn().mockResolvedValue({ data: null, error: null });
		const { identity, auth } = identityFixture({
			passkey: { delete: deletePasskey },
		});

		await identity.deletePasskey('passkey-1');

		expect(deletePasskey).toHaveBeenCalledWith({ passkeyId: 'passkey-1' });
		expect(auth).not.toHaveProperty('mfa');
	});
});

describe('CustomerBusinessBackend', () => {
	it('sends consented attribution only to the selected account route', async () => {
		const identity = { session: vi.fn().mockResolvedValue({ access_token: 'customer-token' }) };
		const fetcher = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ data: { accepted: true, revokeToken: 'a'.repeat(43) } }), {
				headers: { 'content-type': 'application/json' },
			}),
		);
		const backend = new CustomerBusinessBackend(identity, config.workerApiBase, fetcher);
		await expect(
			backend.updateAnalyticsAttribution('account-1', {
				analyticsConsent: true,
				clientId: '123.456',
				sessionId: '789',
				capturedAt: '2026-09-19T18:00:00.000Z',
			}),
		).resolves.toEqual({ accepted: true, revokeToken: 'a'.repeat(43) });
		expect(fetcher).toHaveBeenCalledWith(
			'/api/provider/v1/customer/accounts/account-1/analytics-attribution',
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify({
					analyticsConsent: true,
					clientId: '123.456',
					sessionId: '789',
					capturedAt: '2026-09-19T18:00:00.000Z',
				}),
			}),
		);
	});

	it('rejects cross-origin and ambiguous customer backend paths', () => {
		const identity = {};
		for (const value of [
			'https://attacker.example/customer',
			'//attacker.example/customer',
			'/api/customer/../admin',
			'/api//customer',
			'/api/customer?admin=true',
		]) {
			expect(() => new CustomerBusinessBackend(identity, value)).toThrow(
				'Customer backend path is invalid',
			);
		}
	});

	it('sends bearer tokens only to fixed same-origin customer routes', async () => {
		const identity = {
			session: vi.fn().mockResolvedValue({ access_token: 'customer-token' }),
		};
		const fetcher = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					data: {
						identity: { email: 'customer@example.com' },
						accounts: [],
						selectedAccountId: null,
					},
				}),
				{
					status: 200,
					headers: { 'content-type': 'application/json' },
				},
			),
		);
		const backend = new CustomerBusinessBackend(identity, config.workerApiBase, fetcher);
		await expect(backend.sessionState()).resolves.toEqual({
			identity: { email: 'customer@example.com' },
			accounts: [],
			selectedAccountId: null,
		});
		expect(fetcher).toHaveBeenCalledWith(
			'/api/provider/v1/customer/session',
			expect.objectContaining({
				method: 'GET',
				headers: expect.objectContaining({
					Authorization: 'Bearer customer-token',
				}),
			}),
		);
	});

	it('uses the browser fetch function without an illegal receiver', async () => {
		const identity = {
			session: vi.fn().mockResolvedValue({ access_token: 'customer-token' }),
		};
		const state = {
			accounts: [],
			selectedAccountId: null,
			offers: [],
			trialEligibility: null,
			services: [],
			setups: [],
			billing: [],
		};
		const fetcher = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ data: state }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			}),
		);
		vi.stubGlobal('fetch', fetcher);
		try {
			const backend = new CustomerBusinessBackend(identity, config.workerApiBase);
			await expect(backend.accountState('account-1')).resolves.toEqual(state);
			expect(fetcher).toHaveBeenCalledOnce();
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('uses the implemented typed business route contract', async () => {
		const identity = {
			session: vi.fn().mockResolvedValue({ access_token: 'customer-token' }),
		};
		const fetcher = vi.fn().mockImplementation(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						data: {
							requestId: 'setup-1',
							checkoutUrl: 'https://checkout.stripe.com/session',
						},
					}),
					{
						status: 200,
						headers: { 'content-type': 'application/json' },
					},
				),
			),
		);
		const backend = new CustomerBusinessBackend(identity, config.workerApiBase, fetcher);
		await backend.accountState('account-1');
		await backend.serviceState('service-1');
		await expect(backend.setupCheckout('account-1', 'setup-1')).resolves.toEqual({
			requestId: 'setup-1',
			checkoutUrl: 'https://checkout.stripe.com/session',
		});
		await backend.supportCases();
		await backend.supportCase('case-1');
		await backend.createAccount('Example account', 'request-0');
		await expect(
			backend.requestTrialAdmission({
				accountId: 'account-1',
				planCode: 'starter',
				siteType: 'wordpress',
				idempotencyKey: 'request-1',
			}),
		).resolves.toEqual({
			requestId: 'setup-1',
			checkoutUrl: 'https://checkout.stripe.com/session',
		});
		await expect(
			backend.requestPaidAdmission({
				accountId: 'account-1',
				planCode: 'plus',
				intent: 'new_site',
				siteType: 'php',
				idempotencyKey: 'request-2',
			}),
		).resolves.toEqual({
			requestId: 'setup-1',
			checkoutUrl: 'https://checkout.stripe.com/session',
		});
		await backend.confirmMigration('service-1', {
			accountId: 'account-1',
			workspaceReadyOperationId: 'operation-1',
			idempotencyKey: 'request-3',
		});
		await backend.openSupportCase({
			accountId: 'account-1',
			subject: 'Help',
			message: 'Please help',
			idempotencyKey: 'request-4',
		});
		await backend.replyToSupportCase('case-1', 'Thanks', 'request-5');
		await backend.closeSupportCase('case-1', 'request-6');
		expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
			'/api/provider/v1/customer/accounts/account-1/state',
			'/api/provider/v1/customer/services/service-1/state',
			'/api/provider/v1/customer/accounts/account-1/setups/setup-1/checkout',
			'/api/support/v1/tickets/?page=1&perPage=25',
			'/api/support/v1/tickets/?id=case-1',
			'/api/provider/v1/customer/accounts',
			'/api/provider/v1/customer/admissions/trial',
			'/api/provider/v1/customer/billing/checkout-sessions',
			'/api/provider/v1/customer/migrations/service-1/confirm',
			'/api/support/v1/tickets/',
			'/api/support/v1/tickets/',
			'/api/support/v1/tickets/',
		]);
		expect(JSON.parse(fetcher.mock.calls[6][1].body)).toEqual({
			accountId: 'account-1',
			planCode: 'starter',
			siteType: 'wordpress',
			idempotencyKey: 'request-1',
		});
		expect(JSON.parse(fetcher.mock.calls[5][1].body)).toEqual({
			displayName: 'Example account',
			idempotencyKey: 'request-0',
		});
		expect(JSON.parse(fetcher.mock.calls[8][1].body)).toEqual({
			accountId: 'account-1',
			workspaceReadyOperationId: 'operation-1',
			customerAttestsImportComplete: true,
			idempotencyKey: 'request-3',
		});
		expect(JSON.parse(fetcher.mock.calls[9][1].body)).toEqual({
			action: 'create',
			accountId: 'account-1',
			subject: 'Help',
			body: 'Please help',
			idempotencyKey: 'request-4',
			requestId: 'request-4',
		});
		expect(JSON.parse(fetcher.mock.calls[10][1].body)).toEqual({
			action: 'reply',
			id: 'case-1',
			body: 'Thanks',
			idempotencyKey: 'request-5',
			requestId: 'request-5',
		});
		expect(fetcher.mock.calls[9][1].headers).toMatchObject({
			Authorization: 'Bearer customer-token',
			'Idempotency-Key': 'request-4',
		});
		expect(fetcher.mock.calls[10][1].headers['Idempotency-Key']).toBe('request-5');
	});

	it('uses authenticated attachment downloads and stable request keys for customer mutations', async () => {
		const identity = { session: vi.fn().mockResolvedValue({ access_token: 'customer-token' }) };
		const fetcher = vi.fn().mockResolvedValueOnce(
			new Response('attachment', {
				status: 200,
				headers: { 'content-type': 'application/octet-stream' },
			}),
		);
		const backend = new CustomerBusinessBackend(identity, config.workerApiBase, fetcher);
		await expect(backend.downloadSupportAttachment({ id: 'attachment-1' })).resolves.toMatchObject({
			size: 10,
			type: 'application/octet-stream',
		});
		expect(fetcher).toHaveBeenCalledWith(
			'/api/support/v1/attachment/?attachmentId=attachment-1',
			expect.objectContaining({
				headers: { Authorization: 'Bearer customer-token' },
			}),
		);
	});

	it('reuses a per-file attachment key when a reply upload is retried', async () => {
		const identity = { session: vi.fn().mockResolvedValue({ access_token: 'customer-token' }) };
		const fetcher = vi.fn(() =>
			Promise.resolve(
				new Response(JSON.stringify({ data: { id: 'attachment-1' } }), {
					headers: { 'content-type': 'application/json' },
				}),
			),
		);
		const backend = new CustomerBusinessBackend(identity, config.workerApiBase, fetcher);
		const files = [new File(['first'], 'first.txt'), new File(['second'], 'second.txt')];
		await backend.uploadSupportAttachments('ticket-1', 'message-1', files, 'reply-key');
		await backend.uploadSupportAttachments('ticket-1', 'message-1', files, 'reply-key');
		expect(fetcher.mock.calls.map(([, options]) => options.headers['Idempotency-Key'])).toEqual([
			'reply-key:attachment:0',
			'reply-key:attachment:1',
			'reply-key:attachment:0',
			'reply-key:attachment:1',
		]);
	});

	it('requests later support pages so customers can reach more than 25 tickets', async () => {
		const identity = { session: vi.fn().mockResolvedValue({ access_token: 'customer-token' }) };
		const fetcher = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ data: { tickets: [], page: 2, perPage: 25, total: 26 } }), {
				headers: { 'content-type': 'application/json' },
			}),
		);
		const backend = new CustomerBusinessBackend(identity, config.workerApiBase, fetcher);
		await backend.supportCases({ page: 2, search: 'invoice' });
		expect(fetcher).toHaveBeenCalledWith(
			'/api/support/v1/tickets/?page=2&perPage=25&query=invoice',
			expect.objectContaining({
				headers: expect.objectContaining({ Authorization: 'Bearer customer-token' }),
			}),
		);
	});

	it('requests older support conversation pages with the opaque message cursor', async () => {
		const identity = { session: vi.fn().mockResolvedValue({ access_token: 'customer-token' }) };
		const fetcher = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({ data: { id: 'ticket-1', messages: [], hasMoreMessages: false } }),
				{
					headers: { 'content-type': 'application/json' },
				},
			),
		);
		const backend = new CustomerBusinessBackend(identity, config.workerApiBase, fetcher);
		await backend.supportCase('ticket-1', { before: 'message-50' });
		expect(fetcher).toHaveBeenCalledWith(
			'/api/support/v1/tickets/?id=ticket-1&before=message-50',
			expect.objectContaining({
				headers: expect.objectContaining({ Authorization: 'Bearer customer-token' }),
			}),
		);
	});

	it('maps customer API codes to actionable copy without showing internal codes', async () => {
		const identity = {
			session: vi.fn().mockResolvedValue({ access_token: 'customer-token' }),
		};
		const fetcher = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ error: { code: 'upstream_rejected' } }), {
				status: 409,
				headers: { 'content-type': 'application/json' },
			}),
		);
		const backend = new CustomerBusinessBackend(identity, config.workerApiBase, fetcher);
		await expect(backend.supportCases('account-1')).rejects.toThrow(
			'That request could not be completed.',
		);
	});

	it('does not require an MFA step-up before migration confirmation and billing portal calls', async () => {
		const identity = {
			session: vi.fn().mockResolvedValue({ access_token: 'customer-token' }),
		};
		const fetcher = vi.fn().mockImplementation(() =>
			Promise.resolve(
				new Response(JSON.stringify({ data: { url: 'https://billing.stripe.com/session' } }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				}),
			),
		);
		const backend = new CustomerBusinessBackend(identity, config.workerApiBase, fetcher);
		await backend.confirmMigration('service-1', {
			accountId: 'account-1',
			workspaceReadyOperationId: 'operation-1',
			idempotencyKey: 'request-1',
		});
		await expect(backend.billingPortal('account-1')).resolves.toBe(
			'https://billing.stripe.com/session',
		);
		expect(fetcher).toHaveBeenCalledTimes(2);
	});
});
