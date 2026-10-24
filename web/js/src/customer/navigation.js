export function customerSetupSelection(search) {
	const parameters = new URLSearchParams(search);
	const candidatePlan = parameters.get('planCode')?.trim() || '';
	const planCode = /^[a-z0-9][a-z0-9_-]{0,63}$/.test(candidatePlan) ? candidatePlan : '';
	const intent = parameters.get('intent');
	const setupKind = parameters.get('setupKind');
	const siteType = parameters.get('siteType');
	const linkedKind =
		intent === 'migration'
			? siteType === 'wordpress'
				? 'wordpress-move'
				: siteType === 'php'
					? 'php-import'
					: ''
			: siteType === 'wordpress'
				? 'wordpress-new'
				: siteType === 'php' || siteType === 'static'
					? 'php-static'
					: '';
	const resolvedKind = ['wordpress-new', 'wordpress-move', 'php-import', 'php-static'].includes(
		setupKind,
	)
		? setupKind
		: linkedKind;
	return {
		planCode,
		intent: resolvedKind
			? ['wordpress-move', 'php-import'].includes(resolvedKind)
				? 'migration'
				: 'new_site'
			: intent === 'migration'
				? 'migration'
				: 'new_site',
		setupKind: resolvedKind,
	};
}

export function customerSetupUrl(baseUrl, selection, hash = 'setup') {
	const destination = new URL(baseUrl);
	if (!selection.planCode && !selection.setupKind) return destination.toString();
	if (selection.planCode) destination.searchParams.set('planCode', selection.planCode);
	if (selection.setupKind) destination.searchParams.set('setupKind', selection.setupKind);
	if (selection.planCode || selection.setupKind)
		destination.searchParams.set('intent', selection.intent);
	destination.hash = hash;
	return destination.toString();
}
