import { describe, expect, it } from 'vitest';
import { customerSetupSelection, customerSetupUrl } from '../../web/js/src/customer/navigation.js';

describe('customer setup navigation', () => {
	it('preserves a selected plan and import intent across account and login routes', () => {
		const selection = customerSetupSelection('?planCode=plus&intent=migration');
		expect(selection).toEqual({ planCode: 'plus', intent: 'migration' });
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
		});
	});
});
