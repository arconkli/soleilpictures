// The board's ground: dots at every scale under very faint lines, drawn on a
// canvas in the same frame as the camera. The owner picked it from a live
// prototype (2026-10-19, artifact SZrJU72VWsUwSvKen45yaA: "Depth" dots with
// "Structured"'s lines, "just very faint grid lines").
//
// Why a canvas: the CSS ground it replaces was positioned from the camera as
// last committed to React state, which happens ~140ms after a gesture ends, so
// the dots froze while the cards moved and then jumped into place; and its
// spacing shrank with the zoom until, zoomed out, it was a dense mesh.
//
// The lattice: dots sit at multiples of GROUND_STEPS (world units, four times
// apart). A step fades in as its dots get DOT_FADE screen px apart and then
// stays, so the coarser steps stack on the points they share and the dots that
// mark bigger distances read brighter. Dots grow a little as you zoom in. Lines
// run through the dots of a coarser step, each step of lines fading in over
// LINE_FADE and handing over to the next as you zoom, so there is one faint
// square grid at a time. Colours are the theme's --grid-dot and --grid-line.

export const GROUND_STEPS = [5, 20, 80, 320, 1280, 5120, 20480];
const DOT_FADE = [9, 18];
const LINE_FADE = [40, 80];
// Sparser than this, a step puts a dot or a line or two on screen: skip it.
// Dots fade out over the last half of the way there, so nothing pops.
const MAX_DOT_SPACING = 2400;
const MAX_LINE_SPACING = 4000;
// A step with more dots than this on screen is tiled as one pattern fill;
// sparser steps are drawn dot by dot. A pattern fill costs the whole canvas
// whatever the spacing (about 9ms at 2x on a CPU-rastered canvas), dots cost
// about 1ms per 800, so only the densest step in view is ever a pattern.
const DENSE = 2500;
// Pattern tiles come in 24 sizes per doubling, so a zoom reuses them instead of
// making a new one every frame; the pattern's transform makes up the rest.
const TILE_STEPS_PER_OCTAVE = 24;
const tileSize = (sDev) => Math.max(4, Math.round(2 ** (Math.round(Math.log2(sDev) * TILE_STEPS_PER_OCTAVE) / TILE_STEPS_PER_OCTAVE)));

export function smoothstep(a, b, v) {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// A dot's radius in screen px: 1 at 100%, a little smaller zoomed out and a
// little bigger zoomed in.
export function dotRadius(z) {
  return Math.min(1.45, Math.max(0.7, 1 + 0.22 * Math.log2(z)));
}

// The dot steps on screen at zoom z, finest first: { step, s (screen px
// apart), a (0..1), r (screen px) }. A coarser step's dots are a fifth bigger
// than the next finer one's, so the big-distance points read as such.
export function dotLevels(z) {
  const out = [];
  let finest = -1;
  for (let i = 0; i < GROUND_STEPS.length; i++) {
    const s = GROUND_STEPS[i] * z;
    if (s > MAX_DOT_SPACING) break;
    const a = smoothstep(DOT_FADE[0], DOT_FADE[1], s) * (1 - smoothstep(MAX_DOT_SPACING / 2, MAX_DOT_SPACING, s));
    if (a <= 0.004) continue;
    if (finest < 0) finest = i;
    out.push({ step: GROUND_STEPS[i], s, a, r: dotRadius(z) * (1 + 0.2 * (i - finest)) });
  }
  return out;
}

// The line steps on screen at zoom z: { step, s, a }. A step's lines fade in
// as they get LINE_FADE px apart and fade out as the next finer step's lines
// arrive, so the grid changes scale without ever doubling up.
export function lineLevels(z) {
  const out = [];
  for (let i = 1; i < GROUND_STEPS.length; i++) {
    const s = GROUND_STEPS[i] * z;
    if (s > MAX_LINE_SPACING) break;
    const v = smoothstep(LINE_FADE[0], LINE_FADE[1], s);
    if (v <= 0) continue;
    const a = v * (1 - smoothstep(LINE_FADE[0], LINE_FADE[1], GROUND_STEPS[i - 1] * z));
    if (a > 0.004) out.push({ step: GROUND_STEPS[i], s, a });
  }
  return out;
}

// "rgba(245,245,247,.05)" / "rgb(10 10 12 / 7%)" / "#fff" → { rgb: '245,245,247', a: 0.05 }.
export function parseColor(str) {
  const v = String(str || '').trim();
  let m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+)(%)?)?\s*\)$/i.exec(v);
  if (m) {
    let a = m[4] == null ? 1 : Number(m[4]);
    if (m[5]) a /= 100;
    return { rgb: `${Math.round(m[1])},${Math.round(m[2])},${Math.round(m[3])}`, a };
  }
  m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (m) {
    const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
    return { rgb: `${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)}`, a: 1 };
  }
  return null;
}

const mod = (a, n) => ((a % n) + n) % n;

