import { normalizeChatName, parseChatInput, type ChatMessage, type ChatSnapshot } from "./chat";
import {
    normalizePlaybackRate,
    type RequestedVideoInput,
    type StreamState,
    type UserRole
} from "./playlist";

export type AuthenticateClientMessage = {
    type: "authenticate";
    password: string;
    mode: UserRole;
    name?: string;
};

export type SetNameClientMessage = { type: "set_name"; name: string };
export type SendChatClientMessage = { type: "send_chat"; text: string; gifId?: string; requestId?: string };

export type ChatResultServerMessage = {
	type: "chat_result";
	requestId: string;
	accepted: boolean;
	message?: string;
};

export function isChatRequestId(value: unknown): value is string {
	return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

// Recover correlation even when chat content fails validation, never from other commands.
export function getChatRequestId(raw: unknown): string | undefined {
	try {
		const input: unknown = JSON.parse(String(raw));
		if (typeof input === "object" && input !== null && "type" in input &&
			input.type === "send_chat" && "requestId" in input && isChatRequestId(input.requestId)) {
			return input.requestId;
		}
	} catch { /* Invalid JSON cannot be correlated safely. */ }
	return undefined;
}

export type PingClientMessage = {
    type: "ping";
};

export type RequestVideoClientMessage = {
    type: "request_video";
    url: string;
};

export type RequestVideosClientMessage = {
    type: "request_videos";
    videos: RequestedVideoInput[];
};

export type ApproveRequestClientMessage = {
    type: "approve_request";
    requestId: string;
};

export type DenyRequestClientMessage = {
    type: "deny_request";
    requestId: string;
};

export type RemovePlaylistItemClientMessage = {
    type: "remove_playlist_item";
    playlistItemId: string;
};

export type PlayPlaylistItemClientMessage = {
    type: "play_playlist_item";
    playlistItemId: string;
};

export type PlayVideoClientMessage = {
    type: "play_video";
    positionSec: number;
};

export type PauseVideoClientMessage = {
    type: "pause_video";
    positionSec: number;
};

export type SetPlaybackRateClientMessage = {
    type: "set_playback_rate";
    positionSec: number;
    playbackRate: number;
};

export type NextVideoClientMessage = {
    type: "next_video";
};

export type ClearRoomClientMessage = {
    type: "clear_room";
};

export type ClientMessage =
    | AuthenticateClientMessage
    | SetNameClientMessage
    | SendChatClientMessage
    | PingClientMessage
    | RequestVideoClientMessage
    | RequestVideosClientMessage
    | ApproveRequestClientMessage
    | DenyRequestClientMessage
    | RemovePlaylistItemClientMessage
    | PlayPlaylistItemClientMessage
    | PlayVideoClientMessage
    | PauseVideoClientMessage
    | SetPlaybackRateClientMessage
    | NextVideoClientMessage
    | ClearRoomClientMessage;

export type AuthenticatedServerMessage = {
    type: "authenticated";
    role: UserRole;
    listenerCount: number;
    serverNowMs: number;
};

export type PresenceServerMessage = {
    type: "presence";
    listenerCount: number;
};

export type StateServerMessage = {
    type: "state";
    state: StreamState;
};

export type PongServerMessage = {
    type: "pong";
    serverNowMs: number;
};

export type ErrorServerMessage = {
    type: "error";
    message: string;
};

export type ServerMessage =
    | AuthenticatedServerMessage
    | ChatResultServerMessage
    | { type: "chat_history"; chat: ChatSnapshot }
    | { type: "chat_message"; message: ChatMessage }
    | { type: "name_updated"; name: string }
    | PresenceServerMessage
    | StateServerMessage
    | PongServerMessage
    | ErrorServerMessage;

export function parseClientMessage(raw: unknown): ClientMessage | null {
    try {
        const parsed: unknown = JSON.parse(String(raw));

        if (typeof parsed !== "object" || parsed === null || !("type" in parsed)) {
            return null;
        }

        const input = parsed as Record<string, unknown>;

        if (parsed.type === "set_name" && typeof input.name === "string") {
            return { type: "set_name", name: normalizeChatName(input.name) };
        }

        if (parsed.type === "send_chat") {
            if ("requestId" in input && !isChatRequestId(input.requestId)) return null;
            const chat = parseChatInput(input.text, input.gifId);
            return chat ? { type: "send_chat", ...chat, ...(isChatRequestId(input.requestId) ? { requestId: input.requestId } : {}) } : null;
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
                mode: parsed.mode,
                ...(typeof input.name === "string" ? { name: normalizeChatName(input.name) } : {})
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
            parsed.type === "request_videos" &&
            "videos" in parsed &&
            Array.isArray(parsed.videos)
        ) {
            const videos = (parsed.videos as unknown[])
                .map(parseRequestedVideoInput)
                .filter((item): item is RequestedVideoInput => item !== null)
                .slice(0, 200);

            if (videos.length === 0) {
                return null;
            }

            return {
                type: "request_videos",
                videos
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

        if (parsed.type === "set_playback_rate") {
            return {
                type: "set_playback_rate",
                positionSec: getPositionSec(parsed),
                playbackRate: normalizePlaybackRate(
                    "playbackRate" in parsed ? parsed.playbackRate : undefined
                )
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

function parseRequestedVideoInput(value: unknown): RequestedVideoInput | null {
    if (typeof value !== "object" || value === null) {
        return null;
    }

    const input = value as Record<string, unknown>;

    if (typeof input.url !== "string") {
        return null;
    }

    return {
        url: input.url,
        title: typeof input.title === "string" ? input.title : undefined
    };
}

function getPositionSec(parsed: Record<string, unknown>): number {
    return typeof parsed.positionSec === "number" && Number.isFinite(parsed.positionSec)
        ? Math.max(0, parsed.positionSec)
        : 0;
}
