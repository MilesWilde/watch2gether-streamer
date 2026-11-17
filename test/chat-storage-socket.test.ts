import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isAuthenticationError, parseServerMessage, useWatchPartySocket } from '../src/client/hooks/useWatchPartySocket';
import { useRoomChat } from '../src/client/hooks/useRoomChat';
import { ChatPanel } from '../src/client/components/ChatPanel';
import { WatchPartyApp } from '../src/client/WatchPartyApp';
import { ChatPicker } from '../src/client/components/ChatPicker';
import { CHAT_GIFS } from '../src/stream/chat-media';
import { readChatCache, writeChatCache, writePreferredName } from '../src/client/lib/chatStorage';
import type { ServerMessage } from '../src/stream/messages';
import type { ChatMessage } from '../src/stream/chat';
import { createDefaultChatProfile, type ChatProfile } from '../src/stream/chat-profile';
import { readPreferredProfile, writePreferredProfile } from '../src/client/lib/profileStorage';
import { continuesChatGroup } from '../src/client/lib/chatGrouping';

// Execute real hook callbacks with deterministic commits, without a DOM dependency.
const hooks = vi.hoisted(() => ({
	slots: [] as { current?: unknown; value?: unknown; deps?: readonly unknown[]; cleanup?: void | (() => void) }[],
	index: 0,
	effects: [] as (() => void)[],
}));

vi.mock('react', async importOriginal => {
	const original = await importOriginal<typeof import('react')>();
	function memo(factory: () => unknown, deps: readonly unknown[]) {
		const slot = hooks.slots[hooks.index++] ??= {};
		if (!slot.deps || deps.length !== slot.deps.length || deps.some((dep, index) => !Object.is(dep, slot.deps?.[index]))) {
			slot.value = factory();
			slot.deps = deps;
		}
		return slot.value;
	}
	function effect(callback: () => void | (() => void), deps: readonly unknown[]) {
		const slot = hooks.slots[hooks.index++] ??= {};
		if (!slot.deps || deps.length !== slot.deps.length || deps.some((dep, index) => !Object.is(dep, slot.deps?.[index]))) {
			slot.deps = deps;
			hooks.effects.push(() => {
				slot.cleanup?.();
				slot.cleanup = callback();
			});
		}
	}
	return {
		...original,
		useRef: (value: unknown) => hooks.slots[hooks.index++] ??= { current: value },
		useState: (value: unknown) => {
			const slot = hooks.slots[hooks.index++] ??= { value: typeof value === 'function' ? value() : value };
			return [slot.value, (next: unknown) => {
				slot.value = typeof next === 'function' ? next(slot.value) : next;
			}];
		},
		useCallback: (callback: unknown, deps: readonly unknown[]) => memo(() => callback, deps),
		useMemo: memo,
		useEffect: effect,
		useLayoutEffect: effect,
	};
});

function commit(): void {
	for (const effect of hooks.effects.splice(0)) effect();
}

function unmount(): void {
	for (const slot of hooks.slots) {
		slot.cleanup?.();
		slot.cleanup = undefined;
	}
}

class SocketStub extends EventTarget {
	static OPEN = 1;
	static instances: SocketStub[] = [];
	readyState = 0;
	sent: unknown[] = [];
	close = vi.fn((_code?: number, _reason?: string) => { this.readyState = 3; });
	constructor(readonly url: string) {
		super();
		SocketStub.instances.push(this);
	}
	send(raw: string) { this.sent.push(JSON.parse(raw)); }
	open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
	message(value: ServerMessage) {
		this.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify(value) }));
	}
	disconnect(code = 1006, reason = '', wasClean = false) {
		this.readyState = 3;
		this.dispatchEvent(Object.assign(new Event('close'), { code, reason, wasClean }));
	}
}

function memoryStorage() {
	const items = new Map<string, string>();
	return {
		getItem: (key: string) => items.get(key) ?? null,
		setItem: (key: string, value: string) => { items.set(key, value); },
		removeItem: (key: string) => { items.delete(key); },
	};
}

const authenticated: ServerMessage = { type: 'authenticated', role: 'viewer', listenerCount: 1, serverNowMs: 100 };
const liveMessage = { id: '1', sessionId: 'live', name: 'Alex', text: 'Hello', sentAtMs: 100 };
const history: ServerMessage = { type: 'chat_history', chat: { sessionId: 'live', messages: [liveMessage] } };

it('starts a new sender group when robot appearance changes but not for identical copied profiles', () => {
	const first = { ...liveMessage, senderId: 'same', profile: createDefaultChatProfile() };
	expect(continuesChatGroup(first, { ...first, id: 'next', profile: { ...first.profile } })).toBe(true);
	for (const changed of [{ face: 'round01' }, { eyes: 'hearts' }, { mouth: 'bite' }, { top: 'none' }, { sides: 'none' }, { robotColor: '8ac6ff' }, { backgroundColor: 'f1f4f6' }, { nameColor: 'a9d8ff' }] as Partial<ChatProfile>[]) {
		expect(continuesChatGroup(first, { ...first, id: 'next', profile: { ...first.profile, ...changed } })).toBe(false);
	}
	expect(continuesChatGroup({ ...first, profile: undefined }, first)).toBe(true);
});

