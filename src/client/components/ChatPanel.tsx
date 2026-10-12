import { useCallback, useEffect, useLayoutEffect, useRef, useState, type SyntheticEvent } from 'react';
import { ArrowDown, Check, Pencil, Send, Smile, X } from 'lucide-react';
import { MAX_CHAT_MESSAGE_LENGTH, type ChatMessage } from '../../stream/chat';
import { getChatGif } from '../../stream/chat-media';
import { ChatGifImage, ChatPicker } from './ChatPicker';
import type { ChatResultServerMessage } from '../../stream/messages';

type ChatPanelProps = {
	messages: ChatMessage[];
	name: string;
	ready: boolean;
	error: string | null;
	result: ChatResultServerMessage | null;
	onSend: (text: string, gifId: string | undefined, requestId: string) => boolean;
	onNameChange: (name: string) => boolean;
};

export function ChatPanel({ messages, name, ready, error, result, onSend, onNameChange }: ChatPanelProps) {
	const [draft, setDraft] = useState('');
	const [gifId, setGifId] = useState<string>();
	const [pickerOpen, setPickerOpen] = useState(false);
	const [editingName, setEditingName] = useState(false);
	const [nameDraft, setNameDraft] = useState(name);
	const [localError, setLocalError] = useState<string | null>(null);
	const [unread, setUnread] = useState(0);
	const [pendingId, setPendingId] = useState<string | null>(null);
	const pendingRef = useRef<string | null>(null);
	const focusAfterResultRef = useRef(false);
	const logRef = useRef<HTMLDivElement>(null);
	const composerRef = useRef<HTMLTextAreaElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const nearBottomRef = useRef(true);
	const previousLastRef = useRef<string | undefined>(undefined);
	const selectedGif = gifId ? getChatGif(gifId) : undefined;
	const draftLength = Array.from(draft).length;
	const closePicker = useCallback(() => setPickerOpen(false), []);

	useEffect(() => { if (!editingName) setNameDraft(name); }, [name, editingName]);
	useLayoutEffect(() => {
		if (pendingId || !ready || !focusAfterResultRef.current) return;
		focusAfterResultRef.current = false;
		composerRef.current?.focus();
	}, [pendingId, ready]);
	useEffect(() => {
		if (!pendingId) return;
		const timer = setTimeout(() => {
			if (pendingRef.current !== pendingId) return;
			pendingRef.current = null;
			setPendingId(null);
			setLocalError('Send not confirmed. Check chat before retrying.');
		}, 10000);
		return () => clearTimeout(timer);
	}, [pendingId]);
	useEffect(() => {
		if (!result || !pendingId || result.requestId !== pendingRef.current) return;
		pendingRef.current = null;
		focusAfterResultRef.current = true;
		setPendingId(null);
		if (!result.accepted) {
			setLocalError(result.message ?? 'Message rejected. Please try again.');
			return;
		}
		setDraft('');
		setGifId(undefined);
		setLocalError(null);
		nearBottomRef.current = true;
	}, [result, pendingId]);
	useLayoutEffect(() => {
		const lastId = messages.at(-1)?.id;
		if (lastId === previousLastRef.current) return;
		if (nearBottomRef.current) {
			const log = logRef.current;
			if (log) log.scrollTop = log.scrollHeight;
			setUnread(0);
		} else setUnread(count => count + 1);
		previousLastRef.current = lastId;
	}, [messages]);

	function submit(event?: SyntheticEvent): void {
		event?.preventDefault();
		if (!ready || pendingRef.current || (!draft.trim() && !gifId)) return;
		if (draftLength > MAX_CHAT_MESSAGE_LENGTH) { setLocalError('Message must be 2000 characters or fewer.'); return; }
		const requestId = crypto.randomUUID();
		pendingRef.current = requestId;
		if (!onSend(draft, gifId, requestId)) {
			pendingRef.current = null;
			setLocalError('Connection unavailable. Try again when connected.');
			return;
		}
		setPendingId(requestId);
		nearBottomRef.current = true;
		setPickerOpen(false);
		setLocalError(null);
	}
	function saveName(event: SyntheticEvent): void {
		event.preventDefault();
		if (!nameDraft.trim() || Array.from(nameDraft.trim()).length > 40) { setLocalError('Name must contain 1 to 40 characters.'); return; }
		if (!onNameChange(nameDraft.trim())) { setLocalError('Connection unavailable. Try again when connected.'); return; }
		setEditingName(false);
		setLocalError(null);
	}
	function insertEmoji(emoji: string): void {
		const input = composerRef.current;
		const start = input?.selectionStart ?? draft.length;
		const end = input?.selectionEnd ?? draft.length;
		setDraft(draft.slice(0, start) + emoji + draft.slice(end));
		setPickerOpen(false);
		requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(start + emoji.length, start + emoji.length); });
	}

	return <section className="chat-panel" aria-label="Room chat">
		<header className="chat-header"><h2>Room chat</h2><span className="chat-presence">{ready ? 'Live' : 'Connecting...'}</span></header>
		<div className="chat-log" ref={logRef} role="log" aria-label="Chat messages" aria-live="polite" aria-relevant="additions" tabIndex={0} onScroll={() => {
			const log = logRef.current;
			if (!log) return;
			nearBottomRef.current = log.scrollHeight - log.scrollTop - log.clientHeight < 64;
			if (nearBottomRef.current) setUnread(0);
		}}>
			{messages.length === 0 && <p className="empty-state">{ready ? 'No messages yet.' : 'Connecting to chat...'}</p>}
			{messages.map(message => {
				const gif = message.gifId ? getChatGif(message.gifId) : undefined;
				return <article className="chat-message" key={message.id}>
					<div className="chat-message-meta"><strong>{message.name}</strong><time dateTime={new Date(message.sentAtMs).toISOString()}>{new Date(message.sentAtMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
					{message.text && <p>{message.text}</p>}
					{gif && <ChatGifImage url={gif.url} label={gif.label} />}
				</article>;
			})}
		</div>
		{unread > 0 && <button type="button" className="new-messages" onClick={() => {
			if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
			nearBottomRef.current = true;
			setUnread(0);
		}}><ArrowDown size={16} aria-hidden="true" />New messages ({unread})</button>}
		<div className="chat-compose-area">
			{editingName ? <form className="chat-name-form" onSubmit={saveName}>
				<label className="sr-only" htmlFor="chat-name">Display name</label>
				<input id="chat-name" value={nameDraft} onChange={event => setNameDraft(event.currentTarget.value)} autoFocus autoComplete="nickname" onKeyDown={event => { if (event.key === 'Escape') setEditingName(false); }} />
				<button type="submit" className="icon-button" title="Save name" aria-label="Save name" disabled={!ready}><Check size={18} /></button>
				<button type="button" className="icon-button secondary-button" title="Cancel name edit" aria-label="Cancel name edit" onClick={() => setEditingName(false)}><X size={18} /></button>
			</form> : <div className="chat-name"><span>{name || 'Guest'}</span><button type="button" className="icon-button secondary-button" title="Edit display name" aria-label="Edit display name" onClick={() => { setNameDraft(name); setEditingName(true); }}><Pencil size={15} /></button></div>}
			<form className="chat-composer" onSubmit={submit}>
				{selectedGif && <div className="pending-gif"><ChatGifImage url={selectedGif.url} label={selectedGif.label} /><button type="button" className="icon-button secondary-button" title="Remove GIF" aria-label="Remove GIF" disabled={!!pendingId} onClick={() => setGifId(undefined)}><X size={16} /></button></div>}
				<label className="sr-only" htmlFor="chat-message">Message</label>
				<textarea id="chat-message" rows={2} ref={composerRef} value={draft} placeholder="Message" disabled={!ready || !!pendingId} onChange={event => setDraft(event.currentTarget.value)} onKeyDown={event => {
					if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); submit(); }
				}} />
				<div className="composer-actions">
					<button ref={triggerRef} type="button" className="icon-button secondary-button" title="Emoji and GIFs" aria-label="Emoji and GIFs" aria-expanded={pickerOpen} aria-controls="chat-picker" disabled={!ready || !!pendingId} onClick={() => setPickerOpen(open => !open)}><Smile size={20} /></button>
					<span className="message-count">{draftLength > 1800 ? `${draftLength}/${MAX_CHAT_MESSAGE_LENGTH}` : ''}</span>
					<button type="submit" className="icon-button send-button" title="Send message" aria-label="Send message" disabled={!ready || !!pendingId || (!draft.trim() && !gifId) || draftLength > MAX_CHAT_MESSAGE_LENGTH}><Send size={18} /></button>
				</div>
			</form>
			{pickerOpen && <ChatPicker triggerRef={triggerRef} onClose={closePicker} onEmoji={insertEmoji} onGif={id => { setGifId(id); setPickerOpen(false); composerRef.current?.focus(); }} />}
			{(localError || error) && <p className="chat-error" role="alert">{localError || error}</p>}
		</div>
	</section>;
}
