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

import { hash01, orbitJitter } from './hashJitter.js';

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
//   direction — uniform on the sphere from two id-keyed hashes, with
//               Y compressed to 0.4 so card swarms read as slightly
//               inclined disks (matches the old gentle DISK_PULL look)
//   radius    — 36 (the old structural link distance) × the same
//               orbitJitter the force layout used, × a sqrt shell
//               term so the Nth card of a big board settles onto an
//               outer shell instead of stacking — planets, not a ring.
//
// orbitalIndex is the card's arrival index within its board. Snapshot
// order is (created_at, node_id), so it's stable across reloads.
export const LEAF_BASE_RADIUS = 36;
export const LEAF_Y_FLATTEN   = 0.4;
export const LEAF_SHELL_GROWTH = 0.15;

export function orbitOffset(id, orbitalIndex = 0, baseRadius = LEAF_BASE_RADIUS, out = null) {
  const theta = 2 * Math.PI * hash01(id + ':θ');
  // acos(2v−1) gives uniform-on-sphere latitude; Y then flattened.
  const phi = Math.acos(2 * hash01(id + ':φ') - 1);
  const r = baseRadius * orbitJitter(id) * (1 + LEAF_SHELL_GROWTH * Math.sqrt(orbitalIndex));
  const sinPhi = Math.sin(phi);
  const o = out || new Float32Array(3);
  o[0] = r * sinPhi * Math.cos(theta);
  o[1] = r * Math.cos(phi) * LEAF_Y_FLATTEN;
  o[2] = r * sinPhi * Math.sin(theta);
  return o;
}

// Leaves whose parent board isn't in the universe (deleted board with
// surviving card_index rows, unparseable ids) orbit the galactic rim
// instead of piling up at the origin. Same math, bigger shell.
export const ROGUE_BASE_RADIUS = 900;
export function rogueOffset(id, out = null) {
  return orbitOffset(id, 0, ROGUE_BASE_RADIUS, out);
}
