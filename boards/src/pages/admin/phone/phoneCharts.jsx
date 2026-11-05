// phoneCharts.jsx — the phone admin's chart kit: plain SVG (and a few plain
// HTML bars), no chart library. Every colour comes from a CSS class in
// adminPhone.css (ink tokens for marks and text, the admin palette only where
// two series share a chart), so the kit follows the light theme for free.
//
// The insights layer (lib/phoneInsights.js) hands these components their props
// in the shapes below, and the components never recompute a week state, a rate
// or a delta:
//   WeekPoint { key:'YYYY-MM-DD', label, v:number|null, state:'done'|'settling'|'open' }  (rates are 0..1)
//   Note      { i, lines:[a] | [a, b], dot? }
//   Bar       { key, label, v:number|null, tone:'now'|'before', open:boolean }
//   Ref       { v, i0, i1 }          VRule { i, lines }
//   StackRow  { key, label, a, b, state }
//   HeatCell  { dow:1..7, hour:0..23, n, title }
//   RankItem  { key, label, n }      LollipopItem { key, label, sub, v:0..1|null, on }
//   LadderStep { label, n }          SplitPart { label, n, on }
//   Delta     { text:'▲ 3%'|'▼ 4 pts'|'same'|'', dir:'up'|'down'|'flat' }
//   Readout   { value, label, delta? }
//
// Rules shared by every plot: a null value is a gap (never zero); an open week
// is a hollow dot (or an outlined bar) and is never joined to the line; a
// settling week is a dashed step. Press and drag reads the nearest point;
// letting go returns to the default readout after 1.2 s. Each chart is
// role="img" with an aria-label and carries a visually hidden table of its
// points (class ap-sr).
import { useEffect, useId, useRef, useState } from 'react';
import { sparkRuns } from '../../../lib/phonePanel.js';

/** Width of every chart's viewBox. */
export const W = 324;
const GUT = 30; // left gutter for y labels, so no label ever sits under a line
const LH = 12.5; // line height of a note
const HOLD = 1200; // ms the scrubbed reading stays after release

const P = (n) => +n.toFixed(1);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const cx = (...a) => a.filter(Boolean).join(' ');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const pc = (x) => `${Math.round(x * 100)}%`;
const nf = (v) => (v == null ? '—' : Number.isInteger(v) ? v.toLocaleString('en-US') : String(+v.toFixed(1)));
const defFmt = (isPct) => (isPct ? (v) => pc(v) : nf);
const cleanId = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, '');

/** A "nice" axis maximum at or above `v`: 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8 or 10 times a power of ten. */
export function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 1.5 ? 1.5 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 3 ? 3 : m <= 4 ? 4 : m <= 5 ? 5 : m <= 6 ? 6 : m <= 8 ? 8 : 10) * p;
}
const tickText = (v, isPct) => (isPct ? `${Math.round(v * 100)}%` : v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : `${+v.toFixed(1)}`);
const monthOf = (key) => {
  const m = Number(String(key || '').slice(5, 7));
  return m >= 1 && m <= 12 ? MON[m - 1] : null;
};

/** x positions for month labels: the first point of each new month, at least `minGap` apart. */
function monthTicks(items, X, minGap = 30) {
  const out = [];
  let last = null;
  let lastX = -99;
  items.forEach((p, i) => {
    const m = monthOf(p && p.key);
    if (!m) return;
    const x = X(i);
    if (last !== null && m !== last && x - lastX >= minGap) { out.push({ x, text: m }); lastX = x; }
    last = m;
  });
  return out;
}

/** The x axis text row, from 'month', an [{ i, text }] list or null. */
function XLabels({ xl, items, X, y, n, minX = 0 }) {
  let marks = [];
  if (xl === 'month') marks = monthTicks(items, X).map((m) => ({ ...m, a: 'middle' }));
  else if (Array.isArray(xl)) {
    marks = xl.filter((m) => m && m.i >= 0 && m.i < n).map((m) => {
      let x = X(m.i);
      let a = 'middle';
      const half = String(m.text).length * 2.7;
      if (x - half < minX) { x = minX; a = 'start'; } else if (x + half > W) { x = W; a = 'end'; }
      return { x, text: m.text, a };
    });
  }
  return marks.map((m, k) => <text key={k} className="ap-xt" x={P(m.x)} y={y} textAnchor={m.a}>{m.text}</text>);
}

/* ---------- notes: a dot on the point, a dashed leader, small text ---------- */

/** Where a note's text goes. Right third of the plot: text to the left of the point, else to the right; above unless that leaves the plot. Never outside the viewBox. */
function noteLayout(px, py, lines, { minX, maxX, top, bottom }) {
  const n = lines.length;
  const w = Math.max(...lines.map((s) => String(s).length)) * 5.8 + 4;
  const fits = (a) => (a === 'end' ? px - 10 - w >= minX : px + 10 + w <= maxX);
  let anchor = px > minX + (maxX - minX) * (2 / 3) ? 'end' : 'start';
  const other = anchor === 'end' ? 'start' : 'end';
  if (!fits(anchor) && fits(other)) anchor = other;
  let tx = px + (anchor === 'end' ? -10 : 10);
  tx = anchor === 'end' ? Math.max(tx, minX + w + 3) : Math.min(tx, maxX - w - 3);
  let up = true;
  let first = py - 14 - (n - 1) * LH;
  if (first - 10 < top) { up = false; first = py + 18; }
  if (!up && first + (n - 1) * LH + 3 > bottom + 14) first = bottom + 14 - 3 - (n - 1) * LH;
  const lastBase = first + (n - 1) * LH;
  const ex = tx;
  const ey = up ? lastBase + 3 : first - 9;
  return { anchor, tx: tx + (anchor === 'end' ? -3 : 3), first, ex, ey };
}

