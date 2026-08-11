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
    baseURL: 'http://127.0.0.1:5174',
    trace: 'on-first-retry',
  },
  webServer: {
    // Port 5174, NOT the 5173 a hand-started `npm run dev` uses. The suite used
    // to share 5173 with reuseExistingServer, so whenever a dev server was
    // already up it was reused — and that one loads the real .env.local. The
    // fake credentials below were only a `process.env.X ||` fallback, so they
    // never applied, and the fixtures (?local=1&tier=demo&cards=60 …) were
    // written straight into the PRODUCTION analytics table. Owning a dedicated
    // port means the suite always gets a server it configured itself.
    command: 'npm run dev -- --host 127.0.0.1 --port 5174 --strictPort',
    env: {
      ...process.env,
      // Forced, not defaulted. These specs are written against a backend that
      // cannot answer (see the pricing-flow header); pointing them at a real
      // project makes them both flaky and destructive.
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'local-playwright-key',
      VITE_SUPABASE_ANON_KEY: 'local-playwright-key',
    },
    url: 'http://127.0.0.1:5174',
    // Safe to reuse now that the port is ours: nothing but this config ever
    // starts a server on 5174, and it always starts it with the forced fake
    // credentials above. Reuse also keeps the server warm between runs, which
    // matters — a cold Vite answers the URL poll before it has compiled the
    // lazy AppShell chunk, and the first spec of a run then races it.
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
