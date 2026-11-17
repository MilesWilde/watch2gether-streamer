import { describe, expect, it } from "vitest";
import { CHAT_GIFS, CHAT_GIF_PACK, LEGACY_CHAT_GIFS, getChatGif, searchChatMedia } from "../src/stream/chat-media";
import sources from "../public/GIF-SOURCES.json";

const gifFiles = import.meta.glob("../public/gifs/noto-animated/*.gif", { query: "?url", import: "default", eager: true });
const creditFiles = import.meta.glob<string>("../public/gifs/noto-animated/*.txt", { query: "?raw", import: "default", eager: true });

const original = [
	["cat-pats", "KztT2c4u8mYYUiMKdJ"], ["fox-love", "s6Ru4Jpl7EJkjyjq75"],
	["tiny-chick", "YR0IBYGICPmzehJ6um"], ["kitty", "3o8dFsCL0z8cgjoWzK"],
	["happy-wave", "O0VBge9U7f8j21UqNj"], ["summer-cat", "TEBseeS5mJCje0NKs9"],
	["love-you", "ViSpZL4Nz52k0fiowe"], ["music-frog", "6FxJBpNTBgWdJCXKD4"],
	["happy-heart", "D4xeiRd5Kbgds50E3r"], ["dumpling", "qZy6R9ZfLr4BLthMh5"],
	["melody", "ts0Uy1zVJTvCo"], ["tea-time", "lS7l4HG3tsAG0k8MoJ"],
	["bongo-party", "mn9Mc2ocSfTGTlp9XT"], ["big-hug", "jXSMCVV0kSHr4bqxZM"],
	["squirrel-woohoo", "fl4MZmeXzPfrYh4FeR"], ["kermit-panic", "h5JpPmYQsan1QqTeUE"],
	["skeleton-cheer", "dHkua6h6uLZ0UhE4Ep"], ["keyboard-cat", "JIX9t2j0ZTN9S"],
	["judging-cat", "mlvseq9yvZhba"], ["unimpressed-cat", "v6aOjy0Qo1fIA"],
	["kitty-kiss", "MDJ9IbxxvDUQM"], ["kitten-scritches", "3oriO0OEd9QIDdllqo"],
	["math-confusion", "WRQBXSCnEFJIuxktnw"], ["sponge-panic", "HUkOv6BNWc1HO"],
	["raccoon-spin", "tHIRLHtNwxpjIFqPdV"], ["mind-blown", "26ufdipQqU2lhNA4g"],
	["still-waiting", "l0HlBO7eyXzSZkJri"], ["confused-blink", "l41YtZOb9EUABnuqA"],
	["friendly-wave", "xT9IgG50Fb7Mi0prBC"], ["bush-retreat", "jUwpNzg9IcyrK"],
	["another-one", "l0HlQ7LRalQqdWfao"], ["minion-cheer", "11sBLVxNs7v6WA"],
	["fancy-toast", "g9582DNuQppxC"], ["excellent", "8fen5LSZcHQ5O"],
	["dramatic-tears", "l3vR4CdLInXOhr3rO"], ["gazelle-shimmy", "Gs4NnVZI3DX79CmxMQ"]
];


