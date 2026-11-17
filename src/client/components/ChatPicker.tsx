import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { RotateCw, Search, X } from 'lucide-react';
import { CHAT_GIFS, CHAT_GIF_PACK, searchChatMedia } from '../../stream/chat-media';
import { CHAT_EMOTE_PACKS } from '../../stream/chat-emotes';
import { getChatStorage } from '../lib/chatStorage';
import { readMediaRecents, rememberMedia } from '../lib/mediaRecents';
import { readPickerState, writePickerState, type ChatPickerState, type PickerView } from '../lib/chatPickerState';
import { useInfiniteGiphySearch } from '../hooks/useInfiniteGiphySearch';
import { REACTIONS } from '../lib/emojiSearch';
import { ChatGifImage } from './ChatGifImage';
import { ChatGifAttachment } from './ChatGifAttachment';
export { ChatGifImage } from './ChatGifImage';

type ChatPickerProps = {
	open?: boolean;
	anchor?: { x: number; y: number };
	triggerRef: RefObject<HTMLButtonElement | null>;
	onEmoji: (emoji: string) => void;
	onGif: (id: string) => void;
	onClose: () => void;
};
const tabs = ['emoji', 'gif'] as const;
const moods = ['all', 'recent', 'happy', 'love', 'chaotic', 'sad', 'cozy', 'funny'] as const;
const prefetchDistance = 320;

