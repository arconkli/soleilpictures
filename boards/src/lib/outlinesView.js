// outlinesView — what Admin › Outlines shows, as pure functions.
//
// The tab (pages/admin/AdminOutlinesTab.jsx) only draws what this file works
// out: the tiles, the "Tools, by when" heat table, the filter and sort pills and
// the RPC arguments they turn into, and the wireframe of one stored outline as a
// list of rects. The RPCs (admin_layout_weeks, admin_layout_stats,
// admin_cluster_outlines) and the stored outline shape are the contract in the
// layout-outlines spec; nothing here reads a card's contents, because the stored
// row has none.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const NA = '—';

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || `${one}s`)}`;
const f2 = (n) => Math.round(n * 100) / 100;

// ── Numbers ──────────────────────────────────────────────────────────────

// 1284 -> "1,284". Anything that is not a number is an em dash, never "NaN".
export function fmtCount(n) {
  return isNum(n) ? Math.round(n).toLocaleString('en-US') : NA;
}

// A share (0-1) as a whole percent: 0.384 -> "38%".
export function fmtShare(share) {
  return isNum(share) ? `${Math.round(Math.min(1, Math.max(0, share)) * 100)}%` : NA;
}

// The median is a number of cards: a whole one reads "14", a half reads "14.5".
export function fmtMedian(n) {
  if (!isNum(n)) return NA;
  const r = Math.round(n * 10) / 10;
  return r.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

// ── Weeks ────────────────────────────────────────────────────────────────

// '2027-02-22' -> '22 Feb 2027'. null for anything that is not a plain date.
export function weekDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return null;
  const mo = Number(m[2]) - 1;
  if (mo < 0 || mo > 11) return null;
  return `${Number(m[3])} ${MONTHS[mo]} ${m[1]}`;
}

export const weekLabel = (iso) => {
  const d = weekDay(iso);
  return d ? `Week of ${d}` : NA;
};

// The weeks the RPC returned (newest first), cleaned. Anything without a date
// is dropped, so a bad row cannot become the selected week.
export function weeksView(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((w) => w && weekDay(w.week))
    .map((w) => ({ week: String(w.week).slice(0, 10), outlines: Number(w.outlines) || 0, stats: !!w.stats }));
}

// The week a stepper lands on. `dir` -1 is the previous (older) week, +1 the
// next (newer). Newest first, so older is the higher index.
export function stepWeek(weeks, current, dir) {
  const i = weeks.findIndex((w) => w.week === current);
  if (i < 0) return weeks.length ? weeks[0].week : null;
  const to = i - dir;
  return to < 0 || to >= weeks.length ? current : weeks[to].week;
}

export function weekStepState(weeks, current) {
  const i = weeks.findIndex((w) => w.week === current);
  return { canPrev: i >= 0 && i < weeks.length - 1, canNext: i > 0 };
}

// ── Tiles ────────────────────────────────────────────────────────────────

// The five tiles of "All clusters this week". `stats` is the RPC's answer or
// null (no figures stored for the week); a tile the server left null shows "—".
export const TILE_DEFS = [
  { id: 'clusters_changed', label: 'Clusters that changed', sub: 'all clusters, not only outlined ones', fmt: fmtCount },
  { id: 'median_cards', label: 'Median cards', sub: 'per cluster', fmt: fmtMedian },
  { id: 'use_sections', label: 'Use sections', sub: 'of clusters', fmt: fmtShare },
  { id: 'nested', label: 'Hold a nested cluster', sub: 'of clusters', fmt: fmtShare },
  { id: 'mostly_pictures', label: 'Mostly pictures', sub: 'over half their cards are pictures', fmt: fmtShare },
];

export function tilesView(stats) {
  const tiles = stats && typeof stats === 'object' ? stats.tiles : null;
  return TILE_DEFS.map((d) => {
    const t = tiles ? tiles[d.id] : null;
    const has = t && isNum(t.value);
    return {
      id: d.id,
      label: d.label,
      value: has ? d.fmt(t.value) : NA,
      sub: d.sub,
      title: has ? undefined : 'Fewer than 20 people, so not kept',
    };
  });
}

// ── Heat table ───────────────────────────────────────────────────────────

export const BANDS = [
  { id: '5m', label: 'First 5 min' },
  { id: '1d', label: 'First day' },
  { id: '7d', label: 'First week' },
  { id: 'later', label: 'Later' },
];

export const TOOLS = [
  { id: 'move', label: 'Move cards' },
  { id: 'arrange', label: 'Arrange' },
  { id: 'align', label: 'Align & distribute' },
  { id: 'sections', label: 'Sections' },
  { id: 'arrows', label: 'Arrows' },
  { id: 'pen', label: 'Pen' },
  { id: 'grid', label: 'Grid boxes' },
  { id: 'duplicate', label: 'Duplicate' },
  { id: 'copy_paste', label: 'Copy & paste' },
  { id: 'undo', label: 'Undo' },
  { id: 'resize', label: 'Resize' },
  { id: 'rotate', label: 'Rotate' },
  { id: 'layer', label: 'Layer order' },
  { id: 'multi_select', label: 'Multi-select' },
];

// A cell is the white of the ink at 3% for nobody up to 23% for everybody: a
// straight line in the share, so a reader can compare two cells by eye.
export const HEAT_MIN = 3;
export const HEAT_SPAN = 20;
export const HEAT_RAMP = [0, 0.25, 0.5, 0.75, 1].map((s) => heatAlpha(s));

export function heatAlpha(share) {
  const s = isNum(share) ? Math.min(1, Math.max(0, share)) : 0;
  return Math.round((HEAT_MIN + HEAT_SPAN * s) * 10) / 10;
}

// Rows in the spec's order, one cell per band. A missing cell (the server hides
// any group under 20 people) is `na`; a week with no stats at all is every
// cell `na`, with its own title.
export function heatTable(stats) {
  const have = !!(stats && Array.isArray(stats.tools));
  const byKey = new Map();
  if (have) {
    for (const c of stats.tools) {
      if (c && isNum(c.share)) byKey.set(`${c.tool}|${c.band}`, c);
    }
  }
  return TOOLS.map((t) => ({
    id: t.id,
    label: t.label,
    cells: BANDS.map((b) => {
      const c = byKey.get(`${t.id}|${b.id}`);
      if (!c) {
        return {
          band: b.id, bandLabel: b.label, text: NA, alpha: null, na: true,
          title: have ? 'Fewer than 20 people' : 'No figures stored for this week',
        };
      }
      return { band: b.id, bandLabel: b.label, text: fmtShare(c.share), alpha: heatAlpha(c.share), na: false, title: undefined };
    }),
  }));
}

// ── Filters and sort ─────────────────────────────────────────────────────

// Each filter group: its label and its pills. A pill's `v` is the RPC value
// itself; `all` / `any` (v: null) is the unfiltered one.
export const FILTER_GROUPS = [
  {
    id: 'cards', label: 'Cards',
    pills: [
      { v: null, label: 'All' }, { v: '3-9', label: '3–9' }, { v: '10-29', label: '10–29' },
      { v: '30-99', label: '30–99' }, { v: '100+', label: '100+' },
    ],
  },
  {
    id: 'sections', label: 'Sections',
    pills: [{ v: null, label: 'Any' }, { v: 'with', label: 'With' }, { v: 'without', label: 'Without' }],
  },
  {
    id: 'level', label: 'Level',
    pills: [
      { v: null, label: 'Any' }, { v: 'top', label: 'Top level' },
      { v: '2', label: 'Level 2' }, { v: '3+', label: 'Level 3+' },
    ],
  },
  {
    id: 'age', label: 'Cluster age',
    pills: [
      { v: null, label: 'Any' }, { v: 'w1', label: 'First week' }, { v: 'w4', label: '1–4 weeks' },
      { v: 'm3', label: '1–3 months' }, { v: 'old', label: 'Over 3 months' },
    ],
  },
];

export const SORTS = [
  { v: 'newest', label: 'Newest' },
  { v: 'cards', label: 'Most cards' },
  { v: 'sections', label: 'Most sections' },
];

// The kinds an outline can hold, in the order the Has pills and the legend list
// them. `label` is the Has pill, `plural` the "what it holds" sentence.
export const KINDS = [
  { id: 'picture', label: 'picture', plural: 'pictures' },
  { id: 'note', label: 'note', plural: 'notes' },
  { id: 'link', label: 'link', plural: 'links' },
  { id: 'doc', label: 'doc', plural: 'docs' },
  { id: 'file', label: 'file', plural: 'files' },
  { id: 'video', label: 'video', plural: 'videos' },
  { id: 'audio', label: 'audio', plural: 'audio' },
  { id: 'palette', label: 'palette', plural: 'palettes' },
  { id: 'shape', label: 'shape', plural: 'shapes' },
  { id: 'grid', label: 'grid', plural: 'grids' },
  { id: 'cluster', label: 'nested cluster', plural: 'nested clusters' },
  { id: 'other', label: 'other card', plural: 'other cards', pill: false },
];

// The kinds that get a Has pill ('other' is a catch-all, not something to look for).
export const HAS_KINDS = KINDS.filter((k) => k.pill !== false);

export const NO_FILTERS = Object.freeze({ cards: null, sections: null, level: null, age: null, has: Object.freeze([]), sort: 'newest' });

export function hasActiveFilters(f) {
  return !!(f && (f.cards || f.sections || f.level || f.age || (f.has && f.has.length)));
}

// Turn or flip one filter. Returns a new state; `has` is a toggle on a kind.
export function setFilter(f, group, v) {
  if (group === 'has') {
    const on = f.has.includes(v);
    const has = on ? f.has.filter((k) => k !== v) : HAS_KINDS.map((k) => k.id).filter((k) => k === v || f.has.includes(k));
    return { ...f, has };
  }
  return { ...f, [group]: v };
}

export const PAGE_SIZE = 48;

// The filter state as the arguments of admin_cluster_outlines. A pill that is
// "All" / "Any" sends null, which the function reads as "no filter".
export function outlineParams(week, f, offset = 0, limit = PAGE_SIZE) {
  const s = f || NO_FILTERS;
  return {
    p_week: week,
    p_cards: s.cards || null,
    p_sections: s.sections || null,
    p_level: s.level || null,
    p_age: s.age || null,
    p_has: s.has && s.has.length ? [...s.has] : null,
    p_sort: s.sort || 'newest',
    p_limit: limit,
    p_offset: offset,
  };
}

// ── Words about one outline ──────────────────────────────────────────────

const AGE_TEXT = {
  w1: 'In its first week',
  w4: '1–4 weeks old',
  m3: '1–3 months old',
  old: 'Over 3 months old',
};
export const ageText = (a) => AGE_TEXT[a] || NA;

// depth counts ancestor clusters (the workspace root is 0), so a cluster made
// straight in a workspace is depth 1 and still "Top level", as the Level filter
// has it (top = depth up to 1).
export function levelName(depth) {
  const d = Number(depth) || 0;
  return d <= 1 ? 'Top level' : d === 2 ? 'Level 2' : 'Level 3+';
}

export const sectionsText = (n) => (n === 0 ? 'No sections' : plural(n, 'section'));

export function titleLine(o) {
  const s = o.stats || {};
  const sections = Array.isArray(o.sections) ? o.sections.length : 0;
  return `${plural(Number(s.cards) || 0, 'card')} · ${sectionsText(sections)} · ${levelName(s.depth)}`;
}

// The legend of the drawer: one entry per kind the outline holds, then sections.
export function legendView(o) {
  const kinds = (o.stats && o.stats.kinds) || {};
  const out = KINDS.filter((k) => kinds[k.id]).map((k) => ({ id: k.id, label: k.label, n: kinds[k.id] }));
  const sections = Array.isArray(o.sections) ? o.sections.length : 0;
  if (sections) out.push({ id: 'section', label: 'section', n: sections });
  return out;
}

export function holdsText(o) {
  const s = o.stats || {};
  const kinds = s.kinds || {};
  const sections = Array.isArray(o.sections) ? o.sections.length : 0;
  const held = KINDS.filter((k) => kinds[k.id]).map((k) => `${kinds[k.id]} ${kinds[k.id] === 1 ? k.label : k.plural}`);
  return [
    held.join(', '),
    sectionsText(sections),
    s.rotated ? `${plural(s.rotated, 'card')} rotated` : 'none rotated',
    levelName(s.depth),
    ageText(s.age),
    weekLabel(o.week),
  ].filter(Boolean).join(' · ');
}

// ── The wireframe ────────────────────────────────────────────────────────

// The squarest r x c grid with exactly `g` boxes, for a grid card of w x h.
export function gridDims(g, w, h) {
  const n = Math.max(1, Math.round(Number(g) || 1));
  let best = null;
  for (let r = 1; r <= n; r++) {
    if (n % r) continue;
    const c = n / r;
    const d = Math.abs(Math.log((w / c) / (h / r)));
    if (!best || d < best.d) best = { c, r, d };
  }
  return best;
}

// One stored outline as what an SVG needs: the viewBox, the section boxes (with
// the number tag), and the cards in layer order. A plain card is a tinted rect
// (class lo-k-<kind>, `hd` adds the section-header bar), a grid its dashed box
// with the dividing lines, a nested cluster two rects and two small squares.
// Rotation is a degrees-about-centre the drawer applies as a transform.
export function outlineRects(o) {
  const f = (o && o.frame) || {};
  const w = Math.max(1, Number(f.w) || 1);
  const h = Math.max(1, Number(f.h) || 1);
  const sections = (Array.isArray(o && o.sections) ? o.sections : []).map((s) => ({
    i: s.i, x: s.x, y: s.y, w: s.w, h: s.h, tx: f2(s.x + 3.5), ty: f2(s.y + 7.6),
  }));
  const cards = (Array.isArray(o && o.cards) ? o.cards : [])
    .map((c, idx) => ({ c, idx }))
    .sort((a, b) => (a.c.z - b.c.z) || (a.idx - b.idx))
    .map(({ c }, n) => {
      const cx = c.x + c.w / 2;
      const cy = c.y + c.h / 2;
      const base = { key: n, kind: c.k, x: c.x, y: c.y, w: c.w, h: c.h, rotate: c.r ? { deg: c.r, cx, cy } : null };
      if (c.k === 'grid') {
        const lines = [];
        const d = gridDims(c.g, c.w, c.h);
        for (let i = 1; i < d.c; i++) {
          const x = f2(c.x + (c.w * i) / d.c);
          lines.push({ x1: x, y1: c.y, x2: x, y2: c.y + c.h });
        }
        for (let i = 1; i < d.r; i++) {
          const y = f2(c.y + (c.h * i) / d.r);
          lines.push({ x1: c.x, y1: y, x2: c.x + c.w, y2: y });
        }
        return { ...base, type: 'grid', lines };
      }
      if (c.k === 'cluster') {
        const s = Math.min(c.w, c.h) * 0.26;
        const ins = 2.4;
        return {
          ...base,
          type: 'cluster',
          inner: { x: f2(c.x + ins), y: f2(c.y + ins), w: f2(c.w - 2 * ins), h: f2(c.h - 2 * ins) },
          squares: [
            { x: f2(cx - s * 0.75), y: f2(cy - s * 0.2), w: f2(s), h: f2(s) },
            { x: f2(cx - s * 0.25), y: f2(cy - s * 0.8), w: f2(s), h: f2(s) },
          ],
        };
      }
      return { ...base, type: 'card', header: !!c.hd };
    });
  return { w, h, viewBox: `0 0 ${w} ${h}`, wide: w >= h, sections, cards };
}

// ── The stored row, as text ──────────────────────────────────────────────

const pairs = (obj, keys) => keys.map((k) => `"${k}": ${JSON.stringify(obj[k])}`).join(', ');
const inline = (obj) => `{ ${pairs(obj, Object.keys(obj))} }`;

// The row exactly as stored, laid out for a narrow box: a card takes two lines.
export function storedRowLines(o) {
  const L = ['{'];
  L.push(`  "week": ${JSON.stringify(o.week)},`);
  L.push(`  "outline_id": ${JSON.stringify(o.outline_id)},`);
  L.push(`  "frame": ${inline(o.frame || {})},`);
  L.push('  "cards": [');
  const cards = o.cards || [];
  cards.forEach((c, i) => {
    const ks = Object.keys(c);
    L.push(`    { ${pairs(c, ks.slice(0, 5))},`);
    L.push(`      ${pairs(c, ks.slice(5))} }${i < cards.length - 1 ? ',' : ''}`);
  });
  L.push('  ],');
  L.push('  "sections": [');
  const sections = o.sections || [];
  sections.forEach((s, i) => L.push(`    ${inline(s)}${i < sections.length - 1 ? ',' : ''}`));
  L.push('  ],');
  const st = o.stats || {};
  L.push('  "stats": {');
  L.push(`    "cards": ${JSON.stringify(st.cards)},`);
  L.push(`    "kinds": ${inline(st.kinds || {})},`);
  L.push(`    "depth": ${JSON.stringify(st.depth)},`);
  L.push(`    "children": ${JSON.stringify(st.children)},`);
  L.push(`    "age": ${JSON.stringify(st.age)},`);
  L.push(`    "rotated": ${JSON.stringify(st.rotated)},`);
  L.push(`    "grids": ${JSON.stringify(st.grids)}`);
  L.push('  }');
  L.push('}');
  return L;
}

// One line split into runs the drawer colours: a quoted word followed by a
// colon is a key (quiet), any other quoted word, number or boolean a value.
export function jsonRuns(line) {
  const runs = [];
  const re = /"[^"]*"|-?\d+(?:\.\d+)?|true|false|null/g;
  let last = 0;
  let m;
  while ((m = re.exec(line))) {
    if (m.index > last) runs.push({ t: 'p', s: line.slice(last, m.index) });
    runs.push({ t: m[0][0] === '"' && line[m.index + m[0].length] === ':' ? 'k' : 'v', s: m[0] });
    last = m.index + m[0].length;
  }
  if (last < line.length) runs.push({ t: 'p', s: line.slice(last) });
  return runs;
}

// ── The gallery ──────────────────────────────────────────────────────────

// What the page tells you under the grid.
export function footText(shown, total, filtered) {
  if (!shown) return '';
  if (!isNum(total)) return `Showing ${fmtCount(shown)}`;
  return filtered
    ? `${fmtCount(shown)} of ${fmtCount(total)} match`
    : `Showing ${fmtCount(shown)} of ${fmtCount(total)}`;
}

export function countText(total) {
  return isNum(total) ? `${fmtCount(total)} ${total === 1 ? 'outline' : 'outlines'}` : NA;
}

// The next row to open from the drawer, or null.
export function neighbour(rows, id, dir) {
  const i = rows.findIndex((r) => r.outline_id === id);
  if (i < 0) return null;
  const to = rows[i + dir];
  return to ? to.outline_id : null;
}
