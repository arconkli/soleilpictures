// pricingCrawlable.test.mjs — /pricing as non-JavaScript readers get it.
//
// The page shipped for months with a crawlable body byte-identical to the
// homepage's: a meta description carried the only price. These assertions are
// the reasons that cannot quietly come back.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildPricingCrawlableHtml, buildPricingJsonLd, pricingMarkdown, pricingModel, PRICING_ANSWER,
} from './pricingCrawlable.js';
import {
  PLAN_NAME, PRICING, PRICING_PAGE, PLAN_COMPARISON, PRICING_FAQ, CREATOR_BENEFITS, DEMO_FEATURES,
} from './billingCopy.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BOARDS = resolve(HERE, '../..');

const html = buildPricingCrawlableHtml();
const md = pricingMarkdown();
// Compare against what a reader sees, not the escaping: an apostrophe in an FAQ
// answer is &#39; in the HTML and a naive includes() would call it missing.
const text = html
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ');
const plain = (s) => String(s).replace(/\*\*/g, '');

test('the crawlable body carries everything the React page renders', () => {
  const must = [
    PRICING_PAGE.h1, PRICING_PAGE.subhead,
    PRICING_PAGE.freeCardName, PRICING_PAGE.freeCardPrice, PRICING_PAGE.freeCardSub,
    PLAN_NAME, PRICING.monthly.billedLabel, PRICING.annual.billedLabel, PRICING_PAGE.paidCardSub,
    PRICING_PAGE.paidHeading, PRICING_PAGE.paidBody, PRICING_PAGE.workspaceNote,
    PRICING_PAGE.closing, PRICING_PAGE.closingSub, PRICING_PAGE.startFreeSub, PRICING_PAGE.trustLine,
    PRICING_PAGE.shot.caption,
    ...DEMO_FEATURES.map(plain),
    ...CREATOR_BENEFITS.flatMap((b) => [b.title, plain(b.body)]),
    ...PLAN_COMPARISON.flatMap((r) => [r.label, r.demo, r.creator]),
    ...PRICING_FAQ.flatMap((f) => [f.q, f.a]),
  ];
  const missing = must.filter((s) => !text.includes(plain(s)));
  assert.deepEqual(missing, [], 'the server-rendered /pricing body dropped copy the React page shows');
});

