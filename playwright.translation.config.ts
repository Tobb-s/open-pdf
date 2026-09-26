import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Isolated production server: never accidentally exercise a developer's stale server.
export default defineConfig({
  ...base,
  testMatch: /translation\.spec\.ts/,
  timeout: 45_000,
  workers: 2,
  use: { ...base.use, baseURL: 'http://127.0.0.1:3101' },
  webServer: {
    command: 'npm run start -- --hostname 127.0.0.1 --port 3101',
    url: 'http://127.0.0.1:3101/es/translate',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
