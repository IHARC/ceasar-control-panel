import { JSDOM } from 'jsdom';
import { afterEach, expect, it, vi } from 'vitest';

const original = { document: globalThis.document, Event: globalThis.Event };
afterEach(() => {
	Object.assign(globalThis, original);
});

it('re-enables Refresh status after its asynchronous account refresh completes', async () => {
	const dom = new JSDOM('<button type="button" data-refresh-setup>Refresh status</button>');
	globalThis.document = dom.window.document;
	globalThis.Event = dom.window.Event;
	const { bindAccountControls } = await import('../../web/js/src/customer/app.js');
	const backend = {
		accountState: vi.fn().mockResolvedValue({
			selectedAccountId: 'account-1',
			offers: [],
			trialEligibility: { canStartTrial: false },
			services: [],
			setups: [],
			billing: [],
		}),
		supportCases: vi.fn().mockResolvedValue({ accountId: 'account-1', cases: [] }),
	};
	const context = {
		accountId: 'account-1',
		accounts: [{ accountId: 'account-1', displayName: 'Example' }],
		identityState: { userId: 'user-1' },
		state: { services: [], setups: [], offers: [], billing: [] },
		accountRequestToken: 0,
		serviceRequestToken: 0,
		supportRequestToken: 0,
		supportDetailRequestToken: 0,
		checkoutRequestToken: 0,
		accountContextToken: 1,
	};
	bindAccountControls({}, {}, backend, context);
	const button = document.querySelector('[data-refresh-setup]');
	button.dispatchEvent(new Event('click', { bubbles: true }));
	expect(button.disabled).toBe(true);
	await vi.waitFor(() => expect(button.disabled).toBe(false));
	expect(backend.accountState).toHaveBeenCalledWith('account-1');
});