describe('chat socket protocol', () => {
	it('accepts optional profile acknowledgments and rejects invalid profile payloads', () => {
		const profile = createDefaultChatProfile();
		const ack = { type: 'name_updated', name: 'Alex', profile };
		expect(parseServerMessage(JSON.stringify(ack))).toEqual(ack);
		for (const invalid of [null, {}, { ...profile, nameColor: 'url(evil)' }]) {
			expect(parseServerMessage(JSON.stringify({ ...ack, profile: invalid }))).toBeNull();
		}
	});
	it('accepts legacy authentication and optional bounded sender IDs but rejects malformed IDs', () => {
		for (const senderId of [undefined, 'self-1', 's'.repeat(200)]) {
			const message = { ...authenticated, ...(senderId === undefined ? {} : { senderId }) };
			expect(parseServerMessage(JSON.stringify(message))).toEqual(message);
		}
		for (const senderId of ['', '   ', 's'.repeat(201), null, 123, {}]) {
			expect(parseServerMessage(JSON.stringify({ ...authenticated, senderId }))).toBeNull();
		}
	});
	it('validates correlated chat acknowledgments at runtime', () => {
		for (const accepted of [true, false]) {
			const result = { type: 'chat_result', requestId: 'send-1', accepted, message: 'Result' };
			expect(parseServerMessage(JSON.stringify(result))).toEqual(result);
		}
		for (const input of [{ requestId: '' }, { requestId: 'x'.repeat(65) }, { requestId: 'bad id' }, { accepted: 'true' }, { message: 123 }]) {
			expect(parseServerMessage(JSON.stringify({ type: 'chat_result', requestId: 'send-1', accepted: true, ...input }))).toBeNull();
		}
	});
	it('accepts the shared history, name and live-message contract', () => {
		const message = { id: '1', sessionId: 'live', name: 'Alex 🌻', text: 'Hello', sentAtMs: 100 };
		for (const value of [{ type: 'chat_history', chat: { sessionId: 'live', messages: [message] } }, { type: 'chat_message', message }, { type: 'name_updated', name: 'Alex 🌻' }]) {
			expect(parseServerMessage(JSON.stringify(value))).toEqual(value);
		}
	});
	it('rejects malformed chat, unconfirmed session messages and invalid JSON', () => {
		expect(parseServerMessage('{')).toBeNull();
		expect(parseServerMessage(JSON.stringify({ type: 'chat_message', message: { text: 'Hello' } }))).toBeNull();
		expect(parseServerMessage(JSON.stringify({ type: 'chat_history', chat: { sessionId: 'live', messages: [{ id: '1', sessionId: 'old', name: 'Alex', text: 'Hello', sentAtMs: 100 }] } }))).toBeNull();
	});
	it('keeps ordinary validation and permission errors separate from authentication loss', () => {
		expect(isAuthenticationError({ message: 'Invalid message' })).toBe(false);
		expect(isAuthenticationError({ message: 'Admin access required', code: 'authorization' })).toBe(false);
		expect(isAuthenticationError({ message: 'Not authenticated' })).toBe(true);
		expect(isAuthenticationError({ message: 'Invalid stream password' })).toBe(true);
		expect(isAuthenticationError({ message: 'Expired credentials', code: 'authentication' })).toBe(true);
	});
});

