import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

// In development the app talks to PocketBase through this proxy, so both share one origin
// (exactly how Nginx serves them in production).
const PB = process.env.PB_PROXY_TARGET || "http://127.0.0.1:8090";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: PB, changeOrigin: true },
      "/_": { target: PB, changeOrigin: true },
    },
  },
});
