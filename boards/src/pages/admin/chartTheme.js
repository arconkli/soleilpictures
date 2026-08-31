// chartTheme.js — shared Recharts theme, for the charts not yet ported to the
// SVG primitives in viz/.
//
// This file is on its way out: viz/ replaces every Recharts chart on the
// dashboard, and Recharts goes with the last one. Until then it must not be the
// thing that keeps the old look alive, so the colours now come from viz's
// validated palette rather than from brand literals.
//
// What changed and why:
//
//   * `soleil: '#ffa500'` is gone. Gold is the reserved active/selection/focus
//     accent (CLAUDE.md) and it was simultaneously the default series colour,
//     which is the single largest reason the dashboard read orange.
//
//   * `series` was ['#ffa500','#50c878','#7da0dc','#9aa0aa'] and failed four of
//     the six colour checks: series 3 and 4 were 8.1 apart for full-colour
//     readers against a floor of 15, green and blue were 3.6 apart under
//     tritanopia, and every hue sat at 1.7-2.3:1 on the light-theme panel — the
//     charts were invisible in light mode. lib/chartPalette.test.mjs now holds
//     the replacement to all six.
//
//   * `tooltip.cursor` was a hardcoded rgba(255,255,255,.04): a white wash that
//     rendered as nothing at all in light theme.
//
// Colours resolve through CSS custom properties, so light/dark keeps working
// with no per-chart overrides. For tier-specific colours use TIER_COLORS in
// adminFormat.js.

export const CHART = {
  // Shared axis props — spread onto <XAxis {...CHART.axis} /> / <YAxis ... />.
  axis: { stroke: 'var(--adm-axis)', fontSize: 10, tickLine: false, axisLine: false },

  // Dashed cartesian grid — spread onto <CartesianGrid {...CHART.grid} />.
  grid: { stroke: 'var(--adm-grid)', strokeDasharray: '2 4', vertical: false },

  // Tooltip props — spread onto <Tooltip {...CHART.tooltip} />.
  tooltip: {
    contentStyle: {
      background: 'var(--bg-3)',
      border: '1px solid var(--adm-line-strong)',
      borderRadius: 8,
      fontSize: 12,
      color: 'var(--ink-1)',
    },
    cursor: { fill: 'var(--adm-grid)' },
    isAnimationActive: false,
  },

  // Never animate — charts re-render on every filter change; animation only
  // adds jank. Spread onto any <Bar>/<Line> as {...CHART.noAnim}.
  noAnim: { isAnimationActive: false },

  // The default mark. Most of these charts show magnitude, not identity, and
  // magnitude wants neutral ink — reach for `series` only when the marks are
  // genuinely different entities.
  ink: 'var(--adm-mark-neutral)',

  // The workhorse hue: a single-series chart that wants colour uses this.
  primary: 'var(--adm-cat-1)',

  good: 'var(--adm-good)',
  bad: 'var(--adm-bad)',

  // Categorical, fixed order, NEVER cycled. Past the third entry callers must
  // bucket into `other` rather than inventing a fourth hue.
  series: ['var(--adm-cat-1)', 'var(--adm-cat-2)', 'var(--adm-cat-3)'],
  other: 'var(--adm-cat-other)',

  // ── Command Center only ────────────────────────────────────────────────
  // The big-screen wall display is deliberately gold-on-black and sits outside
  // the dashboard restyle, so it keeps the brand literals. Do NOT reach for
  // these from a dashboard view — that is precisely the habit that made every
  // chart orange. Use `ink` for magnitude, `primary` for a single series,
  // `series` for identity.
  soleil: '#ffa500',
  green: '#50c878',
};
