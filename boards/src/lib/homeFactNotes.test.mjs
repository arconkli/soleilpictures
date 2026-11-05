// The homepage's three fact notecards (lib/homeFactNotes.js) fly in on the
// scroll animation and sit in index.html's plain-text fallback, which is what
// crawlers and AI answers read. Same approach as usedBy.test.mjs: pin the
// static HTML to the one source so a price or cap change fails here first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOME_FACT_NOTES } from './homeFactNotes.js';
import { freeLimitSentence, PRICING, CREATOR_STORAGE_LABEL } from './billingCopy.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');

test('three notes, each with a head that fits one line', () => {
  assert.equal(HOME_FACT_NOTES.length, 3);
  for (const n of HOME_FACT_NOTES) {
    assert.ok(n.head && n.title && n.text);
    assert.ok(n.head.length <= 24, n.head);
    assert.equal(n.head, n.title.toUpperCase());
  }
});

test('the free-plan note matches billingCopy', () => {
  const free = HOME_FACT_NOTES.find((n) => n.title === 'Free to start');
  assert.equal(
    free.text,
    `Free up to ${freeLimitSentence()}. Creator is ${PRICING.monthly.billedLabel} for unlimited cards and a ${CREATOR_STORAGE_LABEL} drive.`
  );
});

test('homeFactNotes.js does not import billingCopy', () => {
  const src = readFileSync(resolve(root, 'src/lib/homeFactNotes.js'), 'utf8');
  assert.doesNotMatch(
    src,
    /^\s*import\b[^;]*billingCopy/m,
    'homeFactNotes.js is in the sign-in entry chunk; importing billingCopy.js added 7.4 KB brotli to entryJs. Keep the literal and let this test prove it matches.'
  );
});

test('index.html carries every note in the fallback list, word for word', () => {
  const main = html.slice(html.indexOf('<main id="seo-fallback"'), html.indexOf('</main>'));
  for (const n of HOME_FACT_NOTES) {
    assert.ok(
      main.includes(`<li style="margin:0 0 .7em;"><b>${n.title}</b> — ${n.text[0].toLowerCase() + n.text.slice(1)}</li>`),
      `index.html's seo-fallback is missing or has stale words for "${n.title}"`
    );
  }
});
