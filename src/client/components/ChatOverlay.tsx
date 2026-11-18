import { useLayoutEffect, useRef, useState } from 'react';
import { Maximize2, Move } from 'lucide-react';
import { MAX_CHAT_MESSAGES, type ChatMessage } from '../../stream/chat';
import { createDefaultChatProfile } from '../../stream/chat-profile';
import { tokenizeChatEmotes } from '../../stream/chat-emotes';
import type { WatchPreferences } from '../lib/watchPreferences';
import type { OverlayLayout } from '../lib/overlayLayout';
import { useOverlayEditor } from '../hooks/useOverlayEditor';
import { ChatGifAttachment } from './ChatGifAttachment';

const defaultNameColor = createDefaultChatProfile().nameColor;

function messageKey(message: ChatMessage): string {
	return `${message.sessionId}:${message.id}`;
}

export function ChatOverlay({ messages, opacity, side, backgroundColor = '#000000', backgroundOpacity = 50, layout = null, editing = false, onLayoutChange, onFinishEditing }: {
	messages: ChatMessage[];
	opacity: number;
	side: WatchPreferences['overlaySide'];
	backgroundColor?: string;
	backgroundOpacity?: number;
	layout?: OverlayLayout | null;
	editing?: boolean;
	onLayoutChange?: (layout: OverlayLayout | null) => void;
	onFinishEditing?: () => void;
}) {
	const [poppedKeys, setPoppedKeys] = useState<ReadonlySet<string>>(() => new Set());
	const frameRef = useRef<HTMLDivElement>(null);
	const textOpacity = Number.isFinite(opacity) ? Math.max(0, Math.min(100, opacity)) / 100 : 1;
	const backdropColor = /^#[0-9a-f]{6}$/i.test(backgroundColor) ? backgroundColor : '#000000';
	const backdropOpacity = Number.isFinite(backgroundOpacity) ? Math.max(0, Math.min(100, backgroundOpacity)) / 100 : 0.5;
	const bufferedMessages = messages.slice(-MAX_CHAT_MESSAGES);
	const sourceKeys = new Set(bufferedMessages.map(messageKey));
	// Source history preserves arrival order even after a server clock correction.
	const visibleMessages = bufferedMessages
		.filter(message => !poppedKeys.has(messageKey(message)) && Number.isFinite(message.sentAtMs));
	const active = visibleMessages.length > 0 && (textOpacity > 0 || backdropOpacity > 0);
	const mounted = active || editing;
	const visibleKeys = visibleMessages.map(messageKey).join('\n');
	const editor = useOverlayEditor({ frameRef, mounted, editing, layout, side, onLayoutChange, onFinishEditing });

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
		if (!mounted || !frame) return;
		let pendingFrame: number | null = null;
		const rows = Array.from(frame.querySelectorAll<HTMLElement>(':scope > .chat-overlay-message'));
		const measure = () => {
			// A saved layout must render its viewport-clamped size before discarding rows.
			if (!editor.geometryIsCurrent() || frame.clientHeight <= 0) return;
			const frameHeight = frame.getBoundingClientRect().height;
			const style = getComputedStyle(frame);
			const padding = (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0);
			const available = frameHeight - padding;
			if (available <= 0) return;
			const gap = Number.parseFloat(style.rowGap) || 0;
			// Preview-hidden messages are measured again so expanding can restore them.
			for (const row of rows) row.toggleAttribute('data-preview-hidden', false);
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
			frame.style.setProperty('--chat-overlay-background-height', `${rows.length ? Math.min(frameHeight, occupied + padding) : 0}px`);
			for (const [index, row] of rows.entries()) {
				const body = row.querySelector<HTMLElement>('.chat-overlay-message-body');
				row.toggleAttribute('data-clipped', Boolean(body && body.offsetHeight > row.clientHeight + 1));
				row.toggleAttribute('data-preview-hidden', editing && index < firstRetained);
			}
			if (removed.length && !editing) {
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
	}, [mounted, visibleKeys, messages, editing, editor.geometryKey]);

	if (!mounted) return null;
	const overlay = <div ref={frameRef} className="chat-overlay" data-side={side} data-editing={editing || undefined} data-dragging={editor.dragging} style={editor.style} aria-hidden={editing ? undefined : true} inert={!editing} role={editing ? 'group' : undefined} aria-label={editing ? 'Chat overlay editor' : undefined}
		onPointerDown={event => { if (!(event.target instanceof Element) || !event.target.closest('button')) editor.begin(event, 'move'); }}
		onPointerMove={editor.update} onPointerUp={editor.commit} onPointerCancel={editor.cancel} onLostPointerCapture={editor.cancel}>
		<div className="chat-overlay-background" aria-hidden={true} style={{ backgroundColor: backdropColor, opacity: backdropOpacity }} />
		{visibleMessages.map(message => {
			return <div className="chat-overlay-message" key={messageKey(message)} data-message-key={messageKey(message)} style={{ opacity: textOpacity }} aria-hidden={true} inert={true}>
				<div className="chat-overlay-message-body">
					<p><strong style={{ color: `#${message.profile?.nameColor ?? defaultNameColor}` }}>{message.name}: </strong>
						{tokenizeChatEmotes(message.text).map((token, index) => token.type === 'text' ? token.text : <img key={index} className="chat-emote" src={token.emote.url} alt={`:${token.emote.id}:`} width={32} height={32} />)}
					</p>
					{message.gifId && <ChatGifAttachment id={message.gifId} />}
				</div>
			</div>;
		})}
		{editing && <>
			<div className="chat-overlay-editor-tools" role="group" aria-label="Overlay layout controls">
				<button ref={editor.moveRef} type="button" aria-label="Move chat overlay" aria-describedby="chat-overlay-edit-help" onPointerDown={event => editor.begin(event, 'move')} onKeyDown={event => editor.keyboard(event, 'move')}><Move size={14} aria-hidden="true" />Move</button>
				<button type="button" aria-label="Reset overlay layout" onClick={editor.reset}>Reset</button>
				<button type="button" aria-label="Finish editing overlay" onClick={editor.finish}>Done</button>
			</div>
			<p id="chat-overlay-edit-help" className="chat-overlay-edit-help">Drag to move or resize the available message area. Arrow keys adjust one pixel; hold Shift for ten pixels. Escape finishes editing.</p>
			<button type="button" className="chat-overlay-resize" aria-label="Resize chat overlay" aria-describedby="chat-overlay-edit-help" onPointerDown={event => editor.begin(event, 'resize')} onKeyDown={event => editor.keyboard(event, 'resize')}><Maximize2 size={18} aria-hidden="true" /></button>
		</>}
	</div>;
	return editing ? <><div className="chat-overlay-edit-shield" aria-hidden={true} onPointerDown={event => event.preventDefault()} />{overlay}</> : overlay;
}
