// seoPriceLiterals.test.mjs — our own price is never typed in a search page.
//
//   node --test src/lib/seoPriceLiterals.test.mjs
//
// A search-page string that says "$25/mo" keeps saying it after the price
// changes, while the strings built from PRICING move. This reads seoLanding.js
// and seoListicles.js as text and fails, naming file and line, when one of our
// price forms is typed instead of built from PRICING (billingCopy.js, which
// names the code that enforces the price).
//
// Two specs are exempt because they are held as they are: /vs/pureref and
// /best/pureref-alternatives (a spec runs from its `path:` line to the next).
// A competitor's price that happens to equal ours is allowed on a line that
// ends with `// competitor price`; a competitor price that differs from ours is
// not matched at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PRICING } from './billingCopy.js';

const EXEMPT_PATHS = ['/vs/pureref', '/best/pureref-alternatives'];
const FILES = ['seoLanding.js', 'seoListicles.js'];

// Every typed form of our price, derived from the PRICING values.
function ourForms() {
  const forms = new Set();
  for (const p of Object.values(PRICING)) {
    forms.add(p.billedLabel);
    for (const unit of ['/mo', '/month', ' a month', ' per month', '/yr', '/year', ' a year', ' per year']) {
      forms.add(`${p.perMonthLabel}${unit}`);
    }
    if (p.savings) forms.add(p.savings);
  }
  return [...forms];
}

// A form counts only when it is a whole figure: not inside a longer number
// ("$125/mo", "$25.50/mo") and not the start of one.
function findLiteral(line, form) {
  let i = line.indexOf(form);
  while (i !== -1) {
    const before = line[i - 1] || '';
    const after = line[i + form.length] || '';
    const decimalAfter = /[.,]/.test(after) && /[0-9]/.test(line[i + form.length + 1] || '');
    if (!/[0-9.,]/.test(before) && !/[0-9]/.test(after) && !decimalAfter) return i;
    i = line.indexOf(form, i + 1);
  }
  return -1;
}

function literalsIn(text, forms) {
  let exempt = false;
  const hits = [];
  text.split('\n').forEach((line, n) => {
    const m = line.match(/^\s*"?path"?:\s*['"]([^'"]+)['"]/);
    if (m) exempt = EXEMPT_PATHS.includes(m[1]);
    if (exempt || /\/\/ competitor price\s*$/.test(line)) return;
    for (const f of forms) {
      if (findLiteral(line, f) !== -1) { hits.push({ line: n + 1, form: f }); break; }
    }
  });
  return hits;
}

test('our price is built from PRICING, never typed, outside the two exempt specs', () => {
  const forms = ourForms();
  const hits = [];
  for (const f of FILES) {
    const text = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
    for (const h of literalsIn(text, forms)) hits.push(`${f}:${h.line} types ${h.form}`);
  }
  assert.deepEqual(hits, [], `build these from PRICING (billingCopy.js):\n  ${hits.join('\n  ')}`);
});

test('the scan catches a planted literal and honours the escapes', () => {
  const forms = ourForms();
  const label = PRICING.monthly.billedLabel;
  const plant = `    path: '/tools/x',\n  a: 'Creator is ${label} flat',`;
  assert.equal(literalsIn(plant, forms).length, 1);
  assert.equal(literalsIn(`${plant} // competitor price`, forms).length, 0);
  assert.equal(literalsIn(`    path: '/vs/pureref',\n  a: '${label}',`, forms).length, 0);
  assert.equal(literalsIn(`    path: '/tools/x',\n  a: '1${label}',`, forms).length, 0);
});
