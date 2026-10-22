// universeMomentFx — the light the Universe's moments are drawn in.
//
// One instanced draw of camera-facing quads, three shapes: a soft glow (the
// mockup's radial sprite), a ring of constant pixel width, and a line segment
// of constant pixel width. Every flare, ring, spark, arc, comet and halo is
// built from those.
//
// Why not the renderer's own FX points: a point sprite stops growing at the
// GPU's point-size ceiling (511 device pixels on Apple's GPUs), and a new
// account's ring zoomed into by the director is wider than that, so it would
// freeze mid-expansion as a clipped square. A quad has no ceiling.
//
// Why drawn after bloom, straight to the canvas: these are the mockup's
// effects, picked as they looked, and the mockup drew them additively in
// display colour over a picture of this very universe. Drawn into the scene,
// bloom would smear every ring into a halo and wash the hues toward white; and
// the composer works in linear light, where a glow at 30% is about twice as
// bright as the same glow on a canvas. So they go on top of the finished frame,
// with raw display-colour values and the canvas's own additive rule, and look
// the way they were chosen.
//
// Sizes are the mockup's pixels at the wide view. A size in world units is
// pixels × `unit`, the world size of one CSS pixel at the wide view's distance,
// so a flare is 34px across seen from there and grows as the camera closes in,
// exactly as the mockup's did when it zoomed. Line widths grow with the square
// root of the zoom, also as the mockup's did.

import * as THREE from 'three';
import {
  MOMENT_HUE, WARM, GOLD, SPIKE, TOGETHER, VISIT, COMET_HEAD, WHITE,
  clamp01, ease, inout,
} from '../../lib/universeMoments.js';

export const MOMENT_FX_CAP = 4096;

const SHAPE_GLOW = 0, SHAPE_RING = 1, SHAPE_SEG = 2;

const vertexShader = /* glsl */`
  uniform float uPxPerUnit;   // device px per world unit at view depth 1
  uniform float uDpr;
  uniform float uWide;        // the wide view's distance, for line widths
  uniform vec2  uViewport;    // drawing buffer, device px
  attribute vec3  iA;
  attribute vec3  iB;
  attribute vec3  iCol;
  attribute float iAlpha;
  attribute vec2  iSize;
  attribute float iShape;
  attribute float iRot;
  varying vec3  vCol;
  varying float vAlpha;
  varying vec2  vUv;
  varying float vShape;
  varying float vR;
  varying float vLw;
  varying float vExt;
  float lineWidthPx(float lwCss, float depth) {
    return lwCss * uDpr * sqrt(uWide / max(depth, 1.0));
  }
  void main() {
    vCol = iCol; vAlpha = iAlpha; vShape = iShape; vUv = position.xy;
    vR = 0.0; vLw = 1.0; vExt = 1.0;
    vec4 mvA = modelViewMatrix * vec4(iA, 1.0);
    float depthA = -mvA.z;
    if (iShape < 1.5) {
      if (depthA < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
      vec2 ext = iSize;
      if (iShape > 0.5) {
        float lw = lineWidthPx(iSize.y, depthA);
        float rPx = iSize.x * uPxPerUnit / depthA;
        float extPx = rPx + lw * 0.5 + 1.5;
        vR = rPx; vLw = lw; vExt = extPx;
        float extW = extPx * depthA / uPxPerUnit;
        ext = vec2(extW, extW);
      }
      float c = cos(iRot);
      float s = sin(iRot);
      vec2 corner = vec2(position.x * ext.x, position.y * ext.y);
      corner = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y);
      gl_Position = projectionMatrix * (mvA + vec4(corner, 0.0, 0.0));
    } else {
      vec4 mvB = modelViewMatrix * vec4(iB, 1.0);
      float depthB = -mvB.z;
      if (depthA < 0.5 || depthB < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
      vec4 cA = projectionMatrix * mvA;
      vec4 cB = projectionMatrix * mvB;
      vec2 sA = cA.xy / cA.w * 0.5 * uViewport;
      vec2 sB = cB.xy / cB.w * 0.5 * uViewport;
      vec2 d = sB - sA;
      float len = length(d);
      vec2 dir = len > 0.0001 ? d / len : vec2(1.0, 0.0);
      vec2 nrm = vec2(-dir.y, dir.x);
      float lw = lineWidthPx(iSize.x, 0.5 * (depthA + depthB));
      float hw = lw * 0.5 + 1.0;
      float t = position.x * 0.5 + 0.5;
      vec4 cc = mix(cA, cB, t);
      vec2 sP = mix(sA, sB, t) + nrm * position.y * hw;
      cc.xy = sP / (0.5 * uViewport) * cc.w;
      gl_Position = cc;
      vLw = lw; vExt = hw;
    }
  }
`;

