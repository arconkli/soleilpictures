// /scout — the Soleil Scout landing page (pages/ScoutPage.jsx over the spec in
// lib/seoLanding.js).
//
// The page is shaped like the primary landing page: ONE box, pinned dead centre
// for the whole page, with short notes streaming past it in scenes that rotate
// around it. Assertions are registry-derived — they read from the spec, so copy
// can be rewritten without touching this file.
//
// Four things are pinned, because each of them has already been broken once:
//
//   · The box NEVER MOVES. That is the entire design; if it drifts, the page is
//     just a scrolling document again.
//   · EVERY note gets its turn. They are opacity-driven off scroll progress, so
//     a scheduling mistake silently hides copy from readers while leaving it in
//     the DOM for crawlers — which is cloaking, and nothing else would catch it.
//   · Nothing overlaps the phone input on a narrow screen.
//   · With motion off, the page is a plain readable column.

import { expect, test } from '@playwright/test';
import { routeAnalytics } from './helpers/share-fixture.js';
import { getLandingSpec, SEO_LANDING_PATHS } from '../src/lib/seoLanding.js';

const SPEC = getLandingSpec('/scout');

const setProgress = (page, f) => page.evaluate((x) => {
  const sc = document.querySelector('.scout-scroll');
  sc.scrollTop = (sc.scrollHeight - sc.clientHeight) * x;
}, f);

// Genuinely on screen. Notes are faded with OPACITY only — never
// visibility/display — so that every one of them stays in the accessibility
// tree and in innerText while it waits its turn.
const visibleNotes = (page) => page.evaluate(() => [...document.querySelectorAll('.scout-note')]
  .filter((n) => parseFloat(getComputedStyle(n).opacity) > 0.15)
  .map((n) => n.dataset.note));

function routeSignup(page, body, status = 200) {
  return page.route('**/api/scout/signup', (route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }));
}

test.beforeEach(async ({ page }) => {
  await routeAnalytics(page);
  await page.route('**/rest/v1/rpc/list_public_boards**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
});

test('the spec exists and is registered for the sitemap', () => {
  expect(SPEC, '/scout must resolve in the landing registry').toBeTruthy();
  expect(SEO_LANDING_PATHS).toContain('/scout');
});

test('SEO fields stay inside the limits that make them useful', () => {
  expect(SPEC.title.length).toBeLessThanOrEqual(60);
  expect(SPEC.metaDescription.length).toBeLessThanOrEqual(155);
  const answerWords = SPEC.answer.trim().split(/\s+/).length;
  expect(answerWords).toBeGreaterThanOrEqual(35);
  expect(answerWords).toBeLessThanOrEqual(90);
  expect(SPEC.sections.length).toBeGreaterThanOrEqual(3);
  expect(SPEC.faq.length).toBeGreaterThanOrEqual(4);
  // One line above the box. Longer starts competing with the thing we want
  // people to do.
  expect(SPEC.subhead.length).toBeLessThanOrEqual(90);
  // Notes have to be readable as notes. These stream past a pinned box; a
  // 90-word paragraph floating beside it is what this page was rebuilt to stop.
  for (const s of SPEC.sections) {
    expect(s.body.split(/\s+/).length, `section too long: ${s.heading}`).toBeLessThanOrEqual(40);
  }
  for (const f of SPEC.faq) {
    expect(f.a.split(/\s+/).length, `faq answer too long: ${f.q}`).toBeLessThanOrEqual(45);
  }
});

test('the subhead explains the product without narrowing it to location scouts', () => {
  // The product is named Scout and ranks for scouting terms, but an AD, a
  // gaffer and a production designer have the same camera-roll problem. A
  // subhead about shooting locations tells three of them this isn't for them.
  expect(SPEC.subhead.toLowerCase()).not.toContain('location');
});

test('the first screen is the headline and one phone box', async ({ page }) => {
  await page.goto('/scout');
  await expect(page.locator('h1.scout-h1')).toHaveText(SPEC.h1);
  await expect(page.locator('.scout-sub')).toHaveText(SPEC.subhead);

  const box = page.locator('.scout-box');
  await expect(box.locator('input[type="tel"]')).toBeVisible();
  await expect(box.locator('button[type="submit"]')).toBeVisible();
  await expect(box).toContainText('agree to receive text messages');

  const bb = await page.locator('.scout-box-inner').boundingBox();
  expect(bb.y + bb.height).toBeLessThanOrEqual(page.viewportSize().height);
});

test('the box never moves, however far you scroll', async ({ page }) => {
  await page.goto('/scout');
  await page.waitForTimeout(400);
  const at = async (f) => {
    await setProgress(page, f);
    await page.waitForTimeout(250);
    const b = await page.locator('.scout-box-inner').boundingBox();
    return { x: Math.round(b.x), y: Math.round(b.y) };
  };
  const first = await at(0);
  for (const f of [0.25, 0.5, 0.75, 1]) {
    expect(await at(f), `box moved at ${f}`).toEqual(first);
  }
});

test('every note gets its turn on screen', async ({ page }) => {
  await page.goto('/scout');
  await page.waitForTimeout(400);

  const total = await page.locator('.scout-note').count();
  const seen = new Set();
  for (let i = 0; i <= 60; i++) {
    await setProgress(page, i / 60);
    await page.waitForTimeout(90);
    (await visibleNotes(page)).forEach((k) => seen.add(k));
  }
  // A note scheduled outside the runway is copy the crawler is served and the
  // reader never sees.
  expect(seen.size, `only ${seen.size} of ${total} notes ever appeared`).toBe(total);
});

test('only a few notes share the screen at once', async ({ page }) => {
  await page.goto('/scout');
  await page.waitForTimeout(400);
  let worst = 0;
  for (let i = 0; i <= 40; i++) {
    await setProgress(page, i / 40);
    await page.waitForTimeout(70);
    worst = Math.max(worst, (await visibleNotes(page)).length);
  }
  // The whole point of the rebuild: never a wall of text.
  expect(worst, `${worst} notes were on screen at once`).toBeLessThanOrEqual(4);
});

test('the crawler is served nothing the reader is not (anti-cloaking)', async ({ page }) => {
  await page.goto('/scout');
  const body = await page.locator('.scout-scene').innerText();

  // Exactly what worker.js's buildLandingCrawlableHtml() emits for this spec.
  const shouldAppear = [
    SPEC.h1,
    SPEC.subhead,
    SPEC.answer,
    ...SPEC.sections.map((s) => s.heading),
    ...SPEC.sections.map((s) => s.body),
    ...SPEC.sections.flatMap((s) => s.bullets || []),
    ...SPEC.steps.map((s) => s.t),
    ...SPEC.steps.map((s) => s.d),
    ...SPEC.faq.map((f) => f.q),
    ...SPEC.faq.map((f) => f.a),
  ];
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const haystack = norm(body);
  for (const needle of shouldAppear) {
    expect(haystack, `missing: ${needle.slice(0, 60)}…`).toContain(norm(needle));
  }
});

test('headings stay real headings so the outline survives', async ({ page }) => {
  await page.goto('/scout');
  for (const s of SPEC.sections) {
    await expect(page.getByRole('heading', { name: s.heading, level: 2 })).toHaveCount(1);
  }
  for (const f of SPEC.faq) {
    await expect(page.getByRole('heading', { name: f.q, level: 3 })).toHaveCount(1);
  }
});

test('with motion off the page is a plain readable column', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/scout');
  await page.waitForTimeout(300);

  // The runway never engages, so nothing is absolutely positioned or faded.
  await expect(page.locator('.scout-scene.is-runway')).toHaveCount(0);
  const faded = await page.evaluate(() => [...document.querySelectorAll('.scout-note')]
    .filter((n) => parseFloat(getComputedStyle(n).opacity) < 0.9).length);
  expect(faded).toBe(0);

  const body = await page.locator('.scout-scene').innerText();
  expect(body.replace(/\s+/g, ' ')).toContain(SPEC.faq[0].a.replace(/\s+/g, ' '));
});

