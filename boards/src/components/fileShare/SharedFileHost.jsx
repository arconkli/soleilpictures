// A file shared with you, opened inside the app: the /f/ page's view as a
// dialog over whatever you were doing (FileSharePage, variant 'overlay').
// Anything opens it with openSharedFile({ token, via }) (lib/sharedFileBus.js):
// the Shared page, the bell, a toast, a shortcut card, and the /f/ page's
// "Open in Clusters" (/?shared=<token>).
//
// The host adds "Add to cluster": Save a copy (only when the person who shared
// it allows downloading) and, where the app offers it, Add shortcut. What
// those do lives in App (the cluster picker, the walls, the toasts); this only
// asks.
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { SHARED_FILE_EVENT, notifySharedFilesChanged } from '../../lib/sharedFileBus.js';
import { FILE_TOKEN_RE } from '../../lib/fileShareBundle.js';
import * as modalGuard from '../../lib/modalGuard.js';
import { logEvent } from '../../lib/analytics.js';
import { EV } from '../../lib/analyticsEvents.js';
import { Icon } from '../Icon.jsx';
import { ChevronDown } from '../../lib/icons.js';

const FileSharePage = lazy(() => import('./FileSharePage.jsx').then((m) => ({ default: m.FileSharePage })));

const SAVEABLE = new Set(['image', 'video', 'audio', 'pdf', 'file']);

function AddToCluster({ token, res, onSaveCopy, onAddShortcut }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const canSave = !!onSaveCopy && res?.allow_download === true && SAVEABLE.has(res?.file?.kind);
  const canShortcut = !!onAddShortcut;

  // While the menu is open it is the top layer: Escape closes it, not the viewer.
  useEffect(() => {
    if (!open) return undefined;
    const unregister = modalGuard.registerModalOpen();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); btnRef.current?.focus(); }
    };
    const onDown = (e) => {
      if (!menuRef.current?.contains(e.target) && !btnRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    requestAnimationFrame(() => menuRef.current?.querySelector('[role="menuitem"]')?.focus());
    return () => {
      unregister();
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [open]);

  if (!canSave && !canShortcut) return null;
  const run = async (fn, what) => {
    setOpen(false);
    setBusy(true);
    try { await fn({ token, res, what }); } finally { setBusy(false); notifySharedFilesChanged(); }
  };
  return (
    <span className="fsp-addto">
      <button ref={btnRef} type="button" className="fsp-btn" aria-haspopup="menu" aria-expanded={open}
              disabled={busy} onClick={() => setOpen((o) => !o)}>
        {busy ? 'Saving…' : 'Add to cluster'}
        <Icon as={ChevronDown} size={13} weight="regular" />
      </button>
      {open && (
        <div ref={menuRef} className="fsp-menu" role="menu" aria-label="Add to cluster"
             onKeyDown={(e) => {
               if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
               e.preventDefault();
               const items = [...(menuRef.current?.querySelectorAll('[role="menuitem"]') || [])];
               const i = items.indexOf(document.activeElement);
               items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
             }}>
          {canSave && (
            <button type="button" role="menuitem" className="fsp-menu-item" onClick={() => run(onSaveCopy, 'copy')}>
              <span className="fsp-menu-title">Save a copy</span>
              <span className="fsp-menu-sub">Yours to keep. Uses your storage.</span>
            </button>
          )}
          {canShortcut && (
            <button type="button" role="menuitem" className="fsp-menu-item" onClick={() => run(onAddShortcut, 'shortcut')}>
              <span className="fsp-menu-title">Add shortcut</span>
              <span className="fsp-menu-sub">Stays in sync with theirs.</span>
            </button>
          )}
        </div>
      )}
    </span>
  );
}

export function SharedFileHost({ onSaveCopy = null, onAddShortcut = null, api = null }) {
  const [req, setReq] = useState(null);
  useEffect(() => {
    const on = (e) => {
      const d = e.detail || {};
      if (!FILE_TOKEN_RE.test(String(d.token || ''))) return;
      setReq({ token: String(d.token).toLowerCase(), via: d.via || null, seq: Date.now() });
      logEvent(EV.SHARED_FILE_OPEN, { via: d.via || null });
    };
    document.addEventListener(SHARED_FILE_EVENT, on);
    // The /f/ page's "Open in Clusters" lands here with ?shared=<token>.
    try {
      const params = new URLSearchParams(window.location.search);
      const t = params.get('shared');
      if (t && FILE_TOKEN_RE.test(t)) {
        params.delete('shared');
        const q = params.toString();
        window.history.replaceState(window.history.state, '', `${window.location.pathname}${q ? `?${q}` : ''}${window.location.hash}`);
        setReq({ token: t.toLowerCase(), via: 'link', seq: Date.now() });
        logEvent(EV.SHARED_FILE_OPEN, { via: 'link' });
      }
    } catch (_) { /* no URL to read */ }
    return () => document.removeEventListener(SHARED_FILE_EVENT, on);
  }, []);
  const close = useCallback(() => { setReq(null); notifySharedFilesChanged(); }, []);
  if (!req) return null;
  return (
    <Suspense fallback={null}>
      <FileSharePage key={req.seq} token={req.token} variant="overlay" onClose={close}
                     {...(api ? { api } : {})}
                     renderActions={(res) => (
                       <AddToCluster token={req.token} res={res} onSaveCopy={onSaveCopy} onAddShortcut={onAddShortcut} />
                     )} />
    </Suspense>
  );
}

export default SharedFileHost;
