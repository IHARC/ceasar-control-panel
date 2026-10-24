import { describe, expect, it } from 'vitest';
import { customerSetupSelection, customerSetupUrl } from '../../web/js/src/customer/navigation.js';

describe('customer setup navigation', () => {
	it('preserves a selected plan and import intent across account and login routes', () => {
		const selection = customerSetupSelection('?planCode=plus&intent=migration');
		expect(selection).toEqual({ planCode: 'plus', intent: 'migration', setupKind: '' });
		expect(customerSetupUrl('https://app.example/customer/login', selection, '')).toBe(
			'https://app.example/customer/login?planCode=plus&intent=migration',
		);
		expect(customerSetupUrl('https://app.example/customer/account', selection)).toBe(
			'https://app.example/customer/account?planCode=plus&intent=migration#setup',
		);
	});

	it('normalizes an unsupported intent to a new-site setup', () => {
		expect(customerSetupSelection('?planCode=starter&intent=other')).toEqual({
			planCode: 'starter',
			intent: 'new_site',
			setupKind: '',
		});
	});

	it('leaves ordinary account navigation unchanged when no plan was selected', () => {
		expect(
			customerSetupUrl('https://app.example/customer/account', customerSetupSelection('')),
		).toBe('https://app.example/customer/account');
	});

	it('drops malformed plan identifiers instead of carrying them through authentication', () => {
		expect(customerSetupSelection('?planCode=%2Fadmin&intent=migration')).toEqual({
			planCode: '',
			intent: 'migration',
			setupKind: '',
		});
	});

	it('carries a WordPress migration choice across confirmation', () => {
		const selection = customerSetupSelection('?planCode=plus&intent=migration&siteType=wordpress');
		expect(selection.setupKind).toBe('wordpress-move');
		expect(customerSetupUrl('https://app.example/customer/callback', selection, '')).toBe(
			'https://app.example/customer/callback?planCode=plus&setupKind=wordpress-move&intent=migration',
		);
	});

	it('keeps a direct migration choice consistent when intent is omitted', () => {
		expect(customerSetupSelection('?setupKind=wordpress-move').intent).toBe('migration');
		expect(customerSetupSelection('?setupKind=php-import&intent=new_site').intent).toBe(
			'migration',
		);
	});
});
