import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import type { ServerMessage } from "./stream/messages";
import { parseClientMessage } from "./stream/messages";
import {
    createEmptyStreamState,
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

const STREAM_STATE_STORAGE_KEY = "stream-state";

export class StreamRoom extends DurableObject<Env> {
    private readonly sockets = new Set<WebSocket>();
    private readonly authenticatedSockets = new Set<WebSocket>();
    private readonly socketRoles = new Map<WebSocket, UserRole>();
    private readonly appEnv: Env;

    private streamState: StreamState = createEmptyStreamState();
    private initialized = false;

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        this.appEnv = env;
    }

    async fetch(request: Request): Promise<Response> {
        await this.initialize();

        if (request.headers.get("Upgrade") !== "websocket") {
            return new Response("Expected WebSocket", { status: 426 });
        }

        const { client, server } = createSocketPair();

        server.accept();
        this.sockets.add(server);

        server.addEventListener("message", (event) => {
            void this.onMessage(server, event.data);
        });

        server.addEventListener("close", () => {
            this.onDisconnect(server);
        });

        server.addEventListener("error", () => {
            this.onDisconnect(server);
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
        const message = parseClientMessage(raw);

        if (!message) {
            this.send(socket, {
                type: "error",
                message: "Invalid message"
            });
            return;
        }

        switch (message.type) {
            case "authenticate":
                this.authenticate(socket, message.mode, message.password);
                break;

            case "ping":
                this.requireAuthenticated(socket, () => {
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
                    await this.setPlayback(true, message.positionSec);
                });
                break;

            case "pause_video":
                await this.requireAdminAsync(socket, async () => {
                    await this.setPlayback(false, message.positionSec);
                });
                break;

            case "set_playback_rate":
                await this.requireAdminAsync(socket, async () => {
                    await this.setPlaybackRate(message.playbackRate, message.positionSec);
                });
                break;

            case "next_video":
                await this.requireAdminAsync(socket, async () => {
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
        password: string
    ): void {
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

            this.finishAuthentication(socket, "viewer");
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

        this.finishAuthentication(socket, "admin");
    }

    private finishAuthentication(socket: WebSocket, role: UserRole): void {
        this.authenticatedSockets.add(socket);
        this.socketRoles.set(socket, role);

        this.send(socket, {
            type: "authenticated",
            role,
            listenerCount: this.authenticatedSockets.size,
            serverNowMs: Date.now()
        });

        this.sendState(socket);
        this.broadcastPresence();
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
            playback: {
                playing: true,
                positionSec: 0,
                playbackRate: this.streamState.playback.playbackRate,
                updatedAtMs: Date.now()
            }
        };

        await this.saveStreamState();
        this.broadcastState();
    }

    private async nextVideo(): Promise<void> {
        const wasPlaying = this.streamState.playback.playing;

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

        await this.saveStreamState();
        this.broadcastState();
    }

    private async clearRoom(): Promise<void> {
        this.streamState = createEmptyStreamState();

        await this.saveStreamState();
        this.broadcastState();
    }

    private async setPlayback(playing: boolean, positionSec: number): Promise<void> {
        if (this.streamState.playlist.length === 0) {
            return;
        }

        this.streamState = {
            ...this.streamState,
            playback: {
                playing,
                positionSec,
                playbackRate: this.streamState.playback.playbackRate,
                updatedAtMs: Date.now()
            }
        };

        await this.saveStreamState();
        this.broadcastState();
    }

    private async setPlaybackRate(
        playbackRate: number,
        positionSec: number
    ): Promise<void> {
        if (this.streamState.playlist.length === 0) {
            return;
        }

        this.streamState = {
            ...this.streamState,
            playback: {
                ...this.streamState.playback,
                positionSec,
                playbackRate,
                updatedAtMs: Date.now()
            }
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
        return this.authenticatedSockets.has(socket);
    }

    private onDisconnect(socket: WebSocket): void {
        const wasAuthenticated = this.authenticatedSockets.delete(socket);

        this.sockets.delete(socket);
        this.socketRoles.delete(socket);

        if (wasAuthenticated) {
            void this.stopPlaybackWhenEmpty();
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
            this.onDisconnect(socket);
        });
    }

    private send(socket: WebSocket, message: ServerMessage): void {
        const sent = sendMessage(socket, message);

        if (!sent) {
            this.onDisconnect(socket);
        }
    }
}
