import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isAuthenticationError, parseServerMessage, useWatchPartySocket } from '../src/client/hooks/useWatchPartySocket';
import { useRoomChat } from '../src/client/hooks/useRoomChat';
import { ChatPanel } from '../src/client/components/ChatPanel';
import { WatchPartyApp } from '../src/client/WatchPartyApp';
import { ChatPicker } from '../src/client/components/ChatPicker';
import { CHAT_GIFS } from '../src/stream/chat-media';
import { readChatCache, writeChatCache, writePreferredName } from '../src/client/lib/chatStorage';
import type { ServerMessage } from '../src/stream/messages';

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
	close = vi.fn(() => { this.readyState = 3; });
	constructor(readonly url: string) {
		super();
		SocketStub.instances.push(this);
	}
	send(raw: string) { this.sent.push(JSON.parse(raw)); }
	open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
	message(value: ServerMessage) {
		this.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify(value) }));
	}
	disconnect() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
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

describe('chat socket protocol', () => {
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
	const onFailed = vi.fn();

	function render() {
		hooks.index = 0;
		const chat = useRoomChat();
		const socket = useWatchPartySocket({
			authMode: 'viewer', password: 'test-password', enabled, preferredName: chat.name,
			onMessage: chat.onMessage, onAuthenticationLost: chat.clear, onAuthenticationFailed: onFailed,
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

	it('retries network loss before the first authentication response', () => {
		render();
		SocketStub.instances[0].dispatchEvent(new Event('error'));
		vi.advanceTimersByTime(1000);
		expect(SocketStub.instances).toHaveLength(2);
		SocketStub.instances[1].open();
		SocketStub.instances[1].message(authenticated);
		expect(render().socket.authenticated).toBe(true);
	});

	it('Leave closes immediately, clears the cache, preserves the name and ignores late events', () => {
		const first = join();
		first.message({ type: 'name_updated', name: 'Alex 🌻' });
		const joined = render();
		joined.socket.leave();
		expect(first.close).toHaveBeenCalled();
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

	it('pagehide closes and clears, while bfcache pageshow recovers behind the snapshot gate', () => {
		const first = join();
		page.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }));
		expect(first.close).toHaveBeenCalled();
		expect(readChatCache(storage)).toBeNull();
		expect(render().chat.messages).toEqual([]);
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
		second.message(history);
		expect(render().chat.messages).toEqual([liveMessage]);
		page.dispatchEvent(new Event('pageshow'));
		expect(SocketStub.instances).toHaveLength(2);
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
		expect(first.sent[0]).toEqual({ type: 'authenticate', mode: 'viewer', password: 'test-password', name: 'Alex 🌻' });
		first.message({ type: 'name_updated', name: 'Alex' });
		render();
		expect(SocketStub.instances).toHaveLength(1);
		first.disconnect();
		render();
		vi.advanceTimersByTime(1000);
		SocketStub.instances[1].open();
		expect(SocketStub.instances[1].sent[0]).toEqual({ type: 'authenticate', mode: 'viewer', password: 'test-password', name: 'Alex' });
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

describe('chat composer Unicode and IME input', () => {
	const onSend = vi.fn((_text: string, _gifId: string | undefined, _requestId: string) => true);
	let result: Extract<ServerMessage, { type: 'chat_result' }> | null;
	let error: string | null;
	let composerDom: { disabled: boolean; focus: () => void } | null;
	let messages: typeof liveMessage[];
	let logDom: { scrollTop: number; scrollHeight: number; clientHeight: number } | null;
	function render() {
		hooks.index = 0;
		const nodes = elements(ChatPanel({ messages, name: 'Alex', ready: true, error, result, onSend, onNameChange: () => true }));
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
		composerDom = null;
		messages = [];
		logDom = null;
	});
	afterEach(() => { unmount(); vi.useRealTimers(); });

	function submitWithGif() {
		setDraft('keep draft');
		const trigger = find(render(), node => node.props['aria-label'] === 'Emoji and GIFs');
		(trigger.props.onClick as () => void)();
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
