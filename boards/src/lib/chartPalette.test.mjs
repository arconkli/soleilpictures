// chartPalette.test.mjs — the dashboard's data colours, checked rather than
// trusted.
//
// This exists because the palette it replaced was wrong for a long time and
// nothing said so. `['#ffa500','#50c878','#7da0dc','#9aa0aa']` put two series
// 8.1 apart for full-colour readers, made green and blue identical under
// tritanopia, and sat at 1.7-2.3:1 against the light-theme panel — i.e. the
// charts were invisible in light mode. All of that is measurable, and none of
// it is visible to someone eyeballing a dark screen.
//
// So: measure it on every `npm test`. Editing pages/admin/viz/palette.js
// without re-clearing the floors fails the build and names the offending pair.
//
// The maths is self-contained on purpose (no dependency, no network): sRGB ->
// linear -> OKLab for perceptual distance, the Viénot-Brettel-Mollon LMS
// projection for dichromat simulation, and WCAG relative luminance for
// contrast.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  SURFACES, CATEGORICAL, OTHER, SEQUENTIAL, STATUS, DIRECTIONAL, WELL,
} from '../pages/admin/viz/palette.js';

// Floors. Normal vision is the strict one: below 15 a full-colour reader
// cannot separate the pair, and no amount of secondary encoding excuses that.
// 8 is the dichromat floor.
const FLOOR_NORMAL = 15;
const FLOOR_CVD = 8;
const FLOOR_CONTRAST = 3;

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function hexToLinear(hex) {
  const h = hex.replace('#', '');
  assert.equal(h.length, 6, `not a 6-digit hex: ${hex}`);
  return [0, 2, 4].map((i) => toLinear(parseInt(h.slice(i, i + 2), 16) / 255));
}

function oklab([r, g, b]) {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  ];
}

// Viénot, Brettel & Mollon (1999): project onto the dichromat's surface in LMS.
function simulate(rgbLinear, kind) {
  if (kind === 'normal') return rgbLinear;
  const [r, g, b] = rgbLinear;
  let L = 17.8824 * r + 43.5161 * g + 4.11935 * b;
  let M = 3.45565 * r + 27.1554 * g + 3.86714 * b;
  let S = 0.0299566 * r + 0.184309 * g + 1.46709 * b;
  if (kind === 'protanopia') L = 2.02344 * M - 2.52581 * S;
  if (kind === 'deuteranopia') M = 0.494207 * L + 1.24827 * S;
  if (kind === 'tritanopia') S = -0.395913 * L + 0.801109 * M;
  return [
    0.080944 * L - 0.130504 * M + 0.116721 * S,
    -0.0102485 * L + 0.0540194 * M - 0.113615 * S,
    -0.000365294 * L - 0.00412163 * M + 0.693513 * S,
  ].map((v) => Math.max(0, Math.min(1, v)));
}