describe('room chat socket lifecycle', () => {
	let storage: ReturnType<typeof memoryStorage>;
	let page: EventTarget;
	let enabled: boolean;
	let preserveOnDisconnect: boolean;
	const onFailed = vi.fn();

	function render() {
		hooks.index = 0;
		const chat = useRoomChat();
		const socket = useWatchPartySocket({
			authMode: 'viewer', password: 'test-password', enabled, preferredName: chat.name, preferredProfile: chat.profile,
			onMessage: chat.onMessage, onAuthenticationLost: chat.clear, onAuthenticationFailed: onFailed,
			onConnectionInterrupted: preserveOnDisconnect ? chat.suspend : undefined,
		});
		commit();
		return { chat, socket };
	}
	function join() {
		render();
		const socket = SocketStub.instances.at(-1)!;
		socket.open();
		socket.message(authenticated);
		socket.message(history);
		render();
		return socket;
	}

	beforeEach(() => {
		vi.useFakeTimers();
		hooks.slots = [];
		hooks.effects = [];
		SocketStub.instances = [];
		enabled = true;
		preserveOnDisconnect = false;
		onFailed.mockReset();
		storage = memoryStorage();
		page = new EventTarget();
		vi.stubGlobal('window', Object.assign(page, {
			location: { protocol: 'https:', host: 'room.test' }, localStorage: storage,
			setTimeout, clearTimeout, setInterval, clearInterval,
		}));
		vi.stubGlobal('WebSocket', SocketStub);
	});
	afterEach(() => {
		unmount();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('never hydrates cached messages before authentication and authoritative history', () => {
		writeChatCache(storage, { sessionId: 'old', messages: [{ ...liveMessage, sessionId: 'old', text: 'Stale' }] });
		expect(render().chat.messages).toEqual([]);
		const socket = SocketStub.instances[0];
		socket.open();
		socket.message(history);
		expect(render().chat.ready).toBe(false);
		socket.message(authenticated);
		socket.message({ type: 'chat_message', message: liveMessage });
		expect(render().chat.messages).toEqual([]);
		socket.message(history);
		expect(render().chat.messages).toEqual([liveMessage]);
		expect(readChatCache(storage)).toEqual(history.chat);
	});
	it('saves only authenticated profile acknowledgments and reuses preferences after leaving', () => {
		const profile = { ...createDefaultChatProfile(), eyes: 'hearts' as const, nameColor: 'a9d8ff' as const };
		writePreferredProfile(storage, profile);
		let value = render();
		expect(value.chat.profile).toEqual(profile);
		const socket = SocketStub.instances.at(-1)!;
		socket.open();
		expect(socket.sent[0]).toMatchObject({ type: 'authenticate', profile });
		const next = { ...profile, mouth: 'bite' as const };
		socket.message({ type: 'name_updated', name: 'Ignored', profile: next });
		expect(readPreferredProfile(storage)).toEqual(profile);
		socket.message(authenticated);
		socket.message(history);
		expect(value.socket.send({ type: 'set_profile', name: 'Alex 🤖', profile: next })).toBe(true);
		expect(readPreferredProfile(storage)).toEqual(profile);
		socket.message({ type: 'name_updated', name: 'Alex 🤖', profile: next });
		value = render();
		expect(value.chat.profile).toEqual(next);
		expect(value.chat.name).toBe('Alex 🤖');
		expect(readPreferredProfile(storage)).toEqual(next);
		expect(SocketStub.instances).toHaveLength(1);
		socket.message({ type: 'name_updated', name: 'Legacy rename' });
		value = render();
		expect(value.chat.profile).toEqual(next);
		preserveOnDisconnect = true;
		render();
		socket.disconnect();
		render();
		vi.advanceTimersByTime(1000);
		const returned = SocketStub.instances.at(-1)!;
		returned.open();
		expect(returned.sent[0]).toMatchObject({ type: 'authenticate', name: 'Legacy rename', profile: next });
		returned.message(authenticated);
		returned.message(history);
		value = render();
		value.socket.leave();
		value = render();
		expect(value.chat.profile).toEqual(next);
		expect(readPreferredProfile(storage)).toEqual(next);
	});

	it('clears history and cache on disconnect and requires a new confirmed history after reconnect', () => {
		const first = join();
		expect(readChatCache(storage)?.messages).toHaveLength(1);
		first.disconnect();
		const disconnected = render();
		expect(disconnected.socket.authenticated).toBe(false);
		expect(disconnected.chat.ready).toBe(false);
		expect(disconnected.chat.messages).toEqual([]);
		expect(readChatCache(storage)).toBeNull();
		vi.advanceTimersByTime(1000);
		const second = SocketStub.instances[1];
		second.open();
		second.message(authenticated);
		expect(render().chat.ready).toBe(false);
		first.message(history);
		expect(render().chat.messages).toEqual([]);
		second.message(history);
		expect(render().chat.messages).toEqual([liveMessage]);
	});

	it('reconnects a silent authenticated socket while preserving visible history', () => {
		preserveOnDisconnect = true;
		const first = join();
		vi.advanceTimersByTime(20000);
		expect(first.close).toHaveBeenCalled();
		expect(render().socket.authenticated).toBe(false);
		expect(render().chat.messages).toEqual([liveMessage]);
		vi.advanceTimersByTime(1000);
		expect(SocketStub.instances).toHaveLength(2);
	});

	it('keeps a responding heartbeat connected', () => {
		const first = join();
		for (let heartbeat = 0; heartbeat < 8; heartbeat++) {
			vi.advanceTimersByTime(5000);
			first.message({ type: 'pong', serverNowMs: Date.now() });
		}
		expect(first.close).not.toHaveBeenCalled();
		expect(SocketStub.instances).toHaveLength(1);
	});

	it('reconnects when authentication never arrives', () => {
		render();
		SocketStub.instances[0].open();
		vi.advanceTimersByTime(21000);
		expect(SocketStub.instances).toHaveLength(2);
	});

	it('keeps a failed initial heartbeat behind the authentication gate and retries once', () => {
		render();
		const first = SocketStub.instances[0];
		first.open();
		vi.spyOn(first, 'send').mockImplementation(() => { throw new Error('transport unavailable'); });
		first.message(authenticated);
		expect(render().socket.authenticated).toBe(false);
		expect(vi.getTimerCount()).toBe(1);
		vi.advanceTimersByTime(1000);
		expect(SocketStub.instances).toHaveLength(2);
	});

	it('probes a healthy socket after timer suspension before deciding it is stale', () => {
		const first = join();
		first.message({ type: 'pong', serverNowMs: Date.now() });
		const clock = vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 100000);
		try {
			vi.advanceTimersByTime(5000);
			expect(first.close).not.toHaveBeenCalled();
			expect(first.sent.filter(message => (message as { type: string }).type === 'ping')).toHaveLength(2);
		} finally { clock.mockRestore(); }
	});

	it('retries network loss before the first authentication response', () => {
		render();
		SocketStub.instances[0].dispatchEvent(new Event('error'));
		vi.advanceTimersByTime(1000);
		expect(SocketStub.instances).toHaveLength(2);
		SocketStub.instances[1].open();
		SocketStub.instances[1].message(authenticated);
		expect(render().socket.authenticated).toBe(true);
	});

	it('preserves visible history on interruption but ignores live events until a fresh snapshot', () => {
		preserveOnDisconnect = true;
		const first = join();
		first.disconnect();
		expect(render().chat.messages).toEqual([liveMessage]);
		expect(render().chat.ready).toBe(false);
		expect(readChatCache(storage)?.messages).toEqual([liveMessage]);
		vi.advanceTimersByTime(1000);
		const second = SocketStub.instances[1];
		second.open();
		second.message(authenticated);
		second.message({ type: 'chat_message', message: { ...liveMessage, id: 'too-early', text: 'Unconfirmed' } });
		expect(render().chat.messages).toEqual([liveMessage]);
		expect(render().chat.ready).toBe(false);
		second.message({ type: 'chat_history', chat: { sessionId: 'fresh', messages: [] } });
		expect(render().chat.messages).toEqual([]);
		expect(render().chat.ready).toBe(true);
		expect(readChatCache(storage)).toEqual({ sessionId: 'fresh', messages: [] });
	});

	it('Leave closes immediately, clears the cache, preserves the name and ignores late events', () => {
		const first = join();
		first.message({ type: 'name_updated', name: 'Alex 🌻' });
		const joined = render();
		joined.socket.leave();
		expect(first.sent.at(-1)).toEqual({ type: 'leave' });
		expect(first.close).toHaveBeenCalledWith(1000, 'User left room');
		expect(readChatCache(storage)).toBeNull();
		for (const event of [authenticated, history]) first.message(event);
		first.disconnect();
		page.dispatchEvent(new Event('pageshow'));
		vi.advanceTimersByTime(10000);
		expect(SocketStub.instances).toHaveLength(1);
		expect(render().chat.messages).toEqual([]);
		expect(render().socket.authenticated).toBe(false);
		expect(storage.getItem('watchparty-display-name:global')).toBe('Alex 🌻');
		enabled = false;
		render();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('Leave cancels a retry that was already scheduled', () => {
		const first = join();
		first.disconnect();
		expect(vi.getTimerCount()).toBe(1);
		render().socket.leave();
		vi.advanceTimersByTime(10000);
		expect(SocketStub.instances).toHaveLength(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('Leave still closes with the compatibility reason if the protocol send fails', () => {
		const first = join();
		const failedSend = vi.spyOn(first, 'send').mockImplementation(() => { throw new Error('closed transport'); });
		expect(() => render().socket.leave()).not.toThrow();
		expect(failedSend).toHaveBeenCalledWith(JSON.stringify({ type: 'leave' }));
		expect(first.close).toHaveBeenCalledWith(1000, 'User left room');
		expect(readChatCache(storage)).toBeNull();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('pagehide suspends history and cache, while bfcache pageshow recovers behind the snapshot gate', () => {
		preserveOnDisconnect = true;
		const first = join();
		page.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }));
		expect(first.close).toHaveBeenCalled();
		expect(readChatCache(storage)?.messages).toEqual([liveMessage]);
		expect(render().chat.messages).toEqual([liveMessage]);
		expect(render().chat.ready).toBe(false);
		expect(first.sent).not.toContainEqual({ type: 'leave' });
		first.message(history);
		vi.advanceTimersByTime(10000);
		expect(SocketStub.instances).toHaveLength(1);
		page.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
		expect(SocketStub.instances).toHaveLength(2);
		const second = SocketStub.instances[1];
		second.open();
		second.message(history);
		expect(render().chat.ready).toBe(false);
		second.message(authenticated);
		expect(render().chat.ready).toBe(false);
		expect(render().chat.messages).toEqual([liveMessage]);
		second.message({ type: 'chat_history', chat: { sessionId: 'new-room', messages: [] } });
		expect(render().chat.messages).toEqual([]);
		page.dispatchEvent(new Event('pageshow'));
		expect(SocketStub.instances).toHaveLength(2);
	});

	it.each(['close', 'error'])('preserves cache on %s and reconciles a same-session snapshot only after authentication', event => {
		preserveOnDisconnect = true;
		const first = join();
		first.dispatchEvent(new Event(event));
		expect(readChatCache(storage)?.messages).toEqual([liveMessage]);
		vi.advanceTimersByTime(1000);
		const second = SocketStub.instances[1];
		second.open();
		const corrected = { ...liveMessage, text: 'Server correction' };
		const next = { ...liveMessage, id: '2' };
		const snapshot: ServerMessage = { type: 'chat_history', chat: { sessionId: 'live', messages: [next, corrected, corrected] } };
		second.message(snapshot);
		expect(render().chat.messages).toEqual([liveMessage]);
		second.message(authenticated);
		second.message({ type: 'chat_history', chat: { sessionId: 'live', messages: [next] } });
		expect(render().chat.messages).toEqual([liveMessage, next]);
		second.message(snapshot);
		expect(render().chat.messages).toEqual([next, corrected]);
		expect(readChatCache(storage)?.messages).toEqual([next, corrected]);
	});

	it('logs redacted late close metadata once after error without duplicate retries', () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => {});
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			preserveOnDisconnect = true;
			const first = join();
			first.message({ type: 'error', message: 'secret-server-error' });
			first.message({ type: 'pong', serverNowMs: 100 });
			vi.advanceTimersByTime(250);
			first.dispatchEvent(new Event('error'));
			first.disconnect(1011, 'secret-server-error test-password Alex Hello https://room.test/ws', false);
			first.disconnect(1011, 'duplicate', false);
			const calls = [...info.mock.calls, ...warn.mock.calls];
			const closes = calls.filter(([prefix, entry]) => prefix === '[watchparty:socket]' && entry.event === 'close');
			expect(closes).toHaveLength(1);
			expect(closes[0][1]).toMatchObject({ code: 1011, reason: '[redacted]', wasClean: false, connectionAttempt: 1, reconnectAttempt: 0, durationMs: 250, lastPongAgeMs: 250 });
			expect(closes[0][1].timestamp).toEqual(expect.any(String));
			const serialized = JSON.stringify(calls);
			for (const secret of ['test-password', 'secret-server-error', 'Alex', 'Hello', 'room.test']) expect(serialized).not.toContain(secret);
			expect(vi.getTimerCount()).toBe(1);
			vi.advanceTimersByTime(1000);
			expect(SocketStub.instances).toHaveLength(2);
		} finally { info.mockRestore(); warn.mockRestore(); }
	});

	it('keeps validation and malformed-message errors authenticated, but clears on authentication loss', () => {
		const first = join();
		first.message({ type: 'error', message: 'Invalid message' });
		first.dispatchEvent(Object.assign(new Event('message'), { data: '{' }));
		expect(render().socket.authenticated).toBe(true);
		expect(render().chat.ready).toBe(true);
		vi.advanceTimersByTime(5000);
		expect(first.sent).toContainEqual({ type: 'ping' });
		first.message({ type: 'error', message: 'Not authenticated' });
		expect(render().socket.authenticated).toBe(false);
		expect(readChatCache(storage)).toBeNull();
		expect(onFailed).toHaveBeenCalledWith('Not authenticated');
		expect(vi.getTimerCount()).toBe(0);
	});

	it('does not reconnect on name acknowledgement and sends the server-normalized saved name on retry', () => {
		writePreferredName(storage, 'Alex 🌻');
		const first = join();
		expect(first.sent[0]).toEqual({ type: 'authenticate', mode: 'viewer', password: 'test-password', name: 'Alex 🌻', profile: createDefaultChatProfile() });
		first.message({ type: 'name_updated', name: 'Alex' });
		render();
		expect(SocketStub.instances).toHaveLength(1);
		first.disconnect();
		render();
		vi.advanceTimersByTime(1000);
		SocketStub.instances[1].open();
		expect(SocketStub.instances[1].sent[0]).toEqual({ type: 'authenticate', mode: 'viewer', password: 'test-password', name: 'Alex', profile: createDefaultChatProfile() });
	});

	it('cleanup closes the socket, removes page listeners and ignores late socket callbacks', () => {
		const first = join();
		unmount();
		first.message(history);
		first.disconnect();
		page.dispatchEvent(new Event('pagehide'));
		page.dispatchEvent(new Event('pageshow'));
		vi.advanceTimersByTime(10000);
		expect(first.close).toHaveBeenCalled();
		expect(first.close).not.toHaveBeenCalledWith(1000, 'User left room');
		expect(first.sent).not.toContainEqual({ type: 'leave' });
		expect(readChatCache(storage)).toBeNull();
		expect(SocketStub.instances).toHaveLength(1);
		expect(vi.getTimerCount()).toBe(0);
	});
});

type UiElement = { type: unknown; props: Record<string, unknown> };
function elements(node: unknown): UiElement[] {
	if (Array.isArray(node)) return node.flatMap(elements);
	if (!node || typeof node !== 'object' || !('props' in node)) return [];
	const element = node as UiElement;
	return [element, ...elements(element.props.children)];
}

describe('unified reaction picker', () => {
	beforeEach(() => { hooks.slots = []; hooks.effects = []; hooks.index = 0; });
	afterEach(() => { unmount(); hooks.effects = []; hooks.slots = []; vi.unstubAllGlobals(); });
	it('combines illustrated emotes and Unicode emoji into one Emoji tab beside GIFs', () => {
		const nodes = elements(ChatPicker({ triggerRef: { current: null }, onEmoji() {}, onGif() {}, onClose() {} }));
		expect(nodes.filter(node => node.props.role === 'tab').map(node => node.props.children)).toEqual(['Emoji', 'GIFs']);
		expect(nodes.some(node => node.type === 'img' && String(node.props.src).startsWith('/emotes/'))).toBe(true);
		expect(nodes.some(node => node.type === 'button' && node.props['aria-label'] === 'Insert 🐛')).toBe(true);
		const gifTab = nodes.find(node => node.props.role === 'tab' && node.props.children === 'GIFs')!;
		(gifTab.props.onClick as () => void)();
		hooks.index = 0;
		const gifNodes = elements(ChatPicker({ triggerRef: { current: null }, onEmoji() {}, onGif() {}, onClose() {} }));
		expect(gifNodes.some(node => node.type === 'a' && node.props.href === '/gifs/noto-animated/ATTRIBUTION.txt')).toBe(true);
	});
	it('opens a modal browser with a close button instead of pagination commands', () => {
		const nodes = elements(ChatPicker({ triggerRef: { current: null }, onEmoji() {}, onGif() {}, onClose() {} }));
		expect(nodes.find(node => node.props.role === 'dialog')?.props['aria-modal']).toBe(true);
		expect(nodes.some(node => node.props['aria-label'] === 'Close picker')).toBe(true);
		expect(nodes.some(node => ['Previous reactions', 'More reactions', 'Previous GIFs', 'More GIFs'].includes(String(node.props['aria-label'])))).toBe(false);
	});
	it('appends GIF results when scrolling near the end rather than replacing the current page', () => {
		const props = { triggerRef: { current: null }, onEmoji() {}, onGif() {}, onClose() {} };
		let nodes = elements(ChatPicker(props));
		(nodes.find(node => node.props.role === 'tab' && node.props.children === 'GIFs')!.props.onClick as () => void)();
		hooks.index = 0;
		nodes = elements(ChatPicker(props));
		const initial = nodes.filter(node => node.type === 'button' && String(node.props['aria-label']).startsWith('Select '));
		expect(initial.length).toBeGreaterThanOrEqual(48);
		const content = nodes.find(node => node.props.id === 'picker-content')!;
		const scroller = { scrollTop: 3500, scrollHeight: 4000, clientHeight: 600 };
		(content.props.ref as { current: unknown }).current = scroller;
		(content.props.onScroll as (event: unknown) => void)({ currentTarget: scroller });
		hooks.index = 0;
		nodes = elements(ChatPicker(props));
		const expanded = nodes.filter(node => node.type === 'button' && String(node.props['aria-label']).startsWith('Select '));
		expect(expanded.length).toBeGreaterThan(initial.length);
		expect(expanded.slice(0, initial.length).map(node => node.props['aria-label'])).toEqual(initial.map(node => node.props['aria-label']));
	});
	it('keeps the chosen GIF tab and search when closed and reopened', () => {
		const props = { triggerRef: { current: null }, onEmoji() {}, onGif() {}, onClose() {} };
		let nodes = elements(ChatPicker(props));
		(nodes.find(node => node.props.role === 'tab' && node.props.children === 'GIFs')!.props.onClick as () => void)();
		hooks.index = 0;
		nodes = elements(ChatPicker(props));
		(nodes.find(node => node.type === 'input' && node.props.type === 'search')!.props.onChange as (event: unknown) => void)({ currentTarget: { value: 'cat' } });
		hooks.index = 0;
		expect(ChatPicker({ ...props, open: false })).toBeNull();
		hooks.index = 0;
		nodes = elements(ChatPicker({ ...props, open: true }));
		expect(nodes.find(node => node.props.role === 'tab' && node.props.children === 'GIFs')?.props['aria-selected']).toBe(true);
		expect(nodes.find(node => node.type === 'input' && node.props.type === 'search')?.props.value).toBe('cat');
	});
	it('preserves a live GIF bookmark while refetched pages are too short to restore it', () => {
		const props = { triggerRef: { current: null }, onEmoji() {}, onGif() {}, onClose() {} };
		let nodes = elements(ChatPicker(props));
		(nodes.find(node => node.props.role === 'tab' && node.props.children === 'GIFs')!.props.onClick as () => void)();
		hooks.index = 0;
		nodes = elements(ChatPicker(props));
		(nodes.find(node => node.type === 'select' && node.props.value === 'collection')!.props.onChange as (event: unknown) => void)({ currentTarget: { value: 'giphy' } });
		const bookmark = hooks.slots.find(slot => slot.current && typeof slot.current === 'object' && 'gif' in slot.current)! as { current: { gif: { scrollTop: number } } };
		bookmark.current.gif.scrollTop = 1800;
		const provider = hooks.slots.find(slot => slot.value && typeof slot.value === 'object' && 'nextOffset' in slot.value)!;
		provider.value = { ...provider.value as object, nextOffset: 24 };
		hooks.index = 0;
		nodes = elements(ChatPicker(props));
		const content = nodes.find(node => node.props.id === 'picker-content')!;
		const scroller = { scrollTop: 400, scrollHeight: 1000, clientHeight: 600 };
		(content.props.ref as { current: unknown }).current = scroller;
		(content.props.onScroll as (event: unknown) => void)({ currentTarget: scroller });
		expect(bookmark.current.gif.scrollTop).toBe(1800);
		// An intentional wheel gesture takes over from the saved bookmark.
		(content.props.onWheel as () => void)();
		(content.props.onScroll as (event: unknown) => void)({ currentTarget: scroller });
		expect(bookmark.current.gif.scrollTop).toBe(400);
	});
	it('wraps backward focus from the selected GIF tab past the inactive Emoji tab', () => {
		const selected = { tabIndex: 0, focus: vi.fn() };
		const last = { tabIndex: 0, focus: vi.fn() };
		const documentStub = Object.assign(new EventTarget(), { body: { style: { overflow: '' } }, activeElement: selected });
		vi.stubGlobal('document', documentStub);
		vi.stubGlobal('window', new EventTarget());
		const props = { triggerRef: { current: null }, onEmoji() {}, onGif() {}, onClose() {} };
		let nodes = elements(ChatPicker(props));
		(nodes.find(node => node.props.role === 'tab' && node.props.children === 'GIFs')!.props.onClick as () => void)();
		hooks.index = 0;
		nodes = elements(ChatPicker(props));
		const dialog = nodes.find(node => node.props.role === 'dialog')!;
		(dialog.props.ref as { current: unknown }).current = { querySelectorAll: () => [{ tabIndex: -1 }, selected, last], contains: () => true };
		commit();
		const event = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Tab', shiftKey: true });
		documentStub.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(true);
		expect(last.focus).toHaveBeenCalledOnce();
	});
	it('saves completed live GIF pages even when no scroll event follows the response', () => {
		const storage = memoryStorage();
		const page = Object.assign(new EventTarget(), { localStorage: storage });
		vi.stubGlobal('window', page);
		vi.stubGlobal('document', Object.assign(new EventTarget(), { body: { style: { overflow: '' } }, activeElement: null }));
		const props = { triggerRef: { current: null }, onEmoji() {}, onGif() {}, onClose() {} };
		let nodes = elements(ChatPicker(props));
		(nodes.find(node => node.props.role === 'tab' && node.props.children === 'GIFs')!.props.onClick as () => void)();
		hooks.index = 0;
		nodes = elements(ChatPicker(props));
		(nodes.find(node => node.type === 'select' && node.props.value === 'collection')!.props.onChange as (event: unknown) => void)({ currentTarget: { value: 'giphy' } });
		const provider = hooks.slots.find(slot => slot.value && typeof slot.value === 'object' && 'nextOffset' in slot.value)!;
		provider.value = { ...provider.value as object, items: Array.from({ length: 120 }, (_, index) => ({ id: `giphy:QA${index}`, label: `GIF ${index}`, url: '' })) };
		hooks.index = 0;
		ChatPicker(props);
		commit();
		page.dispatchEvent(new Event('pagehide'));
		expect(JSON.parse(storage.getItem('watchparty-chat-picker:global')!).gif.visibleCount).toBe(120);
	});
});

describe('chat composer Unicode and IME input', () => {
	const onSend = vi.fn((_text: string, _gifId: string | undefined, _requestId: string) => true);
	let result: Extract<ServerMessage, { type: 'chat_result' }> | null;
	let error: string | null;
	let ready: boolean;
	let composerDom: { disabled: boolean; focus: () => void } | null;
	let messages: ChatMessage[];
	let logDom: { scrollTop: number; scrollHeight: number; clientHeight: number } | null;
	function render() {
		hooks.index = 0;
		const nodes = elements(ChatPanel({ messages, name: 'Alex', ready, error, result, onSend, onNameChange: () => true }));
		if (composerDom) {
			const textarea = find(nodes, node => node.type === 'textarea');
			composerDom.disabled = textarea.props.disabled as boolean;
			(textarea.props.ref as { current: unknown }).current = composerDom;
		}
		if (logDom) (find(nodes, node => node.props.role === 'log').props.ref as { current: unknown }).current = logDom;
		commit();
		return nodes;
	}
	function find(nodes: UiElement[], predicate: (node: UiElement) => boolean): UiElement {
		const node = nodes.find(predicate);
		if (!node) throw Error('Expected composer element not found');
		return node;
	}
	function setDraft(value: string): UiElement[] {
		const textarea = find(render(), node => node.type === 'textarea');
		(textarea.props.onChange as (event: { currentTarget: { value: string } }) => void)({ currentTarget: { value } });
		return render();
	}
	beforeEach(() => {
		vi.useFakeTimers();
		hooks.slots = [];
		hooks.effects = [];
		onSend.mockReset();
		onSend.mockReturnValue(true);
		result = null;
		error = null;
		ready = true;
		composerDom = null;
		messages = [];
		logDom = null;
	});
	afterEach(() => { unmount(); vi.useRealTimers(); });

	function submitWithGif() {
		setDraft('keep draft');
		const trigger = find(render(), node => node.props['aria-label'] === 'Emoji and GIFs');
		(trigger.props.onClick as (event: unknown) => void)({ detail: 1, clientX: 600, clientY: 400 });
		const picker = find(render(), node => node.type === ChatPicker);
		(picker.props.onGif as (id: string) => void)(CHAT_GIFS[0].id);
		const form = find(render(), node => node.props.className === 'chat-composer');
		(form.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault() {} });
		return onSend.mock.calls.at(-1)![2];
	}
	function expectDraft() {
		const nodes = render();
		expect(find(nodes, node => node.type === 'textarea').props.value).toBe('keep draft');
		expect(nodes.some(node => node.props.className === 'pending-gif')).toBe(true);
	}
	it('keeps a draft editable offline while disabling sending', () => {
		setDraft('offline draft');
		ready = false;
		const nodes = render();
		expect(find(nodes, node => node.type === 'textarea').props.value).toBe('offline draft');
		expect(find(nodes, node => node.type === 'textarea').props.disabled).toBe(false);
		expect(find(nodes, node => node.props['aria-label'] === 'Send message').props.disabled).toBe(true);
		expect(find(nodes, node => node.props['aria-label'] === 'Emoji and GIFs').props.disabled).toBe(false);
	});
	it('anchors the picker at the pointer location on each opening', () => {
		let trigger = find(render(), node => node.props['aria-label'] === 'Emoji and GIFs');
		(trigger.props.onClick as (event: unknown) => void)({ detail: 1, clientX: 615, clientY: 420 });
		let picker = find(render(), node => node.type === ChatPicker);
		expect(picker.props.anchor).toEqual({ x: 615, y: 420 });
		expect(picker.props.open).toBe(true);
		(picker.props.onClose as () => void)();
		trigger = find(render(), node => node.props['aria-label'] === 'Emoji and GIFs');
		(trigger.props.onClick as (event: unknown) => void)({ detail: 1, clientX: 400, clientY: 300 });
		picker = find(render(), node => node.type === ChatPicker);
		expect(picker.props.anchor).toEqual({ x: 400, y: 300 });
	});
	it('anchors keyboard activation to the emoji button instead of the pointer origin', () => {
		const trigger = find(render(), node => node.props['aria-label'] === 'Emoji and GIFs');
		(trigger.props.onClick as (event: unknown) => void)({ detail: 0, clientX: 0, clientY: 0, currentTarget: { getBoundingClientRect: () => ({ left: 150, bottom: 480 }) } });
		expect(find(render(), node => node.type === ChatPicker).props.anchor).toEqual({ x: 150, y: 480 });
	});
	it('renders one visible name header per consecutive sender run, including duplicate names', () => {
		messages = [
			{ ...liveMessage, id: '1', senderId: 'alice', text: ':bug: hi' },
			{ ...liveMessage, id: '2', senderId: 'alice' },
			{ ...liveMessage, id: '3', senderId: 'bob' },
			{ ...liveMessage, id: '4', senderId: 'bob', name: 'Changed' },
			{ ...liveMessage, id: '5' },
			{ ...liveMessage, id: '6' },
		];
		const nodes = render();
		expect(nodes.filter(node => node.props.className === 'chat-message-meta')).toHaveLength(5);
		expect(nodes.filter(node => node.props.className === 'chat-message chat-message-continuation')).toHaveLength(1);
		expect(nodes.some(node => node.type === 'img' && node.props.alt === ':bug:')).toBe(true);
		expect(nodes.filter(node => node.type === 'time')).toHaveLength(6);
	});
	it('retains text and GIF after the ninth send is rejected and clears only its matching accepted retry', () => {
		const requestId = submitWithGif();
		expectDraft();
		expect(find(render(), node => node.props['aria-label'] === 'Send message').props.disabled).toBe(true);
		error = 'Unrelated video error';
		result = { type: 'chat_result', requestId: 'someone-else', accepted: true };
		render();
		expectDraft();
		result = { type: 'chat_result', requestId, accepted: false, message: 'Messages are arriving too quickly.' };
		render();
		expectDraft();
		expect(find(render(), node => node.props.role === 'alert').props.children).toContain('quickly');
		const retryId = submitWithGif();
		expect(retryId).not.toBe(requestId);
		result = { type: 'chat_result', requestId, accepted: true };
		render();
		expectDraft();
		result = { type: 'chat_result', requestId: retryId, accepted: true };
		render();
		const nodes = render();
		expect(find(nodes, node => node.type === 'textarea').props.value).toBe('');
		expect(nodes.some(node => node.props.className === 'pending-gif')).toBe(false);
	});
	it('retains text and GIF when local socket send fails', () => {
		onSend.mockReturnValue(false);
		submitWithGif();
		expectDraft();
		expect(find(render(), node => node.props['aria-label'] === 'Send message').props.disabled).toBe(false);
	});
	it.each([true, false])('restores composer focus only after the enabled commit (accepted=%s)', accepted => {
		const focus = vi.fn(() => { expect(composerDom!.disabled).toBe(false); });
		composerDom = { disabled: false, focus };
		const requestId = submitWithGif();
		render();
		expect(composerDom.disabled).toBe(true);
		focus.mockClear();
		result = { type: 'chat_result', requestId, accepted };
		render();
		expect(focus).not.toHaveBeenCalled();
		render();
		expect(composerDom.disabled).toBe(false);
		expect(focus).toHaveBeenCalledOnce();
	});
	it.each([true, false])('preserves own-send scroll intent before acknowledgment only on local success (%s)', sent => {
		logDom = { scrollTop: 0, scrollHeight: 1000, clientHeight: 100 };
		const log = find(render(), node => node.props.role === 'log');
		(log.props.onScroll as () => void)();
		onSend.mockReturnValue(sent);
		submitWithGif();
		messages = [{ ...liveMessage, text: 'keep draft' }];
		render();
		expect(logDom.scrollTop).toBe(sent ? 1000 : 0);
		expectDraft();
		expect(render().some(node => node.props.className === 'new-messages')).toBe(!sent);
	});
	it('recovers a timed-out send without clearing draft or accepting a late result', () => {
		const requestId = submitWithGif();
		render();
		vi.advanceTimersByTime(10000);
		expectDraft();
		expect(find(render(), node => node.props['aria-label'] === 'Send message').props.disabled).toBe(false);
		result = { type: 'chat_result', requestId, accepted: true };
		render();
		expectDraft();
	});

	it('accepts a colon suggestion with Enter without submitting the message', () => {
		vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { callback(); return 0; });
		try {
			const nodes = setDraft(':bug');
			expect(nodes.some(node => node.props.role === 'listbox')).toBe(true);
			const textarea = find(nodes, node => node.type === 'textarea');
			const preventDefault = vi.fn();
			(textarea.props.onKeyDown as (event: unknown) => void)({ key: 'Enter', shiftKey: false, keyCode: 13, nativeEvent: { isComposing: false }, preventDefault });
			expect(onSend).not.toHaveBeenCalled();
			expect(preventDefault).toHaveBeenCalledOnce();
			expect(find(render(), node => node.type === 'textarea').props.value).not.toBe(':bug');
			expect(render().some(node => node.props.role === 'listbox')).toBe(false);
		} finally { vi.unstubAllGlobals(); }
	});

	it('dismisses autocomplete with Escape and preserves IME and Shift+Enter while it is open', () => {
		let nodes = setDraft(':bug');
		const keydown = find(nodes, node => node.type === 'textarea').props.onKeyDown as (event: unknown) => void;
		const preventDefault = vi.fn();
		const stopPropagation = vi.fn();
		for (const overrides of [{ nativeEvent: { isComposing: true } }, { keyCode: 229 }, { shiftKey: true }]) {
			keydown({ key: 'Enter', shiftKey: false, keyCode: 13, nativeEvent: { isComposing: false }, preventDefault, stopPropagation, ...overrides });
		}
		expect(onSend).not.toHaveBeenCalled();
		expect(preventDefault).not.toHaveBeenCalled();
		expect(render().some(node => node.props.role === 'listbox')).toBe(true);
		keydown({ key: 'Escape', shiftKey: false, keyCode: 27, nativeEvent: { isComposing: false }, preventDefault, stopPropagation });
		nodes = render();
		expect(nodes.some(node => node.props.role === 'listbox')).toBe(false);
		expect(find(nodes, node => node.type === 'textarea').props.value).toBe(':bug');
		expect(preventDefault).toHaveBeenCalledOnce();
		expect(stopPropagation).toHaveBeenCalledOnce();
	});

	it.each([1001, 2000])('allows sending %i emoji and counts Unicode code points', count => {
		const draft = '😀'.repeat(count);
		const nodes = setDraft(draft);
		const send = find(nodes, node => node.props['aria-label'] === 'Send message');
		expect(send.props.disabled).toBe(false);
		if (count === 2000) expect(find(nodes, node => node.props.className === 'message-count').props.children).toBe('2000/2000');
		const form = find(nodes, node => node.props.className === 'chat-composer');
		(form.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault() {} });
		expect(onSend).toHaveBeenCalledWith(draft, undefined, expect.any(String));
	});

	it('rejects more than 2000 emoji even if submit is invoked directly', () => {
		const nodes = setDraft('😀'.repeat(2001));
		expect(find(nodes, node => node.props['aria-label'] === 'Send message').props.disabled).toBe(true);
		const form = find(nodes, node => node.props.className === 'chat-composer');
		(form.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault() {} });
		expect(onSend).not.toHaveBeenCalled();
	});

	it('preserves IME composition and Shift+Enter, submitting only a plain Enter', () => {
		const nodes = setDraft('😀'.repeat(1001));
		const textarea = find(nodes, node => node.type === 'textarea');
		const keydown = textarea.props.onKeyDown as (event: {
			key: string; shiftKey: boolean; keyCode: number; nativeEvent: { isComposing: boolean }; preventDefault: () => void;
		}) => void;
		const preventDefault = vi.fn();
		for (const overrides of [{ nativeEvent: { isComposing: true } }, { keyCode: 229 }, { shiftKey: true }]) {
			keydown({ key: 'Enter', shiftKey: false, keyCode: 13, nativeEvent: { isComposing: false }, preventDefault, ...overrides });
		}
		expect(onSend).not.toHaveBeenCalled();
		expect(preventDefault).not.toHaveBeenCalled();
		keydown({ key: 'Enter', shiftKey: false, keyCode: 13, nativeEvent: { isComposing: false }, preventDefault });
		expect(onSend).toHaveBeenCalledTimes(1);
		expect(preventDefault).toHaveBeenCalledOnce();
	});
});

