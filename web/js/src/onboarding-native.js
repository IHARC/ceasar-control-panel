import { createOnboardingWizard } from './customer/wizard.js';

const root = document.querySelector('[data-onboarding-wizard]');
if (root) {
	const accountId = document.body.dataset.ceasarUser;
	const csrf = document.querySelector('meta[name="ceasar-csrf"]')?.content || '';
	let wizard;
	async function request(action, input = {}) {
		const controller = new AbortController();
		const deadline = setTimeout(() => controller.abort(), 20_000);
		let response;
		let result;
		try {
			response = await fetch('/onboarding/api/', {
				method: 'POST',
				credentials: 'same-origin',
				signal: controller.signal,
				headers: { 'Content-Type': 'application/json', 'X-Ceasar-CSRF': csrf },
				body: JSON.stringify({ action, ...input }),
			});
			result = await response.json();
		} finally {
			clearTimeout(deadline);
		}
		if (!response.ok) throw new Error(result.error || 'This setup action could not be completed.');
		return result;
	}
	function serviceHost(serviceId) {
		return serviceId || wizard?.state.draft.hostname;
	}
	function domainView(result, domain) {
		return {
			...result,
			status: result.status === 'connected' ? 'ready' : result.status,
			certificateStatus: result.certificateReady ? 'ready' : 'pending',
			message:
				result.status === 'connected'
					? 'Your domain is connected to this website.'
					: !result.ownershipReady
						? 'Add the TXT verification record to prove control of this domain. Keep your mail records.'
						: result.dnsReady
							? 'DNS is correct. The certificate is being prepared.'
							: result.conflictingAddresses?.length
								? 'Remove conflicting web address records before connecting. Keep mail records.'
								: 'Add the web address record at your DNS provider, then check again.',
			records:
				result.records ||
				(result.expectedAddresses || []).map((value) => ({
					type: value.includes(':') ? 'AAAA' : 'A',
					name: domain,
					value,
				})),
		};
	}
	const provider = {
		readOnboarding: () => request('read-draft'),
		retryOnboarding: (_account, _service, operationId) => request('retry', { operationId }),
		saveOnboarding: (_account, draft) => request('save-draft', { draft }),
		serviceOnboarding: async () => {
			const operationId = wizard.state.draft.requestId;
			if (!operationId) return { status: 'queued', message: 'Preparation is queued.' };
			return {
				...(await request('status', { operationId })),
				previewUrl: `https://${wizard.state.draft.hostname}/`,
			};
		},
		// This page already has the owner's native Ceasar session.
		hostingAccess: async () => ({ url: new URL('/list/web/', location.origin).href }),
		wordpressAccess: (_account, serviceId, userId) =>
			request('wordpress-access', {
				hostname: serviceHost(serviceId),
				administrator: userId || 'wpadmin',
				...(userId ? { userId } : {}),
			}),
		domainStatus: async (_account, serviceId, domain) =>
			domainView(
				await request('domain-status', { hostname: serviceHost(serviceId), domain }),
				domain,
			),
		connectDomain: async (_account, serviceId, domain) =>
			domainView(
				await request('connect-domain', { hostname: serviceHost(serviceId), domain }),
				domain,
			),
		confirmMigration: (_serviceId, { workspaceReadyOperationId }) =>
			request('confirm-migration', {
				operationId: workspaceReadyOperationId || wizard.state.draft.requestId,
				customerAttestsImportComplete: true,
			}),
	};
	async function idempotencyKey(draft) {
		const bytes = new TextEncoder().encode(
			[accountId, draft.hostname, draft.siteType, draft.intent].join('\0'),
		);
		const hash = await crypto.subtle.digest('SHA-256', bytes);
		return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
	}
	wizard = createOnboardingWizard({
		root,
		provider,
		accountId,
		mode: 'native',
		onCommit: async (draft) =>
			request('prepare', {
				idempotencyKey: await idempotencyKey(draft),
				hostname: draft.hostname,
				siteType: draft.siteType === 'static' ? 'static' : draft.siteType,
				intent: draft.intent,
				siteTitle: draft.websiteTitle || 'Website',
				contactEmail: draft.administratorEmail || document.body.dataset.ceasarEmail || '',
			}),
	});
	wizard.render();
	wizard.load();
}