function NoteMark({ px, py, lines, dot = true, minX = 0, maxX = W, top = 2, bottom }) {
  const L = noteLayout(px, py, lines, { minX, maxX, top, bottom });
  return (
    <g className="ap-ann">
      {dot && <circle className="ap-annd" cx={P(px)} cy={P(py)} r="2.6" />}
      <path className="ap-annl" d={`M${P(px)},${P(py)}L${P(L.ex)},${P(L.ey)}`} />
      {lines.map((t, k) => (
        <text key={k} className={k === 0 ? 'ap-n1' : 'ap-n2'} x={P(L.tx)} y={P(L.first + k * LH)} textAnchor={L.anchor}>{t}</text>
      ))}
    </g>
  );
}

/* ---------- scrub: press and drag reads the nearest point ---------- */

/** Pointer handling shared by the scrubbable plots. `points` are { x, y|null, label, text } in viewBox units. */
function useScrub(points) {
  const svgRef = useRef(null);
  const [sel, setSel] = useState(null);
  const down = useRef(false);
  const timer = useRef(0);
  const live = useRef(points);
  live.current = points;
  useEffect(() => () => clearTimeout(timer.current), []);

  const at = (e) => {
    const svg = svgRef.current;
    const pts = live.current;
    if (!svg || !pts.length) return;
    const r = svg.getBoundingClientRect();
    if (!r.width) return;
    const x = ((e.clientX - r.left) * W) / r.width;
    let best = 0;
    let bd = Infinity;
    pts.forEach((p, i) => { const d = Math.abs(p.x - x); if (d < bd) { bd = d; best = i; } });
    clearTimeout(timer.current);
    setSel(best);
  };
  const handlers = {
    onPointerDown: (e) => {
      down.current = true;
      try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
      at(e);
    },
    onPointerMove: (e) => { if (down.current || e.pointerType === 'mouse') at(e); },
    onPointerUp: () => {
      down.current = false;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setSel(null), HOLD);
    },
    onPointerCancel: () => { down.current = false; clearTimeout(timer.current); setSel(null); },
    onPointerLeave: (e) => { if (e.pointerType === 'mouse') { down.current = false; clearTimeout(timer.current); setSel(null); } },
  };
  const cur = sel != null && points[sel] ? points[sel] : null;
  return { svgRef, handlers, cur };
}

/** The scrub rule, the dot, and (when the chart has no readout row) a small tip at the top of the plot. */
function ScrubMark({ cur, top, bottom, tip }) {
  if (!cur) return null;
  const end = cur.x > W * 0.6;
  return (
    <g className="ap-scrub" pointerEvents="none">
      <line className="ap-srule" x1={P(cur.x)} x2={P(cur.x)} y1={top} y2={bottom} />
      {cur.y != null && <circle className="ap-sdot" cx={P(cur.x)} cy={P(cur.y)} r="4" />}
      {tip && <text className="ap-tip" x={P(cur.x + (end ? -6 : 6))} y="10" textAnchor={end ? 'end' : 'start'}>{`${cur.text} · ${cur.label}`}</text>}
    </g>
  );
}

/** The big numeral + delta + label row above a scrubbable chart. While scrubbing it shows the point instead. */
function ReadoutRow({ readout, cur }) {
  return (
    <div className="ap-ro">
      <span className="ap-ro-v">{cur ? cur.text : readout.value}</span>
      {readout.delta && <span className="ap-ro-d" style={cur ? { visibility: 'hidden' } : undefined}><DeltaText delta={readout.delta} /></span>}
      <span className="ap-ro-l">{cur ? cur.label : readout.label}</span>
    </div>
  );
}

/** A visually hidden table of a chart's points, for screen readers. The wrapper
    is what's clipped: a table ignores a 1px height, and a 168-row heatmap table
    would otherwise stretch the page's scroller with blank space. */
function SrTable({ label, rows }) {
  return (
    <div className="ap-sr">
      <table>
        <caption>{label}</caption>
        <tbody>
          {rows.map((r, i) => <tr key={i}><th scope="row">{r[0]}</th><td>{r[1]}</td></tr>)}
        </tbody>
      </table>
    </div>
  );
}

const pointText = (v, f, open) => (v == null ? 'no data' : `${f(v)}${open ? ' so far' : ''}`);

/* ---------- WeekLine ---------- */

/**
 * A weekly (or daily) line. Done points are solid, a settling point is a dashed
 * step from the last done point, an open point is a hollow dot that is never
 * joined, a null is a gap.
 * @param {{pts:Array, h?:number, isPct?:boolean, yMin?:number, yMax?:number, area?:boolean, invert?:boolean, notes?:Array, xl?:'month'|Array<{i:number,text:string}>|null, fmt?:Function, readout?:object, between?:any, label?:string}} props
 *   `between` is a node drawn between the readout row and the plot (the lead card's one-line clause).
 *   `invert` puts small numbers at the top (average place). `yMin`/`yMax` pin the axis.
 *   `notes` are [{ i, lines, dot? }]; `readout` is { value, label, delta? } and is drawn above the plot.
 */
