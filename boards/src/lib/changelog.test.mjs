// changelog.test.mjs — the gate that keeps /changelog worth having.
//
//   node --test src/lib/changelog.test.mjs
//
// A changelog is not a search play. The /docs corpus already proved what
// happens to a page nobody queries: sixty-four of them, ranking at positions
// 1.1 to 1.6, and zero clicks in twenty-eight days. This page exists for two
// readers instead — an assistant asked whether a feature exists yet, and a
// person deciding whether this product is maintained — and BOTH of them are
// better served by nothing at all than by a changelog that has rotted. "Last
// updated four months ago" is not a neutral fact about a page; it is a claim
// about the product, and an answer engine will repeat it.
//
// So the assertions here are aimed at the specific ways this page turns from an
// asset into a liability:
//
//   1. It stops being updated.        -> STALENESS (the load-bearing one).
//   2. A date is wrong or duplicated. -> the dates ARE the content.
//   3. The server-rendered copy and the hydrated copy drift apart.
//   4. The feed is malformed, so every reader that subscribed sees nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CHANGELOG_ENTRIES, CHANGELOG_LATEST, CHANGELOG_META, isChangelogPath } from './changelogIndex.js';
import { CHANGELOG_CONTENT } from './changelogContent.js';
import { CHANGELOG_HTML } from './changelogCrawlable.js';
import { blocksToText } from '../../scripts/lib/markdown.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BOARDS = resolve(HERE, '../..');
const read = (p) => readFileSync(resolve(BOARDS, p), 'utf8');

// How long the page may go without a new entry before this test fails.
//
// Set against the cadence that actually exists here — 78 distinct shipping days
// out of the last 90 — this is a very loose leash, and hitting it means either
// the product genuinely went quiet or somebody stopped writing entries. Both are
// things a reader of this page deserves to know, and both are things we would
// rather learn from a red test than from an assistant telling a prospect the
// project looks abandoned.
//
// IF THIS GOES RED: write the entry. Do not raise the number. Raising it is
// choosing to keep publishing a claim ("actively maintained") that the page can
// no longer support.
const MAX_ENTRY_AGE_DAYS = 45;

const DAY_MS = 24 * 60 * 60 * 1000;
const asDate = (iso) => new Date(iso + 'T00:00:00Z');

// ── The dates are the content ───────────────────────────────────────────────

test('entries: valid, unique, descending dates and no entry from the future', () => {
  assert.ok(CHANGELOG_ENTRIES.length > 0, 'no changelog entries');

  const dates = CHANGELOG_ENTRIES.map((e) => e.date);
  assert.equal(new Set(dates).size, dates.length, 'duplicate changelog date');

  // Newest first. The page, the feed and CHANGELOG_LATEST all assume it, and a
  // feed served out of order shows subscribers the wrong "most recent".
  const sorted = [...dates].sort().reverse();
  assert.deepEqual(dates, sorted, 'entries are not in newest-first order');
  assert.equal(CHANGELOG_LATEST, dates[0], 'CHANGELOG_LATEST is not the newest entry');

  // Tomorrow, in UTC. Dating an entry ahead would make the sitemap lastmod and
  // the RSS pubDate assert something that has not happened.
  const cutoff = Date.now() + DAY_MS;
  for (const e of CHANGELOG_ENTRIES) {
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/, `${e.date}: bad date shape`);
    assert.equal(asDate(e.date).toISOString().slice(0, 10), e.date, `${e.date}: not a real calendar date`);
    assert.ok(asDate(e.date).getTime() < cutoff, `${e.date}: dated in the future`);
    assert.equal(e.anchor, e.date, `${e.date}: anchor must equal the date`);
    assert.ok(e.title?.trim(), `${e.date}: no title`);
    assert.ok(e.summary?.trim(), `${e.date}: no summary`);
    assert.ok(CHANGELOG_CONTENT[e.date]?.length, `${e.date}: no content blocks`);
  }
});

test('STALENESS: the newest entry is recent enough for the page to be worth serving', () => {
  const ageDays = (Date.now() - asDate(CHANGELOG_LATEST).getTime()) / DAY_MS;
  assert.ok(
    ageDays <= MAX_ENTRY_AGE_DAYS,
    `the newest changelog entry (${CHANGELOG_LATEST}) is ${Math.floor(ageDays)} days old, over the `
    + `${MAX_ENTRY_AGE_DAYS}-day limit.\n`
    + '  Write an entry in boards/content/changelog/<YYYY-MM-DD>.md and run `npm run docs:build`.\n'
    + '  Do NOT raise MAX_ENTRY_AGE_DAYS — a stale changelog is worse than no changelog, '
    + 'and this test is the only thing that notices.',
  );
});

