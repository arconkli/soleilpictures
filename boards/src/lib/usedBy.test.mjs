// "Used by" parity: one list, the same names in every renderer, on the same
// pages. React reads USED_BY directly; these pin the Worker, the listicle
// builder, the static homepage fallback and the .md mirrors to it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { USED_BY, showsUsedBy, usedByText, usedByHtml } from './usedBy.js';
import { SEO_LANDING_PAGES } from './seoLanding.js';
import { SEO_LISTICLE_PAGES } from './seoListicles.js';
import { buildListicleCrawlableHtml } from './seoListicleHtml.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('the list is real names, no repeats, Soleil Pictures first', () => {
  assert.ok(USED_BY.length >= 2);
  for (const n of USED_BY) assert.match(n, /^\S.*\S$/);
  assert.equal(new Set(USED_BY).size, USED_BY.length);
  assert.equal(USED_BY[0], 'Soleil Pictures');
});

test('the HTML is escaped and carries every name', () => {
  const html = usedByHtml();
  for (const n of USED_BY) assert.ok(html.includes(n), n);
  assert.ok(!/<(?!\/?p\b)/.test(html), 'only the one <p>');
  assert.ok(html.includes(usedByText()));
});

test('storefronts and /scout never show it; ordinary landings do', () => {
  assert.equal(showsUsedBy(null), false);
  assert.equal(showsUsedBy({ path: '/scout' }), false);
  assert.equal(showsUsedBy({ path: '/templates', storefront: true }), false);
  const shown = SEO_LANDING_PAGES.filter(showsUsedBy);
  assert.ok(shown.some((s) => s.path === '/vs/pureref'));
});

test('every listicle renders the line in its crawlable HTML', () => {
  for (const spec of SEO_LISTICLE_PAGES) {
    assert.ok(buildListicleCrawlableHtml(spec).includes(usedByHtml()), spec.path);
  }
});

test('the Worker landing builder uses the shared line, gated the same way', () => {
  const src = readFileSync(resolve(root, 'src/worker.js'), 'utf8');
  assert.match(src, /if \(showsUsedBy\(spec\)\) parts\.push\(usedByHtml\(\)\);/);
});

test('the static homepage fallback carries the same text', () => {
  const html = readFileSync(resolve(root, 'index.html'), 'utf8');
  assert.ok(html.includes(usedByText()), 'index.html seo-fallback is out of step with lib/usedBy.js');
});

test('the .md mirrors carry it on shown pages only', () => {
  const md = (p) => resolve(root, 'public', `${p.replace(/^\//, '')}.md`);
  const vs = md('/vs/pureref');
  if (existsSync(vs)) assert.ok(readFileSync(vs, 'utf8').includes(usedByText()));
  const scout = md('/scout');
  if (existsSync(scout)) assert.ok(!readFileSync(scout, 'utf8').includes(usedByText()));
});
