// boardMore.js — the first board asks for more (experiments.js first_board_more).
//
// Retention test 1 of the testing map (2026-10-28). Arm A is today's first
// board. Arm B, a moment after a third card lands on a board in someone's first
// week, gets one toast: bring in a whole folder, or add a note beside the
// pictures. People who put 10+ cards down on day one come back far more often
// than people who put 3-5, and pictures with writing beside them beat pictures
// alone (the day-one mix read), so the ask is for more, and for the other kind.
//
// Who is in it: accounts made at or after BOARD_MORE_EPOCH (11-06, after the
// 11-05 setup read) that had never been set up when they first opened the app.
// Both arms are stamped then, on the server (set_experiment_arm, first touch
// wins), so the read is by intent to treat. The coin is assignArm's
// cyrb53(`uid:first_board_more`), which shares nothing with workspace_setup's
// or trial_early's, so the tests cross evenly.
//
// The moment is the same rule in both arms (boardMoreDue). Both log it
// ('eligible'); only B then shows. It never lands on another note: not on the
// tour, a dialog, an upgrade offer, another hint or an upload, and it spends no
// visit's ask (upsellSlot.js), so it hides nobody else's. It shows once per
// account, ever.
//
// The pre-registered read: ~/soleil-research/queries/first_board_more_read.sql
// (private). Kill switch: experiments.js `enabled: false`.
//
// Pure and node-testable (boardMore.test.mjs): no React, no Supabase, no
// import.meta.env.

import { assignArm } from './experiments.js';
import { BOARD_MORE_EPOCH, BOARD_MORE_OVERRIDE_PARAM, BOARD_MORE_OVERRIDE_KEY } from './boardMoreEpoch.js';

export { BOARD_MORE_EPOCH, BOARD_MORE_OVERRIDE_PARAM, BOARD_MORE_OVERRIDE_KEY };
export const BOARD_MORE_KEY = 'first_board_more';
// profiles.settings key: { v, at, arm, action } once the moment has passed.
export const BOARD_MORE_SETTING = 'board_more';
export const BOARD_MORE_MIN_CARDS = 3;
// A board already at 10 has done what the ask is for (a folder import goes
// straight past it): no ask, in either arm.
export const BOARD_MORE_MAX_CARDS = 10;
export const BOARD_MORE_QUIET_MS = 4_000;
export const BOARD_MORE_RETRY_MS = 2_000;
export const BOARD_MORE_TTL_MS = 12_000;
export const BOARD_MORE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const BOARD_MORE_STAMP_PREFIX = 'soleil.board_more.enrolled.';
export const BOARD_MORE_CAND_PREFIX = 'soleil.board_more.cand.';
export const BOARD_MORE_DONE_PREFIX = 'soleil.board_more.done.';

const t = (iso) => Date.parse(iso || '');

// Who is in the test, decided at the first App load that knows the account's
// onboarding record (the seed writes `seeded` moments later, so App asks once).
export function isBoardMoreCandidate({ createdAt, onboarding } = {}) {
  const created = t(createdAt);
  if (!Number.isFinite(created) || created < t(BOARD_MORE_EPOCH)) return false;
  if (onboarding && (onboarding.seeded || onboarding.done)) return false;
  return true;
}

// The arm for this account: the QA override, else the coin for a candidate,
// else the arm the server already holds for it (another device, a later load).
export function boardMoreArm({ uid, candidate, override, enrolled } = {}) {
  if (override === 'A' || override === 'B') return override;
  if (!uid) return null;
  if (candidate) return assignArm(BOARD_MORE_KEY, uid);
  return enrolled === 'A' || enrolled === 'B' ? enrolled : null;
}

