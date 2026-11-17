import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatNotifications } from '../src/client/hooks/useChatNotifications';
import { RoomHeader } from '../src/client/components/RoomHeader';
import { WatchPartyApp } from '../src/client/WatchPartyApp';
import { AuthPanel } from '../src/client/components/AuthPanel';
import { PlayerPanel } from '../src/client/components/PlayerPanel';
import { WatchSettings } from '../src/client/components/WatchSettings';
import { defaultWatchPreferences } from '../src/client/lib/watchPreferences';
import type { ServerMessage } from '../src/stream/messages';

const hooks = vi.hoisted(() => ({
	slots: [] as { current?: unknown; value?: unknown; deps?: readonly unknown[]; cleanup?: void | (() => void) }[],
	index: 0,
	effects: [] as (() => void)[],
}));

vi.mock('react', async importOriginal => {
	const original = await importOriginal<typeof import('react')>();
	function memo(factory: () => unknown, deps: readonly unknown[]) {
		const slot = hooks.slots[hooks.index++] ??= {};
		if (!slot.deps || deps.some((dep, index) => !Object.is(dep, slot.deps?.[index]))) {
			slot.value = factory();
			slot.deps = deps;
		}
		return slot.value;
	}
	return {
		...original,
		useRef: (current: unknown) => hooks.slots[hooks.index++] ??= { current },
		useState: (initial: unknown) => {
			const slot = hooks.slots[hooks.index++] ??= { value: typeof initial === 'function' ? initial() : initial };
			return [slot.value, (next: unknown) => { slot.value = typeof next === 'function' ? next(slot.value) : next; }];
		},
		useCallback: (callback: unknown, deps: readonly unknown[]) => memo(() => callback, deps),
		useMemo: memo,
		useEffect: (callback: () => void | (() => void), deps: readonly unknown[]) => {
			const slot = hooks.slots[hooks.index++] ??= {};
			if (!slot.deps || deps.some((dep, index) => !Object.is(dep, slot.deps?.[index]))) {
				slot.deps = deps;
				hooks.effects.push(() => { slot.cleanup?.(); slot.cleanup = callback(); });
			}
		},
	};
});

const message = (id: number, sessionId = 'room', senderId?: string) => ({
	id: String(id), sessionId, name: 'Alex', text: 'Hello', sentAtMs: id, ...(senderId ? { senderId } : {}),
});
const history = (ids: number[], sessionId = 'room'): ServerMessage => ({
	type: 'chat_history', chat: { sessionId, messages: ids.map(id => message(id, sessionId)) },
});

