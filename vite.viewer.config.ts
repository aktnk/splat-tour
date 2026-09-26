import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// Web viewer (viewer/). In dev the tour folder (manifest.json + assets/) is
// served next to the page; TOUR_DIR picks another tour. The build contains
// only the viewer: publish it together with a tour folder, or point
// ?manifest= at one hosted elsewhere.

const tourDir = process.env.TOUR_DIR ?? "tours/fuji-museum";

export default defineConfig(({ command }) => ({
  root: fileURLToPath(new URL("./viewer", import.meta.url)),
  // Relative asset paths so the build works from any folder.
  base: "./",
  publicDir: command === "serve" ? fileURLToPath(new URL(tourDir, new URL("./", import.meta.url))) : false,
  clearScreen: false,
  server: {
    port: 5190,
    host: true,
  },
  build: {
    outDir: fileURLToPath(new URL("./dist-viewer", import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 6000,
  },
}));