export function WeekLine({ pts = [], h = 150, isPct = false, yMin = 0, yMax, area = true, invert = false, notes = [], xl = 'month', fmt, readout, between, label = '' }) {
  const f = fmt || defFmt(isPct);
  const gid = cleanId(useId());
  const n = pts.length;
  const T = notes.length ? 24 : 16;
  const B = xl ? 22 : 8;
  const L = GUT;
  const pw = W - L;
  const ph = h - T - B;
  const vals = pts.map((p) => num(p && p.v)).filter((v) => v != null);
  let max = yMax ?? niceMax((vals.length ? Math.max(...vals) : 0) * (isPct ? 1.05 : 1.1));
  if (!(max > yMin)) max = yMin + 1;
  const X = (i) => L + (n <= 1 ? pw / 2 : (i * pw) / (n - 1));
  const Y = (v) => {
    const t = clamp((v - yMin) / (max - yMin), 0, 1);
    return invert ? T + t * ph : T + ph - t * ph;
  };
  const ticks = h >= 200 ? [0, 0.25, 0.5, 0.75, 1] : [0, 0.5, 1];

  const solid = [];
  const dashed = [];
  let seg = [];
  const flush = () => { if (seg.length) solid.push(seg); seg = []; };
  pts.forEach((p, i) => {
    const v = num(p && p.v);
    if (v == null || p.state === 'open') { flush(); return; }
    if (p.state === 'settling') {
      const prev = pts[i - 1];
      const pv = num(prev && prev.v);
      if (pv != null && prev.state === 'done') dashed.push([[X(i - 1), Y(pv)], [X(i), Y(v)]]);
      flush();
      return;
    }
    seg.push([X(i), Y(v)]);
  });
  flush();
  const dp = (s) => s.map((q, j) => `${j ? 'L' : 'M'}${P(q[0])},${P(q[1])}`).join('');
  let lastIdx = -1;
  pts.forEach((p, i) => { if (num(p && p.v) != null && p.state !== 'open') lastIdx = i; });

  const points = pts.map((p, i) => {
    const v = num(p && p.v);
    return { x: X(i), y: v == null ? null : Y(v), label: p ? p.label : '', text: pointText(v, f, p && p.state === 'open') };
  });
  const { svgRef, handlers, cur } = useScrub(points);

  return (
    <div className="ap-chart">
      {readout && <ReadoutRow readout={readout} cur={cur} />}
      {between}
      <svg ref={svgRef} className="ap-ch" viewBox={`0 0 ${W} ${h}`} role="img" aria-label={label} {...handlers}>
        <defs>
          <linearGradient id={`g${gid}`} x1="0" x2="0" y1="0" y2="1">
            <stop className="ap-ga" offset="0" />
            <stop className="ap-gb" offset="1" />
          </linearGradient>
        </defs>
        {ticks.map((fr) => {
          const tv = yMin + fr * (max - yMin);
          const y = Y(tv);
          const base = Math.abs(y - (T + ph)) < 0.01;
          return (
            <g key={fr}>
              <line className={cx('ap-gl', base && 'base')} x1={L} x2={W} y1={P(y)} y2={P(y)} />
              {!(tv === 0 && !invert) && <text className="ap-yt" x={L - 7} y={P(y + 3.5)} textAnchor="end">{tickText(tv, isPct)}</text>}
            </g>
          );
        })}
        {area && !invert && solid.filter((s) => s.length > 1).map((s, k) => (
          <path key={`a${k}`} d={`${dp(s)}L${P(s[s.length - 1][0])},${T + ph}L${P(s[0][0])},${T + ph}Z`} fill={`url(#g${gid})`} />
        ))}
        {solid.filter((s) => s.length > 1).map((s, k) => <path key={`l${k}`} className="ap-ln ap-draw" pathLength="1" d={dp(s)} />)}
        {solid.filter((s) => s.length === 1).map((s, k) => <circle key={`s${k}`} className="ap-dot1" cx={P(s[0][0])} cy={P(s[0][1])} r="2.2" />)}
        {dashed.map((s, k) => <path key={`d${k}`} className="ap-ln ap-dash" d={dp(s)} />)}
        {lastIdx >= 0 && <circle className="ap-endot" cx={P(X(lastIdx))} cy={P(Y(num(pts[lastIdx].v)))} r="3.6" />}
        {pts.map((p, i) => (num(p && p.v) != null && p.state === 'open'
          ? <circle key={`o${i}`} className="ap-hollow" cx={P(X(i))} cy={P(Y(p.v))} r="3.4" />
          : null))}
        {notes.map((a, k) => {
          const p = pts[a.i];
          const v = num(p && p.v);
          if (v == null || !a.lines || !a.lines.length) return null;
          return <NoteMark key={k} px={X(a.i)} py={Y(v)} lines={a.lines} dot={a.dot !== false} top={2} bottom={T + ph} />;
        })}
        {xl && <XLabels xl={xl} items={pts} X={X} y={h - 5} n={n} minX={L} />}
        <ScrubMark cur={cur} top={T} bottom={T + ph} tip={!readout} />
      </svg>
      <SrTable label={label} rows={points.map((p) => [p.label, p.text])} />
    </div>
  );
}

/* ---------- Bars ---------- */

// A bar with a flat foot on the baseline and rounded data-end corners.
function topRound(x, y, bw, bh, r) {
  r = Math.min(r, bw / 2, bh);
  if (!(bh > 0)) return '';
  return `M${P(x)},${P(y + bh)}V${P(y + r)}Q${P(x)},${P(y)} ${P(x + r)},${P(y)}H${P(x + bw - r)}Q${P(x + bw)},${P(y)} ${P(x + bw)},${P(y + r)}V${P(y + bh)}Z`;
}

