import { useCallback, useRef, useState } from 'react';
import type { ChatSnapshot } from '../../stream/chat';
import type { ServerMessage } from '../../stream/messages';
import { appendChatMessage, clearChatCache, getChatStorage, readPreferredName, replaceChatSnapshot, writeChatCache, writePreferredName } from '../lib/chatStorage';

export function useRoomChat() {
	const [name, setName] = useState(() => readPreferredName(getChatStorage()));
	const [snapshot, setSnapshot] = useState<ChatSnapshot | null>(null);
	const snapshotRef = useRef<ChatSnapshot | null>(null);
	const authenticatedRef = useRef(false);

	const clear = useCallback(() => {
		authenticatedRef.current = false;
		snapshotRef.current = null;
		setSnapshot(null);
		clearChatCache(getChatStorage());
	}, []);

	const onMessage = useCallback((message: ServerMessage) => {
		if (message.type === 'authenticated') {
			authenticatedRef.current = true;
			return;
		}
		if (!authenticatedRef.current) return;
		if (message.type === 'name_updated') {
			setName(message.name);
			writePreferredName(getChatStorage(), message.name);
			return;
		}
		let next = snapshotRef.current;
		if (message.type === 'chat_history') next = replaceChatSnapshot(null, message.chat);
		else if (message.type === 'chat_message') next = appendChatMessage(next, message.message);
		else return;
		if (next === snapshotRef.current) return;
		snapshotRef.current = next;
		setSnapshot(next);
		if (next) writeChatCache(getChatStorage(), next);
		else clearChatCache(getChatStorage());
	}, []);

	return { name, messages: snapshot?.messages ?? [], sessionId: snapshot?.sessionId ?? null, ready: snapshot !== null, clear, onMessage };
}