// ── Server-rendered and hydrated copies must agree ──────────────────────────
// Same property docsite.test.mjs asserts for /docs, and the reason the registry
// design exists at all: the Worker injects pre-rendered HTML and React renders
// the AST, and a crawler seeing different words from a reader is cloaking.

test('parity: every entry reaches the crawlable HTML the Worker injects', () => {
  assert.ok(CHANGELOG_HTML.length > 0, 'no crawlable html');
  assert.ok(CHANGELOG_HTML.includes(CHANGELOG_META.h1), 'h1 missing from crawlable html');
  assert.ok(CHANGELOG_HTML.includes(CHANGELOG_META.answer), 'answer missing from crawlable html');

  for (const e of CHANGELOG_ENTRIES) {
    assert.ok(CHANGELOG_HTML.includes(`id="${e.anchor}"`), `${e.date}: anchor missing from crawlable html`);
    assert.ok(CHANGELOG_HTML.includes(e.title), `${e.date}: title missing from crawlable html`);
    assert.ok(CHANGELOG_HTML.includes(e.summary), `${e.date}: summary missing from crawlable html`);
    for (const h of e.headings) {
      assert.ok(CHANGELOG_HTML.includes(`id="${h.id}"`), `${e.date}: heading anchor ${h.id} missing from crawlable html`);
    }
  }
});

test('parity: heading ids are unique across the whole page, not just per entry', () => {
  // Every entry renders onto ONE page and parseMarkdown only dedupes within its
  // own call, so two entries with a "Canvas" section would both claim #canvas
  // and the second deep link would land on the wrong week. gen-docs prefixes
  // body heading ids with the entry date; this is what proves it still does.
  const ids = [
    ...CHANGELOG_ENTRIES.map((e) => e.anchor),
    ...CHANGELOG_ENTRIES.flatMap((e) => e.headings.map((h) => h.id)),
  ];
  assert.equal(new Set(ids).size, ids.length, `duplicate heading id on /changelog: ${
    ids.filter((id, i) => ids.indexOf(id) !== i).join(', ')}`);

  for (const e of CHANGELOG_ENTRIES) {
    for (const h of e.headings) {
      assert.ok(h.id.startsWith(`${e.date}-`), `${e.date}: heading id ${h.id} is not scoped to its entry`);
    }
  }
});

test('parity: no unrendered markup leaks into the rendered output', () => {
  // A `code span` or **bold** that survived as literal punctuation means the
  // parser did not recognize a construct the author used, and the page shows
  // backticks to a reader. Mirrors the same check on the docs corpus.
  for (const e of CHANGELOG_ENTRIES) {
    const text = blocksToText(CHANGELOG_CONTENT[e.date] || []);
    assert.ok(!text.includes('`'), `${e.date}: unrendered code span in the AST text`);
    assert.ok(!/\*\*/.test(text), `${e.date}: unrendered bold in the AST text`);
  }
});

test('routing: isChangelogPath matches the page and its sub-paths, never the raw twins', () => {
  for (const p of ['/changelog', '/changelog/', '/Changelog', '/changelog/2026-08-26']) {
    assert.ok(isChangelogPath(p), `${p}: should be a changelog path`);
  }
  // These are real files in dist/ that env.ASSETS answers. Matching them here
  // would route them into the SPA-shell injector and serve HTML for a .md URL.
  for (const p of ['/changelog.md', '/changelog.xml', '/docs', '/changelogged']) {
    assert.ok(!isChangelogPath(p), `${p}: should NOT be a changelog path`);
  }
});

// ── The machine-readable twins ──────────────────────────────────────────────

test('feed: changelog.xml is well-formed and leads with the newest entry', () => {
  const xml = read('public/changelog.xml');

  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'missing XML declaration');
  assert.ok(xml.includes('<rss version="2.0"'), 'not an RSS 2.0 document');
  assert.equal((xml.match(/<item>/g) || []).length, CHANGELOG_ENTRIES.length, 'item count != entry count');
  assert.equal((xml.match(/<item>/g) || []).length, (xml.match(/<\/item>/g) || []).length, 'unbalanced <item> tags');

  // An unterminated CDATA section swallows the rest of the feed, which fails
  // silently in most readers — they render nothing rather than complaining.
  assert.equal((xml.match(/<!\[CDATA\[/g) || []).length, (xml.match(/]]>/g) || []).length,
    'unbalanced CDATA sections');

  const pubDates = [...xml.matchAll(/<pubDate>([^<]+)<\/pubDate>/g)].map((m) => m[1]);
  assert.equal(pubDates.length, CHANGELOG_ENTRIES.length, 'every item needs a pubDate');
  assert.equal(pubDates[0], asDate(CHANGELOG_LATEST).toUTCString(), 'first pubDate is not the newest entry');
  const times = pubDates.map((d) => new Date(d).getTime());
  assert.deepEqual(times, [...times].sort((a, b) => b - a), 'feed items are not newest-first');
  assert.ok(times.every(Number.isFinite), 'a pubDate is not a parseable RFC-822 date');

  // A root-relative href in a feed item resolves against the SUBSCRIBER's
  // origin, not ours, and 404s there. gen-docs absolutizes them in bare mode.
  assert.ok(!/<content:encoded>[\s\S]*?href="\//.test(xml), 'feed content has a root-relative link');
});