/**
 * Bars on a baseline. Tone 'now' bars are ink, 'before' bars grey; an `open`
 * bar is outlined, not filled; a null value is a gap.
 * @param {{bars:Array, h?:number, isPct?:boolean, yMax?:number, xl?:'month'|Array<{i:number,text:string}>|null, axis?:boolean, refs?:Array<{v:number,i0:number,i1:number}>, vrule?:{i:number,lines:string[]}, notes?:Array, maxBw?:number, fmt?:Function, readout?:object, label?:string}} props
 *   `refs` are dashed mean lines. `vrule` is a dashed vertical rule at the left edge of bar i with its note.
 *   With `axis` false there are no y labels and (up to 14 bars) each bar carries its value, with * on an open bar.
 */
export function Bars({ bars = [], h = 130, isPct = false, yMax, xl, axis = true, refs = [], vrule, notes = [], maxBw = 26, fmt, readout, label = '' }) {
  const f = fmt || defFmt(isPct);
  const n = bars.length;
  const slotN = Math.max(1, n);
  const vrLines = vrule && vrule.lines ? vrule.lines : [];
  const T = vrule ? Math.max(16, 20 + (Math.max(1, vrLines.length) - 1) * LH) : notes.length ? 30 : axis ? 16 : 24;
  const B = xl ? 22 : 8;
  const L = axis ? GUT : 0;
  const pw = W - L;
  const ph = h - T - B;
  const vals = bars.map((b) => num(b && b.v)).filter((v) => v != null);
  const max = yMax ?? niceMax((vals.length ? Math.max(...vals) : 0) * 1.1);
  const slot = pw / slotN;
  const bw = Math.min(maxBw, Math.max(1.6, slot - Math.max(1.4, slot * 0.3)));
  const Y = (v) => T + ph - clamp(v / max, 0, 1) * ph;
  const base = T + ph;
  const labelled = !axis && n <= 14;

  const points = bars.map((b, i) => {
    const v = num(b && b.v);
    return { x: L + i * slot + slot / 2, y: v == null ? null : Y(v), label: b ? b.label : '', text: pointText(v, f, b && b.open) };
  });
  const { svgRef, handlers, cur } = useScrub(points);
  const X = (i) => L + i * slot + slot / 2;
  const ruleX = vrule ? L + vrule.i * slot : 0;
  const ruleEnd = vrule ? ruleX > W * (2 / 3) : false;

  return (
    <div className="ap-chart">
      {readout && <ReadoutRow readout={readout} cur={cur} />}
      <svg ref={svgRef} className="ap-ch" viewBox={`0 0 ${W} ${h}`} role="img" aria-label={label} {...handlers}>
        {axis ? [0, 0.5, 1].map((fr) => {
          const y = Y(fr * max);
          return (
            <g key={fr}>
              <line className={cx('ap-gl', fr === 0 && 'base')} x1={L} x2={W} y1={P(y)} y2={P(y)} />
              {fr !== 0 && <text className="ap-yt" x={L - 7} y={P(y + 3.5)} textAnchor="end">{tickText(fr * max, isPct)}</text>}
            </g>
          );
        }) : <line className="ap-gl base" x1="0" x2={W} y1={base} y2={base} />}
        {vrule && vrule.i >= 0 && vrule.i < n && <path className="ap-vrule" d={`M${P(ruleX)},3V${base}`} />}
        {bars.map((b, i) => {
          const v = num(b && b.v);
          if (v == null) return null;
          const x = L + i * slot + (slot - bw) / 2;
          const y = Y(v);
          const bh = base - y;
          const tone = b.tone === 'now' ? 'ap-b-now' : 'ap-b-before';
          const r = 4;
          return (
            <g key={i}>
              {b.open
                ? (bh > 0 && <path className={cx('ap-b-open', tone)} d={topRound(x + 0.75, y + 0.75, bw - 1.5, Math.max(0, bh - 0.75), r)} />)
                : (v > 0 && <path className={tone} d={topRound(x, y, bw, Math.max(bh, 1.5), r)} />)}
              {labelled && <text className={cx('ap-bv', b.open && 'open')} x={P(x + bw / 2)} y={P(y - 6)} textAnchor="middle">{`${f(v)}${b.open ? '*' : ''}`}</text>}
            </g>
          );
        })}
        {refs.map((r, k) => {
          const v = num(r && r.v);
          if (v == null) return null;
          const y = Y(v);
          return <path key={k} className="ap-refl" d={`M${P(L + r.i0 * slot + 1)},${P(y)}H${P(L + (r.i1 + 1) * slot - 1)}`} />;
        })}
        {vrule && vrLines.map((t, k) => (
          <text key={k} className={k === 0 ? 'ap-n1' : 'ap-n2'} x={P(ruleX + (ruleEnd ? -5 : 5))} y={P(11 + k * LH)} textAnchor={ruleEnd ? 'end' : 'start'}>{t}</text>
        ))}
        {notes.map((a, k) => {
          const b = bars[a.i];
          const v = num(b && b.v);
          if (v == null || !a.lines || !a.lines.length) return null;
          return <NoteMark key={k} px={X(a.i)} py={Y(v)} lines={a.lines} dot={a.dot !== false} minX={L} top={2} bottom={base} />;
        })}
        {xl && <XLabels xl={xl} items={bars} X={X} y={h - 5} n={n} minX={L} />}
        <ScrubMark cur={cur} top={T} bottom={base} tip={!readout} />
      </svg>
      <SrTable label={label} rows={points.map((p) => [p.label, p.text])} />
    </div>
  );
}

