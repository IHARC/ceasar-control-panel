import { CustomerBusinessBackend } from '../../../web/js/src/customer/providers.js';

// This local-only identity is supplied to the real customer provider. It never
// reaches Supabase; support operations still call the native fixture API.
const identity = {
	async session() {
		return { access_token: 'fixture-customer-token' };
	},
	async user() {
		return { id: 'customer-1', email: 'customer@example.test' };
	},
	async signOut() {},
	async listPasskeys() {
		return [];
	},
	async updateProfile() {},
	async updateEmail() {},
	async updatePassword() {},
	async registerPasskey() {},
	async deletePasskey() {},
};
const backend = new CustomerBusinessBackend(identity, '/fixture/customer-api');

// Hosting and account state are fixture data. Do not replace the inherited
// support and attachment methods: they are what the preview exercises.
Object.assign(backend, {
	async sessionState() {
		return {
			identity: {
				userId: 'customer-1',
				email: 'customer@example.test',
				displayName: 'Alex Morgan',
			},
			accounts: [{ accountId: 'account-1', displayName: 'Example Studio' }],
			selectedAccountId: 'account-1',
		};
	},
	async accountState() {
		const trialAvailable = new URLSearchParams(location.search).get('previewCap') !== 'full';
		return {
			services: [],
			setups: [],
			billing: [],
			trialEligibility: trialAvailable
				? { status: 'eligible', canStartTrial: true, reason: 'trial_available' }
				: { status: 'unavailable', canStartTrial: false, reason: 'trial_capacity_full' },
			offers: [
				{
					planCode: 'starter',
					displayName: 'Starter',
					monthlyPriceCadCents: 1295,
					websiteLimit: 1,
					storageBytes: 5368709120,
					transferBytes: 10737418240,
					trialAvailable,
					paidAvailable: true,
				},
			],
		};
	},
});

if (new URLSearchParams(location.search).has('previewEmptySupport')) {
	backend.supportCases = async () => ({ cases: [], page: 1, totalPages: 1 });
}

window.__CEASAR_CUSTOMER_PREVIEW__ = { identity, backend };
