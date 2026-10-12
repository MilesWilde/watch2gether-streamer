export type UserRole = "viewer" | "admin";

export type PlaybackState = {
    playing: boolean;
    positionSec: number;
    playbackRate: number;
    updatedAtMs: number;
};

export type PlaylistItem = {
    id: string;
    provider: "youtube";
    videoId: string;
    originalUrl: string;
    title: string;
};

export type VideoRequest = {
    id: string;
    provider: "youtube";
    videoId: string;
    originalUrl: string;
    title: string;
    requestedAtMs: number;
};

export type StreamState = {
    playlist: PlaylistItem[];
    requests: VideoRequest[];
    currentIndex: number;
    playback: PlaybackState;
};

export type RequestedVideoInput = {
    url: string;
    title?: string;
};

export function createEmptyStreamState(): StreamState {
    return {
        playlist: [],
        requests: [],
        currentIndex: 0,
        playback: createStoppedPlaybackState()
    };
}

export function createStoppedPlaybackState(): PlaybackState {
    return {
        playing: false,
        positionSec: 0,
        playbackRate: 1,
        updatedAtMs: Date.now()
    };
}

export function normalizeStreamState(value: StreamState | null | undefined): StreamState {
    if (!value) {
        return createEmptyStreamState();
    }

    const playlist = Array.isArray(value.playlist) ? value.playlist : [];
    const requests = Array.isArray(value.requests) ? value.requests : [];

    return {
        playlist,
        requests,
        currentIndex: normalizeCurrentIndex(value.currentIndex, playlist.length),
        playback: normalizePlaybackState(value.playback)
    };
}

export function moveToNextPlaylistItem(state: StreamState): StreamState {
    if (state.playlist.length === 0) {
        return {
            ...state,
            currentIndex: 0,
            playback: createStoppedPlaybackState()
        };
    }

    return {
        ...state,
        currentIndex: (state.currentIndex + 1) % state.playlist.length,
        playback: createStoppedPlaybackState()
    };
}

export function removePlaylistItem(
    state: StreamState,
    playlistItemId: string
): StreamState | null {
    const removeIndex = state.playlist.findIndex((item) => item.id === playlistItemId);

    if (removeIndex === -1) {
        return null;
    }

    const nextPlaylist = state.playlist.filter((item) => item.id !== playlistItemId);

    if (nextPlaylist.length === 0) {
        return {
            ...state,
            playlist: [],
            currentIndex: 0,
            playback: createStoppedPlaybackState()
        };
    }

    const wasCurrentItem = removeIndex === state.currentIndex;

    if (wasCurrentItem) {
        return {
            ...state,
            playlist: nextPlaylist,
            currentIndex: Math.min(removeIndex, nextPlaylist.length - 1),
            playback: createStoppedPlaybackState()
        };
    }

    const nextCurrentIndex =
        removeIndex < state.currentIndex
            ? state.currentIndex - 1
            : state.currentIndex;

    return {
        ...state,
        playlist: nextPlaylist,
        currentIndex: normalizeCurrentIndex(nextCurrentIndex, nextPlaylist.length)
    };
}

export function createVideoRequestFromUrl(
    url: string,
    title?: string
): VideoRequest | null {
    const videoId = extractYouTubeVideoId(url);

    if (!videoId) {
        return null;
    }

    return {
        id: crypto.randomUUID(),
        provider: "youtube",
        videoId,
        originalUrl: url,
        title: title?.trim() || videoId,
        requestedAtMs: Date.now()
    };
}

export function createVideoRequestFromInput(input: RequestedVideoInput): VideoRequest | null {
    return createVideoRequestFromUrl(input.url, input.title);
}

export function createPlaylistItemFromRequest(request: VideoRequest): PlaylistItem {
    return {
        id: crypto.randomUUID(),
        provider: request.provider,
        videoId: request.videoId,
        originalUrl: request.originalUrl,
        title: request.title
    };
}

export function createPlaylistItemFromInput(
    input: RequestedVideoInput
): PlaylistItem | null {
    const request = createVideoRequestFromInput(input);

    return request ? createPlaylistItemFromRequest(request) : null;
}

export function extractYouTubeVideoId(input: string): string | null {
    const trimmed = input.trim();

    if (isValidYouTubeId(trimmed)) {
        return trimmed;
    }

    try {
        const url = new URL(trimmed);

        if (url.hostname === "youtu.be") {
            const id = url.pathname.split("/").filter(Boolean)[0];
            return isValidYouTubeId(id) ? id : null;
        }

        const isYouTubeHost =
            url.hostname === "youtube.com" ||
            url.hostname === "www.youtube.com" ||
            url.hostname === "m.youtube.com" ||
            url.hostname === "music.youtube.com";

        if (!isYouTubeHost) {
            return null;
        }

        const watchId = url.searchParams.get("v");

        if (isValidYouTubeId(watchId)) {
            return watchId;
        }

        const shortsMatch = url.pathname.match(/^\/shorts\/([^/]+)/);
        const shortsId = shortsMatch?.[1];

        if (isValidYouTubeId(shortsId)) {
            return shortsId;
        }

        const embedMatch = url.pathname.match(/^\/embed\/([^/]+)/);
        const embedId = embedMatch?.[1];

        if (isValidYouTubeId(embedId)) {
            return embedId;
        }

        return null;
    } catch {
        return null;
    }
}

function normalizeCurrentIndex(currentIndex: unknown, playlistLength: number): number {
    if (playlistLength <= 0) {
        return 0;
    }

    if (typeof currentIndex !== "number" || !Number.isFinite(currentIndex)) {
        return 0;
    }

    return Math.min(Math.max(Math.floor(currentIndex), 0), playlistLength - 1);
}

function normalizePlaybackState(value: PlaybackState | undefined): PlaybackState {
    if (!value) {
        return createStoppedPlaybackState();
    }

    return {
        playing: typeof value.playing === "boolean" ? value.playing : false,
        positionSec:
            typeof value.positionSec === "number" && Number.isFinite(value.positionSec)
                ? Math.max(0, value.positionSec)
                : 0,
        playbackRate: normalizePlaybackRate(value.playbackRate),
        updatedAtMs:
            typeof value.updatedAtMs === "number" && Number.isFinite(value.updatedAtMs)
                ? value.updatedAtMs
                : Date.now()
    };
}

function isValidYouTubeId(value: string | null | undefined): value is string {
    return typeof value === "string" && /^[a-zA-Z0-9_-]{11}$/.test(value);
}

export function normalizePlaybackRate(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return 1;
    }

    if ([0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].includes(value)) {
        return value;
    }

    return 1;
}
