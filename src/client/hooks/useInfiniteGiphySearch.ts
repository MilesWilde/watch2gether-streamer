import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchGiphyPage, getGiphyKey } from '../lib/giphy';
import type { ChatGif } from '../../stream/chat-media';

type SearchState = {
	query: string;
	key: string;
	items: ChatGif[];
	loading: boolean;
	loadingMore: boolean;
	error: string | null;
	nextOffset: number | null;
};
type Session = {
	state: SearchState;
	completed: boolean;
	active: boolean;
	pending: { controller: AbortController; timer?: ReturnType<typeof setTimeout> } | null;
};

const MAX_ITEMS = 2400;
const emptyState = (query: string, key: string): SearchState => ({
	query, key, items: [], loading: false, loadingMore: false, error: null, nextOffset: null,
});

export function useInfiniteGiphySearch(query: string, enabled: boolean) {
	const key = getGiphyKey();
	const [state, setState] = useState<SearchState>(() => emptyState(query, key));
	// Only the current query's pages live here; closing suspends requests, not results.
	const current = useRef<Session | null>(null);
	const start = useCallback((session: Session, debounce: boolean) => {
		if (!session.active || session.pending || current.current !== session) return;
		const offset = session.completed ? session.state.nextOffset : 0;
		const maxOffset = session.state.query ? 4999 : 499;
		if (offset === null || !Number.isInteger(offset) || offset < 0 || offset > maxOffset || session.state.items.length >= MAX_ITEMS) return;

		const request = { controller: new AbortController(), timer: undefined as ReturnType<typeof setTimeout> | undefined };
		session.pending = request;
		session.state = { ...session.state, loading: !session.completed, loadingMore: session.completed, error: null };
		setState(session.state);
		const active = () => session.active && current.current === session && session.pending === request && !request.controller.signal.aborted;
		const fetchPage = async () => {
			if (!active()) return;
			try {
				const page = await fetchGiphyPage(session.state.key, session.state.query, offset, request.controller.signal);
				if (!active()) return;
				const items = [...session.state.items, ...page.items.slice(0, MAX_ITEMS - session.state.items.length)];
				const next = page.nextOffset;
				const nextOffset = page.items.length > 0 && items.length < MAX_ITEMS && next !== null &&
					Number.isInteger(next) && next > offset && next <= maxOffset ? next : null;
				session.completed = true;
				session.pending = null;
				session.state = { ...session.state, items, nextOffset, loading: false, loadingMore: false, error: null };
				setState(session.state);
			} catch (error: unknown) {
				if (!active()) return;
				session.pending = null;
				session.state = {
					...session.state, loading: false, loadingMore: false,
					error: error instanceof Error ? error.message : 'GIF service unavailable.',
				};
				setState(session.state);
			}
		};
		if (debounce) request.timer = setTimeout(() => { void fetchPage(); }, 350);
		else void fetchPage();
	}, []);

	useEffect(() => {
		let session = current.current;
		if (!session || session.state.query !== query || session.state.key !== key) {
			session = { state: emptyState(query, key), completed: false, active: false, pending: null };
			current.current = session;
		}
		session.active = enabled && !!key;
		if (session.active && !session.completed) start(session, true);
		else setState(session.state);
		return () => {
			session.active = false;
			const pending = session.pending;
			session.pending = null;
			if (pending) {
				clearTimeout(pending.timer);
				pending.controller.abort();
			}
			session.state = { ...session.state, loading: false, loadingMore: false };
		};
	}, [query, key, enabled, start]);

	const loadMore = useCallback(() => {
		const session = current.current;
		if (!enabled || !key || !session || session.state.query !== query || session.state.key !== key) return;
		start(session, !session.completed);
	}, [query, key, enabled, start]);
	const retry = useCallback(() => {
		if (current.current?.state.error !== null) loadMore();
	}, [loadMore]);

	// Mask old results during render, before the new query's effect can run.
	const visible = state.query === query && state.key === key ? state : emptyState(query, key);
	const loading = enabled && !!key && (visible !== state || visible.loading || current.current === null);
	return {
		items: visible.items,
		loading,
		loadingMore: enabled && !!key && visible.loadingMore,
		error: visible.error,
		nextOffset: visible.nextOffset,
		configured: !!key,
		loadMore,
		retry,
	};
}
