import { useCallback, useEffect, useLayoutEffect, useRef, useState, type SyntheticEvent } from 'react';
import { ArrowDown, Pencil, Send, Smile, X } from 'lucide-react';
import { MAX_CHAT_MESSAGE_LENGTH, type ChatMessage } from '../../stream/chat';
import { tokenizeChatEmotes } from '../../stream/chat-emotes';
import { continuesChatGroup } from '../lib/chatGrouping';
import { ChatPicker } from './ChatPicker';
import { ChatGifAttachment } from './ChatGifAttachment';
import type { ChatResultServerMessage } from '../../stream/messages';
import { getEmojiQuery, replaceEmojiQuery, searchReactions, type Reaction } from '../lib/emojiSearch';
import { getChatStorage } from '../lib/chatStorage';
import { rememberMedia } from '../lib/mediaRecents';
import { createDefaultChatProfile, type ChatProfile } from '../../stream/chat-profile';
import { ChatProfileEditor } from './ChatProfileEditor';
import { RobotAvatar } from './RobotAvatar';

const defaultProfile = createDefaultChatProfile();

type ChatPanelProps = {
	messages: ChatMessage[];
	name: string;
	profile?: ChatProfile;
	ready: boolean;
	error: string | null;
	result: ChatResultServerMessage | null;
	onSend: (text: string, gifId: string | undefined, requestId: string) => boolean;
	onNameChange: (name: string) => boolean;
	onProfileChange?: (name: string, profile: ChatProfile) => boolean;
};

