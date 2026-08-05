// /scout — the Soleil Scout landing page (SeoLandingPage.jsx over the spec in
// lib/seoLanding.js, plus the interactive ScoutDemo hero).
//
// Registry-derived like the listicle spec: assertions read from the spec, so
// the copy can be rewritten without touching this file. What's pinned is the
// STRUCTURE — that the page renders, that the demo actually animates, and that
// the SEO fields stay inside the limits that make them useful.
//
// The demo matters more than usual here: it IS the pitch on the wedge page, so
// "it silently never plays" is a real failure mode and it already happened once
// (the observer threshold was too strict for where the hero pushes the demo).

import { expect, test } from '@playwright/test';
import { routeAnalytics } from './helpers/share-fixture.js';
import { getLandingSpec, SEO_LANDING_PATHS } from '../src/lib/seoLanding.js';

const SPEC = getLandingSpec('/scout');

// This page scrolls inside .seo-scroll, NOT the window — scrolling the window
// moves nothing and makes the demo look broken. (Same gotcha the listicle TOC
// test guards.)
async function scrollToDemo(page) {
  await page.evaluate(() => {
    const el = document.querySelector('.scout-demo');
    const sc = document.querySelector('.seo-scroll');
    if (el && sc) sc.scrollTop = el.offsetTop - 200;
  });
}

test.beforeEach(async ({ page }) => {
  await routeAnalytics(page);
  await page.route('**/rest/v1/rpc/list_public_boards**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
});

test('the spec exists and is registered for the sitemap', () => {
  expect(SPEC, '/scout must resolve in the landing registry').toBeTruthy();
  expect(SEO_LANDING_PATHS).toContain('/scout');
  expect(SPEC.heroDemo).toBe('scout');
});

test('SEO fields stay inside the limits that make them useful', () => {
  // Over ~60 chars Google truncates the title; over ~155 the description.
  expect(SPEC.title.length).toBeLessThanOrEqual(60);
  expect(SPEC.metaDescription.length).toBeLessThanOrEqual(155);
  // The answer block is what AI answer engines lift verbatim — it has to be a
  // self-contained paragraph, not a fragment.
  const answerWords = SPEC.answer.trim().split(/\s+/).length;
  expect(answerWords).toBeGreaterThanOrEqual(35);
  expect(answerWords).toBeLessThanOrEqual(90);
  expect(SPEC.sections.length).toBeGreaterThanOrEqual(3);
  expect(SPEC.faq.length).toBeGreaterThanOrEqual(4);
});

test('renders hero, every section, every FAQ, and every step', async ({ page }) => {
  await page.goto('/scout');
  await expect(page.locator('h1.seo-h1')).toHaveText(SPEC.h1);
  await expect(page.locator('.seo-subhead')).toContainText(SPEC.subhead.slice(0, 40));
  await expect(page.locator('.seo-answer')).toContainText(SPEC.answer.slice(0, 40));

  for (const s of SPEC.sections) {
    await expect(page.getByRole('heading', { name: s.heading, level: 2 })).toBeVisible();
  }
  for (const step of SPEC.steps) {
    await expect(page.getByText(step.t, { exact: false }).first()).toBeVisible();
  }
  for (const f of SPEC.faq) {
    await expect(page.getByText(f.q, { exact: false }).first()).toBeVisible();
  }
});

test('the demo animates: photos leave the message and land on the canvas', async ({ page }) => {
  await page.goto('/scout');
  await expect(page.locator('.scout-demo')).toBeAttached();

  await scrollToDemo(page);

  // All five photos land...
  await expect(page.locator('.scout-card.is-landed')).toHaveCount(5, { timeout: 6000 });
  // ...the group gets its title...
  await expect(page.locator('.scout-section-label.is-shown')).toBeVisible();
  // ...the note lands...
  await expect(page.locator('.scout-note.is-landed')).toBeVisible();
  // ...and the bot confirms.
  await expect(page.locator('.scout-bubble-in.is-shown')).toBeVisible();
  // The photo chips have flown OUT of the message bubble.
  await expect(page.locator('.scout-chip.is-gone')).toHaveCount(5);
});

test('Replay re-runs the animation from the start', async ({ page }) => {
  await page.goto('/scout');
  await scrollToDemo(page);
  await expect(page.locator('.scout-card.is-landed')).toHaveCount(5, { timeout: 6000 });

  await page.getByRole('button', { name: 'Replay' }).click();
  // Resets immediately...
  await expect(page.locator('.scout-card.is-landed')).toHaveCount(0);
  // ...then plays through again.
  await expect(page.locator('.scout-card.is-landed')).toHaveCount(5, { timeout: 6000 });
});

test('the demo is decorative and hidden from assistive tech', async ({ page }) => {
  await page.goto('/scout');
  // The same content exists as real prose in the sections/steps, so the
  // animation must not be announced as duplicate content.
  await expect(page.locator('.scout-demo-stage')).toHaveAttribute('aria-hidden', 'true');
  // The one interactive control stays reachable.
  await expect(page.getByRole('button', { name: 'Replay' })).toBeVisible();
});

test('the page renders with no console errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/scout');
  await scrollToDemo(page);
  await page.waitForTimeout(2500);
  expect(errors).toEqual([]);
});
