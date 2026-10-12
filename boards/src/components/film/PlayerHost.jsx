// The review player, mounted once per app shell (App.jsx, LocalBoardsApp.jsx)
// beside the Info drawer. Anything opens it with openPlayer(): the ⤢ on a
// video card, Quick look, Info → Versions, a frame link. It reads the LIVE
// card on every render, so a new version arriving while it's open shows up in
// its picker.
//
//   openPlayer({ boardId, cardId, versionId?, frame?, time?, playing?, card?, onDownload? })
//   time     where the opener was (seconds) — a moment, so it lands on the
//            same picture whatever rate each side counted in
//   playing  whether to carry on playing (default: start playing, unless a
//            frame or time was given)
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { PLAYER_EVENT } from '../../lib/playerBus.js';

const FilmReview = lazy(() => import('./FilmReview.jsx').then((m) => ({ default: m.FilmReview })));

export const PLAYER_CLOSED_EVENT = 'soleil-player-closed';

export function PlayerHost({ resolveBoard, renderRail = null }) {
  const [req, setReq] = useState(null);
  useEffect(() => {
    const on = (e) => {
      const d = e.detail || {};
      if (d.close) { setReq(null); return; }
      if (d.boardId && d.cardId) setReq({ ...d });
    };
    document.addEventListener(PLAYER_EVENT, on);
    return () => document.removeEventListener(PLAYER_EVENT, on);
  }, []);
  const playerRef = useRef(null);
  const reqRef = useRef(req);
  reqRef.current = req;
  // Closing tells the card where the review left off, so it shows that frame.
  const close = useCallback(() => {
    const r = reqRef.current;
    const st = playerRef.current?.getState?.();
    if (r && Number.isFinite(st?.time)) {
      document.dispatchEvent(new CustomEvent(PLAYER_CLOSED_EVENT, { detail: { boardId: r.boardId, cardId: r.cardId, time: st.time } }));
    }
    setReq(null);
  }, []);
  if (!req) return null;
  const live = resolveBoard?.(req.boardId);
  const card = (live?.cards || []).find((c) => c.id === req.cardId) || req.card || null;
  if (!card || card.kind !== 'video') return null;
  const title = card.title || card.fileName || 'Video';
  const hasPos = Number.isFinite(req.frame) || Number.isFinite(req.time);
  return (
    <Suspense fallback={null}>
      <FilmReview
        key={`${req.boardId}:${req.cardId}`}
        card={card} title={title}
        initialVersionId={req.versionId || null}
        initialFrame={Number.isFinite(req.frame) && !Number.isFinite(req.time) ? req.frame : null}
        initialTime={Number.isFinite(req.time) ? req.time : null}
        autoPlay={req.playing != null ? !!req.playing : !hasPos}
        onDownload={req.onDownload || null}
        boardId={req.boardId} cardId={req.cardId}
        onClose={close}
        playerRef={playerRef}
        {...(renderRail ? renderRail({ req, card, live, close }) : {})}
      />
    </Suspense>
  );
}
