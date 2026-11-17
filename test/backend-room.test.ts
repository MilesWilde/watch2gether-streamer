import { env } from "cloudflare:workers";
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerMessage } from "../src/stream/messages";
import { CHAT_GIFS } from "../src/stream/chat-media";
import type { StreamRoom } from "../src/stream-room";
import type { ChatSnapshot } from "../src/stream/chat";
import { createDefaultChatProfile } from "../src/stream/chat-profile";

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
	it('keeps the server timeline authoritative and rejects obsolete seek and end commands', async () => {
		const client = await connect(newRoom());
		await authenticate(client, 'admin');
		await client.take('state');
		client.send({ type: 'request_videos', videos: [{ url: 'abcdefghijk' }, { url: 'lmnopqrstuv' }] });
		let snapshot = (await client.take('state')).state;
		const context = () => ({ playlistItemId: snapshot.playlist[snapshot.currentIndex].id, playbackUpdatedAtMs: snapshot.playback.updatedAtMs });
		client.send({ type: 'seek_video', positionSec: 2260, ...context() });
		snapshot = (await client.take('state')).state;
		expect(snapshot.playback.positionSec).toBe(2260);
		client.send({ type: 'play_video', positionSec: 0 });
		snapshot = (await client.take('state')).state;
		expect(snapshot.playback).toMatchObject({ playing: true, positionSec: 2260 });
		const playingAnchor = snapshot.playback;
		client.send({ type: 'play_video', positionSec: 5 });
		snapshot = (await client.take('state')).state;
		expect(snapshot.playback).toEqual(playingAnchor);
		client.send({ type: 'pause_video', positionSec: 5 });
		snapshot = (await client.take('state')).state;
		expect(snapshot.playback.positionSec).toBeGreaterThanOrEqual(2260);
		client.send({ type: 'set_playback_rate', positionSec: 5, playbackRate: 2 });
		snapshot = (await client.take('state')).state;
		expect(snapshot.playback.positionSec).toBeGreaterThanOrEqual(2260);
		const oldContext = context();
		client.send({ type: 'seek_video', positionSec: 30, ...oldContext });
		snapshot = (await client.take('state')).state;
		expect(snapshot.playback.positionSec).toBe(30);
		client.send({ type: 'seek_video', positionSec: 2260, ...oldContext });
		expect((await client.take('state')).state).toEqual(snapshot);
		client.send({ type: 'next_video', ...oldContext });
		expect((await client.take('state')).state).toEqual(snapshot);
		client.send({ type: 'next_video', ...context() });
		snapshot = (await client.take('state')).state;
		expect(snapshot.currentIndex).toBe(1);
		client.send({ type: 'seek_video', positionSec: 2260, ...oldContext });
		expect((await client.take('state')).state).toEqual(snapshot);
	});
	it('prevents viewers from seeking the room timeline', async () => {
		const client = await connect(newRoom());
		await authenticate(client);
		client.send({ type: 'seek_video', positionSec: 10, playlistItemId: 'item', playbackUpdatedAtMs: 1 });
		expect((await client.take('error')).message).toBe('Admin only.');
	});
	it("shares only server-owned profiles on live messages and reconnect history", async () => {
		const room = newRoom();
		const first = await connect(room);
		const profile = { ...createDefaultChatProfile(), eyes: "hearts", robotColor: "f5a8d2", nameColor: "f5b6d2" };
		first.send({ type: "authenticate", mode: "viewer", password: "qa-viewer", name: "Robot 🐱", profile });
		await first.take("authenticated");
		const ack = await first.take("name_updated");
		expect(ack).toEqual({ type: "name_updated", name: "Robot 🐱", profile });
		await first.take("chat_history");
		const peer = await connect(room);
		await authenticate(peer);
		first.send({ type: "send_chat", text: "my robot", profile: createDefaultChatProfile(), name: "forged" });
		const sent = (await first.take("chat_message")).message;
		expect(sent).toMatchObject({ name: "Robot 🐱", profile });
		expect((await peer.take("chat_message")).message).toEqual(sent);
		const returned = await connect(room);
		expect((await authenticate(returned)).chat.messages).toEqual([sent]);
	});
	it("requires authentication for profile updates and preserves historical profile snapshots", async () => {
		const client = await connect(newRoom());
		const profile = createDefaultChatProfile();
		client.send({ type: "set_profile", name: "Before auth", profile });
		expect((await client.take("error")).message).toBe("Not authenticated");
		await authenticate(client);
		await client.take("name_updated");
		client.send({ type: "send_chat", text: "before" });
		const before = (await client.take("chat_message")).message;
		expect(before.profile).toEqual(profile);
		const next = { ...profile, eyes: "dizzy", nameColor: "d1bfff" };
		client.send({ type: "set_profile", name: "  New 🤖  ", profile: next });
		expect(await client.take("name_updated")).toEqual({ type: "name_updated", name: "New 🤖", profile: next });
		client.send({ type: "send_chat", text: "after" });
		const after = (await client.take("chat_message")).message;
		expect(after).toMatchObject({ name: "New 🤖", profile: next, senderId: before.senderId });
		expect(before.profile).toEqual(profile);
		client.send({ type: "set_profile", name: "Invalid", profile: { ...next, nameColor: "url(evil)" } });
		expect((await client.take("error")).message).toBe("Invalid message");
		client.send({ type: "send_chat", text: "still valid" });
		expect((await client.take("chat_message")).message).toMatchObject({ name: "New 🤖", profile: next });
		client.send({ type: "set_name", name: "Legacy rename" });
		expect(await client.take("name_updated")).toEqual({ type: "name_updated", name: "Legacy rename", profile: next });
		client.send({ type: "send_chat", text: "after legacy rename" });
		expect((await client.take("chat_message")).message).toMatchObject({ name: "Legacy rename", profile: next });
	});
	it("retains a sole participant's chat during reconnect and cancels pending cleanup", async () => {
		const room = newRoom();
		const first = await connect(room);
		const initial = await authenticate(first);
		first.send({ type: "send_chat", text: "keep this through reconnect" });
		const sent = (await first.take("chat_message")).message;
		first.socket.close();
		await expect.poll(() => first.socket.readyState).toBe(WebSocket.CLOSED);
		expect(await runInDurableObject(room, (_instance, state) => state.storage.getAlarm())).not.toBeNull();
		const returned = await connect(room);
		expect((await authenticate(returned)).chat).toEqual({ sessionId: initial.chat.sessionId, messages: [sent] });
		await expect.poll(() => runInDurableObject(room, (_instance, state) => state.storage.getAlarm())).toBeNull();
		expect(await runDurableObjectAlarm(room)).toBe(false);
	});
	it("serializes a delayed alarm write, return cancellation and a later disconnect deadline", async () => {
		const room = newRoom();
		const first = await connect(room);
		const initial = await authenticate(first);
		first.send({ type: "send_chat", text: "retain until the final deadline" });
		const sent = (await first.take("chat_message")).message;
		const startedAt = Date.now();
		const clock = vi.spyOn(Date, "now").mockReturnValue(startedAt);
		const operations: string[] = [];
		let release!: () => void;
		const blocked = new Promise<void>(resolve => { release = resolve; });
		await runInDurableObject(room, (_instance, state) => {
			const setAlarm = state.storage.setAlarm.bind(state.storage);
			const deleteAlarm = state.storage.deleteAlarm.bind(state.storage);
			let firstWrite = true;
			vi.spyOn(state.storage, "setAlarm").mockImplementation(async (...args) => {
				operations.push(`schedule:${Number(args[0])}`);
				if (firstWrite) { firstWrite = false; await blocked; }
				await setAlarm(...args);
			});
			vi.spyOn(state.storage, "deleteAlarm").mockImplementation(async (...args) => {
				operations.push("cancel");
				await deleteAlarm(...args);
			});
		});
		try {
			first.socket.close();
			await expect.poll(() => operations.length).toBe(1);
			expect(operations).toEqual([`schedule:${startedAt + 60_000}`]);
			const returned = await connect(room);
			expect((await authenticate(returned)).chat).toEqual({ sessionId: initial.chat.sessionId, messages: [sent] });
			clock.mockReturnValue(startedAt + 10_000);
			returned.socket.close();
			await expect.poll(() => returned.socket.readyState).toBe(WebSocket.CLOSED);
			await runInDurableObject(room, instance => {
				expect(Reflect.get(instance, "chatCleanupAt")).toBe(startedAt + 70_000);
			});
			expect(operations).toEqual([`schedule:${startedAt + 60_000}`]);
		} finally {
			release();
		}
		await runInDurableObject(room, async (instance, state) => {
			await Reflect.get(instance, "chatAlarmTask");
			expect(operations).toEqual([`schedule:${startedAt + 60_000}`, "cancel", `schedule:${startedAt + 70_000}`]);
			expect(await state.storage.getAlarm()).toBe(startedAt + 70_000);
		});
		clock.mockReturnValue(startedAt + 60_001);
		expect(await runDurableObjectAlarm(room)).toBe(true);
		await runInDurableObject(room, (instance, state) => {
			expect(Reflect.get(instance, "chat")).toEqual({ sessionId: initial.chat.sessionId, messages: [sent] });
			return expect(state.storage.getAlarm()).resolves.toBe(startedAt + 70_000);
		});
		clock.mockReturnValue(startedAt + 70_001);
		expect(await runDurableObjectAlarm(room)).toBe(true);
		const next = await connect(room);
		const fresh = await authenticate(next);
		expect(fresh.chat.sessionId).not.toBe(initial.chat.sessionId);
		expect(fresh.chat.messages).toEqual([]);
	});
	it.each(["unauthenticated", "viewer", "admin"])("does not let a %s connection cancel or extend pending grace", async mode => {
		const log = vi.spyOn(console, "info").mockImplementation(() => {});
		const room = newRoom();
		const first = await connect(room);
		const initial = await authenticate(first);
		first.send({ type: "send_chat", text: "must still expire" });
		const sent = (await first.take("chat_message")).message;
		first.socket.close();
		await expect.poll(() => first.socket.readyState).toBe(WebSocket.CLOSED);
		const deadline = await runInDurableObject(room, (_instance, state) => state.storage.getAlarm());
		expect(deadline).not.toBeNull();
		vi.spyOn(Date, "now").mockReturnValue(deadline! - 10_000);
		const outsider = await connect(room);
		if (mode === "unauthenticated") {
			outsider.send({ type: "ping" });
			expect((await outsider.take("error")).message).toBe("Not authenticated");
			outsider.socket.close(1000, "User left room");
		} else {
			outsider.send({ type: "authenticate", mode, password: "incorrect" });
			expect((await outsider.take("error")).message).toBe(`Invalid ${mode === "admin" ? "admin" : "stream"} password`);
		}
		await expect.poll(() => outsider.socket.readyState).toBe(WebSocket.CLOSED);
		await runInDurableObject(room, async (instance, state) => {
			expect(Reflect.get(instance, "chatCleanupAt")).toBe(deadline);
			expect(await state.storage.getAlarm()).toBe(deadline);
			expect(Reflect.get(instance, "chat")).toEqual({ sessionId: initial.chat.sessionId, messages: [sent] });
		});
		const events = log.mock.calls.filter(call => call[0] === "[watchparty:room]")
			.map(call => call[1]).filter(event => event.sessionId === initial.chat.sessionId || event.previousSessionId === initial.chat.sessionId);
		expect(events.filter(event => event.event === "chat_cleanup_cancelled" || event.event === "chat_reset")).toEqual([]);
		expect(events.filter(event => event.event === "chat_cleanup_scheduled")).toHaveLength(1);
		vi.mocked(Date.now).mockReturnValue(deadline! + 1);
		expect(await runDurableObjectAlarm(room)).toBe(true);
		const next = await connect(room);
		const fresh = await authenticate(next);
		expect(fresh.chat.sessionId).not.toBe(initial.chat.sessionId);
		expect(fresh.chat.messages).toEqual([]);
	});
	it.each([
		{ code: 1000, reason: "User left room", deliberate: true },
		{ code: 1001, reason: "User left room", deliberate: false },
		{ code: 1008, reason: "User left room", deliberate: false },
		{ code: 1000, reason: "user left room", deliberate: false },
		{ code: 1000, reason: "User left room ", deliberate: false },
		{ code: 1000, reason: "", deliberate: false },
	])("treats compatibility close $code '$reason' as deliberate=$deliberate", async ({ code, reason, deliberate }) => {
		const room = newRoom();
		const client = await connect(room);
		const initial = await authenticate(client);
		client.send({ type: "send_chat", text: "compatibility close history" });
		const sent = (await client.take("chat_message")).message;
		await runInDurableObject(room, async (instance, state) => {
			const [server] = Reflect.get(instance, "authenticatedSockets") as Set<WebSocket>;
			server.dispatchEvent(new CloseEvent("close", { code, reason, wasClean: true }));
			const chat = Reflect.get(instance, "chat") as ChatSnapshot;
			await Reflect.get(instance, "chatAlarmTask");
			if (deliberate) {
				expect(chat.sessionId).not.toBe(initial.chat.sessionId);
				expect(chat.messages).toEqual([]);
				expect(await state.storage.getAlarm()).toBeNull();
			} else {
				expect(chat).toEqual({ sessionId: initial.chat.sessionId, messages: [sent] });
				expect(await state.storage.getAlarm()).not.toBeNull();
			}
		});
	});
	it.each(["leave", "compatibility close", "error"])("resets exactly once after %s followed by duplicate leave/error/close events", async firstEvent => {
		const log = vi.spyOn(console, "info").mockImplementation(() => {});
		const room = newRoom();
		const client = await connect(room);
		const initial = await authenticate(client);
		client.send({ type: "send_chat", text: "clear exactly once" });
		const sent = (await client.take("chat_message")).message;
		const deadline = await runInDurableObject(room, async (instance, state) => {
			const [server] = Reflect.get(instance, "authenticatedSockets") as Set<WebSocket>;
			const leave = () => server.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "leave" }) }));
			const close = () => server.dispatchEvent(new CloseEvent("close", { code: 1000, reason: "User left room", wasClean: true }));
			if (firstEvent === "leave") leave();
			else if (firstEvent === "compatibility close") close();
			else server.dispatchEvent(new Event("error"));
			const afterFirst = Reflect.get(instance, "chat") as ChatSnapshot;
			for (let i = 0; i < 2; i++) { leave(); server.dispatchEvent(new Event("error")); close(); }
			expect(Reflect.get(instance, "chat")).toBe(afterFirst);
			if (firstEvent === "error") expect(afterFirst).toEqual({ sessionId: initial.chat.sessionId, messages: [sent] });
			else {
				expect(afterFirst.sessionId).not.toBe(initial.chat.sessionId);
				expect(afterFirst.messages).toEqual([]);
			}
			await Reflect.get(instance, "chatAlarmTask");
			return state.storage.getAlarm();
		});
		if (firstEvent === "error") {
			expect(deadline).not.toBeNull();
			vi.spyOn(Date, "now").mockReturnValue(deadline! + 1);
			expect(await runDurableObjectAlarm(room)).toBe(true);
		} else expect(deadline).toBeNull();
		expect(await runDurableObjectAlarm(room)).toBe(false);
		const events = log.mock.calls.filter(call => call[0] === "[watchparty:room]")
			.map(call => call[1]).filter(event => event.sessionId === initial.chat.sessionId || event.previousSessionId === initial.chat.sessionId);
		expect(events.filter(event => event.event === "socket_disconnected")).toHaveLength(1);
		expect(events.filter(event => event.event === "chat_cleanup_scheduled")).toHaveLength(firstEvent === "error" ? 1 : 0);
		expect(events.filter(event => event.event === "chat_reset")).toEqual([
			expect.objectContaining({ cause: firstEvent === "error" ? "empty_room_grace_expired" : "last_participant_left", previousSessionId: initial.chat.sessionId, clearedMessageCount: 1 })
		]);
	});
	it("clears an empty room only after the 60-second grace deadline", async () => {
		const room = newRoom();
		const first = await connect(room);
		const initial = await authenticate(first);
		first.send({ type: "send_chat", text: "expires after the grace period" });
		await first.take("chat_message");
		const now = Date.now();
		first.socket.close();
		await expect.poll(() => first.socket.readyState).toBe(WebSocket.CLOSED);
		expect(await runDurableObjectAlarm(room)).toBe(true);
		await runInDurableObject(room, instance => {
			const chat: ChatSnapshot = Reflect.get(instance, "chat");
			expect(chat.sessionId).toBe(initial.chat.sessionId);
			expect(chat.messages).toHaveLength(1);
		});
		vi.spyOn(Date, "now").mockReturnValue(now + 60_100);
		expect(await runDurableObjectAlarm(room)).toBe(true);
		const next = await connect(room);
		const fresh = await authenticate(next);
		expect(fresh.chat.sessionId).not.toBe(initial.chat.sessionId);
		expect(fresh.chat.messages).toEqual([]);
	});
	it("does not revive expired history if authentication wins the race with the cleanup alarm", async () => {
		const room = newRoom();
		const first = await connect(room);
		const initial = await authenticate(first);
		first.send({ type: "send_chat", text: "expired" });
		await first.take("chat_message");
		const now = Date.now();
		first.socket.close();
		await expect.poll(() => first.socket.readyState).toBe(WebSocket.CLOSED);
		vi.spyOn(Date, "now").mockReturnValue(now + 60_100);
		const next = await connect(room);
		const fresh = await authenticate(next);
		expect(fresh.chat.sessionId).not.toBe(initial.chat.sessionId);
		expect(fresh.chat.messages).toEqual([]);
	});
	it("only honors explicit leave from authenticated participants and keeps other participants' history", async () => {
		const room = newRoom();
		const first = await connect(room);
		const second = await connect(room);
		const outsider = await connect(room);
		const initial = await authenticate(first);
		await authenticate(second);
		first.send({ type: "send_chat", text: "still occupied" });
		const sent = (await first.take("chat_message")).message;
		await second.take("chat_message");
		outsider.send({ type: "leave" });
		expect((await outsider.take("error")).message).toBe("Not authenticated");
		first.send({ type: "leave" });
		await expect.poll(() => first.socket.readyState).toBe(WebSocket.CLOSED);
		expect((await authenticate(outsider)).chat).toEqual({ sessionId: initial.chat.sessionId, messages: [sent] });
	});
	it("logs disconnect and cleanup causes without credentials, chat text or peer-supplied close reasons", async () => {
		const log = vi.spyOn(console, "info").mockImplementation(() => {});
		const room = newRoom();
		const client = await connect(room);
		await authenticate(client, "viewer", "Private display name");
		client.send({ type: "send_chat", text: "Private message contents" });
		await client.take("chat_message");
		client.socket.close(1000, "Private close reason");
		await expect.poll(() => client.socket.readyState).toBe(WebSocket.CLOSED);
		await runInDurableObject(room, () => {});
		const events = log.mock.calls.filter(call => call[0] === "[watchparty:room]").map(call => call[1]);
		expect(events).toContainEqual(expect.objectContaining({ event: "socket_disconnected", cause: "socket_close", code: 1000, wasAuthenticated: true }));
		expect(events).toContainEqual(expect.objectContaining({ event: "chat_cleanup_scheduled", graceMs: 60_000 }));
		const encoded = JSON.stringify(events);
		for (const privateValue of ["Private display name", "Private message contents", "Private close reason", "qa-viewer"]) expect(encoded).not.toContain(privateValue);
	});
	it("logs late close metadata once after socket errors without repeating cleanup", async () => {
		const log = vi.spyOn(console, "info").mockImplementation(() => {});
		const room = newRoom();
		const client = await connect(room);
		const initial = await authenticate(client);
		await runInDurableObject(room, instance => {
			const accepted: Set<WebSocket> = Reflect.get(instance, "authenticatedSockets");
			const [server] = accepted;
			server.dispatchEvent(new Event("error"));
			for (let index = 0; index < 2; index++) server.dispatchEvent(new CloseEvent("close", { code: 1011, reason: "Private reason", wasClean: false }));
		});
		const events = log.mock.calls.filter(call => call[0] === "[watchparty:room]").map(call => call[1]);
		expect(events.filter(event => event.event === "socket_closed")).toEqual([
			expect.objectContaining({ code: 1011, reason: "Peer reason omitted", wasClean: false })
		]);
		expect(events.filter(event => event.event === "socket_disconnected")).toHaveLength(1);
		expect(events.filter(event => event.event === "chat_cleanup_scheduled")).toHaveLength(1);
		expect(JSON.stringify(events)).not.toContain("Private reason");
		await runInDurableObject(room, instance => expect((Reflect.get(instance, "chat") as ChatSnapshot).sessionId).toBe(initial.chat.sessionId));
	});
	it("assigns opaque per-socket sender IDs stable across renames and duplicate authentication", async () => {
		const room = newRoom();
		const first = await connect(room);
		const second = await connect(room);
		first.send({ type: "authenticate", mode: "viewer", password: "qa-viewer", name: "Same", senderId: "forged" });
		const authenticated = await first.take("authenticated");
		await first.take("chat_history");
		await authenticate(second, "viewer", "Same");
		first.send({ type: "send_chat", text: "first", senderId: "forged" });
		const sent = (await first.take("chat_message")).message;
		expect(sent).toHaveProperty("senderId", expect.any(String));
		expect(sent.senderId).toMatch(/^[0-9a-f-]{36}$/);
		expect(authenticated.senderId).toBe(sent.senderId);
		expect(sent.senderId).not.toBe("forged");
		expect(sent.senderId).not.toBe(sent.sessionId);
		expect(sent.senderId).not.toBe(sent.id);
		expect((await second.take("chat_message")).message).toEqual(sent);
		second.send({ type: "send_chat", text: "second", senderId: sent.senderId });
		const other = (await second.take("chat_message")).message;
		expect(other.name).toBe(sent.name);
		expect(other.senderId).toEqual(expect.any(String));
		expect(other.senderId).not.toBe(sent.senderId);
		await first.take("chat_message");
		first.send({ type: "set_name", name: "Renamed", senderId: "replacement" });
		await first.take("name_updated");
		first.send({ type: "authenticate", mode: "viewer", password: "qa-viewer" });
		await first.take("error");
		first.send({ type: "send_chat", text: "renamed" });
		const renamed = (await first.take("chat_message")).message;
		expect(renamed).toMatchObject({ name: "Renamed", senderId: sent.senderId });
		first.socket.close();
		await expect.poll(() => first.socket.readyState).toBe(WebSocket.CLOSED);
		await runInDurableObject(room, instance => {
			const ids: Map<WebSocket, string> = Reflect.get(instance, "socketSenderIds");
			expect([...ids.values()]).toEqual([other.senderId]);
		});
		const rejoined = await connect(room);
		expect((await authenticate(rejoined, "viewer", "Renamed")).chat.messages).toEqual([sent, other, renamed]);
		rejoined.send({ type: "send_chat", text: "rejoined" });
		const fresh = (await rejoined.take("chat_message")).message;
		expect(fresh.senderId).toEqual(expect.any(String));
		expect([sent.senderId, other.senderId]).not.toContain(fresh.senderId);
	});

	it("broadcasts live GIF identifiers only, acknowledges them, and retains the flood guard", async () => {
		const room = newRoom();
		const client = await connect(room);
		await authenticate(client);
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		for (let i = 0; i < 8; i++) {
			client.send({ type: "send_chat", text: "", gifId: "giphy:Ab0123", gifUrl: "https://evil.test/a.gif", requestId: `gif-${i}` });
			const result = await client.take("chat_result");
			expect(result).toEqual({ type: "chat_result", requestId: `gif-${i}`, accepted: true });
			const item = (await client.take("chat_message")).message;
			expect(item).toMatchObject({ text: "", gifId: "giphy:Ab0123", senderId: expect.any(String) });
			expect(item).not.toHaveProperty("gifUrl");
		}
		expect(fetchSpy).not.toHaveBeenCalled();
		client.send({ type: "send_chat", text: "", gifId: "giphy:Ab0123", requestId: "ninth" });
		expect(await client.take("chat_result")).toMatchObject({ accepted: false, message: expect.stringContaining("quickly") });
		const peer = await connect(room);
		const history = (await authenticate(peer)).chat.messages;
		expect(history).toHaveLength(8);
		expect(history.every(item => item.gifId === "giphy:Ab0123")).toBe(true);
	});
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
			expect(chat.sessionId).toBe(initial.chat.sessionId);
			expect(chat.messages.map(message => message.text)).toEqual(["old identity"]);
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
			expect(chat.messages.map(message => message.text)).toEqual(["old identity"]);
			for (const key of ["sockets", "authenticatedSockets", "socketRoles", "socketNames", "socketProfiles", "socketSenderIds", "chatFloodWindows", "socketOpenedAt", "socketLastPingAt"]) {
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
		first.send({ type: "leave" });
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
		client.send({ type: "leave" });
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
			client.send({ type: "leave" });
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
