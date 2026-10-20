import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist-local",
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(import.meta.dirname, "local.html"),
    },
  },
});
