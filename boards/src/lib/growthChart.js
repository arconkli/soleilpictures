// growthChart.js — one weekly chart of the long-run band, as plain geometry.
//
// The band (pages/admin/analytics/widgets/GrowthBand.jsx) draws ten charts on
// one calendar. Each is an SVG laid out in real pixels at the width it is shown
// at, so a bar's rounded top, a dot and a one-pixel rule stay what they are at
// any width. A viewBox stretched to fit would squash the bars' corners and the
// dots into ovals and smear every rule across two pixels. This module does the
// arithmetic and nothing else, so it runs under node and a test can ask it what
// a chart would draw.
//
// What it draws, each rule with its reason:
//   * the week so far is hollow, past a thin divider, and never joined: a line
//     into a two-day week reads as a collapse every Monday;
//   * a week nothing was counting is hatched, never drawn as a zero;
//   * a rate under SMALL_N people is a small dot on its own, and a cohort still
//     filling is hollow; neither is joined, so no line passes through one;
//   * a change to the product is a dashed rule on every chart. A definition
//     break is a short solid tick on the charts of the series it changed, plus a
//     full rule when it cuts that series, whose line is thin before the cut;
//   * glyphs that would touch stack into lanes, and the chart grows a lane's
//     height for each lane past the first instead of letting them collide;
//   * on a chart drawn narrower than a phone held sideways the glyphs go (the
//     dashed rules stay, and the list beside them says what each one is), and
//     under a tablet's width "so far" leaves the axis so the months keep it.

import { GROWTH_MEASURES, SMALL_N, monthDay, rateOf } from './growthSeries.js';

export const PLOT_H = 48;
export const PAD_L = 34;
export const PAD_R = 4;
export const LANE = 12;
const GLYPH_GAP = 11;
const MONO_CHAR = 6.3; // one 10.5px JetBrains Mono character, for spacing the date labels
// Below these widths a chart drops its marker glyphs, and then its "so far".
export const GLYPH_MIN_W = 520;
export const SOFAR_MIN_W = 640;

const r1 = (v) => Math.round(v * 10) / 10;
// A one-pixel rule centred on a pixel, so it covers one pixel instead of two halves.
const crisp = (v) => Math.round(v) + 0.5;

/** A scale ceiling whose half is a whole number: 0 / 40 / 80, never 0 / 7.5 / 15. */
export function niceCeiling(v) {
  if (!(v > 0)) return 2;
  if (v <= 10) return [2, 4, 6, 8, 10].find((c) => c >= v);
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const s of [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10]) {
    const c = Math.round(s * mag * 1e6) / 1e6;
    if (c >= v) return c;
  }
  return 10 * mag;
}

/** 1.25k, 600, 7.5 — a scale label at the precision its line sits at. */
export function shortNumber(v) {
  if (v >= 1000) return `${Number((v / 1000).toFixed(2))}k`;
  return String(Number(v.toFixed(1)));
}

/** A bar with rounded top corners, standing on its baseline. '' when too short to see. */
export function barPath(x, y, w, h, r) {
  if (!(h > 0.4) || !(w > 0)) return '';
  const k = Math.min(r, w / 2, h);
  return `M${r1(x)},${r1(y + h)}V${r1(y + k)}Q${r1(x)},${r1(y)} ${r1(x + k)},${r1(y)}`
    + `H${r1(x + w - k)}Q${r1(x + w)},${r1(y)} ${r1(x + w)},${r1(y + k)}V${r1(y + h)}Z`;
}

function rectPath(x, y, w, h) {
  return h > 0.4 && w > 0 ? `M${r1(x)},${r1(y + h)}V${r1(y)}H${r1(x + w)}V${r1(y + h)}Z` : '';
}

const pathOf = (pts) => (pts.length ? `M${pts.map((p) => `${r1(p.x)},${r1(p.y)}`).join('L')}` : '');

