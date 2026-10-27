import { expect, it } from 'vitest';
import { domainConnectionView } from '../../web/js/src/customer/domain.js';

it('turns the actual native DNS contract into actionable customer status', () => {
	const pending = domainConnectionView({
		status: 'awaiting_dns',
		dnsReady: true,
		ownershipReady: false,
		wwwReady: false,
		certificateReady: false,
	});
	expect(pending.message).toContain('TXT verification');
	expect(pending.certificateStatus).toBe('pending');
	expect(pending.checks).toEqual([
		'Website address: ready',
		'Domain ownership: add the TXT record',
		'www address: add DNS records',
	]);
	const conflicting = domainConnectionView({
		conflictingAddresses: ['192.0.2.1'],
		dnsReady: false,
	});
	expect(conflicting.message).toContain('conflicting web address');
	expect(
		domainConnectionView({ status: 'connected', certificateReady: true }).certificateStatus,
	).toBe('ready');
});
