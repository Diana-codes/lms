import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// End-to-end tests run against a real Postgres (see docker-compose.yml), in a
// separate "<name>_test" database that test/global-setup.ts creates.
export default defineConfig({
  test: {
    include: ['test/**/*.e2e.ts'],
    environment: 'node',
    globalSetup: ['test/global-setup.ts'],
    setupFiles: ['test/setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