export function ChatPanel({ messages, name, profile = defaultProfile, ready, error, result, onSend, onNameChange, onProfileChange }: ChatPanelProps) {
	const [draft, setDraft] = useState('');
	const [gifId, setGifId] = useState<string>();
	const [pickerOpen, setPickerOpen] = useState(false);
	const [pickerAnchor, setPickerAnchor] = useState<{ x: number; y: number }>();
	const [editingProfile, setEditingProfile] = useState(false);
	const [localError, setLocalError] = useState<string | null>(null);
	const [unread, setUnread] = useState(0);
	const [pendingId, setPendingId] = useState<string | null>(null);
	const [selection, setSelection] = useState({ start: 0, end: 0 });
	const [suggestionIndex, setSuggestionIndex] = useState(0);
	const [dismissedQuery, setDismissedQuery] = useState('');
	const [composing, setComposing] = useState(false);
	const pendingRef = useRef<string | null>(null);
	const focusAfterResultRef = useRef(false);
	const logRef = useRef<HTMLDivElement>(null);
	const composerRef = useRef<HTMLTextAreaElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const profileTriggerRef = useRef<HTMLButtonElement>(null);
	const suggestionsRef = useRef<HTMLDivElement>(null);
	const nearBottomRef = useRef(true);
	const previousLastRef = useRef<string | undefined>(undefined);
	const draftLength = Array.from(draft).length;
	const closePicker = useCallback(() => setPickerOpen(false), []);
	const queryKey = `${draft}\u0000${selection.start}\u0000${selection.end}`;
	const emojiQuery = !pendingId && !pickerOpen && !composing && dismissedQuery !== queryKey ? getEmojiQuery(draft, selection.start, selection.end) : null;
	const suggestions = emojiQuery ? searchReactions(emojiQuery.query) : [];
	const activeSuggestion = Math.min(suggestionIndex, Math.max(0, suggestions.length - 1));
	useEffect(() => { suggestionsRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [activeSuggestion, emojiQuery?.query]);

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
	function insertEmoji(emoji: string): void {
		const input = composerRef.current;
		const start = input?.selectionStart ?? draft.length;
		const end = input?.selectionEnd ?? draft.length;
		setDraft(draft.slice(0, start) + emoji + draft.slice(end));
		setPickerOpen(false);
		setSelection({ start: start + emoji.length, end: start + emoji.length });
		requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(start + emoji.length, start + emoji.length); });
	}
	function selectSuggestion(reaction: Reaction): void {
		if (!emojiQuery) return;
		const next = replaceEmojiQuery(draft, emojiQuery, reaction.value);
		setDraft(next.text);
		setSelection({ start: next.caret, end: next.caret });
		setSuggestionIndex(0);
		rememberMedia(getChatStorage(), reaction.pack === 'unicode' ? reaction.id : `emote:${reaction.id}`);
		requestAnimationFrame(() => { composerRef.current?.focus(); composerRef.current?.setSelectionRange(next.caret, next.caret); });
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
			{messages.map((message, index) => {
				const continuation = continuesChatGroup(messages[index - 1], message);
				return <article className={`chat-message${continuation ? ' chat-message-continuation' : ''}`} key={message.id}>
					{!continuation && <RobotAvatar profile={message.profile} className="chat-message-avatar" size={32} />}
					<div className={continuation ? 'sr-only' : 'chat-message-meta'}><strong style={{ color: `#${message.profile?.nameColor ?? defaultProfile.nameColor}` }}>{message.name}</strong><time dateTime={new Date(message.sentAtMs).toISOString()}>{new Date(message.sentAtMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
					{message.text && <p>{tokenizeChatEmotes(message.text).map((token, tokenIndex) => token.type === 'text' ? token.text : <img key={tokenIndex} className="chat-emote" src={token.emote.url} alt={`:${token.emote.id}:`} title={`${token.emote.label} · ${token.emote.author}`} width={32} height={32} />)}</p>}
					{message.gifId && <ChatGifAttachment id={message.gifId} />}
				</article>;
			})}
		</div>
		{unread > 0 && <button type="button" className="new-messages" onClick={() => {
			if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
			nearBottomRef.current = true;
			setUnread(0);
		}}><ArrowDown size={16} aria-hidden="true" />New messages ({unread})</button>}
		<div className="chat-compose-area">
			{suggestions.length > 0 && <div id="emoji-suggestions" ref={suggestionsRef} className="emoji-suggestions" role="listbox" aria-label="Emoji suggestions">
				{suggestions.map((reaction, index) => <button type="button" role="option" id={`emoji-suggestion-${index}`} key={reaction.id} aria-selected={index === activeSuggestion} title={reaction.value} onPointerDown={event => event.preventDefault()} onClick={() => selectSuggestion(reaction)}>
					{reaction.url ? <img src={reaction.url} alt="" width={28} height={28} /> : <span className="suggestion-glyph">{reaction.value}</span>}
					<span className="suggestion-label">{reaction.label}<small>{reaction.url ? reaction.value : reaction.pack}</small></span>
				</button>)}
			</div>}
			<div className="chat-name"><RobotAvatar profile={profile} size={28} /><span style={{ color: `#${profile.nameColor}` }}>{name || 'Guest'}</span><button ref={profileTriggerRef} type="button" className="icon-button secondary-button" title="Edit profile" aria-label="Edit profile" onClick={() => setEditingProfile(true)}><Pencil size={15} /></button></div>
			{editingProfile && <ChatProfileEditor name={name} profile={profile} ready={ready} triggerRef={profileTriggerRef} onSave={(nextName, nextProfile) => onProfileChange ? onProfileChange(nextName, nextProfile) : onNameChange(nextName)} onClose={() => setEditingProfile(false)} />}
			<form className="chat-composer" onSubmit={submit}>
				{gifId && <div className="pending-gif"><ChatGifAttachment id={gifId} /><button type="button" className="icon-button secondary-button" title="Remove GIF" aria-label="Remove GIF" disabled={!!pendingId} onClick={() => setGifId(undefined)}><X size={16} /></button></div>}
				<label className="sr-only" htmlFor="chat-message">Message</label>
				<textarea id="chat-message" rows={2} ref={composerRef} value={draft} placeholder="Message" disabled={!!pendingId}
					aria-autocomplete="list" aria-controls={suggestions.length ? 'emoji-suggestions' : undefined} aria-activedescendant={suggestions.length ? `emoji-suggestion-${activeSuggestion}` : undefined}
					onChange={event => { const input = event.currentTarget; setDraft(input.value); setSelection({ start: input.selectionStart ?? input.value.length, end: input.selectionEnd ?? input.value.length }); setSuggestionIndex(0); }}
					onSelect={event => { const input = event.currentTarget; setSelection({ start: input.selectionStart, end: input.selectionEnd }); }}
					onBlur={() => setDismissedQuery(queryKey)}
					onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} onKeyDown={event => {
					if (event.nativeEvent.isComposing || event.keyCode === 229 || composing) return;
					if (suggestions.length) {
						if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setSuggestionIndex((activeSuggestion + (event.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length); return; }
						if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) { event.preventDefault(); selectSuggestion(suggestions[activeSuggestion]); return; }
						if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDismissedQuery(queryKey); return; }
					}
					if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); }
				}} />
				<div className="composer-actions">
					<button ref={triggerRef} type="button" className="icon-button secondary-button" title="Emoji and GIFs" aria-label="Emoji and GIFs" aria-expanded={pickerOpen} aria-controls="chat-picker" disabled={!!pendingId} onClick={event => {
						if (!pickerOpen) {
							const bounds = event.detail === 0 ? event.currentTarget.getBoundingClientRect() : null;
							setPickerAnchor(bounds ? { x: bounds.left, y: bounds.bottom } : { x: event.clientX, y: event.clientY });
						}
						setPickerOpen(open => !open);
					}}><Smile size={20} /></button>
					<span className="message-count">{draftLength > 1800 ? `${draftLength}/${MAX_CHAT_MESSAGE_LENGTH}` : ''}</span>
					<button type="submit" className="icon-button send-button" title="Send message" aria-label="Send message" disabled={!ready || !!pendingId || (!draft.trim() && !gifId) || draftLength > MAX_CHAT_MESSAGE_LENGTH}><Send size={18} /></button>
				</div>
			</form>
			<ChatPicker open={pickerOpen} anchor={pickerAnchor} triggerRef={triggerRef} onClose={closePicker} onEmoji={insertEmoji} onGif={id => { setGifId(id); setPickerOpen(false); composerRef.current?.focus(); }} />
			{(localError || error) && <p className="chat-error" role="alert">{localError || error}</p>}
		</div>
	</section>;
}
