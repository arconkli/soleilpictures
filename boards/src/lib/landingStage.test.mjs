// landingStage.test.mjs — which search pages get the sun stage, and that every
// card the stage draws exists on disk.
//
// The pages whose first-time visitors sign up most often keep today's hero and
// only get suns behind it ('behind'); the rest get the full stage under the
// button ('full'). A page under a pre-registered title test keeps its look
// until the date it names. These pin the lists so a page can't drift between
// treatments by accident, and so a stage never paints a missing picture.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  stageMode, stageCards, hasStage, ogStageSlug, KEPT_CLOSE, STAGE_HELD, STAGE_DIR, FULL_LAYOUT, BEHIND_LAYOUT, OG_STAGE,
} from './landingStage.js';
import { STAGE_CARDS } from './landingStageCards.js';
import { SEO_LANDING_PAGES } from './seoLanding.js';
import { SEO_LISTICLE_PAGES } from './seoListicles.js';

const PUBLIC = fileURLToPath(new URL('../../public', import.meta.url));

test('the pages that convert best keep their hero, with suns behind it', () => {
  assert.deepEqual([...KEPT_CLOSE].sort(), [
    '/tools/mood-board-maker', '/tools/reference-board-maker', '/tools/shot-list-maker', '/vs/pureref',
  ]);
  for (const p of KEPT_CLOSE) assert.equal(stageMode(p), 'behind', p);
});

test('the other tool, comparison and ranked pages and /use-cases get the full stage', () => {
  for (const p of ['/tools/storyboard-maker', '/vs/milanote', '/best/milanote-alternatives', '/use-cases']) {
    assert.equal(stageMode(p), 'full', p);
  }
});

test('a held page keeps today\'s look; pages outside the search set get no stage', () => {
  assert.ok(STAGE_HELD['/best/pureref-alternatives'], 'the title test on /best/pureref-alternatives holds its look');
  for (const p of Object.keys(STAGE_HELD)) assert.equal(stageMode(p), null, p);
  for (const p of ['/', '/scout', '/templates', '/pricing', '/docs', '/c/japandi-living-room', '', null, undefined]) {
    assert.equal(stageMode(p), null, String(p));
  }
});

test('every staged page with a hero board has that board\'s cut-outs', () => {
  for (const spec of [...SEO_LANDING_PAGES, ...SEO_LISTICLE_PAGES]) {
    const mode = stageMode(spec.path);
    const slug = spec.exampleSlugs?.[0];
    if (!mode || !slug || spec.storefront) continue;
    assert.ok(hasStage(slug), `${spec.path} (${mode}) leads with ${slug}, which has no cut-outs: run scripts/shootStageCards.mjs`);
  }
});

test('every cut-out a layout can draw is on disk, with a size', () => {
  for (const slug of Object.keys(STAGE_CARDS)) {
    for (const layout of [FULL_LAYOUT, BEHIND_LAYOUT]) {
      for (const c of stageCards(slug, layout)) {
        assert.ok(c.src.startsWith(`${STAGE_DIR}/${slug}/`), c.src);
        assert.ok(existsSync(`${PUBLIC}${c.src}`), `missing ${c.src}`);
        assert.ok(c.w > 0 && c.h > 0, `${c.src} has no size`);
      }
    }
  }
});

test('a board missing a role just skips that card; an unknown board draws nothing', () => {
  const slug = Object.keys(STAGE_CARDS)[0];
  const roles = stageCards(slug, FULL_LAYOUT).map((c) => c.role);
  assert.deepEqual(roles, FULL_LAYOUT.cards.map(([r]) => r).filter((r) => STAGE_CARDS[slug][r]));
  assert.deepEqual(stageCards('no-such-board', FULL_LAYOUT), []);
  assert.equal(hasStage('no-such-board'), false);
});

test('a link preview is drawn in the sun look exactly when the page shows a board on the stage', () => {
  const all = [...SEO_LANDING_PAGES, ...SEO_LISTICLE_PAGES];
  const byPath = Object.fromEntries(all.map((s) => [s.path, s]));
  assert.equal(ogStageSlug(byPath['/vs/pureref']), byPath['/vs/pureref'].exampleSlugs[0]);
  assert.equal(ogStageSlug(byPath['/best/milanote-alternatives']), byPath['/best/milanote-alternatives'].exampleSlugs[0]);
  assert.equal(ogStageSlug(byPath['/best/pureref-alternatives']), null, 'held: keeps its card');
  assert.equal(ogStageSlug(byPath['/scout']), null);
  assert.equal(ogStageSlug(null), null);
  for (const spec of all) {
    const slug = ogStageSlug(spec);
    if (slug) assert.equal(slug, spec.exampleSlugs[0], spec.path);
  }
  for (const [role] of OG_STAGE.cards) assert.ok(FULL_LAYOUT.cards.some(([r]) => r === role), role);
});

test('every layout card has a desktop place, and a phone place or none', () => {
  for (const layout of [FULL_LAYOUT, BEHIND_LAYOUT]) {
    for (const [role, desk, phone, depth] of layout.cards) {
      assert.equal(desk.length, 4, role);
      assert.ok(phone === null || phone.length === 4, role);
      assert.ok(depth > 0, role);
    }
  }
});
