import { describe, expect, it } from 'vitest';
import { appendChatMessage, clearChatCache, isChatMessage, readChatCache, readPreferredName, replaceChatSnapshot, writeChatCache, writePreferredName } from '../src/client/lib/chatStorage';
import { createDefaultChatProfile } from '../src/stream/chat-profile';

function storage() {
	const values = new Map<string, string>();
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => { values.set(key, value); },
		removeItem: (key: string) => { values.delete(key); },
	};
}
const message = (id = '1', sessionId = 'live') => ({ id, sessionId, name: 'Alex', text: 'Hello', sentAtMs: 123 });

describe('room chat cache', () => {
	it('projects profile extras out of live ingestion, cache reads and cache writes', () => {
		const safe = { ...message(), profile: createDefaultChatProfile() };
		const extra = { ...safe, debugUrl: 'https://evil.test', profile: { ...safe.profile, svg: '<svg/>', avatarUrl: 'https://evil.test' } };
		expect(appendChatMessage({ sessionId: 'live', messages: [] }, extra)?.messages).toEqual([safe]);
		const store = storage();
		store.setItem('watchparty-chat:global', JSON.stringify({ version: 1, sessionId: 'live', messages: [extra] }));
		expect(readChatCache(store)?.messages).toEqual([safe]);
		writeChatCache(store, { sessionId: 'live', messages: [extra] });
		const raw = store.getItem('watchparty-chat:global')!;
		expect(raw).not.toContain('svg');
		expect(raw).not.toContain('evil.test');
	});
	it('accepts validated robot profiles and legacy messages, but rejects unsafe profile fields', () => {
		const profile = createDefaultChatProfile();
		const item = { ...message(), profile };
		const store = storage();
		expect(isChatMessage(item)).toBe(true);
		writeChatCache(store, { sessionId: 'live', messages: [item] });
		expect(readChatCache(store)?.messages).toEqual([item]);
		for (const invalid of [null, {}, { ...profile, eyes: '<svg/>' }, { ...profile, nameColor: 'url(evil)' }]) {
			expect(isChatMessage({ ...message(), profile: invalid })).toBe(false);
		}
		expect(isChatMessage(message())).toBe(true);
	});
	it('preserves optional bounded sender IDs and legacy messages', () => {
		for (const senderId of [undefined, 'a', 's'.repeat(200)]) {
			const item = { ...message(), ...(senderId === undefined ? {} : { senderId }) };
			expect(isChatMessage(item)).toBe(true);
			const snapshot = { sessionId: 'live', messages: [item] };
			const store = storage();
			writeChatCache(store, snapshot);
			expect(readChatCache(store)).toEqual(snapshot);
		}
	});
	it('rejects malformed sender IDs in live messages and clears their caches', () => {
		for (const senderId of ['', '   ', 's'.repeat(201), null, 12, {}]) {
			const item = { ...message(), senderId };
			expect(isChatMessage(item)).toBe(false);
			const store = storage();
			store.setItem('watchparty-chat:global', JSON.stringify({ version: 1, sessionId: 'live', messages: [item] }));
			expect(readChatCache(store)).toBeNull();
			expect(store.getItem('watchparty-chat:global')).toBeNull();
		}
	});
	it('round trips GIF-only live provider identifiers without URLs', () => {
		const item = { ...message(), senderId: 'server-sender', text: '', gifId: 'giphy:Ab0123' };
		const snapshot = { sessionId: 'live', messages: [item] };
		expect(appendChatMessage({ sessionId: 'live', messages: [] }, item)).toEqual(snapshot);
		const store = storage();
		writeChatCache(store, snapshot);
		expect(readChatCache(store)).toEqual(snapshot);
	});
	it('rejects malformed live provider IDs in runtime and cached messages', () => {
		for (const gifId of ['giphy:', `giphy:${'a'.repeat(65)}`, 'giphy:a_b', 'giphy:a/b', 'giphy:a\n', 'https://media.giphy.com/a.gif']) {
			const item = { ...message(), gifId };
			expect(isChatMessage(item)).toBe(false);
			const store = storage();
			store.setItem('watchparty-chat:global', JSON.stringify({ version: 1, sessionId: 'live', messages: [item] }));
			expect(readChatCache(store)).toBeNull();
		}
	});
	it('round trips a bounded room and session snapshot', () => {
		const store = storage();
		writeChatCache(store, { sessionId: 'live', messages: Array.from({ length: 510 }, (_, i) => message(String(i))) });
		const snapshot = readChatCache(store);
		expect(snapshot?.messages).toHaveLength(500);
		expect(snapshot?.messages[0].id).toBe('10');
	});
	it('reconciles same-session history by ID with authoritative values and order', () => {
		const cache = { sessionId: 'live', messages: [message('stale')] };
		expect(replaceChatSnapshot(cache, { sessionId: 'live', messages: [message('new')] })).toEqual({ sessionId: 'live', messages: [message('stale'), message('new')] });
		const edited = { ...message('stale'), text: 'Server correction' };
		expect(replaceChatSnapshot(cache, { sessionId: 'live', messages: [message('new'), edited, edited] })?.messages).toEqual([message('new'), edited]);
	});
	it('accepts a new session without retaining old messages', () => {
		expect(replaceChatSnapshot({ sessionId: 'old', messages: [message('old', 'old')] }, { sessionId: 'new', messages: [] })).toEqual({ sessionId: 'new', messages: [] });
	});
	it('bounds reconciled history without dropping authoritative messages', () => {
		const cache = { sessionId: 'live', messages: Array.from({ length: 500 }, (_, i) => message(String(i))) };
		const result = replaceChatSnapshot(cache, { sessionId: 'live', messages: [message('next'), message('next')] });
		expect(result?.messages).toHaveLength(500);
		expect(result?.messages[0].id).toBe('1');
		expect(result?.messages.at(-1)?.id).toBe('next');
	});
	it('ignores live messages until a confirmed snapshot exists', () => {
		expect(appendChatMessage(null, message())).toBeNull();
	});
	it('ignores duplicate and out of session live messages', () => {
		const snapshot = { sessionId: 'live', messages: [message()] };
		expect(appendChatMessage(snapshot, message())).toBe(snapshot);
		expect(appendChatMessage(snapshot, message('2', 'other'))).toBe(snapshot);
	});
	it('removes malformed caches and rejects invalid message fields', () => {
		const store = storage();
		for (const raw of ['{', JSON.stringify({ version: 1, sessionId: 'live', messages: [{ ...message(), sentAtMs: 'yesterday' }] }), JSON.stringify({ version: 1, sessionId: 'live', messages: [{ ...message(), text: 'x'.repeat(2001) }] })]) {
			store.setItem('watchparty-chat:global', raw);
			expect(readChatCache(store)).toBeNull();
			expect(store.getItem('watchparty-chat:global')).toBeNull();
		}
	});
	it('rejects cache messages from a different session', () => {
		const store = storage();
		store.setItem('watchparty-chat:global', JSON.stringify({ version: 1, sessionId: 'live', messages: [message('1', 'old')] }));
		expect(readChatCache(store)).toBeNull();
	});
	it('deduplicates snapshot messages while preserving server order', () => {
		expect(replaceChatSnapshot(null, { sessionId: 'live', messages: [message('2'), message('1'), message('2')] })?.messages.map(item => item.id)).toEqual(['2', '1']);
	});
	it('clears history while retaining an emoji preferred name', () => {
		const store = storage();
		writePreferredName(store, 'Alex 🌻');
		writeChatCache(store, { sessionId: 'live', messages: [message()] });
		clearChatCache(store);
		expect(readChatCache(store)).toBeNull();
		expect(readPreferredName(store)).toBe('Alex 🌻');
	});
	it('handles unavailable or throwing storage without breaking chat', () => {
		const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('quota'); }, removeItem() { throw Error('blocked'); } };
		expect(readChatCache(blocked)).toBeNull();
		expect(readPreferredName(blocked)).toBe('');
		expect(() => { writeChatCache(blocked, { sessionId: 'live', messages: [] }); clearChatCache(blocked); writePreferredName(blocked, 'Alex'); }).not.toThrow();
		expect(readChatCache(null)).toBeNull();
	});
	it('rejects unrenderable timestamps and GIFs outside the shared catalog', () => {
		const store = storage();
		for (const invalid of [{ ...message(), sentAtMs: 1e20 }, { ...message(), gifId: 'arbitrary-url' }]) {
			store.setItem('watchparty-chat:global', JSON.stringify({ version: 1, sessionId: 'live', messages: [invalid] }));
			expect(readChatCache(store)).toBeNull();
		}
	});
	it.each([1001, 2000])('accepts a snapshot containing %i emoji code points', count => {
		const store = storage();
		const snapshot = { sessionId: 'live', messages: [{ ...message(), text: '😀'.repeat(count) }] };
		expect(replaceChatSnapshot(null, snapshot)).toEqual(snapshot);
		writeChatCache(store, snapshot);
		expect(readChatCache(store)).toEqual(snapshot);
	});
	it('rejects snapshots with more than 2000 emoji code points', () => {
		const snapshot = { sessionId: 'live', messages: [{ ...message(), text: '😀'.repeat(2001) }] };
		expect(replaceChatSnapshot(null, snapshot)).toBeNull();
		const store = storage();
		store.setItem('watchparty-chat:global', JSON.stringify({ version: 1, ...snapshot }));
		expect(readChatCache(store)).toBeNull();
	});
});
