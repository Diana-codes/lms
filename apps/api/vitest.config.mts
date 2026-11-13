import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
  // SWC emits the decorator metadata NestJS's dependency injection relies on.
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
