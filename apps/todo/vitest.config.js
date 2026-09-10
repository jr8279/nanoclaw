import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Separate from vite.config.js (which sets root: 'web' for the app build) —
// vitest runs from the package root and picks up test files under web/src
// plus the pure-logic test file left alongside the old suite's location.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./web/src/test/setup.js'],
    include: ['web/src/**/*.test.{js,jsx}'],
  },
});