/* ---------- StackBars ---------- */

/**
 * Two series stacked, `a` (palette cat 1) under `b` (cat 2), 2px apart, with a
 * legend that is always shown. A row whose `a` is null is a gap; an open row
 * is drawn lighter.
 * @param {{rows:Array<{key:string,label:string,a:number|null,b:number|null,state:string}>, legend:Array<{label:string}>, h?:number, fmt?:Function, readout?:object, label?:string}} props
 */
export function StackBars({ rows = [], legend = [], h = 150, fmt, readout, label = '' }) {
  const f = fmt || nf;
  const T = 16;
  const B = 22;
  const L = GUT;
  const pw = W - L;
  const ph = h - T - B;
  const n = rows.length;
  const totals = rows.map((r) => (num(r && r.a) == null ? 0 : (num(r.a) || 0) + (num(r.b) || 0)));
  const max = niceMax((totals.length ? Math.max(...totals) : 0) * 1.08);
  const slot = pw / Math.max(1, n);
  const bw = Math.min(20, Math.max(1.6, slot - Math.max(1.6, slot * 0.3)));
  const Y = (v) => T + ph - clamp(v / max, 0, 1) * ph;
  const base = T + ph;
  const names = [legend[0] ? legend[0].label : 'First', legend[1] ? legend[1].label : 'Second'];
  const X = (i) => L + i * slot + slot / 2;

  const points = rows.map((r, i) => {
    const a = num(r && r.a);
    if (a == null) return { x: X(i), y: null, label: r ? r.label : '', text: 'no data' };
    const b = num(r.b) || 0;
    return {
      x: X(i),
      y: Y(a + b),
      label: `${r.label} · ${names[0]} ${f(a)}, ${names[1]} ${f(b)}`,
      text: `${f(a + b)}${r.state === 'open' ? ' so far' : ''}`,
    };
  });
  const { svgRef, handlers, cur } = useScrub(points);

  return (
    <div className="ap-chart">
      {readout && <ReadoutRow readout={readout} cur={cur} />}
      <svg ref={svgRef} className="ap-ch" viewBox={`0 0 ${W} ${h}`} role="img" aria-label={label} {...handlers}>
        {[0, 0.5, 1].map((fr) => {
          const y = Y(fr * max);
          return (
            <g key={fr}>
              <line className={cx('ap-gl', fr === 0 && 'base')} x1={L} x2={W} y1={P(y)} y2={P(y)} />
              {fr !== 0 && <text className="ap-yt" x={L - 7} y={P(y + 3.5)} textAnchor="end">{tickText(fr * max)}</text>}
            </g>
          );
        })}
        {rows.map((r, i) => {
          const a = num(r && r.a);
          if (a == null) return null;
          const b = num(r.b) || 0;
          const x = L + i * slot + (slot - bw) / 2;
          const open = r.state === 'open';
          const ya = Y(a);
          const ha = base - ya;
          const yb = Y(a + b);
          const hb = ya - yb - 2; // 2px surface gap between the fills
          return (
            <g key={i} className={open ? 'ap-st-open' : undefined}>
              {a > 0 && (b > 0
                ? <rect className="ap-s1" x={P(x)} y={P(ya)} width={P(bw)} height={P(Math.max(0, ha))} />
                : <path className="ap-s1" d={topRound(x, ya, bw, Math.max(ha, 1.5), 4)} />)}
              {b > 0 && hb > 0 && <path className="ap-s2" d={topRound(x, yb, bw, hb, 4)} />}
            </g>
          );
        })}
        <XLabels xl="month" items={rows} X={X} y={h - 5} n={n} minX={L} />
        <ScrubMark cur={cur} top={T} bottom={base} tip={!readout} />
      </svg>
      <Legend items={names} />
      <SrTable label={label} rows={rows.map((r, i) => [r ? r.label : '', num(r && r.a) == null ? 'no data' : `${names[0]} ${f(r.a)}, ${names[1]} ${f(num(r.b) || 0)}${r.state === 'open' ? ' so far' : ''}`])} />
    </div>
  );
}

function Legend({ items }) {
  return (
    <div className="ap-lgd">
      {items.map((t, k) => <span key={k}><i className={`ap-lg${k + 1}`} aria-hidden="true" />{t}</span>)}
    </div>
  );
}

/* ---------- Heatmap ---------- */

const hourWord = (h) => (h === 0 ? '12 am' : h < 12 ? `${h} am` : h === 12 ? '12 pm' : `${h - 12} pm`);

/**
 * 7 rows (Mon..Sun) by 24 hours on a one-hue 5-step ramp (ink at five
 * strengths). The busiest cell is outlined. Tapping anywhere in a cell's slot
 * (the targets fill the grid) shows its title in the line under the grid.
 * @param {{cells:Array<{dow:number,hour:number,n:number,title:string}>, label?:string}} props
 */
