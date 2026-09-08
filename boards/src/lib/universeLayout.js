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

// ── Galaxy structure — where the arms actually come from ─────────
//
// This used to be a pure density-wave model: every star on its own
// precessing ellipse, arms emerging as orbit crowding. That is the
// physically correct picture and it produced a genuinely beautiful
// barred spiral — AT 200,000 STARS. It cannot work here. Crowding is
// a STATISTICAL over-density, and the live corpus hangs off a few
// hundred workspace guiding centres — orders of magnitude short of
// what a wave needs. A few hundred points cannot express one;
// rendered, it reads as an amorphous blob.
// (Measured, not assumed — see the screenshots that prompted this.)
//
// So the arms are explicit: guiding centres are placed ON a
// logarithmic spiral, which is the curve real grand-design spirals
// follow (constant pitch angle, r = a·e^(θ·tan φ)). The old warning
// that "pulling stars toward a spiral curve makes tubes" was earned
// at 200k, where the curve is over-sampled; at 300 points, tight
// scatter around an explicit curve is the only thing that reads.
//
// Three populations, which is what keeps it from looking drawn:
//   • BULGE (~13%) — no arm at all, packed in the core
//   • ARM   (~86% of the disk) — near a spiral lane, with slop
//   • FIELD (the rest) — uniform angle, filling the inter-arm space
//
// The rotation split falls straight out of this and is the whole
// reason the arms survive a wall display running for hours:
//   • ARM stars ride the PATTERN, rigidly — arms cannot wind up
//   • BULGE and FIELD stars orbit at their own rate — real, visible
//     differential shear, on exactly the stars that have no
//     structure to destroy
export const GALAXY_DISK        = 0.45;  // exponential scale length as a fraction of R
export const GALAXY_ARMS        = 2;     // grand-design two-armed
export const GALAXY_PITCH       = 0.30;  // pitch angle (rad); real spirals ≈ 0.17–0.52
export const GALAXY_ARM_SHARE   = 0.86;  // of DISK stars that hug a lane
export const GALAXY_ARM_SCATTER = 0.13;  // angular slop about the lane (rad)
export const GALAXY_THICKNESS   = 0.030; // scale height as a fraction of R

// Where a lane sits at radius a. Logarithmic: θ = ln(a/R)/tan(pitch).
export function armAngle(a, R, arm) {
  return (arm / GALAXY_ARMS) * 2 * Math.PI
       + Math.log(Math.max(a, 1e-6) / R) / Math.tan(GALAXY_PITCH);
}

export function galaxyOrbit(id, R) {
  // Two populations, like real spirals: a compact BULGE (~13%, steep
  // exponential) and the DISK. The disk samples radius with pdf ∝
  // r·e^(−r/h) — the correct area measure for an exponential
  // surface-density disk (gamma(2), via −h·ln(u₁u₂)) — which peaks AT
  // the scale length instead of the center. A naive 1-D exponential
  // piles most stars into the core and leaves the disk empty.
  const bulge = hash01(id + ':gb') < 0.13;
  const a = bulge
    ? -0.12 * R * Math.log(1 - 0.98 * hash01(id + ':ga'))
    : -0.3 * R * Math.log(Math.max(1e-9, hash01(id + ':ga') * hash01(id + ':ga2')));

  const inArm = !bulge && hash01(id + ':garm') < GALAXY_ARM_SHARE;
  const arm = inArm ? Math.floor(hash01(id + ':gak') * GALAXY_ARMS) % GALAXY_ARMS : -1;
  const theta = inArm
    ? armAngle(a, R, arm)
      + (hash01(id + ':gs') + hash01(id + ':gs2') - 1) * GALAXY_ARM_SCATTER
    : 2 * Math.PI * hash01(id + ':gp');

  // Puffy in the bulge, thin in the disk.
  const hz = GALAXY_THICKNESS * R * (0.5 + 2.5 * Math.exp(-a / (0.25 * R)));
  return { a, theta, hz, arm, bulge };
}

// dPhi is how far this star has travelled along its own orbit;
// dOmega is how far the arm PATTERN has turned. Which one applies is
// the population's business, not the caller's: arm stars take the
// pattern (so the spiral is rigid and permanent), everything else
// takes its own orbital rate (so the disk visibly shears). Both
// default to 0, which reproduces the static layout exactly.
export function galaxySeed(id, R, out = null, dPhi = 0, dOmega = 0) {
  const { a, theta, hz, arm } = galaxyOrbit(id, R);
  const th = theta + (arm >= 0 ? dOmega : dPhi);
  const o = out || new Float32Array(3);
  o[0] = a * Math.cos(th);
  o[1] = hz * (hash01(id + ':gy') + hash01(id + ':gy2') - 1) * 2;
  o[2] = a * Math.sin(th);
  return o;
}

