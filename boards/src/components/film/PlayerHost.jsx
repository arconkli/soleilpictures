// The review player, mounted once per app shell (App.jsx, LocalBoardsApp.jsx)
// beside the Info drawer. Anything opens it with openPlayer(): the ⤢ on a
// video card, Quick look, a frame comment's timecode in Info. It reads the
// LIVE card, so a new version arriving while it's open shows up in its picker.
import { lazy, Suspense, useEffect, useState } from 'react';
import { PLAYER_EVENT } from '../../lib/playerBus.js';
import { openInfo } from '../../lib/infoBus.js';

const FilmReview = lazy(() => import('./FilmReview.jsx').then((m) => ({ default: m.FilmReview })));

export function PlayerHost({ resolveBoard, renderRail = null }) {
  const [req, setReq] = useState(null);   // { boardId, cardId, versionId, frame, commentId, card }
  useEffect(() => {
    const on = (e) => {
      const d = e.detail || {};
      if (d.close) { setReq(null); return; }
      if (d.boardId && d.cardId) setReq({ ...d });
    };
    document.addEventListener(PLAYER_EVENT, on);
    return () => document.removeEventListener(PLAYER_EVENT, on);
  }, []);
  if (!req) return null;
  const live = resolveBoard?.(req.boardId);
  const card = (live?.cards || []).find((c) => c.id === req.cardId) || req.card || null;
  if (!card || card.kind !== 'video') return null;
  const title = card.title || card.fileName || 'Video';
  const close = () => setReq(null);
  return (
    <Suspense fallback={null}>
      <FilmReview
        key={`${req.boardId}:${req.cardId}`}
        card={card} title={title}
        initialVersionId={req.versionId || null} initialFrame={Number.isFinite(req.frame) ? req.frame : null}
        onClose={close}
        onInfo={() => openInfo({ boardId: req.boardId, cardIds: [card.id] })}
        {...(renderRail ? renderRail({ req, card, live, close }) : {})}
      />
    </Suspense>
  );
}
