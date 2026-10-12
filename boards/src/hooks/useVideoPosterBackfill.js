import { useEffect, useRef, useState } from 'react';
import { resolveSrc } from '../lib/r2.js';
import { captureVideoPoster, uploadImage } from '../lib/uploads.js';

// One-shot, best-effort backfill: give EXISTING video cards a first-frame
// poster so old clips get real previews in the list/gallery (and on the card).
// New videos capture their poster eagerly on upload; this catches the ones from
// before that pipeline. Fetches the signed video URL as a blob (the same
// CORS-enabled GET FileCard uses for text previews), captures a frame, uploads
// it, and patches the card OFF the undo stack. Writer-only; one attempt per card
// per session; bounded per pass so a board full of videos doesn't thrash.
export function useVideoPosterBackfill({
  cards, canEdit, workspaceId, boardId, userId, updateCardSilent, enabled = true, perPass = 3,
}) {
  const attempted = useRef(new Set());
  // A job's lifetime is the board, not the `cards` array: that is a new array
  // on every Y.Doc edit and boards refetch, and cancelling on it threw away a
  // multi-MB download that was already marked attempted, so a card on a
  // cluster being edited never got its poster (PERF-05). Jobs read the latest
  // cards and mutator through refs and are cancelled only by a change of
  // board, workspace, user, role, or unmount.
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const updateRef = useRef(updateCardSilent);
  updateRef.current = updateCardSilent;
  const scopeRef = useRef(0);
  const runningRef = useRef(false);
  // Bumped when a job from a scope we already left finishes draining. The
  // new scope's effect returned early while that job held runningRef, and
  // nothing else re-runs it until `cards` changes again, so this does.
  const [drained, setDrained] = useState(0);
  useEffect(() => {
    scopeRef.current += 1;
    return () => { scopeRef.current += 1; };
  }, [canEdit, workspaceId, boardId, userId, enabled]);
  useEffect(() => {
    if (runningRef.current) return;
    if (!enabled || !canEdit || !workspaceId || !userId || typeof updateCardSilent !== 'function') return;
    const targets = (cards || []).filter(c =>
      c.kind === 'video' && c.src && String(c.src).startsWith('r2:')
      && !c.poster && !c.pending && !attempted.current.has(c.id)
    );
    if (!targets.length) return;
    const scope = scopeRef.current;
    const cancelled = () => scopeRef.current !== scope;
    runningRef.current = true;
    (async () => {
      for (const c of targets.slice(0, perPass)) {
        if (cancelled()) break;
        attempted.current.add(c.id);
        let done = false;
        try {
          const url = await resolveSrc(c.src);
          if (!url || cancelled()) continue;
          const res = await fetch(url);
          if (!res.ok || cancelled()) continue;
          const blob = await res.blob();
          const objUrl = URL.createObjectURL(blob);
          let posterBlob = null;
          try { posterBlob = await captureVideoPoster(objUrl); }
          finally { try { URL.revokeObjectURL(objUrl); } catch (_) {} }
          done = true;
          if (!posterBlob || cancelled()) continue;
          const posterFile = new File([posterBlob], 'poster.webp', { type: 'image/webp' });
          const up = await uploadImage({ file: posterFile, workspaceId, boardId, userId });
          // Still this board, and the card still exists without a poster (it
          // may have been deleted, or a peer's session got there first).
          const live = !cancelled() && (cardsRef.current || []).find(x => x.id === c.id);
          if (live && !live.poster && up?.src) updateRef.current?.(c.id, { poster: up.src });
        } catch (_) { done = true; /* best-effort — leave the video glyph */ }
        finally {
          // Left the board mid-download: not a real attempt, so a later
          // visit may try again.
          if (!done && cancelled()) attempted.current.delete(c.id);
        }
      }
    })().finally(() => {
      runningRef.current = false;
      if (cancelled()) setDrained(n => n + 1);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, canEdit, workspaceId, boardId, userId, enabled, drained]);
}
