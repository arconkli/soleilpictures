// Warm the dev server before any spec runs.
//
// THE PROBLEM THIS REMOVES. Vite answers the webServer URL poll as soon as it
// is listening, which is well before it has transformed the lazy AppShell
// chunk. The first specs of a cold run then navigate, assert on something
// inside that chunk (`.canvas-wrap`, `.rail-brand`) with the default 5s expect
// timeout, and lose the race against a first-time compile of ~7,000 modules.
//
// The symptom is what makes it expensive: the failures land on whichever specs
// happen to run during the cold window, so the failing SET moves between runs
// and every one of them looks like an unrelated flake. Chasing them
// individually finds nothing wrong with any of them, because nothing is.
//
// playwright.config.js already names this ("a cold Vite answers the URL poll
// before it has compiled the lazy AppShell chunk") and mitigates it with
// reuseExistingServer, which only helps when a warm server happens to already
// be there — never on CI, and never on a fresh worktree, which is exactly when
// a promotion gets gated.
//
// So: pay the compile once, here, with a timeout that suits a compile rather
// than an interaction. Everything after this starts warm.

import { chromium } from '@playwright/test';

export default async function globalSetup(config) {
  const baseURL = config.projects[0]?.use?.baseURL || 'http://127.0.0.1:5174';

  // Refuse to run against a dev server wired to a real Supabase project.
  // playwright.config.js reuses whatever already answers on the port, and on
  // 2026-10-18 a suite on PW_PORT=5199 attached to a server somebody had
  // started by hand with the real .env.local: ~6,000 ?local=1 fixture requests
  // (board ids like "b-features", workspace "local-workspace") hit production.
  // Vite inlines the env into this module, so the served text shows which
  // project that server talks to. A failed fetch falls through to the warm-up,
  // which reports an unreachable server in its own way.
  let served = '';
  try {
    served = await (await fetch(`${baseURL}/src/lib/supabase.js`)).text();
  } catch (_) { /* warm-up below handles an unreachable server */ }
  const real = served.match(/https:\/\/(?!example\.)[a-z0-9-]+\.supabase\.co/)?.[0];
  if (real) {
    throw new Error(
      `[global-setup] the dev server at ${baseURL} loads a real Supabase project (${real}). ` +
      'It was probably started by hand with .env.local. Stop it, or pick a free PW_PORT ' +
      'so Playwright starts its own server with the forced fake credentials.',
    );
  }
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    // Local QA mode reaches the whole lazy graph — AppShell, the canvas, the
    // card renderers — which is what the specs actually wait on.
    await page.goto(`${baseURL}/?local=1&reset=1`, { waitUntil: 'domcontentloaded' });
    await page.locator('.canvas-wrap').waitFor({ state: 'visible', timeout: 120_000 });
  } catch (err) {
    // Never fail the run here. If the app genuinely cannot render, the specs
    // themselves should say so with their own assertion and their own message —
    // a warm-up that throws would replace 40 informative failures with one
    // uninformative one.
    console.warn('[global-setup] warm-up did not complete:', err?.message);
  } finally {
    await page.close();
    await browser.close();
  }
}
