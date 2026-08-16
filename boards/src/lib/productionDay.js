// Shoot days: creating the clusters a production calendar points at.
//
// A shoot day is a CHILD CLUSTER with boards.scheduled_date set (0238). Two
// operations live here, and the split between them is deliberate:
//
//   addShootDays()  — bulk. Creates EMPTY dated clusters for a date range.
//   scaffoldShootDay() — fills one day in with the four cards a crew expects.
//
// Why not scaffold everything up front? The card cap. It is per-user via
// profiles.card_cap_base — 50 for new accounts, 100 grandfathered (0229) — and
// enforced by a trigger on card_index that counts every card in every workspace
// the board owner created. A 60-day shoot scaffolded on creation is 240 cards
// against a 50-card cap: the client gate would silently truncate the batch
// mid-run and pop the upgrade modal, having already made 60 clusters. An empty
// cluster costs nothing (createBoard saves an empty Y.Doc, so syncCardIndex
// writes no rows), so laying out twelve weeks is free and each day pays for
// itself when someone actually opens it.
//
// Writing another board's Y.Doc from here is the cloneBoardToPersonal pattern
// (App.jsx): build a detached doc, saveBoardSnapshot, done. saveBoardSnapshot
// fires syncCardIndex itself — do NOT call it separately. No PartyKit round
// trip is needed because the room has never booted: boardStateSync's load()
// skips the board_state read only when DO storage is non-empty, which for a
// cluster created seconds ago it never is. If you ever re-scaffold a cluster
// someone has already opened, that assumption dies and you need
// forceResetBoardRoom().

import * as Y from 'yjs';
import { createBoard, saveBoardSnapshot, setBoardSchedule } from './boardsApi.js';
import { cardToYMap } from './yhelpers.js';
import { initCardGridStore } from './gridState.js';
import { initCardDocStore } from './docState.js';
// Pure planning maths lives next door so `node --test` can reach it; re-exported
// here so callers have one import for "shoot days".
import { shootDayDates, shootDayCards } from './productionDayPlan.js';
export {
  shootDayDates, nextDayNumber, shootDayCards, defaultShootRange,
  MAX_SHOOT_DAYS_PER_ADD,
} from './productionDayPlan.js';

// Fill one dated cluster with the scaffold. Idempotence is the caller's job:
// this always writes, so only offer it for a cluster that is still empty.
export async function scaffoldShootDay({ boardId, dayLabel, userId = null }) {
  const tmp = new Y.Doc();
  try {
    const cardsMap = tmp.getMap('cards');
    tmp.transact(() => {
      for (const card of shootDayCards(dayLabel)) {
        const stamped = {
          createdBy: userId || null, createdAt: new Date().toISOString(),
          updatedBy: userId || null, updatedAt: new Date().toISOString(),
          ...card,
        };
        const ym = cardToYMap(stamped);
        cardsMap.set(stamped.id, ym);
        // Nested per-card stores go in the SAME transaction as the insert, so
        // the card and its interior are one unit — same rule as addCard().
        if (stamped.kind === 'schedule' || stamped.kind === 'grid') initCardGridStore(tmp, ym);
        if (stamped.kind === 'doc') initCardDocStore(tmp, ym);
      }
    });
    // This upserts board_state AND fires syncCardIndex — the cap check, search
    // and thumbnails all hang off that, so nothing else to call.
    await saveBoardSnapshot(boardId, tmp);
  } finally {
    tmp.destroy();
  }
}

// Bulk-create empty dated clusters for a range. Sequential on purpose:
// syncCardIndex throttles PER BOARD, so sixty parallel creates fire sixty
// independent flushes and starve the realtime websocket of REST budget — a
// hazard boardsApi documents at the throttle itself.
export async function addShootDays({
  workspaceId, parentBoardId, from, to,
  skipWeekends = false, startNumber = 1, userId = null, onProgress = null,
}) {
  const dates = shootDayDates(from, to, { skipWeekends });
  const made = [];
  const failed = [];
  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const label = `Day ${startNumber + i}`;
    try {
      // The DATE is never written into the name — every surface renders it from
      // scheduled_date, so a moved day can't leave a stale title behind.
      const board = await createBoard({
        workspaceId, parentBoardId, name: label, view: 'canvas', userId,
      });
      // notify:false — a schedule being built must not page the crew sixty
      // times. Nothing is announced until someone publishes a day.
      const res = await setBoardSchedule(board.id, date, null, label, false);
      if (res && res.ok === false) throw new Error(res.error || 'set_board_schedule refused');
      made.push({ id: board.id, date, label });
    } catch (e) {
      console.warn('addShootDays: failed for', date, e);
      failed.push({ date, error: e?.message || String(e) });
    }
    onProgress?.(i + 1, dates.length);
  }
  return { made, failed, requested: dates.length };
}

