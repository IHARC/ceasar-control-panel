import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';

const original = {
	document: globalThis.document,
	location: globalThis.location,
	window: globalThis.window,
};

afterEach(() => {
	Object.assign(globalThis, original);
	delete globalThis.dataLayer;
	delete globalThis.gtag;
});

async function fixture() {
	const dom = new JSDOM(
		'<footer><button type="button" data-analytics-preferences hidden>Analytics preferences</button></footer>',
		{ url: 'https://app.iharclabs.ca/customer/account?token=secret#billing' },
	);
	globalThis.document = dom.window.document;
	globalThis.window = dom.window;
	globalThis.location = dom.window.location;
	return {
		dom,
		configureAnalytics: (await import('../../web/js/src/customer/analytics.js')).configureAnalytics,
	};
}

describe('customer analytics consent', () => {
	it('does not load the tag before consent and gives equal choices', async () => {
		const { configureAnalytics } = await fixture();
		configureAnalytics({
			analytics: { measurementId: 'G-TEST1234', consentCookieDomain: '.iharclabs.ca' },
		});
		expect(document.querySelectorAll('[data-analytics-consent] button')).toHaveLength(2);
		expect(document.querySelector('script[src*="googletagmanager"]')).toBeNull();
		document.querySelector('[data-analytics-decline]').click();
		expect(document.cookie).toContain('iharc_analytics_consent=denied');
		expect(document.querySelector('script[src*="googletagmanager"]')).toBeNull();
	});

	it('loads one tag after affirmative consent and uses a query-free page location', async () => {
		const { configureAnalytics } = await fixture();
		const analytics = configureAnalytics({
			analytics: { measurementId: 'G-TEST1234', consentCookieDomain: '.iharclabs.ca' },
		});
		document.querySelector('[data-analytics-accept]').click();
		const tag = document.querySelector('script[src*="googletagmanager"]');
		expect(tag).not.toBeNull();
		tag.onload();
		await Promise.resolve();
		analytics.pageView();
		await Promise.resolve();
		analytics.track('sign_up');
		await Promise.resolve();
		expect(document.querySelectorAll('script[src*="googletagmanager"]')).toHaveLength(1);
		const events = globalThis.dataLayer.filter((entry) => entry[0] === 'event');
		expect(events.find((entry) => entry[1] === 'page_view')[2].page_location).toBe(
			'https://app.iharclabs.ca/customer/account',
		);
		expect(events.some((entry) => entry[1] === 'sign_up')).toBe(true);
	});

	it('updates consent before configuring an initially granted tag and drops events after revoke', async () => {
		const { configureAnalytics } = await fixture();
		document.cookie = 'iharc_analytics_consent=granted; Path=/; Domain=.iharclabs.ca; Secure';
		const analytics = configureAnalytics({
			analytics: { measurementId: 'G-TEST1234', consentCookieDomain: '.iharclabs.ca' },
		});
		const tag = document.querySelector('script[src*="googletagmanager"]');
		analytics.setConsent(false);
		tag.onload();
		await Promise.resolve();
		await analytics.track('sign_up');
		const calls = globalThis.dataLayer;
		expect(calls.some((entry) => entry[0] === 'event' && entry[1] === 'sign_up')).toBe(false);
		const configIndex = calls.findIndex((entry) => entry[0] === 'config');
		const grantIndex = calls.findIndex(
			(entry) =>
				entry[0] === 'consent' && entry[1] === 'update' && entry[2].analytics_storage === 'granted',
		);
		expect(grantIndex).toBeLessThan(configIndex);
	});

	it('revoke disables a loaded tag and removes Google analytics and click cookies', async () => {
		const { configureAnalytics } = await fixture();
		const analytics = configureAnalytics({
			analytics: { measurementId: 'G-TEST1234', consentCookieDomain: '.iharclabs.ca' },
		});
		analytics.setConsent(true);
		document.cookie = '_ga=client; Path=/; Domain=.iharclabs.ca; Secure';
		document.cookie = '_gcl_aw=click; Path=/; Domain=.iharclabs.ca; Secure';
		analytics.setConsent(false);
		expect(globalThis['ga-disable-G-TEST1234']).toBe(true);
		expect(document.cookie).not.toContain('_ga=');
		expect(document.cookie).not.toContain('_gcl_aw=');
	});

	it('keeps a revoke-only token until the authenticated portal clears it', async () => {
		const { configureAnalytics } = await fixture();
		const analytics = configureAnalytics({
			analytics: { measurementId: 'G-TEST1234', consentCookieDomain: '.iharclabs.ca' },
		});
		analytics.storeRevocationToken('a'.repeat(43));
		analytics.setConsent(false);
		expect(document.cookie).toContain(`iharc_analytics_revoke=${'a'.repeat(43)}`);
		analytics.clearRevocationToken();
		expect(document.cookie).not.toContain('iharc_analytics_revoke=');
	});
});
