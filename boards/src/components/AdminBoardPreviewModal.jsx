// AdminBoardPreviewModal — let an admin SEE a (possibly still-pending) board
// before approving it for the public /c/ + /explore surface.
//
// Leads with the board's own CANVAS RENDER (boards.thumb_key via
// /api/admin/preview-thumb/<board_id>): real card positions and sizes, the board
// background, note text, palettes, arrows — painted by renderThumbnail.js with
// the live UI's tokens. The card grid below it is the detail view. The grid
// alone was the original design and it was the wrong call: it shows what is ON
// a board but not what the board LOOKS like, and for a moodboard the
// arrangement is the artifact.
//
// Image bytes are streamed through the admin-gated worker routes rather than
// linked directly — a plain <img src> can't carry the admin bearer token and R2
// buckets are membership-scoped (0165), so each is fetch()ed WITH the admin's
// access token and shown via an object URL. For per-card images the ?i index is
// the card's position in the RPC's cards array (the worker re-resolves it).

import { useEffect, useState } from 'react';
import { Modal } from './Modal.jsx';
import { supabase } from '../lib/supabase.js';
import { fmtDate } from '../lib/adminFormat.js';
import { adminPreviewPublicBoard } from '../lib/boardsApi.js';

// Shared bearer-fetch → object URL. Both preview routes need it and neither can
// use a bare <img src>; keeping one implementation means one revoke path too.
function useAuthedBlobUrl(url, token, enabled = true) {
  const [state, setState] = useState({ url: null, failed: false });
  useEffect(() => {
    if (!enabled || !url) return undefined;
    let cancelled = false;
    let objUrl = null;
    (async () => {
      try {
        const res = await fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {} });
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (cancelled) return;
        objUrl = URL.createObjectURL(blob);
        setState({ url: objUrl, failed: false });
      } catch (_) {
        if (!cancelled) setState({ url: null, failed: true });
      }
    })();
    return () => { cancelled = true; if (objUrl) URL.revokeObjectURL(objUrl); };
  }, [url, token, enabled]);
  return state;
}

function PreviewImage({ boardId, index, token, alt }) {
  const { url, failed } = useAuthedBlobUrl(`/api/admin/preview-img/${boardId}?i=${index}`, token);
  if (failed) {
    return <div className="admin-preview-img admin-preview-img-missing" title={alt || ''}>image unavailable</div>;
  }
  if (!url) {
    return <div className="admin-preview-img admin-preview-img-loading" aria-busy="true" />;
  }
  return <img className="admin-preview-img" src={url} alt={alt || ''} loading="lazy" />;
}

// The board as it actually looks. bgColor matches the letterboxing to the
// board's own background so the render sits on its own colour, not on a
// modal-grey plate that would misrepresent a dark board as a floating tile.
function PreviewCanvas({ boardId, token, bgColor, renderedAt, hasThumb }) {
  const { url, failed } = useAuthedBlobUrl(`/api/admin/preview-thumb/${boardId}`, token, hasThumb);

  if (!hasThumb || failed) {
    return (
      <div className="admin-preview-canvas-empty t-meta">
        No canvas render stored for this board yet — the gallery below is the full contents.
      </div>
    );
  }
  return (
    <figure className="admin-preview-canvas">
      {url ? (
        <img className="admin-preview-canvas-img" src={url} alt="" style={bgColor ? { background: bgColor } : undefined} />
      ) : (
        <div className="admin-preview-canvas-img admin-preview-img-loading" aria-busy="true" />
      )}
      <figcaption className="admin-preview-canvas-cap t-meta">
        The board as it looks on canvas
        {renderedAt ? ` · rendered ${fmtDate(renderedAt)}` : ''}
      </figcaption>
    </figure>
  );
}

export function AdminBoardPreviewModal({ boardId, boardName, slug, onClose }) {
  const [data, setData] = useState(undefined);   // undefined=loading, null=error, obj=loaded
  const [token, setToken] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: s } = await supabase.auth.getSession();
        if (!cancelled) setToken(s?.session?.access_token || '');
      } catch (_) { /* image fetches will just fail visibly */ }
      try {
        const res = await adminPreviewPublicBoard(boardId);
        if (!cancelled) setData(res || { cards: [] });
      } catch (_) {
        if (!cancelled) setData(null);
      }
    })();
    return () => { cancelled = true; };
  }, [boardId]);

  const cards = Array.isArray(data?.cards) ? data.cards : [];
  // Keep the original array index — the worker's ?i= maps into this same list.
  const images = cards.map((c, i) => ({ ...c, _i: i })).filter((c) => c.kind === 'image' && c.media);
  const texts = cards.filter((c) => (c.kind === 'note' || c.kind === 'doc') && (c.title || c.body));
  const links = cards.filter((c) => c.kind === 'link');

  return (
    <Modal open onClose={onClose} className="admin-preview-modal"
           ariaLabel={`Preview ${boardName || 'board'}`} showClose>
      <div className="admin-preview-head">
        <h3 className="admin-preview-title">{boardName || 'Board preview'}</h3>
        {slug && <span className="t-meta admin-preview-slug">/c/{slug}</span>}
      </div>

      {data === undefined ? (
        <div className="admin-preview-note t-meta">Loading preview…</div>
      ) : data === null ? (
        <div className="admin-preview-note t-meta">Couldn’t load this board’s content.</div>
      ) : (
        <div className="admin-preview-body">
          {/* Always first, and NOT gated on cards.length: the gallery below only
              covers image/note/doc/link, so a board built from grids, palettes,
              shapes or videos renders an empty gallery while the canvas shows
              the whole thing. The old "no previewable cards yet" empty state
              was hiding real boards. */}
          <PreviewCanvas
            boardId={boardId}
            token={token}
            bgColor={data?.bg_color}
            renderedAt={data?.thumb_updated_at}
            hasThumb={!!data?.thumb_key}
          />

          {cards.length === 0 && (
            <div className="admin-preview-note t-meta">
              Nothing here is an image, note, doc or link — see the canvas above for the full board
              {data?.card_count ? ` (${data.card_count} cards)` : ''}.
            </div>
          )}

          {images.length > 0 && (
            <div className="admin-preview-grid">
              {images.map((c) => (
                <PreviewImage key={c.card_id} boardId={boardId} index={c._i} token={token}
                              alt={c.media?.alt || c.title || ''} />
              ))}
            </div>
          )}
          {texts.length > 0 && (
            <div className="admin-preview-texts">
              {texts.map((c) => (
                <div key={c.card_id} className="admin-preview-text">
                  {c.title && <div className="admin-preview-text-title">{c.title}</div>}
                  {c.body && <div className="admin-preview-text-body">{c.body}</div>}
                </div>
              ))}
            </div>
          )}
          {links.length > 0 && (
            <div className="admin-preview-links">
              {links.map((c) => (
                <a key={c.card_id} className="admin-preview-link" href={c.href || '#'}
                   target="_blank" rel="noopener noreferrer">
                  {c.title || c.href}
                </a>
              ))}
            </div>
          )}
          {data?.truncated && <div className="t-meta admin-preview-note">Showing the first 200 cards.</div>}
        </div>
      )}
    </Modal>
  );
}
