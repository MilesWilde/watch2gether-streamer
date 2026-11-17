/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import * as media from "../src/stream/chat-media";

const legacyGifs = [
	["cat-pats", "KztT2c4u8mYYUiMKdJ"], ["fox-love", "s6Ru4Jpl7EJkjyjq75"],
	["tiny-chick", "YR0IBYGICPmzehJ6um"], ["kitty", "3o8dFsCL0z8cgjoWzK"],
	["happy-wave", "O0VBge9U7f8j21UqNj"], ["summer-cat", "TEBseeS5mJCje0NKs9"],
	["love-you", "ViSpZL4Nz52k0fiowe"], ["music-frog", "6FxJBpNTBgWdJCXKD4"],
	["happy-heart", "D4xeiRd5Kbgds50E3r"], ["dumpling", "qZy6R9ZfLr4BLthMh5"],
	["melody", "ts0Uy1zVJTvCo"], ["tea-time", "lS7l4HG3tsAG0k8MoJ"]
];

describe("curated GIF and emoji catalogs", () => {
	it("offers 200 distinct licensed local reactions without changing legacy message IDs or URLs", () => {
		expect(media.CHAT_GIFS).toHaveLength(200);
		expect(new Set(media.CHAT_GIFS.map((gif) => gif.id)).size).toBe(media.CHAT_GIFS.length);
		expect(new Set(media.CHAT_GIFS.map((gif) => gif.url)).size).toBe(media.CHAT_GIFS.length);
		for (const [id, source] of legacyGifs) {
			expect(media.getChatGif(id)?.url).toBe(`https://media.giphy.com/media/${source}/200w.gif`);
		}
		for (const gif of media.CHAT_GIFS) {
			expect(gif.url).toMatch(/^\/gifs\/noto-animated\/[a-z0-9_-]+\.gif$/);
			expect(media.getChatGif(gif.id)).toBe(gif);
			expect(gif.label.trim()).not.toBe("");
		}
		for (const invalid of [null, undefined, 0, {}, "__proto__", "https://evil.test/a.gif"]) {
			expect(media.getChatGif(invalid)).toBeUndefined();
		}
	});

	it("retains the original emoji and adds both standard bugs", () => {
		expect(media.CHAT_EMOJI).toEqual(expect.arrayContaining(["😀", "🧋", "🐝", "🐛", "🐞"]));
		expect(media.CHAT_EMOJI.length).toBeGreaterThanOrEqual(86);
		expect(new Set(media.CHAT_EMOJI).size).toBe(media.CHAT_EMOJI.length);
	});
	it("tags every GIF including legacy entries for mood filtering", () => {
		for (const gif of media.CHAT_GIFS) {
			expect(gif.tags?.length, gif.id).toBeGreaterThan(0);
		}
		for (const mood of ["happy", "love", "chaotic", "sad", "cozy", "funny"]) {
			expect(media.searchChatMedia(media.CHAT_GIFS, "", mood).length, mood).toBeGreaterThan(0);
		}
	});
});

describe("media search", () => {
	const items = [
		{ id: "tiny_rage", label: "Tiny Rage", aliases: ["table flip"], tags: ["chaotic", "angry"] },
		{ id: "bug", label: "Café Bug", aliases: ["little insect"], tags: ["cute", "happy"] },
		{ id: "bonk", label: "Bonk", tags: ["chaotic", "funny"] },
		{ id: "plain", label: "No metadata" }
	] as const;

	it("exports a pure generic search helper", () => {
		expect(media).toHaveProperty("searchChatMedia", expect.any(Function));
	});
	it("matches every normalized token across IDs, labels, aliases and tags", () => {
		expect(media.searchChatMedia(items, "  TINY   angry ")).toEqual([items[0]]);
		expect(media.searchChatMedia(items, "table chaotic")).toEqual([items[0]]);
		expect(media.searchChatMedia(items, "CAFE\u0301 insect")).toEqual([items[1]]);
		expect(media.searchChatMedia(items, "ｂｕｇ")).toEqual([items[1]]);
		expect(media.searchChatMedia(items, "rage cute")).toEqual([]);
		expect(media.searchChatMedia(items, "<script>")).toEqual([]);
	});
	it("filters categories by exact normalized tags, leaving all and recent to the client", () => {
		expect(media.searchChatMedia(items, "", " CHAOTIC ")).toEqual([items[0], items[2]]);
		expect(media.searchChatMedia(items, "funny", "chaotic")).toEqual([items[2]]);
		expect(media.searchChatMedia(items, "", "cha")).toEqual([]);
		for (const category of [undefined, "", "all", "RECENT"]) {
			expect(media.searchChatMedia(items, "", category)).toEqual(items);
		}
	});
	it("returns a fresh ordered array with original item references and handles empty input", () => {
		const result = media.searchChatMedia(items, " \n\t ");
		expect(result).toEqual(items);
		expect(result).not.toBe(items);
		expect(result[0]).toBe(items[0]);
		expect(media.searchChatMedia([], "anything")).toEqual([]);
	});
});

