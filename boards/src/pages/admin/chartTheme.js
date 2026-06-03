// chartTheme.js — one shared Recharts theme for the admin dashboard.
//
// Before this, every chart re-declared the same tooltip `contentStyle` and
// axis props inline (AdminAnalyticsTab, AdminKpiStrip, AdminEventBreakdown,
// AdminCardsSection), so small drifts crept in and animations were toggled
// per-chart. Import CHART here so axes, grid, tooltip, colors, and the
// "never animate" rule stay identical everywhere.
//
// Colors resolve from CSS custom properties, so the dashboard's dark/light
// themes keep working without per-chart overrides. The categorical `series`
// palette is ordered; for tier-specific colors pull from TIER_COLORS in
// adminFormat.js rather than hard-coding.

export const CHART = {
  // Shared axis props — spread onto <XAxis {...CHART.axis} /> / <YAxis ... />.
  axis: { stroke: 'var(--ink-3)', fontSize: 10, tickLine: false, axisLine: false },

  // Dashed cartesian grid — spread onto <CartesianGrid {...CHART.grid} />.
  grid: { stroke: 'var(--line-1)', strokeDasharray: '2 4', vertical: false },

  // Tooltip props — spread onto <Tooltip {...CHART.tooltip} />.
  tooltip: {
    contentStyle: {
      background: 'var(--bg-2)',
      border: '1px solid var(--line-2)',
      borderRadius: 8,
      fontSize: 12,
      color: 'var(--ink-1)',
    },
    cursor: { fill: 'rgba(255,255,255,0.04)' },
    isAnimationActive: false,
  },

  // Never animate — charts re-render on every filter change; animation only
  // adds jank. Spread onto any <Bar>/<Line>/<Funnel> as {...CHART.noAnim}.
  noAnim: { isAnimationActive: false },

  // Brand + tier accents, mirrored from TIER_COLORS for chart-local use.
  soleil: '#ffa500',
  green:  '#50c878',

  // Ordered categorical palette for multi-series charts.
  series: ['#ffa500', '#50c878', '#7da0dc', '#9aa0aa'],
};
