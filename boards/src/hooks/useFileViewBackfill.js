import { useEffect, useRef, useState } from 'react';
import { viewKindOfKey } from '../lib/fileView.js';
import { getMeta } from '../lib/imageMeta.js';

// Every photo shows in every browser (lib/fileView.js). For a writer on the
// open cluster, each image card whose file some browser can't draw (HEIC,
// TIFF, JPEG XL, OpenEXR, JPEG 2000) and that has no preview yet is asked a
// view for, a few a pass; each finished view goes into the image meta, so the
// card shows it, and onto its card, silently and off the undo stack, when the
// card is still the 4:3 shape a file the browser couldn't measure is dropped
// at. Pictures elsewhere (Files, Quick look, a reader's canvas) ask on their
// own when they can't draw a file (components/R2Image.jsx). The pass loads
// with lib/fileViewWork.js the first time a board has a card to look at.
//
// A pass's lifetime is the board, not the `cards` array (PERF-05, pinned by
// mediaBackfillHooks.test.mjs): it reads the latest cards and mutator through
// refs and is cancelled only by a change of board, workspace, user or role.
// While views on this board are being made it looks again every POLL_MS.

const POLL_MS = 10_000;
const POLL_GIVE_UP_MS = 30 * 60_000;

export function useFileViewBackfill({
  cards, canEdit, workspaceId, boardId, userId, updateCardSilent, enabled = true, perPass = 20,
}) {
  // Keys whose record has ended (written, skipped, failed) or that need none.
  const settled = useRef(new Set());
  // Keys asked for this session: asked once, then read until they end.
  const asked = useRef(new Set());
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const updateRef = useRef(updateCardSilent);
  updateRef.current = updateCardSilent;
  const scopeRef = useRef(0);
  const runningRef = useRef(false);
  const pollRef = useRef({ timer: null, since: 0 });
  const [tick, setTick] = useState(0);
  // Bumped when a pass from a scope we already left finishes draining (see
  // useVideoPosterBackfill: the new scope's pass returned early while it ran).
  const [drained, setDrained] = useState(0);
  useEffect(() => {
    scopeRef.current += 1;
    return () => {
      scopeRef.current += 1;
      clearTimeout(pollRef.current.timer);
      pollRef.current = { timer: null, since: 0 };
    };
  }, [canEdit, workspaceId, boardId, userId, enabled]);
  useEffect(() => {
    if (runningRef.current) return;
    if (!enabled || !canEdit || !workspaceId || !userId || typeof updateCardSilent !== 'function') return;
    const targets = (cards || []).filter((c) => c.kind === 'image' && !c.pending
      && typeof c.src === 'string' && c.src.startsWith('r2:') && viewKindOfKey(c.src.slice(3))
      && !getMeta(c.src.slice(3))?.previewKey && !settled.current.has(c.src.slice(3)));
    if (!targets.length) return;
    const scope = scopeRef.current;
    const cancelled = () => scopeRef.current !== scope;
    runningRef.current = true;
    let waiting = false;
    import('../lib/fileViewWork.js').then((work) => work.viewPass({
      targets, perPass, cancelled, settled: settled.current, asked: asked.current,
      // Every card on the board that holds a finished file, as it is now.
      cardsNow: () => cardsRef.current,
      write: (id, patch) => updateRef.current?.(id, patch),
    })).then((more) => { waiting = more; }).catch(() => {}).finally(() => {
      runningRef.current = false;
      if (cancelled()) setDrained((n) => n + 1);
      else if (waiting) {
        const p = pollRef.current;
        if (!p.since) p.since = Date.now();
        if (Date.now() - p.since < POLL_GIVE_UP_MS) {
          clearTimeout(p.timer);
          p.timer = setTimeout(() => setTick((n) => n + 1), POLL_MS);
        }
      } else {
        pollRef.current.since = 0;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, canEdit, workspaceId, boardId, userId, enabled, tick, drained]);
}
