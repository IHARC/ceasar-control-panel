import { describe, expect, it, vi } from 'vitest';
import { createRequestKeys } from '../../web/js/src/customer/request-keys.js';

describe('customer request idempotency keys', () => {
	it('retains one key while a failed or pending form can be retried', () => {
		const randomUuid = vi.fn().mockReturnValueOnce('request-1').mockReturnValueOnce('request-2');
		const keys = createRequestKeys(randomUuid);
		const form = {};
		expect(keys.current(form)).toBe('request-1');
		expect(keys.current(form)).toBe('request-1');
		expect(randomUuid).toHaveBeenCalledOnce();
	});

	it('creates a new key after success or changed input clears the old one', () => {
		const randomUuid = vi.fn().mockReturnValueOnce('request-1').mockReturnValueOnce('request-2');
		const keys = createRequestKeys(randomUuid);
		const form = {};
		expect(keys.current(form)).toBe('request-1');
		keys.clear(form);
		expect(keys.current(form)).toBe('request-2');
	});

	it('persists a setup key before submit so a reload resumes the same request', () => {
		const storage = new Map();
		const sessionStorage = {
			getItem: (key) => storage.get(key) || null,
			setItem: (key, value) => storage.set(key, value),
			removeItem: (key) => storage.delete(key),
		};
		const first = createRequestKeys(() => 'setup-request-1', sessionStorage);
		const second = createRequestKeys(() => 'setup-request-2', sessionStorage);
		const originalForm = { dataset: { requestKey: 'hosting-setup' } };
		const reloadedForm = { dataset: { requestKey: 'hosting-setup' } };
		expect(first.current(originalForm)).toBe('setup-request-1');
		first.save(originalForm, {
			accountId: 'account-1',
			planCode: 'plus',
			intent: 'migration',
			siteType: 'php',
			setupMode: 'paid',
		});
		expect(second.current(reloadedForm)).toBe('setup-request-1');
		expect(second.read(reloadedForm)).toEqual({
			idempotencyKey: 'setup-request-1',
			accountId: 'account-1',
			planCode: 'plus',
			intent: 'migration',
			siteType: 'php',
			setupMode: 'paid',
		});
		second.clear(reloadedForm);
		expect(second.current({ dataset: { requestKey: 'hosting-setup' } })).toBe('setup-request-2');
	});

	it('does not reuse an account-scoped key after the same form changes scope', () => {
		const storage = new Map();
		const sessionStorage = {
			getItem: (key) => storage.get(key) || null,
			setItem: (key, value) => storage.set(key, value),
			removeItem: (key) => storage.delete(key),
		};
		const keys = createRequestKeys(
			vi.fn().mockReturnValueOnce('account-a-key').mockReturnValueOnce('account-b-key'),
			sessionStorage,
		);
		const form = { dataset: { requestKey: 'support-open:user:account-a' } };
		expect(keys.current(form)).toBe('account-a-key');
		form.dataset.requestKey = 'support-open:user:account-b';
		expect(keys.current(form)).toBe('account-b-key');
		form.dataset.requestKey = 'support-open:user:account-a';
		expect(keys.current(form)).toBe('account-a-key');
	});
});
