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
import { renderThumbnailBlob, RENDER_VERSION } from '../lib/renderThumbnail.js';
import { uploadBoardThumbnail } from '../lib/uploads.js';
import { updateBoardThumb } from '../lib/boardsApi.js';
import { runGated } from '../lib/backfillGate.js';
import * as perf from '../lib/perf.js';

// One attempt per board per session (success OR definitive failure). Cleared
// only by a page reload — a transient failure simply retries next session.
const _attempted = new Set();

// Allow a caller to re-arm the one-shot for a board so the backfill runs again
// this session. Used when reverting a custom thumbnail: the board may have been
// auto-backfilled earlier this session (so it's in _attempted), and without
// re-arming, the reset auto thumbnail wouldn't regenerate until a page reload.
export function forgetThumbnailAttempt(boardId) {
  if (boardId) _attempted.delete(boardId);
}

// Concurrency is capped by the shared backfillGate (runGated) so thumbnail
// backfill and image-preview backfill don't burst presigns + PUTs together on
// a freshly-painted board/grid.
const _runGated = runGated;

export function useThumbnailBackfill({ board, preview, boards = {}, enabled = true, force = false }) {
  const boardId = board?.id;
  const workspaceId = board?.workspace_id;
  const bgColor = board?.bg_color || null;
  // A stored thumb only counts when it's the CURRENT renderer's output —
  // stale versions (pre-rework renders) regenerate in the background here
  // while the tile keeps displaying the old image.
  const hasThumb = !!board?.thumb_key && board?.thumb_version === RENDER_VERSION;

  useEffect(() => {
    // `force` lets a caller regenerate even a current-version thumb — used
    // when a parent board's stored thumb is stale relative to its children
    // (a child's preview changed but the parent's own cards didn't). The
    // _attempted one-shot below still caps it to one regen per session.
    if (!enabled || !boardId || !workspaceId || (hasThumb && !force)) return;
    // User-set cover: never auto-regenerate, even under `force` (the parent
    // stale-vs-children regen path) — a custom thumbnail owns the key.
    if (board?.thumb_custom) return;
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
          cards, strokes, arrows: preview?.arrows, boards, bgColor,
        });
        if (!blob) return;
        let userId = null;
        try {
          userId = (await supabase.auth.getSession()).data?.session?.user?.id || null;
        } catch (_) { /* uploaded_by is nullable — proceed without it */ }
        const { src } = await uploadBoardThumbnail({ workspaceId, boardId, blob, userId });
        await updateBoardThumb(boardId, { thumbKey: src, cardCount: cards.length, thumbVersion: RENDER_VERSION });
      } catch (e) {
        // Viewers hit a 403 at presign (can_write_board) — that's expected,
        // stay quiet. Any other failure is swallowed too; the board stays on
        // its live-render fallback and a future page load retries.
        if (perf.isEnabled()) console.warn('[thumb backfill] skipped', boardId, e?.message || e);
      }
    });
  }, [enabled, boardId, workspaceId, hasThumb, force, bgColor, preview, boards]);
}
