const scriptUrl = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptPromise;

function loadTurnstile() {
	if (globalThis.turnstile) return Promise.resolve(globalThis.turnstile);
	scriptPromise ||= new Promise((resolve, reject) => {
		const script = document.createElement('script');
		script.src = scriptUrl;
		script.async = true;
		script.onload = () => resolve(globalThis.turnstile);
		script.onerror = () => {
			script.remove();
			reject(new Error('The security check could not load. Try again.'));
		};
		document.head.append(script);
	}).catch((error) => {
		scriptPromise = undefined;
		throw error;
	});
	return scriptPromise;
}

export async function createAuthCaptcha(config, forms) {
	if (!config.captchaEnabled) return { token: () => '', reset: () => {}, activate: () => {} };
	if (!config.turnstileSiteKey) throw new Error('The security check is not configured.');
	const turnstile = await loadTurnstile();
	if (!turnstile?.render) throw new Error('The security check could not load. Try again.');
	const widgets = new Map();
	function activate(form) {
		if (!form || widgets.has(form)) return;
		const mount = form.querySelector('[data-customer-captcha]');
		if (!mount) return;
		let value = '';
		const widgetId = turnstile.render(mount, {
			sitekey: config.turnstileSiteKey,
			appearance: 'interaction-only',
			callback: (token) => {
				value = token;
				mount.removeAttribute('aria-invalid');
			},
			'expired-callback': () => {
				value = '';
				turnstile.reset(widgetId);
			},
			'error-callback': () => {
				value = '';
			},
		});
		widgets.set(form, {
			token() {
				if (!value) {
					mount.setAttribute('aria-invalid', 'true');
					mount.focus();
					throw new Error('Complete the security check to continue.');
				}
				return value;
			},
			reset() {
				value = '';
				turnstile.reset(widgetId);
			},
		});
	}
	for (const form of forms) if (!form.classList.contains('u-hidden')) activate(form);
	return {
		activate,
		token: (form) => {
			activate(form);
			return widgets.get(form)?.token() || '';
		},
		reset: (form) => widgets.get(form)?.reset(),
	};
}
