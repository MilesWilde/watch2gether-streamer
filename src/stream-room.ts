import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import type { ServerMessage } from "./stream/messages";
import { createChatSnapshot, MAX_CHAT_MESSAGES, normalizeChatName, type ChatSnapshot } from "./stream/chat";
import { createDefaultChatProfile, type ChatProfile } from "./stream/chat-profile";
import { getChatRequestId, parseClientMessage } from "./stream/messages";
import {
    createEmptyStreamState,
    createStoppedPlaybackState,
    createPlaylistItemFromInput,
    createPlaylistItemFromRequest,
    createVideoRequestFromInput,
    createVideoRequestFromUrl,
    extractYouTubeVideoId,
    moveToNextPlaylistItem,
    normalizeStreamState,
    removePlaylistItem,
    type StreamState,
    type UserRole
} from "./stream/playlist";
import {
    broadcastMessage,
    createSocketPair,
    sendMessage
} from "./stream/sockets";
import { fetchYouTubeMetadata } from "./stream/youtube";
import { updatePlayback } from "./stream/playback";

const STREAM_STATE_STORAGE_KEY = "stream-state";
const CHAT_RECONNECT_GRACE_MS = 60_000;

export class StreamRoom extends DurableObject<Env> {
    private readonly sockets = new Set<WebSocket>();
    private readonly authenticatedSockets = new Set<WebSocket>();
    private readonly socketRoles = new Map<WebSocket, UserRole>();
    private readonly socketNames = new Map<WebSocket, string>();
    private readonly socketProfiles = new Map<WebSocket, ChatProfile>();
    private readonly socketSenderIds = new Map<WebSocket, string>();
    private readonly chatFloodWindows = new Map<WebSocket, { startedAtMs: number; count: number }>();
    private readonly socketOpenedAt = new Map<WebSocket, number>();
    private readonly socketLastPingAt = new Map<WebSocket, number>();
    private readonly appEnv: Env;

