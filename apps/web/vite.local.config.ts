import path from "node:path";
import { lingui } from "@lingui/vite-plugin";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    babel({ plugins: ["@lingui/babel-plugin-lingui-macro"] }),
    lingui(),
    tailwindcss(),
  ],
  build: {
    outDir: "dist-local",
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(import.meta.dirname, "local.html"),
    },
  },
});
