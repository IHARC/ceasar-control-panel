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
		mfa: {
			getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({
				data: { currentLevel: 'aal2', nextLevel: 'aal2' },
			}),
		},
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
			identity.signUp('customer@example.com', 'correct horse battery', false),
		).rejects.toThrow('Terms of Service');
		await expect(
			identity.signUp('customer@example.com', 'correct horse battery', true),
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
			identity.signUp('customer@example.com', 'correct horse battery', true),
		).rejects.toThrow('Email confirmation must be enabled');
		expect(auth.signOut).toHaveBeenCalledOnce();
	});

	it('requires aal2 and uses maintained SDK methods to remove authenticators and passkeys', async () => {
		const unenroll = vi.fn().mockResolvedValue({ data: {}, error: null });
		const deletePasskey = vi.fn().mockResolvedValue({ data: null, error: null });
		const { identity, auth } = identityFixture({
			mfa: {
				getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({
					data: { currentLevel: 'aal2', nextLevel: 'aal2' },
				}),
				unenroll,
			},
			passkey: { delete: deletePasskey },
		});

		await identity.unenrollFactor('factor-1');
		await identity.deletePasskey('passkey-1');

		expect(auth.mfa.getAuthenticatorAssuranceLevel).toHaveBeenCalledTimes(2);
		expect(unenroll).toHaveBeenCalledWith({ factorId: 'factor-1' });
		expect(deletePasskey).toHaveBeenCalledWith({ passkeyId: 'passkey-1' });
	});
});

describe('CustomerBusinessBackend', () => {
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
			requireAal2: vi.fn(),
		};
		const fetcher = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					data: {
						identity: { email: 'customer@example.com' },
						state: { contexts: [], services: [] },
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
			state: { contexts: [], services: [] },
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
			requireAal2: vi.fn(),
		};
		const fetcher = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ data: { contexts: [], services: [] } }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			}),
		);
		vi.stubGlobal('fetch', fetcher);
		try {
			const backend = new CustomerBusinessBackend(identity, config.workerApiBase);
			await expect(backend.accountState('account-1')).resolves.toEqual({
				contexts: [],
				services: [],
			});
			expect(fetcher).toHaveBeenCalledOnce();
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('uses the implemented typed business route contract', async () => {
		const identity = {
			session: vi.fn().mockResolvedValue({ access_token: 'customer-token' }),
			requireAal2: vi.fn(),
		};
		const fetcher = vi.fn().mockImplementation(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						data: {
							state: 'ready',
							url: 'https://checkout.stripe.com/session',
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
		await backend.supportCase('case-1');
		await backend.createAccount('Example account');
		await backend.updateProfile('Example customer');
		await backend.requestTrialAdmission({
			accountId: 'account-1',
			planCode: 'starter',
			siteType: 'wordpress',
			requestedCustomDomain: 'example.com',
			idempotencyKey: 'request-1',
		});
		await expect(
			backend.requestPaidAdmission({
				accountId: 'account-1',
				planCode: 'plus',
				intent: 'new_site',
				siteType: 'php',
				requestedCustomDomain: '',
				idempotencyKey: 'request-2',
			}),
		).resolves.toEqual({
			state: 'ready',
			url: 'https://checkout.stripe.com/session',
		});
		await backend.addWebsite('service-1', {
			accountId: 'account-1',
			siteType: 'static',
			requestedCustomDomain: 'static.example.com',
			idempotencyKey: 'request-3',
		});
		await backend.confirmMigration('service-1', {
			accountId: 'account-1',
			workspaceReadyOperationId: 'operation-1',
			idempotencyKey: 'request-4',
		});
		await backend.refreshDomain('service-1', {
			accountId: 'account-1',
			websiteId: 'website-1',
			hostname: 'www.example.com',
			dnsRecordType: 'CNAME',
			idempotencyKey: 'request-5',
		});
		await backend.requestBackup('service-1', {
			accountId: 'account-1',
			idempotencyKey: 'request-6',
		});
		await backend.openSupportCase({
			accountId: 'account-1',
			serviceId: 'service-1',
			subject: 'Help',
			message: 'Please help',
			idempotencyKey: 'request-7',
		});
		await backend.replyToSupportCase('case-1', 'Thanks', 'request-8');
		await backend.closeSupportCase('case-1', 'request-9');
		await backend.requestEmailChange('new@example.com');
		await backend.changePassword('correct horse battery staple');
		expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
			'/api/provider/v1/customer/accounts/account-1/state',
			'/api/provider/v1/customer/services/service-1/state',
			'/api/provider/v1/customer/support/case-1',
			'/api/provider/v1/customer/accounts',
			'/api/provider/v1/customer/profile',
			'/api/provider/v1/customer/admissions/trial',
			'/api/provider/v1/customer/billing/checkout-sessions',
			'/api/provider/v1/customer/services/service-1/websites',
			'/api/provider/v1/customer/migrations/service-1/confirm',
			'/api/provider/v1/customer/services/service-1/domain-refresh',
			'/api/provider/v1/customer/services/service-1/backups',
			'/api/provider/v1/customer/support',
			'/api/provider/v1/customer/support/case-1/replies',
			'/api/provider/v1/customer/support/case-1/close',
			'/api/provider/v1/customer/profile/email-change',
			'/api/provider/v1/customer/profile/password',
		]);
		expect(JSON.parse(fetcher.mock.calls[5][1].body)).toEqual({
			accountId: 'account-1',
			planCode: 'starter',
			siteType: 'wordpress',
			requestedCustomDomain: 'example.com',
			idempotencyKey: 'request-1',
		});
		expect(JSON.parse(fetcher.mock.calls[8][1].body)).toEqual({
			accountId: 'account-1',
			workspaceReadyOperationId: 'operation-1',
			customerAttestsImportComplete: true,
			idempotencyKey: 'request-4',
		});
	});

	it('requires aal2 before migration confirmation and billing portal calls', async () => {
		const identity = {
			session: vi.fn().mockResolvedValue({ access_token: 'customer-token' }),
			requireAal2: vi.fn().mockRejectedValue(new Error('step up')),
		};
		const fetcher = vi.fn();
		const backend = new CustomerBusinessBackend(identity, config.workerApiBase, fetcher);
		await expect(
			backend.confirmMigration('service-1', {
				accountId: 'account-1',
				workspaceReadyOperationId: 'operation-1',
				idempotencyKey: 'request-1',
			}),
		).rejects.toThrow('step up');
		await expect(backend.billingPortal('account-1')).rejects.toThrow('step up');
		expect(fetcher).not.toHaveBeenCalled();
	});
});