const fragmentShader = /* glsl */`
  varying vec3  vCol;
  varying float vAlpha;
  varying vec2  vUv;
  varying float vShape;
  varying float vR;
  varying float vLw;
  varying float vExt;
  void main() {
    float a;
    if (vShape < 0.5) {
      // The mockup's sprite: a radial gradient stopped at 0, .16, .42 and 1.
      float r = length(vUv);
      if (r >= 1.0) discard;
      a = r < 0.16 ? mix(1.0, 0.6, r / 0.16)
        : r < 0.42 ? mix(0.6, 0.17, (r - 0.16) / 0.26)
        : mix(0.17, 0.0, (r - 0.42) / 0.58);
    } else if (vShape < 1.5) {
      float d = length(vUv) * vExt;
      float w = max(vLw, 1.0) * 0.5;
      a = (1.0 - smoothstep(w - 0.5, w + 0.5, abs(d - vR))) * min(vLw, 1.0);
    } else {
      float d = abs(vUv.y) * vExt;
      float w = max(vLw, 1.0) * 0.5;
      a = (1.0 - smoothstep(w - 0.5, w + 0.5, d)) * min(vLw, 1.0);
    }
    a *= vAlpha;
    if (a <= 0.002) discard;
    gl_FragColor = vec4(vCol, a);
  }
`;

/** The mesh, in a scene of its own that UniverseGraph renders over the frame. */
export function makeMomentLayer(capacity = MOMENT_FX_CAP) {
  const quad = new THREE.PlaneGeometry(2, 2);
  const geom = new THREE.InstancedBufferGeometry();
  geom.index = quad.index;
  geom.setAttribute('position', quad.attributes.position);
  const inst = (size) => {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size);
    a.setUsage(THREE.DynamicDrawUsage);
    return a;
  };
  geom.setAttribute('iA', inst(3));
  geom.setAttribute('iB', inst(3));
  geom.setAttribute('iCol', inst(3));
  geom.setAttribute('iAlpha', inst(1));
  geom.setAttribute('iSize', inst(2));
  geom.setAttribute('iShape', inst(1));
  geom.setAttribute('iRot', inst(1));
  geom.instanceCount = 0;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uPxPerUnit: { value: 600 },
      uDpr: { value: 1 },
      uWide: { value: 1000 },
      uViewport: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geom, material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  return { scene, mesh, capacity, dispose() { geom.dispose(); quad.dispose(); material.dispose(); } };
}

