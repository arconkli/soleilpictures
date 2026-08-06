// /scout — the Soleil Scout landing page (pages/ScoutPage.jsx over the spec in
// lib/seoLanding.js).
//
// The page is a text thread: one phone-number box on the first screen, then a
// conversation whose bubbles carry the copy while a canvas fills in beside it.
//
// Assertions are registry-derived — they read from the spec, so copy can be
// rewritten without touching this file. What's pinned is the STRUCTURE, and
// three things in particular:
//
//   · EVERY spec string renders. This page has its own renderer, so a beat
//     dropped from buildThread() would silently serve crawlers more content
//     than humans — which is cloaking, and nothing else would catch it.
//   · The box says only what is true. It must never claim a text was sent when
//     the server said the invite is merely queued.
//   · The thread is readable with motion off. The animation is decoration; the
//     copy is the page.

import { expect, test } from '@playwright/test';
import { routeAnalytics } from './helpers/share-fixture.js';
import { getLandingSpec, SEO_LANDING_PATHS } from '../src/lib/seoLanding.js';

const SPEC = getLandingSpec('/scout');

// This page scrolls inside .seo-scroll, NOT the window — scrolling the window
// moves nothing and makes the thread look like it never reveals. (Same gotcha
// the listicle TOC test guards.)
async function scrollThread(page, steps = 14) {
  for (let i = 1; i <= steps; i++) {
    await page.evaluate((frac) => {
      const sc = document.querySelector('.seo-scroll');
      if (sc) sc.scrollTop = (sc.scrollHeight - sc.clientHeight) * frac;
    }, i / steps);
    await page.waitForTimeout(120);
  }
}

// The endpoint is stubbed everywhere: a real POST would queue a genuine text.
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
  // The subhead sits between the h1 and the box. Long enough to say something,
  // short enough not to compete with the one thing we want people to do.
  expect(SPEC.subhead.length).toBeLessThanOrEqual(90);
});

test('the first screen is the headline and one phone box', async ({ page }) => {
  await page.goto('/scout');
  await expect(page.locator('h1.scout-h1')).toHaveText(SPEC.h1);
  await expect(page.locator('.scout-sub')).toHaveText(SPEC.subhead);

  const box = page.locator('.scout-hero .scout-box');
  await expect(box).toBeVisible();
  await expect(box.locator('input[type="tel"]')).toBeVisible();
  await expect(box.locator('button[type="submit"]')).toBeVisible();

  // It must be reachable without scrolling — it is the entire call to action.
  const boxBox = await box.boundingBox();
  const vh = page.viewportSize().height;
  expect(boxBox.y + boxBox.height).toBeLessThanOrEqual(vh);

  // Consent has to be stated where the number is entered, not buried in the
  // footer: this line is what makes the first message an opt-in.
  await expect(box).toContainText('agree to receive text messages');
});

test('the crawler is served nothing the reader is not (anti-cloaking)', async ({ page }) => {
  await page.goto('/scout');
  await scrollThread(page);
  const body = await page.locator('.seo-scroll').innerText();

  // Exactly what worker.js's buildLandingCrawlableHtml() emits for this spec —
  // h1, subhead, answer, updated, sections (+bullets), steps, faq, related.
  // /scout carries no eyebrow, compare table, siblingListicle or exampleSlugs,
  // so those branches emit nothing. If the thread drops any of the rest, the
  // crawler is reading a richer page than the visitor, which is cloaking, and
  // no other test on this page would notice.
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
    expect(haystack, `missing from the thread: ${needle.slice(0, 60)}…`).toContain(norm(needle));
  }

  // The visible freshness signal the worker also renders as a <time>.
  const pretty = new Date(SPEC.updated + 'T00:00:00Z')
    .toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  expect(haystack).toContain(`Updated ${pretty}`);

  // Internal-link spokes — the worker emits one <a> per related path.
  for (const path of SPEC.related) {
    await expect(page.locator(`.seo-related a[href="${path}"]`)).toHaveCount(1);
  }
});

test('section headings stay real headings so the outline survives', async ({ page }) => {
  await page.goto('/scout');
  await scrollThread(page);
  // Styled as thread dividers, but still h2 — a crawler reads the outline, not
  // the CSS.
  for (const s of SPEC.sections) {
    await expect(page.getByRole('heading', { name: s.heading, level: 2 })).toHaveCount(1);
  }
  for (const f of SPEC.faq) {
    await expect(page.getByRole('heading', { name: f.q, level: 3 })).toHaveCount(1);
  }
});

