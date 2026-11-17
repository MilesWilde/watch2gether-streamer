import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type { ChatMessage } from '../src/stream/chat';
import { ChatOverlay } from '../src/client/components/ChatOverlay';
import { resetServerClock, sampleServerClock } from '../src/client/lib/serverClock';

const hooks = vi.hoisted(() => ({
	slots: [] as { value?: unknown; deps?: readonly unknown[]; cleanup?: void | (() => void) }[],
	index: 0,
	effects: [] as (() => void)[],
}));

vi.mock('react', async importOriginal => {
	const original = await importOriginal<typeof import('react')>();
	return {
		...original,
		useState: (initial: unknown) => {
			const slot = hooks.slots[hooks.index++] ??= { value: typeof initial === 'function' ? initial() : initial };
			return [slot.value, (next: unknown) => { slot.value = typeof next === 'function' ? next(slot.value) : next; }];
		},
		useEffect: (effect: () => void | (() => void), deps: readonly unknown[]) => {
			const slot = hooks.slots[hooks.index++] ??= {};
			if (!slot.deps || deps.length !== slot.deps.length || deps.some((dep, i) => !Object.is(dep, slot.deps?.[i]))) {
				slot.deps = deps;
				hooks.effects.push(() => { slot.cleanup?.(); slot.cleanup = effect(); });
			}
		},
	};
});

type Element = ReactElement<Record<string, unknown>>;
function elements(node: unknown): Element[] {
	if (Array.isArray(node)) return node.flatMap(elements);
	if (!node || typeof node !== 'object' || !('props' in node)) return [];
	const element = node as Element;
	return [element, ...elements(element.props.children)];
}

describe('recent chat mirrored over the video', () => {
	let messages: ChatMessage[];
	function message(id: string, sentAtMs = 100000): ChatMessage {
		return { id, sessionId: 'room', name: 'Alex', text: `message ${id}`, sentAtMs };
	}
	function render(opacity = 60) {
		hooks.index = 0;
		const tree = ChatOverlay({ messages, opacity });
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
	it('fades the message itself, then removes only the overlay copy and stops the timer', () => {
		render();
		vi.advanceTimersByTime(13500);
		expect(rows(render())[0].props.style).toMatchObject({ opacity: 0.3 });
		vi.advanceTimersByTime(1500);
		expect(render()).toBeNull();
		expect(messages).toEqual([message('new')]);
		expect(vi.getTimerCount()).toBe(0);
	});
	it('shows at most five recent messages with the newest first', () => {
		messages = Array.from({ length: 9 }, (_, i) => message(String(i), 99000 + i));
		const visible = rows(render());
		expect(visible).toHaveLength(5);
		expect(visible.map(row => row.key)).toEqual(['room:8', 'room:7', 'room:6', 'room:5', 'room:4']);
		expect(messages).toHaveLength(9);
	});
	it('keeps old history and invalid timestamps out of the overlay', () => {
		messages = [message('old', 84999), message('invalid', NaN), message('far-future', 200000)];
		expect(render()).toBeNull();
		expect(vi.getTimerCount()).toBe(0);
	});
	it('does not restart the fade when a newer message arrives or opacity changes', () => {
		render();
		vi.advanceTimersByTime(13500);
		messages = [...messages, message('later', 113500)];
		const visible = rows(render(80));
		expect(visible.map(row => row.props.style)).toEqual([{ opacity: 0.8 }, { opacity: 0.4 }]);
		vi.advanceTimersByTime(1500);
		expect(rows(render(80)).map(row => row.key)).toEqual(['room:later']);
	});
	it('does not resurrect expired messages when the local wall clock changes', () => {
		render();
		vi.setSystemTime(5000);
		vi.advanceTimersByTime(15000);
		expect(render()).toBeNull();
	});
	it('shows fresh messages after reconnect recalibrates a fast local clock', () => {
		render();
		resetServerClock();
		vi.setSystemTime(10000000);
		vi.advanceTimersByTime(250);
		expect(render()).toBeNull();
		sampleServerClock(100250);
		messages = [message('after-reconnect', 100250)];
		expect(rows(render()).map(row => row.key)).toEqual(['room:after-reconnect']);
	});
	it('hides zero-opacity messages and resumes with only still-recent messages', () => {
		expect(render(0)).toBeNull();
		expect(vi.getTimerCount()).toBe(0);
		vi.advanceTimersByTime(14000);
		expect(rows(render(90))[0].props.style).toMatchObject({ opacity: 0.3 });
		vi.advanceTimersByTime(1000);
		expect(render(90)).toBeNull();
	});
	it('supports emotes and keeps message text escaped by React', () => {
		messages = [{ ...message('safe'), text: '<script>hello</script> :bug:' }];
		const nodes = elements(render());
		expect(nodes.some(node => node.type === 'img' && node.props.className === 'chat-emote')).toBe(true);
		expect(nodes.every(node => node.props.dangerouslySetInnerHTML === undefined)).toBe(true);
	});
});
