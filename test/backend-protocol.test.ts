import { expect, it } from "vitest";
import { parseClientMessage } from "../src/stream/messages";
import { createEmptyStreamState, createPlaylistItemFromInput, moveToNextPlaylistItem, removePlaylistItem } from "../src/stream/playlist";
import { createChatSnapshot, MAX_CHAT_MESSAGES, MAX_CHAT_MESSAGE_LENGTH, MAX_CHAT_NAME_LENGTH, normalizeChatName } from "../src/stream/chat";
import { CHAT_EMOJI, CHAT_GIFS, getChatGif } from "../src/stream/chat-media";
import { isChatGifId, isGiphyGifId } from "../src/stream/chat-gif-id";
import { createDefaultChatProfile } from "../src/stream/chat-profile";

it('requires a finite explicit seek position and complete playback context', () => {
	const seek = { type: 'seek_video', positionSec: 2260, playlistItemId: 'current', playbackUpdatedAtMs: 10000 };
	expect(parseClientMessage(JSON.stringify(seek))).toEqual(seek);
	for (const patch of [{ positionSec: -1 }, { positionSec: null }, { positionSec: '20' }, { playlistItemId: '' }, { playbackUpdatedAtMs: null }, { playbackUpdatedAtMs: -1 }]) {
		expect(parseClientMessage(JSON.stringify({ ...seek, ...patch }))).toBeNull();
	}
	expect(parseClientMessage(JSON.stringify({ type: 'seek_video', positionSec: 20 }))).toBeNull();
});

it('preserves optional advancement context and rejects partial guards', () => {
	const next = { type: 'next_video', playlistItemId: 'current', playbackUpdatedAtMs: 10000 };
	expect(parseClientMessage(JSON.stringify(next))).toEqual(next);
	expect(parseClientMessage(JSON.stringify({ type: 'next_video', playlistItemId: 'current' }))).toBeNull();
});

it("accepts and projects robot profiles only through authentication and profile updates", () => {
	const profile = createDefaultChatProfile();
	expect(parseClientMessage(JSON.stringify({ type: "authenticate", mode: "viewer", password: "pw", name: "Alex", profile: { ...profile, avatarUrl: "https://evil.test" } })))
		.toEqual({ type: "authenticate", mode: "viewer", password: "pw", name: "Alex", profile });
	expect(parseClientMessage(JSON.stringify({ type: "set_profile", name: "  Robot 🐱  ", profile })))
		.toEqual({ type: "set_profile", name: "Robot 🐱", profile });
	for (const invalid of [null, {}, { ...profile, nameColor: "000000" }, { ...profile, top: "<svg/>" }]) {
		expect(parseClientMessage(JSON.stringify({ type: "set_profile", name: "Alex", profile: invalid }))).toBeNull();
		expect(parseClientMessage(JSON.stringify({ type: "authenticate", mode: "viewer", password: "pw", profile: invalid }))).toBeNull();
	}
	expect(parseClientMessage(JSON.stringify({ type: "send_chat", text: "hi", profile }))).toEqual({ type: "send_chat", text: "hi" });
});

it("accepts explicit leave without trusting client-provided reset or identity fields", () => {
	expect(parseClientMessage(JSON.stringify({ type: "leave", resetRoom: true, senderId: "forged" }))).toEqual({ type: "leave" });
});

it("accepts bounded live GIPHY IDs and preserves catalog GIFs", () => {
	for (const gifId of ["giphy:A", "giphy:Ab09", `giphy:${"a".repeat(64)}`, ...CHAT_GIFS.map(gif => gif.id)]) {
		expect(isChatGifId(gifId)).toBe(true);
		expect(isGiphyGifId(gifId)).toBe(gifId.startsWith("giphy:"));
		expect(parseClientMessage(JSON.stringify({ type: "send_chat", text: "", gifId, requestId: "gif" })))
			.toEqual({ type: "send_chat", text: "", gifId, requestId: "gif" });
	}
});

it("rejects malformed provider IDs and URLs", () => {
	for (const gifId of ["giphy:", `giphy:${"a".repeat(65)}`, "GIPHY:abc", "giphy:a-b", "giphy:a_b", "giphy:a/b", "giphy:a?b", "giphy:a\n", "giphy: abc", "giphy:abc.gif", "giphy:https://media.giphy.com/a.gif", "https://media.giphy.com/a.gif", "giphy:é", null, 3, {}]) {
		expect(isGiphyGifId(gifId)).toBe(false);
		expect(isChatGifId(gifId)).toBe(false);
		expect(parseClientMessage(JSON.stringify({ type: "send_chat", text: "hi", gifId }))).toBeNull();
	}
});

