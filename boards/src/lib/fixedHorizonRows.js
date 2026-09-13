// fixedHorizonRows.js — group admin_return_fixed_horizon rows for the panel.
//
// The RPC (0322) returns one flat list keyed by a "kind:label" dim so it stays a
// single query. The panel wants one table per kind, with the bands in depth
// order and the weeks in date order, each row carrying its Wilson interval so a
// cell resting on eight people cannot be read like one resting on eighty.
//
// Pure and dependency-light (only retentionStats), node-testable, in the same
// spirit as retentionStats.js / depthDock.js.
import { wilson } from './retentionStats.js';

export const BAND_ORDER = Object.freeze(['0', '1-2', '3-5', '6-12', '13+']);
const GROUP_ORDER = Object.freeze(['device', 'source', 'band', 'week']);

export function groupFixedHorizon(rows) {
  const out = { all: null, groups: [] };
  if (!Array.isArray(rows)) return out;
  const byKind = new Map();
  for (const r of rows) {
    if (!r || typeof r.dim !== 'string') continue;
    const n = Number(r.n) || 0;
    const returned = Number(r.returned) || 0;
    if (r.dim === 'all') { out.all = { n, returned, ci: wilson(returned, n) }; continue; }
    const i = r.dim.indexOf(':');
    if (i < 1) continue;
    const kind = r.dim.slice(0, i);
    const label = r.dim.slice(i + 1);
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind).push({ label, n, returned, ci: wilson(returned, n) });
  }
  for (const kind of GROUP_ORDER) {
    const list = byKind.get(kind);
    if (!list) continue;
    list.sort((a, b) => {
      if (kind === 'band') return BAND_ORDER.indexOf(a.label) - BAND_ORDER.indexOf(b.label);
      if (kind === 'week') return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
      return b.n - a.n;
    });
    out.groups.push({ key: kind, rows: list });
  }
  return out;
}
