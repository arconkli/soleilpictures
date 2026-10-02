// planBlock.test.mjs — "What it costs" says the same true thing everywhere it
// appears, and appears only where it was decided it should.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { hasPlanBlock, planBlockModel, planBlockHtml, planBlockMarkdown, PLAN_BLOCK_ID } from './planBlock.js';
import { PRICING, PLAN_NAME, PRICING_PAGE } from './billingCopy.js';
import { SEO_LANDING_PAGES } from './seoLanding.js';
import { buildLandingCrawlableHtml } from '../worker.js';

const BOARDS = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('the block is on every comparison page and every flagged page — and nowhere else', () => {
  for (const spec of SEO_LANDING_PAGES) {
    const want = !spec.storefront && (spec.kind === 'compare' || spec.planBlock === true);
    assert.equal(hasPlanBlock(spec), want, spec.path);
    const html = buildLandingCrawlableHtml(spec);
    assert.equal(html.includes(`id="${PLAN_BLOCK_ID}"`), want,
      `${spec.path}: the Worker body ${want ? 'is missing' : 'should not carry'} the plan block`);
  }
  // The decision, pinned: hobbyist tool pages do not carry it.
  for (const p of ['/tools/free-mood-board-maker', '/tools/mood-board-maker', '/tools/reference-board-maker']) {
    const spec = SEO_LANDING_PAGES.find((s) => s.path === p);
    if (spec) assert.equal(hasPlanBlock(spec), false, `${p} is a solo/hobbyist page — no price block (see planBlock.js)`);
  }
  assert.ok(SEO_LANDING_PAGES.some(hasPlanBlock), 'no page carries the block at all');
});

test('every number comes from billingCopy, and the trial never appears', () => {
  const m = planBlockModel();
  assert.equal(m.creator.price, PRICING.monthly.billedLabel);
  assert.ok(m.creator.annual.includes(PRICING.annual.perMonthLabel));
  assert.equal(m.creator.name, PLAN_NAME);
  assert.equal(m.free.price, PRICING_PAGE.freeCardPrice);
  assert.equal(m.note, PRICING_PAGE.workspaceNote);
  for (const out of [planBlockHtml('/x'), planBlockMarkdown().join('\n')]) {
    assert.doesNotMatch(out, /\btrial\b|\d+ days free/i, 'the trial is in-product only');
    assert.ok(out.includes(PRICING.monthly.billedLabel) && out.includes(`${PRICING.annual.perMonthLabel}/mo`));
    assert.match(out, /no per-seat charges/);
  }
});

test('the free start in the block attributes to the page it is on', () => {
  const spec = SEO_LANDING_PAGES.find(hasPlanBlock);
  assert.ok(buildLandingCrawlableHtml(spec).includes(`href="${spec.cta.href.replace(/&/g, '&amp;')}"`));
});

test('React renders the same model in the same place, with a phone-visible way in', () => {
  const page = readFileSync(resolve(BOARDS, 'src/pages/SeoLandingPage.jsx'), 'utf8');
  assert.match(page, /planBlockModel\(\)/, 'SeoLandingPage must render from planBlockModel');
  assert.match(page, /hasPlanBlock\(spec\) && <PlanBlock/, 'the section must use the shared predicate');
  assert.match(page, /href="#what-it-costs"/, 'the hero needs the in-page link — the topbar Pricing link is hidden on phones');
  // Same order as the Worker: after the comparison table, before the sibling roundup.
  const block = page.indexOf('<PlanBlock lp=');
  assert.ok(page.indexOf('{spec.compare && (') < block && block < page.indexOf('{spec.siblingListicle && ('),
    'the block moved relative to the comparison table — move the Worker and the .md twin with it');
});

test('the .md twins carry it where the page does', () => {
  for (const spec of SEO_LANDING_PAGES.filter(hasPlanBlock)) {
    const md = resolve(BOARDS, 'public', `${spec.path.slice(1)}.md`);
    if (!existsSync(md)) continue; // gen-docs not run in this checkout
    assert.match(readFileSync(md, 'utf8'), /^## What it costs$/m, `${spec.path}.md is stale — run npm run docs:build`);
  }
});
