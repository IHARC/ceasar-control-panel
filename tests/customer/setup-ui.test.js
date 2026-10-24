import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	createOnboardingWizard,
	trialAllowed,
	websiteSelection,
} from '../../web/js/src/customer/wizard.js';

const original = { document: globalThis.document, location: globalThis.location };
afterEach(() => Object.assign(globalThis, original));

function mount(overrides = {}) {
	const dom = new JSDOM('<div data-onboarding-wizard></div>', {
		url: 'https://customer.example.test/account/#setup',
	});
	globalThis.document = dom.window.document;
	globalThis.location = dom.window.location;
	const provider = {
		readOnboarding: vi.fn().mockResolvedValue({ draft: null, capabilities: {} }),
		saveOnboarding: vi.fn().mockResolvedValue({}),
		serviceOnboarding: vi
			.fn()
			.mockResolvedValue({ status: 'running', stage: 'preparing', message: 'Preparing files' }),
		...overrides.provider,
	};
	const onCommit = vi.fn().mockResolvedValue({ requestId: 'request-1', status: 'preparing' });
	const wizard = createOnboardingWizard({
		root: document.querySelector('[data-onboarding-wizard]'),
		provider,
		accountId: 'account-1',
		offers: [
			{
				planCode: 'starter',
				displayName: 'Starter',
				monthlyPriceCadCents: 1295,
				trialAvailable: true,
				paidAvailable: true,
			},
		],
		trialEligibility: { canStartTrial: true },
		capabilities: {
			setupMethods: {
				'wordpress-new': { trial: true, paid: true },
				'wordpress-move': { trial: true, paid: true },
				'php-import': { trial: false, paid: true },
				'php-static': { trial: true, paid: true },
			},
		},
		onCommit,
		...overrides,
	});
	wizard.render();
	return { wizard, provider, onCommit, dom };
}

function click(action) {
	document.querySelector(`[data-wizard-action="${action}"]`).click();
}

