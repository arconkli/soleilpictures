// Scout — filing: moving what's collected in the Bin onto a real board.
//
// Every move is a two-step: PROPOSE (with a picture of exactly what will move),
// then act on a YES. That costs a round trip on the most common instruction,
// which is a real price — paid because the failure it prevents is expensive and
// silent. Someone scouts on Monday, forgets, and on Thursday says "put these in
// Diner Recce"; without a guard, 20 cards move and 14 are wrong. And because
// filing sorts by colour, the strays end up interleaved by hue rather than in a
// contiguous block, so undoing it by hand means hunting 14 cards out of 20.
//
// The default scope is the CURRENT RUN, not the whole Bin (see scoutRuns.js),
// so the common case is already correct before the confirmation is even read.

import {
  groupIntoRuns, currentRun, olderRuns, runLabel, countable,
} from '../../boards/src/lib/scoutRuns.js';
import { composeMoodboard } from '../../boards/src/lib/scoutCards.js';
import { moveCardsBetweenBoards, readBoardCards } from '../../boards/src/lib/scoutBoard.js';
import { scoutRpc } from '../../boards/src/lib/scoutDb.js';
import { confirmationSheet, moodboardSheet } from './sheets.js';
import * as say from './replies.js';
import { STAGES } from './replies.js';

// A proposal goes stale. Acting on a half-hour-old "yes" is how you move photos
// the user has stopped thinking about.
export const PENDING_TTL_MS = 30 * 60 * 1000;

// The reply predicates are pure and live next to the rest of the shared scout
// logic, so they can be tested (and reused by the Worker) without pulling sharp
// and the provider SDK along.
export {
  parseConfirmation, wantsEverything, isBinQuery, parseStopIntent, parseFindIntent,
  isDeleteIntent, isCreateConfirmation,
} from '../../boards/src/lib/scoutConfirm.js';

// Group the Bin for display: the run being acted on, then everything older.
function splitBin(cards, { everything = false } = {}) {
  const runs = groupIntoRuns(cards);
  if (!runs.length) return { selected: [], older: [], olderLabel: null, runs };
  if (everything) {
    return { selected: cards.filter(Boolean), older: [], olderLabel: null, runs };
  }
  const cur = currentRun(runs);
  const rest = olderRuns(runs);
  return {
    selected: cur?.cards || [],
    older: rest.flatMap((r) => r.cards),
    // Label the most recent of the leftovers — that's the one they're most
    // likely to remember, and naming a date makes the reminder concrete.
    olderLabel: rest.length ? runLabel(rest[rest.length - 1]) : null,
    runs,
  };
}

// STEP 1 — propose. Reads the Bin, renders the sheet, stores the pending move.
export async function prepareMove(cfg, r2, ctx, { boardId, boardName, everything = false, progress = null }) {
  await progress?.step(STAGES.checking());

  const binCards = await readBoardCards(cfg, ctx.binBoardId, ctx.accessToken);
  const cards = countable(binCards);
  if (!cards.length) return { reply: say.nothingToMove(boardName) };

  const { selected, older, olderLabel } = splitBin(cards, { everything });
  if (!selected.length) return { reply: say.nothingToMove(boardName) };

  // An ingest section header sitting over the photos being moved is deleted
  // rather than moved: the destination gets a fresh one, and leaving the old
  // band behind over an empty patch of Bin would be litter. Matched by time
  // window rather than by identity because headers aren't `countable` and so
  // never made it into `selected`.
  const span = timeSpan(selected);
  const dropIds = binCards
    .filter((c) => c?.sectionHeader && within(c, span))
    .map((c) => String(c.id));

  const pending = {
    board_id: boardId,
    board_name: boardName,
    card_ids: selected.map((c) => String(c.id)),
    drop_ids: dropIds,
    leftover: older.length,
    leftover_label: olderLabel,
    scope: everything ? 'all' : 'run',
  };
  await scoutRpc(cfg, 'scout_set_pending_move', {
    p_user_id: ctx.userId, p_platform: ctx.platform,
    p_thread_key: ctx.threadKey, p_payload: pending,
  }).catch(() => {});

  // The picture is the actual guard. The words just carry the count.
  let attachment = null;
  try {
    attachment = await confirmationSheet(cfg, r2, [
      { label: runLabel({ endedAt: latest(selected) }), dim: false, cards: selected },
      ...(older.length ? [{ label: olderLabel || 'earlier', dim: true, cards: older }] : []),
    ]);
  } catch (e) {
    console.error('[scout] confirmation sheet failed', e?.message);
  }

  return {
    reply: say.moveConfirm({
      count: selected.length, boardName, leftover: older.length, leftoverLabel: olderLabel,
    }),
    attachment,
    pending,
  };
}

