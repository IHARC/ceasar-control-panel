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
};

function identityFixture(overrides = {}) {
	const auth = {
		signUp: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' }, session: null } }),
		signInWithPassword: vi.fn().mockResolvedValue({ data: { session: { access_token: 'token' } } }),
		signInWithPasskey: vi.fn().mockResolvedValue({ data: { session: { access_token: 'passkey' } } }),
		signOut: vi.fn().mockResolvedValue({ error: null }),
		mfa: {
			getAuthenticatorAssuranceLevel: vi
				.fn()
				.mockResolvedValue({ data: { currentLevel: 'aal2', nextLevel: 'aal2' } }),
		},
		...overrides,
	};
	const factory = vi.fn().mockReturnValue({ auth });
	return { identity: new SupabaseIdentityProvider(config, factory), auth, factory };
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
		await expect(identity.signUp('customer@example.com', 'correct horse battery', false)).rejects.toThrow(
			'Terms of Service',
		);
		await expect(identity.signUp('customer@example.com', 'correct horse battery', true)).resolves.toEqual({
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
				data: { user: { id: 'user-1' }, session: { access_token: 'unexpected' } },
			}),
		});
		await expect(identity.signUp('customer@example.com', 'correct horse battery', true)).rejects.toThrow(
			'Email confirmation must be enabled',
		);
		expect(auth.signOut).toHaveBeenCalledOnce();
	});
});

describe('CustomerBusinessBackend', () => {
	it('sends bearer tokens only to fixed same-origin customer routes', async () => {
		const identity = {
			session: vi.fn().mockResolvedValue({ access_token: 'customer-token' }),
			requireAal2: vi.fn(),
		};
		const fetcher = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ services: [] }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			}),
		);
		const backend = new CustomerBusinessBackend(identity, fetcher);
		await backend.sessionState();
		expect(fetcher).toHaveBeenCalledWith(
			'/api/iharc/v1/customer/session',
			expect.objectContaining({
				method: 'GET',
				headers: expect.objectContaining({ Authorization: 'Bearer customer-token' }),
			}),
		);
	});

	it('uses the implemented typed business route contract', async () => {
		const identity = {
			session: vi.fn().mockResolvedValue({ access_token: 'customer-token' }),
			requireAal2: vi.fn(),
		};
		const fetcher = vi.fn().mockImplementation(() =>
			Promise.resolve(
				new Response(JSON.stringify({ ok: true }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				}),
			),
		);
		const backend = new CustomerBusinessBackend(identity, fetcher);
		await backend.accountState('account-1');
		await backend.serviceState('service-1');
		await backend.supportCase('case-1');
		await backend.createAccount('Example account');
		await backend.updateProfile('Example customer');
		await backend.requestTrialAdmission({
			accountId: 'account-1',
			offeringId: 'starter',
			idempotencyKey: 'request-1',
		});
		await backend.addWebsite('service-1', 'example.com');
		await backend.refreshDomain('service-1', 'request-2');
		await backend.requestBackup('service-1', 'request-3');
		await backend.openSupportCase({
			accountId: 'account-1',
			subject: 'Help',
			message: 'Please help',
			idempotencyKey: 'request-4',
		});
		await backend.replyToSupportCase('case-1', 'Thanks', 'request-5');
		await backend.closeSupportCase('case-1', 'request-6');
		expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
			'/api/iharc/v1/customer/accounts/account-1/state',
			'/api/iharc/v1/customer/services/service-1/state',
			'/api/iharc/v1/customer/support/case-1',
			'/api/iharc/v1/customer/accounts',
			'/api/iharc/v1/customer/profile',
			'/api/iharc/v1/customer/admissions/trial',
			'/api/iharc/v1/customer/services/service-1/websites',
			'/api/iharc/v1/customer/services/service-1/domain-refresh',
			'/api/iharc/v1/customer/services/service-1/backups',
			'/api/iharc/v1/customer/support',
			'/api/iharc/v1/customer/support/case-1/replies',
			'/api/iharc/v1/customer/support/case-1/close',
		]);
		expect(JSON.parse(fetcher.mock.calls[5][1].body)).toEqual({
			accountId: 'account-1',
			offeringId: 'starter',
			idempotencyKey: 'request-1',
		});
	});

	it('requires aal2 before migration confirmation and billing portal calls', async () => {
		const identity = {
			session: vi.fn().mockResolvedValue({ access_token: 'customer-token' }),
			requireAal2: vi.fn().mockRejectedValue(new Error('step up')),
		};
		const fetcher = vi.fn();
		const backend = new CustomerBusinessBackend(identity, fetcher);
		await expect(backend.confirmMigration('service-1', 'request-1')).rejects.toThrow('step up');
		await expect(backend.billingPortal('account-1')).rejects.toThrow('step up');
		expect(fetcher).not.toHaveBeenCalled();
	});
});
