import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';

const original = {
	document: globalThis.document,
	location: globalThis.location,
	Option: globalThis.Option,
};

afterEach(() => Object.assign(globalThis, original));

async function setupPage() {
	const dom = new JSDOM(
		`
		<form data-setup-form>
			<select name="plan_code" data-plan-select></select><p data-plan-limits></p>
			<input type="radio" name="intent" value="new_site" checked>
			<input type="radio" name="intent" value="migration">
			<label data-site-type-label></label><select name="site_type"><option value="wordpress">WordPress</option><option value="php">PHP</option></select>
			<p data-migration-site-type hidden></p>
			<label data-trial-choice><input type="radio" name="setup_mode" value="trial"></label>
			<label data-paid-choice><input type="radio" name="setup_mode" value="paid"></label>
			<dl data-setup-review></dl><p data-setup-availability></p><button type="submit">Continue</button>
		</form>
		<div data-billing-summary></div><form data-billing-portal></form>
		<div data-support-layout><div data-support-case-list></div><button data-support-retry></button>
			<button data-support-next></button><div data-support-case-detail></div>
			<div data-support-message-list></div><form data-support-reply-form></form></div>
	`,
		{ url: 'https://app.example/customer/account#setup' },
	);
	globalThis.document = dom.window.document;
	globalThis.location = dom.window.location;
	globalThis.Option = dom.window.Option;
	return import('../../web/js/src/customer/app.js');
}

const offer = {
	planCode: 'starter',
	displayName: 'Starter',
	monthlyPriceCadCents: 1295,
	trialAvailable: true,
	paidAvailable: true,
};

describe('customer setup and empty states', () => {
	it('starts eligible new sites on trial and preserves an explicit paid choice', async () => {
		const { renderOffers } = await setupPage();
		const context = {
			setupPlanCode: 'starter',
			setupModeChosen: false,
			state: { offers: [offer], trialEligibility: { canStartTrial: true } },
		};
		renderOffers([offer], context);
		expect(document.querySelector('[value=trial]').checked).toBe(true);
		expect(document.querySelector('[data-setup-review]').textContent).toContain(
			'seven-day trial starts when hosting is ready',
		);
		const paid = document.querySelector('[value=paid]');
		paid.checked = true;
		context.setupModeChosen = true;
		renderOffers([offer], context);
		expect(paid.checked).toBe(true);
		expect(document.querySelector('[data-setup-review]').textContent).toContain('$12.95 CAD/month');
	});

	it('removes a full trial option and keeps import paid-only', async () => {
		const { renderOffers } = await setupPage();
		const context = {
			setupPlanCode: 'starter',
			setupModeChosen: false,
			state: { offers: [offer], trialEligibility: { canStartTrial: true } },
		};
		renderOffers([offer], context);
		context.state.trialEligibility = { canStartTrial: false, reason: 'trial_capacity_full' };
		renderOffers([{ ...offer, trialAvailable: false }], context);
		expect(document.querySelector('[data-trial-choice]').hidden).toBe(true);
		expect(document.querySelector('[data-paid-choice]').hidden).toBe(false);
		expect(document.querySelector('[value=paid]').checked).toBe(true);
		expect(document.querySelector('[data-setup-availability]').textContent).toContain(
			'currently full',
		);
		context.state.trialEligibility = { canStartTrial: true };
		renderOffers([offer], context);
		expect(document.querySelector('[value=trial]').checked).toBe(true);
		document.querySelector('[value=migration]').checked = true;
		renderOffers([offer], context);
		expect(document.querySelector('[data-trial-choice]').hidden).toBe(true);
		expect(document.querySelector('[value=paid]').checked).toBe(true);
	});

	it('asks for a new plan when the linked plan is no longer offered', async () => {
		const { renderOffers } = await setupPage();
		const context = {
			setupPlanCode: 'retired',
			setupModeChosen: false,
			state: { offers: [offer], trialEligibility: { canStartTrial: true } },
		};
		renderOffers([offer], context);
		expect(document.querySelector('[data-plan-select]').value).toBe('');
		expect(document.querySelector('[data-setup-form] button').disabled).toBe(true);
		expect(document.querySelector('[data-setup-availability]').textContent).toContain(
			'Choose another plan',
		);
	});

	it('shows the case form alone for a true empty list and preserves filtered search', async () => {
		const { renderSupportCases } = await setupPage();
		const context = { supportPage: 1, supportSearch: '', supportHasMore: false };
		renderSupportCases([], context);
		expect(document.querySelector('[data-support-layout]').hidden).toBe(true);
		context.supportSearch = 'missing';
		renderSupportCases([], context);
		expect(document.querySelector('[data-support-layout]').hidden).toBe(false);
		expect(document.querySelector('[data-support-case-list]').textContent).toContain(
			'No cases match',
		);
	});

	it('links empty billing to pending setup or a new setup', async () => {
		const { renderBilling } = await setupPage();
		const context = { accountId: 'account', state: { setups: [] } };
		renderBilling([], context);
		expect(document.querySelector('[data-billing-summary] a').getAttribute('href')).toBe('#setup');
		context.state.setups = [{ status: 'checkout' }];
		renderBilling([], context);
		expect(document.querySelector('[data-billing-summary] a').getAttribute('href')).toBe(
			'#hosting',
		);
	});
});
