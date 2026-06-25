import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import type { ServerMessage } from "./stream/messages";
import { parseClientMessage } from "./stream/messages";
import {
    broadcastMessage,
    createSocketPair,
    sendMessage
} from "./stream/sockets";

export class StreamRoom extends DurableObject<Env> {
    private readonly sockets = new Set<WebSocket>();
    private readonly authenticatedSockets = new Set<WebSocket>();
    private readonly appEnv: Env;

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        this.appEnv = env;
    }

    async fetch(request: Request): Promise<Response> {
        if (request.headers.get("Upgrade") !== "websocket") {
            return new Response("Expected WebSocket", { status: 426 });
        }

        const { client, server } = createSocketPair();

        server.accept();
        this.sockets.add(server);

        server.addEventListener("message", (event) => {
            this.onMessage(server, event.data);
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

    private onMessage(socket: WebSocket, raw: unknown): void {
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
                this.authenticate(socket, message.password);
                break;

            case "ping":
                if (!this.isAuthenticated(socket)) {
                    this.send(socket, {
                        type: "error",
                        message: "Not authenticated"
                    });
                    return;
                }

                this.send(socket, {
                    type: "pong",
                    serverNowMs: Date.now()
                });
                break;
        }
    }

    private authenticate(socket: WebSocket, password: string): void {
        const expectedPassword = this.appEnv.ROOM_PASSWORD;

        if (!expectedPassword) {
            this.send(socket, {
                type: "error",
                message: "Server password is not configured"
            });
            socket.close(1011, "Server password is not configured");
            return;
        }

        if (password !== expectedPassword) {
            this.send(socket, {
                type: "error",
                message: "Invalid password"
            });
            socket.close(1008, "Invalid password");
            return;
        }

        this.authenticatedSockets.add(socket);

        this.send(socket, {
            type: "authenticated",
            listenerCount: this.authenticatedSockets.size,
            serverNowMs: Date.now()
        });

        this.broadcastPresence();
    }

    private isAuthenticated(socket: WebSocket): boolean {
        return this.authenticatedSockets.has(socket);
    }

    private onDisconnect(socket: WebSocket): void {
        const wasAuthenticated = this.authenticatedSockets.delete(socket);
        this.sockets.delete(socket);

        if (wasAuthenticated) {
            this.broadcastPresence();
        }
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