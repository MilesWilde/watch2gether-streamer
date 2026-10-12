import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import { unstable_readConfig } from "wrangler";

const worker = unstable_readConfig({ config: "./wrangler.jsonc" });

export default defineConfig({
	plugins: [cloudflareTest({
		main: worker.main,
		// Bypass Wrangler's local-secret loader while using project runtime settings.
		miniflare: {
			compatibilityDate: worker.compatibility_date,
			compatibilityFlags: worker.compatibility_flags,
			durableObjects: Object.fromEntries(worker.durable_objects.bindings.map(
				(binding) => [binding.name, { className: binding.class_name, useSQLite: true }]
			)),
			bindings: { ROOM_PASSWORD: "qa-viewer", ADMIN_PASSWORD: "qa-admin" }
		}
	})]
});
