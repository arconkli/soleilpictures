// The owner's "Share file" dialog, mounted once per app shell. Anything opens
// it with openFileShare() (lib/fileShareBus.js): a card's context menu, a list
// row, the player header, Quick look.
//
//   openFileShare({ boardId, cardId, card, boardName, surface })
//
// The dialog is lazy, so the shell only carries this listener until someone
// actually shares a file.
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { FILE_SHARE_EVENT } from '../../lib/fileShareBus.js';
import { logEvent } from '../../lib/analytics.js';
import { EV } from '../../lib/analyticsEvents.js';

const FileShareDialog = lazy(() => import('./FileShareDialog.jsx').then((m) => ({ default: m.FileShareDialog })));

export function FileShareHost({ api } = {}) {
  const [req, setReq] = useState(null);
  useEffect(() => {
    const on = (e) => {
      const d = e.detail || {};
      if (!d.boardId || !d.cardId) return;
      setReq({ ...d, seq: Date.now() });
      logEvent(EV.FILE_SHARE_OPEN, { kind: d.card?.kind || null, surface: d.surface || null });
    };
    document.addEventListener(FILE_SHARE_EVENT, on);
    return () => document.removeEventListener(FILE_SHARE_EVENT, on);
  }, []);
  const close = useCallback(() => setReq(null), []);
  if (!req) return null;
  return (
    <Suspense fallback={null}>
      <FileShareDialog
        key={`${req.boardId}:${req.cardId}:${req.seq}`}
        boardId={req.boardId}
        cardId={req.cardId}
        card={req.card || { id: req.cardId }}
        boardName={req.boardName || ''}
        onClose={close}
        {...(api ? { api } : {})}
      />
    </Suspense>
  );
}