// Display-colour triples, never THREE.Color: that converts sRGB to linear, and
// these are drawn as display values.
const RGB = new Map();
export function rgb(hex) {
  let c = RGB.get(hex);
  if (!c) {
    const h = hex.replace('#', '');
    c = [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
    RGB.set(hex, c);
  }
  return c;
}

/** Writes instances into the layer, one frame at a time. */
export function makePainter(layer) {
  const g = layer.mesh.geometry;
  const A = g.attributes;
  const cap = layer.capacity;
  let n = 0;
  let unit = 1;
  function put(ax, ay, az, bx, by, bz, col, a, sx, sy, shape, rot) {
    const i3 = n * 3, i2 = n * 2;
    A.iA.array[i3] = ax; A.iA.array[i3 + 1] = ay; A.iA.array[i3 + 2] = az;
    A.iB.array[i3] = bx; A.iB.array[i3 + 1] = by; A.iB.array[i3 + 2] = bz;
    A.iCol.array[i3] = col[0]; A.iCol.array[i3 + 1] = col[1]; A.iCol.array[i3 + 2] = col[2];
    A.iAlpha.array[n] = a > 1 ? 1 : a;
    A.iSize.array[i2] = sx; A.iSize.array[i2 + 1] = sy;
    A.iShape.array[n] = shape;
    A.iRot.array[n] = rot;
    n++;
  }
  return {
    begin(u) { n = 0; unit = u; },
    /** A soft glow `w` px across (and `h` tall), turned `rot` on screen. */
    glow(p, col, w, a, h = w, rot = 0) {
      if (a <= 0.004 || w <= 0 || n >= cap) return;
      put(p[0], p[1], p[2], p[0], p[1], p[2], col, a, (w / 2) * unit, (h / 2) * unit, SHAPE_GLOW, rot);
    },
    /** A ring of radius `r` px, `lw` px wide at the wide view. */
    ring(p, col, r, a, lw) {
      if (a <= 0.004 || r <= 0 || n >= cap) return;
      put(p[0], p[1], p[2], p[0], p[1], p[2], col, a, r * unit, lw, SHAPE_RING, 0);
    },
    /** A segment from p to q, `lw` px wide at the wide view. */
    seg(p, q, col, a, lw) {
      if (a <= 0.004 || n >= cap) return;
      put(p[0], p[1], p[2], q[0], q[1], q[2], col, a, lw, 0, SHAPE_SEG, 0);
    },
    get unit() { return unit; },
    end() {
      g.instanceCount = n;
      if (n === 0) return;
      for (const key of ['iA', 'iB', 'iCol', 'iAlpha', 'iSize', 'iShape', 'iRot']) {
        const at = A[key];
        at.clearUpdateRanges();
        at.addUpdateRange(0, n * at.itemSize);
        at.needsUpdate = true;
      }
    },
  };
}

// ── The effects ──────────────────────────────────────────────────────────
// Each is the mockup's, number for number. `f` is the effect, `age` ms since it
// began, `ctx` the frame: where its anchors are now (`ctx.at`), the camera's
// right and up (for anything that radiates in the picture plane), and whether
// motion is reduced (then glows only: no rings expanding, no sparks, no trails).
const WHITE_RGB = rgb(WHITE);
const P0 = [0, 0, 0], P1 = [0, 0, 0], P2 = [0, 0, 0], PB = [0, 0, 0];

function along(out, p, dir, d, unit) {
  out[0] = p[0] + dir[0] * d * unit;
  out[1] = p[1] + dir[1] * d * unit;
  out[2] = p[2] + dir[2] * d * unit;
  return out;
}

function bez(out, a, c, b, t) {
  const u = 1 - t;
  out[0] = u * u * a[0] + 2 * u * t * c[0] + t * t * b[0];
  out[1] = u * u * a[1] + 2 * u * t * c[1] + t * t * b[1];
  out[2] = u * u * a[2] + 2 * u * t * c[2] + t * t * b[2];
  return out;
}

const DRAW = {
  // A card made: the kind's colour, a white core, a ring and eight sparks.
  make(pt, f, age, ctx) {
    const p = ctx.at(f.at, P0);
    const fa = age < 110 ? age / 110 : Math.max(0, 1 - (age - 110) / 750);
    const s = f.s;
    pt.glow(p, f.col, 34 * s, 0.85 * fa);
    pt.glow(p, WHITE_RGB, 9 * s, 0.9 * fa);
    if (ctx.reduced) return;
    if (age < 1300) { const rt = ease(age / 1300); pt.ring(p, f.col, 2 + 24 * s * rt, 0.75 * (1 - rt), 1.4); }
    if (age < 950) {
      const st = age / 950, k = 1 - Math.pow(1 - st, 2.4);
      for (const sp of f.sparks) {
        const d1 = sp.v * k * s, d0 = Math.max(0, d1 - 5 * s * (1 - st) - 1);
        const ca = Math.cos(sp.a), sa = Math.sin(sp.a);
        PB[0] = ctx.right[0] * ca + ctx.up[0] * sa;
        PB[1] = ctx.right[1] * ca + ctx.up[1] * sa;
        PB[2] = ctx.right[2] * ca + ctx.up[2] * sa;
        pt.seg(along(P1, p, PB, d0, pt.unit), along(P2, p, PB, d1, pt.unit), f.col, 0.9 * (1 - st), 1.1);
      }
    }
  },
  // What a made card leaves: a faint glow that takes sixteen seconds to go.
  ember(pt, f, age, ctx) {
    if (age > 700) pt.glow(ctx.at(f.at, P0), f.col, 13, 0.3 * Math.exp(-(age - 700) / 5000));
  },
  // The card's own node arriving where an event already flared: a short blink.
  flash(pt, f, age, ctx) {
    const p = ctx.at(f.at, P0);
    const q = age / f.life;
    pt.glow(p, f.col, 22, 0.7 * (1 - q));
    pt.glow(p, WHITE_RGB, 6, 0.8 * (1 - q));
  },
  // A cluster made (and, softer, a workspace no new account claimed).
  ring(pt, f, age, ctx) {
    const p = ctx.at(f.at, P0);
    const k = f.soft ? 0.7 : 1;
    const rt = ease(age / f.life), fa = age < 140 ? age / 140 : Math.max(0, 1 - (age - 140) / 900);
    pt.glow(p, f.col, 44, 0.8 * fa * k);
    pt.glow(p, WHITE_RGB, 10, 0.8 * fa * k);
    if (ctx.reduced) return;
    pt.ring(p, f.col, 3 + 44 * rt, 0.85 * (1 - rt) * k, 2 - 1.3 * rt);
    pt.ring(p, f.col, 2 + 26 * ease(age / (f.life * 0.8)), 0.4 * (1 - rt) * k, 1);
  },
  // Cards removed: a ring closing in.
  implode(pt, f, age, ctx) {
    const p = ctx.at(f.at, P0);
    const u = age / f.life, a = Math.sin(Math.PI * u) * 0.55;
    if (ctx.reduced) { pt.glow(p, f.col, 14, a * 0.6); return; }
    pt.ring(p, f.col, 2 + 20 * (1 - ease(u)), a, 1.1);
  },
  ping(pt, f, age, ctx) {
    const p = ctx.at(f.at, P0);
    const q = age / f.life;
    pt.ring(p, f.col, 2 + 12 * ease(q), 0.7 * (1 - q), 1);
    pt.glow(p, f.col, 14, 0.5 * (1 - q));
  },
  // A new account: a gold star with diffraction spikes and two rings.
  birth(pt, f, age, ctx) {
    const p = ctx.at(f.at, P0);
    const gold = rgb(GOLD), spike = rgb(SPIKE);
    const a1 = age < 160 ? age / 160 : Math.max(0, 1 - (age - 160) / 2900), grow = 1 - ease(age / 1500);
    pt.glow(p, gold, 46 + 50 * grow, 0.9 * a1);
    pt.glow(p, WHITE_RGB, 14, a1);
    if (ctx.reduced) return;
    if (age < 1900) {
      const sp = 1 - ease(age / 1900), L = 18 + 120 * sp;
      pt.glow(p, spike, L, 0.9 * sp, 3);
      pt.glow(p, spike, 3, 0.9 * sp, L);
      pt.glow(p, gold, L * 0.45, 0.5 * sp, 2.4, Math.PI / 4);
      pt.glow(p, gold, 2.4, 0.5 * sp, L * 0.45, Math.PI / 4);
    }
    if (age < 2500) { const rt = ease(age / 2500); pt.ring(p, gold, 4 + 70 * rt, 0.8 * (1 - rt), 2.2 - 1.5 * rt); }
    if (age > 350 && age < 2900) { const r2 = ease((age - 350) / 2550); pt.ring(p, gold, 3 + 40 * r2, 0.45 * (1 - r2), 1); }
  },
  // Together: a bright head running along a curve from one place to another.
  arc(pt, f, age, ctx) {
    const a = ctx.at(f.at, P0), b = ctx.at(f.b, P1);
    // The bow: a third of the way out from the chord, away from the galaxy's
    // middle, in the plane the chord and the middle make (or the picture's, when
    // the chord points at the middle).
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, mz = (a[2] + b[2]) / 2;
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const L = Math.hypot(dx, dy, dz) || 1;
    let ox = mx - ctx.core[0], oy = my - ctx.core[1], oz = mz - ctx.core[2];
    const along2 = (ox * dx + oy * dy + oz * dz) / (L * L);
    ox -= dx * along2; oy -= dy * along2; oz -= dz * along2;
    let ol = Math.hypot(ox, oy, oz);
    if (ol < L * 1e-3) { ox = ctx.up[0]; oy = ctx.up[1]; oz = ctx.up[2]; ol = 1; }
    const bulge = 0.3 * L / ol;
    const c = PB;
    c[0] = mx + ox * bulge; c[1] = my + oy * bulge; c[2] = mz + oz * bulge;
    const tog = rgb(TOGETHER);
    const travel = Math.min(1700, f.life - 600);
    const h = ctx.reduced ? 1 : inout(age / travel), tail = Math.max(0, h - 0.3);
    const fade = age > travel ? 1 - (age - travel) / (f.life - travel) : 1;
    const N = 16;
    for (let i = 1; i <= N; i++) {
      pt.seg(bez(P2, a, c, b, h * (i - 1) / N), bez(SEG_END, a, c, b, h * i / N), tog, 0.2 * fade, 1.4);
    }
    if (!ctx.reduced && age < travel) {
      for (let i = 1; i <= N; i++) {
        pt.seg(bez(P2, a, c, b, tail + (h - tail) * (i - 1) / N), bez(SEG_END, a, c, b, tail + (h - tail) * i / N), tog, 0.85 * i / N, 1.4);
      }
      const head = bez(P2, a, c, b, h);
      pt.glow(head, tog, 16, 0.9);
      pt.glow(head, WHITE_RGB, 4, 0.9);
    }
    if (age < 600) pt.ring(a, tog, 3 + 12 * ease(age / 600), 0.7 * (1 - age / 600), 1.1);
    if (age > travel && age < travel + 800) {
      const q = (age - travel) / 800;
      pt.ring(b, tog, 3 + 15 * ease(q), 0.8 * (1 - q), 1.2);
      pt.glow(b, tog, 22, 0.6 * (1 - q));
    }
  },
  // A visitor from outside: in from the rim, to the cluster they opened (a
  // share link) or toward the middle, fading (a public page).
  comet(pt, f, age, ctx) {
    const s = ctx.at(f.at, P0), e = ctx.at(f.b, P1);
    const visit = rgb(VISIT);
    const T = f.share ? 2600 : f.life;
    let h = f.share ? inout(age / T) : ease(age / T);
    if (ctx.reduced) h = 1;
    const tl = Math.max(0, h - 0.13);
    const a = f.share ? (age < T ? Math.min(1, age / 500) : 0)
      : Math.min(1, age / 500) * (1 - clamp01((age - T * 0.55) / (T * 0.45)));
    if (!ctx.reduced && a > 0) {
      const hx = s[0] + (e[0] - s[0]) * h, hy = s[1] + (e[1] - s[1]) * h, hz = s[2] + (e[2] - s[2]) * h;
      const tx = s[0] + (e[0] - s[0]) * tl, ty = s[1] + (e[1] - s[1]) * tl, tz = s[2] + (e[2] - s[2]) * tl;
      for (let i = 1; i <= 8; i++) {
        const u0 = (i - 1) / 8, u1 = i / 8;
        P2[0] = tx + (hx - tx) * u0; P2[1] = ty + (hy - ty) * u0; P2[2] = tz + (hz - tz) * u0;
        SEG_END[0] = tx + (hx - tx) * u1; SEG_END[1] = ty + (hy - ty) * u1; SEG_END[2] = tz + (hz - tz) * u1;
        pt.seg(P2, SEG_END, visit, 0.55 * a * u1, 0.4 + 0.9 * u1);
      }
      PB[0] = hx; PB[1] = hy; PB[2] = hz;
      pt.glow(PB, rgb(COMET_HEAD), 10, 0.75 * a);
    }
    if (f.share && age >= T) {
      const q = (age - T) / (f.life - T);
      pt.ring(e, visit, 2 + 13 * ease(q), 0.7 * (1 - q), 1);
      pt.glow(e, visit, 16, 0.5 * (1 - q));
    }
  },
};
const SEG_END = [0, 0, 0];

/** The colour of a made card. */
export function hueOf(kind) { return rgb(MOMENT_HUE[kind] || MOMENT_HUE.card); }

/**
 * One frame of moments: the live effects, then the halos of whoever is here.
 * Drops the effects that have finished and keeps the ones still waiting to
 * start (the director holds a moment's light until the camera arrives).
 */
export function paintMoments(painter, effects, halos, ctx) {
  const keep = [];
  for (let i = 0; i < effects.length; i++) {
    const f = effects[i];
    const age = ctx.now - f.t0;
    if (age < 0) { keep.push(f); continue; }
    if (age > f.life) continue;
    if (!ctx.alive(f)) continue;
    DRAW[f.type](painter, f, age, ctx);
    keep.push(f);
  }
  const warm = rgb(WARM);
  const t = ctx.now / 1000;
  for (const h of halos) {
    const p = ctx.at(h.at, P0);
    const br = ctx.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(t * 1.3 + h.phase);
    const n = h.n;
    painter.glow(p, warm, (30 + 12 * (n - 1)) * (0.94 + 0.12 * br), (0.16 + 0.07 * br) * h.alpha * (1 + 0.3 * (n - 1)));
    painter.glow(p, warm, 7, 0.5 * h.alpha);
  }
  return keep;
}
