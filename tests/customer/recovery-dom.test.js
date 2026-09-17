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
	const { accountAction, bindRecovery, renderSupportDetail, syncMigrationSiteType } =
		await import('../../web/js/src/customer/app.js');
	return {
		accountAction,
		bindRecovery,
		renderSupportDetail,
		syncMigrationSiteType,
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

	it('uses PHP for existing-site imports and disables closed-case reply controls', async () => {
		const { renderSupportDetail, syncMigrationSiteType } = await recoveryForm();
		document.body.innerHTML = `
			<form data-account-action="admission-paid"><select name="intent"><option value="migration" selected>Import</option></select><select name="site_type"><option value="wordpress" selected>WordPress</option><option value="php">PHP</option></select></form>
			<form data-account-action="support-reply"><textarea></textarea><button type="submit">Send</button><button type="button" data-support-close>Close</button></form>
			<div data-support-case-detail></div><div data-support-message-rows></div>
		`;
		const admission = document.querySelector('[data-account-action="admission-paid"]');
		syncMigrationSiteType(admission);
		expect(admission.querySelector('[name=site_type]').value).toBe('php');
		renderSupportDetail(
			{ supportCase: { subject: 'Done', status: 'closed' } },
			{ userId: 'user-1' },
		);
		for (const control of document.querySelectorAll(
			'[data-account-action="support-reply"] textarea, [data-account-action="support-reply"] button',
		)) {
			expect(control.disabled).toBe(true);
		}
		renderSupportDetail({}, { userId: 'user-1' });
		for (const control of document.querySelectorAll(
			'[data-account-action="support-reply"] textarea, [data-account-action="support-reply"] button',
		)) {
			expect(control.disabled).toBe(true);
		}
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
