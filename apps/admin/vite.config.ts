import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = "http://127.0.0.1:3100";

export default defineConfig({
  base: "/admin/",
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: api,
        changeOrigin: true,
        headers: { origin: api },
      },
      "/v1": {
        target: api,
        changeOrigin: true,
        headers: { origin: api },
      },
    },
  },
});
