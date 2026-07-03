import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
	plugins: [react()],
	publicDir: false,
	build: {
		outDir: "public",
		emptyOutDir: false,
		rollupOptions: {
			input: "src/client/main.tsx",
			output: {
				entryFileNames: "dist/app.js",
				chunkFileNames: "dist/[name].js",
				assetFileNames: "dist/[name][extname]"
			}
		}
	}
});
