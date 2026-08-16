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

import { hash01 } from './hashJitter.js';

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

// Deterministic orbital offset for a leaf around its parent board.
//
// Not a shell: real star clusters are clumpy and heavy-tailed, so
//   angle  — slightly over half of a board's cards lean loosely
//            toward one of 1–3 hash-picked clump bearings (with wide
//            triangular scatter); the rest scatter uniformly.
//   radius — dense core with a sparse rim (power-law envelope) plus
//            the occasional flung straggler, so swarms trail off
//            instead of ending at a tidy boundary. A sqrt shell term
//            still spreads very large boards outward — planets, not
//            a ring, and not a solid ball either.
//   height — cubic concentration toward the disk plane; ~12% of
//            cards are thick-disk stragglers that float well off it.
//
// orbitalIndex is the card's arrival index within its board. Snapshot
// order is (created_at, node_id), so it's stable across reloads.
export const LEAF_BASE_RADIUS = 36;
export const LEAF_SHELL_GROWTH = 0.15;
// Radial envelope (× baseRadius, before shell growth): tests pin these.
export const LEAF_RADIAL_MIN = 0.22;
export const LEAF_RADIAL_MAX = 6.5;   // core-to-straggler span

export function orbitOffset(id, orbitalIndex = 0, baseRadius = LEAF_BASE_RADIUS, out = null) {
  const parent = parentBoardId(id) || 'rogue';
  const uK = hash01(id + ':k');

  let theta;
  if (uK < 0.55) {
    const nClumps = 1 + Math.floor(hash01(parent + ':nc') * 3);
    const j = Math.floor(hash01(id + ':cj') * nClumps);
    const clumpAngle = 2 * Math.PI * hash01(parent + ':ca' + j);
    // Sum of two hashes − 1 → triangular scatter, densest on the bearing.
    const scatter = (hash01(id + ':cs') + hash01(id + ':cs2') - 1) * 1.1;
    theta = clumpAngle + scatter;
  } else {
    theta = 2 * Math.PI * hash01(id + ':θ');
  }

  // Heavy-tailed radius: u^2.2 packs the core; the >0.94 band flings
  // stragglers to 2–3× their would-be orbit.
  let rf = 0.22 + 1.9 * Math.pow(hash01(id + ':r'), 2.2);
  if (uK > 0.94) rf *= 1.6 + 1.4 * hash01(id + ':o');
  const r = baseRadius * rf * (1 + LEAF_SHELL_GROWTH * Math.sqrt(orbitalIndex));

  const thick = hash01(id + ':t') > 0.88 ? 0.95 : 0.35;
  const y = r * Math.pow(2 * hash01(id + ':y') - 1, 3) * thick;

  const o = out || new Float32Array(3);
  o[0] = r * Math.cos(theta);
  o[1] = y;
  o[2] = r * Math.sin(theta);
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
export const GALAXY_ECC     = 0.45;  // peak orbit ellipticity (b = a(1−e))
export const GALAXY_TWIST   = 1.9;   // ellipse-orientation turns across one disk radius
export const GALAXY_DISK    = 0.45;  // exponential scale length as a fraction of R

export function galaxySeed(id, R, out = null) {
  const Rd = GALAXY_DISK * R;
  const a = -Rd * Math.log(1 - 0.98 * hash01(id + ':ga'));   // soft max ≈ 1.76R
  const e = GALAXY_ECC * Math.min(1, a / (0.15 * R + 1e-9)); // circular in the core
  const omega = GALAXY_TWIST * 2 * Math.PI * (a / R)
              + (hash01(id + ':gw') - 0.5) * 0.3;
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