describe('chat title notifications', () => {
	let active: boolean;
	let focused: boolean;
	let doc: EventTarget & { title: string; visibilityState: string; hasFocus: () => boolean };
	let win: EventTarget;
	function render() {
		hooks.index = 0;
		const result = useChatNotifications(active);
		for (const effect of hooks.effects.splice(0)) effect();
		return result;
	}
	function unmount() {
		for (const slot of hooks.slots) { slot.cleanup?.(); slot.cleanup = undefined; }
	}
	function live(id: number, sessionId = 'room', senderId?: string) {
		render().onMessage({ type: 'chat_message', message: message(id, sessionId, senderId) });
	}
	beforeEach(() => {
		hooks.slots = [];
		hooks.effects = [];
		active = true;
		focused = false;
		doc = Object.assign(new EventTarget(), { title: 'Watch Party', visibilityState: 'hidden', hasFocus: () => focused });
		win = new EventTarget();
		vi.stubGlobal('document', doc);
		vi.stubGlobal('window', win);
	});
	afterEach(() => { unmount(); vi.unstubAllGlobals(); });

	it('ignores initial history and counts genuinely new hidden messages once', () => {
		render().onMessage(history([1, 2]));
		expect(render()).toMatchObject({ enabled: true, unread: 0 });
		live(2);
		live(3);
		live(3);
		expect(render().unread).toBe(1);
		expect(doc.title).toBe('(1) Watch Party');
	});

	it('counts when visible but unfocused and clears only when both visible and focused', () => {
		render().onMessage(history([]));
		doc.visibilityState = 'visible';
		win.dispatchEvent(new Event('blur'));
		live(1);
		expect(render().unread).toBe(1);
		doc.dispatchEvent(new Event('visibilitychange'));
		expect(render().unread).toBe(1);
		focused = true;
		win.dispatchEvent(new Event('focus'));
		expect(render().unread).toBe(0);
		expect(doc.title).toBe('Watch Party');
		live(2);
		expect(render().unread).toBe(0);
	});

	it('does not clear while hidden even if the window reports focus', () => {
		render().onMessage(history([]));
		live(1);
		focused = true;
		win.dispatchEvent(new Event('focus'));
		expect(render().unread).toBe(1);
		doc.visibilityState = 'visible';
		doc.dispatchEvent(new Event('visibilitychange'));
		expect(render().unread).toBe(0);
	});

	it('clears on disable and re-enables at zero without replaying messages received while off', () => {
		render().onMessage(history([]));
		live(1);
		render().toggle();
		expect(render()).toMatchObject({ enabled: false, unread: 0 });
		expect(doc.title).toBe('Watch Party');
		live(2);
		render().toggle();
		render().onMessage(history([1, 2]));
		expect(render()).toMatchObject({ enabled: true, unread: 0 });
		live(3);
		expect(render().unread).toBe(1);
	});

	it('counts missed same-session reconnect history and preserves a manual OFF setting', () => {
		render().onMessage(history([1]));
		live(2);
		render().onMessage({ type: 'authenticated', role: 'viewer', listenerCount: 1, serverNowMs: 0 });
		render().onMessage(history([1, 2, 3, 4]));
		expect(render().unread).toBe(3);
		render().onMessage(history([1, 2, 3, 4]));
		expect(render().unread).toBe(3);
		render().toggle();
		render().onMessage({ type: 'authenticated', role: 'viewer', listenerCount: 1, serverNowMs: 0 });
		render().onMessage(history([3, 4, 5]));
		expect(render()).toMatchObject({ enabled: false, unread: 0 });
	});

	it('resets unread on room session replacement without counting its history', () => {
		render().onMessage(history([]));
		live(1);
		render().onMessage(history([1, 2], 'replacement'));
		expect(render().unread).toBe(0);
		live(3, 'room');
		expect(render().unread).toBe(0);
		live(3, 'replacement');
		expect(render().unread).toBe(1);
	});

	it('keeps unread independent of the 500-message history window', () => {
		render().onMessage(history([]));
		for (let id = 1; id <= 1600; id++) live(id);
		render().onMessage(history(Array.from({ length: 500 }, (_, i) => 1101 + i)));
		expect(render().unread).toBe(1600);
		expect(doc.title).toBe('(1600) Watch Party');
	});

	it('resets ON for an actual join, clears on Leave and ignores late messages', () => {
		render().onMessage(history([]));
		live(1);
		render().clear();
		live(2);
		expect(render().unread).toBe(0);
		expect(doc.title).toBe('Watch Party');
		active = false;
		render();
		render().reset();
		active = true;
		render().onMessage(history([1, 2]));
		expect(render()).toMatchObject({ enabled: true, unread: 0 });
		render().toggle();
		render().reset();
		expect(render()).toMatchObject({ enabled: true, unread: 0 });
	});

	it('excludes own messages when authentication supplies the optional senderId', () => {
		const auth = { type: 'authenticated' as const, role: 'viewer' as const, listenerCount: 1, serverNowMs: 0, senderId: 'self' };
		render().onMessage(auth);
		render().onMessage(history([]));
		live(1, 'room', 'self');
		live(2, 'room', 'other');
		expect(render().unread).toBe(1);
	});

	it('retains self IDs across reconnects but discards old-room self IDs on session replacement', () => {
		const authenticate = (senderId: string) => render().onMessage({
			type: 'authenticated', role: 'viewer', listenerCount: 1, serverNowMs: 0, senderId,
		});
		authenticate('first-socket');
		render().onMessage(history([]));
		authenticate('second-socket');
		render().onMessage({ type: 'chat_history', chat: { sessionId: 'room', messages: [
			message(1, 'room', 'first-socket'), message(2, 'room', 'second-socket'), message(3, 'room', 'other'),
		] } });
		expect(render().unread).toBe(1);
		render().onMessage(history([], 'replacement'));
		live(1, 'replacement', 'first-socket');
		live(2, 'replacement', 'second-socket');
		expect(render().unread).toBe(1);
	});

	it('restores title and removes event listeners on unmount', () => {
		render().onMessage(history([]));
		live(1);
		unmount();
		expect(doc.title).toBe('Watch Party');
		doc.title = 'Unmounted';
		focused = true;
		doc.visibilityState = 'visible';
		win.dispatchEvent(new Event('focus'));
		expect(doc.title).toBe('Unmounted');
	});

	it('tolerates absent or limited document and window globals', () => {
		vi.stubGlobal('document', undefined);
		vi.stubGlobal('window', {});
		expect(() => { render().onMessage(history([])); live(1); }).not.toThrow();
		expect(render().unread).toBe(0);
	});
});

class SocketStub extends EventTarget {
	static OPEN = 1;
	static instances: SocketStub[] = [];
	readyState = 0;
	constructor(_url: string) { super(); SocketStub.instances.push(this); }
	send(_raw: string) {}
	close() { this.readyState = 3; }
	open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
	message(value: ServerMessage) { this.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify(value) })); }
	disconnect() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
}