test('on a narrow screen nothing lands on top of the phone input', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/scout');
  await page.waitForTimeout(400);

  for (let i = 0; i <= 24; i++) {
    await setProgress(page, i / 24);
    await page.waitForTimeout(80);
    const clash = await page.evaluate(() => {
      const input = document.querySelector('.scout-box input[type="tel"]');
      const btn = document.querySelector('.scout-box button[type="submit"]');
      if (!input || !btn) return 'controls missing';
      const targets = [input.getBoundingClientRect(), btn.getBoundingClientRect()];
      for (const n of document.querySelectorAll('.scout-note')) {
        if (parseFloat(getComputedStyle(n).opacity) <= 0.15) continue;
        const r = n.getBoundingClientRect();
        for (const t of targets) {
          if (r.left < t.right && t.left < r.right && r.top < t.bottom && t.top < r.bottom) {
            return `${n.dataset.note} overlaps a control`;
          }
        }
      }
      return null;
    });
    expect(clash, `at progress ${i}/24`).toBeNull();
  }
});

test('a queued invite is never described as a text that was sent', async ({ page }) => {
  await routeSignup(page, { status: 'queued', is_new: true });
  await page.goto('/scout');
  await page.locator('.scout-box input[type="tel"]').fill('(555) 012-3456');
  await page.locator('.scout-box button[type="submit"]').click();

  const done = page.locator('.scout-box-done');
  await expect(done).toBeVisible();
  await expect(done).toContainText("You're on the list");
  await expect(done).not.toContainText('check your messages', { ignoreCase: true });
});

test('a genuinely sent invite says so', async ({ page }) => {
  await routeSignup(page, { status: 'texted', is_new: true });
  await page.goto('/scout');
  await page.locator('.scout-box input[type="tel"]').fill('+15550123456');
  await page.locator('.scout-box button[type="submit"]').click();
  await expect(page.locator('.scout-box-done')).toContainText('check your messages');
});

test('a rejected number is explained without losing what was typed', async ({ page }) => {
  await routeSignup(page, { error: "That doesn't look like a mobile number." }, 400);
  await page.goto('/scout');
  const input = page.locator('.scout-box input[type="tel"]');
  await input.fill('12345');
  await page.locator('.scout-box button[type="submit"]').click();

  await expect(page.locator('.scout-box .auth-error')).toContainText('mobile number');
  await expect(input).toHaveValue('12345');
  await expect(input).toBeEnabled();
});

test('the page renders with no console errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/scout');
  await setProgress(page, 0.5);
  await page.waitForTimeout(800);
  expect(errors).toEqual([]);
});
