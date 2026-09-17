export function createRequestKeys(
	randomUuid = () => crypto.randomUUID(),
	storage = safeSessionStorage(),
) {
	const keys = new WeakMap();
	return {
		current(target) {
			const storageKey = durableStorageKey(target);
			const cached = keys.get(target);
			let key = cached?.storageKey === storageKey ? cached.key : '';
			if (!key && storageKey) key = storage?.getItem(storageKey) || '';
			if (!key) {
				key = randomUuid();
				if (storageKey) storage?.setItem(storageKey, key);
			}
			keys.set(target, { storageKey, key });
			return key;
		},
		clear(target, requestScope = target?.dataset?.requestKey) {
			const storageKey = durableStorageKeyForScope(requestScope);
			if (keys.get(target)?.storageKey === storageKey) keys.delete(target);
			if (storageKey) storage?.removeItem(storageKey);
			if (storageKey) storage?.removeItem(`${storageKey}.draft`);
		},
		save(target, draft) {
			const storageKey = durableStorageKey(target);
			if (!storageKey) return;
			storage?.setItem(
				`${storageKey}.draft`,
				JSON.stringify({ idempotencyKey: this.current(target), ...draft }),
			);
		},
		read(target) {
			const storageKey = durableStorageKey(target);
			if (!storageKey) return undefined;
			try {
				const draft = JSON.parse(storage?.getItem(`${storageKey}.draft`) || '');
				return draft && typeof draft === 'object' ? draft : undefined;
			} catch {
				return undefined;
			}
		},
	};
}

function durableStorageKey(target) {
	const name = typeof target?.dataset?.requestKey === 'string' ? target.dataset.requestKey : '';
	return durableStorageKeyForScope(name);
}

function durableStorageKeyForScope(requestScope) {
	return requestScope ? `ceasar.customer.request.${requestScope}` : '';
}

function safeSessionStorage() {
	try {
		return globalThis.sessionStorage;
	} catch {
		return undefined;
	}
}
