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
    },
  },
});
