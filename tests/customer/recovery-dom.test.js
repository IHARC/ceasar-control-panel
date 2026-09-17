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
	const { accountAction, bindRecovery } = await import('../../web/js/src/customer/app.js');
	return {
		accountAction,
		bindRecovery,
		dom,
		form: document.querySelector('[data-customer-recovery]'),
	};
}

async function submit(form) {
	form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
	await new Promise(setImmediate);
}

describe('customer recovery form', () => {
	it('uses the ordinary Supabase session for profile, email, and password changes', async () => {
		const { accountAction } = await recoveryForm();
		const identity = {
			updateProfile: vi.fn().mockResolvedValue({}),
			updateEmail: vi.fn().mockResolvedValue({}),
			updatePassword: vi.fn().mockResolvedValue({}),
		};
		const config = { callbackUrl: 'https://app.example.com/auth/callback' };
		await accountAction('profile', { display_name: 'Example' }, {}, config, identity, {});
		await accountAction('email-change', { email: 'new@example.com' }, {}, config, identity, {});
		await accountAction(
			'password-change',
			{ password: ' password with spaces ' },
			{},
			config,
			identity,
			{},
		);
		expect(identity.updateProfile).toHaveBeenCalledWith('Example');
		expect(identity.updateEmail).toHaveBeenCalledWith('new@example.com', config.callbackUrl);
		expect(identity.updatePassword).toHaveBeenCalledWith(' password with spaces ');
	});

	it('creates an account before opening support without requiring a hosting service', async () => {
		const { accountAction } = await recoveryForm();
		const context = {};
		const backend = {
			createAccount: vi.fn().mockResolvedValue([{ customer_account_id: 'account-1' }]),
			openSupportCase: vi.fn().mockResolvedValue({}),
		};
		await accountAction(
			'account-create',
			{ display_name: 'Example account' },
			context,
			{},
			{},
			backend,
		);
		await accountAction(
			'support-open',
			{ subject: 'Help', message: 'Please help', idempotency_key: 'request-1' },
			context,
			{},
			{},
			backend,
		);
		expect(backend.createAccount).toHaveBeenCalledWith('Example account');
		expect(backend.openSupportCase).toHaveBeenCalledWith({
			accountId: 'account-1',
			subject: 'Help',
			message: 'Please help',
			idempotencyKey: 'request-1',
		});
	});

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
