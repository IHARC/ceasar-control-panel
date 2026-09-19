const CONSENT_COOKIE = 'iharc_analytics_consent';
const REVOCATION_COOKIE = 'iharc_analytics_revoke';
const CONSENT_MAX_AGE = 60 * 60 * 24 * 180;

export function configureAnalytics(config) {
	const analytics = config?.analytics || {};
	const measurementId = validMeasurementId(analytics.measurementId) ? analytics.measurementId : '';
	const cookieDomain = validCookieDomain(analytics.consentCookieDomain)
		? analytics.consentCookieDomain
		: '';
	const listeners = new Set();
	let loading;
	let consentVersion = 0;

	const controller = {
		configured: Boolean(measurementId),
		consent: () => readConsent() === 'granted',
		onChange(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		async track(name, parameters = {}) {
			if (readConsent() !== 'granted' || !measurementId) return;
			try {
				await loadTag();
				if (readConsent() !== 'granted' || globalThis[`ga-disable-${measurementId}`]) return;
				globalThis.gtag('event', name, parameters);
			} catch {
				// Measurement failures must never affect customer actions.
			}
		},
		async identifiers() {
			if (readConsent() !== 'granted' || !measurementId) return {};
			await loadTag();
			if (readConsent() !== 'granted' || globalThis[`ga-disable-${measurementId}`]) return {};
			return getIdentifiers(measurementId);
		},
		setConsent(granted) {
			consentVersion += 1;
			writeConsent(granted ? 'granted' : 'denied', cookieDomain);
			if (granted) {
				globalThis[`ga-disable-${measurementId}`] = false;
				loadTag()
					.then(() => {
						if (readConsent() !== 'granted' || globalThis[`ga-disable-${measurementId}`]) return;
						globalThis.gtag('consent', 'update', grantedConsent());
						trackPageView(measurementId);
					})
					.catch(() => {});
			} else {
				globalThis[`ga-disable-${measurementId}`] = true;
				queueConsent('update', deniedConsent());
				clearGoogleCookies(cookieDomain);
			}
			for (const listener of listeners) listener(granted, consentVersion);
		},
		pageView() {
			if (readConsent() === 'granted' && measurementId)
				loadTag()
					.then(() => {
						if (readConsent() === 'granted' && !globalThis[`ga-disable-${measurementId}`])
							trackPageView(measurementId);
					})
					.catch(() => {});
		},
		storeRevocationToken(token) {
			if (!validRevocationToken(token)) return;
			writeCookie(REVOCATION_COOKIE, token, cookieDomain);
		},
		clearRevocationToken() {
			clearCookie(REVOCATION_COOKIE, cookieDomain);
		},
	};

	if (!measurementId) return controller;
	installConsentControls(controller, config?.privacyUrl);
	if (readConsent() === 'granted') controller.pageView();
	if (readConsent() === 'denied') {
		globalThis[`ga-disable-${measurementId}`] = true;
		queueConsent('default', deniedConsent());
		clearGoogleCookies(cookieDomain);
	}
	return controller;

	function loadTag() {
		if (loading) return loading;
		loading = new Promise((resolve, reject) => {
			queueConsent('default', deniedConsent());
			globalThis.gtag('js', new Date());
			if (readConsent() === 'granted') globalThis.gtag('consent', 'update', grantedConsent());
			globalThis.gtag('config', measurementId, {
				send_page_view: false,
				allow_google_signals: false,
				allow_ad_personalization_signals: false,
				page_location: `${location.origin}${location.pathname}`,
				page_referrer: safeReferrer(),
			});
			const script = document.createElement('script');
			script.async = true;
			script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
			script.onload = resolve;
			script.onerror = () => reject(new Error('Analytics tag could not be loaded.'));
			document.head.append(script);
		});
		return loading;
	}
}

function queueConsent(action, settings) {
	globalThis.dataLayer = globalThis.dataLayer || [];
	globalThis.gtag = function gtag() {
		globalThis.dataLayer.push(arguments);
	};
	globalThis.gtag('consent', action, settings);
}

function deniedConsent() {
	return {
		analytics_storage: 'denied',
		ad_storage: 'denied',
		ad_user_data: 'denied',
		ad_personalization: 'denied',
	};
}

function grantedConsent() {
	return {
		analytics_storage: 'granted',
		ad_storage: 'granted',
		ad_user_data: 'granted',
		ad_personalization: 'granted',
	};
}

function installConsentControls(controller, privacyUrl) {
	const footer = document.querySelector('[data-analytics-preferences]');
	if (footer) {
		footer.hidden = false;
		footer.addEventListener('click', () => showDialog(controller, privacyUrl));
	}
	if (!readConsent()) showDialog(controller, privacyUrl, true);
}

function showDialog(controller, privacyUrl, immediate = false) {
	let dialog = document.querySelector('[data-analytics-consent]');
	if (!dialog) {
		dialog = document.createElement('section');
		dialog.className = 'customer-analytics-consent';
		dialog.dataset.analyticsConsent = '';
		dialog.setAttribute('role', 'dialog');
		dialog.setAttribute('aria-label', 'Analytics preferences');
		const copy = document.createElement('p');
		copy.append(
			'Allow Google Analytics and Google Ads measurement to understand visits and whether hosting becomes a paid service? We do not send your email, support messages, or website content. ',
		);
		if (typeof privacyUrl === 'string' && privacyUrl.startsWith('https://')) {
			const link = document.createElement('a');
			link.href = privacyUrl;
			link.textContent = 'Read the Privacy Policy.';
			copy.append(link);
		}
		const actions = document.createElement('div');
		actions.className = 'customer-actions';
		const accept = document.createElement('button');
		accept.className = 'button';
		accept.type = 'button';
		accept.dataset.analyticsAccept = '';
		accept.textContent = 'Allow analytics';
		const decline = document.createElement('button');
		decline.className = 'button button-secondary';
		decline.type = 'button';
		decline.dataset.analyticsDecline = '';
		decline.textContent = 'Decline';
		actions.append(accept, decline);
		dialog.append(copy, actions);
		dialog.querySelector('[data-analytics-accept]').addEventListener('click', () => {
			controller.setConsent(true);
			dialog.remove();
		});
		dialog.querySelector('[data-analytics-decline]').addEventListener('click', () => {
			controller.setConsent(false);
			dialog.remove();
		});
		document.body.append(dialog);
	}
	if (immediate) dialog.querySelector('[data-analytics-accept]')?.focus();
}

function trackPageView(measurementId) {
	globalThis.gtag('event', 'page_view', {
		send_to: measurementId,
		page_location: `${location.origin}${location.pathname}`,
		page_referrer: safeReferrer(),
		page_title: document.title,
	});
}

function safeReferrer() {
	try {
		const referrer = new URL(document.referrer);
		return `${referrer.origin}${referrer.pathname}`;
	} catch {
		return '';
	}
}

function getIdentifiers(measurementId) {
	return new Promise((resolve) => {
		let clientId = '';
		let sessionId = '';
		let completed = false;
		const complete = () => {
			if (completed) return;
			completed = true;
			clearTimeout(timeout);
			resolve({ ...(clientId ? { clientId } : {}), ...(sessionId ? { sessionId } : {}) });
		};
		const timeout = setTimeout(complete, 1000);
		globalThis.gtag('get', measurementId, 'client_id', (value) => {
			clientId = typeof value === 'string' ? value : '';
			globalThis.gtag('get', measurementId, 'session_id', (session) => {
				sessionId =
					typeof session === 'string' || typeof session === 'number' ? String(session) : '';
				complete();
			});
		});
	});
}

function readConsent() {
	const value = document.cookie
		.split('; ')
		.find((row) => row.startsWith(`${CONSENT_COOKIE}=`))
		?.split('=')[1];
	return value === 'granted' || value === 'denied' ? value : '';
}

function writeConsent(value, domain) {
	writeCookie(CONSENT_COOKIE, value, domain);
}

function writeCookie(name, value, domain) {
	document.cookie = `${name}=${value}; Max-Age=${CONSENT_MAX_AGE}; Path=/; SameSite=Lax; Secure${domain ? `; Domain=${domain}` : ''}`;
}

function clearCookie(name, domain) {
	for (const candidate of ['', domain]) {
		document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax; Secure${candidate ? `; Domain=${candidate}` : ''}`;
	}
}

function clearGoogleCookies(domain) {
	for (const cookie of document.cookie.split('; ')) {
		const name = cookie.split('=', 1)[0];
		if (!/^_(?:ga|gid|gat|gcl)(?:_|$)/.test(name)) continue;
		clearCookie(name, domain);
	}
}

function validMeasurementId(value) {
	return typeof value === 'string' && /^G-[A-Z0-9]{4,32}$/.test(value);
}

function validCookieDomain(value) {
	return (
		value === '' ||
		(typeof value === 'string' && /^\.[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(value))
	);
}

function validRevocationToken(value) {
	return typeof value === 'string' && /^[A-Za-z0-9_-]{40,128}$/.test(value);
}