// ── Galactic rotation ────────────────────────────────────────────
//
// Real disk galaxies have a FLAT rotation curve: orbital speed is
// roughly constant with radius (that is the dark-matter signature),
// so angular rate goes as 1/a and the disk shears. Inside the core
// the curve is solid-body — the bulge turns as a unit — which also
// keeps Ω finite at a → 0.
//
// Rate is expressed as "how fast does a star at half the disk
// radius turn", because that is the number you actually look at.
// 0.030 rad/s ≈ a 3.5-minute orbit there, comparable to the camera
// drift this replaces; the core comes out ~10× faster and the rim
// ~10× slower, which is the visible shear.
export const GALAXY_OMEGA_HALF   = 0.030;  // rad/s at a = R/2
export const GALAXY_CORE_FRAC    = 0.14;   // solid-body inside this fraction of R
// The pattern (the arms) turns slowly and RIGIDLY, far slower than
// the stars — that is the whole point of a density wave. Stars
// overtake the arms, pile up in them, and move on.
export const GALAXY_PATTERN_RATE = 0.0045; // rad/s, the whole spiral

export function orbitalRate(a, R) {
  const core = GALAXY_CORE_FRAC * R;
  const v0 = GALAXY_OMEGA_HALF * 0.5 * R;   // V0 = Ω(R/2) · (R/2)
  return v0 / Math.max(a, core, 1e-9);
}

// Per-board spin of its own solar system, in its own tilted plane.
// Small systems turn faster than sprawling ones for the same reason
// close orbits do. ~8% run retrograde — Venus does.
export function systemSpin(boardId) {
  const mag = 0.05 + 0.22 * hash01(boardId + ':spin');
  return hash01(boardId + ':retro') < 0.08 ? -mag : mag;
}

// Stellar colour temperature, in Kelvin. Two things about this are
// deliberate, and both come from measuring the reference frames.
//
// It is NOT a radial ramp. Real arms carry hot blue O/B stars and
// cool amber giants side by side, and the reference shows exactly
// that — amber and blue-white particles adjacent on one arm. A
// radial lerp reads as a gradient; this has to read as a population.
//
// And the population is BIMODAL, not a broad smear. The reference is
// dominated by white / blue-white stars with a distinct amber
// minority and very few mid-tones — which is also what a real
// luminosity-limited sample looks like, because the bright end is
// blue giants and red giants with the yellow main sequence too dim
// to show. The amber share falls with radius: an old red bulge, a
// young blue disk.
export const STAR_TEMP_MIN = 2700;
// Well above the ~9000K a "blue-white" star suggests, on purpose: a
// blackbody normalised to its brightest channel is barely tinted at
// 9000K (about 0.8, 0.88, 1.0 — effectively white). The reference has
// unmistakably BLUE stars, so the hot population runs up into O-star
// territory where the tint is actually visible.
export const STAR_TEMP_MAX = 13000;
export function starTemp(id, a, R) {
  const t = Math.min(1, Math.max(0, a / (R || 1)));
  const coolShare = 0.34 - 0.19 * t;       // ~34% amber in the core, ~15% at the rim
  const u = hash01(id + ':gt');
  const j = hash01(id + ':gt2');
  const k = u < coolShare
    ? 2900 + 1500 * j                      // the amber population
    : 7000 + 5800 * j;                     // the blue-white majority
  return Math.min(STAR_TEMP_MAX, Math.max(STAR_TEMP_MIN, k));
}

// Apparent brightness, as a multiplier on a node's rendered radius.
// The reference's whole texture comes from this: a handful of large
// bloomed blobs among hundreds of faint specks. A near-uniform size
// per node kind — which is what we had — reads as a scatter plot no
// matter what colour it is painted. The exponent is what makes the
// tail rare. The exponent has to be steep — pow(u, 4.5) still leaves
// a tenth of the field bright, because u^n stays near 1 for u near 1.
// At 12: the median star sits on the floor, the top decile only
// reaches ~1.3, and one in a thousand blooms.
export const STAR_MAG_MIN = 0.55;
export const STAR_MAG_MAX = 3.6;
export const STAR_MAG_EXP = 12;
export function starMagnitude(id) {
  return STAR_MAG_MIN
       + (STAR_MAG_MAX - STAR_MAG_MIN) * Math.pow(hash01(id + ':mag'), STAR_MAG_EXP);
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
