export function createRequestKeys(randomUuid = () => crypto.randomUUID()) {
	const keys = new WeakMap();
	return {
		current(target) {
			let key = keys.get(target);
			if (!key) {
				key = randomUuid();
				keys.set(target, key);
			}
			return key;
		},
		clear(target) {
			keys.delete(target);
		},
	};
}
