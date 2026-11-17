export type WatchPreferences = {
	chatOverlay: boolean;
	overlayOpacity: number;
	overlaySide: 'left' | 'right';
	theater: boolean;
};

export const defaultWatchPreferences: Readonly<WatchPreferences> = {
	chatOverlay: true,
	overlayOpacity: 55,
	overlaySide: 'left',
	theater: false,
};

const storageKey = 'watchparty-viewing-preferences';

function browserStorage(): Storage | null {
	try { return typeof localStorage === 'undefined' ? null : localStorage; }
	catch { return null; }
}

function normalize(value: unknown): WatchPreferences {
	const input = value && typeof value === 'object' ? value as Partial<WatchPreferences> : {};
	return {
		chatOverlay: typeof input.chatOverlay === 'boolean' ? input.chatOverlay : defaultWatchPreferences.chatOverlay,
		overlayOpacity: typeof input.overlayOpacity === 'number' && Number.isFinite(input.overlayOpacity) ? Math.max(0, Math.min(100, Math.round(input.overlayOpacity))) : defaultWatchPreferences.overlayOpacity,
		overlaySide: input.overlaySide === 'left' || input.overlaySide === 'right' ? input.overlaySide : defaultWatchPreferences.overlaySide,
		theater: typeof input.theater === 'boolean' ? input.theater : defaultWatchPreferences.theater,
	};
}

export function readWatchPreferences(storage: Pick<Storage, 'getItem'> | null = browserStorage()): WatchPreferences {
	try {
		const raw = storage?.getItem(storageKey);
		if (!raw || raw.length > 512) return { ...defaultWatchPreferences };
		const value: unknown = JSON.parse(raw);
		if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1) return { ...defaultWatchPreferences };
		return normalize(value);
	} catch { return { ...defaultWatchPreferences }; }
}

export function writeWatchPreferences(preferences: WatchPreferences, storage: Pick<Storage, 'setItem'> | null = browserStorage()): void {
	try { storage?.setItem(storageKey, JSON.stringify({ version: 1, ...normalize(preferences) })); }
	catch { /* Viewing controls still work when browser storage is unavailable. */ }
}

export function isTheaterShortcut(event: KeyboardEvent): boolean {
	if (event.key.toLowerCase() !== 't' || event.repeat || event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return false;
	const target = event.target as Element | null;
	return !target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], dialog, .watch-settings');
}
