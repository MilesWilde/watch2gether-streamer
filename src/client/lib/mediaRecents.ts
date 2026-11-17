type RecentStorage = Pick<Storage, 'getItem' | 'setItem'> | null;
const key = 'watchparty-media-recents';
const validId = (id: unknown): id is string => typeof id === 'string' && /^(?:giphy:[A-Za-z0-9]{1,64}|emote:[a-z0-9_]{1,40}|[a-z0-9-]{1,64})$/.test(id);

export function readMediaRecents(storage: Pick<Storage, 'getItem'> | null): string[] {
	try {
		const raw = storage?.getItem(key);
		if (!raw || raw.length > 10000) return [];
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? [...new Set(parsed.filter(validId))].slice(0, 24) : [];
	} catch { return []; }
}

export function rememberMedia(storage: RecentStorage, id: string): void {
	if (!validId(id)) return;
	try { storage?.setItem(key, JSON.stringify([id, ...readMediaRecents(storage).filter(item => item !== id)].slice(0, 24))); } catch { /* Recents are optional. */ }
}