it("strips forged sender identity from authentication and chat commands", () => {
	expect(parseClientMessage(JSON.stringify({ type: "authenticate", mode: "viewer", password: "qa-viewer", senderId: "forged" })))
		.toEqual({ type: "authenticate", mode: "viewer", password: "qa-viewer" });
	expect(parseClientMessage(JSON.stringify({ type: "send_chat", text: "hi", senderId: "forged" })))
		.toEqual({ type: "send_chat", text: "hi" });
});

it("preserves bounded chat request IDs without changing legacy chat", () => {
	const requestId = crypto.randomUUID();
	expect(parseClientMessage(JSON.stringify({ type: "send_chat", text: "hello", requestId })))
		.toEqual({ type: "send_chat", text: "hello", requestId });
	for (const invalid of ["", "a".repeat(65), "bad id", 123, null]) {
		expect(parseClientMessage(JSON.stringify({ type: "send_chat", text: "hello", requestId: invalid }))).toBeNull();
	}
});

it("accepts optional Unicode names while preserving legacy authentication", () => {
	expect(parseClientMessage(JSON.stringify({ type: "authenticate", mode: "viewer", password: "qa-viewer", name: "  Zoe 🐱  " })))
		.toMatchObject({ name: "Zoe 🐱" });
	expect(parseClientMessage(JSON.stringify({ type: "authenticate", mode: "viewer", password: "qa-viewer" })))
		.toMatchObject({ type: "authenticate" });
});

it("accepts plain chat text and rejects empty, oversized and arbitrary GIF inputs", () => {
	expect(parseClientMessage(JSON.stringify({ type: "send_chat", text: " <b>Hello</b> " })))
		.toEqual({ type: "send_chat", text: "<b>Hello</b>" });
	for (const input of [{ text: "  " }, { text: "x".repeat(2001) }, { text: "hi", gifId: "https://example.com/evil.gif" }, { text: "hi", gifId: 3 }]) {
		expect(parseClientMessage(JSON.stringify({ type: "send_chat", ...input }))).toBeNull();
	}
});

it("counts emoji message limits by Unicode code points", () => {
	expect(parseClientMessage(JSON.stringify({ type: "send_chat", text: "🐱".repeat(2000) })))
		.toMatchObject({ text: "🐱".repeat(2000) });
	expect(parseClientMessage(JSON.stringify({ type: "send_chat", text: "🐱".repeat(2001) }))).toBeNull();
});

it("preserves rates while advancing empty and populated queues", () => {
	const state = createEmptyStreamState();
	state.playback.playbackRate = 1.75;
	expect(moveToNextPlaylistItem(state).playback.playbackRate).toBe(1.75);
	state.playlist = [createPlaylistItemFromInput({ url: "abcdefghijk" })!];
	expect(moveToNextPlaylistItem(state).playback.playbackRate).toBe(1.75);
});

it("preserves rates when removing the current or final item", () => {
	const state = createEmptyStreamState();
	state.playback.playbackRate = 0.75;
	state.playlist = ["abcdefghijk", "lmnopqrstuv"].map((url) => createPlaylistItemFromInput({ url })!);
	const next = removePlaylistItem(state, state.playlist[0].id)!;
	expect(next.playback.playbackRate).toBe(0.75);
	expect(removePlaylistItem(next, next.playlist[0].id)!.playback.playbackRate).toBe(0.75);
});

it("bounds and sanitizes names without splitting emoji", () => {
	expect(normalizeChatName("🐱".repeat(41))).toBe("🐱".repeat(40));
	expect(normalizeChatName(" \u0000\u202e ")).toBe("Guest");
	expect(normalizeChatName("Cafe\u0301   🦊")).toBe("Café 🦊");
	expect(normalizeChatName(undefined)).toBe("Guest");
	expect([MAX_CHAT_MESSAGES, MAX_CHAT_NAME_LENGTH, MAX_CHAT_MESSAGE_LENGTH]).toEqual([500, 40, 2000]);
});

it("creates fresh empty sessions and offers a fixed GIF allowlist and numerous emoji", () => {
	const first = createChatSnapshot();
	expect(first.messages).toEqual([]);
	expect(createChatSnapshot().sessionId).not.toBe(first.sessionId);
	expect(CHAT_GIFS.length).toBeGreaterThanOrEqual(12);
	expect(new Set(CHAT_GIFS.map((gif) => gif.id)).size).toBe(CHAT_GIFS.length);
	expect(CHAT_EMOJI.length).toBeGreaterThanOrEqual(60);
	for (const gif of CHAT_GIFS) {
		expect(gif.url).toMatch(/^\/gifs\/noto-animated\/[a-z0-9_-]+\.gif$/);
		expect(getChatGif(gif.id)).toBe(gif);
	}
	expect(getChatGif("https://example.com/evil.gif")).toBeUndefined();
	expect(getChatGif(null)).toBeUndefined();
});
