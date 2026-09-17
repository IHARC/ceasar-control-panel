import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const source = (path) => readFile(new URL(path, import.meta.url), 'utf8');

describe('customer support UI contract', () => {
	it('does not offer or send an unsupported service identifier', async () => {
		const [account, app, providers] = await Promise.all([
			source('../../web/templates/pages/customer/account.php'),
			source('../../web/js/src/customer/app.js'),
			source('../../web/js/src/customer/providers.js'),
		]);
		expect(account).not.toContain('data-service-select-optional');
		expect(account).not.toContain('name="service_id"');
		expect(app).not.toContain('serviceId: clean(data.service_id)');
		expect(providers).not.toContain('serviceId: serviceId || null');
	});

	it('shows the existing account creation form before empty-account hosting and support actions', async () => {
		const [account, app] = await Promise.all([
			source('../../web/templates/pages/customer/account.php'),
			source('../../web/js/src/customer/app.js'),
		]);
		expect(account.match(/data-account-action="account-create"/g)).toHaveLength(1);
		expect(account).toContain('id="account-onboarding"');
		expect(account).toContain('Create your account to start hosting or contact support.');
		expect(account).toContain('href="#account-onboarding"');
		expect(account).toContain('data-support-account-required');
		expect(account).toContain('data-support-actions');
		expect(app).toContain("'[data-account-onboarding]'");
		expect(app).toContain("'[data-support-account-required]'");
		expect(app).toContain("'[data-support-actions]'");
	});

	it('hydrates every matching display-name field so the profile input is not skipped', async () => {
		const app = await source('../../web/js/src/customer/app.js');
		expect(app).toContain('for (const element of document.querySelectorAll(selector))');
	});
});