/**
 * Geometry for one chart.
 *
 * @param {object}  growth      buildGrowth() output
 * @param {string}  measureKey  a GROWTH_MEASURES key
 * @param {number}  i0, i1      the weeks in view, inclusive
 * @param {number}  width       px the chart is drawn at. More than 17 weeks in view label
 *                              the axis by month, fewer every fourth week.
 * @param {boolean} first       its group's first chart: room above for glyphs
 * @param {boolean} last        its group's last chart: draws the date axis
 * @param {object[]} marks      bandMarkers().placed entries this chart draws (marksFor)
 * @param {Set}     glyphIds    the ids among them whose glyph goes on this chart
 * @param {number|null} hover   the week pointed at
 * @param {string|null} active  the marker id pointed at, here or in the list
 * @param {number|null} cutAt   index of the first week after this series' definition cut
 * @param {string|null} message a plot with nothing measured in view says this instead
 */
export function chartGeometry({
  growth, measureKey, i0, i1, width = 740, first = false, last = false,
  marks = [], glyphIds = new Set(), hover = null, active = null, cutAt = null, message = null,
}) {
  const m = GROWTH_MEASURES[measureKey];
  const s = growth.series[measureKey];
  const { weeks, P, L } = growth;
  const count = Math.max(1, i1 - i0 + 1);
  const x0 = PAD_L;
  const x1 = Math.max(x0 + count, Math.round(width) - PAD_R);
  const step = (x1 - x0) / count;
  const cx = (i) => x0 + (i - i0 + 0.5) * step;
  // Glyphs ride above a group's first chart, when the chart is wide enough to hold them.
  const glyphsFit = Math.round(width) >= GLYPH_MIN_W;
  const padT = first && glyphsFit ? 22 : 8;
  const padB = last ? 22 : 6;

  // Markers, and the lanes their glyphs need.
  const placed = marks
    .map((mk) => ({ mk, x: crisp(x0 + (mk.at - i0) * step) }))
    .sort((a, b) => a.x - b.x);
  const lanes = [];
  const glyphs = [];
  for (const p of placed) {
    if (!glyphsFit || !glyphIds.has(p.mk.id)) continue;
    let lane = 0;
    while (lanes[lane] != null && p.x - lanes[lane] < GLYPH_GAP) lane += 1;
    lanes[lane] = p.x;
    glyphs.push({ ...p, lane });
  }
  const grow = glyphs.length ? Math.max(0, 17 + LANE * (lanes.length - 1) - padT) : 0;
  const y0 = padT + grow;
  const yb = y0 + PLOT_H;
  const height = yb + padB;

  // The scale.
  const valueAt = (i) => (m.kind === 'rate' ? rateOf(s, i) : s.v[i]);
  let top = 0;
  for (let i = i0; i <= i1; i += 1) {
    const v = valueAt(i);
    if (v != null && v > top) top = v;
  }
  const max = m.kind === 'rate' ? 100 : niceCeiling(top);
  const Y = (v) => yb - (v / max) * PLOT_H;

  const geo = {
    width: Math.round(width), height, x0, x1, y0, yb, step, i0, i1, max,
    grid: [], weekLines: [], hatch: [], marks: [], glyphs: [], pdiv: null,
    bars: [], area: '', lines: [], dots: [], ticks: [], message: null, hoverBand: null, hoverX: null, hoverDot: null,
  };

  for (const f of [0, 0.5, 1]) {
    geo.grid.push({
      y: crisp(Y(f * max)),
      base: f === 0,
      label: message ? '' : m.kind === 'rate' ? `${Math.round(f * 100)}%` : shortNumber(f * max),
    });
  }
  if (step >= 14) for (let k = 1; k < count; k += 1) geo.weekLines.push(crisp(x0 + k * step));

  // Hatch every run of weeks nothing was counting, or the whole plot when it has a message instead.
  if (message) {
    geo.hatch.push({ x: x0, w: x1 - x0 });
    geo.message = { x: (x0 + x1) / 2, y: (y0 + yb) / 2, text: message };
  } else {
    for (let i = i0; i <= i1; i += 1) {
      if (s.measured[i]) continue;
      const from = i;
      while (i < i1 && !s.measured[i + 1]) i += 1;
      geo.hatch.push({ x: x0 + (from - i0) * step, w: (i - from + 1) * step });
    }
  }

  for (const { mk, x } of placed) {
    const on = active != null && mk.id === active;
    const kind = mk.kind;
    if (kind === 'break') {
      // Two pixels wide, so it sits on a pixel edge rather than a pixel centre.
      geo.marks.push({ id: mk.id, kind, x: x - 0.5, y1: y0 - 1, y2: y0 + 12, tick: true, on });
      if (mk.cut) geo.marks.push({ id: mk.id, kind, x, y1: y0, y2: yb, tick: false, on });
    } else {
      geo.marks.push({ id: mk.id, kind, x, y1: y0, y2: yb, tick: false, on });
    }
  }
  for (const g of glyphs) {
    geo.glyphs.push({ id: g.mk.id, kind: g.mk.kind, marker: g.mk, x: g.x, y: y0 - 4 - g.lane * LANE, on: active === g.mk.id });
  }

  const partialInView = P >= i0 && P <= i1;
  if (partialInView) geo.pdiv = crisp(x0 + (P - i0) * step);

  if (!message) {
    const bw = Math.max(2, Math.min(16, Math.round(step * 0.62)));
    const left = (i) => Math.round(cx(i) - bw / 2);
    // A stroked outline is drawn inside its box, so the hollow bar is the size of a full one.
    const inset = 0.625;

    if (m.kind === 'col') {
      for (let i = i0; i <= i1; i += 1) {
        const v = s.v[i];
        if (v == null || v <= 0) continue;
        const yTop = Math.min(yb - 1, Math.round(Y(v)));
        const part = i === P;
        geo.bars.push(part
          ? { d: barPath(left(i) + inset, yTop + inset, bw - 2 * inset, yb - yTop - inset, 3), part, tone: 'main', i }
          : { d: barPath(left(i), yTop, bw, yb - yTop, 3), part, tone: 'main', i });
      }
    } else if (m.kind === 'stack') {
      for (let i = i0; i <= i1; i += 1) {
        const back = s.back[i];
        const fresh = s.fresh[i];
        if (back == null || fresh == null) continue;
        const part = i === P;
        const x = left(i);
        const yBack = back > 0 ? Math.min(yb - 1, Math.round(Y(back))) : yb;
        if (back > 0) {
          const d = fresh > 0 ? rectPath(x, yBack, bw, yb - yBack) : barPath(x, yBack, bw, yb - yBack, 3);
          geo.bars.push(part
            ? { d: fresh > 0 ? rectPath(x + inset, yBack + inset, bw - 2 * inset, yb - yBack - inset)
                : barPath(x + inset, yBack + inset, bw - 2 * inset, yb - yBack - inset, 3), part, tone: 'back', i }
            : { d, part, tone: 'back', i });
        }
        if (fresh > 0) {
          // 2px of the plot between the two, as between any two fills.
          const bottom = back > 0 ? yBack - 2 : yb;
          const yTop = Math.min(bottom - 1, Math.round(Y(back + fresh)));
          geo.bars.push(part
            ? { d: barPath(x + inset, yTop + inset, bw - 2 * inset, bottom - yTop - 2 * inset, 3), part, tone: 'fresh', i }
            : { d: barPath(x, yTop, bw, bottom - yTop, 3), part, tone: 'fresh', i });
        }
      }
    } else if (m.kind === 'line') {
      // Complete weeks only; the week so far is its own hollow point. A gap is
      // never bridged, and a cut is never joined across.
      const segs = [];
      let cur = null;
      const end = Math.min(i1, L);
      for (let i = i0; i <= end; i += 1) {
        const v = s.v[i];
        const thin = cutAt != null && i < cutAt;
        if (v == null) { cur = null; continue; }
        if (!cur || cur.thin !== thin) { cur = { thin, pts: [] }; segs.push(cur); }
        cur.pts.push({ x: cx(i), y: Y(v), i });
      }
      for (const seg of segs) geo.lines.push({ d: pathOf(seg.pts), thin: seg.thin });
      // A reading with a gap on both sides is a path of one point, which draws
      // nothing, so it gets a dot of its own. The newest one gets its dot below.
      for (const seg of segs.slice(0, -1)) {
        if (seg.pts.length === 1) {
          const [p] = seg.pts;
          geo.dots.push({ cx: r1(p.x), cy: r1(p.y), r: 2, kind: 'lone', i: p.i });
        }
      }
      const full = segs.filter((seg) => !seg.thin);
      if (m.area && full.length) {
        geo.area = full.map((seg) => {
          const a = seg.pts[0];
          const z = seg.pts.at(-1);
          return `M${r1(a.x)},${yb}L${seg.pts.map((p) => `${r1(p.x)},${r1(p.y)}`).join('L')}L${r1(z.x)},${yb}Z`;
        }).join('');
      }
      const lastSeg = segs.at(-1);
      if (lastSeg) {
        const z = lastSeg.pts.at(-1);
        geo.dots.push({ cx: r1(z.x), cy: r1(z.y), r: lastSeg.thin ? 2.5 : 3.5, kind: lastSeg.thin ? 'thin' : 'last', i: z.i });
      }
      if (partialInView && s.v[P] != null) {
        geo.dots.push({ cx: r1(cx(P)), cy: r1(Y(s.v[P])), r: 3, kind: 'partial', i: P });
      }
    } else if (m.kind === 'rate') {
      const runs = [];
      let run = [];
      // A dot never grows past its week: at a phone's width, 26 weeks are about
      // eleven pixels apart, and full-size dots would sit on top of each other.
      const rMax = Math.max(2.5, Math.min(6.5, step * 0.42));
      for (let i = i0; i <= i1; i += 1) {
        const n = s.n[i];
        const p = rateOf(s, i);
        const settled = !!s.mature[i] && i !== P;
        const big = n >= SMALL_N;
        if (p == null || !settled || !big) {
          if (run.length) runs.push(run);
          run = [];
        } else {
          run.push({ x: cx(i), y: Y(p) });
        }
        if (p == null) continue;
        const r = Math.max(2.5, Math.min(rMax, 2 + Math.sqrt(n) * 0.42));
        const at = { cx: r1(cx(i)), cy: r1(Y(p)), i };
        if (!settled) geo.dots.push({ ...at, r, kind: 'filling' });
        else if (!big) geo.dots.push({ ...at, r: Math.min(r, 3), kind: 'small' });
        else geo.dots.push({ ...at, r, kind: 'full' });
      }
      if (run.length) runs.push(run);
      for (const pts of runs) if (pts.length > 1) geo.lines.push({ d: pathOf(pts), thin: true });
    }
  }

  // The date axis, under a group's last chart: months across the whole history,
  // every fourth week across thirteen, and "so far" flush right.
  if (last) {
    const labels = [];
    let sofar = null;
    for (let i = i0; i <= i1; i += 1) {
      const w = weeks[i];
      if (i === P) {
        if (Math.round(width) >= SOFAR_MIN_W) sofar = { x: x1, label: 'so far', end: true, sofar: true };
        continue;
      }
      let label = null;
      if (count > 17) {
        if (Number(w.slice(8, 10)) <= 7) label = monthDay(w).split(' ')[0];
      } else if ((L - i) % 4 === 0) {
        label = monthDay(w);
      }
      if (label) labels.push({ x: r1(cx(i)), label, end: false, sofar: false });
    }
    // Drop a label that would touch the one before it, or "so far".
    const kept = [];
    const half = (l) => (l.label.length * MONO_CHAR) / 2;
    for (const l of labels) {
      const prev = kept.at(-1);
      if (prev && l.x - half(l) < prev.x + half(prev) + 8) continue;
      if (sofar && l.x + half(l) > sofar.x - sofar.label.length * MONO_CHAR - 8) continue;
      kept.push(l);
    }
    geo.ticks = sofar ? [...kept, sofar] : kept;
    geo.tickY = yb + 6;
  }

  if (hover != null && hover >= i0 && hover <= i1) {
    geo.hoverBand = { x: x0 + (hover - i0) * step, w: step };
    geo.hoverX = crisp(cx(hover));
    if (!message && (m.kind === 'line' || m.kind === 'rate')) {
      const v = valueAt(hover);
      if (v != null) geo.hoverDot = { cx: r1(cx(hover)), cy: r1(Y(v)) };
    }
  }
  return geo;
}

/** The week under a pointer at x px inside the chart, or null outside the plot. */
export function weekAt(geo, x) {
  if (!geo || !(x >= geo.x0) || !(x <= geo.x1)) return null;
  const i = geo.i0 + Math.floor((x - geo.x0) / geo.step);
  return Math.min(geo.i1, Math.max(geo.i0, i));
}