type EmoteManifest = {
	packs: Array<{ id: string; name: string; version: string; sourceUrl: string; license: string; licenseUrl: string; credit: string; licenseFile: string; archiveUrl?: string; archiveSha256?: string }>;
	assets: Array<{ id: string; label: string; aliases: string[]; tags: string[]; pack: string; codepoint: string; file: string; sourceUrl: string; sha256: string; author: string }>;
};

const emoteAssets = import.meta.glob<string>("../public/emotes/**/*.svg", { query: "?raw", import: "default", eager: true });
const emotePngs = import.meta.glob<string>("../public/emotes/**/*.png", { query: "?inline", import: "default", eager: true });
const emoteLicenses = import.meta.glob<string>("../public/emotes/**/LICENSE*.txt", { query: "?raw", import: "default", eager: true });
const manifests = import.meta.glob<EmoteManifest>("../public/emotes/manifest.json", { import: "default", eager: true });
const runtimeCatalogs = import.meta.glob<{ packs: EmoteManifest["packs"]; assets: Array<Record<string, unknown>> }>("../public/emotes/catalog.json", { import: "default", eager: true });
const gifSourceFiles = import.meta.glob<unknown>("../public/GIF-SOURCES.json", { import: "default", eager: true });
const legacyEmotes = [
	"bug", "panic", "smug", "bonk", "tiny_rage", "celebration", "lurking", "brain_melt",
	"hype", "sobbing", "heart_hug", "side_eye", "sleepy", "popcorn", "facepalm", "sparkle",
	"no_thoughts", "coffee", "gg", "wave", "shy", "deal_with_it", "this_is_fine", "nom",
	"upside_down", "raised_eyebrow", "zany", "mind_blown", "salute", "peeking", "disappear",
	"holding_back_tears", "shush", "zipper_mouth", "disguise", "party_face", "pleading", "monocle",
	"yawn", "drool", "woozy", "ladybug", "snail", "sparkling_heart", "bandage", "mushroom", "bubble_tea", "hot_face"
];

