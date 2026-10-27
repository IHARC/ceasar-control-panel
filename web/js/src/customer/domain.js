/** Present the native DNS contract consistently for enrollment and native users. */
export function domainConnectionView(result = {}) {
	const message =
		result.message ||
		(result.status === 'connected'
			? 'Your domain is connected over HTTPS.'
			: result.status === 'failed'
				? 'Connection needs attention. Check DNS, then retry connecting the domain.'
				: result.conflictingAddresses?.length
					? 'Remove conflicting web address records, then check again. Keep existing mail records.'
					: result.ownershipReady === false
						? 'Add the TXT verification record to prove control of this domain, then check again.'
						: result.dnsReady === false
							? 'Add the web address records at your DNS provider, then check again.'
							: ['queued', 'running', 'rewriting'].includes(result.status)
								? 'Domain connection is in progress. Check again shortly.'
								: 'Your certificate is being prepared. Check again shortly.');
	return {
		...result,
		message,
		certificateStatus: result.certificateStatus || (result.certificateReady ? 'ready' : 'pending'),
		checks: [
			...(typeof result.dnsReady === 'boolean'
				? [`Website address: ${result.dnsReady ? 'ready' : 'add DNS records'}`]
				: []),
			...(typeof result.ownershipReady === 'boolean'
				? [`Domain ownership: ${result.ownershipReady ? 'verified' : 'add the TXT record'}`]
				: []),
			...(typeof result.wwwReady === 'boolean'
				? [`www address: ${result.wwwReady ? 'ready' : 'add DNS records'}`]
				: []),
		],
	};
}