// One painter per canvas: it keeps the small dot tiles it has made.
// view: { width, height (CSS px), dpr, x, y, z (the camera: screen = world·z +
// (x, y)), dot, line ({ rgb, a } from parseColor) }.
export function createGroundPainter(makeCanvas = () => document.createElement('canvas')) {
  const tiles = new Map();
  const tile = (T, rDev, rgb) => {
    const key = `${T}|${rDev}|${rgb}`;
    let c = tiles.get(key);
    if (c) return c;
    if (tiles.size > 48) tiles.clear();
    c = makeCanvas();
    c.width = T; c.height = T;
    const g = c.getContext('2d');
    g.fillStyle = `rgb(${rgb})`;
    g.beginPath(); g.arc(T / 2, T / 2, rDev, 0, Math.PI * 2); g.fill();
    tiles.set(key, c);
    return c;
  };

  return {
    draw(ctx, { width, height, dpr, x, y, z, dot, line }) {
      const W = width * dpr, H = height * dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (!(z > 0) || !width || !height) return;
      if (line && line.a > 0) {
        ctx.fillStyle = `rgb(${line.rgb})`;
        for (const lv of lineLevels(z)) {
          ctx.globalAlpha = lv.a * line.a;
          // One device px wide, on whole device px: as faint as a line can be.
          for (let sx = mod(x, lv.s); sx < width; sx += lv.s) ctx.fillRect(Math.round(sx * dpr), 0, 1, H);
          for (let sy = mod(y, lv.s); sy < height; sy += lv.s) ctx.fillRect(0, Math.round(sy * dpr), W, 1);
        }
      }
      if (dot && dot.a > 0) {
        for (const lv of dotLevels(z)) {
          ctx.globalAlpha = lv.a * dot.a;
          const rDev = lv.r * dpr, sDev = lv.s * dpr;
          const ox = mod(x, lv.s), oy = mod(y, lv.s);
          if ((width / lv.s + 1) * (height / lv.s + 1) > DENSE) {
            // The tile is drawn a k-th smaller and scaled up by k, so the dot
            // comes out at its true radius (to a quarter device px).
            const T = tileSize(sDev), k = sDev / T;
            const pattern = ctx.createPattern(tile(T, Math.round((rDev / k) * 4) / 4, dot.rgb), 'repeat');
            pattern.setTransform(new DOMMatrix([k, 0, 0, k, (ox - lv.s / 2) * dpr, (oy - lv.s / 2) * dpr]));
            ctx.fillStyle = pattern;
            ctx.fillRect(0, 0, W, H);
          } else {
            ctx.fillStyle = `rgb(${dot.rgb})`;
            ctx.beginPath();
            for (let sx = ox; sx < width + lv.s; sx += lv.s) {
              for (let sy = oy; sy < height + lv.s; sy += lv.s) {
                ctx.moveTo(sx * dpr + rDev, sy * dpr);
                ctx.arc(sx * dpr, sy * dpr, rDev, 0, Math.PI * 2);
              }
            }
            ctx.fill();
          }
        }
      }
      ctx.globalAlpha = 1;
    },
  };
}

// The live camera of an element mid CSS transition: its computed transform.
// "matrix(a, b, c, d, e, f)" or "matrix3d(…)" → { x, y, z }.
export function cameraFromTransform(transform) {
  const t = String(transform || '');
  let m = /^matrix\(([^)]+)\)$/.exec(t);
  if (m) {
    const p = m[1].split(',').map(Number);
    return p.length === 6 && p.every(Number.isFinite) ? { z: p[0], x: p[4], y: p[5] } : null;
  }
  m = /^matrix3d\(([^)]+)\)$/.exec(t);
  if (m) {
    const p = m[1].split(',').map(Number);
    return p.length === 16 && p.every(Number.isFinite) ? { z: p[0], x: p[12], y: p[13] } : null;
  }
  return null;
}

// A mouse wheel's click rather than a trackpad's stream of small fractional
// deltas, which is smooth already: whole lines (Firefox), a big whole-pixel
// step (Chrome and Edge on Windows and Linux: 100 or 120 a click), or a
// multiple of the 4.000244140625px step Chrome on a Mac gives a wheel's click.
const MAC_WHEEL_STEP = 4.000244140625;
export function isWheelClick(e) {
  if (!e) return false;
  if (e.deltaMode === 1) return true;
  const d = Math.abs(e.deltaY);
  if (d >= 40 && Number.isInteger(d)) return true;
  const q = d / MAC_WHEEL_STEP;
  return d >= MAC_WHEEL_STEP && Math.abs(q - Math.round(q)) < 1e-6;
}

// Where a wheel click's glide is `elapsed` ms after it began, from zoom `from`
// to `to`: an ease-out over GLIDE_MS, in log space so zooming in and out feel
// the same, landing exactly on `to`. A click mid-glide starts a new glide from
// wherever the zoom has got to, toward the two clicks' combined target.
export const GLIDE_MS = 160;
export function glideZoom(from, to, elapsed) {
  const t = Math.min(1, Math.max(0, elapsed / GLIDE_MS));
  if (t >= 1) return to;
  const e = 1 - Math.pow(1 - t, 3);
  return Math.exp(Math.log(from) + (Math.log(to) - Math.log(from)) * e);
}
