import { describe, expect, it } from 'vitest';
import * as reactions from '../src/client/lib/emojiSearch';

type Token = { start: number; end: number; query: string };
const api = reactions as unknown as {
	getEmojiQuery: (text: string, start: number, end?: number) => Token | null;
	replaceEmojiQuery: (text: string, token: Token, value: string) => { text: string; caret: number };
	searchReactions: (query: string, limit?: number) => { id: string; value: string; label: string; url?: string }[];
};

describe('caret-aware emoji autocomplete', () => {
	it('recognizes a colon followed by a letter at the caret, including in the middle of a message', () => {
		expect(api.getEmojiQuery).toBeTypeOf('function');
		expect(api.getEmojiQuery('hello :bu later', 9)).toEqual({ start: 6, end: 9, query: 'bu' });
		expect(api.getEmojiQuery(':tiny_ra', 8)).toEqual({ start: 0, end: 8, query: 'tiny_ra' });
	});
	it('does not activate for URLs, times, complete tokens, noncollapsed selections, or a bare colon', () => {
		expect(api.getEmojiQuery).toBeTypeOf('function');
		for (const text of ['https://cat', '12:30', ':', ':bug:', 'word:cat', ':1']) {
			expect(api.getEmojiQuery(text, text.length), text).toBeNull();
		}
		expect(api.getEmojiQuery(':bug', 2, 4)).toBeNull();
	});
	it('replaces the whole token around the caret without dropping adjacent text or emoji', () => {
		expect(api.getEmojiQuery).toBeTypeOf('function');
		expect(api.replaceEmojiQuery).toBeTypeOf('function');
		const text = '😀 :bug: next';
		const token = api.getEmojiQuery(text, 6)!;
		expect(token).toEqual({ start: 3, end: 8, query: 'bu' });
		expect(api.replaceEmojiQuery(text, token, ':twemoji_bug:')).toEqual({ text: '😀 :twemoji_bug: next', caret: 16 });
	});
	it('searches Unicode and illustrated packs together with a bounded result count', () => {
		expect(api.searchReactions).toBeTypeOf('function');
		const results = api.searchReactions('bug', 50);
		expect(results.some(result => result.value === '🐛')).toBe(true);
		expect(results.some(result => result.value === ':bug:' && result.url)).toBe(true);
		expect(results.some(result => result.value === ':twemoji_bug:' && result.url)).toBe(true);
		expect(api.searchReactions('bug', 2)).toHaveLength(2);
		expect(api.searchReactions('no_such_emoji_987654')).toEqual([]);
	});
	it('finds ordinary Unicode reactions by their credited artwork names as well as broad moods', () => {
		expect(api.searchReactions).toBeTypeOf('function');
		expect(api.searchReactions('cat', 200).some(result => result.value === '🐱')).toBe(true);
	});
});
