import { describe, expect, it } from 'vitest';
import { defaultWatchPreferences, isTheaterShortcut, readWatchPreferences, writeWatchPreferences } from '../src/client/lib/watchPreferences';

describe('local viewing preferences', () => {
	it.each([
		['left', 'left'], ['left', 'right'], ['right', 'left'], ['right', 'right'],
	] as const)('restores overlay %s and sidebar %s independently with opacity and theater choices', (overlaySide, chatSide) => {
		const values = new Map<string, string>();
		const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
		const preferences = { chatOverlay: false, overlayOpacity: 28, overlaySide, chatSide, theater: true };
		writeWatchPreferences(preferences, storage);
		expect(readWatchPreferences(storage)).toEqual(preferences);
		expect(JSON.parse(storage.getItem('watchparty-viewing-preferences')!)).toEqual({ version: 1, ...preferences });
	});

	it.each([undefined, null, 'center', 'LEFT', 1, true, {}])('defaults legacy or invalid overlay position %j to left while preserving other choices', overlaySide => {
		const saved = JSON.stringify({ version: 1, chatOverlay: false, overlayOpacity: 28, overlaySide, chatSide: 'left', theater: true });
		expect(readWatchPreferences({ getItem: () => saved })).toEqual({ chatOverlay: false, overlayOpacity: 28, overlaySide: 'left', chatSide: 'left', theater: true });
	});

	it.each([undefined, null, 'center', 'RIGHT', 1, true, {}])('defaults legacy or invalid sidebar position %j to right while preserving other choices', chatSide => {
		const saved = JSON.stringify({ version: 1, chatOverlay: false, overlayOpacity: 28, overlaySide: 'right', chatSide, theater: true });
		expect(readWatchPreferences({ getItem: () => saved })).toEqual({ chatOverlay: false, overlayOpacity: 28, overlaySide: 'right', chatSide: 'right', theater: true });
	});

	it.each([null, '{', 'null', '[]', '{"version":2}', '{"version":1,"chatOverlay":"false","overlayOpacity":"20","theater":1}'])('uses defaults for invalid saved preferences %s', raw => {
		expect(readWatchPreferences({ getItem: () => raw })).toEqual(defaultWatchPreferences);
	});

	it('clamps opacity and tolerates storage being unavailable', () => {
		expect(readWatchPreferences({ getItem: () => '{"version":1,"overlayOpacity":150}' }).overlayOpacity).toBe(100);
		expect(readWatchPreferences({ getItem: () => '{"version":1,"overlayOpacity":-20}' }).overlayOpacity).toBe(0);
		expect(readWatchPreferences({ getItem() { throw new Error('blocked'); } })).toEqual(defaultWatchPreferences);
		expect(() => writeWatchPreferences(defaultWatchPreferences, { setItem() { throw new Error('full'); } })).not.toThrow();
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
