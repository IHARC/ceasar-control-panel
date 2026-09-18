import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initSupportSettings } from '../../web/js/src/support-settings.js';

const originalDocument = globalThis.document;
const originalFormData = globalThis.FormData;

afterEach(() => {
	globalThis.document = originalDocument;
	globalThis.FormData = originalFormData;
});

describe('support settings editor', () => {
	it('loads nested OAuth values and saves effective ticket URLs and IMAP encryption', async () => {
		const dom = new JSDOM('<div data-support-settings-editor></div>');
		globalThis.document = dom.window.document;
		globalThis.FormData = dom.window.FormData;
		const request = vi.fn(async (_action, method, _payload) => {
			if (method === 'POST') return { saved: true };
			return {
				settings: {
					staffRecipients: ['staff@example.test'],
					inboundAddress: 'reply@example.test',
					supportUrl: 'https://customer.example.test/support',
					adminSupportUrl: 'https://admin.example.test/list/support',
					imap: {
						host: 'outlook.office365.com',
						port: 993,
						encryption: 'tls',
						username: 'support@example.test',
						authentication: 'oauth2',
						folder: 'Support',
						oauth: {
							grant_type: 'refresh_token',
							tenant: 'tenant-1',
							client_id: 'client-1',
							scope: 'offline_access',
						},
					},
				},
			};
		});
		await initSupportSettings({ request, error: vi.fn() });
		const form = document.querySelector('.support-settings-form');
		expect(form.elements.imap_oauth_grant_type.value).toBe('refresh_token');
		expect(form.elements.imap_oauth_tenant.value).toBe('tenant-1');
		expect(form.elements.imap_oauth_client_id.value).toBe('client-1');
		expect(form.elements.imap_oauth_scope.value).toBe('offline_access');
		expect(form.elements.imap_encryption.value).toBe('tls');
		await form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
		await vi.waitFor(() =>
			expect(request).toHaveBeenCalledWith('settings', 'POST', expect.any(Object)),
		);
		expect(request.mock.calls[1][2].settings).toMatchObject({
			support_url: 'https://customer.example.test/support',
			admin_support_url: 'https://admin.example.test/list/support',
			imap: {
				encryption: 'tls',
				oauth: {
					grant_type: 'refresh_token',
					tenant: 'tenant-1',
					client_id: 'client-1',
					scope: 'offline_access',
				},
			},
		});
	});
});
