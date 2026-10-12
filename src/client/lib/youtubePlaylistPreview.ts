import type { UserRole } from "../../stream/playlist";
import type { YouTubePlaylistPreview } from "../../stream/youtube-playlists";

export type PlaylistPreviewRequest = {
	url: string;
	mode: UserRole;
	password: string;
};

export async function fetchPlaylistPreview({
	url,
	mode,
	password
}: PlaylistPreviewRequest): Promise<YouTubePlaylistPreview> {
	const response = await fetch("/api/youtube/playlist-preview", {
		method: "POST",
		headers: {
			"Content-Type": "application/json"
		},
		body: JSON.stringify({
			url,
			mode,
			password
		})
	});

	const body: unknown = await response.json().catch(() => null);

	if (!response.ok) {
		throw new Error(getErrorMessage(body));
	}

	if (!isPlaylistPreview(body)) {
		throw new Error("Invalid playlist preview response.");
	}

	return body;
}

function getErrorMessage(body: unknown): string {
	if (
		typeof body === "object" &&
		body !== null &&
		"error" in body &&
		typeof body.error === "string"
	) {
		return body.error;
	}

	return "Could not load playlist.";
}

function isPlaylistPreview(value: unknown): value is YouTubePlaylistPreview {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const preview = value as Record<string, unknown>;

	return (
		typeof preview.playlistId === "string" &&
		typeof preview.truncated === "boolean" &&
		Array.isArray(preview.videos)
	);
}
