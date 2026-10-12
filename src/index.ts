import { StreamRoom } from "./stream-room";
import type { Env } from "./env";
import { extractYouTubePlaylistId, fetchYouTubePlaylistPreview } from "./stream/youtube-playlists";

export { StreamRoom };

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/ws") {
			try {
				const stream = env.STREAM.getByName("global");

				return stream.fetch(request);
			} catch (error) {
				console.error(
					JSON.stringify({
						event: "websocket_durable_object_handoff_failed",
						message: error instanceof Error ? error.message : String(error),
						stack: error instanceof Error ? error.stack : undefined
					})
				);

				throw error;
			}
		}

		if (url.pathname === "/api/youtube/playlist-preview") {
			return previewYouTubePlaylist(request, env);
		}

		// Explicit app routes.
		// These should serve the SPA shell without giving the static asset handler
		// a chance to redirect /admin somewhere else.
		if (url.pathname === "/" || url.pathname === "/admin") {
			return serveIndex(request, env);
		}

		const assetResponse = await env.ASSETS.fetch(request);

		if (assetResponse.status !== 404) {
			return assetResponse;
		}

		const looksLikeFile = url.pathname.split("/").pop()?.includes(".");

		if (looksLikeFile) {
			return assetResponse;
		}

		return serveIndex(request, env);
	}
};

async function previewYouTubePlaylist(
	request: Request,
	env: Env
): Promise<Response> {
	if (request.method !== "POST") {
		return jsonResponse({ error: "Method not allowed" }, 405);
	}

	if (!env.YOUTUBE_API_KEY) {
		return jsonResponse({ error: "YouTube API key is not configured." }, 500);
	}

	const body = await readJsonBody(request);

	if (!body) {
		return jsonResponse({ error: "Invalid request body." }, 400);
	}

	const password = typeof body.password === "string" ? body.password : "";
	const mode = body.mode === "admin" ? "admin" : "viewer";
	const expectedPassword = mode === "admin" ? env.ADMIN_PASSWORD : env.ROOM_PASSWORD;

	if (!expectedPassword || password !== expectedPassword) {
		return jsonResponse({ error: "Not authorized." }, 401);
	}

	if (typeof body.url !== "string") {
		return jsonResponse({ error: "Missing playlist URL." }, 400);
	}

	const playlistId = extractYouTubePlaylistId(body.url);

	if (!playlistId) {
		return jsonResponse({ error: "Please enter a valid YouTube playlist URL." }, 400);
	}

	const preview = await fetchYouTubePlaylistPreview(playlistId, env.YOUTUBE_API_KEY);

	if (!preview || preview.videos.length === 0) {
		return jsonResponse({ error: "No public videos found in that playlist." }, 404);
	}

	return jsonResponse(preview);
}

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
	try {
		const body: unknown = await request.json();

		return typeof body === "object" && body !== null
			? (body as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function jsonResponse(body: unknown, status = 200): Response {
	return Response.json(body, {
		status,
		headers: {
			"Cache-Control": "no-store"
		}
	});
}

function serveIndex(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const indexUrl = new URL("/index.html", url);

	const indexRequest = new Request(indexUrl, {
		method: request.method,
		headers: request.headers
	});

	return env.ASSETS.fetch(indexRequest);
}
