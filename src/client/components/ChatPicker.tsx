import { useEffect, useRef, useState, type RefObject } from 'react';
import { CHAT_EMOJI, CHAT_GIFS } from '../../stream/chat-media';

export function ChatGifImage({ url, label }: { url: string; label: string }) {
	const [failed, setFailed] = useState(false);
	useEffect(() => setFailed(false), [url]);
	return (
		<span className="chat-gif-image">
			{!failed && <img src={url} alt={label} loading="lazy" onError={() => setFailed(true)} />}
			<span className={failed ? 'gif-label' : 'gif-label motion-fallback'}>{label}</span>
		</span>
	);
}

type ChatPickerProps = {
	triggerRef: RefObject<HTMLButtonElement | null>;
	onEmoji: (emoji: string) => void;
	onGif: (id: string) => void;
	onClose: () => void;
};

export function ChatPicker({ triggerRef, onEmoji, onGif, onClose }: ChatPickerProps) {
	const [tab, setTab] = useState<'emoji' | 'gif'>('emoji');
	const pickerRef = useRef<HTMLDivElement>(null);
	const emojiTabRef = useRef<HTMLButtonElement>(null);
	const gifTabRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		emojiTabRef.current?.focus();
		function outside(event: PointerEvent) {
			if (event.target instanceof Node && !pickerRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) {
				onClose();
			}
		}
		function escape(event: KeyboardEvent) {
			if (event.key === 'Escape') {
				event.preventDefault();
				onClose();
				triggerRef.current?.focus();
			}
		}
		document.addEventListener('pointerdown', outside);
		document.addEventListener('keydown', escape);
		return () => {
			document.removeEventListener('pointerdown', outside);
			document.removeEventListener('keydown', escape);
		};
	}, [onClose, triggerRef]);

	return (
		<div className="chat-picker" id="chat-picker" ref={pickerRef} role="dialog" aria-label="Emoji and GIF picker">
			<div className="picker-tabs" role="tablist" aria-label="Media type" onKeyDown={event => {
				if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') {
					event.preventDefault();
					const next = event.key === 'Home' ? 'emoji' : event.key === 'End' ? 'gif' : tab === 'emoji' ? 'gif' : 'emoji';
					setTab(next);
					(next === 'emoji' ? emojiTabRef : gifTabRef).current?.focus();
				}
			}}>
				<button
					ref={emojiTabRef} type="button" role="tab" id="emoji-tab" aria-controls="picker-content"
					aria-selected={tab === 'emoji'} tabIndex={tab === 'emoji' ? 0 : -1} onClick={() => setTab('emoji')}
				>Emoji</button>
				<button
					ref={gifTabRef} type="button" role="tab" id="gif-tab" aria-controls="picker-content"
					aria-selected={tab === 'gif'} tabIndex={tab === 'gif' ? 0 : -1} onClick={() => setTab('gif')}
				>GIFs</button>
			</div>
			<div
				id="picker-content" role="tabpanel" aria-labelledby={tab === 'emoji' ? 'emoji-tab' : 'gif-tab'}
				className={tab === 'emoji' ? 'emoji-grid' : 'gif-grid'}
			>
				{tab === 'emoji' ? CHAT_EMOJI.map((emoji, index) => (
					<button key={`${emoji}-${index}`} type="button" aria-label={`Insert ${emoji}`} onClick={() => onEmoji(emoji)}>
						{emoji}
					</button>
				)) : CHAT_GIFS.map(gif => (
					<button type="button" key={gif.id} title={gif.label} aria-label={`Select ${gif.label}`} onClick={() => onGif(gif.id)}>
						<ChatGifImage url={gif.url} label={gif.label} />
					</button>
				))}
			</div>
		</div>
	);
}
