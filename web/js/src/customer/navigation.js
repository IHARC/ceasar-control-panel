export function customerSetupSelection(search) {
	const parameters = new URLSearchParams(search);
	const candidatePlan = parameters.get('planCode')?.trim() || '';
	const planCode = /^[a-z0-9][a-z0-9_-]{0,63}$/.test(candidatePlan) ? candidatePlan : '';
	const intent = parameters.get('intent');
	return {
		planCode,
		intent: intent === 'migration' ? 'migration' : 'new_site',
	};
}

export function customerSetupUrl(baseUrl, selection, hash = 'setup') {
	const destination = new URL(baseUrl);
	if (!selection.planCode) return destination.toString();
	destination.searchParams.set('planCode', selection.planCode);
	destination.searchParams.set('intent', selection.intent);
	destination.hash = hash;
	return destination.toString();
}
