// A live shortcut to a file or doc shared with you (owner, 2026-10-18). The
// card stores the share's token and nothing else (never the file's name: the
// card's index row stays nameless, lib/cardIndexRow.js). What it shows is what
// the share shows whoever is looking, read when it draws through /f/'s own
// answer (lib/fileShareUrls.js ensureShare):
//   ok        the file's preview, its name, and who shared it;
//   no access someone in the cluster it was not shared with: "Shared file",
//             nothing more;
//   gone      the share was stopped or the file deleted: "No longer shared",
//             with Remove, rather than vanishing on its own.
// A newer version from the sharer shows by itself: the share follows its
// card's current file. Double-click opens it in the in-app viewer
// (CanvasSurface → openSharedFile). On a public board nothing is asked: the
// tile is neutral.
import { useEffect, useState } from 'react';
import { R2Image } from '../R2Image.jsx';
import { Icon } from '../Icon.jsx';
import { KindIcon } from '../cards.jsx';
import { ArrowSquareOut } from '../../lib/icons.js';
import { ensureShare, fsRef, shareEntry, subscribeShares } from '../../lib/fileShareUrls.js';
import './shortcutCard.css';

const KIND_WORD = { image: 'Image', video: 'Video', audio: 'Audio', pdf: 'PDF', file: 'File', doc: 'Doc' };

// The share as this viewer sees it: { status, res }.
function useShare(token, { enabled, api }) {
  const [state, setState] = useState(() => {
    const have = enabled ? shareEntry(token) : null;
    return have ? { status: 'ok', res: have } : { status: enabled ? 'loading' : 'off', res: null };
  });
  useEffect(() => {
    if (!enabled || !token) return undefined;
    let off = false;
    const read = (force = false) => {
      Promise.resolve(ensureShare(token, { force, api })).then((r) => {
        if (off) return;
        const status = r?.status === 'ok' ? 'ok'
          : r?.status === 'gone' ? 'gone'
          : r?.status === 'sign_in' || r?.status === 'no_access' ? 'no_access'
          : 'error';
        setState({ status, res: status === 'ok' ? r : null });
      });
    };
    read();
    // Another view of the same share learned something (the viewer, a refresh).
    const unsub = subscribeShares((t) => { if (t === String(token).toLowerCase()) read(); });
    return () => { off = true; unsub(); };
  }, [token, enabled, api]);
  return state;
}

export function ShortcutCard({ shareToken, isPublic = false, onRemove = null, api = null }) {
  const { status, res } = useShare(shareToken, { enabled: !!shareToken && !isPublic, api });

  if (status === 'loading') {
    return <div className="sc-card is-loading" aria-busy="true"><div className="sc-thumb" /><div className="sc-meta" /></div>;
  }
  if (status !== 'ok' || !res) {
    const gone = status === 'gone';
    return (
      <div className={`sc-card is-empty${gone ? ' is-gone' : ''}`} data-shortcut-state={status}>
        <span className="sc-badge" aria-hidden="true"><Icon as={ArrowSquareOut} size={12} /></span>
        <div className="sc-empty-body">
          <div className="sc-empty-title">{gone ? 'No longer shared' : 'Shared file'}</div>
          <div className="sc-empty-sub">
            {gone ? 'The person who shared it stopped sharing it.'
              : status === 'error' ? "Couldn't reach it just now."
              : 'Only the people it was shared with can open it.'}
          </div>
          {gone && onRemove && (
            <button type="button" className="sc-remove" onClick={(e) => { e.stopPropagation(); onRemove(); }}>Remove</button>
          )}
        </div>
      </div>
    );
  }
  const file = res.file || {};
  const kind = file.kind || 'file';
  const urls = res.urls || {};
  const thumb = urls.poster ? fsRef(shareToken, 'poster') : kind === 'image' && urls.src ? fsRef(shareToken, 'src') : null;
  const by = res.shared_by?.name || 'Someone on Clusters';
  return (
    <div className="sc-card" data-shortcut-state="ok" title={`${file.name || 'Shared file'}, shared by ${by}`}>
      <div className="sc-thumb">
        {thumb
          ? <R2Image src={thumb} alt="" className="sc-thumb-img" />
          : <span className="sc-thumb-icon" aria-hidden="true"><KindIcon kind={kind} size={30} /></span>}
        <span className="sc-badge" aria-hidden="true"><Icon as={ArrowSquareOut} size={12} /></span>
      </div>
      <div className="sc-meta">
        <div className="sc-name">{file.name || 'Shared file'}</div>
        <div className="sc-sub">{KIND_WORD[kind] || 'File'} · Shared by {by}</div>
      </div>
    </div>
  );
}

export default ShortcutCard;