describe('customer onboarding wizard', () => {
	it('maps website choices and permits WordPress migration trials', () => {
		expect(websiteSelection('wordpress-move')).toEqual({
			intent: 'migration',
			siteType: 'wordpress',
		});
		expect(websiteSelection('php-import')).toEqual({ intent: 'migration', siteType: 'php' });
		expect(
			trialAllowed('wordpress-move', { setupMethods: { 'wordpress-move': { trial: true } } }),
		).toBe(true);
		expect(trialAllowed('php-import', { setupMethods: { 'php-import': { trial: false } } })).toBe(
			false,
		);
	});

	it('shows one step at a time and saves the choice on the server', async () => {
		const { wizard, provider } = mount();
		expect(document.body.textContent).toContain('Your website');
		expect(document.body.textContent).not.toContain('Review before continuing');
		document.querySelector('[value="wordpress-move"]').checked = true;
		click('website-next');
		expect(wizard.state.draft.step).toBe('account');
		expect(wizard.state.draft.siteType).toBe('wordpress');
		await vi.waitFor(() =>
			expect(provider.saveOnboarding).toHaveBeenCalledWith(
				'account-1',
				expect.objectContaining({ step: 'account', setupKind: 'wordpress-move' }),
			),
		);
		click('account-next');
		expect(document.body.textContent).toContain('Review before continuing');
	});

	it('allows a trial for WordPress migration and paid only for PHP import', () => {
		const { wizard } = mount();
		wizard.state.draft.setupKind = 'wordpress-move';
		wizard.state.draft.step = 'hosting';
		wizard.render();
		expect(document.querySelector('[value="trial"]')).not.toBeNull();
		wizard.state.draft.setupKind = 'php-import';
		wizard.render();
		expect(document.querySelector('[value="trial"]')).toBeNull();
		expect(document.querySelector('[value="paid"]')).not.toBeNull();
	});

	it('defaults to an eligible trial, then monthly when capacity fills, while keeping a valid paid choice', async () => {
		const { wizard } = mount();
		wizard.state.draft.setupKind = 'wordpress-move';
		wizard.state.draft.step = 'hosting';
		wizard.render();
		expect(document.querySelector('[name="planCode"]').value).toBe('starter');
		expect(document.querySelector('[value="trial"]').checked).toBe(true);
		expect(document.querySelector('.customer-wizard-summary').textContent).toContain('Starter');
		await wizard.update({
			trialEligibility: { canStartTrial: false, reason: 'trial_capacity_full' },
		});
		expect(document.querySelector('[value="paid"]').checked).toBe(true);
		wizard.state.draft.setupMode = 'paid';
		await wizard.update({ trialEligibility: { canStartTrial: true } });
		expect(document.querySelector('[value="paid"]').checked).toBe(true);
	});

	it('retains the plan and stops admission when trial capacity fills', async () => {
		const { wizard, onCommit } = mount({
			onRefreshOffers: vi.fn().mockResolvedValue({
				offers: [{ planCode: 'starter', trialAvailable: false, paidAvailable: true }],
				trialEligibility: { canStartTrial: false, reason: 'trial_capacity_full' },
			}),
		});
		wizard.state.draft.setupKind = 'wordpress-new';
		wizard.state.draft.siteType = 'wordpress';
		wizard.state.draft.step = 'hosting';
		wizard.render();
		document.querySelector('[name="websiteTitle"]').value = 'Example website';
		document.querySelector('[name="administratorEmail"]').value = 'owner@example.com';
		document.querySelector('[value="trial"]').checked = true;
		click('hosting-commit');
		await vi.waitFor(() =>
			expect(document.querySelector('[role="alert"]')?.textContent).toContain('trial filled'),
		);
		expect(wizard.state.draft.planCode).toBe('starter');
		expect(onCommit).not.toHaveBeenCalled();
	});

	it('loads an authenticated draft after returning on another device', async () => {
		const { wizard } = mount({
			provider: {
				readOnboarding: vi.fn().mockResolvedValue({
					draft: {
						step: 'domain',
						setupKind: 'wordpress-new',
						siteType: 'wordpress',
						serviceId: 'service-1',
						domain: 'example.com',
					},
					capabilities: {},
				}),
			},
		});
		await wizard.load();
		expect(wizard.state.draft.step).toBe('domain');
		expect(document.querySelector('[name="domain"]').value).toBe('example.com');
	});

	it('clears one account draft before loading a different account', async () => {
		const readOnboarding = vi
			.fn()
			.mockResolvedValueOnce({
				draft: { step: 'domain', serviceId: 'private-service', domain: 'private.example' },
				capabilities: {},
			})
			.mockResolvedValueOnce({ draft: null, capabilities: {} });
		const { wizard } = mount({ provider: { readOnboarding } });
		await wizard.load();
		await wizard.update({ accountId: 'account-2' });
		expect(wizard.state.draft.step).toBe('website');
		expect(wizard.state.draft.serviceId).toBe('');
		expect(wizard.state.draft.domain).toBe('');
		expect(readOnboarding).toHaveBeenLastCalledWith('account-2');
	});

	it('keeps typed domain input and focus during a background offer refresh', async () => {
		const { wizard, dom } = mount();
		wizard.state.draft.step = 'domain';
		wizard.render();
		const input = document.querySelector('[name="domain"]');
		input.focus();
		input.value = 'example.com';
		input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
		await wizard.update({ offers: [] });
		expect(document.querySelector('[name="domain"]')).toBe(input);
		expect(document.activeElement).toBe(input);
		expect(input.value).toBe('example.com');
	});

	it('returns native hosting review directly to website choice', () => {
		const { wizard } = mount({ mode: 'native' });
		wizard.state.draft.step = 'hosting';
		wizard.render();
		click('back');
		expect(wizard.state.draft.step).toBe('website');
		expect(document.querySelector('[data-wizard-action="website-next"]')).not.toBeNull();
	});

	it('preserves domain and ready steps when completed hosting status refreshes', async () => {
		const { wizard } = mount();
		wizard.state.draft.requestId = 'request-1';
		wizard.state.draft.serviceId = 'service-1';
		for (const step of ['domain', 'ready']) {
			wizard.state.draft.step = step;
			await wizard.update({
				setups: [{ requestId: 'request-1', serviceId: 'service-1', status: 'active' }],
			});
			expect(wizard.state.draft.step).toBe(step);
		}
	});

	it('submits a short-lived hosting grant by POST', async () => {
		const hostingAccess = vi.fn().mockResolvedValue({
			actionUrl: 'https://node.example.test/onboarding/access/',
			token: 'single-use-grant',
		});
		const { wizard, dom } = mount({ provider: { hostingAccess } });
		wizard.state.draft.step = 'ready';
		wizard.state.draft.serviceId = 'service-1';
		wizard.render();
		let submitted;
		vi.spyOn(dom.window.HTMLFormElement.prototype, 'submit').mockImplementation(function () {
			submitted = {
				method: this.method,
				action: this.action,
				target: this.target,
				grant: this.elements.grant.value,
			};
		});
		click('hosting-access');
		await vi.waitFor(() =>
			expect(submitted).toEqual({
				method: 'post',
				action: 'https://node.example.test/onboarding/access/',
				target: '_self',
				grant: 'single-use-grant',
			}),
		);
		expect(hostingAccess).toHaveBeenCalledWith('account-1', 'service-1');
	});
});
