// The search pages' art in the logo's feel, not the logo (owner, 2026-10-29:
// "the same VIBE as that logo graphic … it doesn't actually need to be the
// graphic itself"; picked look B, "Orbits"). Built from the mark's parts:
//
//   - suns drawn the way the mark draws them: an orange disc, a deeper-orange
//     shade inside it and a cream disc over its edge, all along one direction,
//     in the mark's own proportions (lib/sunMark.js G.big/small/med);
//   - its thick dashed ring, opened into an ellipse around the board (open at
//     the right, like the mark), with fine dotted orbits outside it.
//
// The suns ride the orbits. Each sits at its final place in the markup; a
// SMIL <animateMotion begin="indefinite"> glides it the last ~55° into that
// place, and only script ever starts it (SunStage.jsx), so without script or
// under reduced motion the picture is simply still. The art sits behind the
// board's cards and never covers one: the cards are the real board.
//
// Drawn by components/public/SunStage.jsx (the stage) and
// scripts/generate-og.mjs (link previews). Pure, so node tests pin it.

export const SUN_COLORS = { orange: '#ffa500', shade: '#ef7300', cream: '#fffaf0' };

// Each look, in its own box ([w, h] user units):
//   c, tilt     the orbits' shared centre and tilt (deg)
//   orbits      [rx, ry, from°, to°, stroke width, dasharray, opacity]; the
//               first is the mark's thick ring, the rest fine dotted orbits.
//               Angles are clockwise from 3 o'clock.
//   suns        [orbit, at°, r, cream direction°]
//   glow        [cx, cy, r, strength]
//
// full / phone: the stage box itself (1120×600, 358×300, as in landingStage.js
// FULL_LAYOUT.box). behind / behindPhone: centred on the browser frame, the
// frame being `frame` units wide (desktop 912, phone 358), so the art scales
// with it. Sized so the ring peeks a little past the frame's top and bottom
// and stays inside the band's bottom margin; sideways the stylesheet cuts it
// off just inside the window (on phones the ring is a sliver either side of
// the frame). og: the 1200×630 link preview.
export const ORBIT_ART = {
  full: {
    box: [1120, 600], c: [595, 292], tilt: -9,
    orbits: [[330, 192, 32, 328, 13, '40 15', 0.92], [452, 258, 0, 359.5, 2.5, '2 11', 0.48], [548, 292, 186, 354, 1.5, '1 9', 0.26]],
    suns: [[0, 10, 50, -60], [1, 200, 30, -110], [1, 290, 19, -60], [2, 122, 12, -60]],
    glow: [595, 292, 588, 0.2],
  },
  phone: {
    box: [358, 300], c: [190, 150], tilt: -9,
    orbits: [[152, 98, 32, 328, 7, '18 8', 0.92], [186, 132, 0, 359.5, 2, '2 9', 0.48]],
    suns: [[0, 8, 20, -60], [0, 196, 13, -110], [1, 292, 9, -60]],
    glow: [190, 150, 242, 0.2],
  },
  behind: {
    box: [1400, 900], frame: 912, c: [700, 450], tilt: -7,
    orbits: [[548, 300, 0, 359.5, 12, '40 15', 0.9], [628, 318, 0, 359.5, 2.5, '2 11', 0.45]],
    suns: [[0, 14, 44, -60], [0, 166, 30, -120], [1, 210, 16, -60]],
    glow: [980, 330, 420, 0.2],
  },
  behindPhone: {
    box: [460, 400], frame: 358, c: [230, 200], tilt: -7,
    orbits: [[184, 162, 0, 359.5, 6, '16 7', 0.9]],
    suns: [[0, 102, 13, -60], [0, 262, 8, -120]],
    glow: [300, 150, 200, 0.18],
  },
  og: {
    box: [1200, 630], c: [925, 322], tilt: -9,
    orbits: [[245, 165, 32, 328, 11, '36 14', 0.92], [335, 222, 0, 359.5, 2.5, '2 11', 0.48]],
    suns: [[0, -32, 38, -60], [1, 250, 22, -60], [1, 62, 14, -110]],
    glow: [925, 322, 435, 0.2],
  },
};

const n = (v) => Number(v.toFixed(1));
const rad = (d) => (d * Math.PI) / 180;

// The point at angle t (deg, clockwise from 3 o'clock) on an ellipse.
export function orbitPoint([cx, cy], rx, ry, tilt, t) {
  const x = rx * Math.cos(rad(t)), y = ry * Math.sin(rad(t)), k = rad(tilt);
  return [cx + x * Math.cos(k) - y * Math.sin(k), cy + x * Math.sin(k) + y * Math.cos(k)];
}

