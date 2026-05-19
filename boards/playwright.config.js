import { defineConfig, devices } from '@playwright/test';

// Four projects:
//   - desktop-chrome  (regression guard; all existing /tests/*.spec.js tests
//                     run here. Must stay green on every phase.)
//   - mobile-chrome / mobile-safari / tablet  (added during the mobile/tablet
//                     overhaul. Run only the new specs in /tests/mobile/ and
//                     /tests/visual/ — existing desktop suites are excluded
//                     so they don't fail on touch-only or narrow layouts.)
//
// Mobile projects run a narrower test path; the existing chromium suite is
// preserved verbatim under the new `desktop-chrome` name.

export default defineConfig({
  testDir: './tests',
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1',
    env: {
      ...process.env,
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || 'https://example.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: process.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'local-playwright-key',
    },
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
      testMatch: ['mobile/**/*.spec.js', 'visual/**/*.spec.js'],
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 13'] },
      testMatch: ['mobile/**/*.spec.js', 'visual/**/*.spec.js'],
    },
    {
      name: 'tablet',
      use: { ...devices['iPad Pro 11'] },
      testMatch: ['mobile/**/*.spec.js', 'visual/**/*.spec.js'],
    },
  ],
});