export function Heatmap({ cells = [], label = '' }) {
  const [picked, setPicked] = useState(null);
  const svgRef = useRef(null);
  const Lx = 28;
  const T = 2;
  const gap = 2;
  const cols = 24;
  const ch = 17;
  const cw = (W - Lx - gap * (cols - 1)) / cols;
  const grid = new Map();
  cells.forEach((c) => { if (c && c.dow >= 1 && c.dow <= 7 && c.hour >= 0 && c.hour <= 23) grid.set(`${c.dow}:${c.hour}`, c); });
  const cellAt = (dow, hour) => grid.get(`${dow}:${hour}`) || { dow, hour, n: 0, title: `${DOW[dow - 1]} ${hourWord(hour)}: none` };
  const nz = [...grid.values()].map((c) => num(c.n) || 0).filter((v) => v > 0).sort((a, b) => a - b);
  const max = nz.length ? nz[nz.length - 1] : 0;
  const q = [0.25, 0.5, 0.75].map((fr) => nz[Math.floor(fr * (nz.length - 1))]);
  const step = (v) => (!(v > 0) ? 0 : v >= max ? 4 : v <= q[0] ? 1 : v <= q[1] ? 2 : v <= q[2] ? 3 : 4);
  let top = null;
  grid.forEach((c) => { if (max > 0 && (num(c.n) || 0) === max && (!top || c.dow < top.dow || (c.dow === top.dow && c.hour < top.hour))) top = c; });
  const hh = T + 7 * (ch + gap) + 12;
  const vbH = P(hh + 4);
  const cellX = (hr) => Lx + hr * (cw + gap);
  const cellY = (dow) => T + (dow - 1) * (ch + gap);

  const tap = (e) => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const x = ((e.clientX - r.left) * W) / r.width;
    const y = ((e.clientY - r.top) * vbH) / r.height;
    const col = Math.floor((x - Lx + gap / 2) / (cw + gap));
    const row = Math.floor((y - T + gap / 2) / (ch + gap));
    if (col < 0 || col >= cols || row < 0 || row >= 7) return;
    setPicked({ dow: row + 1, hour: col });
  };
  const sel = picked ? cellAt(picked.dow, picked.hour) : null;
  const line = sel ? sel.title : top ? top.title : 'No activity recorded';

  return (
    <div className="ap-chart ap-heatwrap">
      <svg ref={svgRef} className="ap-ch ap-heat" viewBox={`0 0 ${W} ${vbH}`} role="img" aria-label={label} onClick={tap}>
        {DOW.map((d, i) => <text key={d} className="ap-xt" x="0" y={P(cellY(i + 1) + ch - 5)}>{d}</text>)}
        {[0, 6, 12, 18].map((hr) => <text key={hr} className="ap-xt" x={P(cellX(hr))} y={P(hh)}>{hourWord(hr).replace(' ', '')}</text>)}
        {DOW.map((_, di) => Array.from({ length: cols }, (__, hr) => {
          const c = cellAt(di + 1, hr);
          return <rect key={`${di}-${hr}`} className={`ap-h${step(num(c.n) || 0)}`} x={P(cellX(hr))} y={P(cellY(di + 1))} width={P(cw)} height={ch} rx="1.5" />;
        }))}
        {top && <rect className="ap-htop" x={P(cellX(top.hour) - 1.5)} y={P(cellY(top.dow) - 1.5)} width={P(cw + 3)} height={ch + 3} rx="2.5" />}
        {sel && <rect className="ap-hsel" x={P(cellX(sel.hour) - 2.2)} y={P(cellY(sel.dow) - 2.2)} width={P(cw + 4.4)} height={ch + 4.4} rx="3" />}
      </svg>
      <div className="ap-hlg" aria-hidden="true">
        <span>Fewer people</span>
        <span className="sw">{[0, 1, 2, 3, 4].map((k) => <i key={k} className={`ap-h${k}`} />)}</span>
        <span>More</span>
      </div>
      <p className="ap-heat-line" aria-live="polite">{line}</p>
      <SrTable label={label} rows={[...grid.values()].map((c) => [c.title, String(num(c.n) || 0)])} />
    </div>
  );
}

/* ---------- Spark ---------- */

/**
 * A small line for a tile: up to 12 values, ending on a dot. A null value is a
 * gap: the line breaks there and is never joined across it. `dashedFlat` draws a
 * flat dashed baseline instead (a measure that has been zero).
 * @param {{vals:Array<number|null>, pct?:boolean, dashedFlat?:boolean}} props
 */
export function Spark({ vals: raw = [], pct = false, dashedFlat = false }) {
  const gid = cleanId(useId());
  const w = 150;
  const h = 44;
  const { vals, runs, last } = sparkRuns(raw);
  const f = pct ? (x) => pc(x) : nf;
  if (dashedFlat) {
    return (
      <svg className="ap-mini" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Flat at zero">
        <path className="ap-spark-flat" d={`M2,${h - 6}H${w - 4}`} />
      </svg>
    );
  }
  if (last === -1) return <svg className="ap-mini" viewBox={`0 0 ${w} ${h}`} aria-hidden="true" />;
  const real = vals.filter((x) => x != null);
  const mx = Math.max(...real);
  const mn = Math.min(...real);
  const X = (i) => (vals.length === 1 ? w - 6 : 2 + (i * (w - 8)) / (vals.length - 1));
  const Y = (x) => (mx === mn ? h / 2 : h - 5 - ((x - mn) / (mx - mn)) * (h - 12));
  // One subpath per run of two or more points; a lone point between gaps is a
  // small dot, so a week with a value never disappears.
  const lines = runs.filter((r) => r.length > 1);
  const d = lines.map((r) => r.map((i, k) => `${k ? 'L' : 'M'}${P(X(i))},${P(Y(vals[i]))}`).join('')).join('');
  const fill = lines.map((r) => `${r.map((i, k) => `${k ? 'L' : 'M'}${P(X(i))},${P(Y(vals[i]))}`).join('')}L${P(X(r.at(-1)))},${h - 1}L${P(X(r[0]))},${h - 1}Z`).join('');
  return (
    <svg className="ap-mini" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={vals.length === 1 ? `Last week: ${f(vals[last])}` : `Last ${vals.length} weeks: ${f(real[0])} to ${f(vals[last])}`}>
      <defs>
        <linearGradient id={`m${gid}`} x1="0" x2="0" y1="0" y2="1">
          <stop className="ap-ga" offset="0" />
          <stop className="ap-gb" offset="1" />
        </linearGradient>
      </defs>
      {lines.length > 0 && <path d={fill} fill={`url(#m${gid})`} />}
      {lines.length > 0 && <path className="ap-ln ap-ln-thin ap-draw" pathLength="1" d={d} />}
      {runs.filter((r) => r.length === 1 && r[0] !== last).map((r) => (
        <circle key={r[0]} className="ap-ln-dot" cx={P(X(r[0]))} cy={P(Y(vals[r[0]]))} r="1.6" />
      ))}
      <circle className="ap-endot" cx={P(X(last))} cy={P(Y(vals[last]))} r="3" />
    </svg>
  );
}

