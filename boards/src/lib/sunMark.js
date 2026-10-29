// The Clusters mark as vectors, big: three suns and the dashed C, for the
// search pages' sun stage (components/public/SunStage.jsx) and the link
// previews (scripts/generate-og.mjs).
//
// The only source of the mark is a 2048 px PNG (public/clusters-logo-*.png);
// these numbers were fitted to it in the marketing graphics lab
// (~/soleil-social/lab/gfx/lib/mark.mjs, which this mirrors). The ring is
// thicker at the top-left than the bottom-right (its edges are circles with
// different centres), and its top end tapers to a point inside the small sun.
// Everything is in the mark's own 2048-unit box. Pure, so node can test it.

const G = {
  inner: [1148.7, 942.7, 568.7], outer: [1123.9, 926.7, 634.9], mid: [1137.4, 933.8],
  dashes: [[77.75, 92.25], [100.75, 116.75], [124.5, 140.5], [205, 218], [225.75, 238.5], [248.25, 260.5], [269.5, 281.5], [290, 301.25]],
  wedge: [68.25, 46.6],
  big: { o: [508, 925.3, 392.2], sh: [467.6, 789.2, 234.2], cr: [434, 600.3, 308.7] },
  small: { o: [1595.2, 448.4, 224.8], sh: [1664.2, 398.7, 136.7], cr: [1742.8, 326.8, 177] },
  med: { o: [1616.6, 1484.4, 321.9], sh: [1689.4, 1391.2, 193.2], cr: [1771.5, 1258.7, 253.4] },
};

// The ring's middle, for centring things on the mark.
export const MARK_MID = G.mid;
export const MARK_COLORS = { orange: '#ffa500', shadow: '#ef7300', cream: '#fffaf0', ink: '#fffaf0' };

const f = (n) => n.toFixed(2);
// Where the ray from the ring's middle at `deg` (counter-clockwise from 3
// o'clock) meets circle c.
function hit(c, deg) {
  const [mx, my] = G.mid, t = (deg * Math.PI) / 180, ux = Math.cos(t), uy = -Math.sin(t);
  const dx = mx - c[0], dy = my - c[1], b = ux * dx + uy * dy, k = b * b - (dx * dx + dy * dy - c[2] * c[2]);
  const s = -b + Math.sqrt(k);
  return [mx + s * ux, my + s * uy];
}
function dashPath([a0, a1]) {
  const [o0, o1, i1, i0] = [hit(G.outer, a0), hit(G.outer, a1), hit(G.inner, a1), hit(G.inner, a0)];
  return `M${f(o0[0])} ${f(o0[1])}A${G.outer[2]} ${G.outer[2]} 0 0 0 ${f(o1[0])} ${f(o1[1])}L${f(i1[0])} ${f(i1[1])}A${G.inner[2]} ${G.inner[2]} 0 0 1 ${f(i0[0])} ${f(i0[1])}Z`;
}
function wedgePath() {
  const [a0, a1] = G.wedge, pi = hit(G.inner, a0), po = hit(G.outer, a0), tip = hit(G.outer, a1);
  const t = (a0 * Math.PI) / 180, tx = Math.sin(t), ty = Math.cos(t), d = Math.hypot(tip[0] - pi[0], tip[1] - pi[1]) * 0.4;
  const k = [pi[0] + tx * d, pi[1] + ty * d];
  return `M${f(pi[0])} ${f(pi[1])}L${f(po[0])} ${f(po[1])}A${G.outer[2]} ${G.outer[2]} 0 0 1 ${f(tip[0])} ${f(tip[1])}Q${f(k[0])} ${f(k[1])} ${f(pi[0])} ${f(pi[1])}Z`;
}
const disc = (c, fill, extra = '') => `<circle cx="${c[0]}" cy="${c[1]}" r="${c[2]}" fill="${fill}"${extra}/>`;
const sun = (s, C, id) =>
  `<clipPath id="${id}"><circle cx="${s.o[0]}" cy="${s.o[1]}" r="${s.o[2]}"/></clipPath>${disc(s.o, C.orange, ' class="sun"')}${disc(s.sh, C.shadow, ` clip-path="url(#${id})"`)}`;

// The inside of an <svg viewBox="0 0 2048 2048">: the right suns, the ring,
// the right creams, then the big sun on top (the logo's own stacking). `id`
// prefixes the clip-path ids, so two marks on one page never share one.
export function sunMarkSvg({ id = 'sunmk', colors = MARK_COLORS } = {}) {
  const C = colors;
  return [
    sun(G.small, C, `${id}s`) + sun(G.med, C, `${id}m`),
    `<g class="ring" fill="${C.ink}">${G.dashes.map((d) => `<path d="${dashPath(d)}"/>`).join('')}<path d="${wedgePath()}"/></g>`,
    disc(G.small.cr, C.cream, ' class="cream"') + disc(G.med.cr, C.cream, ' class="cream"'),
    sun(G.big, C, `${id}b`) + disc(G.big.cr, C.cream, ' class="cream"'),
  ].join('');
}
