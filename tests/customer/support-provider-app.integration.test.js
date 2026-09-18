import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CustomerBusinessBackend } from '../../web/js/src/customer/providers.js';

const original = Object.fromEntries(
	[
		'document',
		'window',
		'location',
		'HTMLElement',
		'Node',
		'Event',
		'FormData',
		'File',
		'localStorage',
	].map((key) => [key, globalThis[key]]),
);

afterEach(() => {
	Object.assign(globalThis, original);
	delete globalThis.__CEASAR_CUSTOMER_PREVIEW__;
	vi.resetModules();
});

describe('customer support provider and account UI', () => {
	it('uses the provider-mapped case id when opening a list item', async () => {
		const dom = new JSDOM(
			`<body data-customer-page="account"><script id="customer-config" type="application/json">{"brandName":"Ceasar","loginUrl":"/login","callbackUrl":"/callback","accountUrl":"/account","workerApiBase":"/api/customer/v1","passkeysEnabled":false,"passwordMinLength":12}</script><span data-customer-email></span><button data-customer-sign-out></button><div data-customer-notice hidden></div><section data-customer-view="hosting"><h1 tabindex="-1">Hosting</h1></section><section data-customer-view="support"><h1 tabindex="-1">Support</h1></section><div data-service-list></div><p data-service-empty></p><button data-open-setup></button><div data-support-case-list></div><button data-support-next hidden></button><button data-support-retry hidden></button><div data-support-case-detail></div><button data-support-earlier hidden></button><div data-support-message-list></div><form data-support-reply-form><textarea></textarea><button></button></form><button data-support-reopen hidden></button><section data-support-actions></section><section data-support-account-required></section></body>`,
			{ url: 'https://customer.example.test/#support' },
		);
		for (const key of [
			'document',
			'window',
			'location',
			'HTMLElement',
			'Node',
			'Event',
			'FormData',
			'File',
			'localStorage',
		])
			globalThis[key] = dom.window[key];
		const identity = {
			session: vi.fn().mockResolvedValue({ access_token: 'customer-token' }),
			user: vi.fn().mockResolvedValue({ email: 'customer@example.test' }),
			listPasskeys: vi.fn().mockResolvedValue([]),
			signOut: vi.fn(),
		};
		const fetcher = vi.fn(async (url) => {
			if (url === '/api/customer/v1/session')
				return json({
					identity: { userId: 'customer-1', displayName: 'Customer' },
					accounts: [{ accountId: 'account-1', displayName: 'Account' }],
					selectedAccountId: 'account-1',
				});
			if (url === '/api/customer/v1/accounts/account-1/state')
				return json({ services: [], setups: [], offers: [], billing: [] });
			if (url === '/api/support/v1/tickets/?page=1&perPage=25')
				return json({
					tickets: [{ id: 'ticket-42', subject: 'Mapped ticket', status: 'open' }],
					page: 1,
					total: 1,
				});
			if (url === '/api/support/v1/tickets/?id=ticket-42')
				return json({
					id: 'ticket-42',
					subject: 'Mapped ticket',
					status: 'open',
					permissions: { reply: true },
					messages: [],
				});
			throw new Error(`Unexpected URL: ${url}`);
		});
		globalThis.__CEASAR_CUSTOMER_PREVIEW__ = {
			identity,
			backend: new CustomerBusinessBackend(identity, '/api/customer/v1', fetcher),
		};
		await import('../../web/js/src/customer/app.js');
		await vi.waitFor(() => expect(document.querySelector('[data-support-case-id]')).not.toBeNull());
		document.querySelector('[data-support-case-id]').click();
		await vi.waitFor(() =>
			expect(fetcher).toHaveBeenCalledWith(
				'/api/support/v1/tickets/?id=ticket-42',
				expect.any(Object),
			),
		);
	});
});

function json(data) {
	return new Response(JSON.stringify({ data }), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});
}
