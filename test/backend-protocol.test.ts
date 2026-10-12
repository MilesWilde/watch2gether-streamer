import { expect, it } from "vitest";
import { parseClientMessage } from "../src/stream/messages";
import { createEmptyStreamState, createPlaylistItemFromInput, moveToNextPlaylistItem, removePlaylistItem } from "../src/stream/playlist";
import { createChatSnapshot, MAX_CHAT_MESSAGES, MAX_CHAT_MESSAGE_LENGTH, MAX_CHAT_NAME_LENGTH, normalizeChatName } from "../src/stream/chat";
import { CHAT_EMOJI, CHAT_GIFS, getChatGif } from "../src/stream/chat-media";

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
		expect(new URL(gif.url).hostname).toBe("media.giphy.com");
		expect(getChatGif(gif.id)).toBe(gif);
	}
	expect(getChatGif("https://example.com/evil.gif")).toBeUndefined();
	expect(getChatGif(null)).toBeUndefined();
});
