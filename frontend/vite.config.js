import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// During dev the frontend runs on 5173 and proxies API calls to the backend.
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        proxy: {
            "/api": "http://127.0.0.1:8000",
            "/attachments": "http://127.0.0.1:8000",
        },
    },
    build: {
        outDir: "dist",
    },
});
