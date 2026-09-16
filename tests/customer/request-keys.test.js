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
});
