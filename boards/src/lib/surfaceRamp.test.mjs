// The --bg-* ramp encodes ELEVATION, not lightness — and it reverses between
// themes. That is the correct design (a raised surface catches light in a dark
// room and casts shade in a lit one), and it is a trap every time someone
// reaches for a token to mean "darker".
//
// It cost two wrong attempts on the upgrade modal's "your plan today" row in
// one sitting. The row should read as quieter than the offer beneath it:
//   --bg-1 made it IDENTICAL to the Creator card in dark;
//   --bg-0 made it the LIGHTEST surface on the modal in light — raised, the
//   exact opposite of a recess.
//
// So: a surface that must read as recessed in BOTH themes cannot say so with a
// single --bg-* fill. It needs either a per-theme rule or, better, no fill at
// all — a rule and muted type carry "quieter" in any palette for free.
//
// These tests pin the two halves of that:
//   1. the ramps really do invert, so the reasoning above stays true of the
//      palette rather than of one remembered reading of it. If someone
//      re-tunes the colours so both ramps run the same direction, this fails
//      and the advice can be simplified rather than silently rotting.
//   2. the row that was got wrong twice still declares no --bg-* fill.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

// Pull a variable block by its selector, stopping at the first closing brace
// at column 0 — the file's own formatting, and the same anchor publicSurface
// uses to slice a literal.
function tokenBlock(selector) {
  const at = CSS.indexOf(selector);
  assert.ok(at >= 0, `${selector} not found in styles.css`);
  const open = CSS.indexOf('{', at);
  const close = CSS.indexOf('\n}', open);
  assert.ok(close > open, `${selector} block is not closed at column 0`);
  return CSS.slice(open, close);
}

function ramp(block) {
  const out = {};
  for (const m of block.matchAll(/--bg-(\d):\s*(#[0-9a-fA-F]{6})/g)) {
    out[Number(m[1])] = m[2];
  }
  return out;
}

// Perceived lightness is not needed here — these are near-neutral greys, so
// the raw sum of channels orders them correctly and needs no colour science.
const lum = (hex) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);

test('the --bg ramp inverts between themes, which is why a fill cannot mean "recessed"', () => {
  const dark = ramp(tokenBlock(':root'));
  const light = ramp(tokenBlock("[data-theme='light']"));

  for (const k of [0, 1, 2]) {
    assert.ok(dark[k], `dark --bg-${k} missing`);
    assert.ok(light[k], `light --bg-${k} missing`);
  }

  // Dark: the ramp climbs. bg-2 is the raised surface, bg-0 the page.
  assert.ok(lum(dark[2]) > lum(dark[0]),
    'in dark, --bg-2 must be lighter than --bg-0 — the ramp is elevation');

  // Light: it does NOT climb. bg-2 is darker than the page, and bg-1 —
  // "one step up" — is the lightest of the three. Both halves matter: the
  // first is why --bg-0 reads as raised here, the second is why --bg-1 reads
  // as the same surface as a --bg-2 panel's contents.
  assert.ok(lum(light[2]) < lum(light[0]),
    'in light, --bg-2 must be DARKER than --bg-0 — if this ever stops being ' +
    'true the ramp no longer inverts and surfaceRamp.test.mjs can be simplified');
  assert.ok(lum(light[1]) > lum(light[0]),
    'in light, --bg-1 is the lightest of the low ramp');
});

test('the modal\'s "your plan today" row states no --bg fill', () => {
  // It is the row the inversion bit, twice. A rule and muted type say
  // "quieter" in any palette; a token says it in exactly one.
  const at = CSS.indexOf('\n.upgrade-now {');
  assert.ok(at >= 0, '.upgrade-now not found — renamed? then move this guard');
  const decls = CSS.slice(at, CSS.indexOf('\n}', at));
  assert.doesNotMatch(decls, /background[^;]*--bg-/,
    'a --bg-* fill here means "recessed" in one theme and "raised" in the other');
  assert.match(decls, /border-bottom:/,
    'the rule is what separates it from the offer now that the box is gone');
});

// ── One dialog material ────────────────────────────────────────────────────
//
// Twelve floating surfaces in this stylesheet are painted with the same recipe
// — translucent near-black, a 12px saturating blur, and a white hairline at
// 6%. .modal and .picker are two of them, which between them are most of the
// dialogs anyone in this app ever sees.
//
// .upgrade-modal was the exception: a flat --bg-2, which in the dark palette
// is the LIGHTEST step of the ramp. It read as a grey slab floating over a
// blurred app while every neighbouring dialog read as glass over it. The
// stylesheet had already noticed — .waitlist-modal-card reuses .upgrade-modal
// and overrode exactly that fill back to glass, commenting that it should read
// "as glass, not a flat card". The variant was fixed and the base was not.
//
// This pins the base to the house recipe. It is deliberately a comparison
// against .modal rather than a hardcoded colour: if the house material is ever
// retuned, the right outcome is that this moves with it, not that it fails.

function ruleBlock(selector) {
  const at = CSS.indexOf(`\n${selector} {`);
  assert.ok(at >= 0, `${selector} not found in styles.css`);
  return CSS.slice(at, CSS.indexOf('\n}', at));
}

// Whitespace-insensitive on purpose. The first run of this test failed on
// `rgba(16, 16, 20, .78)` vs `rgba(16,16,20,.78)` — the same colour, typed
// differently. A guard that fails on a space is one people learn to delete,
// and this repo already has that scar.
const decl = (block, prop) => {
  const m = block.match(new RegExp(`(?:^|\\n)\\s*${prop}:\\s*([^;]+);`));
  return m ? m[1].replace(/\s+/g, '') : null;
};

test('the upgrade modal is made of the same glass as every other dialog', () => {
  const house = ruleBlock('.modal');
  const offer = ruleBlock('.upgrade-modal');

  for (const prop of ['background-color', 'backdrop-filter', '-webkit-backdrop-filter']) {
    const want = decl(house, prop);
    assert.ok(want, `.modal declares no ${prop} — has the house material moved?`);
    assert.equal(decl(offer, prop), want,
      `.upgrade-modal's ${prop} must match .modal's, or the offer is a different material`);
  }

  // The border is declared shorthand on both, so compare the whole thing.
  assert.equal(decl(offer, 'border'), decl(house, 'border'),
    'the hairline is part of the material');

  // The specific regression: a flat token fill instead of glass.
  assert.doesNotMatch(offer, /background(-color)?:\s*var\(--bg-/,
    '.upgrade-modal must not go back to a flat --bg-* fill');
});

test('every glass dialog has a light-theme twin', () => {
  // Glass without one is a dark slab on a light app. .upgrade-modal shipped
  // without a pair for its whole life — a solid --bg-2 is a light grey in that
  // palette, so it never looked broken enough for anyone to notice.
  for (const sel of ['.modal', '.upgrade-modal']) {
    assert.ok(CSS.includes(`[data-theme='light'] ${sel} {`),
      `${sel} has no [data-theme='light'] pair`);
  }
});
