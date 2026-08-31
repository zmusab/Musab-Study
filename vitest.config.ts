import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Configuration de test séparée de la configuration de build : le bundle de
 * production n'a aucune raison de connaître jsdom ou fake-indexeddb.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
