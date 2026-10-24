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

	it('uses one wizard and independent support controls', async () => {
		const [account, app, wizard, styles] = await Promise.all([
			source('../../web/templates/pages/customer/account.php'),
			source('../../web/js/src/customer/app.js'),
			source('../../web/js/src/customer/wizard.js'),
			source('../../web/css/src/customer.css'),
		]);
		expect(account).toContain('data-customer-view="setup"');
		expect(account.match(/data-onboarding-wizard/g)).toHaveLength(1);
		expect(account).not.toContain('data-setup-form');
		expect(wizard).toContain("'wordpress-move'");
		expect(wizard).toContain("'php-import'");
		expect(wizard).toContain("'php-static'");
		expect(wizard).toContain('createOnboardingWizard');
		expect(account).toContain('Follow the confirmation instructions sent to your email addresses.');
		expect(account).not.toContain('confirmation link to the new address');
		expect(app).toContain('createOnboardingWizard');
		expect(account).not.toContain('without checkout');
		expect(account).toContain('data-support-account-required');
		expect(account).toContain('data-support-actions');
		expect(account).toContain('data-support-case-list');
		expect(app).toContain('Support cases could not be loaded. Try again or use the contact link.');
		expect(app).toContain("'[data-support-account-required]'");
		expect(app).toContain("'[data-support-actions]'");
		expect(styles).toContain('.page-customer [hidden]');
		expect(styles).toContain('display: none !important;');
	});

	it('hydrates every matching display-name field so the profile input is not skipped', async () => {
		const app = await source('../../web/js/src/customer/app.js');
		expect(app).toContain('for (const element of document.querySelectorAll(selector))');
	});
});
