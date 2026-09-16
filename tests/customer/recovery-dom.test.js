import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const original = {
	document: globalThis.document,
	FormData: globalThis.FormData,
	Node: globalThis.Node,
	Event: globalThis.Event,
};

afterEach(() => {
	Object.assign(globalThis, original);
});

async function recoveryForm() {
	const dom = new JSDOM(`
		<div data-customer-notice data-customer-callback-status>Checking your confirmation link…</div>
		<form class="u-hidden" data-customer-recovery>
			<input name="password"><input name="password_confirm">
		</form>
	`);
	globalThis.document = dom.window.document;
	globalThis.FormData = dom.window.FormData;
	globalThis.Node = dom.window.Node;
	globalThis.Event = dom.window.Event;
	const { bindRecovery } = await import('../../web/js/src/customer/app.js');
	return { bindRecovery, dom, form: document.querySelector('[data-customer-recovery]') };
}

async function submit(form) {
	form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
	await new Promise(setImmediate);
}

describe('customer recovery form', () => {
	it('shows a password mismatch without calling Supabase', async () => {
		const { bindRecovery, form } = await recoveryForm();
		const identity = { updatePassword: vi.fn() };
		bindRecovery({ loginUrl: 'https://app.example.com/customer/login' }, identity);
		form.elements.password.value = 'one password';
		form.elements.password_confirm.value = 'another password';
		await submit(form);
		expect(document.querySelector('[data-customer-notice]').textContent).toBe(
			'Passwords do not match.',
		);
		expect(identity.updatePassword).not.toHaveBeenCalled();
	});

	it('keeps upstream password-reset failures visible', async () => {
		const { bindRecovery, form } = await recoveryForm();
		const identity = { updatePassword: vi.fn().mockRejectedValue(new Error('Reset rejected')) };
		bindRecovery({ loginUrl: 'https://app.example.com/customer/login' }, identity);
		form.elements.password.value = 'same password';
		form.elements.password_confirm.value = 'same password';
		await submit(form);
		expect(document.querySelector('[data-customer-notice]').textContent).toBe('Reset rejected');
	});
});
