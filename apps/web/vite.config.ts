import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The dev server forwards the two doors and the session endpoints to the API, so the browser sees
// one origin and the session cookie stays SameSite=Strict. LIMS_API names the API for e2e runs.
const api = process.env['LIMS_API'] ?? 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': { target: api, changeOrigin: false } } },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
  },
});
