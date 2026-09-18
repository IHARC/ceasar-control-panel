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
		return { services: [], setups: [], offers: [], billing: [] };
	},
});

window.__CEASAR_CUSTOMER_PREVIEW__ = { identity, backend };
