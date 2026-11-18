import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { MAX_CHAT_MESSAGES, type ChatMessage } from '../src/stream/chat';
import { ChatOverlay } from '../src/client/components/ChatOverlay';
import { resetServerClock, sampleServerClock } from '../src/client/lib/serverClock';

const hooks = vi.hoisted(() => ({
	slots: [] as { current?: unknown; value?: unknown; deps?: readonly unknown[]; cleanup?: void | (() => void) }[],
	index: 0,
	effects: [] as (() => void)[],
}));

vi.mock('react', async importOriginal => {
	const original = await importOriginal<typeof import('react')>();
	function effect(callback: () => void | (() => void), deps: readonly unknown[]) {
		const slot = hooks.slots[hooks.index++] ??= {};
		if (!slot.deps || deps.length !== slot.deps.length || deps.some((dep, i) => !Object.is(dep, slot.deps?.[i]))) {
			slot.deps = deps;
			hooks.effects.push(() => { slot.cleanup?.(); slot.cleanup = callback(); });
		}
	}
	return {
		...original,
		useRef: (current: unknown) => hooks.slots[hooks.index++] ??= { current },
		useState: (initial: unknown) => {
			const slot = hooks.slots[hooks.index++] ??= { value: typeof initial === 'function' ? initial() : initial };
			return [slot.value, (next: unknown) => { slot.value = typeof next === 'function' ? next(slot.value) : next; }];
		},
		useEffect: effect,
		useLayoutEffect: effect,
	};
});

type Element = ReactElement<Record<string, unknown>>;
function elements(node: unknown): Element[] {
	if (Array.isArray(node)) return node.flatMap(elements);
	if (!node || typeof node !== 'object' || !('props' in node)) return [];
	const element = node as Element;
	return [element, ...elements(element.props.children)];
}

