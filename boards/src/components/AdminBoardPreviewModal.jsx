// AdminBoardPreviewModal — let an admin SEE a (possibly still-pending) board's
// content before approving it for the public /c/ + /explore surface. Renders the
// board's images plus its note/doc text and links as a read-only gallery (a
// canvas isn't needed to judge quality/appropriateness).
//
// Image bytes are streamed through the admin-gated worker route
// /api/admin/preview-img/<board_id>?i=<index> — a plain <img src> can't carry the
// admin bearer token and R2 buckets are membership-scoped (0165), so each image
// is fetch()ed WITH the admin's access token and shown via an object URL. The ?i
// index is the card's position in the RPC's cards array (worker re-resolves it).

import { useEffect, useState } from 'react';
import { Modal } from './Modal.jsx';
import { supabase } from '../lib/supabase.js';
import { adminPreviewPublicBoard } from '../lib/boardsApi.js';

function PreviewImage({ boardId, index, token, alt }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objUrl = null;
    (async () => {
      try {
        const res = await fetch(`/api/admin/preview-img/${boardId}?i=${index}`, {
          headers: token ? { authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (cancelled) return;
        objUrl = URL.createObjectURL(blob);
        setUrl(objUrl);
      } catch (_) {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; if (objUrl) URL.revokeObjectURL(objUrl); };
  }, [boardId, index, token]);

  if (failed) {
    return <div className="admin-preview-img admin-preview-img-missing" title={alt || ''}>image unavailable</div>;
  }
  if (!url) {
    return <div className="admin-preview-img admin-preview-img-loading" aria-busy="true" />;
  }
  return <img className="admin-preview-img" src={url} alt={alt || ''} loading="lazy" />;
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
      ) : cards.length === 0 ? (
        <div className="admin-preview-note t-meta">This board has no previewable cards yet.</div>
      ) : (
        <div className="admin-preview-body">
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
