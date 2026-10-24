import { JSDOM } from 'jsdom';
import { afterEach, expect, it, vi } from 'vitest';
import { createAuthCaptcha } from '../../web/js/src/customer/captcha.js';

const original = { document: globalThis.document, turnstile: globalThis.turnstile };
afterEach(() => Object.assign(globalThis, original));

it('requires a fresh Turnstile token and resets after expiry', async () => {
	const dom = new JSDOM('<form><div data-customer-captcha tabindex="-1"></div></form>');
	globalThis.document = dom.window.document;
	let callbacks;
	const reset = vi.fn();
	globalThis.turnstile = {
		render: vi.fn((_mount, options) => {
			callbacks = options;
			return 'widget-1';
		}),
		reset,
	};
	const form = document.querySelector('form');
	const captcha = await createAuthCaptcha({ captchaEnabled: true, turnstileSiteKey: 'site-key' }, [
		form,
	]);
	expect(() => captcha.token(form)).toThrow('Complete the security check');
	callbacks.callback('one-use-token');
	expect(captcha.token(form)).toBe('one-use-token');
	callbacks['expired-callback']();
	expect(reset).toHaveBeenCalledWith('widget-1');
	expect(() => captcha.token(form)).toThrow('Complete the security check');
	captcha.reset(form);
	expect(reset).toHaveBeenCalledTimes(2);
});

it('allows another load after the Turnstile script fails', async () => {
	const dom = new JSDOM('<form><div data-customer-captcha></div></form>');
	globalThis.document = dom.window.document;
	globalThis.turnstile = undefined;
	const form = document.querySelector('form');
	const config = { captchaEnabled: true, turnstileSiteKey: 'site-key' };
	const failed = expect(createAuthCaptcha(config, [form])).rejects.toThrow('could not load');
	const first = document.querySelector('script[src*="turnstile"]');
	first.dispatchEvent(new dom.window.Event('error'));
	await failed;
	expect(first.isConnected).toBe(false);
	const retry = createAuthCaptcha(config, [form]);
	const second = document.querySelector('script[src*="turnstile"]');
	expect(second).not.toBe(first);
	globalThis.turnstile = { render: vi.fn().mockReturnValue('widget-2'), reset: vi.fn() };
	second.dispatchEvent(new dom.window.Event('load'));
	await expect(retry).resolves.toHaveProperty('token');
});