// STEP 2 — act on YES.
export async function executeMove(cfg, r2, ctx, pending, { progress = null } = {}) {
  const ids = pending?.card_ids || [];
  if (!ids.length) return { reply: say.nothingToMove(pending?.board_name || 'that board') };

  await progress?.step(STAGES.moving(ids.length, pending.board_name));

  const result = await moveCardsBetweenBoards(cfg, {
    fromBoardId: ctx.binBoardId,
    toBoardId: pending.board_id,
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    accessToken: ctx.accessToken,
    cardIds: ids,
    dropIds: pending.drop_ids || [],
    layout: async (existing, moving) => {
      await progress?.step(STAGES.composing());
      return composeMoodboard({ existingCards: existing, cards: moving, topic: pending.topic || null });
    },
  });

  if (!result.count) return { reply: say.nothingToMove(pending.board_name) };

  await scoutRpc(cfg, 'scout_record_move', {
    p_user_id: ctx.userId, p_platform: ctx.platform, p_thread_key: ctx.threadKey,
    p_payload: {
      from_board_id: ctx.binBoardId,
      to_board_id: pending.board_id,
      board_name: pending.board_name,
      card_ids: result.moved.map((c) => String(c.id)),
    },
  }).catch(() => {});

  let attachment = null;
  try {
    attachment = await moodboardSheet(cfg, r2, result.moved);
  } catch (e) {
    console.error('[scout] moodboard sheet failed', e?.message);
  }

  return { result, attachment };
}

// STEP 3 — UNDO. The same move in reverse, so it's exact rather than a guess.
export async function undoMove(cfg, ctx, lastMove) {
  const ids = lastMove?.card_ids || [];
  if (!ids.length) return { reply: say.undoNothing() };

  const result = await moveCardsBetweenBoards(cfg, {
    fromBoardId: lastMove.to_board_id,
    toBoardId: lastMove.from_board_id,
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    accessToken: ctx.accessToken,
    cardIds: ids,
    // Straight back into the Bin, chronological — no moodboard on the way home.
    layout: async (existing, moving) => composeMoodboard({
      existingCards: existing, cards: moving, topic: null,
    }),
  });

  await scoutRpc(cfg, 'scout_record_move', {
    p_user_id: ctx.userId, p_platform: ctx.platform, p_thread_key: ctx.threadKey, p_payload: null,
  }).catch(() => {});

  return {
    reply: say.undoDone({ count: result.count, boardName: lastMove.board_name || 'that board' }),
  };
}

// "/bin" — what's waiting, grouped the same way filing groups it, so the answer
// and the behaviour can't disagree.
export async function describeBin(cfg, ctx, { url }) {
  const cards = countable(await readBoardCards(cfg, ctx.binBoardId, ctx.accessToken));
  if (!cards.length) return say.binEmpty();
  const runs = groupIntoRuns(cards);
  return say.binSummary({
    groups: runs.slice().reverse().map((r) => ({ label: runLabel(r), count: r.cards.length })),
    url,
  });
}

const stamp = (card) => {
  const t = Date.parse(card?.createdAt || '');
  return Number.isFinite(t) ? t : null;
};

const latest = (cards) => cards.reduce((m, c) => {
  const t = stamp(c);
  return t !== null && t > m ? t : m;
}, 0) || null;

// [earliest, latest] of a card set, padded by a minute so a header stamped a
// beat before its own photos still counts as part of them.
function timeSpan(cards) {
  const ts = cards.map(stamp).filter((t) => t !== null);
  if (!ts.length) return null;
  return [Math.min(...ts) - 60_000, Math.max(...ts) + 60_000];
}

function within(card, span) {
  if (!span) return false;
  const t = stamp(card);
  return t !== null && t >= span[0] && t <= span[1];
}
