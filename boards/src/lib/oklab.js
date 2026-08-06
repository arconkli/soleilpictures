// OKLab colour space + perceptual ordering, for auto-arranged moodboards.
//
// Why OKLab and not HSL: hue is meaningless at low saturation, and location
// photography is overwhelmingly low saturation — concrete, asphalt, overcast
// sky, painted drywall. Sorting those by hue produces noise, because a 3%-
// saturated warm grey and a 3%-saturated cool grey sit at opposite ends of the
// hue wheel while looking identical. OKLab is perceptually uniform, so near-
// neutrals cluster near the L axis where they belong and Euclidean distance
// actually corresponds to "looks different".
//
// Everything here is pure and dependency-free so it runs in the browser, in the
// Worker, and in the Node ingest service, and so it can be tested without an
// image decoder.

// sRGB (0-255) → linear light. The 0.04045 knee is the sRGB transfer function;
// skipping it (the common shortcut of just dividing by 255) biases every dark
// pixel too bright and makes shadow-heavy frames sort as mid-tones.
function toLinear(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

// Björn Ottosson's OKLab matrices (oklab.cbrt of the LMS cone responses).
export function srgbToOklab(r, g, b) {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);

  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return {
    L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  };
}

export const chroma = (c) => Math.hypot(c?.a || 0, c?.b || 0);

// Perceptual distance. Plain Euclidean in OKLab is the whole point of the space
// — no weighting fudge factors needed.
export function deltaE(c1, c2) {
  if (!c1 || !c2) return 0;
  return Math.hypot((c1.L - c2.L), (c1.a - c2.a), (c1.b - c2.b));
}

// Reduce a decoded thumbnail to ONE colour that represents how the photo reads.
//
// The naive approach — resize to 1×1 and take the pixel — is worse than it
// looks: it averages in linear-ish RGB space, so a high-contrast frame collapses
// to mud and a black-and-white shot is indistinguishable from a mid-grey wall.
//
// Instead: mean lightness across all pixels (a true average is right for L), but
// a CHROMA-WEIGHTED mean for the a/b axes. A frame that is 90% grey concrete
// with one warm sodium streetlight should sort as warm, because that's what the
// eye takes from it — the grey pixels carry no hue information and shouldn't get
// a vote on hue. Fully neutral input falls back to exact neutral rather than
// letting sensor noise pick a direction.
//
// `rgb` is tightly packed RGB or RGBA; `channels` says which.
export function averageColor(rgb, channels = 3) {
  const px = rgb ? Math.floor(rgb.length / channels) : 0;
  if (!px) return { L: 0, a: 0, b: 0 };

  let sumL = 0;
  let wa = 0;
  let wb = 0;
  let wsum = 0;

  for (let i = 0; i < px; i++) {
    const o = i * channels;
    // Skip transparent pixels — a PNG with an alpha border would otherwise drag
    // every average toward whatever garbage sits in its unused colour channels.
    if (channels === 4 && rgb[o + 3] < 8) continue;
    const c = srgbToOklab(rgb[o], rgb[o + 1], rgb[o + 2]);
    sumL += c.L;
    const w = chroma(c);
    wa += c.a * w;
    wb += c.b * w;
    wsum += w;
  }

  const n = px || 1;
  const L = sumL / n;
  // Below this the image is neutral for all practical purposes and any hue we
  // computed is noise amplified by the weighting.
  if (wsum < 1e-4) return { L, a: 0, b: 0 };
  return { L, a: wa / wsum, b: wb / wsum };
}

// ── Ordering ─────────────────────────────────────────────────────────────────
//
// Lay a 1-D path through colour space so that consecutive items are as similar
// as possible. This is a shortest-Hamiltonian-path problem; we don't need the
// optimum, we need "no jarring jumps", which greedy + 2-opt reaches easily at
// these sizes (a burst is tens of photos, never thousands).

function greedyPath(items, startIdx) {
  const n = items.length;
  const used = new Array(n).fill(false);
  const order = [startIdx];
  used[startIdx] = true;

  for (let k = 1; k < n; k++) {
    const from = items[order[order.length - 1]].color;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      const d = deltaE(from, items[i].color);
      if (d < bestD) { bestD = d; best = i; }
    }
    order.push(best);
    used[best] = true;
  }
  return order;
}

// 2-opt for an open path: reversing order[i..j] only changes the two edges at
// the ends, so the gain is computable in O(1) and the whole pass is O(n²).
// Bounded, because we want a good answer in bounded time, not the optimum.
function twoOpt(items, order, maxPasses = 40) {
  const d = (x, y) => deltaE(items[x]?.color, items[y]?.color);
  const n = order.length;

  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false;
    for (let i = 1; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = order[i - 1];
        const b = order[i];
        const c = order[j];
        const e = j + 1 < n ? order[j + 1] : null;
        // Path (not cycle): the tail edge doesn't exist when j is the last node.
        const before = d(a, b) + (e === null ? 0 : d(c, e));
        const after = d(a, c) + (e === null ? 0 : d(b, e));
        if (after < before - 1e-9) {
          let lo = i;
          let hi = j;
          while (lo < hi) { const t = order[lo]; order[lo] = order[hi]; order[hi] = t; lo++; hi--; }
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return order;
}

// Order items (each carrying `.color` in OKLab) into a smooth perceptual run.
//
// Starts at the DARKEST item so the sequence reads dark → light, which is how a
// moodboard is conventionally assembled and reads as deliberate rather than
// arbitrary. Items with no colour (a note, a link card, a photo whose decode
// failed) are stable-sorted to the end rather than dropped — losing someone's
// card to a layout preference would be indefensible.
export function orderByColor(items) {
  const list = Array.isArray(items) ? items : [];
  const withColor = [];
  const without = [];
  for (const it of list) {
    if (it?.color && Number.isFinite(it.color.L)) withColor.push(it);
    else without.push(it);
  }
  if (withColor.length < 3) return [...withColor, ...without];

  let start = 0;
  for (let i = 1; i < withColor.length; i++) {
    if (withColor[i].color.L < withColor[start].color.L) start = i;
  }

  const order = twoOpt(withColor, greedyPath(withColor, start));
  return [...order.map((i) => withColor[i]), ...without];
}

// Total path length — how "smooth" an ordering is. Used by tests to assert the
// sort actually beats the input order rather than merely differing from it.
export function pathCost(items) {
  let sum = 0;
  for (let i = 1; i < (items?.length || 0); i++) {
    if (items[i - 1]?.color && items[i]?.color) sum += deltaE(items[i - 1].color, items[i].color);
  }
  return sum;
}
