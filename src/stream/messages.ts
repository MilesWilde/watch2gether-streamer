import type { StreamState, UserRole } from "./playlist";

export type ClientMessage =
    | {
        type: "authenticate";
        password: string;
        mode: "viewer" | "admin";
    }
    | {
        type: "ping";
    }
    | {
        type: "request_video";
        url: string;
    }
    | {
        type: "approve_request";
        requestId: string;
    }
    | {
        type: "deny_request";
        requestId: string;
    }
    | {
        type: "remove_playlist_item";
        playlistItemId: string;
    }
    | {
        type: "play_playlist_item";
        playlistItemId: string;
    }
    | {
        type: "play_video";
        positionSec: number;
    }
    | {
        type: "pause_video";
        positionSec: number;
    }
    | {
        type: "next_video";
    }
    | {
        type: "clear_room";
    };

export type ServerMessage =
    | {
        type: "authenticated";
        role: UserRole;
        listenerCount: number;
        serverNowMs: number;
    }
    | {
        type: "presence";
        listenerCount: number;
    }
    | {
        type: "state";
        state: StreamState;
    }
    | {
        type: "pong";
        serverNowMs: number;
    }
    | {
        type: "error";
        message: string;
    };

export function parseClientMessage(raw: unknown): ClientMessage | null {
    try {
        const parsed = JSON.parse(String(raw));

        if (typeof parsed !== "object" || parsed === null || !("type" in parsed)) {
            return null;
        }

        if (
            parsed.type === "authenticate" &&
            "password" in parsed &&
            typeof parsed.password === "string" &&
            "mode" in parsed &&
            (parsed.mode === "viewer" || parsed.mode === "admin")
        ) {
            return {
                type: "authenticate",
                password: parsed.password,
                mode: parsed.mode
            };
        }

        if (parsed.type === "ping") {
            return {
                type: "ping"
            };
        }

        if (
            parsed.type === "request_video" &&
            "url" in parsed &&
            typeof parsed.url === "string"
        ) {
            return {
                type: "request_video",
                url: parsed.url
            };
        }

        if (
            parsed.type === "approve_request" &&
            "requestId" in parsed &&
            typeof parsed.requestId === "string"
        ) {
            return {
                type: "approve_request",
                requestId: parsed.requestId
            };
        }

        if (
            parsed.type === "deny_request" &&
            "requestId" in parsed &&
            typeof parsed.requestId === "string"
        ) {
            return {
                type: "deny_request",
                requestId: parsed.requestId
            };
        }

        if (
            parsed.type === "remove_playlist_item" &&
            "playlistItemId" in parsed &&
            typeof parsed.playlistItemId === "string"
        ) {
            return {
                type: "remove_playlist_item",
                playlistItemId: parsed.playlistItemId
            };
        }

        if (
            parsed.type === "play_playlist_item" &&
            "playlistItemId" in parsed &&
            typeof parsed.playlistItemId === "string"
        ) {
            return {
                type: "play_playlist_item",
                playlistItemId: parsed.playlistItemId
            };
        }

        if (parsed.type === "play_video") {
            return {
                type: "play_video",
                positionSec: getPositionSec(parsed)
            };
        }

        if (parsed.type === "pause_video") {
            return {
                type: "pause_video",
                positionSec: getPositionSec(parsed)
            };
        }

        if (parsed.type === "next_video") {
            return {
                type: "next_video"
            };
        }

        if (parsed.type === "clear_room") {
            return {
                type: "clear_room"
            };
        }

        return null;
    } catch {
        return null;
    }
}

function getPositionSec(parsed: Record<string, unknown>): number {
    return typeof parsed.positionSec === "number" && Number.isFinite(parsed.positionSec)
        ? Math.max(0, parsed.positionSec)
        : 0;
}
