import { describe, expect, it } from 'vitest';
import { createPickerState, readPickerState, writePickerState } from '../src/client/lib/chatPickerState';

const key = 'watchparty-chat-picker:global';
function storage() {
	const values = new Map<string, string>();
	return {
		getItem: (name: string) => values.get(name) ?? null,
		setItem: (name: string, value: string) => { values.set(name, value); },
	};
}

it('starts with bounded page counts of 96 emoji and 48 GIFs', () => {
	const state = createPickerState();
	expect(state.emoji.visibleCount).toBe(96);
	expect(state.gif.visibleCount).toBe(48);
});

describe('picker reload fallback', () => {
	it('creates independent defaults for every view and call', () => {
		const expected = { query: '', category: 'all', pack: 'all', source: 'collection', scrollTop: 0 };
		const first = createPickerState();
		expect(first).toEqual({ tab: 'emoji', emoji: { ...expected, visibleCount: 96 }, gif: { ...expected, visibleCount: 48 } });
		first.emoji.query = 'changed';
		expect(first.gif.query).toBe('');
		expect(createPickerState().emoji.query).toBe('');
		const fallback = readPickerState(null);
		fallback.gif.query = 'changed';
		expect(readPickerState(null).gif.query).toBe('');
	});

	it('round trips separate view preferences, counts, and offsets in version 1', () => {
		const store = storage();
		const state = createPickerState();
		state.tab = 'gif';
		state.emoji = { query: 'smile', category: 'happy', pack: 'twemoji', source: 'collection', visibleCount: 288, scrollTop: 123.5 };
		state.gif = { query: 'hello', category: 'funny', pack: 'all', source: 'giphy', visibleCount: 144, scrollTop: 900 };
		writePickerState(store, state);
		expect(JSON.parse(store.getItem(key)!)).toEqual({ version: 1, ...state });
		expect(readPickerState(store)).toEqual(state);
	});

	it('accepts all existing packs and moods', () => {
		const store = storage();
		for (const pack of ['all', 'unicode', 'openmoji', 'twemoji', 'neocat']) {
			for (const category of ['all', 'recent', 'happy', 'love', 'chaotic', 'sad', 'cozy', 'funny']) {
				const state = createPickerState();
				Object.assign(state.emoji, { pack, category });
				writePickerState(store, state);
				expect(readPickerState(store)).toEqual(state);
			}
		}
	});

	it.each(['{', 'null', '[]', 'true', '1', '"text"', '{}', '{"version":"1"}', '{"version":2}', ' '.repeat(4097)])('defaults malformed, unknown-version, or oversized storage: %s', raw => {
		expect(readPickerState({ getItem: () => raw })).toEqual(createPickerState());
	});

	it('rejects oversized valid JSON before using its preferences', () => {
		const raw = JSON.stringify({ version: 1, ...createPickerState(), tab: 'gif', extra: 'x'.repeat(4096) });
		expect(readPickerState({ getItem: () => raw })).toEqual(createPickerState());
	});

	it.each([null, [], true, 42, 'invalid'])('defaults malformed view %j', emoji => {
		const raw = JSON.stringify({ version: 1, emoji, gif: { query: 'valid' }, tab: 'gif' });
		const state = readPickerState({ getItem: () => raw });
		expect(state.emoji).toEqual(createPickerState().emoji);
		expect(state.gif.query).toBe('valid');
		expect(state.tab).toBe('gif');
	});

	it('validates each field independently without coercion', () => {
		const raw = JSON.stringify({ version: 1, tab: 'other', emoji: { query: 7, category: 'unknown', pack: 'unknown', source: 'remote', visibleCount: '96', scrollTop: '100' }, gif: { query: 'valid', category: 'cozy' } });
		const result = readPickerState({ getItem: () => raw });
		expect(result.tab).toBe('emoji');
		expect(result.emoji).toEqual(createPickerState().emoji);
		expect(result.gif).toEqual({ ...createPickerState().gif, query: 'valid', category: 'cozy' });
	});

	it.each([0, -1, 1.5, 5001, Number.MAX_VALUE, Infinity, -Infinity, NaN, null, '5000'])('rejects invalid counts %s on read and write', visibleCount => {
		const store = storage();
		const state = createPickerState();
		Object.assign(state.emoji, { visibleCount });
		Object.assign(state.gif, { visibleCount });
		store.setItem(key, JSON.stringify({ version: 1, ...state }));
		expect(readPickerState(store)).toEqual(createPickerState());
		writePickerState(store, state);
		expect(JSON.parse(store.getItem(key)!)).toEqual({ version: 1, ...createPickerState() });
	});

	it.each([-1, 1000001, Infinity, -Infinity, NaN, null, '100'])('rejects invalid offsets %s', scrollTop => {
		const store = storage();
		const state = createPickerState();
		Object.assign(state.emoji, { scrollTop });
		writePickerState(store, state);
		expect(readPickerState(store).emoji.scrollTop).toBe(0);
		store.setItem(key, JSON.stringify({ version: 1, ...state }));
		expect(readPickerState(store).emoji.scrollTop).toBe(0);
	});

	it('accepts exact numeric and query bounds without mutating input', () => {
		const store = storage();
		const state = createPickerState();
		Object.assign(state.emoji, { query: 'q'.repeat(50), visibleCount: 5000, scrollTop: 1000000 });
		Object.assign(state.gif, { visibleCount: 1, scrollTop: 0.5 });
		Object.freeze(state.emoji);
		Object.freeze(state.gif);
		Object.freeze(state);
		writePickerState(store, state);
		expect(readPickerState(store)).toEqual(state);
	});

	it('defaults queries over 50 characters on both read and write', () => {
		const store = storage();
		const state = createPickerState();
		state.emoji.query = 'q'.repeat(51);
		store.setItem(key, JSON.stringify({ version: 1, ...state }));
		expect(readPickerState(store).emoji.query).toBe('');
		writePickerState(store, state);
		expect(readPickerState(store).emoji.query).toBe('');
		expect(state.emoji.query).toHaveLength(51);
	});

	it('projects only allowed fields, ignoring extra URLs, messages, and toJSON', () => {
		const store = storage();
		const state = createPickerState();
		Object.assign(state, { messages: ['private'], toJSON() { throw Error('do not serialize input'); } });
		Object.assign(state.gif, { urls: ['https://example.com/a.gif'], results: [{ text: 'private' }] });
		writePickerState(store, state);
		expect(JSON.parse(store.getItem(key)!)).toEqual({ version: 1, ...createPickerState() });
	});

	it('tolerates missing storage, blocked methods and method accessors', () => {
		const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('quota'); } };
		const accessors = { get getItem(): Storage['getItem'] { throw Error('blocked'); }, get setItem(): Storage['setItem'] { throw Error('blocked'); } };
		for (const store of [null, blocked, accessors]) {
			expect(readPickerState(store)).toEqual(createPickerState());
			expect(() => writePickerState(store, createPickerState())).not.toThrow();
		}
	});

	it('does not invoke state getters or inherited preferences', () => {
		const store = storage();
		const state = createPickerState();
		Object.defineProperty(state.emoji, 'query', { get() { throw Error('getter'); } });
		state.gif = Object.create({ ...createPickerState().gif, query: 'inherited' });
		expect(() => writePickerState(store, state)).not.toThrow();
		expect(readPickerState(store)).toEqual(createPickerState());
	});
});
