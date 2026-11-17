import { useCallback, useRef, useState } from 'react';
import type { ChatSnapshot } from '../../stream/chat';
import type { ServerMessage } from '../../stream/messages';
import { appendChatMessage, clearChatCache, getChatStorage, readPreferredName, replaceChatSnapshot, writeChatCache, writePreferredName } from '../lib/chatStorage';
import { readPreferredProfile, writePreferredProfile } from '../lib/profileStorage';
import { parseChatProfile } from '../../stream/chat-profile';

export function useRoomChat() {
	const [name, setName] = useState(() => readPreferredName(getChatStorage()));
	const [profile, setProfile] = useState(() => readPreferredProfile(getChatStorage()));
	const [snapshot, setSnapshot] = useState<ChatSnapshot | null>(null);
	const [ready, setReady] = useState(false);
	const snapshotRef = useRef<ChatSnapshot | null>(null);
	const authenticatedRef = useRef(false);
	const readyRef = useRef(false);

	const suspend = useCallback(() => {
		authenticatedRef.current = false;
		readyRef.current = false;
		setReady(false);
	}, []);

	const clear = useCallback(() => {
		authenticatedRef.current = false;
		readyRef.current = false;
		setReady(false);
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
			if (message.profile !== undefined) {
				const nextProfile = parseChatProfile(message.profile);
				if (!nextProfile) return;
				setProfile(nextProfile);
				writePreferredProfile(getChatStorage(), nextProfile);
			}
			setName(message.name);
			writePreferredName(getChatStorage(), message.name);
			return;
		}
		let next = snapshotRef.current;
		if (message.type === 'chat_history') {
			next = replaceChatSnapshot(next, message.chat);
			readyRef.current = true;
			setReady(true);
		} else if (message.type === 'chat_message' && readyRef.current) next = appendChatMessage(next, message.message);
		else return;
		if (next === snapshotRef.current) return;
		snapshotRef.current = next;
		setSnapshot(next);
		if (next) writeChatCache(getChatStorage(), next);
		else clearChatCache(getChatStorage());
	}, []);

	return { name, profile, messages: snapshot?.messages ?? [], sessionId: snapshot?.sessionId ?? null, ready, suspend, clear, onMessage };
}
