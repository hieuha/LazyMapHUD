import { defineConfig } from 'vite';

// Dev-only proxy for /history (trail hydration) and /chaser (chase mode POSTs
// this device's GPS fix here — see controls/chase-mode.ts) so browser fetches
// are same-origin against the Vite dev server instead of cross-origin to the
// API port — the server has no CORS headers by default, and same-origin also
// matches the production topology (web + API behind the same Caddy origin).
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/history': 'http://localhost:3000',
      '/chaser': 'http://localhost:3000',
      // WebSocket hub — proxied so the browser connects same-origin (ws://
      // localhost:5173/ws) in dev, matching the production same-origin default.
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
