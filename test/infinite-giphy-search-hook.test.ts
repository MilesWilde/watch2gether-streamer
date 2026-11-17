import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useInfiniteGiphySearch } from '../src/client/hooks/useInfiniteGiphySearch';
import type { ChatGif } from '../src/stream/chat-media';

const hooks = vi.hoisted(() => ({
	slots: [] as { value?: unknown; deps?: readonly unknown[]; cleanup?: void | (() => void) }[],
	index: 0,
	dirty: false,
	effects: [] as (() => void)[],
}));
const giphy = vi.hoisted(() => ({
	key: 'test-key',
	fetchGiphyPage: vi.fn<typeof import('../src/client/lib/giphy').fetchGiphyPage>(),
}));

vi.mock('../src/client/lib/giphy', () => ({
	getGiphyKey: () => giphy.key,
	fetchGiphyPage: giphy.fetchGiphyPage,
}));

// Run the real hook lifecycle deterministically without a DOM or network.
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
	useRef: (initial: unknown) => {
		const slot = hooks.slots[hooks.index++] ??= { value: { current: initial } };
		return slot.value;
	},
	useCallback: (callback: unknown, deps: readonly unknown[]) => {
		const slot = hooks.slots[hooks.index++] ??= {};
		if (!slot.deps || deps.some((dep, index) => !Object.is(dep, slot.deps?.[index])) || deps.length !== slot.deps.length) {
			slot.deps = deps;
			slot.value = callback;
		}
		return slot.value;
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

describe('useInfiniteGiphySearch', () => {
	let query: string;
	let enabled: boolean;
	let pending: PendingPage[];

	function renderOnce() {
		hooks.index = 0;
		hooks.dirty = false;
		const result = useInfiniteGiphySearch(query, enabled);
		for (const effect of hooks.effects.splice(0)) effect();
		return result;
	}
	function render(): ReturnType<typeof useInfiniteGiphySearch> {
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
	async function advance(ms = 0) {
		await vi.advanceTimersByTimeAsync(ms);
	}
	async function complete(index: number, items: ChatGif[], nextOffset: number | null) {
		pending[index].resolve({ items, nextOffset });
		await advance();
		return render();
	}
	async function firstPage(items = [gif('First')], nextOffset: number | null = 24) {
		render();
		await advance(350);
		return complete(0, items, nextOffset);
	}

	beforeEach(() => {
		vi.useFakeTimers();
		hooks.slots = [];
		hooks.effects = [];
		hooks.index = 0;
		hooks.dirty = false;
		query = 'happy';
		enabled = true;
		pending = [];
		giphy.key = 'test-key';
		giphy.fetchGiphyPage.mockReset();
		giphy.fetchGiphyPage.mockImplementation(() => new Promise<Page>((resolve, reject) => pending.push({ resolve, reject })));
	});
	afterEach(() => {
		unmount();
		vi.useRealTimers();
	});

	it('debounces the exact query for 350ms, restarting on query edits', async () => {
		expect(render()).toMatchObject({ items: [], loading: true, loadingMore: false, configured: true, error: null });
		await advance(200);
		query = ' cozy ';
		render();
		await advance(349);
		expect(giphy.fetchGiphyPage).not.toHaveBeenCalled();
		await advance(1);
		expect(giphy.fetchGiphyPage).toHaveBeenCalledExactlyOnceWith('test-key', ' cozy ', 0, expect.any(AbortSignal));
		expect(await complete(0, [gif('Cozy')], 24)).toMatchObject({ items: [gif('Cozy')], loading: false, nextOffset: 24 });
	});

	it('appends every provider tile in order, including duplicate IDs and unavailable tiles', async () => {
		const unavailable = { id: 'unavailable-0', label: 'GIF unavailable', url: '' };
		const first = [gif('Same'), unavailable];
		const result = await firstPage(first, 37);
		result.loadMore();
		expect(render()).toMatchObject({ items: first, loading: false, loadingMore: true, nextOffset: 37 });
		expect(giphy.fetchGiphyPage).toHaveBeenLastCalledWith('test-key', 'happy', 37, expect.any(AbortSignal));
		const second = [unavailable, gif('Same'), gif('Last')];
		expect(await complete(1, second, 81)).toMatchObject({ items: [...first, ...second], loadingMore: false, nextOffset: 81 });
	});

	it('retains completed pages, their array identity and cursor across close/reopen without refetching', async () => {
		const first = await firstPage();
		first.loadMore();
		const second = await complete(1, [gif('Second')], 48);
		enabled = false;
		expect(render()).toMatchObject({ items: second.items, nextOffset: 48, loading: false, loadingMore: false });
		enabled = true;
		expect(render().items).toBe(second.items);
		await advance(1000);
		expect(giphy.fetchGiphyPage).toHaveBeenCalledTimes(2);
		render().loadMore();
		expect(giphy.fetchGiphyPage).toHaveBeenLastCalledWith('test-key', 'happy', 48, expect.any(AbortSignal));
	});

	it('cancels a debounce on close and retries an incomplete initial page on reopen', async () => {
		render();
		await advance(349);
		enabled = false;
		expect(render()).toMatchObject({ loading: false, loadingMore: false });
		expect(vi.getTimerCount()).toBe(0);
		await advance(1000);
		expect(giphy.fetchGiphyPage).not.toHaveBeenCalled();
		enabled = true;
		render();
		await advance(350);
		const signal = giphy.fetchGiphyPage.mock.calls[0][3];
		enabled = false;
		render();
		expect(signal.aborted).toBe(true);
		enabled = true;
		render();
		await advance(350);
		expect(giphy.fetchGiphyPage).toHaveBeenCalledTimes(2);
		await complete(1, [gif('Current')], 24);
		expect(await complete(0, [gif('Late')], null)).toMatchObject({ items: [gif('Current')], nextOffset: 24 });
	});

	it('aborts an interrupted later page and retries its cursor only when loadMore is called', async () => {
		(await firstPage()).loadMore();
		const signal = giphy.fetchGiphyPage.mock.calls[1][3];
		enabled = false;
		expect(render()).toMatchObject({ items: [gif('First')], nextOffset: 24, loadingMore: false });
		expect(signal.aborted).toBe(true);
		enabled = true;
		render();
		await advance(1000);
		expect(giphy.fetchGiphyPage).toHaveBeenCalledTimes(2);
		render().loadMore();
		expect(giphy.fetchGiphyPage).toHaveBeenLastCalledWith('test-key', 'happy', 24, expect.any(AbortSignal));
		await complete(2, [gif('Second')], 48);
		pending[1].reject(Error('Stale failure'));
		await advance();
		expect(render()).toMatchObject({ items: [gif('First'), gif('Second')], nextOffset: 48, error: null });
	});

	it('clears visible items on the first changed-query render and ignores old responses', async () => {
		(await firstPage()).loadMore();
		query = 'new query';
		expect(renderOnce()).toMatchObject({ items: [], nextOffset: null, loading: true, error: null });
		expect(giphy.fetchGiphyPage.mock.calls[1][3].aborted).toBe(true);
		render();
		await advance(350);
		await complete(2, [gif('New')], 24);
		expect(await complete(1, [gif('Stale')], 48)).toMatchObject({ items: [gif('New')], nextOffset: 24 });
	});

	it('resets a query changed while closed, then fetches only its new initial page', async () => {
		await firstPage();
		enabled = false;
		render();
		query = '';
		expect(renderOnce()).toMatchObject({ items: [], loading: false, nextOffset: null });
		render();
		await advance(1000);
		expect(giphy.fetchGiphyPage).toHaveBeenCalledTimes(1);
		enabled = true;
		render();
		await advance(350);
		expect(giphy.fetchGiphyPage).toHaveBeenLastCalledWith('test-key', '', 0, expect.any(AbortSignal));
	});

	it('guards concurrent loadMore/retry calls synchronously, even before a rerender', async () => {
		const initial = render();
		initial.loadMore();
		initial.retry();
		await advance(350);
		expect(giphy.fetchGiphyPage).toHaveBeenCalledTimes(1);
		const result = await complete(0, [gif('First')], 24);
		result.loadMore();
		result.loadMore();
		result.retry();
		expect(giphy.fetchGiphyPage).toHaveBeenCalledTimes(2);
		await complete(1, [gif('Second')], null);
		render().loadMore();
		render().retry();
		expect(giphy.fetchGiphyPage).toHaveBeenCalledTimes(2);
	});

	it('keeps previous pages after errors and retries exactly the failed cursor', async () => {
		(await firstPage()).loadMore();
		pending[1].reject(Error('Rate limited'));
		await advance();
		const failed = render();
		expect(failed).toMatchObject({ items: [gif('First')], loading: false, loadingMore: false, error: 'Rate limited', nextOffset: 24 });
		enabled = false;
		render();
		enabled = true;
		render();
		await advance(1000);
		expect(giphy.fetchGiphyPage).toHaveBeenCalledTimes(2);
		render().retry();
		expect(render()).toMatchObject({ items: [gif('First')], loadingMore: true, error: null });
		expect(giphy.fetchGiphyPage).toHaveBeenLastCalledWith('test-key', 'happy', 24, expect.any(AbortSignal));
		expect(await complete(2, [gif('Recovered')], 48)).toMatchObject({ items: [gif('First'), gif('Recovered')], error: null });
	});

	it('retries initial errors explicitly and on reopen, with a safe non-Error fallback', async () => {
		render();
		await advance(350);
		pending[0].reject('offline');
		await advance();
		expect(render()).toMatchObject({ loading: false, error: 'GIF service unavailable.' });
		render().retry();
		await advance(350);
		expect(giphy.fetchGiphyPage.mock.calls[1][2]).toBe(0);
		pending[1].reject(Error('Still offline'));
		await advance();
		enabled = false;
		render();
		enabled = true;
		expect(render()).toMatchObject({ loading: true, error: null });
		await advance(350);
		expect(await complete(2, [gif('Recovered')], null)).toMatchObject({ items: [gif('Recovered')], error: null });
	});

	it.each([0, -1, 24, 12, 5000, 24.5, NaN, Infinity])('terminates nonadvancing or invalid next offset %s', async nextOffset => {
		(await firstPage()).loadMore();
		expect(await complete(1, [gif('Second')], nextOffset)).toMatchObject({ items: [gif('First'), gif('Second')], nextOffset: null });
		render().loadMore();
		await advance(1000);
		expect(giphy.fetchGiphyPage).toHaveBeenCalledTimes(2);
	});

	it.each([{ query: 'happy', limit: 4999 }, { query: '', limit: 499 }])('honors provider offset limits for "$query"', async ({ query: value, limit }) => {
		query = value;
		(await firstPage([gif('First')], limit)).loadMore();
		expect(giphy.fetchGiphyPage.mock.calls[1][2]).toBe(limit);
		expect(await complete(1, [gif('Last')], limit + 1)).toMatchObject({ nextOffset: null });
	});

	it('rejects a trending cursor that the provider would silently clamp', async () => {
		query = '';
		expect(await firstPage([gif('First')], 500)).toMatchObject({ nextOffset: null });
		render().loadMore();
		expect(giphy.fetchGiphyPage).toHaveBeenCalledTimes(1);
	});

	it('stops on an empty response even if the provider supplies an advancing cursor', async () => {
		(await firstPage()).loadMore();
		expect(await complete(1, [], 48)).toMatchObject({ items: [gif('First')], nextOffset: null, loadingMore: false });
		for (let i = 0; i < 5; i++) render().loadMore();
		await advance(1000);
		expect(giphy.fetchGiphyPage).toHaveBeenCalledTimes(2);
	});

	it('caps stored items at 2400 without evicting earlier results', async () => {
		let result = await firstPage(Array.from({ length: 24 }, (_, i) => gif(`0x${i}`)), 24);
		for (let page = 1; page < 100; page++) {
			result.loadMore();
			result = await complete(page, Array.from({ length: 24 }, (_, i) => gif(`${page}x${i}`)), (page + 1) * 24);
		}
		expect(result.items).toHaveLength(2400);
		expect(result.items[0]).toEqual(gif('0x0'));
		expect(result.items[2399]).toEqual(gif('99x23'));
		expect(result.nextOffset).toBeNull();
		result.loadMore();
		expect(giphy.fetchGiphyPage).toHaveBeenCalledTimes(100);
	});

	it('disables fetching and callbacks without configuration', async () => {
		giphy.key = '';
		const result = render();
		expect(result).toMatchObject({ configured: false, items: [], loading: false, loadingMore: false, nextOffset: null });
		result.loadMore();
		result.retry();
		await advance(1000);
		expect(giphy.fetchGiphyPage).not.toHaveBeenCalled();
	});

	it('guards disabled and stale-query callbacks', async () => {
		const old = await firstPage();
		enabled = false;
		const closed = render();
		old.loadMore();
		closed.retry();
		enabled = true;
		query = 'new';
		render();
		old.loadMore();
		await advance(350);
		expect(giphy.fetchGiphyPage).toHaveBeenCalledTimes(2);
		expect(giphy.fetchGiphyPage.mock.calls[1][1]).toBe('new');
	});

	it('aborts on unmount and rejects late results without scheduling updates', async () => {
		render();
		await advance(350);
		unmount();
		expect(giphy.fetchGiphyPage.mock.calls[0][3].aborted).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
		hooks.dirty = false;
		pending[0].resolve({ items: [gif('Late')], nextOffset: 24 });
		await advance(1000);
		expect(hooks.dirty).toBe(false);
	});
});
