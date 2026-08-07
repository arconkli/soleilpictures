// /scout — the Soleil Scout landing page (pages/ScoutPage.jsx over the spec in
// lib/seoLanding.js).
//
// The page is a text conversation: ONE box, pinned dead centre for the whole
// page, with a message thread scrolling up past it — Scout on the left, you on
// the right. Assertions are registry-derived, so copy can be rewritten without
// touching this file.
//
// Five things are pinned, because each of them has already been broken once:
//
//   · The box NEVER MOVES. That is the entire design; if it drifts, the page is
//     just a scrolling document again.
//   · EVERY message gets its turn. They are opacity-driven off scroll progress,
//     so a scheduling mistake silently hides copy from readers while leaving it
//     in the DOM for crawlers — which is cloaking, and nothing else would catch
//     it.
//   · NO BUBBLE IS A PARAGRAPH. The rebuild exists because each card used to
//     carry a whole 40-word section body. One sentence, one bubble.
//   · Nothing overlaps the phone input on a narrow screen.
//   · With motion off, the page is a plain readable column.

import { expect, test } from '@playwright/test';
import { routeAnalytics } from './helpers/share-fixture.js';
import { getLandingSpec, SEO_LANDING_PATHS } from '../src/lib/seoLanding.js';

const SPEC = getLandingSpec('/scout');

// One bubble is one sentence, and a sentence longer than this is a paragraph
// wearing a bubble. Sentences over the limit get shortened in seoLanding.js —
// never split in the renderer, because splitting mid-sentence would drop the
// punctuation that joins the parts back together and the crawler would then be
// served a string the reader never sees.
const MAX_BUBBLE_WORDS = 22;

const setProgress = (page, f) => page.evaluate((x) => {
  const sc = document.querySelector('.scout-scroll');
  sc.scrollTop = (sc.scrollHeight - sc.clientHeight) * x;
}, f);

// Genuinely on screen. Bubbles are faded with OPACITY only — never
// visibility/display — so that every one of them stays in the accessibility
// tree and in innerText while it waits its turn.
const onScreen = (page, floor = 0.15) => page.evaluate((min) => [...document.querySelectorAll('.scout-msg:not(.scout-typing), .scout-div')]
  .filter((n) => parseFloat(getComputedStyle(n).opacity) > min)
  .map((n) => ({ key: n.dataset.msg, words: (n.innerText.trim().match(/\S+/g) || []).length })), floor);

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

test('the first screen is the headline, the contact and one phone box', async ({ page }) => {
  await page.goto('/scout');
  await expect(page.locator('h1.scout-h1')).toHaveText(SPEC.h1);
  await expect(page.locator('.scout-sub')).toHaveText(SPEC.subhead);
  await expect(page.locator('.scout-contact-name')).toHaveText('Soleil Scout');

  const box = page.locator('.scout-box');
  await expect(box.locator('input[type="tel"]')).toBeVisible();
  await expect(box.locator('button[type="submit"]')).toBeVisible();

  const bb = await page.locator('.scout-box-inner').boundingBox();
  expect(bb.y + bb.height).toBeLessThanOrEqual(page.viewportSize().height);
});

