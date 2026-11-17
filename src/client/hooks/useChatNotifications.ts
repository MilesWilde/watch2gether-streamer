import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../../stream/chat';
import type { ServerMessage } from '../../stream/messages';

const TITLE = 'Watch Party';
const MAX_SEEN_IDS = 1000;
const MAX_SELF_IDS = 100;

function isAway(): boolean {
	if (typeof document === 'undefined') return false;
	return document.visibilityState === 'hidden' || document.hasFocus?.() === false;
}

function remember(ids: Set<string>, id: string, limit: number): void {
	ids.add(id);
	if (ids.size > limit) ids.delete(ids.values().next().value!);
}

export function useChatNotifications(active: boolean) {
	const current = useRef({
		active, enabled: true, unread: 0, sessionId: null as string | null,
		seen: new Set<string>(), selfIds: new Set<string>(), latestSelfId: null as string | null,
	});
	const [state, setState] = useState({ enabled: true, unread: 0 });

	const publish = useCallback(() => {
		const { enabled, unread } = current.current;
		setState({ enabled, unread });
		if (typeof document !== 'undefined') document.title = unread ? `(${unread}) ${TITLE}` : TITLE;
	}, []);

	const clear = useCallback(() => {
		const value = current.current;
		value.active = false;
		value.unread = 0;
		value.sessionId = null;
		value.seen.clear();
		value.selfIds.clear();
		value.latestSelfId = null;
		publish();
	}, [publish]);

	const reset = useCallback(() => {
		clear();
		current.current.active = true;
		current.current.enabled = true;
		publish();
	}, [clear, publish]);

	const toggle = useCallback(() => {
		current.current.enabled = !current.current.enabled;
		current.current.unread = 0;
		publish();
	}, [publish]);

	const onMessage = useCallback((message: ServerMessage) => {
		const value = current.current;
		if (!value.active) return;
		if (message.type === 'authenticated') {
			if ('senderId' in message && typeof message.senderId === 'string') {
				value.latestSelfId = message.senderId;
				remember(value.selfIds, message.senderId, MAX_SELF_IDS);
			}
			return;
		}
		const receive = (chat: ChatMessage, notify: boolean) => {
			if (chat.sessionId !== value.sessionId || value.seen.has(chat.id)) return;
			remember(value.seen, chat.id, MAX_SEEN_IDS);
			if (notify && value.enabled && isAway() && !(chat.senderId && value.selfIds.has(chat.senderId))) value.unread++;
		};
		if (message.type === 'chat_history') {
			const sameSession = value.sessionId === message.chat.sessionId;
			if (!sameSession) {
				value.sessionId = message.chat.sessionId;
				value.unread = 0;
				value.seen.clear();
				value.selfIds.clear();
				if (value.latestSelfId) remember(value.selfIds, value.latestSelfId, MAX_SELF_IDS);
			}
			for (const chat of message.chat.messages) receive(chat, sameSession);
		} else if (message.type === 'chat_message') receive(message.message, true);
		else return;
		if (!isAway()) value.unread = 0;
		publish();
	}, [publish]);

	useEffect(() => {
		current.current.active = active;
		if (!active) clear();
	}, [active, clear]);

	useEffect(() => {
		const doc = typeof document === 'undefined' ? undefined : document;
		const win = typeof window === 'undefined' ? undefined : window;
		const onAttention = () => {
			if (!isAway()) {
				current.current.unread = 0;
				publish();
			}
		};
		doc?.addEventListener?.('visibilitychange', onAttention);
		win?.addEventListener?.('focus', onAttention);
		win?.addEventListener?.('blur', onAttention);
		return () => {
			doc?.removeEventListener?.('visibilitychange', onAttention);
			win?.removeEventListener?.('focus', onAttention);
			win?.removeEventListener?.('blur', onAttention);
			if (doc) doc.title = TITLE;
		};
	}, [publish]);

	return { ...state, onMessage, toggle, reset, clear };
}