function elements(node: any): any[] {
	if (!node || typeof node !== 'object') return [];
	if (Array.isArray(node)) return node.flatMap(elements);
	return [node, ...elements(node.props?.children)];
}

describe('app notification join lifecycle', () => {
	let doc: { title: string };
	function render() {
		hooks.index = 0;
		const nodes = elements(WatchPartyApp());
		for (const effect of hooks.effects.splice(0)) effect();
		return {
			header: nodes.find(node => node.type === RoomHeader)!.props,
			settings: nodes.find(node => node.type === PlayerPanel)?.props.settings.props,
			auth: nodes.find(node => node.type === AuthPanel)?.props,
		};
	}
	function join(socket: SocketStub) {
		socket.open();
		socket.message({ type: 'authenticated', role: 'viewer', listenerCount: 1, serverNowMs: 0 });
		socket.message(history([1]));
		return render();
	}
	beforeEach(() => {
		vi.useFakeTimers();
		vi.spyOn(console, 'info').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		hooks.slots = [];
		hooks.effects = [];
		SocketStub.instances = [];
		const items = new Map([['watchparty-password:viewer', 'password']]);
		const storage = {
			getItem: (key: string) => items.get(key) ?? null,
			setItem: (key: string, value: string) => { items.set(key, value); },
			removeItem: (key: string) => { items.delete(key); },
		};
		vi.stubGlobal('localStorage', storage);
		vi.stubGlobal('window', Object.assign(new EventTarget(), {
			location: { protocol: 'https:', host: 'room.test', pathname: '/' }, localStorage: storage,
			setTimeout, clearTimeout, setInterval, clearInterval,
		}));
		doc = Object.assign(new EventTarget(), { title: 'Watch Party', visibilityState: 'hidden', hasFocus: () => false });
		vi.stubGlobal('document', doc);
		vi.stubGlobal('WebSocket', SocketStub);
	});
	afterEach(() => {
		for (const slot of hooks.slots) slot.cleanup?.();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	it('starts saved-password joins ON, keeps OFF through reconnect, and resets ON for manual rejoin', () => {
		expect(render().settings).toBeUndefined();
		const first = SocketStub.instances[0];
		expect(join(first).settings.notificationsEnabled).toBe(true);
		first.message({ type: 'chat_message', message: message(2) });
		expect(doc.title).toBe('(1) Watch Party');
		render().settings.onToggleNotifications();
		expect(doc.title).toBe('Watch Party');
		first.disconnect();
		expect(render().settings.notificationsEnabled).toBe(false);
		vi.advanceTimersByTime(1000);
		const second = SocketStub.instances[1];
		expect(join(second).settings.notificationsEnabled).toBe(false);
		second.message(history([1, 2, 3]));
		expect(doc.title).toBe('Watch Party');
		render().header.onLeave();
		const left = render();
		expect(left.settings).toBeUndefined();
		left.auth.onAuthenticate('password');
		render();
		expect(join(SocketStub.instances[2]).settings.notificationsEnabled).toBe(true);
	});

	it('keeps unread through disconnect, counts missed history and clears title immediately on Leave', () => {
		render();
		const first = SocketStub.instances[0];
		join(first);
		first.message({ type: 'chat_message', message: message(2) });
		first.disconnect();
		render();
		expect(doc.title).toBe('(1) Watch Party');
		vi.advanceTimersByTime(1000);
		const second = SocketStub.instances[1];
		join(second);
		second.message(history([1, 2, 3]));
		expect(doc.title).toBe('(2) Watch Party');
		render().header.onLeave();
		expect(doc.title).toBe('Watch Party');
	});
});

it('moves the notification control into the viewing settings cog', () => {
	const toggle = vi.fn();
	for (const enabled of [true, false]) {
		hooks.slots = [];
		hooks.effects = [];
		const render = () => {
			hooks.index = 0;
			return elements(WatchSettings({ preferences: defaultWatchPreferences, onChange: vi.fn(), notificationsEnabled: enabled, onToggleNotifications: toggle }));
		};
		const trigger = render().find(node => node.props['aria-label'] === 'Viewing settings');
		expect(trigger.props['aria-expanded']).toBe(false);
		trigger.props.onClick();
		const label = render().find(node => node.type === 'label' && elements(node).some(child => child.type === 'span' && child.props.children === 'Chat notifications'));
		const checkbox = elements(label).find(node => node.type === 'input');
		expect(checkbox.props.checked).toBe(enabled);
		checkbox.props.onChange();
	}
	hooks.effects = [];
	expect(toggle).toHaveBeenCalledTimes(2);
});
