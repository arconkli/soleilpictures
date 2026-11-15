// Does a search page's `updated` date move with its words?
//
// Each spec in lib/seoLanding.js and lib/seoListicles.js carries an `updated`
// date that feeds the sitemap's lastmod and the JSON-LD dateModified. Honest
// dates only (the policy at the top of seoListicles.js): the date moves when
// the words a reader sees move, and not otherwise. This script hashes those
// words per page into src/lib/seoFreshness.json, and
// src/lib/seoFreshness.test.mjs fails whenever a page's words or date differ
// from the snapshot, so every change is re-snapshotted with a logged reason.
//
//   npm run seo:fresh                          what moved since the snapshot
//   npm run seo:fresh:accept -- --reason "x"   re-snapshot, logging why
//
// The words: title, metaDescription, h1, subhead, answer, sections, steps,
// compare rows, list entries, FAQ, the hero button's words, everything a
// reader reads. Not hashed: `updated` / `published` themselves, related and
// navigation links (related, docsLinks, siblingListicle, exampleSlugs, any
// href or anchor), and code-only fields (flags, starter, storefront).

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SNAPSHOT_URL = new URL('../src/lib/seoFreshness.json', import.meta.url);

// planBlock is a flag here, and the "What it costs" section it switches on is
// left out on purpose: it is the same shared block (planBlock.js) on every
// page that carries it, like a footer, so a price or free-plan change does not
// re-date every comparison page. Those words belong to /pricing, whose hash
// below is taken from its rendered body and moves with them.
const SKIP_TOP = new Set([
  'path', 'kind', 'updated', 'published',
  'related', 'docsLinks', 'siblingListicle', 'exampleSlugs',
  'planBlock', 'stepsFirst', 'storefront', 'starter',
]);
const SKIP_DEEP = new Set(['href', 'anchor']);

// Keys sorted, link fields dropped: the same words always give the same text.
function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) if (!SKIP_DEEP.has(k)) o[k] = stable(v[k]);
    return o;
  }
  return v;
}

export function wordsHash(spec) {
  const words = {};
  for (const k of Object.keys(spec)) if (!SKIP_TOP.has(k)) words[k] = spec[k];
  return createHash('sha256').update(JSON.stringify(stable(words))).digest('hex').slice(0, 20);
}

// { path: { hash, updated } } for every page the sitemap dates from its words.
export async function currentPages() {
  const { SEO_LANDING_PAGES } = await import('../src/lib/seoLanding.js');
  const { SEO_LISTICLE_PAGES } = await import('../src/lib/seoListicles.js');
  const pages = {};
  for (const s of [...SEO_LANDING_PAGES, ...SEO_LISTICLE_PAGES]) {
    pages[s.path] = { hash: wordsHash(s), updated: s.updated };
  }
  // /pricing renders from billingCopy and the team copy, not from a spec: its
  // words are the crawlable body and the meta description.
  const { PRICING_PATH, PRICING_PAGE_UPDATED, buildPricingCrawlableHtml } = await import('../src/lib/pricingCrawlable.js');
  const { PRICING_META_DESCRIPTION } = await import('../src/lib/billingCopy.js');
  pages[PRICING_PATH] = {
    hash: wordsHash({ metaDescription: PRICING_META_DESCRIPTION, body: buildPricingCrawlableHtml() }),
    updated: PRICING_PAGE_UPDATED,
  };
  return pages;
}

export function readSnapshot() {
  if (!existsSync(SNAPSHOT_URL)) return { pages: {}, log: [] };
  return JSON.parse(readFileSync(SNAPSHOT_URL, 'utf8'));
}

// What differs between the snapshot and the specs now.
export function diffPages(snap, cur) {
  const out = [];
  for (const p of Object.keys(cur)) {
    const s = snap[p];
    if (!s) out.push({ path: p, kind: 'new', cur: cur[p] });
    else if (s.hash !== cur[p].hash) out.push({ path: p, kind: 'words', snap: s, cur: cur[p] });
    else if (s.updated !== cur[p].updated) out.push({ path: p, kind: 'date', snap: s, cur: cur[p] });
  }
  for (const p of Object.keys(snap)) if (!cur[p]) out.push({ path: p, kind: 'gone', snap: snap[p] });
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

async function main() {
  const args = process.argv.slice(2);
  const snap = readSnapshot();
  const cur = await currentPages();
  const moved = diffPages(snap.pages, cur);

  if (!args.includes('--accept')) {
    if (!moved.length) { console.log('seo-freshness: nothing moved.'); return; }
    for (const m of moved) {
      const note = m.kind === 'words'
        ? (m.snap.updated === m.cur.updated ? `words changed, updated still ${m.cur.updated}` : `words changed, updated ${m.snap.updated} -> ${m.cur.updated}`)
        : m.kind === 'date' ? `date only ${m.snap.updated} -> ${m.cur.updated}`
        : m.kind === 'new' ? 'not in the snapshot' : 'in the snapshot, no spec';
      console.log(`${m.path}  ${note}`);
    }
    return;
  }

  const i = args.indexOf('--reason');
  const reason = i >= 0 ? (args[i + 1] || '').trim() : '';
  if (!reason) {
    console.error('seo-freshness: refusing to re-snapshot without --reason "<text>" (npm run seo:fresh:accept -- --reason "typo in /tools/x").');
    process.exit(1);
  }
  const first = !Object.keys(snap.pages).length;
  const paths = first ? Object.keys(cur) : moved.map((m) => m.path);
  if (!paths.length) { console.log('seo-freshness: nothing moved, nothing to accept.'); return; }
  const pages = {};
  for (const p of Object.keys(cur).sort()) pages[p] = cur[p];
  const log = [...snap.log, { date: new Date().toISOString().slice(0, 10), paths: [...paths].sort(), reason }];
  writeFileSync(SNAPSHOT_URL, JSON.stringify({ pages, log }, null, 2) + '\n');
  console.log(`seo-freshness: snapshot updated for ${paths.length} path(s): ${reason}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
