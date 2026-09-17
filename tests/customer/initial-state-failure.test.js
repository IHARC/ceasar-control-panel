import { JSDOM } from 'jsdom';
import { afterEach, expect, it } from 'vitest';

const originalDocument = globalThis.document;
afterEach(() => {
	globalThis.document = originalDocument;
});

it('keeps customer account controls unavailable when the initial session state cannot load', async () => {
	const dom = new JSDOM(`
		<div data-customer-notice hidden></div>
		<section data-account-onboarding></section>
		<div data-account-switcher></div>
		<section data-support-account-required></section>
		<section data-support-actions></section>
		<select data-account-select><option>Loading…</option></select>
		<p data-service-empty>Loading hosting services…</p><div data-service-list></div>
		<button data-open-setup>Add hosting</button><button data-hosting-read-retry hidden>Retry</button>
		<div data-service-detail></div>
		<section data-setup-status-section><div data-setup-status></div></section>
		<div data-billing-summary>Loading billing information…</div><form data-billing-portal></form>
		<div data-support-case-list>Loading support cases…</div><button data-support-retry hidden>Retry cases</button>
		<div data-support-case-detail></div><div data-support-message-list></div><form data-support-reply-form></form>
		<p data-setup-load-failure hidden></p><form data-setup-form></form>
	`);
	globalThis.document = dom.window.document;
	const { renderInitialCustomerStateFailure } = await import('../../web/js/src/customer/app.js');
	const context = {};

	renderInitialCustomerStateFailure(context);

	expect(context.initialStateUnavailable).toBe(true);
	expect(document.querySelector('[data-account-onboarding]').classList.contains('u-hidden')).toBe(
		true,
	);
	expect(document.querySelector('[data-open-setup]').hidden).toBe(true);
	expect(document.querySelector('[data-hosting-read-retry]').hidden).toBe(false);
	expect(document.querySelector('[data-service-empty]').textContent).toBe(
		'Account information could not be loaded right now.',
	);
	expect(document.querySelector('[data-billing-summary]').textContent).toBe(
		'Billing information is unavailable right now.',
	);
	expect(document.querySelector('[data-support-case-list]').textContent).toBe(
		'Account information is unavailable right now.',
	);
	expect(document.querySelector('[data-setup-form]').hidden).toBe(true);
	expect(document.querySelector('[data-customer-notice]').hidden).toBe(true);
});
