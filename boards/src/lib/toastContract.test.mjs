// toastContract — a toast type is a contract with three signatories, and one
// of them had never signed.
//
//   1. the CALLERS, which pass `type: '<kind>'` to feedback.toast(...)
//   2. TOAST_ICON in components/FeedbackOverlay.jsx, which picks the glyph
//   3. styles.css, which colours the glyph and draws the accent rail
//
// `warning` was signatory 1 only. TOAST_ICON carried success|error|info, the
// stylesheet carried the same three, and the lookup falls back to Info — so a
// warning toast rendered as an ordinary informational one, with no colour and
// no rail. Both cap toasts use it: the one that says you are running out of
// room, and the one that says cards did not fit. The two moments in the
// product where a toast most needs to look different from a status update were
// the two that looked exactly like one.
//
// Nothing could catch it. The fallback is silent by construction, so the bug
// has no error, no console warning and no failing assertion — it is only
// visible to someone looking at the screen who already knows what they expect.
// That is what a contract test is for.
//
// THE EXTRACTORS HARD-FAIL ON ZERO MATCHES, per feedbackContract.test.mjs: an
// extractor that silently matches nothing agrees with everything.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('..', import.meta.url).pathname;
const read = (rel) => readFileSync(join(SRC, rel), 'utf8');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p, out); continue; }
    if (/\.(jsx?|mjs)$/.test(name) && !/\.test\.mjs$/.test(name)) out.push(p);
  }
  return out;
}

// 1. Every toast type any caller actually passes.
function emittedTypes() {
  const found = new Set();
  for (const file of walk(SRC)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/type:\s*'([a-z]+)'/g)) {
      // `type:` is a common key — narrow to the toast/dialog call shape by
      // requiring the literal to be one of the four the provider defines.
      if (['success', 'error', 'warning', 'info'].includes(m[1])) found.add(m[1]);
    }
  }
  assert.ok(found.size > 0, 'found no toast type literals at all — the extractor is broken');
  return found;
}

// 2. The keys TOAST_ICON actually maps.
function iconKeys() {
  const src = read('components/FeedbackOverlay.jsx');
  const m = src.match(/const TOAST_ICON = \{([^}]*)\}/);
  assert.ok(m, 'TOAST_ICON not found in FeedbackOverlay.jsx — the extractor is broken');
  const keys = new Set([...m[1].matchAll(/(\w+)\s*:/g)].map((k) => k[1]));
  assert.ok(keys.size > 0, 'TOAST_ICON parsed to zero keys — the extractor is broken');
  return keys;
}

// 3. The `.toast-<kind>` rules the stylesheet defines. Comments are stripped
//    first: three source guards in this repo have already tripped on their own
//    documentation, and the header above names every class.
function styledKinds() {
  const css = read('styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const kinds = new Set([...css.matchAll(/\.toast-(success|error|warning|info)\b/g)].map((m) => m[1]));
  assert.ok(kinds.size > 0, 'no .toast-<kind> rules found — the extractor is broken');
  return kinds;
}

test('every toast type a caller can send has an icon', () => {
  const emitted = [...emittedTypes()].sort();
  const icons = iconKeys();
  const missing = emitted.filter((t) => !icons.has(t));
  assert.deepEqual(
    missing, [],
    `TOAST_ICON has no entry for ${missing.join(', ')}. The lookup falls back to `
    + 'Info, so the toast renders as ordinary information and nothing reports it.',
  );
});

test('every toast type a caller can send is styled', () => {
  const emitted = [...emittedTypes()].sort();
  const styled = styledKinds();
  const missing = emitted.filter((t) => !styled.has(t));
  assert.deepEqual(
    missing, [],
    `styles.css has no .toast-${missing.join('/.toast-')} rule. The class is on the `
    + 'element either way, so the toast silently inherits the default look.',
  );
});

test('warning is one of them, and carries its own colour', () => {
  // Named explicitly rather than left to the sweep: `warning` is the type the
  // cap toasts use, it is the one that was missing, and a future refactor that
  // drops the last `type: 'warning'` caller should not be allowed to quietly
  // retire the guard along with it.
  assert.ok(emittedTypes().has('warning'), 'no caller emits a warning toast any more — delete this file if that is deliberate');
  assert.ok(iconKeys().has('warning'), 'TOAST_ICON lost its warning entry');

  const css = read('styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\.toast-warning \.toast-icon \{ color: var\(--msg-warn\); \}/,
    'the warning icon must take its colour from --msg-warn');
  // Defined in BOTH theme blocks. A token defined only under one of them is
  // how a colour ends up borrowing the wrong theme's ground.
  const defs = [...css.matchAll(/--msg-warn:\s*[^;]+;/g)];
  assert.ok(defs.length >= 2, `--msg-warn is defined ${defs.length} time(s); it needs a dark default and a light override`);
  // Gold is reserved for active / selection / focus states. A toast is none.
  assert.doesNotMatch(css, /\.toast-warning[^{]*\{[^}]*var\(--soleil/,
    'warning toasts must not use the gold accent — it is reserved for selection and focus');
});
