// universeLayout — the hierarchical layout contract that lets the
// admin universe scale past the old ~250k ceiling.
//
// The old worker ran d3-force over EVERY node: O((N+E)·logN) per tick
// in JS, which is why the renderer carried a 250k hard cap. But the
// universe is a strict hierarchy: users anchor workspaces, workspaces
// anchor boards, and the unbounded population — cards — always
// belongs to exactly one board (the board id is embedded in the card's
// node id). So:
//
//   • ANCHORS (user / ws / board) are simulated. Their population is
//     structurally small and grows slowly.
//   • LEAVES (cards of every kind) are placed procedurally on a
//     deterministic orbit around their parent board: position =
//     boardPos + orbitOffset(id). O(1) per card, zero sim cost, and
//     stable across reloads because it's keyed on the card id.
//
// A million cards costs the sim nothing; the per-tick fill is three
// float adds per card. Worker-safe: no DOM, no deps beyond hashJitter.

// NOT hashJitter's hash01: plain FNV-1a barely avalanches a trailing-
// character change (Δoutput ≈ prime·Δchar / 2³² ≈ 0.004), so sibling
// salts like ':nx'/':ny'/':nz' produced near-identical values — every
// system plane normal came out ±(0.58, 0.58, 0.58) and "triangular"
// two-hash scatters collapsed to uniform. This adds a murmur-style
// finalizer for real avalanche. Local to the layout lib on purpose:
// hash01 feeds long-shipped HomeGraph orbits we must not reshuffle.
function hash01(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Node ids: 'user:<uuid>' | 'ws:<uuid>' | 'board:<uuid>' |
// 'card:<board_uuid>:<card_id>'.
export function isAnchorId(id) {
  const s = String(id);
  return s.startsWith('user:') || s.startsWith('ws:') || s.startsWith('board:');
}

// 'card:<board>:<card>' → 'board:<board>'. Null for anything that
// doesn't carry a parseable parent (e.g. the legacy 2-segment doc
// ids some entity_links targets produce).
export function parentBoardId(id) {
  const s = String(id);
  if (!s.startsWith('card:')) return null;
  const rest = s.slice(5);
  const i = rest.indexOf(':');
  if (i <= 0) return null;
  return 'board:' + rest.slice(0, i);
}

// Edge kinds whose BOTH endpoints are anchors — the only links the
// simulation needs. Everything else (structural board→card, semantic
// card→card/board/doc) is drawn but not simulated: the card's
// position already encodes its board membership.
const SIM_LINK_KINDS = new Set(['hierarchy', 'wsroot', 'membership', 'share']);
export function isSimLinkKind(kind) {
  return SIM_LINK_KINDS.has(kind);
}

// Deterministic orbital offset for a leaf around its parent board —
// each board is a little SOLAR SYSTEM, built the way real ones are:
//
//   • Every system orbits in ONE flat plane with its own random
//     inclination (planet orbits are coplanar because they condensed
//     from one protoplanetary disk). Tilts are mostly modest so the
//     galaxy still reads as a disk, but ~7% of systems are mavericks
//     with any orientation — nature keeps a few of those too.
//   • The first eight cards take DISCRETE, geometrically spaced
//     orbits (Titius–Bode-style: each ring ~1.3× the last) with tiny
//     radial jitter and small inclination scatter — clean rings.
//   • The crowd beyond that condenses into BELTS: a main belt between
//     the mid rings and a wider, puffier Kuiper belt past the outer
//     planet — which is exactly where real systems put their rubble.
//   • ~5% are long-period COMETS: far out, strongly inclined.
//   • (The worker additionally turns ~18% of belt-era cards into
//     MOONS of the inner planets — see universeSimWorker.js.)
//
// A quarter of boards skip all this and stay loose DEBRIS CLOUDS
// (heavy-tailed, clumped) — young systems that never settled. The mix
// keeps the galaxy's texture varied instead of stamping one template.
//
// orbitalIndex is the card's arrival index within its board. Snapshot
// order is (created_at, node_id), so it's stable across reloads.
export const LEAF_BASE_RADIUS = 36;
// Radial envelope (× baseRadius): tests pin these.
export const LEAF_RADIAL_MIN = 0.2;
export const LEAF_RADIAL_MAX = 10;    // innermost ring to farthest comet

// Ring ladder: r_k = RING0 × RING_GROWTH^k (× baseRadius).
export const SYSTEM_RING0       = 0.38;
export const SYSTEM_RING_GROWTH = 1.32;
export const SYSTEM_RING_COUNT  = 8;
export const SYSTEM_BELT_R      = 1.0;   // main belt (between mid rings)
// 2.4× keeps the Kuiper belt past the outer ring (2.65×RING0) without
// bleeding into the NEXT board's system — our boards sit far closer
// together than real stars do.
export const SYSTEM_KUIPER_R    = 2.4;

export function systemArchetype(boardId) {
  return hash01(boardId + ':arch') < 0.75 ? 'planetary' : 'cloud';
}

// Per-system orbital-plane basis: u,v span the plane, n is its normal.
// Horizontal normal components are damped so most systems tilt < ~40°
// off the galactic plane — except the occasional maverick (Uranus
// spins on its side; some systems just do).
export function systemPlane(boardId) {
  const maverick = hash01(boardId + ':mav') > 0.93;
  const damp = maverick ? 1 : 0.6;
  let nx = (2 * hash01(boardId + ':nx') - 1) * damp;
  let nz = (2 * hash01(boardId + ':nz') - 1) * damp;
  let ny = maverick ? (2 * hash01(boardId + ':ny') - 1) : 1;
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  // u = normalize(n × a), a = ŷ (or x̂ when n is near-parallel to ŷ);
  // v = n × u completes the right-handed in-plane basis.
  let ax = 0, ay = 1, az = 0;
  if (Math.abs(ny) > 0.9) { ax = 1; ay = 0; }
  let ux = ny * az - nz * ay;
  let uy = nz * ax - nx * az;
  let uz = nx * ay - ny * ax;
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul; uy /= ul; uz /= ul;
  const vx = ny * uz - nz * uy;
  const vy = nz * ux - nx * uz;
  const vz = nx * uy - ny * ux;
  return { n: [nx, ny, nz], u: [ux, uy, uz], v: [vx, vy, vz] };
}

// Triangular scatter in [−1, 1], densest at 0.
function tri(id, salt) {
  return hash01(id + salt) + hash01(id + salt + '2') - 1;
}

export function orbitOffset(id, orbitalIndex = 0, baseRadius = LEAF_BASE_RADIUS, out = null) {
  const parent = parentBoardId(id) || 'rogue';
  const o = out || new Float32Array(3);

  if (systemArchetype(parent) === 'cloud') return cloudOffset(id, parent, baseRadius, o);

  const { u, v, n } = systemPlane(parent);
  const uK = hash01(id + ':k');
  let r, incl;
  if (uK > 0.95) {
    // Long-period comet: far out, strongly inclined.
    r = baseRadius * (3.2 + 3.8 * hash01(id + ':cr'));
    incl = tri(id, ':ci') * 0.7;
  } else if (orbitalIndex < SYSTEM_RING_COUNT) {
    // A planet on its own discrete orbit.
    r = baseRadius * SYSTEM_RING0 * Math.pow(SYSTEM_RING_GROWTH, orbitalIndex)
      * (1 + tri(id, ':rj') * 0.04);
    incl = tri(id, ':pi') * 0.07;
  } else if (hash01(id + ':belt') < 0.6) {
    // Main belt rubble.
    r = baseRadius * SYSTEM_BELT_R * (1 + tri(id, ':br') * 0.16);
    incl = tri(id, ':bi') * 0.15;
  } else {
    // Kuiper belt: wider, puffier.
    r = baseRadius * SYSTEM_KUIPER_R * (1 + tri(id, ':kr') * 0.2);
    incl = tri(id, ':ki') * 0.25;
  }
  const theta = 2 * Math.PI * hash01(id + ':θ');
  const c = r * Math.cos(theta);
  const s = r * Math.sin(theta);
  const h = r * incl;   // small-angle out-of-plane offset
  o[0] = u[0] * c + v[0] * s + n[0] * h;
  o[1] = u[1] * c + v[1] * s + n[1] * h;
  o[2] = u[2] * c + v[2] * s + n[2] * h;
  return o;
}

// The pre-solar look: heavy-tailed, clumped debris cloud (kept for
// the 25% of boards that read better unsettled).
function cloudOffset(id, parent, baseRadius, o) {
  const uK = hash01(id + ':k');
  let theta;
  if (uK < 0.55) {
    const nClumps = 1 + Math.floor(hash01(parent + ':nc') * 3);
    const j = Math.floor(hash01(id + ':cj') * nClumps);
    const clumpAngle = 2 * Math.PI * hash01(parent + ':ca' + j);
    theta = clumpAngle + tri(id, ':cs') * 1.1;
  } else {
    theta = 2 * Math.PI * hash01(id + ':θ');
  }
  let rf = 0.22 + 1.9 * Math.pow(hash01(id + ':r'), 2.2);
  if (uK > 0.94) rf *= 1.6 + 1.4 * hash01(id + ':o');
  const r = baseRadius * rf;
  const thick = hash01(id + ':t') > 0.88 ? 0.95 : 0.35;
  o[0] = r * Math.cos(theta);
  o[1] = r * Math.pow(2 * hash01(id + ':y') - 1, 3) * thick;
  o[2] = r * Math.sin(theta);
  return o;
}

// Moons ride a planet: small deterministic orbit around the host
// card's offset (host offset computed by the worker, which knows the
// board's early arrivals).
export function moonOffset(id, hostOffset, out = null) {
  const o = out || new Float32Array(3);
  const r = 2.2 + 2.8 * hash01(id + ':mr');
  const theta = 2 * Math.PI * hash01(id + ':mθ');
  const phi = Math.acos(2 * hash01(id + ':mφ') - 1);
  o[0] = hostOffset[0] + r * Math.sin(phi) * Math.cos(theta);
  o[1] = hostOffset[1] + r * Math.cos(phi) * 0.7;
  o[2] = hostOffset[2] + r * Math.sin(phi) * Math.sin(theta);
  return o;
}

// ── Galaxy kinematics — how real spirals actually get their arms ──
//
// Spiral arms are NOT strands of stars along a curve (drawing them
// that way produces exactly the tubes we're replacing). They're
// DENSITY WAVES: every star orbits on its own slightly-elliptical
// path filling the whole disk, and the ellipses' orientations twist
// steadily with radius (Lindblad's precessing-ellipse picture of
// Lin–Shu density-wave theory). Where neighboring twisted ellipses
// crowd, a two-armed spiral of OVER-DENSITY emerges on its own —
// with radius-proportional width, ragged edges, and stars still
// present between the arms, because every star's full orbit passes
// through arm and inter-arm space alike.
//
// Recipe per star, all hash-keyed on its id (stable across reloads):
//   a — semi-major axis from an exponential disk (dense core, no
//       hard edge; the deep-core pileup reads as the bulge)
//   e — eccentricity ramping up out of the core; b = a(1−e)
//   ω — ellipse orientation ∝ a (the twist that makes the wave),
//       plus per-star noise so the wave fronts stay ragged
//   φ — uniform position along the orbit
//   y — scale height: puffy in the bulge, thin in the disk,
//       triangular scatter for soft tails
// The twist must stay GENTLE: an annulus at radius r mixes ellipses
// with a ∈ [r, r/(1−e)], so coherent arms need dω/da · a·e ≲ 1 rad —
// wind harder and the orientations crossing one radius span a full
// turn and the wave averages itself away (measured: 1.9 turns → 1.15×
// contrast, mush; 0.65 turns → 2.4-2.9× with deep inter-arm troughs).
export const GALAXY_ECC     = 0.5;   // peak orbit ellipticity (b = a(1−e))
export const GALAXY_TWIST   = 0.65;  // ellipse-orientation turns across one disk radius
export const GALAXY_DISK    = 0.45;  // exponential scale length as a fraction of R

export function galaxySeed(id, R, out = null) {
  // Two populations, like real spirals: a compact BULGE (~22%,
  // steep exponential) and the DISK. The disk samples radius with
  // pdf ∝ r·e^(−r/h) — the correct area measure for an exponential
  // surface-density disk (gamma(2), via −h·ln(u₁u₂)) — which peaks
  // AT the scale length instead of the center. A naive 1-D
  // exponential piles most stars into the core and the density wave
  // out in the disk has nobody left to dance it.
  const bulge = hash01(id + ':gb') < 0.22;
  const a = bulge
    ? -0.12 * R * Math.log(1 - 0.98 * hash01(id + ':ga'))
    : -0.3 * R * Math.log(Math.max(1e-9, hash01(id + ':ga') * hash01(id + ':ga2')));
  const e = GALAXY_ECC * Math.min(1, a / (0.15 * R + 1e-9)); // circular in the core
  const omega = GALAXY_TWIST * 2 * Math.PI * (a / R)
              + (hash01(id + ':gw') - 0.5) * 0.22;
  const phi = 2 * Math.PI * hash01(id + ':gp');
  const p = a * Math.cos(phi);
  const q = a * (1 - e) * Math.sin(phi);
  const hz = 0.045 * R * (0.5 + 2.5 * Math.exp(-a / (0.25 * R)));
  const o = out || new Float32Array(3);
  o[0] = p * Math.cos(omega) - q * Math.sin(omega);
  o[1] = hz * (hash01(id + ':gy') + hash01(id + ':gy2') - 1) * 2;
  o[2] = p * Math.sin(omega) + q * Math.cos(omega);
  return o;
}

// Leaves whose parent board isn't in the universe (deleted board with
// surviving card_index rows, unparseable ids) drift the galactic rim
// instead of piling up at the origin — floored radius so the heavy-
// tailed core packing can never drop one into the bulge.
export const ROGUE_BASE_RADIUS = 900;
export function rogueOffset(id, out = null) {
  const theta = 2 * Math.PI * hash01(id + ':θ');
  const r = ROGUE_BASE_RADIUS * (0.6 + 0.9 * hash01(id + ':rr'));
  const o = out || new Float32Array(3);
  o[0] = r * Math.cos(theta);
  o[1] = r * Math.pow(2 * hash01(id + ':y') - 1, 3) * 0.35;
  o[2] = r * Math.sin(theta);
  return o;
}
