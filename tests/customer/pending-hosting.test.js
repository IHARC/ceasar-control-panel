import { JSDOM } from 'jsdom';
import { afterEach, expect, it } from 'vitest';

const originalDocument = globalThis.document;
afterEach(() => {
	globalThis.document = originalDocument;
});

it('shows every durable setup state and fetches checkout only when the customer resumes it', async () => {
	const dom = new JSDOM(
		'<section class="u-hidden" data-setup-status-section><div data-setup-status></div></section>',
	);
	globalThis.document = dom.window.document;
	const { renderSetups } = await import('../../web/js/src/customer/app.js');
	renderSetups(
		[
			{ kind: 'trial', planCode: 'starter', status: 'provisioning', nextAction: 'wait' },
			{
				requestId: 'setup-checkout',
				kind: 'paid',
				planCode: 'plus',
				status: 'checkout',
				nextAction: 'continue_checkout',
			},
		],
		{},
	);
	expect(document.querySelector('[data-setup-status-section]').classList.contains('u-hidden')).toBe(
		false,
	);
	expect(document.body.textContent).toContain('Your hosting is being prepared.');
	expect(document.querySelectorAll('a')).toHaveLength(0);
	expect(document.querySelector('[data-resume-checkout]').dataset.resumeCheckout).toBe(
		'setup-checkout',
	);
	expect(document.querySelector('[data-setup-status] [data-state="checkout"]')).toBeNull();
	renderSetups([], {});
	expect(document.querySelector('[data-setup-status-section]').classList.contains('u-hidden')).toBe(
		true,
	);
	expect(document.querySelector('[data-setup-status]').children).toHaveLength(0);
});
