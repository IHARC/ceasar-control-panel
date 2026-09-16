import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const source = (path) => readFile(new URL(path, import.meta.url), 'utf8');

describe('customer password recovery without MFA', () => {
	it('keeps a Supabase recovery password form and removes customer MFA controls', async () => {
		const [app, providers, login, account, callback] = await Promise.all([
			source('../../web/js/src/customer/app.js'),
			source('../../web/js/src/customer/providers.js'),
			source('../../web/templates/pages/customer/login.php'),
			source('../../web/templates/pages/customer/account.php'),
			source('../../web/templates/pages/customer/callback.php'),
		]);
		expect(providers).toContain('auth.updateUser({ password })');
		expect(app).toContain('data-customer-recovery');
		expect(callback).toContain('data-customer-recovery');
		for (const value of [app, providers, login, account]) {
			expect(value).not.toMatch(/mfa|aal2|authenticator/i);
		}
	});
});