// ?more=A or ?more=B picks the arm for QA on dev and the preview deploy (the
// caller says whether it may), kept for the tab. Never stamped, and it skips
// the once-only and first-week rules so the moment can be tried again.
export function readBoardMoreOverride({ search, storage, allowed } = {}) {
  if (!allowed) return null;
  let v = null;
  try { v = new URLSearchParams(search || '').get(BOARD_MORE_OVERRIDE_PARAM); } catch (_) { v = null; }
  v = typeof v === 'string' ? v.trim().toUpperCase() : null;
  if (v === 'A' || v === 'B') {
    try { storage?.setItem(BOARD_MORE_OVERRIDE_KEY, v); } catch (_) { /* ignore */ }
    return v;
  }
  try {
    const kept = storage?.getItem(BOARD_MORE_OVERRIDE_KEY);
    return kept === 'A' || kept === 'B' ? kept : null;
  } catch (_) { return null; }
}

// Whether a card change arms the moment: the open board's genuine count went
// UP (a card landed, not a board opened) and is now 3 to 9.
export function boardMoreArms({ prev, next } = {}) {
  const a = Number(prev), b = Number(next);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return false;
  return b >= BOARD_MORE_MIN_CARDS && b < BOARD_MORE_MAX_CARDS;
}

// Whether the armed moment may happen now. The same in both arms.
//   done: the moment already passed for this account (profile or device)
//   qa: the arm came from ?more=, so once-only and the first week don't apply
//   busy: something else is on screen (the tour, a dialog, an offer, a hint)
export function boardMoreDue({
  arm, done, qa = false, createdAt, now, canEdit, cards, uploading, quietFor, busy,
} = {}) {
  if (arm !== 'A' && arm !== 'B') return false;
  if (!qa) {
    if (done) return false;
    const created = t(createdAt);
    const at = t(now);
    if (!Number.isFinite(created) || !Number.isFinite(at)) return false;
    if (at - created >= BOARD_MORE_WINDOW_MS) return false;
  }
  if (!canEdit) return false;
  const n = Number(cards);
  if (!Number.isFinite(n) || n < BOARD_MORE_MIN_CARDS || n >= BOARD_MORE_MAX_CARDS) return false;
  if (uploading || busy) return false;
  return Number(quietFor) >= BOARD_MORE_QUIET_MS;
}

const PICTURE_KINDS = new Set(['image', 'video']);
export function isPictureCard(c) {
  return !!c && PICTURE_KINDS.has(c.kind);
}

// What B's toast says and offers. A computer that can pick a folder is asked
// for one; a phone or tablet can't, so it is asked for more photos. The words
// stay short because the toast sets two buttons beside them: the buttons say
// what to do, and "Add a note" lands the note beside the pictures.
export function boardMoreCopy({ canFolder } = {}) {
  const message = 'Good start. Add more?';
  if (canFolder) {
    return { message, actions: [{ id: 'folder', label: 'Bring in a folder' }, { id: 'note', label: 'Add a note' }] };
  }
  return { message, actions: [{ id: 'photos', label: 'Add photos' }, { id: 'note', label: 'Add a note' }] };
}

const NOTE_W = 200;
const GAP = 40;

// Where "Add a note" puts it, as the click point addNote takes (horizontal
// centre, top edge): to the right of the right-most picture, level with its
// top; on a phone, below the lowest picture, at its left. With no pictures, the
// same beside the cards there are; with no cards, null (addNote's default).
export function noteBesidePictures(cards, { phone = false } = {}) {
  const list = (Array.isArray(cards) ? cards : []).filter((c) => c && Number.isFinite(+c.x) && Number.isFinite(+c.y));
  const pics = list.filter(isPictureCard);
  const pool = pics.length ? pics : list;
  if (!pool.length) return null;
  const w = (c) => (Number.isFinite(+c.w) ? +c.w : 0);
  const h = (c) => (Number.isFinite(+c.h) ? +c.h : 0);
  if (phone) {
    const low = pool.reduce((a, c) => (+c.y + h(c) > +a.y + h(a) ? c : a));
    return { x: Math.round(+low.x + NOTE_W / 2), y: Math.round(+low.y + h(low) + GAP / 2) };
  }
  const right = pool.reduce((a, c) => (+c.x + w(c) > +a.x + w(a) ? c : a));
  return { x: Math.round(+right.x + w(right) + GAP + NOTE_W / 2), y: Math.round(+right.y) };
}

// The profile record, once the moment has passed.
export function boardMoreRecord({ arm, action, now }) {
  return { v: 1, at: now, arm, action };
}
