import { JSDOM } from 'jsdom';
import { afterEach, expect, it } from 'vitest';

const originalDocument = globalThis.document;
afterEach(() => {
	globalThis.document = originalDocument;
});

it('shows pending provisioning and resumes only a valid hosted checkout without a new admission', async () => {
	const dom = new JSDOM(
		'<div class="u-hidden" data-pending-hosting><div data-pending-hosting-rows></div></div>',
	);
	globalThis.document = dom.window.document;
	const { renderPendingHosting } = await import('../../web/js/src/customer/app.js');
	renderPendingHosting([
		{ kind: 'trial', status: 'provisioning' },
		{
			kind: 'paid',
			status: 'checkout_pending',
			checkoutUrl: 'https://checkout.stripe.com/c/pay/test-session',
		},
		{ kind: 'paid', status: 'checkout_pending', checkoutUrl: 'https://stripe.com.attacker.test/' },
	]);
	expect(document.querySelector('[data-pending-hosting]').classList.contains('u-hidden')).toBe(
		false,
	);
	expect(document.body.textContent).toContain('Trial hosting: preparing your service.');
	expect(document.querySelectorAll('a')).toHaveLength(1);
	expect(document.querySelector('a').href).toBe('https://checkout.stripe.com/c/pay/test-session');
	renderPendingHosting([]);
	expect(document.querySelector('[data-pending-hosting]').classList.contains('u-hidden')).toBe(
		true,
	);
	expect(document.querySelector('[data-pending-hosting-rows]').children).toHaveLength(0);
});