test('the caption under the button is consent and nothing else', async ({ page }) => {
  await page.goto('/scout');
  const cap = page.locator('.scout-box .sb-cap');
  // The line that makes the first message an opt-in rather than cold outreach.
  // It is stored with the row (consent_version), so it has to actually be an
  // agreement, not a vibe.
  await expect(cap).toContainText('agree to receive texts');
  await expect(cap).toContainText('Msg & data rates');
  await expect(cap.locator('a[href="/legal/terms"]')).toHaveCount(1);
  await expect(cap.locator('a[href="/legal/privacy"]')).toHaveCount(1);

  // No platform claim under a submit button. Whether SMS/RCS is live is
  // Photon's open question 3, not ours to promise or to rule out; the FAQ is
  // where that nuance belongs.
  const text = (await cap.innerText()).replace(/\s+/g, ' ').trim();
  expect(text.toLowerCase()).not.toContain('android');
  expect(text.toLowerCase()).not.toContain('iphone');
  expect(text.length, `caption is ${text.length} chars: ${text}`).toBeLessThanOrEqual(150);
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

test('every message gets its turn on screen', async ({ page }) => {
  await page.goto('/scout');
  await page.waitForTimeout(400);

  const total = await page.locator('.scout-msg:not(.scout-typing), .scout-div').count();
  const seen = new Set();
  for (let i = 0; i <= 80; i++) {
    await setProgress(page, i / 80);
    await page.waitForTimeout(70);
    (await onScreen(page)).forEach((n) => seen.add(n.key));
  }
  // A message scheduled outside the runway is copy the crawler is served and
  // the reader never sees.
  expect(seen.size, `only ${seen.size} of ${total} messages ever appeared`).toBe(total);
});

test('no bubble is a paragraph', async ({ page }) => {
  await page.goto('/scout');
  const worst = await page.evaluate(() => [...document.querySelectorAll('.scout-msg:not(.scout-typing)')]
    .map((n) => ({ words: (n.innerText.trim().match(/\S+/g) || []).length, text: n.innerText.trim() }))
    .sort((a, b) => b.words - a.words)[0]);
  // The entire reason this page was rebuilt: bubbles carrying 40-word section
  // bodies. If this fails, shorten the sentence in seoLanding.js.
  expect(worst.words, `longest bubble is ${worst.words} words: "${worst.text}"`)
    .toBeLessThanOrEqual(MAX_BUBBLE_WORDS);
});

test('the screen never fills up with text', async ({ page }) => {
  await page.goto('/scout');
  await page.waitForTimeout(400);
  let worstWords = 0;
  let worstCount = 0;
  for (let i = 0; i <= 50; i++) {
    await setProgress(page, i / 50);
    await page.waitForTimeout(60);
    // Legible, not merely present: the reading band fades bubbles out well
    // before the edge of the screen.
    const vis = await onScreen(page, 0.6);
    worstWords = Math.max(worstWords, vis.reduce((a, n) => a + n.words, 0));
    worstCount = Math.max(worstCount, vis.length);
  }
  // Word count, not bubble count, is the honest measure now — six eight-word
  // bubbles is a conversation, one forty-word slab is the wall.
  expect(worstWords, `${worstWords} words were legible at once`).toBeLessThanOrEqual(95);
  expect(worstCount, `${worstCount} bubbles were legible at once`).toBeLessThanOrEqual(12);
});

test('the crawler is served nothing the reader is not (anti-cloaking)', async ({ page }) => {
  await page.goto('/scout');
  const body = await page.locator('.scout-scene').innerText();

  // Exactly what worker.js's buildLandingCrawlableHtml() emits for this spec.
  // Bodies are split one-sentence-per-bubble, so this only passes while the
  // parts stay ADJACENT in DOM order — which is the property that makes the
  // split safe in the first place.
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
  // Case-insensitive on purpose: innerText reports text AFTER text-transform,
  // so a purely decorative `text-transform: uppercase` would fail this with a
  // baffling message while the DOM — and therefore the crawler — is fine. Case
  // is not a cloaking vector; missing strings are.
  const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
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
  const faded = await page.evaluate(() => [...document.querySelectorAll('.scout-msg, .scout-div')]
    .filter((n) => parseFloat(getComputedStyle(n).opacity) < 0.9).length);
  expect(faded).toBe(0);

  const body = await page.locator('.scout-scene').innerText();
  expect(body.replace(/\s+/g, ' ')).toContain(SPEC.faq[0].a.replace(/\s+/g, ' '));
});

test('on a narrow screen nothing lands on top of the phone input', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/scout');
  await page.waitForTimeout(400);

  for (let i = 0; i <= 30; i++) {
    await setProgress(page, i / 30);
    await page.waitForTimeout(70);
    const clash = await page.evaluate(() => {
      const input = document.querySelector('.scout-box input[type="tel"]');
      const btn = document.querySelector('.scout-box button[type="submit"]');
      if (!input || !btn) return 'controls missing';
      const targets = [input.getBoundingClientRect(), btn.getBoundingClientRect()];
      for (const n of document.querySelectorAll('.scout-msg, .scout-div')) {
        if (parseFloat(getComputedStyle(n).opacity) <= 0.15) continue;
        const r = n.getBoundingClientRect();
        for (const t of targets) {
          if (r.left < t.right && t.left < r.right && r.top < t.bottom && t.top < r.bottom) {
            return `${n.dataset.msg} overlaps a control`;
          }
        }
      }
      return null;
    });
    expect(clash, `at progress ${i}/30`).toBeNull();
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