describe("human-authored emoji packs", () => {
	it("ships a compact runtime catalog separate from per-asset provenance", async () => {
		const { CHAT_EMOTES, CHAT_EMOTE_PACKS } = await import("../src/stream/chat-emotes");
		const runtime = runtimeCatalogs["../public/emotes/catalog.json"];
		expect(runtime).toBeDefined();
		expect(runtime.packs).toEqual(CHAT_EMOTE_PACKS);
		expect(runtime.assets).toEqual(CHAT_EMOTES);
		for (const asset of runtime.assets) {
			expect(Object.keys(asset).sort()).toEqual(["aliases", "author", "codepoint", "id", "label", "pack", "tags", "url"]);
		}
		const manifest = manifests["../public/emotes/manifest.json"];
		expect(runtime.assets).toEqual(manifest.assets.map((asset) => {
			const { id, label, file, aliases, tags, pack, codepoint, author } = asset;
			return { id, label, url: file, aliases: [...aliases, pack], tags, pack, codepoint, author };
		}));
	});

	it("pins credited standard releases and the official noncommercial Neocat archive", async () => {
		const catalog = await import("../src/stream/chat-emotes");
		expect(catalog).toHaveProperty("CHAT_EMOTE_PACKS");
		const { CHAT_EMOTE_PACKS } = catalog;
		expect(new Set(CHAT_EMOTE_PACKS.map((pack) => pack.id)).size).toBe(CHAT_EMOTE_PACKS.length);
		for (const expected of [
			{ id: "openmoji", name: "OpenMoji", version: "14.0.0", license: "CC BY-SA 4.0" },
			{ id: "twemoji", name: "Twemoji", version: "14.0.2", license: "CC BY 4.0" }
		]) {
			const pack = CHAT_EMOTE_PACKS.find((item) => item.id === expected.id);
			expect(pack).toMatchObject({ id: expected.id, name: expected.name, license: expected.license });
			expect(pack!.version.replace(/^v/, "")).toBe(expected.version);
			expect(pack!.credit.trim()).not.toBe("");
			expect(pack!.sourceUrl).toContain(expected.id);
			expect(new URL(pack!.sourceUrl).protocol).toBe("https:");
			expect(pack!.licenseUrl).toMatch(/^https:\/\/(?:creativecommons\.org|github\.com|raw\.githubusercontent\.com)\//);
		}
		expect(CHAT_EMOTE_PACKS.find((pack) => pack.id === "neocat")).toMatchObject({
			name: "Neocat", license: "CC BY-NC-SA 4.0", credit: "Neocat by Volpeon.",
			sourceUrl: "https://volpeon.ink/emojis/neocat/",
			archiveUrl: "https://strapi.volpeon.ink/uploads/neocat_5359f48261.zip",
			archiveSha256: "3b3439b4aeb92da6da1432bb90cd554dda2121e01ae61a45d6a88f868aa03952",
		});
		for (const pack of CHAT_EMOTE_PACKS) {
			expect(pack.version.trim()).not.toBe("");
			expect(emoteLicenses[`../public/emotes/${pack.id}/${pack.licenseFile}`], pack.id).toBeDefined();
		}
	});

	it("provides 1000+ selectable assets including niche cat reactions with unique searchable IDs", async () => {
		const { CHAT_EMOTES, CHAT_EMOTE_PACKS, getChatEmote } = await import("../src/stream/chat-emotes");
		expect(CHAT_EMOTES.length).toBeGreaterThanOrEqual(1000);
		expect(new Set(CHAT_EMOTES.map((emote) => emote.id)).size).toBe(CHAT_EMOTES.length);
		expect(new Set(CHAT_EMOTES.map((emote) => emote.url)).size).toBe(CHAT_EMOTES.length);
		expect(CHAT_EMOTES.filter((emote) => emote.pack === "openmoji").length).toBeGreaterThanOrEqual(900);
		expect(CHAT_EMOTES.filter((emote) => emote.pack === "twemoji")).toHaveLength(48);
		expect(CHAT_EMOTES.filter((emote) => emote.pack === "neocat").length).toBeGreaterThanOrEqual(200);
		for (const emote of CHAT_EMOTES) {
			expect(emote.id).toMatch(/^[a-z0-9_]+$/);
			expect(CHAT_EMOTE_PACKS.map((pack) => pack.id)).toContain(emote.pack);
			if (emote.pack === "neocat") {
				expect(emote.codepoint).toBe("");
				expect(emote.id).toMatch(/^neocat(?:_|$)/);
				expect(emote.url).toBe(`/emotes/neocat/${emote.id}.png`);
			} else {
				expect(emote.codepoint).toMatch(/^[\da-f]+(?:-[\da-f]+)*$/i);
				const filename = emote.pack === "openmoji" ? emote.codepoint.toUpperCase() : emote.codepoint.toLowerCase();
				expect(emote.url).toBe(`/emotes/${emote.pack}/${filename}.svg`);
			}
			expect(emote.author.trim()).not.toBe("");
			expect(emote.label.trim()).not.toBe("");
			expect(emote.tags.length).toBeGreaterThan(0);
			expect(emote.aliases.length).toBeGreaterThan(0);
			expect(getChatEmote(emote.id)).toBe(emote);
			expect(media.searchChatMedia([emote], emote.aliases[0])).toEqual([emote]);
			if (emote.pack === "twemoji") {
				expect(emote.id).toMatch(/^twemoji_/);
				expect(getChatEmote(emote.id.slice("twemoji_".length))).toMatchObject({ pack: "openmoji" });
			}
		}
		for (const id of legacyEmotes) {
			expect(getChatEmote(id)).toMatchObject({ id, pack: "openmoji" });
			expect(getChatEmote(`twemoji_${id}`)).toMatchObject({ pack: "twemoji" });
		}
		for (const id of ["neocat_happy", "neocat_sad", "neocat_smug", "neocat_pat", "neocat_woozy"]) {
			expect(getChatEmote(id)).toMatchObject({ pack: "neocat", author: "Volpeon" });
			expect(media.searchChatMedia(CHAT_EMOTES, id.replaceAll("_", " "))).toContain(getChatEmote(id));
		}
		for (const id of ["bug", "twemoji_bug"]) {
			expect(getChatEmote(id)?.codepoint.toUpperCase()).toBe("1F41B");
		}
		for (const invalid of [undefined, null, 4, {}, "__proto__", "constructor", "BUG", ":bug:", "missing"]) {
			expect(getChatEmote(invalid)).toBeUndefined();
		}
	});

	it("removes root SVGs and ships safe upstream artwork with official viewBoxes", async () => {
		const { CHAT_EMOTES } = await import("../src/stream/chat-emotes");
		const rootAssets = import.meta.glob("../public/emotes/*.svg", { query: "?raw", import: "default", eager: true });
		expect(Object.keys(rootAssets)).toEqual([]);
		expect(Object.keys(emoteAssets).length + Object.keys(emotePngs).length).toBe(CHAT_EMOTES.length);
		for (const emote of CHAT_EMOTES.filter((item) => item.pack !== "neocat")) {
			const svg = emoteAssets[`../public${emote.url}`];
			expect(svg, emote.id).toBeDefined();
			const size = emote.pack === "openmoji" ? 72 : 36;
			expect(svg).toMatch(new RegExp(`<svg\\b[^>]*viewBox=["']0 0 ${size} ${size}["']`));
			expect(svg).toMatch(/<(path|ellipse|circle|rect|polygon|polyline|line)\b/);
			expect(svg).not.toMatch(/<(script|foreignObject|image|text|iframe|object|embed)\b|\bon\w+\s*=|<!ENTITY|@import/i);
			for (const match of svg.matchAll(/(?:href|src)\s*=\s*["']([^"']*)["']|url\(\s*["']?([^)'"\s]+)/gi)) {
				expect(match[1] ?? match[2], emote.id).toMatch(/^#[\w.-]+$/);
			}
		}
		for (const emote of CHAT_EMOTES.filter((item) => item.pack === "neocat")) {
			const data = emotePngs[`../public${emote.url}`];
			expect(data, emote.id).toMatch(/^data:image\/png;base64,/);
			const bytes = Uint8Array.from(atob(data.split(",")[1]), (char) => char.charCodeAt(0));
			expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
			const header = new DataView(bytes.buffer);
			expect(header.getUint32(16)).toBe(256);
			const height = emote.id === "neocat_pat_up" ? 264
				: ["neocat_flag_lesbian", "neocat_hug_bun_heart", "neocat_hug_haj_heart", "neocat_nom_haj_nervous"].includes(emote.id) ? 248 : 256;
			expect(header.getUint32(20)).toBe(height);
		}
	});

	it("records matching pinned origins and SHA-256 of every unmodified SVG and PNG", async () => {
		const { CHAT_EMOTES, CHAT_EMOTE_PACKS } = await import("../src/stream/chat-emotes");
		const manifest = manifests["../public/emotes/manifest.json"];
		expect(manifest).toBeDefined();
		expect(manifest.packs).toEqual(CHAT_EMOTE_PACKS);
		expect(manifest.assets).toHaveLength(CHAT_EMOTES.length);
		expect(new Set(manifest.assets.map((asset) => asset.file)).size).toBe(CHAT_EMOTES.length);
		for (const emote of CHAT_EMOTES) {
			const asset = manifest.assets.find((entry) => entry.file === emote.url);
			expect(asset, emote.id).toMatchObject({ pack: emote.pack, codepoint: emote.codepoint, file: emote.url, author: emote.author });
			expect(asset!.sha256).toMatch(/^[a-f\d]{64}$/);
			const source = new URL(asset!.sourceUrl);
			expect(source.protocol).toBe("https:");
			if (emote.pack === "neocat") {
				expect(source.href).toBe(`https://strapi.volpeon.ink/uploads/neocat_5359f48261.zip#${emote.id}.png`);
			} else {
				expect(source.hostname).toBe("raw.githubusercontent.com");
				const expectedPath = emote.pack === "openmoji"
				? `/hfg-gmuend/openmoji/14.0.0/color/svg/${emote.codepoint.toUpperCase()}.svg`
				: `/twitter/twemoji/v14.0.2/assets/svg/${emote.codepoint.toLowerCase()}.svg`;
				expect(source.pathname).toBe(expectedPath);
			}
			const bytes = emote.pack === "neocat"
				? Uint8Array.from(atob(emotePngs[`../public${emote.url}`].split(",")[1]), (char) => char.charCodeAt(0))
				: new TextEncoder().encode(emoteAssets[`../public${emote.url}`]);
			const digest = await crypto.subtle.digest("SHA-256", bytes);
			const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
			expect(sha256, emote.url).toBe(asset!.sha256);
		}
	});

	it("includes full upstream licenses and credits while preserving external GIF sources", () => {
		const license = emoteLicenses["../public/emotes/LICENSE.txt"];
		const openmoji = emoteLicenses["../public/emotes/openmoji/LICENSE.txt"];
		const twemoji = emoteLicenses["../public/emotes/twemoji/LICENSE-GRAPHICS.txt"];
		const neocat = emoteLicenses["../public/emotes/neocat/LICENSE.txt"];
		expect(openmoji).toBeDefined();
		expect(twemoji).toBeDefined();
		expect(openmoji).toContain("Attribution-ShareAlike 4.0 International");
		expect(twemoji).toContain("Attribution 4.0 International");
		expect(neocat).toContain("Attribution-NonCommercial-ShareAlike 4.0 International");
		for (const fullText of [openmoji, twemoji, neocat]) {
			expect(fullText.length).toBeGreaterThan(10000);
			expect(fullText).toMatch(/Section 1\s*[-.]+\s*Definitions/i);
			expect(fullText).toMatch(/Section 8\s*[-.]+\s*Interpretation/i);
		}
		for (const credit of ["OpenMoji", "Twemoji", "14.0.0", "14.0.2", "Neocat", "Volpeon", "NonCommercial"]) expect(license).toContain(credit);
		expect(license).not.toMatch(/CC0|original SVG|drawn specifically/i);
		expect(license).toContain("EXTERNALLY HOSTED GIPHY REACTIONS");
		const gifSources = gifSourceFiles["../public/GIF-SOURCES.json"];
		expect(gifSources).toBeDefined();
		const sourceLinks = JSON.stringify(gifSources);
		for (const gif of media.CHAT_GIFS) expect(sourceLinks).toContain(gif.url);
		expect(sourceLinks).toContain('fonts.gstatic.com');
		expect(sourceLinks).toContain('creativecommons.org/licenses/by/4.0');
	});

	it("tokenizes known exact shortcodes, including adjacent and repeated emotes", async () => {
		const { tokenizeChatEmotes, getChatEmote } = await import("../src/stream/chat-emotes");
		expect(tokenizeChatEmotes("hi :bug::panic: :bug:!")).toEqual([
			{ type: "text", text: "hi " }, { type: "emote", emote: getChatEmote("bug") },
			{ type: "emote", emote: getChatEmote("panic") }, { type: "text", text: " " },
			{ type: "emote", emote: getChatEmote("bug") }, { type: "text", text: "!" }
		]);
		expect(tokenizeChatEmotes(":tiny_rage:")).toEqual([{ type: "emote", emote: getChatEmote("tiny_rage") }]);
		expect(tokenizeChatEmotes(":neocat_happy::twemoji_bug:")).toEqual([
			{ type: "emote", emote: getChatEmote("neocat_happy") },
			{ type: "emote", emote: getChatEmote("twemoji_bug") }
		]);
	});

	it("preserves unknown shortcodes, malformed input, Unicode, whitespace and HTML as literal text", async () => {
		const { tokenizeChatEmotes } = await import("../src/stream/chat-emotes");
		for (const text of ["hello\n🐛  ", ":unknown: :BUG: :bad-id: :__proto__:", "<img src=x onerror=alert(1)>", ":bug", "bug:", "::"]) {
			expect(tokenizeChatEmotes(text)).toEqual([{ type: "text", text }]);
		}
		expect(tokenizeChatEmotes("")).toEqual([]);
		const text = "<b>:unknown:</b>\n:bug: :missing:";
		const tokens = tokenizeChatEmotes(text);
		expect(tokens.map((token) => token.type === "text" ? token.text : `:${token.emote.id}:`).join("")).toBe(text);
		expect(tokens.filter((token) => token.type === "text").map((token) => token.text)).toEqual(["<b>:unknown:</b>\n", " :missing:"]);
	});
});
