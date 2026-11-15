import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LEGAL_UPDATED } from './legalDates.js';
import { PRICING_PAGE_UPDATED } from './pricingCrawlable.js';
import { LEGAL_DOCS, LAST_UPDATED } from '../auth/legalContent.js';

// The sitemap's lastmod for /legal/* is each document's own "Last updated"
// date, and for /pricing PRICING_PAGE_UPDATED. The Worker builds the sitemap
// from them (worker.js sitemapUrls), so these tests pin the dates to their
// sources and the Worker to the dates.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
function iso(text) {
  const m = /^([A-Za-z]+) (\d{1,2}), (\d{4})$/.exec(text);
  assert.ok(m, `not a "Month D, YYYY" date: ${text}`);
  const mo = MONTHS.indexOf(m[1]);
  assert.ok(mo >= 0, `unknown month in ${text}`);
  return `${m[3]}-${String(mo + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

test('legalDates.js holds the date each legal page shows', () => {
  assert.deepEqual(Object.keys(LEGAL_UPDATED).sort(), Object.keys(LEGAL_DOCS).sort());
  for (const slug of Object.keys(LEGAL_DOCS)) {
    const shown = iso(LEGAL_DOCS[slug].updated || LAST_UPDATED);
    assert.equal(LEGAL_UPDATED[slug], shown,
      `/legal/${slug} shows ${shown}; set LEGAL_UPDATED.${slug} in lib/legalDates.js to match`);
  }
});

test('the sitemap gives /pricing and every /legal page its date', () => {
  const worker = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  assert.match(PRICING_PAGE_UPDATED, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(worker, /\/pricing`, lastmod: PRICING_PAGE_UPDATED,/, '/pricing carries PRICING_PAGE_UPDATED');
  for (const slug of Object.keys(LEGAL_DOCS)) {
    assert.ok(worker.includes(`/legal/${slug}\`, lastmod: LEGAL_UPDATED.${slug},`),
      `the sitemap entry for /legal/${slug} must carry LEGAL_UPDATED.${slug}`);
  }
});
