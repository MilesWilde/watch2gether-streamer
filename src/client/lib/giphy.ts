import type { ChatGif } from '../../stream/chat-media';

export function getGiphyKey(): string {
	return (import.meta as ImportMeta & { env?: { VITE_GIPHY_API_KEY?: string } }).env?.VITE_GIPHY_API_KEY?.trim() ?? '';
}

export function safeGiphyMediaUrl(value: unknown): value is string {
	if (typeof value !== 'string' || value.length > 2048) return false;
	try {
		const url = new URL(value);
		return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
			/^media[0-4]?\.giphy\.com$/.test(url.hostname);
	} catch { return false; }
}

function parseGif(value: unknown): ChatGif {
	if (!value || typeof value !== 'object') throw Error('GIF unavailable.');
	const gif = value as { id?: unknown; title?: unknown; rating?: unknown; images?: { fixed_width?: { url?: unknown } } };
	if ((gif.rating !== undefined && gif.rating !== 'g') || typeof gif.id !== 'string' || !/^[A-Za-z0-9]{1,64}$/.test(gif.id) || !safeGiphyMediaUrl(gif.images?.fixed_width?.url)) throw Error('GIF unavailable.');
	return { id: `giphy:${gif.id}`, label: typeof gif.title === 'string' ? gif.title.slice(0, 160) || 'GIF' : 'GIF', url: gif.images.fixed_width.url };
}

let activeRequests = 0;
const waitingRequests = new Set<() => void>();

async function acquireRequest(signal: AbortSignal): Promise<() => void> {
	while (activeRequests >= 4) {
		await new Promise<void>((resolve, reject) => {
			const cleanup = () => { waitingRequests.delete(ready); signal.removeEventListener('abort', abort); };
			const ready = () => { cleanup(); resolve(); };
			const abort = () => { cleanup(); reject(signal.reason); };
			waitingRequests.add(ready);
			signal.addEventListener('abort', abort, { once: true });
			if (signal.aborted) abort();
		});
	}
	signal.throwIfAborted();
	activeRequests++;
	return () => { activeRequests--; waitingRequests.values().next().value?.(); };
}

async function readProviderResponse(response: Response): Promise<unknown> {
	if (!response.body) throw Error('Empty GIF response.');
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let text = '';
	let bytes = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > 2_000_000) { await reader.cancel(); throw Error('GIF response is too large.'); }
			text += decoder.decode(value, { stream: true });
		}
		return JSON.parse(text + decoder.decode());
	} finally { reader.releaseLock(); }
}

async function requestGiphy(path: string, key: string, params: Record<string, string>, signal: AbortSignal) {
	if (!key) throw Error('Live GIF search is not configured.');
	const url = new URL(`https://api.giphy.com/v1/gifs/${path}`);
	url.search = new URLSearchParams({ api_key: key, ...params }).toString();
	const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
	const release = await acquireRequest(boundedSignal);
	try {
		const response = await fetch(url, { signal: boundedSignal, credentials: 'omit', cache: 'no-store' });
		if (!response.ok) throw Error(response.status === 429 ? 'GIF search limit reached. Try again later.' : 'GIF service unavailable. Please retry.');
		const body = await readProviderResponse(response) as { meta?: { status?: number }; data?: unknown; pagination?: { total_count?: number; count?: number; offset?: number } };
		if (!body || body.meta?.status !== 200) throw Error('GIF service unavailable. Please retry.');
		return body;
	} finally { release(); }
}

export async function fetchGiphyPage(key: string, query: string, offset: number, signal: AbortSignal): Promise<{ items: ChatGif[]; nextOffset: number | null }> {
	const boundedOffset = Math.min(query ? 4999 : 499, Math.max(0, Math.floor(offset)));
	const body = await requestGiphy(query ? 'search' : 'trending', key, {
		...(query ? { q: query.slice(0, 50) } : {}), rating: 'g', limit: '24', offset: String(boundedOffset),
	}, signal);
	if (!Array.isArray(body.data) || body.data.length > 24) throw Error('Invalid GIF results.');
	// Unavailable tiles retain their position, without allowing unsafe media to be selected.
	const items = body.data.map((value, index) => {
		try { return parseGif(value); } catch { return { id: `unavailable-${index}`, label: 'GIF unavailable', url: '' }; }
	});
	const next = boundedOffset + items.length;
	const total = body.pagination?.total_count ?? next;
	return { items, nextOffset: items.length > 0 && next < total && next <= (query ? 4999 : 499) ? next : null };
}

export async function resolveGiphyGif(key: string, id: string, signal: AbortSignal): Promise<ChatGif> {
	if (!/^giphy:[A-Za-z0-9]{1,64}$/.test(id)) throw Error('Invalid GIF identifier.');
	const body = await requestGiphy(id.slice(6), key, {}, signal);
	if (!body.data || typeof body.data !== 'object' || !('rating' in body.data) || body.data.rating !== 'g') throw Error('GIF unavailable.');
	const gif = parseGif(body.data);
	if (gif.id !== id) throw Error('GIF unavailable.');
	return gif;
}
