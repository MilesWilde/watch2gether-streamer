export type PickerView = {
	query: string;
	category: string;
	pack: string;
	source: 'collection' | 'giphy';
	visibleCount: number;
	scrollTop: number;
};

export type ChatPickerState = {
	tab: 'emoji' | 'gif';
	emoji: PickerView;
	gif: PickerView;
};

const key = 'watchparty-chat-picker:global';
const packs = ['all', 'unicode', 'openmoji', 'twemoji', 'neocat'];
const categories = ['all', 'recent', 'happy', 'love', 'chaotic', 'sad', 'cozy', 'funny'];

export function createPickerState(): ChatPickerState {
	const view = (visibleCount: number): PickerView => ({
		query: '', category: 'all', pack: 'all', source: 'collection', visibleCount, scrollTop: 0,
	});
	return { tab: 'emoji', emoji: view(96), gif: view(48) };
}

// Read only own data properties so optional persistence never runs caller getters.
function field(value: unknown, name: string): unknown {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
	try {
		const descriptor = Object.getOwnPropertyDescriptor(value, name);
		return descriptor && 'value' in descriptor ? descriptor.value : undefined;
	} catch { return undefined; }
}

function allowed(value: unknown, values: string[], fallback: string): string {
	return typeof value === 'string' && values.includes(value) ? value : fallback;
}

function bounded(value: unknown, min: number, max: number, fallback: number, integer = false): number {
	return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
		&& (!integer || Number.isInteger(value)) ? value : fallback;
}

function normalizeView(value: unknown, fallback: PickerView): PickerView {
	const query = field(value, 'query');
	const source = field(value, 'source');
	return {
		query: typeof query === 'string' && query.length <= 50 ? query : fallback.query,
		category: allowed(field(value, 'category'), categories, fallback.category),
		pack: allowed(field(value, 'pack'), packs, fallback.pack),
		source: source === 'collection' || source === 'giphy' ? source : fallback.source,
		visibleCount: bounded(field(value, 'visibleCount'), 1, 5000, fallback.visibleCount, true),
		scrollTop: bounded(field(value, 'scrollTop'), 0, 1000000, fallback.scrollTop),
	};
}

function normalizeState(value: unknown): ChatPickerState {
	const fallback = createPickerState();
	return {
		tab: field(value, 'tab') === 'gif' ? 'gif' : 'emoji',
		emoji: normalizeView(field(value, 'emoji'), fallback.emoji),
		gif: normalizeView(field(value, 'gif'), fallback.gif),
	};
}

export function readPickerState(storage: Pick<Storage, 'getItem'> | null): ChatPickerState {
	try {
		const raw = storage?.getItem(key);
		if (typeof raw !== 'string' || !raw || raw.length > 4096) return createPickerState();
		const parsed: unknown = JSON.parse(raw);
		return field(parsed, 'version') === 1 ? normalizeState(parsed) : createPickerState();
	} catch { return createPickerState(); }
}

export function writePickerState(storage: Pick<Storage, 'setItem'> | null, state: ChatPickerState): void {
	try {
		storage?.setItem(key, JSON.stringify({ version: 1, ...normalizeState(state) }));
	} catch { /* Picker preferences are optional. */ }
}
