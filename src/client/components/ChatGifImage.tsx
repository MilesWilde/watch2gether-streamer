import { useEffect, useState } from 'react';
import { RotateCw } from 'lucide-react';

export function ChatGifImage({ url, label, onRetry }: { url: string; label: string; onRetry?: () => void }) {
	const [failed, setFailed] = useState(false);
	useEffect(() => setFailed(false), [url]);
	return <span className="chat-gif-image">
		{!failed && <img src={url} alt={label} loading="lazy" onError={() => setFailed(true)} />}
		<span className={failed ? 'gif-label' : 'gif-label motion-fallback'}>{label}</span>
		{failed && onRetry && <button type="button" className="icon-button secondary-button gif-retry" title="Retry GIF" aria-label="Retry GIF" onClick={onRetry}><RotateCw size={16} /></button>}
	</span>;
}
