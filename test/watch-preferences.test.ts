import { describe, expect, it } from 'vitest';
import { defaultWatchPreferences, isTheaterShortcut, readWatchPreferences, writeWatchPreferences } from '../src/client/lib/watchPreferences';

describe('local viewing preferences', () => {
	it.each([
		['left', 'left'], ['left', 'right'], ['right', 'left'], ['right', 'right'],
	] as const)('restores overlay %s and sidebar %s independently with opacity and theater choices', (overlaySide, chatSide) => {
		const values = new Map<string, string>();
		const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
		const preferences = { chatOverlay: false, overlayOpacity: 28, overlaySide, overlayBackgroundColor: '#237a9f', overlayBackgroundOpacity: 37, chatSide, theater: true };
		writeWatchPreferences(preferences, storage);
		expect(readWatchPreferences(storage)).toEqual(preferences);
		expect(JSON.parse(storage.getItem('watchparty-viewing-preferences')!)).toEqual({ version: 1, ...preferences });
		expect(storage.getItem('watchparty-viewing-preferences')!.length).toBeLessThan(512);
	});

	it.each([undefined, null, 'center', 'LEFT', 1, true, {}])('defaults legacy or invalid overlay position %j to left while preserving other choices', overlaySide => {
		const saved = JSON.stringify({ version: 1, chatOverlay: false, overlayOpacity: 28, overlaySide, chatSide: 'left', theater: true });
		expect(readWatchPreferences({ getItem: () => saved })).toEqual({ ...defaultWatchPreferences, chatOverlay: false, overlayOpacity: 28, overlaySide: 'left', chatSide: 'left', theater: true });
	});

	it.each([undefined, null, 'center', 'RIGHT', 1, true, {}])('defaults legacy or invalid sidebar position %j to right while preserving other choices', chatSide => {
		const saved = JSON.stringify({ version: 1, chatOverlay: false, overlayOpacity: 28, overlaySide: 'right', chatSide, theater: true });
		expect(readWatchPreferences({ getItem: () => saved })).toEqual({ ...defaultWatchPreferences, chatOverlay: false, overlayOpacity: 28, overlaySide: 'right', chatSide: 'right', theater: true });
	});

	it('adds background defaults to legacy preferences without changing existing choices', () => {
		const legacy = { chatOverlay: false, overlayOpacity: 28, overlaySide: 'right', chatSide: 'left', theater: true };
		expect(readWatchPreferences({ getItem: () => JSON.stringify({ version: 1, ...legacy }) })).toEqual({
			...legacy, overlayBackgroundColor: '#000000', overlayBackgroundOpacity: 50,
		});
		expect(defaultWatchPreferences).toMatchObject({ overlayBackgroundColor: '#000000', overlayBackgroundOpacity: 50 });
	});

	it.each([
		['#000000', '#000000'], ['#ffffff', '#ffffff'], ['#A1b2C3', '#a1b2c3'],
	])('normalizes background color %s to %s when reading and writing', (overlayBackgroundColor, expected) => {
		const preferences = { ...defaultWatchPreferences, overlayBackgroundColor, overlayBackgroundOpacity: 23 };
		const expectedPreferences = { ...preferences, overlayBackgroundColor: expected };
		expect(readWatchPreferences({ getItem: () => JSON.stringify({ version: 1, ...preferences }) })).toEqual(expectedPreferences);
		let saved = '';
		writeWatchPreferences(preferences, { setItem: (_key, value) => { saved = value; } });
		expect(JSON.parse(saved)).toEqual({ version: 1, ...expectedPreferences });
	});

	it.each([undefined, null, '', 'black', '#abc', '#12345678', '123456', '#12345g', ' #123456', '#123456\n', 123456, true, {}])('defaults invalid background color %j without changing its opacity', overlayBackgroundColor => {
		const saved = JSON.stringify({ version: 1, overlayBackgroundColor, overlayBackgroundOpacity: 23 });
		expect(readWatchPreferences({ getItem: () => saved })).toMatchObject({ overlayBackgroundColor: '#000000', overlayBackgroundOpacity: 23 });
	});

	it.each([
		[-40, 0], [0, 0], [24.4, 24], [24.5, 25], [99.9, 100], [100, 100], [140, 100],
	])('normalizes background opacity %s to %s when reading and writing', (overlayBackgroundOpacity, expected) => {
		const preferences = { ...defaultWatchPreferences, overlayBackgroundColor: '#123456', overlayBackgroundOpacity };
		const expectedPreferences = { ...preferences, overlayBackgroundOpacity: expected };
		expect(readWatchPreferences({ getItem: () => JSON.stringify({ version: 1, ...preferences }) })).toEqual(expectedPreferences);
		let saved = '';
		writeWatchPreferences(preferences, { setItem: (_key, value) => { saved = value; } });
		expect(JSON.parse(saved)).toEqual({ version: 1, ...expectedPreferences });
	});

	it.each([undefined, null, '25', true, {}])('defaults invalid background opacity %j without changing its color', overlayBackgroundOpacity => {
		const saved = JSON.stringify({ version: 1, overlayBackgroundColor: '#123456', overlayBackgroundOpacity });
		expect(readWatchPreferences({ getItem: () => saved })).toMatchObject({ overlayBackgroundColor: '#123456', overlayBackgroundOpacity: 50 });
	});

	it.each([NaN, Infinity, -Infinity])('defaults non-finite background opacity %s before saving', overlayBackgroundOpacity => {
		let saved = '';
		writeWatchPreferences({ ...defaultWatchPreferences, overlayBackgroundOpacity }, { setItem: (_key, value) => { saved = value; } });
		expect(JSON.parse(saved).overlayBackgroundOpacity).toBe(50);
	});

	it.each([null, '{', 'null', '[]', '{"version":2}', '{"version":1,"chatOverlay":"false","overlayOpacity":"20","theater":1}'])('uses defaults for invalid saved preferences %s', raw => {
		expect(readWatchPreferences({ getItem: () => raw })).toEqual(defaultWatchPreferences);
	});

	it('clamps opacity and tolerates storage being unavailable', () => {
		expect(readWatchPreferences({ getItem: () => '{"version":1,"overlayOpacity":150}' }).overlayOpacity).toBe(100);
		expect(readWatchPreferences({ getItem: () => '{"version":1,"overlayOpacity":-20}' }).overlayOpacity).toBe(0);
		expect(readWatchPreferences({ getItem() { throw new Error('blocked'); } })).toEqual(defaultWatchPreferences);
		expect(readWatchPreferences(null)).toEqual(defaultWatchPreferences);
		expect(() => writeWatchPreferences(defaultWatchPreferences, { setItem() { throw new Error('full'); } })).not.toThrow();
		expect(() => writeWatchPreferences(defaultWatchPreferences, null)).not.toThrow();
	});
});

describe('theater shortcut', () => {
	function key(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
		return { key: 't', repeat: false, defaultPrevented: false, isComposing: false, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, target: null, ...overrides } as KeyboardEvent;
	}
	it('accepts an unmodified T outside editing controls', () => {
		expect(isTheaterShortcut(key())).toBe(true);
		expect(isTheaterShortcut(key({ key: 'T' }))).toBe(true);
	});
	it.each(['repeat', 'defaultPrevented', 'isComposing', 'ctrlKey', 'altKey', 'metaKey', 'shiftKey'] as const)('ignores %s key events', field => {
		expect(isTheaterShortcut(key({ [field]: true }))).toBe(false);
	});
	it('ignores typing and dialog controls', () => {
		const target = { closest: () => ({}) } as unknown as EventTarget;
		expect(isTheaterShortcut(key({ target }))).toBe(false);
		expect(isTheaterShortcut(key({ key: 'x' }))).toBe(false);
	});
});