test('bubbles reveal as the thread scrolls', async ({ page }) => {
  await page.goto('/scout');
  const bubbles = page.locator('.scout-bubble');
  await expect(bubbles.first()).toBeAttached();

  // Nothing far down the thread has revealed yet.
  const total = await bubbles.count();
  const revealedAtTop = await page.locator('.scout-bubble.is-in').count();
  expect(revealedAtTop).toBeLessThan(total);

  await scrollThread(page);
  await expect(page.locator('.scout-bubble.is-in')).toHaveCount(total);
});

test('the canvas fills in as the conversation advances', async ({ page }) => {
  await page.goto('/scout');
  await expect(page.locator('.scout-canvas')).toBeAttached();
  await expect(page.locator('.scout-card.is-landed')).toHaveCount(0);

  await scrollThread(page);

  // Photos land, the group gets its title, the note arrives, and the board it
  // is sitting on changes once the "file it later" beat is read.
  await expect(page.locator('.scout-card.is-landed')).toHaveCount(5);
  await expect(page.locator('.scout-section-label.is-shown')).toBeAttached();
  await expect(page.locator('.scout-note.is-landed')).toBeAttached();
  await expect(page.locator('.scout-board-name.is-filed')).toHaveText('Diner Recce');
});

test('the FAQ leaves the two-column layout so nothing is stranded beside it', async ({ page }) => {
  await page.goto('/scout');
  await scrollThread(page);

  // The canvas is sticky inside .scout-conv only. If the FAQ lived in that
  // grid too, a third of the width would sit empty beside eight paragraphs.
  await expect(page.locator('.scout-conv .scout-faq')).toHaveCount(0);
  await expect(page.locator('.scout-faq .scout-bubble')).toHaveCount(SPEC.faq.length * 2);

  // And it's centred rather than pinned to the old message column.
  const faq = await page.locator('.scout-faq').boundingBox();
  const vw = page.viewportSize().width;
  const centreOffset = Math.abs((faq.x + faq.width / 2) - vw / 2);
  expect(centreOffset).toBeLessThan(24);
});

test('with motion off the whole thread is still readable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/scout');

  // No scrolling at all: everything is already in its end state.
  const total = await page.locator('.scout-bubble').count();
  await expect(page.locator('.scout-bubble.is-in')).toHaveCount(total);
  await expect(page.locator('.scout-card.is-landed')).toHaveCount(5);

  const body = await page.locator('.seo-scroll').innerText();
  expect(body.replace(/\s+/g, ' ')).toContain(SPEC.faq[0].a.replace(/\s+/g, ' '));
});

test('a queued invite is never described as a text that was sent', async ({ page }) => {
  await routeSignup(page, { status: 'queued', is_new: true });
  await page.goto('/scout');

  await page.locator('.scout-hero input[type="tel"]').fill('(555) 012-3456');
  await page.locator('.scout-hero button[type="submit"]').click();

  const done = page.locator('.scout-hero .scout-box-done');
  await expect(done).toBeVisible();
  await expect(done).toContainText("You're on the list");
  // The honesty assertion: nothing was sent, so nothing may claim it was.
  await expect(done).not.toContainText('check your messages', { ignoreCase: true });
});

test('a genuinely sent invite says so', async ({ page }) => {
  await routeSignup(page, { status: 'texted', is_new: true });
  await page.goto('/scout');

  await page.locator('.scout-hero input[type="tel"]').fill('+15550123456');
  await page.locator('.scout-hero button[type="submit"]').click();

  await expect(page.locator('.scout-hero .scout-box-done')).toContainText('check your messages');
});

test('a rejected number is explained without losing what was typed', async ({ page }) => {
  await routeSignup(page, { error: "That doesn't look like a mobile number." }, 400);
  await page.goto('/scout');

  const input = page.locator('.scout-hero input[type="tel"]');
  await input.fill('12345');
  await page.locator('.scout-hero button[type="submit"]').click();

  await expect(page.locator('.scout-hero .auth-error')).toContainText('mobile number');
  // Still editable, still holding their input — clearing the field on an error
  // makes people retype a number they just typed.
  await expect(input).toHaveValue('12345');
  await expect(input).toBeEnabled();
});

test('the closing ask is the same box', async ({ page }) => {
  await routeSignup(page, { status: 'queued', is_new: true });
  await page.goto('/scout');
  await scrollThread(page);
  await expect(page.locator('.scout-close input[type="tel"]')).toBeVisible();
});

test('the page renders with no console errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/scout');
  await scrollThread(page);
  expect(errors).toEqual([]);
});
