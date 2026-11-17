import { useEffect, useState } from 'react';
import { fetchGiphyPage, getGiphyKey } from '../lib/giphy';
import type { ChatGif } from '../../stream/chat-media';

export function useGiphySearch(query: string, enabled: boolean, offset: number, retry: number) {
	const [state, setState] = useState<{ request: string; items: ChatGif[]; loading: boolean; error: string | null; nextOffset: number | null }>({ request: '', items: [], loading: false, error: null, nextOffset: null });
	const key = getGiphyKey();
	const request = JSON.stringify([query, key, offset, retry]);
	useEffect(() => {
		if (!enabled || !key) return;
		let active = true;
		const controller = new AbortController();
		setState({ request, items: [], loading: true, error: null, nextOffset: null });
		const timer = setTimeout(() => {
			fetchGiphyPage(key, query, offset, controller.signal).then(page => {
				if (active) setState({ request, ...page, loading: false, error: null });
			}).catch((error: unknown) => {
				if (active) setState({ request, items: [], loading: false, error: error instanceof Error ? error.message : 'GIF service unavailable.', nextOffset: null });
			});
		}, 350);
		return () => { active = false; clearTimeout(timer); controller.abort(); };
	}, [enabled, key, query, offset, retry, request]);
	if (!enabled || !key || state.request !== request) return { items: [], loading: enabled && !!key, error: null, nextOffset: null, configured: !!key };
	const { request: _request, ...result } = state;
	return { ...result, configured: !!key };
}
