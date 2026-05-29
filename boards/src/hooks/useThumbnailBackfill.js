// Self-healing thumbnail backfill.
//
// Stored board previews (boards.thumb_key → R2) are otherwise ONLY created
// by maybeGenerateThumbnail() in yboard.js, which runs while a board is open
// and being *edited*. So a board you never edited never gets a thumbnail —
// which is why most tiles fall back to an on-the-fly live render (visible
// tiles only) or a plain placeholder.
//
// The grid already pays to decode each visible no-thumb board's snapshot
// (useBoardPreview) and live-render it (BoardThumbnail) — then throws the
// render away. This hook persists that render instead: when a writer sees a
// tile with no stored thumbnail, render the SAME blob to R2 and stamp the
// board. On the next load the tile is a cheap static <R2Image>; the boards
// realtime subscription flips the tile over within the same session.
//
// Gating: one shot per board per session; non-empty preview only; concurrency
// capped so a freshly-painted grid doesn't fire a burst of presigns + PUTs +
// upserts at once. Read-only viewers get a 403 at presign (can_write_board) —
// expected and swallowed; we never retry that board in-session.

import { useEffect } from 'react';
import { supabase } from '../lib/supabase.js';
import { renderThumbnailBlob } from '../lib/renderThumbnail.js';
import { uploadBoardThumbnail } from '../lib/uploads.js';
import { updateBoardThumb } from '../lib/boardsApi.js';
import * as perf from '../lib/perf.js';

// One attempt per board per session (success OR definitive failure). Cleared
// only by a page reload — a transient failure simply retries next session.
const _attempted = new Set();

// Small concurrency gate. The grid can mount many tiles at once; without
// this we'd fire N presign requests + N R2 PUTs + N Supabase upserts on the
// first paint. Cap keeps the burst civil without blocking the visible tiles.
const CONCURRENCY = 2;
let _active = 0;
const _queue = [];

function _runGated(task) {
  const start = () => {
    _active++;
    Promise.resolve()
      .then(task)
      .catch(() => {})
      .finally(() => {
        _active--;
        const next = _queue.shift();
        if (next) next();
      });
  };
  if (_active < CONCURRENCY) start();
  else _queue.push(start);
}

export function useThumbnailBackfill({ board, preview, boards = {}, enabled = true }) {
  const boardId = board?.id;
  const workspaceId = board?.workspace_id;
  const hasThumb = !!board?.thumb_key;

  useEffect(() => {
    if (!enabled || !boardId || !workspaceId || hasThumb) return;
    if (_attempted.has(boardId)) return;

    const cards = preview?.cards || [];
    const strokes = preview?.strokes || [];
    // Preview not decoded yet, or genuinely empty board — nothing to render.
    // (Matches maybeGenerateThumbnail's empty-board skip; an empty board
    // correctly keeps its placeholder rather than a blank thumbnail.)
    if (cards.length === 0 && strokes.length === 0) return;

    // Optimistic one-shot mark, BEFORE any async, so re-renders and
    // StrictMode double-invokes can't double-fire for the same board.
    _attempted.add(boardId);

    // Deliberately NOT tied to the effect cleanup: the task sets no React
    // state and is idempotent, so letting it finish after a re-render or
    // unmount is correct (it just caches a valid thumbnail). Cancelling on
    // cleanup would abort an in-flight generation on a harmless re-render.
    _runGated(async () => {
      try {
        const blob = await renderThumbnailBlob({
          cards, strokes, arrows: preview?.arrows, boards, width: 800, height: 600,
        });
        if (!blob) return;
        let userId = null;
        try {
          userId = (await supabase.auth.getSession()).data?.session?.user?.id || null;
        } catch (_) { /* uploaded_by is nullable — proceed without it */ }
        const { src } = await uploadBoardThumbnail({ workspaceId, boardId, blob, userId });
        await updateBoardThumb(boardId, { thumbKey: src, cardCount: cards.length });
      } catch (e) {
        // Viewers hit a 403 at presign (can_write_board) — that's expected,
        // stay quiet. Any other failure is swallowed too; the board stays on
        // its live-render fallback and a future page load retries.
        if (perf.isEnabled()) console.warn('[thumb backfill] skipped', boardId, e?.message || e);
      }
    });
  }, [enabled, boardId, workspaceId, hasThumb, preview, boards]);
}
