import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerMessage } from "../src/stream/messages";
import { CHAT_GIFS } from "../src/stream/chat-media";
import type { StreamRoom } from "../src/stream-room";
import type { ChatSnapshot } from "../src/stream/chat";

const sockets: WebSocket[] = [];

afterEach(async () => {
	vi.restoreAllMocks();
	for (const socket of sockets.splice(0)) {
		if (socket.readyState === WebSocket.OPEN) socket.close();
	}
});

async function connect(room: DurableObjectStub<StreamRoom>) {
	const response = await room.fetch("https://room.test/ws", { headers: { Upgrade: "websocket" } });
	expect(response.status).toBe(101);
	const socket = response.webSocket!;
	socket.accept();
	sockets.push(socket);
	const messages: ServerMessage[] = [];
	socket.addEventListener("message", (event) => { messages.push(JSON.parse(String(event.data))); });
	return {
		socket,
		messages,
		send(message: object) { socket.send(JSON.stringify(message)); },
		async take<T extends ServerMessage["type"]>(type: T): Promise<Extract<ServerMessage, { type: T }>> {
			await expect.poll(() => messages.some((message) => message.type === type), { timeout: 1000, interval: 1 }).toBe(true);
			const index = messages.findIndex((message) => message.type === type);
			return messages.splice(index, 1)[0] as Extract<ServerMessage, { type: T }>;
		}
	};
}

function newRoom() { return env.STREAM.getByName(`backend-${crypto.randomUUID()}`); }

async function authenticate(client: Awaited<ReturnType<typeof connect>>, mode = "viewer", name?: string) {
	client.send({ type: "authenticate", mode, password: mode === "admin" ? "qa-admin" : "qa-viewer", name });
	await client.take("authenticated");
	return client.take("chat_history");
}

