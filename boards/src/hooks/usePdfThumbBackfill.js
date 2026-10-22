import { useEffect, useRef, useState } from 'react';
import { resolveSrc } from '../lib/r2.js';
import { uploadPdfPageOne } from '../lib/uploads.js';
import { needsPdfThumb, pdfThumbPatch, pdfUnreadable } from '../lib/pdfThumb.js';

// One-shot, best-effort backfill: give a PDF card its page-1 picture when it
// has none (lib/pdfThumb.js says how a card gets there). New PDFs draw page 1
// as they upload; this catches the ones where that failed and the ones that
// came another way. pdf.js reads the same signed URL the viewer opens.
//
// Same contract as useVideoPosterBackfill: writer-only, one attempt per card
// per session, bounded per pass, and patched through updateCardSilent so the
// picture never lands on the undo stack. `thumbFailed` is the "don't try
// again" mark, and only a file pdf.js can't open sets it (a password, or not
// a PDF), so every writer doesn't re-download it on every visit; a failure
// that might pass (the network, a build replaced under the tab) is left for
// the next session.
export function usePdfThumbBackfill({
  cards, canEdit, workspaceId, boardId, userId, updateCardSilent, enabled = true, perPass = 2,
}) {
  const attempted = useRef(new Set());
  // Same lifetime rule as useVideoPosterBackfill (PERF-05): a job belongs to
  // the board, not to one `cards` array, which is new on every Y.Doc edit.
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
    const targets = (cards || []).filter(c => needsPdfThumb(c) && !attempted.current.has(c.id));
    if (!targets.length) return;
    const scope = scopeRef.current;
    const cancelled = () => scopeRef.current !== scope;
    // The card as it is NOW (deleted → null), so a result never resurrects a
    // card removed while its PDF was drawing, or overwrites a picture a
    // peer's session stored first.
    const liveCard = (id) => (cardsRef.current || []).find(x => x.id === id) || null;
    runningRef.current = true;
    (async () => {
      for (const c of targets.slice(0, perPass)) {
        if (cancelled()) break;
        attempted.current.add(c.id);
        let done = false;
        try {
          const url = await resolveSrc(c.pdfSrc);
          if (!url || cancelled()) continue;
          const page = await uploadPdfPageOne({ source: url, name: c.name, workspaceId, boardId, cardId: c.id, userId });
          done = true;
          const live = !cancelled() && liveCard(c.id);
          if (!live || live.src) continue;
          const patch = pdfThumbPatch(live, page);
          if (Object.keys(patch).length) updateRef.current?.(c.id, patch);
        } catch (err) {
          done = true;
          const live = pdfUnreadable(err) && !cancelled() && liveCard(c.id);
          if (live && !live.src) updateRef.current?.(c.id, { thumbFailed: 1 });
        } finally {
          // Left the board before the page was drawn: not a real attempt, so
          // a later visit may try again.
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
