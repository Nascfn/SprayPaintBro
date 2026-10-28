import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works from any static host path (e.g. GitHub Pages).
  base: './',
  server: { port: 5173 },
  // three.js alone is ~700 kB minified; one chunk is fine for a game.
  build: { chunkSizeWarningLimit: 1200 },
});
