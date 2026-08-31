// palette.js — the dashboard's data colours, and the rules they obey.
//
// These are computed, not chosen. The set that shipped before this file
// (['#ffa500','#50c878','#7da0dc','#9aa0aa']) failed four of the six checks
// against the surfaces it actually rendered on:
//
//   normal vision   #7da0dc / #9aa0aa   dE  8.1  (floor 15)  <- series 3 and 4
//                                                               were the same
//                                                               colour to
//                                                               full-colour
//                                                               readers
//   protanopia      #7da0dc / #9aa0aa   dE  7.7  (floor  8)
//   tritanopia      #50c878 / #7da0dc   dE  3.6  (floor  8)
//   light contrast  every hue           1.69-2.27:1 (floor 3) <- the palette
//                                                               was invisible
//                                                               in light theme
//
// lib/chartPalette.test.mjs re-runs all six checks on every `npm test`, so a
// future edit here fails the build instead of failing quietly on screen.
//
// Three things worth knowing before changing anything:
//
//   * THREE hues, not four or five. Gold is unavailable (it is reserved for
//     active/selection/focus, and using it for data is what made the dashboard
//     read orange), and excluding its neighbourhood widely enough to keep the
//     page calm leaves 4-hue sets scraping past with a margin near 1.0 while
//     3-hue sets clear by 4.4-5.2. Three that hold is worth more than four that
//     barely do. A fourth category folds into `other`.
//
//   * Light and dark are SEPARATE steps of the same hue families, not a flip.
//     No single set clears 3:1 against both #16161a and #ededf0.
//
//   * Most charts here should use none of this. Bar rows, funnel steps,
//     distributions and single-series trends encode magnitude, not identity —
//     they render in neutral ink. Spend colour on identity and on status.

/** Panel surfaces these were validated against — `--bg-2` dark, `--bg-3` light. */
export const SURFACES = { dark: '#16161a', light: '#ededf0' };

/**
 * Categorical hues in FIXED ORDER. Never cycled: a 4th series is `other`, or
 * the chart becomes small multiples. Blue leads because it is the workhorse —
 * the default for a chart with one series, and the sequential ramp's hue.
 */
export const CATEGORICAL = {
  dark:  ['#6e9eef', '#83dc97', '#df7a9b'],
  light: ['#184da3', '#27984d', '#8f204f'],
};

/**
 * The "Other"/remainder bucket.
 *
 * Deliberately DARK in dark mode. The intuitive choice is a light grey — which
 * is exactly what the old `#9aa0aa` was — and it collapses against the rose
 * under protanopia at dE 2.3 against a floor of 8. Only near-zero chroma
 * around OKLab L 0.56 clears all four vision checks alongside the three hues.
 */
export const OTHER = { dark: '#737477', light: '#6a6a70' };

/** Sequential ramp (the categorical blue's hue), light -> dark. Magnitude only. */
export const SEQUENTIAL = {
  dark:  ['#1d4a93', '#3967b3', '#5685d4', '#73a5f6', '#a6c6f9'],
  light: ['#bad2fb', '#87b2f8', '#5c8cda', '#3967b3', '#18448c'],
};

/**
 * Status. Never reused as a series colour, and NEVER carried by colour alone:
 * good and bad are dE 1.6 apart under deuteranopia in dark and 1.0 in light,
 * which is simply what red-green colour blindness is — no re-stepping fixes
 * it. Every use ships a glyph or a word alongside. The arrows in the KPI delta
 * badge are load-bearing.
 */
export const STATUS = {
  dark:  { good: '#62c37a', bad: '#f8818d' },
  light: { good: '#1c763a', bad: '#a73447' },
};

/**
 * The small-N "directional" flag. An amber, but NOT a status colour — it says
 * "this rate is real but the denominator is thin", which is a statement about
 * confidence rather than about health. Kept distinct so a directional rate is
 * never mistaken for a warning.
 */
export const DIRECTIONAL = { dark: '#da9e3f', light: '#815b1f' };

/**
 * CSS custom properties, so a bar drawn in CSS and a mark drawn in SVG pull
 * from one definition. Mirrors the `--adm-*` block at the top of admin.css;
 * prefer these names over literals anywhere either could be used.
 */
export const VAR = {
  cat:   ['var(--adm-cat-1)', 'var(--adm-cat-2)', 'var(--adm-cat-3)'],
  other: 'var(--adm-cat-other)',
  seq:   ['var(--adm-seq-1)', 'var(--adm-seq-2)', 'var(--adm-seq-3)', 'var(--adm-seq-4)', 'var(--adm-seq-5)'],
  good:  'var(--adm-good)',
  bad:   'var(--adm-bad)',
  directional: 'var(--adm-directional)',
  // Neutral marks — the default for magnitude. Reach for these first.
  ink:      'var(--adm-mark-neutral)',
  inkSoft:  'var(--adm-mark-neutral-soft)',
  axis:     'var(--adm-axis)',
  grid:     'var(--adm-grid)',
  surface:  'var(--adm-surface)',
};

/**
 * Device identity, one place.
 *
 * This map was declared independently in DeviceBreakdown and FirstCardFriction
 * — the second one carrying the comment "re-declared per convention" — with
 * mobile painted #ffa500, i.e. the reserved accent used as a category colour.
 * Device IS identity, so it earns categorical hues; it just has to be the same
 * hues in both places.
 */
export const DEVICE_COLOR = {
  desktop: VAR.cat[0],
  mobile:  VAR.cat[1],
  tablet:  VAR.cat[2],
  unknown: VAR.other,
};

/**
 * Colour for series `i` of `n`, as a CSS var.
 *
 * Past the third series this returns the neutral `other` rather than inventing
 * a fourth hue — the caller is expected to have bucketed already, and a
 * silently-cycled palette is worse than a visibly collapsed one.
 */
export function seriesColor(i) {
  return VAR.cat[i] ?? VAR.other;
}

/** Sequential step for a 0..1 magnitude. */
export function rampColor(t) {
  const n = VAR.seq.length;
  const i = Math.min(n - 1, Math.max(0, Math.round((Number(t) || 0) * (n - 1))));
  return VAR.seq[i];
}
