import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    // The app's own alias (vite.config.ts). Without it, any module under test
    // that imports through `@/` fails to resolve before an assertion runs.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    // The API is the unit under test; jsdom would only slow this down.
    environment: 'node',
    include: ['server/__tests__/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
    // Mongoose connections and Express apps are shared process-wide, so
    // parallel files would fight over the same test database.
    fileParallelism: false,
    hookTimeout: 20000,
    testTimeout: 20000,
  },
})
