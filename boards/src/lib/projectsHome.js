// projectsHome — what Home shows a person about their own work.
//
// WHY THIS EXISTS. Since the first board became paste-first, a person's first
// project lives on the root ("Studio") canvas, and nothing in the product ever
// showed them their projects as projects: Home opened a 3D graph, the sidebar
// tree was collapsed and sorted oldest-first, recents lived only inside cmd-K,
// and the one gallery of someone's own clusters was on the upgrade modal.
// People who came back for a second project made it, mostly, as an untitled
// box on top of the first one's references.
//
// So Home gets a panel that lists the person's projects — the root's children —
// newest first, next to the root itself, with the boards they were last in and
// a way to start the next one. This module decides WHAT is on that panel; it is
// pure (no React, no Supabase) so the ordering rules are node-testable.
//
// RECENCY. `boards.updated_at` alone tracks the last card change on only about
// half of recent boards — it is written by some client paths and not others.
// The thumbnail is re-rendered after edits, so `thumb_updated_at` fills most of
// the gap; the later of the two is the board's recency.

import { ancestorPath } from './boardTree.js';

export const JUMP_BACK_MAX = 3;

const stamp = (v) => {
  const t = Date.parse(v || '');
  return Number.isFinite(t) ? t : 0;
};

/** The later of updated_at and thumb_updated_at (then created_at), as ms. */
export function boardRecency(b) {
  if (!b) return 0;
  return Math.max(stamp(b.updated_at), stamp(b.thumb_updated_at)) || stamp(b.created_at);
}

const isLive = (b) => !!b && !b.deleted_at;

// A board this person may see on their own Home: in the workspace being shown,
// and not normalized in from somebody else's workspace (`_shared`).
const isOwn = (b, workspaceId) =>
  isLive(b) && !b._shared && (workspaceId == null || b.workspace_id === workspaceId);

/**
 * The person's projects: the root's live children in this workspace, most
 * recently touched first. The root itself is not a project here — the panel
 * shows it as its own tile ("Studio"), because since L1 it usually holds the
 * first project's references directly.
 */
export function projectList(boards, rootId, { workspaceId = null } = {}) {
  if (!boards || !rootId) return [];
  return Object.values(boards)
    .filter((b) => isOwn(b, workspaceId) && b.parent_board_id === rootId)
    .sort((a, z) => boardRecency(z) - boardRecency(a));
}

/**
 * Jump back in: the boards last opened on THIS device first (recents, newest
 * first), then — so a new device or a cleared browser is never empty — the
 * most recently touched own boards. The root counts; it is often where the
 * work is. Deduped, live only, at most `max`.
 */
export function jumpBackIn(boards, recents, rootId, { workspaceId = null, max = JUMP_BACK_MAX } = {}) {
  if (!boards) return [];
  const out = [];
  const seen = new Set();
  const take = (b) => {
    if (out.length >= max || !b || seen.has(b.id) || !isOwn(b, workspaceId)) return;
    seen.add(b.id);
    out.push(b);
  };
  for (const id of Array.isArray(recents) ? recents : []) take(boards[id]);
  if (out.length < max) {
    const rest = Object.values(boards)
      .filter((b) => isOwn(b, workspaceId) && !seen.has(b.id) && (b.id === rootId || b.parent_board_id != null))
      .sort((a, z) => boardRecency(z) - boardRecency(a));
    for (const b of rest) take(b);
  }
  return out;
}

/**
 * Is this board a top-level project — a direct child of the root? The empty
 * panel gives such a board the first board's treatment (bring material in,
 * writing tiles, no empty containers as peers): a new project starts the same
 * way a first one does.
 */
export function isTopLevelProject(boards, boardId, rootId) {
  if (!boards || !boardId || !rootId || boardId === rootId) return false;
  const b = boards[boardId];
  return isLive(b) && b.parent_board_id === rootId;
}

/**
 * Should starting a project offer the Creator trial? Only at or past
 * `threshold` of the person's own cap — the moment "Clusters for every
 * project" meets the free plan. Pure arithmetic; the eligibility rule itself
 * (who may be offered the trial at all) stays in creatorTrial.js.
 */
export const PROJECT_OFFER_FRAC = 0.6;
export function projectOfferDue({ count, limit, threshold = PROJECT_OFFER_FRAC } = {}) {
  const c = Number(count), l = Number(limit);
  if (!Number.isFinite(c) || !Number.isFinite(l) || l <= 0) return false;
  return c / l >= threshold;
}

/**
 * Where a new cluster card goes on a canvas that already holds work: beside it,
 * top-aligned, never on top of it. Returns the card's top-left. Without this a
 * project started from the root landed at a random spot in the top-left corner
 * — which, since the first project lives on the root, is where its images are.
 */
export function spotBesideContent(cards, { gap = 40 } = {}) {
  let right = -Infinity, top = Infinity;
  for (const c of Array.isArray(cards) ? cards : []) {
    if (c?.unplaced === true) continue;   // not on the board (lib/placement.js)
    const x = Number(c?.x), y = Number(c?.y), w = Number(c?.w) || 0;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    right = Math.max(right, x + w);
    top = Math.min(top, y);
  }
  if (!Number.isFinite(right)) return { x: 60, y: 60 };
  return { x: Math.round(right + gap), y: Math.round(top) };
}

export const MOVE_TARGETS_MAX = 50;

/**
 * Where "Move to cluster…" can send cards that sit on `fromId`: every live
 * cluster in the workspace except that one, most recently touched first. The
 * usual job is filing a first project's references — gathered on the root —
 * into the project they belong to, which is also the cluster most recently
 * touched.
 *
 * Each is labelled by its path below the root ("Spec ad / Refs"), because two
 * projects can each have a "Refs" and a bare name would not say which. A path
 * deeper than two is shortened to its project and its leaf. The root keeps
 * its own name.
 */
export function cardMoveTargets(boards, { workspaceId = null, fromId = null, max = MOVE_TARGETS_MAX } = {}) {
  const nameOf = (id) => boards?.[id]?.name || 'Untitled';
  const label = (id) => {
    const path = ancestorPath(boards, id);
    const names = (path.length > 1 ? path.slice(1) : path).map(nameOf);
    return names.length <= 2 ? names.join(' / ') : `${names[0]} / … / ${names[names.length - 1]}`;
  };
  return Object.values(boards || {})
    .filter((b) => isLive(b) && b.id !== fromId && (workspaceId == null || b.workspace_id === workspaceId))
    .sort((a, b) => boardRecency(b) - boardRecency(a))
    .slice(0, max)
    .map((b) => ({ id: b.id, label: label(b.id) }));
}

// Where Home's workspace switcher puts its menu: under the trigger, kept on
// screen. The menu is fixed to the viewport through a portal, because the
// panel scrolls and would clip a menu positioned inside it.
export function workspaceMenuPlacement(rect, viewport) {
  const vw = Math.max(0, Number(viewport?.width) || 0);
  const width = Math.max(220, Math.min(320, vw - 16));
  const left = Math.max(8, Math.min(Number(rect?.left) || 0, vw - width - 8));
  const top = Math.round((Number(rect?.bottom) || 0) + 6);
  return { top, left: Math.round(left), width: Math.round(width) };
}
