import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGiphySearch } from '../src/client/hooks/useGiphySearch';
import type { ChatGif } from '../src/stream/chat-media';

const hooks = vi.hoisted(() => ({
	slots: [] as { value?: unknown; deps?: readonly unknown[]; cleanup?: void | (() => void) }[],
	index: 0,
	dirty: false,
	effects: [] as (() => void)[],
}));
const giphy = vi.hoisted(() => ({
	fetchGiphyPage: vi.fn<typeof import('../src/client/lib/giphy').fetchGiphyPage>(),
}));

vi.mock('../src/client/lib/giphy', () => ({
	getGiphyKey: () => 'test-key',
	fetchGiphyPage: giphy.fetchGiphyPage,
}));

// Run real hook callbacks and effect cleanup without a DOM or network dependency.
vi.mock('react', async importOriginal => ({
	...await importOriginal<typeof import('react')>(),
	useState: (initial: unknown) => {
		const slot = hooks.slots[hooks.index++] ??= { value: typeof initial === 'function' ? initial() : initial };
		return [slot.value, (next: unknown) => {
			const value = typeof next === 'function' ? next(slot.value) : next;
			if (!Object.is(value, slot.value)) {
				slot.value = value;
				hooks.dirty = true;
			}
		}];
	},
	useEffect: (callback: () => void | (() => void), deps: readonly unknown[]) => {
		const slot = hooks.slots[hooks.index++] ??= {};
		if (!slot.deps || deps.length !== slot.deps.length || deps.some((dep, index) => !Object.is(dep, slot.deps?.[index]))) {
			slot.deps = deps;
			hooks.effects.push(() => {
				slot.cleanup?.();
				slot.cleanup = callback();
			});
		}
	},
}));

type Page = Awaited<ReturnType<typeof import('../src/client/lib/giphy').fetchGiphyPage>>;
type PendingPage = { resolve: (page: Page) => void; reject: (error: unknown) => void };
const gif = (id: string): ChatGif => ({ id: `giphy:${id}`, label: id, url: `https://media.giphy.com/media/${id}/200w.gif` });

