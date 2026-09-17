import { JSDOM } from 'jsdom';
import { afterEach, expect, it, vi } from 'vitest';

const originalDocument = globalThis.document;
afterEach(() => {
	globalThis.document = originalDocument;
});

it('refreshes a selected service into its import workspace handoff without duplicate hosting access', async () => {
	const dom = new JSDOM(`
		<p data-service-empty></p><div data-service-list></div><div class="u-hidden" data-service-detail></div>
	`);
	globalThis.document = dom.window.document;
	const { refreshSelectedServiceDetail } = await import('../../web/js/src/customer/app.js');
	const context = {
		accountId: 'account-1',
		serviceId: 'service-import',
		serviceRequestToken: 0,
		state: {
			accounts: [{ accountId: 'account-1', displayName: 'Example' }],
			selectedAccountId: 'account-1',
			trialEligibility: { canStartTrial: false },
			offers: [],
			services: [
				{ serviceId: 'service-import', hostname: 'import.example.test', status: 'active' },
			],
			setups: [],
			billing: [],
		},
	};
	const backend = {
		serviceState: vi.fn().mockResolvedValue({
			service: {
				serviceId: 'service-import',
				hostname: 'import.example.test',
				status: 'active',
				nativeAccess: {
					accessState: 'ready',
					panelOrigin: 'https://panel.example.test/',
					sftpHostname: 'sftp.example.test',
					sftpPort: 22,
					providerUsername: 'native-user',
				},
				migration: {
					status: 'ready',
					workspaceReadyOperationId: 'workspace-1',
					previewHostname: 'import.example.test',
					panelOrigin: 'https://panel.example.test/',
					sftpHostname: 'sftp.example.test',
					sftpPort: 22,
					providerUsername: 'migration-user',
				},
			},
		}),
	};

	await expect(refreshSelectedServiceDetail(backend, context, 'service-import')).resolves.toBe(
		true,
	);

	expect(document.querySelector('[data-service-detail]').textContent).toContain('Import workspace');
	expect(document.querySelector('[data-service-detail]').textContent).toContain('migration-user');
	expect(document.querySelector('[data-service-detail]').textContent).not.toContain(
		'Hosting access',
	);
	expect(document.querySelector('[data-service-detail]').textContent).not.toContain('native-user');
});
