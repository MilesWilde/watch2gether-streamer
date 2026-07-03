import { StreamRoom } from "./stream-room";
import type { Env } from "./env";

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

function serveIndex(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const indexUrl = new URL("/index.html", url);

	const indexRequest = new Request(indexUrl, {
		method: request.method,
		headers: request.headers
	});

	return env.ASSETS.fetch(indexRequest);
}