describe('persistent chat mirrored over the video', () => {
	let messages: ChatMessage[];
	function message(id: string, sentAtMs = 100000): ChatMessage {
		return { id, sessionId: 'room', name: 'Alex', text: `message ${id}`, sentAtMs };
	}
	function render(opacity = 60, mount?: (tree: Element | null) => void) {
		hooks.index = 0;
		const tree = ChatOverlay({ messages, opacity, side: 'left' });
		mount?.(tree);
		for (const effect of hooks.effects.splice(0)) effect();
		return tree;
	}
	function rows(tree: unknown) {
		return elements(tree).filter(node => node.props.className === 'chat-overlay-message');
	}
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'performance'] });
		vi.setSystemTime(100000);
		resetServerClock();
		sampleServerClock(100000);
		hooks.slots = [];
		hooks.effects = [];
		messages = [message('new')];
	});
	afterEach(() => {
		for (const slot of hooks.slots) slot.cleanup?.();
		vi.unstubAllGlobals();
		resetServerClock();
		vi.useRealTimers();
	});
	it('mirrors fresh messages at the selected text opacity without a second interactive chat', () => {
		const tree = render();
		expect(rows(tree)).toHaveLength(1);
		expect(rows(tree)[0].props.style).toMatchObject({ opacity: 0.6 });
		expect(elements(tree)[0].props).toMatchObject({ 'aria-hidden': true, inert: true });
		expect(elements(tree).some(node => ['input', 'textarea', 'form'].includes(String(node.type)))).toBe(false);
	});
	it('keeps messages at the chosen opacity indefinitely without an expiry timer', () => {
		render();
		vi.advanceTimersByTime(13500);
		expect(rows(render())[0].props.style).toMatchObject({ opacity: 0.6 });
		expect(vi.getTimerCount()).toBe(0);
		vi.advanceTimersByTime(365 * 24 * 60 * 60 * 1000);
		expect(rows(render()).map(row => row.key)).toEqual(['room:new']);
		expect(rows(render())[0].props.style).toMatchObject({ opacity: 0.6 });
		expect(messages).toEqual([message('new')]);
		messages = [];
		expect(render()).toBeNull();
	});
	it('keeps arrival order so new messages appear at the bottom', () => {
		messages = Array.from({ length: 9 }, (_, i) => message(String(i), 99000 + i));
		const visible = rows(render());
		expect(visible).toHaveLength(9);
		expect(visible.map(row => row.key)).toEqual(['room:0', 'room:1', 'room:2', 'room:3', 'room:4', 'room:5', 'room:6', 'room:7', 'room:8']);
		expect(messages).toHaveLength(9);
	});
	it('appends a newly received message below older history when the server clock moves backward', () => {
		messages = [message('older', 200000)];
		render();
		messages = [...messages, message('newly-received', 100000)];
		expect(rows(render()).map(row => row.key)).toEqual(['room:older', 'room:newly-received']);
	});
	it('preserves arrival order when timestamps tie without reordering source history', () => {
		messages = [message('older', 99000), message('first'), message('second'), message('third')];
		const original = messages.slice();
		expect(rows(render()).map(row => row.key)).toEqual(['room:older', 'room:first', 'room:second', 'room:third']);
		expect(messages).toEqual(original);
	});
	it('retains old and future-dated history independently of the clock while ignoring invalid timestamps', () => {
		messages = [message('old', 84999), message('invalid', NaN), message('infinite', Infinity), message('far-future', 200000)];
		expect(rows(render()).map(row => row.key)).toEqual(['room:old', 'room:far-future']);
		expect(vi.getTimerCount()).toBe(0);
	});
	it('applies opacity changes equally to retained messages when new messages arrive', () => {
		render();
		vi.advanceTimersByTime(13500);
		messages = [...messages, message('later', 113500)];
		const visible = rows(render(80));
		expect(visible.map(row => row.key)).toEqual(['room:new', 'room:later']);
		expect(visible.map(row => row.props.style)).toEqual([{ opacity: 0.8 }, { opacity: 0.8 }]);
		vi.advanceTimersByTime(1500);
		expect(rows(render(80)).map(row => row.key)).toEqual(['room:new', 'room:later']);
	});
	it('retains messages when the local wall clock moves backward', () => {
		render();
		vi.setSystemTime(5000);
		vi.advanceTimersByTime(15000);
		expect(rows(render()).map(row => row.key)).toEqual(['room:new']);
	});
	it('keeps history through reconnect clock recalibration and appends subsequent messages', () => {
		render();
		resetServerClock();
		vi.setSystemTime(10000000);
		vi.advanceTimersByTime(250);
		expect(rows(render()).map(row => row.key)).toEqual(['room:new']);
		sampleServerClock(100250);
		messages = [...messages, message('after-reconnect', 100250)];
		expect(rows(render()).map(row => row.key)).toEqual(['room:new', 'room:after-reconnect']);
	});
	it('hides zero-opacity messages and restores retained history regardless of elapsed time', () => {
		expect(render(0)).toBeNull();
		expect(vi.getTimerCount()).toBe(0);
		vi.advanceTimersByTime(60000);
		expect(rows(render(90))[0].props.style).toMatchObject({ opacity: 0.9 });
		expect(rows(render(90)).map(row => row.key)).toEqual(['room:new']);
	});
	it('bounds retained history to the source buffer without mutating the source', () => {
		messages = Array.from({ length: MAX_CHAT_MESSAGES + 1 }, (_, index) => message(String(index), index));
		const visible = rows(render());
		expect(visible).toHaveLength(MAX_CHAT_MESSAGES);
		expect(visible[0].key).toBe('room:1');
		expect(visible.at(-1)?.key).toBe(`room:${MAX_CHAT_MESSAGES}`);
		expect(messages).toHaveLength(MAX_CHAT_MESSAGES + 1);
	});
	it('removes whole oldest rows from the top and keeps the newest bottom row through capacity changes', () => {
		vi.stubGlobal('getComputedStyle', () => ({ rowGap: '8px' }));
		vi.stubGlobal('ResizeObserver', undefined);
		let frameHeight = 90;
		let mountedRows: unknown[] = [];
		const clippedKeys = new Set<string>();
		const frame = {
			get clientHeight() { return Math.round(frameHeight); },
			getBoundingClientRect: () => ({ height: frameHeight }),
			querySelectorAll: () => mountedRows,
		};
		function renderMeasured(opacity = 60) {
			return render(opacity, tree => {
				if (!tree) return;
				mountedRows = rows(tree).map(row => {
					const key = String(row.key);
					const bodyHeight = key === 'room:oversized' ? 120 : 40;
					const height = Math.min(frameHeight, bodyHeight);
					return {
						dataset: { messageKey: key },
						clientHeight: height,
						getBoundingClientRect: () => ({ height }),
						querySelector: () => ({ offsetHeight: bodyHeight }),
						toggleAttribute: (_name: string, clipped: boolean) => {
							if (clipped) clippedKeys.add(key);
							else clippedKeys.delete(key);
						},
					};
				});
				(tree.props.ref as { current: unknown }).current = frame;
			});
		}
		messages = [message('oldest', 200000), message('middle', 99000), message('latest')];
		renderMeasured();
		expect(rows(renderMeasured()).map(row => row.key)).toEqual(['room:middle', 'room:latest']);
		messages = [...messages, message('oversized', 95000)];
		renderMeasured();
		expect(rows(renderMeasured()).map(row => row.key)).toEqual(['room:oversized']);
		expect(clippedKeys).toEqual(new Set(['room:oversized']));
		expect(renderMeasured(0)).toBeNull();
		vi.advanceTimersByTime(365 * 24 * 60 * 60 * 1000);
		frameHeight = 500;
		expect(rows(renderMeasured(80)).map(row => row.key)).toEqual(['room:oversized']);
		expect(clippedKeys.size).toBe(0);
		expect(messages.map(item => item.id)).toEqual(['oldest', 'middle', 'latest', 'oversized']);
	});
	it('supports emotes and keeps message text escaped by React', () => {
		messages = [{ ...message('safe'), text: '<script>hello</script> :bug:' }];
		const nodes = elements(render());
		expect(nodes.some(node => node.type === 'img' && node.props.className === 'chat-emote')).toBe(true);
		expect(nodes.every(node => node.props.dangerouslySetInnerHTML === undefined)).toBe(true);
	});
});
