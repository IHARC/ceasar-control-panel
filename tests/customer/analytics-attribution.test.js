import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const original = { document: globalThis.document, sessionStorage: globalThis.sessionStorage };

afterEach(() => Object.assign(globalThis, original));

describe('portal analytics attribution consent transitions', () => {
	it('sends every consent change and omits a timestamp for denial', async () => {
		const dom = new JSDOM('', { url: 'https://app.iharclabs.ca/customer/account' });
		globalThis.document = dom.window.document;
		globalThis.sessionStorage = dom.window.sessionStorage;
		const { syncAnalyticsAttribution } = await import('../../web/js/src/customer/app.js');
		const analytics = {
			configured: true,
			consent: vi.fn(() => true),
			identifiers: vi.fn().mockResolvedValue({ clientId: '1.2', sessionId: '3' }),
			storeRevocationToken: vi.fn(),
			clearRevocationToken: vi.fn(),
		};
		const backend = {
			updateAnalyticsAttribution: vi.fn().mockResolvedValue({ revokeToken: 'a'.repeat(43) }),
		};
		const context = { accountId: 'account-1', analytics, backend, analyticsConsentVersion: 1 };
		await syncAnalyticsAttribution(context);
		analytics.consent.mockReturnValue(false);
		context.analyticsConsentVersion = 2;
		await syncAnalyticsAttribution(context);
		analytics.consent.mockReturnValue(true);
		context.analyticsConsentVersion = 3;
		await syncAnalyticsAttribution(context);
		expect(backend.updateAnalyticsAttribution).toHaveBeenCalledTimes(3);
		expect(backend.updateAnalyticsAttribution.mock.calls[1][1]).toEqual({
			analyticsConsent: false,
		});
		expect(backend.updateAnalyticsAttribution.mock.calls[2][1]).toMatchObject({
			analyticsConsent: true,
			clientId: '1.2',
			sessionId: '3',
		});
		expect(analytics.clearRevocationToken).toHaveBeenCalledOnce();
	});

	it('does not let a pending grant win when consent changes to denied', async () => {
		const dom = new JSDOM('', { url: 'https://app.iharclabs.ca/customer/account' });
		globalThis.document = dom.window.document;
		const { syncAnalyticsAttribution } = await import('../../web/js/src/customer/app.js');
		let resolveIdentifiers;
		const analytics = {
			configured: true,
			consent: vi.fn(() => true),
			identifiers: vi.fn(
				() =>
					new Promise((resolve) => {
						resolveIdentifiers = resolve;
					}),
			),
			storeRevocationToken: vi.fn(),
			clearRevocationToken: vi.fn(),
		};
		const backend = { updateAnalyticsAttribution: vi.fn().mockResolvedValue({}) };
		const context = { accountId: 'account-1', analytics, backend, analyticsConsentVersion: 1 };
		const pendingGrant = syncAnalyticsAttribution(context);
		await Promise.resolve();
		analytics.consent.mockReturnValue(false);
		context.analyticsConsentVersion = 2;
		const pendingDeny = syncAnalyticsAttribution(context);
		resolveIdentifiers({ clientId: '1.2' });
		await Promise.all([pendingGrant, pendingDeny]);
		expect(backend.updateAnalyticsAttribution).toHaveBeenCalledTimes(1);
		expect(backend.updateAnalyticsAttribution).toHaveBeenCalledWith('account-1', {
			analyticsConsent: false,
		});
	});

	it('resends current consent from a new page context after a reload', async () => {
		const dom = new JSDOM('', { url: 'https://app.iharclabs.ca/customer/account' });
		globalThis.document = dom.window.document;
		const { syncAnalyticsAttribution } = await import('../../web/js/src/customer/app.js');
		const analytics = {
			configured: true,
			consent: () => true,
			identifiers: vi.fn().mockResolvedValue({ clientId: '1.2' }),
			storeRevocationToken: vi.fn(),
			clearRevocationToken: vi.fn(),
		};
		const backend = { updateAnalyticsAttribution: vi.fn().mockResolvedValue({}) };
		await syncAnalyticsAttribution({ accountId: 'account-1', analytics, backend });
		await syncAnalyticsAttribution({ accountId: 'account-1', analytics, backend });
		expect(backend.updateAnalyticsAttribution).toHaveBeenCalledTimes(2);
	});
});