describe('real useGiphySearch lifecycle', () => {
	let query: string;
	let enabled: boolean;
	let offset: number;
	let retry: number;
	let pending: PendingPage[];

	function renderOnce() {
		hooks.index = 0;
		hooks.dirty = false;
		const result = useGiphySearch(query, enabled, offset, retry);
		for (const effect of hooks.effects.splice(0)) effect();
		return result;
	}
	function render(): ReturnType<typeof useGiphySearch> {
		for (let i = 0; i < 10; i++) {
			const result = renderOnce();
			if (!hooks.dirty) return result;
		}
		throw Error('Hook did not settle after ten renders');
	}
	function unmount() {
		for (const slot of hooks.slots) {
			slot.cleanup?.();
			slot.cleanup = undefined;
		}
	}
	async function advance(ms: number) {
		await vi.advanceTimersByTimeAsync(ms);
	}

	beforeEach(() => {
		vi.useFakeTimers();
		hooks.slots = [];
		hooks.effects = [];
		hooks.index = 0;
		hooks.dirty = false;
		query = 'happy';
		enabled = true;
		offset = 0;
		retry = 0;
		pending = [];
		giphy.fetchGiphyPage.mockReset();
		giphy.fetchGiphyPage.mockImplementation(() => new Promise<Page>((resolve, reject) => {
			pending.push({ resolve, reject });
		}));
	});
	afterEach(() => {
		unmount();
		vi.useRealTimers();
	});

	it('debounces requests for exactly 350ms and preserves the returned page', async () => {
		expect(render()).toMatchObject({ configured: true, loading: true, items: [], error: null });
		await advance(349);
		expect(giphy.fetchGiphyPage).not.toHaveBeenCalled();
		await advance(1);
		expect(giphy.fetchGiphyPage).toHaveBeenCalledExactlyOnceWith('test-key', 'happy', 0, expect.any(AbortSignal));
		const page = { items: [gif('Happy')], nextOffset: 24 };
		pending[0].resolve(page);
		await advance(0);
		expect(render()).toEqual({ ...page, configured: true, loading: false, error: null });
	});

	it('restarts the debounce when the query changes before fetching', async () => {
		render();
		await advance(200);
		query = 'cozy';
		render();
		await advance(349);
		expect(giphy.fetchGiphyPage).not.toHaveBeenCalled();
		await advance(1);
		expect(giphy.fetchGiphyPage).toHaveBeenCalledExactlyOnceWith('test-key', 'cozy', 0, expect.any(AbortSignal));
	});

	it('aborts the prior query and ignores its resolution even after the current query succeeds', async () => {
		render();
		await advance(350);
		const priorSignal = giphy.fetchGiphyPage.mock.calls[0][3];
		query = 'cozy';
		expect(render()).toMatchObject({ items: [], loading: true, error: null });
		expect(priorSignal.aborted).toBe(true);
		await advance(350);
		const current = { items: [gif('Cozy')], nextOffset: null };
		pending[1].resolve(current);
		await advance(0);
		expect(render()).toMatchObject({ ...current, loading: false, error: null });
		pending[0].resolve({ items: [gif('Stale')], nextOffset: 24 });
		await advance(0);
		expect(render()).toMatchObject({ ...current, loading: false, error: null });
	});

	it('ignores a stale rejection while the replacement query is loading', async () => {
		render();
		await advance(350);
		query = 'cozy';
		render();
		pending[0].reject(Error('Old query failed'));
		await advance(0);
		expect(render()).toMatchObject({ items: [], loading: true, error: null });
	});

	it('cancels the debounce when the source is disabled and fetches again when enabled', async () => {
		enabled = false;
		expect(render()).toMatchObject({ items: [], loading: false });
		await advance(1000);
		expect(giphy.fetchGiphyPage).not.toHaveBeenCalled();
		enabled = true;
		render();
		await advance(349);
		enabled = false;
		render();
		expect(vi.getTimerCount()).toBe(0);
		await advance(1000);
		expect(giphy.fetchGiphyPage).not.toHaveBeenCalled();
		enabled = true;
		render();
		await advance(350);
		expect(giphy.fetchGiphyPage).toHaveBeenCalledTimes(1);
	});

	it('aborts an in-flight request on source disable and ignores its late resolution', async () => {
		render();
		await advance(350);
		const signal = giphy.fetchGiphyPage.mock.calls[0][3];
		enabled = false;
		const disabled = render();
		expect(signal.aborted).toBe(true);
		pending[0].resolve({ items: [gif('Late')], nextOffset: 24 });
		await advance(1000);
		expect(render()).toEqual(disabled);
		expect(giphy.fetchGiphyPage).toHaveBeenCalledTimes(1);
	});

	it('cleans up the timer and request on unmount without accepting late results', async () => {
		render();
		await advance(350);
		const signal = giphy.fetchGiphyPage.mock.calls[0][3];
		unmount();
		expect(signal.aborted).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
		hooks.dirty = false;
		pending[0].resolve({ items: [gif('Unmounted')], nextOffset: null });
		await advance(1000);
		expect(hooks.dirty).toBe(false);
		expect(giphy.fetchGiphyPage).toHaveBeenCalledTimes(1);
	});

	it('fetches an empty query rather than substituting local results', async () => {
		query = '';
		render();
		await advance(350);
		expect(giphy.fetchGiphyPage).toHaveBeenCalledExactlyOnceWith('test-key', '', 0, expect.any(AbortSignal));
		pending[0].resolve({ items: [gif('Trending')], nextOffset: null });
		await advance(0);
		expect(render()).toMatchObject({ items: [gif('Trending')], loading: false, error: null });
	});

	it('exposes failures and clears the error while a retry is pending', async () => {
		render();
		await advance(350);
		pending[0].reject(Error('GIF service unavailable. Please retry.'));
		await advance(0);
		expect(render()).toMatchObject({ items: [], loading: false, error: 'GIF service unavailable. Please retry.', nextOffset: null });
		retry++;
		expect(render()).toMatchObject({ items: [], loading: true, error: null, nextOffset: null });
		expect(giphy.fetchGiphyPage.mock.calls[0][3].aborted).toBe(true);
		await advance(349);
		expect(giphy.fetchGiphyPage).toHaveBeenCalledTimes(1);
		await advance(1);
		pending[1].resolve({ items: [gif('Recovered')], nextOffset: null });
		await advance(0);
		expect(render()).toMatchObject({ items: [gif('Recovered')], loading: false, error: null });
	});

	it('requests a new page at the selected offset and replaces the prior page', async () => {
		render();
		await advance(350);
		pending[0].resolve({ items: [gif('First')], nextOffset: 24 });
		await advance(0);
		render();
		offset = 24;
		expect(render()).toMatchObject({ items: [], loading: true, nextOffset: null });
		await advance(350);
		expect(giphy.fetchGiphyPage).toHaveBeenLastCalledWith('test-key', 'happy', 24, expect.any(AbortSignal));
		pending[1].resolve({ items: [gif('Second')], nextOffset: 48 });
		await advance(0);
		expect(render()).toMatchObject({ items: [gif('Second')], loading: false, nextOffset: 48 });
	});

	it('does not expose selectable old results on the first render of a changed query', async () => {
		render();
		await advance(350);
		pending[0].resolve({ items: [gif('Old')], nextOffset: 24 });
		await advance(0);
		expect(render()).toMatchObject({ items: [gif('Old')], loading: false });
		query = 'new query';
		// The picker makes items selectable whenever neither loading nor error is set.
		const changed = renderOnce();
		const selectable = changed.loading || changed.error ? [] : changed.items;
		expect(selectable).toEqual([]);
	});
});
