import { afterEach, describe, expect, it, vi } from 'vitest';
import { continuesChatGroup } from '../src/client/lib/chatGrouping';
import { readMediaRecents, rememberMedia } from '../src/client/lib/mediaRecents';
import { fetchGiphyPage, resolveGiphyGif, safeGiphyMediaUrl } from '../src/client/lib/giphy';
import { searchEmoji } from '../src/client/lib/emojiSearch';

const message = { id: 'a', sessionId: 'room', senderId: 'alice', name: 'Alex', text: 'Hi', sentAtMs: 1 };
afterEach(() => vi.unstubAllGlobals());

describe('consecutive chat grouping', () => {
	it('groups only adjacent messages from the same known sender and name', () => {
		expect(continuesChatGroup(message, { ...message, id: 'b' })).toBe(true);
		for (const previous of [undefined, { ...message, senderId: undefined }, { ...message, senderId: 'bob' }, { ...message, name: 'Renamed' }, { ...message, sessionId: 'old' }]) {
			expect(continuesChatGroup(previous, message)).toBe(false);
		}
		expect(continuesChatGroup({ ...message, senderId: undefined }, { ...message, senderId: undefined })).toBe(false);
	});
});

describe('media recents', () => {
	it('searches ordinary emoji by mood, subject, or literal glyph', () => {
		expect(searchEmoji('bug')).toContain('🐛');
		expect(searchEmoji('love')).toContain('❤️');
		expect(searchEmoji('🐛')).toEqual(['🐛']);
		expect(searchEmoji('nonexistent')).toEqual([]);
	});
	it('bounds and deduplicates identifiers without saving URLs', () => {
		const entries = new Map<string, string>();
		const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); } };
		for (let i = 0; i < 40; i++) rememberMedia(storage, `giphy:abc${i}`);
		rememberMedia(storage, 'giphy:abc39');
		rememberMedia(storage, 'https://evil.example/a.gif');
		expect(readMediaRecents(storage)).toHaveLength(24);
		expect(readMediaRecents(storage)[0]).toBe('giphy:abc39');
		expect(readMediaRecents(storage).every(id => !id.includes('https'))).toBe(true);
		expect(readMediaRecents({ getItem() { throw Error('blocked'); } })).toEqual([]);
	});
});

describe('direct browser GIPHY integration', () => {
	it('rejects non-provider media and preserves approved URLs exactly', () => {
		for (const url of ['http://media.giphy.com/a.gif', 'https://giphy.com.evil.test/a.gif', 'https://evil.test/a.gif', 'javascript:alert(1)', 'https://user:password@media.giphy.com/a.gif']) expect(safeGiphyMediaUrl(url)).toBe(false);
		expect(safeGiphyMediaUrl('https://media2.giphy.com/media/abc/200.gif?cid=hello')).toBe(true);
	});
	it('searches directly with exact query, rating and bounded pagination', async () => {
		const url = 'https://media2.giphy.com/media/abc/200.gif?cid=hello';
		const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ meta: { status: 200 }, data: [{ id: 'abc', title: 'A little bug', images: { fixed_width: { url } } }], pagination: { total_count: 26, count: 1, offset: 0 } }));
		vi.stubGlobal('fetch', fetcher);
		const page = await fetchGiphyPage('public-key', 'tiny bug', 0, new AbortController().signal);
		const request = new URL(String(fetcher.mock.calls[0][0]));
		expect(request.origin).toBe('https://api.giphy.com');
		expect(request.searchParams.get('q')).toBe('tiny bug');
		expect(request.searchParams.get('rating')).toBe('g');
		expect(page.items).toEqual([{ id: 'giphy:abc', label: 'A little bug', url }]);
		expect(page.nextOffset).toBe(1);
	});
	it('uses trending for blank queries and surfaces provider failures', async () => {
		const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ meta: { status: 200 }, data: [], pagination: { total_count: 0, count: 0, offset: 0 } }));
		vi.stubGlobal('fetch', fetcher);
		expect((await fetchGiphyPage('key', '', 0, new AbortController().signal)).items).toEqual([]);
		expect(String(fetcher.mock.calls[0][0])).toContain('/trending?');
		fetcher.mockImplementation(async () => new Response('', { status: 429 }));
		await expect(fetchGiphyPage('key', 'bug', 0, new AbortController().signal)).rejects.toThrow(/limit/i);
	});
	it('resolves only bounded IDs and never accepts foreign media', async () => {
		const fetcher = vi.fn(async () => Response.json({ meta: { status: 200 }, data: { id: 'abc', title: 'Bug', images: { fixed_width: { url: 'https://evil.test/a.gif' } } } }));
		vi.stubGlobal('fetch', fetcher);
		await expect(resolveGiphyGif('key', 'giphy:abc', new AbortController().signal)).rejects.toThrow();
		await expect(resolveGiphyGif('key', 'giphy:../../evil', new AbortController().signal)).rejects.toThrow();
		expect(fetcher).toHaveBeenCalledTimes(1);
	});
	it('keeps unavailable search tiles in provider order without making them selectable', async () => {
		const item = (id: string, url: string) => ({ id, title: id, rating: 'g', images: { fixed_width: { url } } });
		vi.stubGlobal('fetch', async () => Response.json({ meta: { status: 200 }, data: [item('first', 'https://media.giphy.com/a.gif'), item('bad', 'https://evil.test/a.gif'), item('last', 'https://media.giphy.com/b.gif')], pagination: { total_count: 3 } }));
		const page = await fetchGiphyPage('key', 'bug', 0, new AbortController().signal);
		expect(page.items.map(item => item.url)).toEqual(['https://media.giphy.com/a.gif', '', 'https://media.giphy.com/b.gif']);
	});
	it('rejects restricted get-by-ID content and oversized responses', async () => {
		vi.stubGlobal('fetch', async () => Response.json({ meta: { status: 200 }, data: { id: 'abc', rating: 'r', title: 'Restricted', images: { fixed_width: { url: 'https://media.giphy.com/a.gif' } } } }));
		await expect(resolveGiphyGif('key', 'giphy:abc', new AbortController().signal)).rejects.toThrow();
		vi.stubGlobal('fetch', async () => new Response('x'.repeat(2_000_001)));
		await expect(fetchGiphyPage('key', 'bug', 0, new AbortController().signal)).rejects.toThrow(/large/i);
	});
	it('caps concurrent provider calls at four and removes aborted queued requests', async () => {
		let active = 0;
		let peak = 0;
		const finish: (() => void)[] = [];
		const fetcher = vi.fn(() => new Promise<Response>(resolve => {
			active++;
			peak = Math.max(peak, active);
			finish.push(() => { active--; resolve(Response.json({ meta: { status: 200 }, data: [], pagination: { total_count: 0 } })); });
		}));
		vi.stubGlobal('fetch', fetcher);
		const controllers = Array.from({ length: 8 }, () => new AbortController());
		const settled = Promise.allSettled(controllers.map(controller => fetchGiphyPage('key', 'bug', 0, controller.signal)));
		await expect.poll(() => fetcher.mock.calls.length).toBe(4);
		controllers[5].abort();
		for (const complete of finish.splice(0)) complete();
		await expect.poll(() => fetcher.mock.calls.length).toBe(7);
		for (const complete of finish.splice(0)) complete();
		const results = await settled;
		expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(7);
		expect(peak).toBe(4);
		expect(active).toBe(0);
	});
});