    private streamState: StreamState = createEmptyStreamState();
    private initialized = false;
    private chat: ChatSnapshot = createChatSnapshot();
    private chatCleanupAt: number | null = null;
    private chatAlarmTask: Promise<void> = Promise.resolve();

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        this.appEnv = env;
        this.logChatEvent("room_initialized", { cause: "actor_started" });
    }

    async fetch(request: Request): Promise<Response> {
        await this.initialize();

        if (request.headers.get("Upgrade") !== "websocket") {
            return new Response("Expected WebSocket", { status: 426 });
        }

        const { client, server } = createSocketPair();

        server.accept();
        this.sockets.add(server);
        this.socketOpenedAt.set(server, Date.now());

        server.addEventListener("message", (event) => {
            void this.onMessage(server, event.data).catch(() => {
                if (this.sockets.has(server)) {
                    this.rejectChatOrError(server, event.data, "Unable to process message. Please try again.");
                }
            });
        });

        let closeLogged = false;
        server.addEventListener("close", (event) => {
            const details = {
                code: event.code,
                reason: event.reason === "User left room" ? event.reason : event.reason ? "Peer reason omitted" : "",
                wasClean: event.wasClean,
                deliberate: event.code === 1000 && event.reason === "User left room"
            };
            // Close metadata can arrive after an error has already removed the socket.
            if (!closeLogged) {
                closeLogged = true;
                this.logChatEvent("socket_closed", details);
            }
            this.onDisconnect(server, "socket_close", details);
        });

        server.addEventListener("error", () => {
            this.onDisconnect(server, "socket_error");
        });

        return new Response(null, {
            status: 101,
            webSocket: client
        });
    }

    private async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        const storedState =
            await this.ctx.storage.get<StreamState>(STREAM_STATE_STORAGE_KEY);

        this.streamState = normalizeStreamState(storedState);
        this.initialized = true;
    }

    private async onMessage(socket: WebSocket, raw: unknown): Promise<void> {
        if (!this.sockets.has(socket) || socket.readyState !== WebSocket.OPEN) {
            return;
        }

        const message = parseClientMessage(raw);

        if (!message) {
            this.rejectChatOrError(socket, raw, "Invalid message");
            return;
        }

        switch (message.type) {
            case "authenticate":
                this.authenticate(socket, message.mode, message.password, message.name, message.profile);
                break;

            case "set_name":
                this.requireAuthenticated(socket, () => {
                    this.socketNames.set(socket, message.name);
                    this.send(socket, { type: "name_updated", name: message.name, profile: this.socketProfiles.get(socket) ?? createDefaultChatProfile() });
                });
                break;

            case "set_profile":
                this.requireAuthenticated(socket, () => {
                    this.socketNames.set(socket, message.name);
                    this.socketProfiles.set(socket, message.profile);
                    this.send(socket, { type: "name_updated", name: message.name, profile: message.profile });
                });
                break;

            case "send_chat":
                this.requireAuthenticated(socket, () => {
                    this.sendChat(socket, message.text, message.gifId, message.requestId);
                });
                break;

            case "leave":
                this.requireAuthenticated(socket, () => {
                    this.onDisconnect(socket, "explicit_leave", { deliberate: true, code: 1000, reason: "User left room" });
                });
                break;

            case "ping":
                this.requireAuthenticated(socket, () => {
                    this.socketLastPingAt.set(socket, Date.now());
                    this.send(socket, {
                        type: "pong",
                        serverNowMs: Date.now()
                    });
                });
                break;

            case "request_video":
                await this.requireAuthenticatedAsync(socket, async () => {
                    await this.requestVideo(socket, message.url);
                });
                break;

            case "request_videos":
                await this.requireAuthenticatedAsync(socket, async () => {
                    await this.requestVideos(socket, message.videos);
                });
                break;

            case "approve_request":
                await this.requireAdminAsync(socket, async () => {
                    await this.approveRequest(socket, message.requestId);
                });
                break;

            case "deny_request":
                await this.requireAdminAsync(socket, async () => {
                    await this.denyRequest(socket, message.requestId);
                });
                break;

            case "remove_playlist_item":
                await this.requireAdminAsync(socket, async () => {
                    await this.removePlaylistItem(socket, message.playlistItemId);
                });
                break;

            case "play_playlist_item":
                await this.requireAdminAsync(socket, async () => {
                    await this.playPlaylistItem(socket, message.playlistItemId);
                });
                break;

            case "play_video":
                await this.requireAdminAsync(socket, async () => {
                    await this.setPlayback(true);
                });
                break;

            case "pause_video":
                await this.requireAdminAsync(socket, async () => {
                    await this.setPlayback(false);
                });
                break;

            case "set_playback_rate":
                await this.requireAdminAsync(socket, async () => {
                    await this.setPlaybackRate(message.playbackRate);
                });
                break;

            case "seek_video":
                await this.requireAdminAsync(socket, async () => {
                    if (!this.matchesPlaybackContext(socket, message)) return;
                    this.streamState = {
                        ...this.streamState,
                        playback: updatePlayback(this.streamState.playback, { positionSec: message.positionSec }, Date.now()),
                    };
                    await this.saveStreamState();
                    this.broadcastState();
                });
                break;

            case "next_video":
                await this.requireAdminAsync(socket, async () => {
                    if (message.playlistItemId !== undefined && !this.matchesPlaybackContext(socket, message)) return;
                    await this.nextVideo();
                });
                break;

            case "clear_room":
                await this.requireAdminAsync(socket, async () => {
                    await this.clearRoom();
                });
                break;
        }
    }

    private authenticate(
        socket: WebSocket,
        mode: "viewer" | "admin",
        password: string,
        name?: string,
        profile?: ChatProfile
    ): void {
        if (this.isAuthenticated(socket)) {
            this.send(socket, { type: "error", message: "Already authenticated" });
            return;
        }

        const expectedViewerPassword = this.appEnv.ROOM_PASSWORD;
        const expectedAdminPassword = this.appEnv.ADMIN_PASSWORD;

        if (mode === "viewer") {
            if (!expectedViewerPassword) {
                this.send(socket, {
                    type: "error",
                    message:
                        "Stream password is not configured. Add ROOM_PASSWORD to .dev.vars and restart Wrangler."
                });

                socket.close(1011, "Stream password is not configured");
                return;
            }

            if (password !== expectedViewerPassword) {
                this.send(socket, {
                    type: "error",
                    message: "Invalid stream password"
                });

                socket.close(1008, "Invalid stream password");
                return;
            }

            this.finishAuthentication(socket, "viewer", name, profile);
            return;
        }

        if (!expectedAdminPassword) {
            this.send(socket, {
                type: "error",
                message:
                    "Admin password is not configured. Add ADMIN_PASSWORD to .dev.vars and restart Wrangler."
            });

            socket.close(1011, "Admin password is not configured");
            return;
        }

        if (password !== expectedAdminPassword) {
            this.send(socket, {
                type: "error",
                message: "Invalid admin password"
            });

            socket.close(1008, "Invalid admin password");
            return;
        }

        this.finishAuthentication(socket, "admin", name, profile);
    }

    private finishAuthentication(socket: WebSocket, role: UserRole, name?: string, profile?: ChatProfile): void {
        this.expireEmptyChat();
        if (this.chatCleanupAt !== null) {
            this.chatCleanupAt = null;
            this.updateChatAlarm(null);
            this.logChatEvent("chat_cleanup_cancelled", { cause: "participant_returned" });
        }
        this.authenticatedSockets.add(socket);
        this.socketRoles.set(socket, role);
        this.socketNames.set(socket, normalizeChatName(name));
        this.socketProfiles.set(socket, profile ?? createDefaultChatProfile());
        this.socketSenderIds.set(socket, crypto.randomUUID());

        this.send(socket, {
            type: "authenticated",
            role,
            listenerCount: this.authenticatedSockets.size,
            serverNowMs: Date.now(),
            senderId: this.socketSenderIds.get(socket)
        });

        this.sendState(socket);
        this.send(socket, { type: "name_updated", name: this.socketNames.get(socket) ?? "Guest", profile: this.socketProfiles.get(socket) });
        this.send(socket, { type: "chat_history", chat: this.chat });
        this.broadcastPresence();
    }

    private rejectChatOrError(socket: WebSocket, raw: unknown, message: string): void {
		const requestId = getChatRequestId(raw);
		if (requestId && this.authenticatedSockets.has(socket)) {
			this.send(socket, { type: "chat_result", requestId, accepted: false, message });
		} else {
			this.send(socket, { type: "error", message });
		}
    }

    private sendChat(socket: WebSocket, text: string, gifId?: string, requestId?: string): void {
        const now = Date.now();
        const previous = this.chatFloodWindows.get(socket);
        const window = previous && now - previous.startedAtMs < 5000
            ? previous
            : { startedAtMs: now, count: 0 };

        if (window.count >= 8) {
            const message = "Messages are arriving too quickly. Please wait a moment.";
            this.send(socket, requestId ? { type: "chat_result", requestId, accepted: false, message } : { type: "error", message });
            return;
        }

        window.count++;
        this.chatFloodWindows.set(socket, window);

        const message = {
            id: crypto.randomUUID(),
            sessionId: this.chat.sessionId,
            senderId: this.socketSenderIds.get(socket)!,
            name: this.socketNames.get(socket) ?? "Guest",
            profile: this.socketProfiles.get(socket) ?? createDefaultChatProfile(),
            text,
            ...(gifId ? { gifId } : {}),
            sentAtMs: now
        };

        this.chat.messages.push(message);
        if (this.chat.messages.length > MAX_CHAT_MESSAGES) {
            this.chat.messages.splice(0, this.chat.messages.length - MAX_CHAT_MESSAGES);
        }
        this.broadcast({ type: "chat_message", message });
        if (requestId) this.send(socket, { type: "chat_result", requestId, accepted: true });
    }

    private async requestVideo(socket: WebSocket, url: string): Promise<void> {
        const videoId = extractYouTubeVideoId(url);

        if (!videoId) {
            this.send(socket, {
                type: "error",
                message: "Please enter a valid YouTube URL."
            });
            return;
        }

        const metadata = await fetchYouTubeMetadata(videoId);
        const request = createVideoRequestFromUrl(url, metadata?.title);

        if (!request) {
            this.send(socket, {
                type: "error",
                message: "Please enter a valid YouTube URL."
            });
            return;
        }

        if (this.socketRoles.get(socket) === "admin") {
            const playlistItem = createPlaylistItemFromRequest(request);

            this.streamState = {
                ...this.streamState,
                playlist: [...this.streamState.playlist, playlistItem]
            };
        } else {
            this.streamState = {
                ...this.streamState,
                requests: [...this.streamState.requests, request]
            };
        }

        await this.saveStreamState();
        this.broadcastState();
    }

    private async requestVideos(
        socket: WebSocket,
        videos: { url: string; title?: string }[]
    ): Promise<void> {
        const role = this.socketRoles.get(socket);

        if (role === "admin") {
            const playlistItems = videos
                .map(createPlaylistItemFromInput)
                .filter((item): item is NonNullable<typeof item> => item !== null);

            if (playlistItems.length === 0) {
                this.send(socket, {
                    type: "error",
                    message: "No valid YouTube videos found."
                });
                return;
            }

            this.streamState = {
                ...this.streamState,
                playlist: [...this.streamState.playlist, ...playlistItems]
            };
        } else {
            const requests = videos
                .map(createVideoRequestFromInput)
                .filter((item): item is NonNullable<typeof item> => item !== null);

            if (requests.length === 0) {
                this.send(socket, {
                    type: "error",
                    message: "No valid YouTube videos found."
                });
                return;
            }

            this.streamState = {
                ...this.streamState,
                requests: [...this.streamState.requests, ...requests]
            };
        }

        await this.saveStreamState();
        this.broadcastState();
    }

    private async approveRequest(
        socket: WebSocket,
        requestId: string
    ): Promise<void> {
        const request = this.streamState.requests.find((item) => item.id === requestId);

        if (!request) {
            this.send(socket, {
                type: "error",
                message: "Request not found."
            });
            return;
        }

        const playlistItem = createPlaylistItemFromRequest(request);

        this.streamState = {
            ...this.streamState,
            playlist: [...this.streamState.playlist, playlistItem],
            requests: this.streamState.requests.filter((item) => item.id !== requestId)
        };

        await this.saveStreamState();
        this.broadcastState();
    }

    private async denyRequest(
        socket: WebSocket,
        requestId: string
    ): Promise<void> {
        const requestExists = this.streamState.requests.some(
            (item) => item.id === requestId
        );

        if (!requestExists) {
            this.send(socket, {
                type: "error",
                message: "Request not found."
            });
            return;
        }

        this.streamState = {
            ...this.streamState,
            requests: this.streamState.requests.filter((item) => item.id !== requestId)
        };

        await this.saveStreamState();
        this.broadcastState();
    }

    private async removePlaylistItem(
        socket: WebSocket,
        playlistItemId: string
    ): Promise<void> {
        const nextState = removePlaylistItem(this.streamState, playlistItemId);

        if (!nextState) {
            this.send(socket, {
                type: "error",
                message: "Playlist item not found."
            });
            return;
        }

        this.streamState = nextState;

        await this.saveStreamState();
        this.broadcastState();
    }

    private async playPlaylistItem(
        socket: WebSocket,
        playlistItemId: string
    ): Promise<void> {
        const playlistIndex = this.streamState.playlist.findIndex(
            (item) => item.id === playlistItemId
        );

        if (playlistIndex === -1) {
            this.send(socket, {
                type: "error",
                message: "Playlist item not found."
            });
            return;
        }

        this.streamState = {
            ...this.streamState,
            currentIndex: playlistIndex,
            playback: updatePlayback(this.streamState.playback, { playing: true, positionSec: 0 }, Date.now())
        };

        await this.saveStreamState();
        this.broadcastState();
    }

    private async nextVideo(): Promise<void> {
        const wasPlaying = this.streamState.playback.playing;
        const previousUpdatedAtMs = this.streamState.playback.updatedAtMs;

        this.streamState = moveToNextPlaylistItem(this.streamState);

        if (wasPlaying && this.streamState.playlist.length > 0) {
            this.streamState = {
                ...this.streamState,
                playback: {
                    playing: true,
                    positionSec: 0,
                    playbackRate: this.streamState.playback.playbackRate,
                    updatedAtMs: Date.now()
                }
            };
        }

        this.streamState.playback.updatedAtMs = Math.max(Date.now(), previousUpdatedAtMs + 1);

        await this.saveStreamState();
        this.broadcastState();
    }

    private async clearRoom(): Promise<void> {
        const playbackRate = this.streamState.playback.playbackRate;
        this.streamState = {
            ...createEmptyStreamState(),
            playback: createStoppedPlaybackState(playbackRate)
        };

        await this.saveStreamState();
        this.broadcastState();
    }

    private matchesPlaybackContext(socket: WebSocket, context: { playlistItemId?: string; playbackUpdatedAtMs?: number }): boolean {
        const current = this.streamState.playlist[this.streamState.currentIndex];
        if (current && current.id === context.playlistItemId && this.streamState.playback.updatedAtMs === context.playbackUpdatedAtMs) return true;
        console.info('[watchparty:sync]', {
            event: 'stale_command_rejected', updatedAtMs: this.streamState.playback.updatedAtMs,
            commandUpdatedAtMs: context.playbackUpdatedAtMs,
        });
        this.send(socket, { type: 'state', state: this.streamState });
        return false;
    }

    private async setPlayback(playing: boolean): Promise<void> {
        if (this.streamState.playlist.length === 0) {
            return;
        }

        // Legacy clients may still send periodic clock samples. Repeating a
        // transport state must never reset the timeline or trigger a disk write.
        if (this.streamState.playback.playing === playing) {
            this.broadcastState();
            return;
        }
        this.streamState = {
            ...this.streamState,
            playback: updatePlayback(this.streamState.playback, { playing }, Date.now())
        };

        await this.saveStreamState();
        this.broadcastState();
    }

    private async setPlaybackRate(playbackRate: number): Promise<void> {
        if (this.streamState.playback.playbackRate === playbackRate) {
            this.broadcastState();
            return;
        }
        this.streamState = {
            ...this.streamState,
            playback: updatePlayback(this.streamState.playback, { playbackRate }, Date.now())
        };

        await this.saveStreamState();
        this.broadcastState();
    }

    private async saveStreamState(): Promise<void> {
        await this.ctx.storage.put(STREAM_STATE_STORAGE_KEY, this.streamState);
    }

    private requireAuthenticated(socket: WebSocket, callback: () => void): void {
        if (!this.isAuthenticated(socket)) {
            this.send(socket, {
                type: "error",
                message: "Not authenticated"
            });
            return;
        }

        callback();
    }

    private async requireAuthenticatedAsync(
        socket: WebSocket,
        callback: () => Promise<void>
    ): Promise<void> {
        if (!this.isAuthenticated(socket)) {
            this.send(socket, {
                type: "error",
                message: "Not authenticated"
            });
            return;
        }

        await callback();
    }

    private async requireAdminAsync(
        socket: WebSocket,
        callback: () => Promise<void>
    ): Promise<void> {
        if (!this.isAuthenticated(socket)) {
            this.send(socket, {
                type: "error",
                message: "Not authenticated"
            });
            return;
        }

        if (this.socketRoles.get(socket) !== "admin") {
            this.send(socket, {
                type: "error",
                message: "Admin only."
            });
            return;
        }

        await callback();
    }

    private isAuthenticated(socket: WebSocket): boolean {
        return this.sockets.has(socket) && socket.readyState === WebSocket.OPEN && this.authenticatedSockets.has(socket);
    }

    private logChatEvent(event: string, details: Record<string, unknown> = {}): void {
        console.info("[watchparty:room]", {
            event, at: new Date().toISOString(), sessionId: this.chat.sessionId,
            participants: this.authenticatedSockets.size, messageCount: this.chat.messages.length,
            ...details
        });
    }

    private updateChatAlarm(deadline: number | null): void {
        // Serialize cancellation and scheduling so a returning participant cannot
        // leave an older alarm write racing a later empty-room deadline.
        this.chatAlarmTask = this.chatAlarmTask.catch(() => {}).then(() => deadline === null
            ? this.ctx.storage.deleteAlarm()
            : this.ctx.storage.setAlarm(deadline));
        this.ctx.waitUntil(this.chatAlarmTask.catch(() => {
            this.logChatEvent("chat_alarm_error", { cause: deadline === null ? "cancel_failed" : "schedule_failed" });
        }));
    }

    private resetChat(cause: string): void {
        const previousSessionId = this.chat.sessionId;
        const clearedMessageCount = this.chat.messages.length;
        this.chat = createChatSnapshot();
        this.chatCleanupAt = null;
        this.updateChatAlarm(null);
        this.logChatEvent("chat_reset", { cause, previousSessionId, clearedMessageCount });
    }

    private expireEmptyChat(): void {
        if (this.authenticatedSockets.size === 0 && this.chatCleanupAt !== null && Date.now() >= this.chatCleanupAt) {
            this.resetChat("empty_room_grace_expired");
        }
    }

    async alarm(): Promise<void> {
        await this.chatAlarmTask;
        this.expireEmptyChat();
        if (this.chatCleanupAt !== null && this.authenticatedSockets.size === 0) {
            this.updateChatAlarm(this.chatCleanupAt);
        }
        await this.chatAlarmTask;
    }

    private onDisconnect(socket: WebSocket, cause: string, details: { code?: number; reason?: string; wasClean?: boolean; deliberate?: boolean } = {}): void {
        if (!this.sockets.delete(socket)) return;
        const wasAuthenticated = this.authenticatedSockets.delete(socket);
        const now = Date.now();
        const openedAt = this.socketOpenedAt.get(socket);
        const lastPingAt = this.socketLastPingAt.get(socket);
        this.logChatEvent("socket_disconnected", {
            cause, ...details, wasAuthenticated,
            connectionDurationMs: openedAt === undefined ? null : now - openedAt,
            lastPingAgeMs: lastPingAt === undefined ? null : now - lastPingAt
        });
        this.socketRoles.delete(socket);
        this.socketNames.delete(socket);
        this.socketProfiles.delete(socket);
        this.socketSenderIds.delete(socket);
        this.chatFloodWindows.delete(socket);
        this.socketOpenedAt.delete(socket);
        this.socketLastPingAt.delete(socket);

        if (socket.readyState !== WebSocket.CLOSED) {
            socket.close(1000, details.deliberate ? "User left room" : "Connection closed");
        }

        if (wasAuthenticated) {
            if (this.authenticatedSockets.size === 0) {
                if (details.deliberate) this.resetChat("last_participant_left");
                else {
                    this.chatCleanupAt = now + CHAT_RECONNECT_GRACE_MS;
                    this.updateChatAlarm(this.chatCleanupAt);
                    this.logChatEvent("chat_cleanup_scheduled", { cause, graceMs: CHAT_RECONNECT_GRACE_MS, deadlineMs: this.chatCleanupAt });
                }
            }
            this.ctx.waitUntil(this.stopPlaybackWhenEmpty());
            this.broadcastPresence();
        }
    }

    private async stopPlaybackWhenEmpty(): Promise<void> {
        if (
            this.authenticatedSockets.size > 0 ||
            !this.streamState.playback.playing
        ) {
            return;
        }

        this.streamState = {
            ...this.streamState,
            playback: {
                ...this.streamState.playback,
                playing: false,
                positionSec: this.getCurrentPlaybackPosition(),
                updatedAtMs: Date.now()
            }
        };

        await this.saveStreamState();
    }

    private getCurrentPlaybackPosition(): number {
        const playback = this.streamState.playback;

        if (!playback.playing) {
            return playback.positionSec;
        }

        const elapsedSec = Math.max(0, Date.now() - playback.updatedAtMs) / 1000;

        return playback.positionSec + elapsedSec * playback.playbackRate;
    }

    private sendState(socket: WebSocket): void {
        this.send(socket, {
            type: "state",
            state: this.streamState
        });
    }

    private broadcastState(): void {
        this.broadcast({
            type: "state",
            state: this.streamState
        });
    }

    private broadcastPresence(): void {
        this.broadcast({
            type: "presence",
            listenerCount: this.authenticatedSockets.size
        });
    }

    private broadcast(message: ServerMessage): void {
        broadcastMessage(this.authenticatedSockets, message, (socket) => {
            this.onDisconnect(socket, "broadcast_send_failed");
        });
    }

    private send(socket: WebSocket, message: ServerMessage): void {
        const sent = sendMessage(socket, message);

        if (!sent) {
            this.onDisconnect(socket, "direct_send_failed");
        }
    }
}
