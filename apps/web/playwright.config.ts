import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests for the console. They need a migrated, seeded database
 * (`pnpm db:migrate && pnpm db:seed`) and built apps (`pnpm build`); the API
 * and the console are then started here if they aren't already running.
 *
 * Set PW_CHANNEL=chrome to use an installed Google Chrome instead of
 * downloading Playwright's Chromium (`pnpm exec playwright install chromium`).
 */
const channel = process.env.PW_CHANNEL;

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.results',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel } },
    { name: 'phone', use: { ...devices['Pixel 7'], channel }, testMatch: /responsive/ },
  ],
  webServer: [
    {
      command: '.venv/bin/uvicorn app.main:app --port 8000',
      url: 'http://localhost:8000/health',
      reuseExistingServer: !process.env.CI,
      cwd: '../../services/ml',
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @kora/api start',
      url: 'http://localhost:4000/health',
      reuseExistingServer: !process.env.CI,
      cwd: '../..',
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @kora/web start',
      url: 'http://localhost:3000/login',
      reuseExistingServer: !process.env.CI,
      cwd: '../..',
      timeout: 60_000,
    },
  ],
});
