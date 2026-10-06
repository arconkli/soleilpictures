// fixedHorizonRows.js — group fixed-horizon rows for the panel: admin_return_fixed_horizon
// (0322), and admin_built_return / admin_second_sitting (0361), which share its shape.
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
export const GROUP_ORDER = Object.freeze(['device', 'source', 'band', 'week']);

// 'link:' rows (admin_second_sitting, 0361) re-measure the 7-day return inside
// a coarse depth band, split by whether visit 1 held a second sitting:
// '3-12 · one sitting', '3-12 · two+ sittings'. Shallow bands first, and within
// a band the one-sitting row first so each pair reads as a before/after.
const LINK_BANDS = ['0-2', '3-12', '13+'];
function linkRank(label) {
  const sep = label.indexOf(' · ');
  const band = sep < 0 ? label : label.slice(0, sep);
  const bi = LINK_BANDS.indexOf(band);
  return (bi < 0 ? LINK_BANDS.length : bi) * 2 + (/two\+/.test(label) ? 1 : 0);
}

// 'mode:' and 'mode_band:' rows (admin_return_by_mode, 0365) split the same
// return by how the day-one material arrived: hand (card by card), burst (a
// folder drop, a multi-file pick, an import), none. Hand first, because it is
// the one that comes back; inside a band the same order, so each band reads
// hand → burst.
export const MODE_ORDER = Object.freeze(['hand', 'burst', 'none']);
function modeRank(label) {
  const i = MODE_ORDER.indexOf(label);
  return i < 0 ? MODE_ORDER.length : i;
}
function modeBandRank(label) {
  const sep = label.indexOf(' · ');
  const band = sep < 0 ? label : label.slice(0, sep);
  const mode = sep < 0 ? '' : label.slice(sep + 3);
  const bi = LINK_BANDS.indexOf(band);
  return (bi < 0 ? LINK_BANDS.length : bi) * (MODE_ORDER.length + 1) + modeRank(mode);
}

// `order` picks which kinds render and in what order; kinds not named are
// dropped, which is how a panel built on one RPC hides the others' groups.
export function groupFixedHorizon(rows, order = GROUP_ORDER) {
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
  for (const kind of Array.isArray(order) ? order : GROUP_ORDER) {
    const list = byKind.get(kind);
    if (!list) continue;
    list.sort((a, b) => {
      if (kind === 'band') return BAND_ORDER.indexOf(a.label) - BAND_ORDER.indexOf(b.label);
      if (kind === 'week') return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
      if (kind === 'link') return linkRank(a.label) - linkRank(b.label);
      if (kind === 'mode') return modeRank(a.label) - modeRank(b.label);
      if (kind === 'mode_band') return modeBandRank(a.label) - modeBandRank(b.label);
      return b.n - a.n;
    });
    out.groups.push({ key: kind, rows: list });
  }
  return out;
}