describe('app chat acknowledgment session gate', () => {
	function render() {
		hooks.index = 0;
		const nodes = elements(WatchPartyApp());
		commit();
		return nodes.find(node => node.type === ChatPanel)?.props;
	}
	beforeEach(() => {
		vi.useFakeTimers();
		hooks.slots = [];
		hooks.effects = [];
		SocketStub.instances = [];
		const storage = memoryStorage();
		storage.setItem('watchparty-password:viewer', 'test-password');
		vi.stubGlobal('localStorage', storage);
		vi.stubGlobal('window', Object.assign(new EventTarget(), {
			location: { protocol: 'https:', host: 'room.test', pathname: '/' }, localStorage: storage,
			setTimeout, clearTimeout, setInterval, clearInterval,
		}));
		vi.stubGlobal('WebSocket', SocketStub);
	});
	afterEach(() => { unmount(); vi.unstubAllGlobals(); vi.useRealTimers(); });
	it('keeps the room and history mounted while reconnecting, then replaces expired history', () => {
		render();
		const first = SocketStub.instances[0];
		first.open();
		first.message(authenticated);
		first.message(history);
		expect(render()?.messages).toEqual([liveMessage]);
		first.disconnect();
		const offline = render();
		expect(offline).toBeDefined();
		expect(offline?.messages).toEqual([liveMessage]);
		expect(offline?.ready).toBe(false);
		expect((offline!.onSend as (text: string, gif: undefined, id: string) => boolean)('offline', undefined, 'offline-send')).toBe(false);
		vi.advanceTimersByTime(1000);
		const second = SocketStub.instances[1];
		second.open();
		second.message(authenticated);
		expect(render()?.ready).toBe(false);
		expect(render()?.messages).toEqual([liveMessage]);
		second.message({ type: 'chat_history', chat: { sessionId: 'new-session', messages: [] } });
		expect(render()?.messages).toEqual([]);
		expect(render()?.ready).toBe(true);
	});

	it('keeps the composer identity stable when the authoritative room session changes', () => {
		function composer() {
			hooks.index = 0;
			const node = elements(WatchPartyApp()).find(element => element.type === ChatPanel);
			commit();
			return node as (UiElement & { key: string | null }) | undefined;
		}
		composer();
		const socket = SocketStub.instances[0];
		socket.open();
		socket.message(authenticated);
		socket.message(history);
		const initial = composer();
		expect(initial).toBeDefined();
		socket.message({ type: 'chat_history', chat: { sessionId: 'replacement', messages: [] } });
		expect(composer()?.key).toBe(initial?.key);
	});

	it('gates results and sends on authenticated history and ignores results from the old socket', () => {
		render();
		const first = SocketStub.instances[0];
		first.open();
		const result: ServerMessage = { type: 'chat_result', requestId: 'own-send', accepted: true };
		first.message(result);
		first.message(authenticated);
		const pending = render()!;
		expect(pending.result).toBeNull();
		expect((pending.onSend as (text: string, gif: undefined, id: string) => boolean)('hi', undefined, 'own-send')).toBe(false);
		first.message(result);
		first.message(history);
		const ready = render()!;
		expect(ready.result).toBeNull();
		expect((ready.onSend as (text: string, gif: string, id: string) => boolean)('hi', CHAT_GIFS[0].id, 'own-send')).toBe(true);
		expect(first.sent.at(-1)).toEqual({ type: 'send_chat', text: 'hi', gifId: CHAT_GIFS[0].id, requestId: 'own-send' });
		first.message({ ...result, accepted: false, message: 'Invalid message' });
		expect(render()!.result).toEqual({ ...result, accepted: false, message: 'Invalid message' });
		expect(first.close).not.toHaveBeenCalled();
		first.disconnect();
		render();
		vi.advanceTimersByTime(1000);
		const second = SocketStub.instances[1];
		second.open();
		second.message(authenticated);
		second.message({ type: 'chat_history', chat: { sessionId: 'next', messages: [] } });
		expect(render()!.result).toBeNull();
		first.message(result);
		expect(render()!.result).toBeNull();
	});
});