// The other direction. The forward test above proves crawlers get everything
// a visitor sees; this proves visitors get everything crawlers see. The first
// version of this body carried an eyebrow, the answer paragraph and the docs
// links that the React page never rendered — copy shown only to crawlers,
// which is the definition of what parity exists to prevent. Checked at the
// source: each element the Worker prints names the export the view draws it
// from, and the view must draw from it.
test('the React page renders everything the crawlable body says', () => {
  // Comments AND imports out: an identifier only counts if the view USES it —
  // the first version of this test passed with the answer deleted from the
  // JSX, because its name was still on the import line.
  const view = readFileSync(resolve(BOARDS, 'src/auth/PricingPageView.jsx'), 'utf8')
    .split('\n').filter((l) => !/^\s*(\/\/|\{?\/\*|\*|import\b)/.test(l)).join('\n');
  const bits = readFileSync(resolve(BOARDS, 'src/components/PricingBits.jsx'), 'utf8');
  const drawnFrom = [
    'PRICING_PAGE.h1', 'PRICING_PAGE.subhead', 'PRICING_ANSWER',
    'PRICING_PAGE.freeCardName', 'PRICING_PAGE.freeCardPrice', 'PRICING_PAGE.freeCardUnit',
    'PRICING_PAGE.freeCardSub', 'DEMO_FEATURES', 'PLAN_NAME', 'PRICING_PAGE.paidCardSub',
    'CREATOR_BENEFITS', 'PRICING_PAGE.startFreeSub', 'PRICING_PAGE.trustLine', 'shot.caption',
    'PRICING_PAGE.paidHeading', 'PRICING_PAGE.paidBody', 'PLAN_COMPARISON', 'PRICING_PAGE.workspaceNote',
    'PRICING_FAQ', 'PRICING_PAGE.closing', 'PRICING_PAGE.closingSub',
    'CreatorPriceRow', 'PlanToggle',
  ];
  // Whole identifiers only: 'PRICING_PAGE.closing' is a prefix of
  // 'PRICING_PAGE.closingSub', and a substring match let the closing heading
  // be deleted from the view without this test noticing.
  const uses = (id) => new RegExp(`${id.replace(/\./g, '\\.')}(?![A-Za-z0-9_])`).test(view);
  const missing = drawnFrom.filter((id) => !uses(id));
  assert.deepEqual(missing, [], 'the crawlable /pricing body says things the React page does not render');
  // The prices the body states come through the shared price row and toggle.
  for (const id of ['SAVINGS_PCT_LABEL', 'planPerMonth', 'planBilling']) {
    assert.ok(bits.includes(id), `PricingBits no longer renders ${id}`);
  }
  // Links the body carries, rendered by the view too.
  for (const href of ['/docs/account/plans', '/pricing.md', '/llms.txt']) {
    assert.ok(html.includes(`href="${href}"`), `the body lost ${href}`);
    assert.ok(view.includes(`href="${href}"`), `the React page does not render the ${href} link the body carries`);
  }
  // And nothing crawler-only: the view has no eyebrow, so the body has none.
  assert.doesNotMatch(html, /text-transform:uppercase/, 'an eyebrow line the React page does not show');
  // Same order as the view: plans, then the answer, then the table.
  // …on BOTH sides. Reading only the crawler's text, the React page could
  // move its answer anywhere and this would still pass.
  const at = (s) => text.indexOf(plain(s));
  assert.ok(at(PRICING_PAGE.freeCardSub) < at(PRICING_ANSWER) && at(PRICING_ANSWER) < at(PRICING_PAGE.paidHeading),
    'the crawlable body moved the answer relative to the plans or the table');
  const inView = (id) => view.search(new RegExp(`\\{${id.replace(/\./g, '\\.')}\\}`));
  assert.ok(inView('PRICING_PAGE.freeCardSub') > 0 && inView('PRICING_PAGE.freeCardSub') < inView('PRICING_ANSWER')
    && inView('PRICING_ANSWER') < inView('PRICING_PAGE.paidHeading'),
    'the React page moved the answer relative to the plans or the table — move pricingCrawlable with it');
});

test('the twin and the body state both prices and the workspace scope', () => {
  for (const out of [text, md]) {
    assert.ok(out.includes(PRICING.monthly.billedLabel) && out.includes(PRICING.annual.billedLabel),
      'both the monthly and the annual price must be stated');
    assert.match(out, /no per-seat charges/, 'the one competitive fact — no per-seat charges — must be stated');
  }
  assert.ok(md.length >= 1000, `pricing.md is ${md.length} bytes; the mirror floor is 1000`);
  assert.ok(text.includes(PRICING_ANSWER), 'the liftable answer sentence must be in the body');
});

test('the trial is never offered here — it is in-product only', () => {
  // Owner decision (billingCopy PRICING_PAGE header): the trial goes to an
  // account with a real body of work. A signed-out reader has none.
  for (const out of [text, md, JSON.stringify(buildPricingJsonLd())]) {
    assert.doesNotMatch(out, /\btrial\b|free for \d+ days|\d+ days free/i);
  }
});

test('the JSON-LD prices come from billingCopy and assert nothing it cannot back', () => {
  const ld = buildPricingJsonLd();
  const graph = ld['@graph'];
  const app = graph.find((n) => n['@type'] === 'SoftwareApplication');
  assert.ok(app, 'expected a SoftwareApplication node');
  const prices = app.offers.map((o) => o.price).sort((a, b) => Number(a) - Number(b));
  assert.deepEqual(prices, ['0', String(PRICING.monthly.billed), String(PRICING.annual.billed)]);
  for (const o of app.offers) assert.equal(o.priceCurrency, 'USD');
  const faq = graph.find((n) => n['@type'] === 'FAQPage');
  assert.equal(faq.mainEntity.length, PRICING_FAQ.length);
  const s = JSON.stringify(ld);
  assert.doesNotMatch(s, /AggregateRating|"Review"/, 'no ratings markup — repo-wide rule');
  // Its own @id: the site-wide index.html node carries no offers, and two nodes
  // with one @id asserting different prices is worse than either alone.
  assert.ok(app['@id'].endsWith('/pricing#plans'));
});

test('pricingModel is the same data the React page imports', () => {
  const m = pricingModel();
  assert.equal(m.comparison.rows.length, PLAN_COMPARISON.length);
  assert.equal(m.creator.benefits.length, CREATOR_BENEFITS.length);
  assert.equal(m.free.features.length, DEMO_FEATURES.length);
  // PricingPageView must keep drawing from these same exports, or "parity by
  // construction" is a claim about a page that no longer reads them.
  const view = readFileSync(resolve(BOARDS, 'src/auth/PricingPageView.jsx'), 'utf8');
  for (const name of ['DEMO_FEATURES', 'PRICING_PAGE', 'PLAN_COMPARISON', 'PRICING_FAQ', 'CREATOR_BENEFITS']) {
    assert.ok(view.includes(name), `PricingPageView no longer renders ${name} — update pricingCrawlable to match it`);
  }
});

test('the Worker serves the full injection before the head-only route meta', () => {
  // The ROUTE_META branch rewrites <head> and RETURNS. If it ever runs first
  // again, /pricing is back to the homepage's body with a pricing title.
  const worker = readFileSync(resolve(BOARDS, 'src/worker.js'), 'utf8');
  const full = worker.indexOf("normalizePath(url.pathname) === '/pricing'");
  const headOnly = worker.indexOf('const meta = ROUTE_META[normalizePath(url.pathname)];');
  assert.ok(full > 0 && headOnly > 0, 'could not find the two /pricing branches');
  assert.ok(full < headOnly, 'the /pricing injection must run before the head-only ROUTE_META block');
});
