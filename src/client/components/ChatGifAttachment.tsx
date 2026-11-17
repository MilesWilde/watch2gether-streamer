import { useEffect, useRef, useState } from 'react';
import { CHAT_GIF_PACK, getChatGif, type ChatGif } from '../../stream/chat-media';
import { getGiphyKey, resolveGiphyGif } from '../lib/giphy';
import { ChatGifImage } from './ChatGifImage';

export function ChatGifAttachment({ id }: { id: string }) {
	const curated = getChatGif(id);
	const [resolved, setResolved] = useState<{ id: string; gif: ChatGif } | null>(null);
	const [failure, setFailure] = useState<string | null>(null);
	const [retry, setRetry] = useState(0);
	const element = useRef<HTMLDivElement>(null);
	const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
	useEffect(() => {
		if (visible || !element.current) return;
		const observer = new IntersectionObserver(entries => {
			if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
		}, { rootMargin: '100px' });
		observer.observe(element.current);
		return () => observer.disconnect();
	}, [visible]);
	useEffect(() => {
		if (!visible || curated || !/^giphy:[A-Za-z0-9]{1,64}$/.test(id)) return;
		let active = true;
		const controller = new AbortController();
		setFailure(null);
		resolveGiphyGif(getGiphyKey(), id, controller.signal).then(gif => {
			if (active) setResolved({ id, gif });
		}).catch(() => { if (active) setFailure('GIF unavailable'); });
		return () => { active = false; controller.abort(); };
	}, [id, curated, retry, visible]);
	const gif = curated ?? (resolved?.id === id ? resolved.gif : null);
	return <div ref={element} className="chat-gif-attachment">{gif ? <><ChatGifImage key={`${id}:${retry}`} url={gif.url} label={gif.label} onRetry={() => { setResolved(null); setRetry(count => count + 1); }} />{gif.url.startsWith('/gifs/') && <a className="giphy-message-attribution" href="/gifs/noto-animated/ATTRIBUTION.txt" target="_blank" rel="noreferrer">{CHAT_GIF_PACK.name} · {CHAT_GIF_PACK.license}</a>}{!curated && <a className="giphy-message-attribution" href={`https://giphy.com/gifs/${encodeURIComponent(id.slice(6))}`} target="_blank" rel="noreferrer"><img src="/PoweredBy_200px-Black_HorizLogo.png" alt="Powered by GIPHY" width={120} height={17} /></a>}</> : <div className="gif-unavailable" role="status">
		<span>{failure ?? 'Loading GIF...'}</span>
		{failure && <><button type="button" className="secondary-button" onClick={() => setRetry(count => count + 1)}>Retry</button><a href={`https://giphy.com/gifs/${encodeURIComponent(id.slice(6))}`} target="_blank" rel="noreferrer">View on GIPHY</a></>}
	</div>}</div>;
}