test('mirror: changelog.md carries every entry, and llms.txt points at it', () => {
  const md = read('public/changelog.md');
  for (const e of CHANGELOG_ENTRIES) {
    assert.ok(md.includes(`## ${e.date} — ${e.title}`), `${e.date}: missing from public/changelog.md`);
  }

  // The whole recency argument for this page depends on an agent being able to
  // FIND it. llms.txt is the index those agents read first.
  const llms = read('public/llms.txt');
  assert.ok(llms.includes('/changelog'), 'llms.txt does not link the changelog');
  assert.ok(llms.includes(CHANGELOG_LATEST),
    'llms.txt does not state the newest entry date — an agent cannot tell how fresh this is');
  assert.ok(read('public/llms-full.txt').includes('/changelog'), 'llms-full.txt omits the changelog');
});

// ── Structured data ─────────────────────────────────────────────────────────

test('json-ld: a valid graph with one dated TechArticle per entry', async () => {
  // worker.js imports cleanly under plain node — it touches no Workers global at
  // module scope — so the real builder is exercised here rather than a copy of
  // it. injectChangelog itself cannot be: it needs HTMLRewriter.
  const { buildChangelogJsonLd } = await import('../worker.js');
  const url = 'https://clusters.soleilpictures.com/changelog';

  // Round-trip through JSON: a value the serializer chokes on (undefined from a
  // renamed field, a cycle) is exactly the silent failure this guards.
  const graph = JSON.parse(JSON.stringify(buildChangelogJsonLd(url)));
  assert.equal(graph['@context'], 'https://schema.org');

  const page = graph['@graph'].find((n) => n['@type'] === 'CollectionPage');
  assert.ok(page, 'no CollectionPage node');
  assert.equal(page.url, url);
  assert.equal(page.dateModified, CHANGELOG_LATEST);

  const list = page.mainEntity;
  assert.equal(list['@type'], 'ItemList');
  assert.equal(list.numberOfItems, CHANGELOG_ENTRIES.length);
  assert.equal(list.itemListElement.length, CHANGELOG_ENTRIES.length);

  list.itemListElement.forEach((li, i) => {
    const e = CHANGELOG_ENTRIES[i];
    assert.equal(li.position, i + 1, `${e.date}: wrong ListItem position`);
    assert.equal(li.item['@type'], 'TechArticle');
    assert.equal(li.item.headline, e.title, `${e.date}: headline`);
    // The per-entry dates are the whole reason this is an ItemList rather than
    // one article for the page — a machine must be able to read each one.
    assert.equal(li.item.datePublished, e.date, `${e.date}: datePublished`);
    assert.equal(li.item.url, `${url}#${e.date}`, `${e.date}: item url`);
  });

  const crumbs = graph['@graph'].find((n) => n['@type'] === 'BreadcrumbList');
  assert.ok(crumbs, 'no BreadcrumbList node');
  assert.deepEqual(crumbs.itemListElement.map((c) => c.name), ['Home', 'Changelog']);

  // </script> anywhere in a value would close the tag the graph is embedded in.
  assert.ok(!/<\/script/i.test(JSON.stringify(graph)), 'json-ld would break out of its script tag');
});

// ── House rules ─────────────────────────────────────────────────────────────

test('the repo is public, and so is this page: no business metrics in an entry', () => {
  // CLAUDE.md: no business metrics, revenue figures or user counts in committed
  // files. A changelog written from commit messages is the single likeliest
  // place for one to slip through, because the commits themselves are allowed
  // to reason about numbers this page is not allowed to publish.
  const BANNED = [
    /\b(?:MRR|ARR|churn)\b/i,
    /\b\d[\d,]*\s+(?:paying|active|signed[- ]up|registered)\s+(?:users?|customers?|accounts?)/i,
    /\b(?:revenue|conversion rate)\s+(?:of|was|is)\b/i,
    /\bwe (?:have|had|hit) \d[\d,]*\s+(?:users?|customers?|signups?|subscribers?)/i,
  ];
  for (const e of CHANGELOG_ENTRIES) {
    const text = [e.title, e.summary, blocksToText(CHANGELOG_CONTENT[e.date] || [])].join('\n');
    for (const re of BANNED) {
      assert.ok(!re.test(text), `${e.date}: reads like a business metric (${re}) — the repo and this page are public`);
    }
  }
});
