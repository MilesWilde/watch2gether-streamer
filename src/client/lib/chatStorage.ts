import { MAX_CHAT_MESSAGES, MAX_CHAT_MESSAGE_LENGTH, MAX_CHAT_NAME_LENGTH, type ChatMessage, type ChatSnapshot } from '../../stream/chat';
import { getChatGif } from '../../stream/chat-media';

type ChatStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
const cacheKey = 'watchparty-chat:global';
const nameKey = 'watchparty-display-name:global';
const maxMessages = MAX_CHAT_MESSAGES;

export function getChatStorage(): ChatStorage {
	try { return window.localStorage; } catch { return null; }
}

export function isChatMessage(value: unknown): value is ChatMessage {
	if (!value || typeof value !== 'object') return false;
	const item = value as Record<string, unknown>;
	return typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 200 &&
		typeof item.sessionId === 'string' && item.sessionId.length > 0 && item.sessionId.length <= 200 &&
		typeof item.name === 'string' && item.name.trim().length > 0 && Array.from(item.name).length <= MAX_CHAT_NAME_LENGTH &&
		typeof item.text === 'string' && Array.from(item.text).length <= MAX_CHAT_MESSAGE_LENGTH &&
		(item.gifId === undefined || getChatGif(item.gifId) !== undefined) &&
		(Boolean(item.text.trim()) || typeof item.gifId === 'string') &&
		typeof item.sentAtMs === 'number' && Number.isFinite(item.sentAtMs) && item.sentAtMs >= 0 && item.sentAtMs <= 8_640_000_000_000_000;
}

export function isChatSnapshot(value: unknown): value is ChatSnapshot {
	if (!value || typeof value !== 'object') return false;
	const snapshot = value as Record<string, unknown>;
	return typeof snapshot.sessionId === 'string' && snapshot.sessionId.length > 0 && snapshot.sessionId.length <= 200 &&
		Array.isArray(snapshot.messages) && snapshot.messages.every(item => isChatMessage(item) && item.sessionId === snapshot.sessionId);
}

export function replaceChatSnapshot(_previous: ChatSnapshot | null, authoritative: ChatSnapshot): ChatSnapshot | null {
	if (!isChatSnapshot(authoritative)) return null;
	const seen = new Set<string>();
	return {
		sessionId: authoritative.sessionId,
		messages: authoritative.messages.filter(item => {
			if (seen.has(item.id)) return false;
			seen.add(item.id);
			return true;
		}).slice(-maxMessages),
	};
}

export function appendChatMessage(snapshot: ChatSnapshot | null, message: ChatMessage): ChatSnapshot | null {
	if (!snapshot || !isChatMessage(message) || message.sessionId !== snapshot.sessionId || snapshot.messages.some(item => item.id === message.id)) return snapshot;
	return { sessionId: snapshot.sessionId, messages: [...snapshot.messages, message].slice(-maxMessages) };
}

export function readChatCache(storage: ChatStorage): ChatSnapshot | null {
	try {
		const raw = storage?.getItem(cacheKey);
		if (!raw) return null;
		// Reject oversized envelopes before parsing untrusted local storage.
		if (raw.length > 5_000_000) { clearChatCache(storage); return null; }
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object' || !('version' in parsed) || parsed.version !== 1 || !isChatSnapshot(parsed) || parsed.messages.length > maxMessages) {
			clearChatCache(storage);
			return null;
		}
		return replaceChatSnapshot(null, parsed);
	} catch { clearChatCache(storage); return null; }
}

export function writeChatCache(storage: ChatStorage, snapshot: ChatSnapshot): void {
	const bounded = replaceChatSnapshot(null, snapshot);
	if (!bounded) { clearChatCache(storage); return; }
	try { storage?.setItem(cacheKey, JSON.stringify({ version: 1, ...bounded })); } catch { /* Storage is optional. */ }
}

export function clearChatCache(storage: ChatStorage): void {
	try { storage?.removeItem(cacheKey); } catch { /* Storage is optional. */ }
}

export function readPreferredName(storage: ChatStorage): string {
	try {
		const name = storage?.getItem(nameKey) ?? '';
		return name.trim() && Array.from(name).length <= MAX_CHAT_NAME_LENGTH ? name : '';
	} catch { return ''; }
}

export function writePreferredName(storage: ChatStorage, name: string): void {
	if (!name.trim() || Array.from(name).length > MAX_CHAT_NAME_LENGTH) return;
	try { storage?.setItem(nameKey, name); } catch { /* Storage is optional. */ }
}
