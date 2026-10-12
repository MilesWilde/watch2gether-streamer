export type YouTubePlaylistVideo = {
    videoId: string;
    title: string;
    url: string;
};

export type YouTubePlaylistPreview = {
    playlistId: string;
    videos: YouTubePlaylistVideo[];
    truncated: boolean;
};

const maxPlaylistPreviewItems = 200;
const maxYouTubePageSize = 50;

export function extractYouTubePlaylistId(input: string): string | null {
    const trimmed = input.trim();

    if (isValidYouTubePlaylistId(trimmed)) {
        return trimmed;
    }

    try {
        const url = new URL(trimmed);
        const isYouTubeHost =
            url.hostname === "youtube.com" ||
            url.hostname === "www.youtube.com" ||
            url.hostname === "m.youtube.com" ||
            url.hostname === "music.youtube.com";

        if (!isYouTubeHost) {
            return null;
        }

        const playlistId = url.searchParams.get("list");
        return isValidYouTubePlaylistId(playlistId) ? playlistId : null;
    } catch {
        return null;
    }
}

export async function fetchYouTubePlaylistPreview(
    playlistId: string,
    apiKey: string
): Promise<YouTubePlaylistPreview | null> {
    const videos: YouTubePlaylistVideo[] = [];
    let pageToken: string | undefined;

    while (videos.length < maxPlaylistPreviewItems) {
        const page = await fetchYouTubePlaylistPage({
            playlistId,
            apiKey,
            pageToken,
            maxResults: Math.min(maxYouTubePageSize, maxPlaylistPreviewItems - videos.length)
        });

        if (!page) {
            return null;
        }

        videos.push(...page.videos);

        if (!page.nextPageToken) {
            return {
                playlistId,
                videos,
                truncated: false
            };
        }

        pageToken = page.nextPageToken;
    }

    return {
        playlistId,
        videos,
        truncated: true
    };
}

async function fetchYouTubePlaylistPage({
    playlistId,
    apiKey,
    pageToken,
    maxResults
}: {
    playlistId: string;
    apiKey: string;
    pageToken?: string;
    maxResults: number;
}): Promise<{ videos: YouTubePlaylistVideo[]; nextPageToken?: string } | null> {
    const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");

    url.searchParams.set("part", "snippet,status");
    url.searchParams.set("playlistId", playlistId);
    url.searchParams.set("maxResults", String(maxResults));
    url.searchParams.set("key", apiKey);
    url.searchParams.set(
        "fields",
        "nextPageToken,items(snippet(title,resourceId(videoId)),status(privacyStatus))"
    );

    if (pageToken) {
        url.searchParams.set("pageToken", pageToken);
    }

    const response = await fetch(url);

    if (!response.ok) {
        return null;
    }

    const data: unknown = await response.json();

    if (typeof data !== "object" || data === null) {
        return null;
    }

    const payload = data as {
        nextPageToken?: unknown;
        items?: unknown;
    };

    if (!Array.isArray(payload.items)) {
        return null;
    }

    return {
        videos: payload.items
            .map(parsePlaylistVideo)
            .filter((item): item is YouTubePlaylistVideo => item !== null),
        nextPageToken:
            typeof payload.nextPageToken === "string" ? payload.nextPageToken : undefined
    };
}

function parsePlaylistVideo(value: unknown): YouTubePlaylistVideo | null {
    if (typeof value !== "object" || value === null) {
        return null;
    }

    const item = value as {
        snippet?: {
            title?: unknown;
            resourceId?: {
                videoId?: unknown;
            };
        };
        status?: {
            privacyStatus?: unknown;
        };
    };
    const videoId = item.snippet?.resourceId?.videoId;
    const title = item.snippet?.title;
    const privacyStatus = item.status?.privacyStatus;

    if (
        typeof videoId !== "string" ||
        typeof title !== "string" ||
        privacyStatus === "private"
    ) {
        return null;
    }

    return {
        videoId,
        title: title.trim() || videoId,
        url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
    };
}

function isValidYouTubePlaylistId(value: string | null | undefined): value is string {
    return typeof value === "string" && /^[a-zA-Z0-9_-]{10,}$/.test(value);
}
