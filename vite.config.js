import { defineConfig } from "vite";
import { resolve } from "node:path";
export default defineConfig({
  base: "./",
  build: {
    target: "chrome130",
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      input: { app: resolve("index.html"), homepage: resolve("homepage.html") },
    },
  },
  server: { host: "127.0.0.1" },
});
