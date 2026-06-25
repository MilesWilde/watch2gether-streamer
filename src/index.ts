import { StreamRoom } from "./stream-room";
import type { Env } from "./env";

export { StreamRoom };

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/ws") {
			const id = env.STREAM.idFromName("global");
			const stream = env.STREAM.get(id);

			return stream.fetch(request);
		}

		return env.ASSETS.fetch(request);
	}
};