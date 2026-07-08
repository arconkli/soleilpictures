import { useEffect, useRef } from 'react';
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
  useEffect(() => {
    if (!enabled || !canEdit || !workspaceId || !userId || typeof updateCardSilent !== 'function') return;
    const targets = (cards || []).filter(c =>
      c.kind === 'video' && c.src && String(c.src).startsWith('r2:')
      && !c.poster && !c.pending && !attempted.current.has(c.id)
    );
    if (!targets.length) return;
    let cancelled = false;
    (async () => {
      for (const c of targets.slice(0, perPass)) {
        if (cancelled) break;
        attempted.current.add(c.id);
        try {
          const url = await resolveSrc(c.src);
          if (!url || cancelled) continue;
          const res = await fetch(url);
          if (!res.ok || cancelled) continue;
          const blob = await res.blob();
          const objUrl = URL.createObjectURL(blob);
          let posterBlob = null;
          try { posterBlob = await captureVideoPoster(objUrl); }
          finally { try { URL.revokeObjectURL(objUrl); } catch (_) {} }
          if (!posterBlob || cancelled) continue;
          const posterFile = new File([posterBlob], 'poster.webp', { type: 'image/webp' });
          const up = await uploadImage({ file: posterFile, workspaceId, boardId, userId });
          if (!cancelled && up?.src) updateCardSilent(c.id, { poster: up.src });
        } catch (_) { /* best-effort — leave the video glyph */ }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, canEdit, workspaceId, boardId, userId, enabled]);
}