/** Perceptual distance, OKLab x100 — the same scale the floors are quoted in. */
function deltaE(hexA, hexB, kind) {
  const a = oklab(simulate(hexToLinear(hexA), kind));
  const b = oklab(simulate(hexToLinear(hexB), kind));
  return 100 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function contrast(hexA, hexB) {
  const lum = (hex) => {
    const [r, g, b] = hexToLinear(hex);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [lum(hexA), lum(hexB)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// `well` is not a theme — it is the plot ground, identical in both themes, and
// it carries the DARK steps. Running it as a third mode means the same six
// checks apply to the surface most marks actually land on.
const MODES = ['dark', 'light', 'well'];
const STEPS_FOR = (mode) => (mode === 'well' ? 'dark' : mode);
const VISION = ['normal', 'deuteranopia', 'protanopia', 'tritanopia'];

/** Every pair in `hexes` must clear the floor for every vision type. */
function assertSeparable(hexes, label) {
  for (const kind of VISION) {
    const floor = kind === 'normal' ? FLOOR_NORMAL : FLOOR_CVD;
    for (let i = 0; i < hexes.length; i++) {
      for (let j = i + 1; j < hexes.length; j++) {
        const d = deltaE(hexes[i], hexes[j], kind);
        assert.ok(
          d >= floor,
          `${label}: ${hexes[i]} and ${hexes[j]} are ${d.toFixed(1)} apart under `
          + `${kind}, floor ${floor}. Re-step one of them — do not ship it with a `
          + `note, and do not lower the floor.`,
        );
      }
    }
  }
}

for (const mode of MODES) {
  const surface = SURFACES[mode];
  const steps = STEPS_FOR(mode);
  const cats = CATEGORICAL[steps];

  test(`${mode}: categorical hues are separable to every reader`, () => {
    assertSeparable(cats, `${mode} categorical`);
  });

  test(`${mode}: categorical hues are legible on the panel surface`, () => {
    for (const hex of cats) {
      const c = contrast(hex, surface);
      assert.ok(
        c >= FLOOR_CONTRAST,
        `${mode}: ${hex} is ${c.toFixed(2)}:1 against ${surface}, floor `
        + `${FLOOR_CONTRAST}. This is the check the previous palette failed on `
        + `every single hue in light mode.`,
      );
    }
  });

  // The remainder bucket sits alongside the real series, so it has to survive
  // the same scrutiny. This is the check that rules out the obvious light grey.
  test(`${mode}: the "other" bucket separates from the series`, () => {
    assertSeparable([...cats, OTHER[steps]], `${mode} categorical + other`);
    const c = contrast(OTHER[steps], surface);
    assert.ok(c >= FLOOR_CONTRAST, `${mode}: other ${OTHER[steps]} is ${c.toFixed(2)}:1 on ${surface}`);
  });

  test(`${mode}: the sequential ramp rises monotonically and reads on surface`, () => {
    const ramp = SEQUENTIAL[steps];
    const ls = ramp.map((h) => oklab(hexToLinear(h))[0]);
    const rising = ls.every((v, i) => i === 0 || v > ls[i - 1]);
    const falling = ls.every((v, i) => i === 0 || v < ls[i - 1]);
    assert.ok(
      rising || falling,
      `${mode}: sequential ramp lightness is not monotonic (${ls.map((v) => v.toFixed(2)).join(' ')}). `
      + 'A ramp that reverses encodes magnitude ambiguously.',
    );
    // A sequential ramp is allowed to approach the surface at the end that
    // means "least" — that is what makes it read as a ramp. What must be
    // legible is the end carrying the most, which is the end furthest from the
    // surface: the dark end on a light panel, the light end on a dark one.
    const ends = [ramp[0], ramp[ramp.length - 1]];
    const loud = ends[0] === ends[1] ? ends[0]
      : (contrast(ends[0], surface) >= contrast(ends[1], surface) ? ends[0] : ends[1]);
    const c = contrast(loud, surface);
    assert.ok(
      c >= FLOOR_CONTRAST,
      `${mode}: neither end of the sequential ramp clears ${FLOOR_CONTRAST}:1 on `
      + `${surface} (best is ${loud} at ${c.toFixed(2)}:1)`,
    );
  });

  test(`${mode}: status colours are legible, and stay out of the series`, () => {
    const { good, bad } = STATUS[steps];
    for (const [name, hex] of [['good', good], ['bad', bad], ['directional', DIRECTIONAL[steps]]]) {
      const c = contrast(hex, surface);
      assert.ok(c >= FLOOR_CONTRAST, `${mode}: status ${name} ${hex} is ${c.toFixed(2)}:1 on ${surface}`);
    }
    // A status colour must not BE a series colour. The floor here is
    // deliberately lower than the 8 used inside the categorical set, and the
    // reason is worth writing down rather than discovering again:
    //
    // Requiring 8 between every series and both status hues deletes the whole
    // red and green neighbourhoods from the categorical search. What survives
    // is teal/blue/violet, and the best such set clears its own checks by only
    // ~1.1 — versus 4.4+ for the set we ship. Trading real separation between
    // series, which encode the same dimension and sit side by side, for
    // separation between families that never encode the same thing is a bad
    // trade.
    //
    // What actually protects the reader is above: status never appears without
    // a glyph or a word. So the rule here is only "not the same colour".
    const FLOOR_STATUS_VS_SERIES = 5;
    for (const cat of cats) {
      for (const [name, hex] of [['good', good], ['bad', bad]]) {
        const d = deltaE(cat, hex, 'normal');
        assert.ok(
          d >= FLOOR_STATUS_VS_SERIES,
          `${mode}: status ${name} ${hex} is only ${d.toFixed(1)} from series ${cat} — `
          + 'close enough to read as that series rather than as a state.',
        );
      }
    }
  });
}

// Not a floor to clear — a fact to keep visible. If someone ever "fixes" the
// arrows out of the delta badge because the colours look sufficient, this test
// is the record that they are not.
test('good and bad are NOT separable by colour alone — the glyph is required', () => {
  for (const mode of ['dark', 'light']) {
    const { good, bad } = STATUS[mode];
    const d = deltaE(good, bad, 'deuteranopia');
    assert.ok(
      d < FLOOR_CVD,
      `${mode}: good/bad now measure ${d.toFixed(1)} apart under deuteranopia. That is `
      + 'surprising for a red/green pair — recheck the maths before relaxing any '
      + 'icon-plus-label requirement in the UI.',
    );
  }
});

// The well only works because `.adm-well` in admin.css re-declares the dark
// steps as local custom properties — that is what lets every viz component keep
// drawing through VAR.* while landing on a surface that ignores the theme.
//
// Nothing in JavaScript can observe that block, so a well-meaning edit to
// admin.css could silently leave light-theme marks on a near-black ground at
// 1.7:1 — the exact failure this whole file exists to prevent, reintroduced by
// the fix for it. So read the stylesheet and check.
test('.adm-well re-declares the dark steps, and admin.css agrees with palette.js', () => {
  const cssPath = fileURLToPath(new URL('../pages/admin/admin.css', import.meta.url));
  const css = readFileSync(cssPath, 'utf8');

  const block = css.match(/\.adm-well\s*\{([^}]*)\}/);
  assert.ok(block, 'admin.css has no .adm-well rule — the plot ground is undefined.');
  const body = block[1];

  const declared = (name) => {
    const m = body.match(new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{6})`));
    return m ? m[1].toLowerCase() : null;
  };

  const expected = {
    'adm-cat-1': CATEGORICAL.dark[0],
    'adm-cat-2': CATEGORICAL.dark[1],
    'adm-cat-3': CATEGORICAL.dark[2],
    'adm-cat-other': OTHER.dark,
    'adm-good': STATUS.dark.good,
    'adm-bad': STATUS.dark.bad,
    'adm-directional': DIRECTIONAL.dark,
    ...Object.fromEntries(SEQUENTIAL.dark.map((hex, i) => [`adm-seq-${i + 1}`, hex])),
  };

  for (const [name, hex] of Object.entries(expected)) {
    assert.equal(
      declared(name), hex.toLowerCase(),
      `.adm-well declares --${name} as ${declared(name)}, but palette.js says ${hex}. `
      + 'The well carries the DARK steps in both themes; if these drift, light-theme '
      + 'charts go back to being invisible.',
    );
  }

  // And the ground itself, which is what all of the above was measured against.
  const plot = css.match(/--adm-plot\s*:\s*(#[0-9a-fA-F]{6})/);
  assert.ok(plot, 'admin.css never defines --adm-plot.');
  assert.equal(
    plot[1].toLowerCase(), SURFACES.well.toLowerCase(),
    `--adm-plot is ${plot[1]} but the palette was validated against ${SURFACES.well}.`,
  );
  assert.equal(WELL.surface, SURFACES.well);
});

// Gold is the app's focus/selection accent. If it turns up in the data palette
// again the dashboard goes back to reading orange, so say so here too.
test('gold never appears as a data colour', () => {
  const gold = ['#ffa500', '#ffa500ff', '#FFA500'];
  const all = [
    ...CATEGORICAL.dark, ...CATEGORICAL.light,
    ...SEQUENTIAL.dark, ...SEQUENTIAL.light,
    OTHER.dark, OTHER.light,
    STATUS.dark.good, STATUS.dark.bad, STATUS.light.good, STATUS.light.bad,
  ];
  for (const hex of all) {
    assert.ok(
      !gold.includes(hex.toLowerCase()),
      `${hex} is the reserved --soleil accent. Data colours come from the `
      + 'categorical set; gold means active/selection/focus.',
    );
  }
});