describe("real room WebSockets", () => {
	it("acknowledges only authenticated senders, including the ninth flood rejection and invalid chat", async () => {
		const room = newRoom();
		const owner = await connect(room);
		const peer = await connect(room);
		const outsider = await connect(room);
		outsider.send({ type: "send_chat", text: "forbidden", requestId: "unauthenticated" });
		expect((await outsider.take("error")).message).toBe("Not authenticated");
		outsider.send({ type: "send_chat", text: "", requestId: "invalid-unauthenticated" });
		await outsider.take("error");
		await authenticate(owner);
		await authenticate(peer);
		for (let i = 0; i < 8; i++) {
			owner.send({ type: "send_chat", text: `message ${i}`, requestId: `send-${i}` });
			const message = (await owner.take("chat_message")).message;
			expect(message).not.toHaveProperty("requestId");
			await peer.take("chat_message");
			expect(await owner.take("chat_result")).toEqual({ type: "chat_result", requestId: `send-${i}`, accepted: true });
		}
		owner.send({ type: "send_chat", text: "keep draft", gifId: CHAT_GIFS[0].id, requestId: "ninth" });
		expect(await owner.take("chat_result")).toEqual({ type: "chat_result", requestId: "ninth", accepted: false, message: expect.stringContaining("quickly") });
		for (const input of [{ text: "" }, { text: "hello", gifId: "invalid" }, { text: "x".repeat(2001) }]) {
			owner.send({ type: "send_chat", ...input, requestId: "invalid" });
			expect(await owner.take("chat_result")).toEqual({ type: "chat_result", requestId: "invalid", accepted: false, message: "Invalid message" });
		}
		owner.send({ type: "ping" });
		await owner.take("pong");
		expect(peer.messages.some(message => message.type === "chat_result")).toBe(false);
		expect(outsider.messages.some(message => message.type === "chat_result" || message.type === "chat_message")).toBe(false);
		const next = await connect(room);
		expect((await authenticate(next)).chat.messages).toHaveLength(8);
	});
	it.each(["error", "failed send"])("cleans up %s and repeated close/error events exactly once", async (failure) => {
		const room = newRoom();
		const client = await connect(room);
		const initial = await authenticate(client, "admin", "Departing 🐱");
		client.send({ type: "send_chat", text: "old identity" });
		await client.take("chat_message");
		let server!: WebSocket;
		await runInDurableObject(room, (instance) => {
			const accepted: Set<WebSocket> = Reflect.get(instance, "authenticatedSockets");
			expect(accepted.size).toBe(1);
			[server] = accepted;
			if (failure === "failed send") {
				vi.spyOn(server, "send").mockImplementationOnce(() => { throw new Error("socket send failed"); });
			} else {
				server.dispatchEvent(new Event("error"));
			}
		});
		if (failure === "failed send") client.send({ type: "ping" });
		await expect.poll(() => client.socket.readyState).toBe(WebSocket.CLOSED);
		const sessionAfterDisconnect = await runInDurableObject(room, (instance) => {
			const chat: ChatSnapshot = Reflect.get(instance, "chat");
			expect(chat.sessionId).not.toBe(initial.chat.sessionId);
			expect(chat.messages).toEqual([]);
			return chat.sessionId;
		});
		await runInDurableObject(room, (instance) => {
			// Exercise the real registered listeners after cleanup, including queued messages.
			for (const type of ["error", "close", "error", "close"]) server.dispatchEvent(new Event(type));
			for (const data of [
				{ type: "authenticate", mode: "admin", password: "qa-admin", name: "Ghost" },
				{ type: "send_chat", text: "ghost message" }
			]) server.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(data) }));
			const chat: ChatSnapshot = Reflect.get(instance, "chat");
			expect(chat.sessionId).toBe(sessionAfterDisconnect);
			expect(chat.messages).toEqual([]);
			for (const key of ["sockets", "authenticatedSockets", "socketRoles", "socketNames", "chatFloodWindows"]) {
				const entries: Set<WebSocket> | Map<WebSocket, unknown> = Reflect.get(instance, key);
				expect(entries.size, key).toBe(0);
			}
		});
		const next = await connect(room);
		expect((await authenticate(next)).chat.sessionId).toBe(sessionAfterDisconnect);
		expect((await next.take("name_updated")).name).toBe("Guest");
		expect((await next.take("presence")).listenerCount).toBe(1);
	});

	it("starts fresh empty chat after actual eviction while retaining the persisted queue and rate", async () => {
		const room = newRoom();
		const first = await connect(room);
		const initial = await authenticate(first, "admin", "Before restart");
		await first.take("state");
		first.send({ type: "request_videos", videos: [{ url: "abcdefghijk", title: "Saved queue" }] });
		const queued = (await first.take("state")).state;
		first.send({ type: "set_playback_rate", playbackRate: 1.75, positionSec: 0 });
		await first.take("state");
		first.send({ type: "send_chat", text: "transient history" });
		await first.take("chat_message");
		// Nonhibernating sockets keep the actor active, so drain before eviction.
		first.socket.close();
		await expect.poll(() => first.socket.readyState).toBe(WebSocket.CLOSED);
		const drainedSession = await runInDurableObject(room, (instance) => {
			const chat: ChatSnapshot = Reflect.get(instance, "chat");
			return chat.sessionId;
		});
		await evictDurableObject(room, { webSockets: "close" });
		const restarted = await connect(room);
		const fresh = await authenticate(restarted);
		expect(fresh.chat.sessionId).not.toBe(initial.chat.sessionId);
		expect(fresh.chat.sessionId).not.toBe(drainedSession);
		expect(fresh.chat.messages).toEqual([]);
		expect((await restarted.take("name_updated")).name).toBe("Guest");
		const restored = (await restarted.take("state")).state;
		expect(restored.playlist).toEqual(queued.playlist);
		expect(restored.playback.playbackRate).toBe(1.75);
		expect((await restarted.take("presence")).listenerCount).toBe(1);
	});

	it("withholds live broadcasts and history from connected unauthenticated sockets", async () => {
		const room = newRoom();
		const outsider = await connect(room);
		const participant = await connect(room);
		const initial = await authenticate(participant);
		participant.send({ type: "send_chat", text: "private room chat" });
		const sent = (await participant.take("chat_message")).message;
		outsider.send({ type: "ping" });
		expect((await outsider.take("error")).message).toBe("Not authenticated");
		expect(outsider.messages).toEqual([]);
		const joined = await authenticate(outsider);
		expect(joined.chat).toEqual({ sessionId: initial.chat.sessionId, messages: [sent] });
		participant.send({ type: "send_chat", text: "now shared" });
		expect((await outsider.take("chat_message")).message.text).toBe("now shared");
	});

	it("accepts exactly 2000 emoji code points through the live chat API", async () => {
		const client = await connect(newRoom());
		await authenticate(client);
		client.send({ type: "send_chat", text: "🐱".repeat(2000) });
		expect((await client.take("chat_message")).message.text).toBe("🐱".repeat(2000));
		client.send({ type: "send_chat", text: "🐱".repeat(2001) });
		expect((await client.take("error")).message).toBe("Invalid message");
	});

	it("broadcasts server-owned identity and retains history across partial departures", async () => {
		const room = newRoom();
		const first = await connect(room);
		const initial = await authenticate(first, "viewer", "  Zoe 🐱  ");
		expect(initial.chat.messages).toEqual([]);
		const second = await connect(room);
		await authenticate(second);
		first.send({ type: "send_chat", text: "hi", name: "forged", sessionId: "forged", sentAtMs: 0 });
		const sent = (await first.take("chat_message")).message;
		expect(sent).toMatchObject({ name: "Zoe 🐱", text: "hi", sessionId: initial.chat.sessionId });
		expect(sent.id).toBeTruthy();
		expect(sent.sentAtMs).toBeGreaterThan(0);
		expect((await second.take("chat_message")).message).toEqual(sent);
		first.socket.close();
		await expect.poll(() => first.socket.readyState).toBe(WebSocket.CLOSED);
		const third = await connect(room);
		expect((await authenticate(third)).chat.messages).toEqual([sent]);
	});

	it("resets history when the last authenticated socket leaves despite unauthenticated presence", async () => {
		const room = newRoom();
		const first = await connect(room);
		const initial = await authenticate(first);
		first.send({ type: "send_chat", text: "old session" });
		await first.take("chat_message");
		const unauthenticated = await connect(room);
		first.socket.close();
		await expect.poll(() => first.socket.readyState).toBe(WebSocket.CLOSED);
		const fresh = await authenticate(unauthenticated);
		expect(fresh.chat.sessionId).not.toBe(initial.chat.sessionId);
		expect(fresh.chat.messages).toEqual([]);
	});

	it("rejects unauthenticated chat and keeps authentication after validation errors", async () => {
		const client = await connect(newRoom());
		client.send({ type: "send_chat", text: "forbidden" });
		expect((await client.take("error")).message).toBe("Not authenticated");
		await authenticate(client);
		expect((await client.take("name_updated")).name).toBe("Guest");
		for (const message of [{ type: "send_chat", text: "" }, { type: "remove_playlist_item", playlistItemId: "missing" }]) {
			client.send(message);
			await client.take("error");
		}
		client.send({ type: "set_name", name: "  New 🦊  " });
		expect((await client.take("name_updated")).name).toBe("New 🦊");
		client.send({ type: "send_chat", text: "still here" });
		expect((await client.take("chat_message")).message.name).toBe("New 🦊");
	});

	it("rejects duplicate authentication without changing roles or retaining a phantom listener", async () => {
		const room = newRoom();
		const client = await connect(room);
		const initial = await authenticate(client);
		client.send({ type: "authenticate", mode: "admin", password: "qa-admin", name: "admin" });
		expect((await client.take("error")).message).toBe("Already authenticated");
		client.send({ type: "clear_room" });
		expect((await client.take("error")).message).toBe("Admin only.");
		client.socket.close();
		await expect.poll(() => client.socket.readyState).toBe(WebSocket.CLOSED);
		const next = await connect(room);
		expect((await authenticate(next)).chat.sessionId).not.toBe(initial.chat.sessionId);
	});

	it("does not authenticate a queued retry after rejecting a password", async () => {
		const room = newRoom();
		const client = await connect(room);
		client.send({ type: "authenticate", mode: "viewer", password: "incorrect" });
		client.send({ type: "authenticate", mode: "viewer", password: "qa-viewer" });
		expect((await client.take("error")).message).toBe("Invalid stream password");
		await expect.poll(() => client.socket.readyState).toBe(WebSocket.CLOSED);
		expect(client.messages.some((message) => message.type === "authenticated")).toBe(false);
		const next = await connect(room);
		await authenticate(next);
		expect((await next.take("presence")).listenerCount).toBe(1);
	});

	it("preserves the selected rate across real queue switches and removal", async () => {
		const client = await connect(newRoom());
		await authenticate(client, "admin");
		await client.take("state");
		client.send({ type: "set_playback_rate", playbackRate: 1.75, positionSec: 0 });
		await client.take("state");
		client.send({ type: "request_videos", videos: [{ url: "abcdefghijk" }, { url: "lmnopqrstuv" }] });
		const queued = (await client.take("state")).state;
		client.send({ type: "play_playlist_item", playlistItemId: queued.playlist[0].id });
		expect((await client.take("state")).state.playback.playbackRate).toBe(1.75);
		client.send({ type: "next_video" });
		const advanced = (await client.take("state")).state;
		expect(advanced.playback).toMatchObject({ playing: true, playbackRate: 1.75 });
		expect(advanced.currentIndex).toBe(1);
		client.send({ type: "remove_playlist_item", playlistItemId: queued.playlist[1].id });
		expect((await client.take("state")).state.playback.playbackRate).toBe(1.75);
		client.send({ type: "remove_playlist_item", playlistItemId: queued.playlist[0].id });
		const empty = (await client.take("state")).state;
		expect(empty.playlist).toEqual([]);
		expect(empty.playback).toMatchObject({ playing: false, playbackRate: 1.75 });
	});

	it("allows admins to change rates on empty queues and retains them on clear", async () => {
		const client = await connect(newRoom());
		client.send({ type: "authenticate", mode: "admin", password: "qa-admin" });
		await client.take("authenticated");
		await client.take("state");
		client.send({ type: "set_playback_rate", playbackRate: 1.5, positionSec: 0 });
		expect((await client.take("state")).state.playback.playbackRate).toBe(1.5);
		client.send({ type: "clear_room" });
		expect((await client.take("state")).state.playback.playbackRate).toBe(1.5);
	});

	it("keeps a participant authenticated after an actual storage exception", async () => {
		const room = newRoom();
		const client = await connect(room);
		await authenticate(client, "admin");
		await runInDurableObject(room, (_instance, state) => {
			vi.spyOn(state.storage, "put").mockRejectedValueOnce(new Error("storage unavailable"));
		});
		client.send({ type: "clear_room" });
		expect((await client.take("error")).message).toContain("Unable to process");
		client.send({ type: "ping" });
		await client.take("pong");
		client.send({ type: "send_chat", text: "still authenticated" });
		expect((await client.take("chat_message")).message.text).toBe("still authenticated");
	});

	it("resets chat before an empty-room playback save finishes", async () => {
		const room = newRoom();
		const client = await connect(room);
		const initial = await authenticate(client, "admin");
		await client.take("state");
		client.send({ type: "request_videos", videos: [{ url: "abcdefghijk" }] });
		const queued = (await client.take("state")).state;
		client.send({ type: "play_playlist_item", playlistItemId: queued.playlist[0].id });
		expect((await client.take("state")).state.playback.playing).toBe(true);
		client.send({ type: "send_chat", text: "erase me" });
		await client.take("chat_message");
		const next = await connect(room);
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => { release = resolve; });
		let saving = false;
		await runInDurableObject(room, (_instance, state) => {
			vi.spyOn(state.storage, "put").mockImplementationOnce(async () => {
				saving = true;
				await blocked;
			});
		});
		try {
			client.socket.close();
			await expect.poll(() => saving).toBe(true);
			const fresh = await authenticate(next);
			expect(fresh.chat.sessionId).not.toBe(initial.chat.sessionId);
			expect(fresh.chat.messages).toEqual([]);
		} finally {
			release();
		}
	});

	it("accepts catalog GIF-only messages and applies a per-socket flood guard", async () => {
		const client = await connect(newRoom());
		await authenticate(client);
		for (let i = 0; i < 8; i++) {
			client.send({ type: "send_chat", text: "", gifId: CHAT_GIFS[0].id });
			expect((await client.take("chat_message")).message.gifId).toBe(CHAT_GIFS[0].id);
		}
		client.send({ type: "send_chat", text: "too fast" });
		expect((await client.take("error")).message).toContain("quickly");
	});

	it("caps authoritative history at the newest 500 ordered messages", async () => {
		const room = newRoom();
		const client = await connect(room);
		await authenticate(client);
		let now = Date.now();
		vi.spyOn(Date, "now").mockImplementation(() => now);
		for (let i = 0; i < 501; i++) {
			now += 6000;
			client.send({ type: "send_chat", text: String(i) });
			await client.take("chat_message");
		}
		const next = await connect(room);
		const history = (await authenticate(next)).chat.messages;
		expect(history).toHaveLength(500);
		expect(history[0].text).toBe("1");
		expect(history[499].text).toBe("500");
		expect(new Set(history.map((message) => message.id)).size).toBe(500);
		const stored = await runInDurableObject(room, (_instance, state) => state.storage.list());
		expect(stored.size).toBe(0);
	}, 30000);
});
