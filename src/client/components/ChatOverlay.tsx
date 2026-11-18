import { useLayoutEffect, useRef, useState } from 'react';
import { MAX_CHAT_MESSAGES, type ChatMessage } from '../../stream/chat';
import { createDefaultChatProfile } from '../../stream/chat-profile';
import { tokenizeChatEmotes } from '../../stream/chat-emotes';
import type { WatchPreferences } from '../lib/watchPreferences';
import { ChatGifAttachment } from './ChatGifAttachment';

const defaultNameColor = createDefaultChatProfile().nameColor;

function messageKey(message: ChatMessage): string {
	return `${message.sessionId}:${message.id}`;
}

export function ChatOverlay({ messages, opacity, side }: { messages: ChatMessage[]; opacity: number; side: WatchPreferences['overlaySide'] }) {
	const [poppedKeys, setPoppedKeys] = useState<ReadonlySet<string>>(() => new Set());
	const frameRef = useRef<HTMLDivElement>(null);
	const textOpacity = Number.isFinite(opacity) ? Math.max(0, Math.min(100, opacity)) / 100 : 1;
	const bufferedMessages = messages.slice(-MAX_CHAT_MESSAGES);
	const sourceKeys = new Set(bufferedMessages.map(messageKey));
	// Source history preserves arrival order even after a server clock correction.
	const visibleMessages = bufferedMessages
		.filter(message => !poppedKeys.has(messageKey(message)) && Number.isFinite(message.sentAtMs));
	const active = textOpacity > 0 && visibleMessages.length > 0;
	const visibleKeys = visibleMessages.map(messageKey).join('\n');

	useLayoutEffect(() => {
		// Discards stay remembered for this source history, including while hidden.
		// Pruning with the bounded source buffer also removes obsolete room sessions.
		setPoppedKeys(previous => {
			const retained = new Set([...previous].filter(key => sourceKeys.has(key)));
			return retained.size === previous.size ? previous : retained;
		});
	}, [messages]);

	useLayoutEffect(() => {
		const frame = frameRef.current;
		if (!active || !frame) return;
		let pendingFrame: number | null = null;
		const rows = Array.from(frame.querySelectorAll<HTMLElement>(':scope > .chat-overlay-message'));
		const measure = () => {
			if (frame.clientHeight <= 0) return;
			const available = frame.getBoundingClientRect().height;
			if (available <= 0) return;
			const gap = Number.parseFloat(getComputedStyle(frame).rowGap) || 0;
			// Rows do not animate their geometry; retain fractional layout heights.
			const heights = rows.map(row => row.getBoundingClientRect().height);
			let occupied = heights.reduce((sum, height) => sum + height, 0) + Math.max(0, rows.length - 1) * gap;
			let firstRetained = 0;
			const removed: string[] = [];
			while (rows.length - firstRetained > 1 && occupied > available) {
				occupied -= heights[firstRetained] + gap;
				const key = rows[firstRetained].dataset.messageKey;
				if (key) removed.push(key);
				firstRetained++;
			}
			for (const row of rows) {
				const body = row.querySelector<HTMLElement>('.chat-overlay-message-body');
				row.toggleAttribute('data-clipped', Boolean(body && body.offsetHeight > row.clientHeight + 1));
			}
			if (removed.length) {
				setPoppedKeys(previous => {
					const next = new Set([...previous].filter(key => sourceKeys.has(key)));
					for (const key of removed) if (sourceKeys.has(key)) next.add(key);
					return next.size === previous.size && [...next].every(key => previous.has(key)) ? previous : next;
				});
			}
		};
		const schedule = () => {
			if (pendingFrame !== null) return;
			pendingFrame = window.requestAnimationFrame(() => {
				pendingFrame = null;
				measure();
			});
		};
		const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
		observer?.observe(frame);
		for (const row of rows) {
			observer?.observe(row);
			const body = row.querySelector<HTMLElement>('.chat-overlay-message-body');
			if (body) observer?.observe(body);
		}
		measure();
		return () => {
			observer?.disconnect();
			if (pendingFrame !== null) window.cancelAnimationFrame(pendingFrame);
		};
	}, [active, visibleKeys, messages]);

	if (!active) return null;
	return <div ref={frameRef} className="chat-overlay" data-side={side} aria-hidden={true} inert={true}>
		{visibleMessages.map(message => {
			return <div className="chat-overlay-message" key={messageKey(message)} data-message-key={messageKey(message)} style={{ opacity: textOpacity }}>
				<div className="chat-overlay-message-body">
					<p><strong style={{ color: `#${message.profile?.nameColor ?? defaultNameColor}` }}>{message.name}: </strong>
						{tokenizeChatEmotes(message.text).map((token, index) => token.type === 'text' ? token.text : <img key={index} className="chat-emote" src={token.emote.url} alt={`:${token.emote.id}:`} width={32} height={32} />)}
					</p>
					{message.gifId && <ChatGifAttachment id={message.gifId} />}
				</div>
			</div>;
		})}
	</div>;
}
