// planBlock.test.mjs — "What it costs" says the same true thing everywhere it
// appears, and appears only where it was decided it should.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { hasPlanBlock, planBlockModel, planBlockHtml, planBlockMarkdown, PLAN_BLOCK_ID } from './planBlock.js';
import { PRICING, PLAN_NAME, PRICING_PAGE, CREATOR_STORAGE_LABEL, CREATOR_BENEFITS } from './billingCopy.js';
import { SEO_LANDING_PAGES } from './seoLanding.js';
import { buildLandingCrawlableHtml } from '../worker.js';

const BOARDS = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('the block is on every comparison page and every flagged page — and nowhere else', () => {
  for (const spec of SEO_LANDING_PAGES) {
    const want = !spec.storefront && spec.planBlock !== false && (spec.kind === 'compare' || spec.planBlock === true);
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
  // Held by the owner 2026-10-01 until two weeks after its corrected copy was
  // live on production; turned on 2026-10-20 as the page's only change. A
  // stray `planBlock: false` coming back would quietly end planBlock.js's read.
  const pureref = SEO_LANDING_PAGES.find((s) => s.path === '/vs/pureref');
  assert.equal(pureref?.kind, 'compare');
  assert.equal(hasPlanBlock(pureref), true, '/vs/pureref carries the block — see planBlock.js');
  // And an explicit false beats kind:'compare' in the predicate itself.
  assert.equal(hasPlanBlock({ kind: 'compare', planBlock: false }), false);
  assert.equal(hasPlanBlock({ kind: 'compare' }), true);
});

test('the storage line names the drive once, and the workspace line is not said twice', () => {
  const m = planBlockModel();
  const storage = CREATOR_BENEFITS.find((b) => b.key === 'storage');
  // A bare "No size limits" read as no limit at all, so the line must name the
  // drive. Once: since 0413 the title IS the drive, and the old suffix printed
  // "A 1TB drive, on a 1TB drive" on every page carrying the block.
  assert.ok(m.creator.lines.includes(storage.title), 'the storage title is shown as it stands');
  const drive = m.creator.lines.filter((l) => l.includes(CREATOR_STORAGE_LABEL));
  assert.equal(drive.length, 1, 'one line names the drive');
  assert.equal(drive[0].split(CREATOR_STORAGE_LABEL).length - 1, 1, `the drive is named once: "${drive[0]}"`);
  const workspace = CREATOR_BENEFITS.find((b) => b.key === 'workspace');
  assert.ok(!m.creator.lines.includes(workspace.title), 'the closing note already says it');
  assert.ok(m.note.includes('whole workspace'));
  for (const out of [planBlockHtml('/x'), planBlockMarkdown().join('\n')]) {
    assert.ok(out.includes(`${CREATOR_STORAGE_LABEL} drive`));
    assert.ok(!out.includes(`drive, on a ${CREATOR_STORAGE_LABEL} drive`), 'the drive is not said twice');
    assert.equal(out.split('whole workspace').length - 1, 1, 'the workspace claim appears exactly once');
  }
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