// The arc of an ellipse from a0 to a1, clockwise. A full turn stops short of
// 360: an arc whose ends meet draws nothing.
export function orbitPath(c, rx, ry, tilt, a0, a1) {
  const p0 = orbitPoint(c, rx, ry, tilt, a0), p1 = orbitPoint(c, rx, ry, tilt, a1);
  return `M${n(p0[0])} ${n(p0[1])}A${rx} ${ry} ${tilt} ${a1 - a0 > 180 ? 1 : 0} 1 ${n(p1[0])} ${n(p1[1])}`;
}

// A sun as the mark draws one, centred on (cx, cy). `id` names its clip.
export function sunSvg(cx, cy, r, ang, id, C = SUN_COLORS) {
  const ux = Math.cos(rad(ang)), uy = Math.sin(rad(ang));
  return `<clipPath id="${id}"><circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}"/></clipPath>`
    + `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${C.orange}"/>`
    + `<circle cx="${n(cx + ux * 0.37 * r)}" cy="${n(cy + uy * 0.37 * r)}" r="${n(0.6 * r)}" fill="${C.shade}" clip-path="url(#${id})"/>`
    + `<circle cx="${n(cx + ux * 0.85 * r)}" cy="${n(cy + uy * 0.85 * r)}" r="${n(0.79 * r)}" fill="${C.cream}"/>`;
}

const SWEEP = 55;     // how far (deg) each sun glides into place
const GLIDE = 2.4;    // seconds

// The inside of an <svg viewBox="0 0 w h"> for one look. `id` prefixes every
// element id, so two pieces of art on one page never share one. `motion`
// false leaves the glides out (the link preview is a still).
export function orbitArtSvg(kind, { id = `oa${kind}`, motion = true } = {}) {
  const A = ORBIT_ART[kind];
  if (!A) return '';
  const { c, tilt, orbits, suns, glow } = A;
  const [gx, gy, gr, ga] = glow;
  const parts = [
    `<radialGradient id="${id}g"><stop offset="0" stop-color="#ffa028" stop-opacity="${ga}"/>`
      + `<stop offset=".55" stop-color="#ff8c14" stop-opacity="${n(ga * 0.3 * 1000) / 1000}"/>`
      + `<stop offset="1" stop-color="#ff8c14" stop-opacity="0"/></radialGradient>`
      + `<circle class="glow" cx="${gx}" cy="${gy}" r="${gr}" fill="url(#${id}g)"/>`,
  ];
  orbits.forEach(([rx, ry, a0, a1, w, dash, op], i) => {
    parts.push(`<path class="arc" style="--i:${i}" d="${orbitPath(c, rx, ry, tilt, a0, a1)}" fill="none" stroke="${SUN_COLORS.cream}" stroke-width="${w}" stroke-dasharray="${dash}" opacity="${op}"/>`);
  });
  suns.forEach(([o, t, r, ang], i) => {
    const [rx, ry] = orbits[o];
    const p = orbitPoint(c, rx, ry, tilt, t);
    const delay = 0.35 + i * 0.16;
    let glide = '';
    if (motion) {
      // The path runs from SWEEP degrees back along the orbit to the sun's
      // own place, relative to it (animateMotion adds to the transform), so
      // a frozen end leaves the sun exactly where the markup put it. It holds
      // at the start for `delay`, while the CSS fade waits the same time.
      const p0 = orbitPoint(c, rx, ry, tilt, t - SWEEP);
      const hold = n((delay / (delay + GLIDE)) * 1000) / 1000;
      glide = `<animateMotion dur="${n(delay + GLIDE)}s" begin="indefinite" fill="freeze" calcMode="spline" keyTimes="0;${hold};1" keyPoints="0;0;1" keySplines="0 0 1 1;.2 .7 .2 1" path="M${n(p0[0] - p[0])} ${n(p0[1] - p[1])}A${rx} ${ry} ${tilt} 0 1 0 0"/>`;
    }
    parts.push(`<g class="orb" style="--d:${n(delay)}s" transform="translate(${n(p[0])} ${n(p[1])})"><g>${sunSvg(0, 0, r, ang, `${id}s${i}`)}${glide}</g></g>`);
  });
  return parts.join('');
}

// The art's width as a share of what it is drawn against: the stage box for
// full/phone/og, the browser frame for behind/behindPhone (in %).
export function orbitArtWidth(kind) {
  const A = ORBIT_ART[kind];
  return A ? n((A.box[0] / (A.frame || A.box[0])) * 100 * 100) / 100 : 0;
}