export function ChatPicker({ open = true, anchor, triggerRef, onEmoji, onGif, onClose }: ChatPickerProps) {
	const [preferences, setPreferences] = useState(() => readPickerState(getChatStorage()));
	const preferencesRef = useRef(preferences);
	const [recents, setRecents] = useState(() => readMediaRecents(getChatStorage()));
	const pickerRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	const sentinelRef = useRef<HTMLDivElement>(null);
	const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
	const callbacksRef = useRef({ onClose, triggerRef });
	callbacksRef.current = { onClose, triggerRef };
	const { tab } = preferences;
	const { query, category, pack, source, visibleCount } = preferences[tab];
	const live = tab === 'gif' && source === 'giphy';
	const search = useInfiniteGiphySearch(preferences.gif.query, open && live);
	const recentId = (reaction: typeof REACTIONS[number]) => reaction.pack === 'unicode' ? reaction.id : `emote:${reaction.id}`;
	const emojis = searchChatMedia(REACTIONS, query, category === 'recent' ? 'all' : category)
		.filter(reaction => pack === 'all' || reaction.pack === pack)
		.filter(reaction => category !== 'recent' || recents.includes(recentId(reaction)))
		.sort((a, b) => category === 'recent' ? recents.indexOf(recentId(a)) - recents.indexOf(recentId(b)) : 0);
	const gifs = searchChatMedia(CHAT_GIFS, query, category === 'recent' ? 'all' : category)
		.filter(gif => category !== 'recent' || recents.includes(gif.id))
		.sort((a, b) => category === 'recent' ? recents.indexOf(a.id) - recents.indexOf(b.id) : 0);
	const recentLiveIds = category === 'recent' && !query ? recents.filter(id => id.startsWith('giphy:')) : [];
	const visiblePacks = CHAT_EMOTE_PACKS.filter(item => pack === 'all' || item.id === pack);
	const count = tab === 'emoji' ? emojis.length : gifs.length;
	const batchSize = tab === 'emoji' ? 96 : 48;
	const hasMore = live ? search.nextOffset !== null : visibleCount < count;

	function updatePreferences(next: ChatPickerState): void {
		preferencesRef.current = next;
		setPreferences(next);
	}
	function updateView(patch: Partial<PickerView>, reset = false): void {
		const current = preferencesRef.current;
		const next = { ...current[tab], ...patch, ...(reset ? { visibleCount: batchSize, scrollTop: 0 } : {}) };
		updatePreferences({ ...current, [tab]: next });
	}
	function rememberScroll(): void {
		const content = contentRef.current;
		if (!content) return;
		const current = preferencesRef.current;
		// Refetched pages may not yet be tall enough to restore the saved position.
		if (live && current.gif.scrollTop > content.scrollHeight - content.clientHeight
			&& (search.loading || search.loadingMore || search.nextOffset !== null)) return;
		preferencesRef.current = { ...current, [current.tab]: {
			...current[current.tab], scrollTop: content.scrollTop,
			...(live ? { visibleCount: Math.max(current.gif.visibleCount, search.items.length) } : {}),
		} };
	}
	function cancelScrollRestoration(): void {
		const content = contentRef.current;
		if (!content) return;
		const current = preferencesRef.current;
		preferencesRef.current = { ...current, [tab]: { ...current[tab], scrollTop: content.scrollTop } };
	}
	function save(): void { writePickerState(getChatStorage(), preferencesRef.current); }
	function changeTab(next: typeof tabs[number]): void {
		rememberScroll();
		updatePreferences({ ...preferencesRef.current, tab: next });
	}
	function close(): void { rememberScroll(); save(); callbacksRef.current.onClose(); }
	function selectGif(id: string): void { rememberScroll(); save(); rememberMedia(getChatStorage(), id); onGif(id); }
	function selectEmoji(value: string, id: string): void { rememberScroll(); save(); rememberMedia(getChatStorage(), id); onEmoji(value); }
	function loadMore(): void {
		if (!open) return;
		if (live) {
			if (!search.loading && !search.loadingMore && !search.error && search.nextOffset !== null) search.loadMore();
		} else {
			const currentCount = preferencesRef.current[tab].visibleCount;
			if (currentCount < count) updateView({ visibleCount: Math.min(count, currentCount + batchSize) });
		}
	}
	const loadMoreRef = useRef(loadMore);
	loadMoreRef.current = loadMore;

	useEffect(() => {
		if (!open) { save(); return; }
		setRecents(readMediaRecents(getChatStorage()));
		const picker = pickerRef.current;
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		tabRefs.current[tabs.indexOf(preferencesRef.current.tab)]?.focus();
		function keydown(event: KeyboardEvent): void {
			if (event.key === 'Escape') {
				event.preventDefault();
				writePickerState(getChatStorage(), preferencesRef.current);
				callbacksRef.current.onClose();
			} else if (event.key === 'Tab' && picker) {
				const focusable = Array.from(picker.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, a[href], [tabindex="0"]'))
					.filter(element => element.tabIndex >= 0);
				const first = focusable[0];
				const last = focusable.at(-1);
				if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
				else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
			}
		}
		function persist(): void { writePickerState(getChatStorage(), preferencesRef.current); }
		document.addEventListener('keydown', keydown);
		window.addEventListener('pagehide', persist);
		return () => {
			persist();
			document.body.style.overflow = previousOverflow;
			document.removeEventListener('keydown', keydown);
			window.removeEventListener('pagehide', persist);
			if (picker?.contains(document.activeElement) || document.activeElement === document.body) callbacksRef.current.triggerRef.current?.focus();
		};
	}, [open]);

	useLayoutEffect(() => {
		if (open && live && search.items.length > preferencesRef.current.gif.visibleCount) {
			const current = preferencesRef.current;
			preferencesRef.current = { ...current, gif: { ...current.gif, visibleCount: search.items.length } };
		}
		if (open && contentRef.current) contentRef.current.scrollTop = preferencesRef.current[tab].scrollTop;
	}, [open, tab, query, category, pack, source, visibleCount, search.items.length, search.loading, search.loadingMore, search.nextOffset]);

	useLayoutEffect(() => {
		if (!open) return;
		function fillViewport(): void {
			const content = contentRef.current;
			if (!content) return;
			const restoringLive = live && search.items.length < preferencesRef.current.gif.visibleCount;
			if (restoringLive || content.scrollHeight - content.scrollTop - content.clientHeight < prefetchDistance) loadMoreRef.current();
		}
		fillViewport();
		window.addEventListener('resize', fillViewport);
		return () => window.removeEventListener('resize', fillViewport);
	}, [open, tab, query, category, pack, source, visibleCount, search.items.length, search.loading, search.loadingMore, search.nextOffset, search.error]);

	useEffect(() => {
		if (!open || !hasMore || !contentRef.current || !sentinelRef.current || typeof IntersectionObserver === 'undefined') return;
		const observer = new IntersectionObserver(entries => {
			if (entries.some(entry => entry.isIntersecting)) loadMoreRef.current();
		}, { root: contentRef.current, rootMargin: `${prefetchDistance}px` });
		observer.observe(sentinelRef.current);
		return () => observer.disconnect();
	}, [open, hasMore, tab, visibleCount, search.items.length]);

	if (!open) return null;
	return <div className="chat-picker-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) close(); }}>
		<div className="chat-picker" id="chat-picker" ref={pickerRef} role="dialog" aria-modal={true} aria-label="Emoji and GIF picker" style={anchor ? { '--picker-x': `${anchor.x + 8}px`, '--picker-y': `${anchor.y + 8}px` } as CSSProperties : undefined}>
			<div className="picker-header">
				<div className="picker-tabs" role="tablist" aria-label="Media type" onKeyDown={event => {
					const current = tabs.indexOf(tab);
					const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : event.key === 'ArrowRight' ? (current + 1) % tabs.length : event.key === 'ArrowLeft' ? (current + tabs.length - 1) % tabs.length : -1;
					if (index < 0) return;
					event.preventDefault(); changeTab(tabs[index]); tabRefs.current[index]?.focus();
				}}>
					{tabs.map((value, index) => <button key={value} ref={node => { tabRefs.current[index] = node; }} type="button" role="tab" id={`${value}-tab`} aria-controls="picker-content" aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} onClick={() => changeTab(value)}>{value === 'emoji' ? 'Emoji' : 'GIFs'}</button>)}
				</div>
				<button type="button" className="icon-button secondary-button picker-close" aria-label="Close picker" title="Close picker" onClick={close}><X size={20} /></button>
			</div>
			<div className="picker-filters">
				<label className="picker-search"><Search size={18} aria-hidden="true" /><span className="sr-only">Search reactions</span><input type="search" value={query} maxLength={50} placeholder="Search reactions" onChange={event => updateView({ query: event.currentTarget.value }, true)} /></label>
				<div className="picker-options">
					{!live && <label><span className="sr-only">Reaction category</span><select value={category} onChange={event => updateView({ category: event.currentTarget.value }, true)}>{moods.map(mood => <option key={mood} value={mood}>{mood === 'all' ? 'All moods' : mood[0].toUpperCase() + mood.slice(1)}</option>)}</select></label>}
					{tab === 'emoji' && <label><span className="sr-only">Emoji pack</span><select value={pack} onChange={event => updateView({ pack: event.currentTarget.value }, true)}><option value="all">All packs</option><option value="unicode">Unicode</option>{CHAT_EMOTE_PACKS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
					{tab === 'gif' && <label><span className="sr-only">GIF source</span><select value={source} onChange={event => updateView({ source: event.currentTarget.value as PickerView['source'] }, true)}><option value="collection">Room collection</option><option value="giphy">Search GIPHY</option></select></label>}
				</div>
			</div>
			<div id="picker-content" ref={contentRef} role="tabpanel" aria-labelledby={`${tab}-tab`} className="picker-content" aria-busy={live && (search.loading || search.loadingMore)} tabIndex={0}
				onWheel={cancelScrollRestoration} onTouchMove={cancelScrollRestoration}
				onKeyDown={event => { if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) cancelScrollRestoration(); }} onScroll={event => {
				rememberScroll();
				const content = event.currentTarget;
				if (content.scrollHeight - content.scrollTop - content.clientHeight < prefetchDistance) loadMore();
			}}>
				{tab === 'emoji' && <div className="emoji-grid emote-grid">{emojis.slice(0, visibleCount).map(reaction => <button key={reaction.id} type="button" title={`${reaction.value} · ${reaction.label} · ${CHAT_EMOTE_PACKS.find(item => item.id === reaction.pack)?.name ?? 'Unicode'}`} aria-label={`Insert ${reaction.label}${reaction.url ? ` (${CHAT_EMOTE_PACKS.find(item => item.id === reaction.pack)?.name ?? reaction.pack})` : ''}`} onClick={() => selectEmoji(reaction.value, recentId(reaction))}>{reaction.url ? <img src={reaction.url} alt="" width={40} height={40} loading="lazy" /> : reaction.value}</button>)}</div>}
				{tab === 'gif' && !live && <><div className="gif-grid">{gifs.slice(0, visibleCount).map(gif => <button key={gif.id} type="button" title={gif.label} aria-label={`Select ${gif.label}`} onClick={() => selectGif(gif.id)}><ChatGifImage url={gif.url} label={gif.label} /></button>)}</div>{recentLiveIds.length > 0 && <div className="recent-live-gifs">{recentLiveIds.map(id => <div key={id}><ChatGifAttachment id={id} /><button type="button" className="secondary-button" onClick={() => selectGif(id)}>Select GIF</button></div>)}</div>}</>}
				{!live && count === 0 && !(tab === 'gif' && recentLiveIds.length) && <p className="picker-status" role="status">No reactions found.</p>}
				{live && <>
					{!search.configured ? <p className="picker-status" role="status">Live GIF search is not configured.</p> : <>
						<div className="gif-grid">{search.items.map((gif, index) => <button type="button" key={`${gif.id}-${index}`} title={gif.label} aria-label={`Select ${gif.label}`} disabled={!gif.url} onClick={() => { if (gif.url) selectGif(gif.id); }}>{gif.url ? <ChatGifImage url={gif.url} label={gif.label} /> : <span className="gif-label">GIF unavailable</span>}</button>)}</div>
						{(search.loading || search.loadingMore) && <p className="picker-status" role="status">Loading GIFs...</p>}
						{search.error && <div className="picker-status" role="alert"><p>{search.error}</p><button type="button" className="icon-button secondary-button" aria-label="Retry GIF search" title="Retry GIF search" onClick={search.retry}><RotateCw size={18} /></button></div>}
						{!search.loading && !search.error && search.items.length === 0 && <p className="picker-status" role="status">No GIFs found.</p>}
					</>}
				</>}
				<div ref={sentinelRef} className="picker-scroll-sentinel" aria-hidden="true" />
			</div>
			{tab === 'emoji' && <div className="emote-credits" aria-label="Emoji artwork credits">{visiblePacks.map(item => <span key={item.id}><a href={item.sourceUrl} target="_blank" rel="noreferrer" title={item.credit}>{item.name}</a><a href={item.licenseUrl} target="_blank" rel="noreferrer">{item.license}</a></span>)}</div>}
			{tab === 'gif' && !live && <div className="emote-credits" aria-label="GIF artwork credits"><span><a href={CHAT_GIF_PACK.sourceUrl} target="_blank" rel="noreferrer">{CHAT_GIF_PACK.name}</a><a href={CHAT_GIF_PACK.licenseUrl} target="_blank" rel="noreferrer">{CHAT_GIF_PACK.license}</a><a href="/gifs/noto-animated/ATTRIBUTION.txt" target="_blank" rel="noreferrer">Credits and changes</a></span></div>}
			{live && <a className="giphy-attribution" href="https://giphy.com" target="_blank" rel="noreferrer"><img src="/PoweredBy_200px-Black_HorizLogo.png" alt="Powered by GIPHY" width={150} height={21} /></a>}
		</div>
	</div>;
}