describe("licensed local animated GIF catalog", () => {
	it("offers 200 unique local GIFs with safe IDs, searchable metadata and no discarded CAPOO entries", () => {
		expect(CHAT_GIFS).toHaveLength(200);
		expect(new Set(CHAT_GIFS.map(gif => gif.id)).size).toBe(200);
		expect(new Set(CHAT_GIFS.map(gif => gif.url)).size).toBe(200);
		for (const gif of CHAT_GIFS) {
			expect(gif.id).toMatch(/^[a-z0-9-]{1,64}$/);
			expect(gif.url).toBe(`/gifs/noto-animated/${gif.id}.gif`);
			expect(gif.label.length).toBeGreaterThan(5);
			expect(gif.tags!.length).toBeGreaterThan(1);
			expect(getChatGif(gif.id)).toBe(gif);
		}
		for (const invalid of [null,undefined,0,{},"__proto__","constructor","capoo-kisses-dogdog","capoo-kisses-a-bunny"]) expect(getChatGif(invalid)).toBeUndefined();
	});

	it("keeps all 36 historical IDs and URLs for compatibility lookup only", () => {
		expect(LEGACY_CHAT_GIFS.map(({id,url}) => [id,url])).toEqual(original.map(([id,source]) => [id,`https://media.giphy.com/media/${source}/200w.gif`]));
		for (const legacy of LEGACY_CHAT_GIFS) {
			expect(getChatGif(legacy.id)).toBe(legacy);
			expect(CHAT_GIFS.some(gif => gif.id === legacy.id)).toBe(false);
			expect(searchChatMedia(CHAT_GIFS,legacy.id)).toEqual([]);
		}
	});

	it("includes animated cats, bugs and all reaction moods", () => {
		for (const code of ["1f431","1f63a","1f638","1f639","1f63b","1f63c","1f63d","1f640","1f63f","1f63e","1f41b","1f41e","1f41d","1f41c","1f98b","1fab1","1fab0","1fab3","1f997","1f99f","1f982","1f40c"]) expect(CHAT_GIFS.some(gif => gif.id === `noto-${code}`),code).toBe(true);
		for (const mood of ["happy","love","sad","cozy","chaotic","funny"]) expect(searchChatMedia(CHAT_GIFS,"",mood).length,mood).toBeGreaterThan(0);
	});

	it("bundles Google's credit and the complete CC BY 4.0 license", () => {
		expect(CHAT_GIF_PACK).toEqual({name:"Animated Noto Emoji",sourceUrl:"https://googlefonts.github.io/noto-emoji-files/",license:"CC BY 4.0",licenseUrl:"https://creativecommons.org/licenses/by/4.0/"});
		const license=creditFiles["../public/gifs/noto-animated/LICENSE.txt"];
		const credit=creditFiles["../public/gifs/noto-animated/ATTRIBUTION.txt"];
		expect(license).toContain("Attribution 4.0 International");
		expect(license).toContain("Section 3 -- License Conditions.");
		expect(license.length).toBeGreaterThan(10000);
		for (const text of ["Google",CHAT_GIF_PACK.sourceUrl,CHAT_GIF_PACK.licenseUrl,"unmodified"]) expect(credit).toContain(text);
	});

	it("records all bundled local files with official source, license and verified SHA-256", () => {
		expect(sources).toHaveLength(200);
		expect(new Set(sources.map(source => source.id)).size).toBe(200);
		expect(new Set(sources.map(source => source.verification.sha256)).size).toBe(200);
		expect(Object.keys(gifFiles)).toHaveLength(200);
		for (const gif of CHAT_GIFS) {
			const source=sources.find(source => source.id === gif.id)!;
			expect(source).toBeDefined();
			expect(source.file).toBe(gif.url);
			expect(source.sourceUrl).toBe(`https://fonts.gstatic.com/s/e/notoemoji/latest/${source.codepoint}/512.gif`);
			expect(source.creator).toBe("Google");
			expect(source.license).toBe(CHAT_GIF_PACK.license);
			expect(source.licenseUrl).toBe(CHAT_GIF_PACK.licenseUrl);
			expect(source.sourcePage).toBe(CHAT_GIF_PACK.sourceUrl);
			expect(source.changes.trim().length).toBeGreaterThan(0);
			expect(source.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
			expect(gifFiles[`../public${gif.url}`]).toBeDefined();
			expect(source.verification.sha256).toMatch(/^[a-f0-9]{64}$/);
			expect(source.verification.bytes).toBeGreaterThan(1000);
			expect(source.verification.width).toBeGreaterThan(32);
			expect(source.verification.height).toBeGreaterThan(32);
			expect(source.verification.frames).toBeGreaterThan(1);
			expect(source.verification.status).toBe(200);
			expect(source.verification.contentType).toBe("image/gif");
			expect(Number.isNaN(Date.parse(source.verification.checkedAt))).toBe(false);
		}
	});
});
