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
			createAccount: vi.fn().mockResolvedValue({ accountId: 'account-1' }),
			openSupportCase: vi.fn().mockResolvedValue({}),
		};
		await accountAction(
			'account-create',
			{ display_name: 'Example account', idempotency_key: 'request-0' },
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
		expect(backend.createAccount).toHaveBeenCalledWith('Example account', 'request-0');
		expect(backend.openSupportCase).toHaveBeenCalledWith({
			accountId: 'account-1',
			subject: 'Help',
			message: 'Please help',
			idempotencyKey: 'request-1',
		});
	});

	it('rejects missing setup mode and unknown eligibility before creating hosting', async () => {
		const { accountAction } = await recoveryForm();
		const backend = { requestPaidAdmission: vi.fn(), requestTrialAdmission: vi.fn() };
		const base = {
			accountId: 'account-1',
			state: {
				offers: [{ planCode: 'starter', paidAvailable: true, trialAvailable: true }],
				setups: [],
			},
		};
		await expect(
			accountAction(
				'hosting-setup',
				{
					intent: 'new_site',
					plan_code: 'starter',
					site_type: 'wordpress',
					setup_mode: 'paid',
					idempotency_key: 'request-1',
				},
				base,
				{},
				{},
				backend,
			),
		).rejects.toThrow('Hosting options are unavailable right now. Try again.');
		base.state.trialEligibility = { canStartTrial: false };
		await expect(
			accountAction(
				'hosting-setup',
				{
					intent: 'new_site',
					plan_code: 'starter',
					site_type: 'wordpress',
					idempotency_key: 'request-2',
				},
				base,
				{},
				{},
				backend,
			),
		).rejects.toThrow('Choose how you want to continue.');
		expect(backend.requestPaidAdmission).not.toHaveBeenCalled();
	});

	it('does not render a setup returned after its account context changed', async () => {
		const { accountAction } = await recoveryForm();
		let resolveSetup;
		const backend = {
			requestPaidAdmission: vi.fn(
				() =>
					new Promise((resolve) => {
						resolveSetup = resolve;
					}),
			),
		};
		const context = {
			userId: 'user-1',
			accountId: 'account-a',
			accountContextToken: 1,
			state: {
				trialEligibility: { canStartTrial: false },
				offers: [{ planCode: 'starter', paidAvailable: true, trialAvailable: false }],
				setups: [],
			},
		};
		const pending = accountAction(
			'hosting-setup',
			{
				intent: 'new_site',
				plan_code: 'starter',
				site_type: 'wordpress',
				setup_mode: 'paid',
				idempotency_key: 'request-3',
			},
			context,
			{},
			{},
			backend,
			{
				action: 'hosting-setup',
				userId: 'user-1',
				accountId: 'account-a',
				accountContextToken: 1,
			},
		);
		context.accountId = 'account-b';
		context.accountContextToken = 2;
		resolveSetup({
			requestId: 'setup-a',
			status: 'checkout',
			checkoutUrl: 'https://checkout.stripe.com/a',
		});
		await expect(pending).resolves.toEqual({ stale: true, retainKey: true });
		expect(context.state.setups).toEqual([]);
	});

	it('uses PHP for existing-site imports and disables closed-case reply controls', async () => {
		const { renderSupportDetail, syncMigrationSiteType } = await recoveryForm();
		document.body.innerHTML = `
			<form data-account-action="hosting-setup"><input type="radio" name="intent" value="migration" checked><select name="site_type"><option value="wordpress" selected>WordPress</option><option value="php">PHP</option></select></form>
			<form data-support-reply-form><textarea></textarea><button type="submit">Send</button><button type="button" data-support-close>Close</button></form>
			<div data-support-case-detail></div><div data-support-message-list></div>
		`;
		const admission = document.querySelector('[data-account-action="hosting-setup"]');
		syncMigrationSiteType(admission);
		expect(admission.querySelector('[name=site_type]').value).toBe('php');
		renderSupportDetail(
			{
				supportCase: { subject: 'Done', status: 'closed' },
				messages: [
					{ author: 'customer', message: 'Please help', createdAt: '2030-01-01T00:00:00Z' },
					{ author: 'support', message: 'We can help', createdAt: '2030-01-01T00:01:00Z' },
				],
			},
			{ userId: 'user-1', config: { brandName: 'Example' } },
		);
		expect(document.querySelector('[data-support-message-list]').textContent).toContain('You');
		expect(document.querySelector('[data-support-message-list]').textContent).toContain(
			'Example support',
		);
		for (const control of document.querySelectorAll(
			'[data-support-reply-form] textarea, [data-support-reply-form] button',
		)) {
			expect(control.disabled).toBe(true);
		}
		renderSupportDetail({}, { userId: 'user-1' });
		for (const control of document.querySelectorAll(
			'[data-support-reply-form] textarea, [data-support-reply-form] button',
		)) {
			expect(document.querySelector('[data-support-reply-form]').hidden).toBe(true);
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
