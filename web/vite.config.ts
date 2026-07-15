import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Dev-only proxy for /history (trail hydration, Phase 5) and /chaser (D6:
// chase.html device page POSTs its GPS fix here) so browser fetches are
// same-origin against the Vite dev server instead of cross-origin to the API
// port — the server has no CORS headers (out of this phase's ownership), and
// same-origin also matches the production topology (Phase 7: web + API
// served behind the same Caddy origin).
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/history': 'http://localhost:3000',
      '/chaser': 'http://localhost:3000',
    },
  },
  build: {
    rollupOptions: {
      // Multi-page build: the main HUD (index.html) + the lightweight
      // Chaser-mode device page (chase.html, D6) both ship as static entries.
      input: {
        main: resolve(__dirname, 'index.html'),
        chase: resolve(__dirname, 'chase.html'),
      },
    },
  },
});