/* ---------- RankBars ---------- */

/**
 * Ranked horizontal bars: a label, a bar, the count and its share of `total`.
 * The first row is ink, the rest grey. Items arrive sorted.
 * @param {{items:Array<{key:string,label:string,n:number}>, total?:number, fmt?:Function, label?:string}} props
 */
export function RankBars({ items = [], total, fmt = nf, label = '' }) {
  const max = Math.max(1, ...items.map((i) => num(i && i.n) || 0));
  return (
    <div className="ap-rkl" role="group" aria-label={label || undefined}>
      {items.map((it, k) => {
        const v = num(it.n) || 0;
        const share = total > 0 ? v / total : null;
        return (
          <div className="ap-rk" key={it.key ?? k}>
            <span className="ap-rk-l">{it.label}</span>
            <span className="ap-rk-v">
              {fmt(v)}
              {share != null && <small>{v > 0 && share < 0.01 ? '<1%' : pc(share)}</small>}
            </span>
            <span className="ap-rk-b" aria-hidden="true"><i className={k === 0 ? 'on' : undefined} style={{ width: `${P((v / max) * 100)}%` }} /></span>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Lollipop ---------- */

/**
 * Lollipops on a 0..yMax axis (a rate per group), each with its group name and
 * a sub line (the group's size) under it. The `on` item is emphasised in ink.
 * @param {{items:Array<{key:string,label:string,sub:string,v:number|null,on:boolean}>, yMax?:number, label?:string}} props
 */
export function Lollipop({ items = [], yMax = 0.5, label = '' }) {
  const h = 170;
  const T = 30;
  const B = 38;
  const L = GUT;
  const n = Math.max(1, items.length);
  const slot = (W - L) / n;
  const Y = (v) => T + (h - T - B) * (1 - clamp(v / yMax, 0, 1));
  return (
    <div className="ap-chart">
      <svg className="ap-ch ap-noscrub" viewBox={`0 0 ${W} ${h}`} role="img" aria-label={label}>
        {[0, 0.5, 1].map((fr) => (
          <g key={fr}>
            <line className={cx('ap-gl', fr === 0 && 'base')} x1={L} x2={W} y1={P(Y(fr * yMax))} y2={P(Y(fr * yMax))} />
            {fr !== 0 && <text className="ap-yt" x={L - 7} y={P(Y(fr * yMax) + 3.5)} textAnchor="end">{pc(fr * yMax)}</text>}
          </g>
        ))}
        {items.map((it, i) => {
          const x = L + slot * i + slot / 2;
          const v = num(it && it.v);
          return (
            <g key={it.key ?? i} className={it.on ? 'ap-lol on' : 'ap-lol'}>
              {v != null && (
                <>
                  <path className="ap-lstem" d={`M${P(x)},${P(Y(0))}V${P(Y(v))}`} />
                  <circle className="ap-lcirc" cx={P(x)} cy={P(Y(v))} r={it.on ? 6 : 4.5} />
                  <text className="ap-lv" x={P(x)} y={P(Y(v) - 11)} textAnchor="middle">{pc(v)}</text>
                </>
              )}
              {v == null && <text className="ap-xt" x={P(x)} y={P(Y(0) - 8)} textAnchor="middle">no data</text>}
              <text className="ap-xb" x={P(x)} y={h - 22} textAnchor="middle">{it.label}</text>
              <text className="ap-xt" x={P(x)} y={h - 9} textAnchor="middle">{it.sub}</text>
            </g>
          );
        })}
      </svg>
      <SrTable label={label} rows={items.map((it) => [`${it.label} (${it.sub})`, num(it.v) == null ? 'no data' : pc(it.v)])} />
    </div>
  );
}

/* ---------- Ladder ---------- */

/**
 * A funnel as steps: a label, the count, a bar against the first step, and how
 * many came from the step before. Under 15 people at the step before, counts
 * are shown, not a percentage. The last step is ink.
 * @param {{steps:Array<{label:string,n:number}>, label?:string}} props
 */
export function Ladder({ steps = [], label = '' }) {
  const top = Math.max(1, num(steps[0] && steps[0].n) || 0);
  return (
    <div className="ap-lad" role="group" aria-label={label || undefined}>
      {steps.map((s, i) => {
        const v = num(s && s.n);
        const prev = i ? num(steps[i - 1].n) : null;
        let note = '';
        if (i && v != null && prev != null && prev > 0) note = prev >= 15 ? `${pc(v / prev)} of the step before` : `${v} of ${prev} from the step before`;
        const w = v == null ? 0 : (v / top) * 100;
        return (
          <div key={i}>
            <span className="ap-lad-t">{s.label}</span>
            <span className="ap-lad-v">{nf(v)}</span>
            <span className="ap-lad-bar" aria-hidden="true"><i className={i === steps.length - 1 ? 'on' : undefined} style={{ width: `${w >= 1.2 ? P(w) : 0.8}%` }} /></span>
            {note && <span className="ap-lad-step">{note}</span>}
          </div>
        );
      })}
    </div>
  );
}

/* ---------- SplitBar / PaceBar ---------- */

/**
 * One bar split into parts, 2px apart, with each part's count and name under
 * it. Parts marked `on` are ink, the rest grey.
 * @param {{parts:Array<{label:string,n:number,on:boolean}>, label?:string}} props
 */
export function SplitBar({ parts = [], label = '' }) {
  const total = parts.reduce((s, p) => s + (num(p && p.n) || 0), 0);
  const summary = parts.map((p) => `${nf(num(p.n) || 0)} ${p.label}`).join(', ');
  return (
    <div className="ap-splitwrap">
      <div className="ap-split" role="img" aria-label={label ? `${label}: ${summary}` : summary}>
        {parts.map((p, i) => {
          const v = num(p && p.n) || 0;
          return v > 0 ? <i key={i} className={p.on ? 'on' : undefined} style={{ flexGrow: v }} /> : null;
        })}
        {total === 0 && <i className="empty" style={{ flexGrow: 1 }} />}
      </div>
      <div className="ap-splitl" aria-hidden="true">
        {parts.map((p, i) => <span key={i}><b>{nf(num(p && p.n) || 0)}</b>{p.label}</span>)}
      </div>
    </div>
  );
}

/**
 * A short bar for "today so far against a usual day". `frac` is 0..1 (more is clamped to full).
 * @param {{frac:number}} props
 */
export function PaceBar({ frac }) {
  const v = clamp(num(frac) ?? 0, 0, 1);
  return (
    <div className="ap-tbar" role="img" aria-label={`${Math.round(v * 100)}% of a usual day`}>
      <i style={{ width: `${P(v * 100)}%` }} />
    </div>
  );
}

/* ---------- Segmented ---------- */

/**
 * The pricing page's segmented control: a pill group, the selected option on
 * --soleil-soft with gold text. Each button is at least 44 px tall.
 * @param {{options:Array<{id:string,label:string}>, value:string, onChange:(id:string)=>void, label:string}} props
 */
export function Segmented({ options = [], value, onChange, label }) {
  return (
    <div className="ap-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button type="button" key={o.id} className="ap-chip" aria-pressed={o.id === value} onClick={() => onChange && onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

/* ---------- Figure / Section / NumStats / DeltaText ---------- */

const Chev = () => (
  <svg className="ap-chev ap-fchev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
);

/**
 * A numbered figure: eyebrow "Figure N · Topic", a headline and (when it
 * opens something) a chevron, a dek, the chart, and an honest caption. The
 * header row is a <button> only when `onOpen` is given; the chart is never
 * inside it, so dragging a chart never navigates.
 * @param {{n:number|string, topic?:string, title:string, dek?:string, note?:string, onOpen?:()=>void, children?:any}} props
 */
export function Figure({ n, topic, title, dek, note, onOpen, children }) {
  const head = (
    <>
      <span className="ap-fn">{`Figure ${n}${topic ? ` · ${topic}` : ''}`}</span>
      {onOpen
        ? <span className="ap-ft">{title}<Chev /></span>
        : <h3 className="ap-ft">{title}</h3>}
      {dek ? <span className="ap-dek">{dek}</span> : null}
    </>
  );
  return (
    <figure className="ap-f ap-pan">
      {onOpen
        ? <button type="button" className="ap-fh ap-fh-go" onClick={onOpen}>{head}</button>
        : <div className="ap-fh">{head}</div>}
      {children}
      {note ? <figcaption className="ap-fcap">{note}</figcaption> : null}
    </figure>
  );
}

/**
 * A section heading: an <h2> whose name is the title alone, with the optional
 * `more` text as a <small> sibling after it (not inside the heading).
 * @param {{title:string, more?:string}} props
 */
export function Section({ title, more }) {
  return (
    <div className="ap-sect">
      <h2><span>{title}</span></h2>
      {more ? <small>{more}</small> : null}
    </div>
  );
}

/**
 * Number tiles. `tone` ('bad' | 'good') tints a value that needs saying; most tiles have none.
 * @param {{items:Array<{value:string|number,label:string,sub?:string,tone?:string}>, cols?:number}} props
 */
export function NumStats({ items = [], cols = 2 }) {
  return (
    <div className={`ap-ns ap-c${cols}`}>
      {items.map((it, i) => (
        <div key={i}>
          <b className={it.tone ? `ap-t-${it.tone}` : undefined}>{it.value}</b>
          <span>{it.label}</span>
          {it.sub ? <em>{it.sub}</em> : null}
        </div>
      ))}
    </div>
  );
}

/**
 * The ▲ / ▼ text of a Delta in the palette's green / pink (flat in ink-2).
 * The glyph is part of delta.text, so colour is never the only signal.
 * @param {{delta?:{text:string,dir:'up'|'down'|'flat'}}} props
 */
export function DeltaText({ delta }) {
  if (!delta || !delta.text) return null;
  return <span className={`ap-d ${delta.dir === 'up' || delta.dir === 'down' ? delta.dir : 'flat'}`}>{delta.text}</span>;
}
