import { useEffect, useState } from 'react';
import type { ChatMessage } from '../../stream/chat';
import { createDefaultChatProfile } from '../../stream/chat-profile';
import { tokenizeChatEmotes } from '../../stream/chat-emotes';
import { getServerNowMs } from '../lib/serverClock';
import type { WatchPreferences } from '../lib/watchPreferences';
import { ChatGifAttachment } from './ChatGifAttachment';

const lifetimeMs = 15000;
const fadeMs = 3000;
const defaultNameColor = createDefaultChatProfile().nameColor;

export function ChatOverlay({ messages, opacity, side }: { messages: ChatMessage[]; opacity: number; side: WatchPreferences['overlaySide'] }) {
	const [, setTick] = useState(0);
	// Do not retain a clock value: reconnect may replace the local fallback with
	// a corrected server clock, including one behind the local wall clock.
	const nowMs = getServerNowMs();
	const textOpacity = Number.isFinite(opacity) ? Math.max(0, Math.min(100, opacity)) / 100 : 1;
	const recent = messages.slice().reverse()
		.filter(message => Number.isFinite(message.sentAtMs) && message.sentAtMs <= nowMs + 1000 && nowMs - message.sentAtMs < lifetimeMs)
		.sort((first, second) => second.sentAtMs - first.sentAtMs);
	const active = textOpacity > 0 && recent.length > 0;

	useEffect(() => {
		if (!active) return;
		const timer = setInterval(() => setTick(tick => tick + 1), 250);
		return () => clearInterval(timer);
	}, [active]);

	if (!active) return null;
	return <div className="chat-overlay" data-side={side} aria-hidden={true} inert={true}>
		{recent.map(message => {
			const ageMs = Math.max(0, nowMs - message.sentAtMs);
			const fade = Math.min(1, (lifetimeMs - ageMs) / fadeMs);
			return <div className="chat-overlay-message" key={`${message.sessionId}:${message.id}`} style={{ opacity: textOpacity * fade }}>
				<p><strong style={{ color: `#${message.profile?.nameColor ?? defaultNameColor}` }}>{message.name}: </strong>
					{tokenizeChatEmotes(message.text).map((token, index) => token.type === 'text' ? token.text : <img key={index} className="chat-emote" src={token.emote.url} alt={`:${token.emote.id}:`} width={32} height={32} />)}
				</p>
				{message.gifId && <ChatGifAttachment id={message.gifId} />}
			</div>;
		})}
	</div>;
}
