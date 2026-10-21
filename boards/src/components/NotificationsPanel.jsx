// The bell's list: what changed and when. Rows persist until read
// (public.notifications, 0242), unlike share_notifications /
// mention_notifications, which are toast queues their consumers batch-dismiss
// ~8s after rendering.
//
// It had a second section, YOUR SCHEDULE, every dated cluster you could reach.
// Schedule is retired (owner, 2026-10-20: nothing related to it on
// production), so the list is all the panel is now.
//
// Placement C (owner's pick, 2026-10-21): on a desktop it drops from the bell
// in the board's right island, in the sidebar's popover glass, its right edge
// on the island's and its top 8px under it; it closes on Escape, on a press
// outside it and the bell, or on the bell. On a phone (or a window too narrow
// for it) it is a full-screen sheet with its own ×. `anchorRef` is the bell.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './Icon.jsx';
import { X, Check } from '../lib/icons.js';
import { logEvent } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { escapeClosesPanel } from '../lib/panelEscape.js';
import { fileSharesAllowed, sharedFilesAllowed } from '../lib/appHost.js';
import { openSharedFile } from '../lib/sharedFileBus.js';
import { notificationTarget, placeUnderIsland, wantsNotificationSheet } from '../lib/notificationsBell.js';
import './notificationsPanel.css';

function agoLabel(ts) {
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

// The box the panel hangs from: the island the bell sits in, else the bell.
function anchorBox(el) {
  if (!el) return null;
  return (el.closest?.('.chrome-island') || el).getBoundingClientRect();
}

export function NotificationsPanel({
  items = [], unread = 0, loading = false,
  onOpenBoard = null, onOpenSettings = null, onMarkRead = null, onClose = null,
  anchorRef = null, mobileShell = false,
}) {
  // Escape closes the panel (COMMS-22). The panel takes focus when it opens so
  // the key reaches it; a press meant for something outside the panel is left
  // alone.
  const rootRef = useRef(null);
  const shellRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    try { rootRef.current?.focus({ preventScroll: true }); } catch (_) {}
    const onKey = (e) => { if (escapeClosesPanel(e, '.ntf-panel')) onCloseRef.current?.(); };
    window.addEventListener('keydown', onKey);
    // A press outside the panel and the bell closes it (the bell toggles it
    // itself, so a press there must not close it first and reopen it).
    const onDown = (e) => {
      if (shellRef.current?.contains(e.target)) return;
      if (anchorRef?.current?.contains(e.target)) return;
      onCloseRef.current?.();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
      // Closing with focus still inside (Escape, a row, the ×) hands it back
      // to the bell, not to <body>.
      const a = document.activeElement;
      if (!a || a === document.body || shellRef.current?.contains(a)) {
        try { anchorRef?.current?.focus({ preventScroll: true }); } catch (_) {}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [sheet, setSheet] = useState(() => wantsNotificationSheet({ mobileShell, viewportWidth: viewport().width }));
  const [place, setPlace] = useState(() => placeUnderIsland(anchorBox(anchorRef?.current), viewport()));
  useLayoutEffect(() => {
    const measure = () => {
      const vp = viewport();
      setSheet(wantsNotificationSheet({ mobileShell, viewportWidth: vp.width }));
      setPlace(placeUnderIsland(anchorBox(anchorRef?.current), vp));
    };
    measure();
    window.addEventListener('resize', measure);
    // The island changes width (a count appears, the upgrade chip comes or
    // goes) without the window resizing.
    let ro = null;
    const island = anchorRef?.current?.closest?.('.chrome-island');
    if (island && typeof ResizeObserver === 'function') { ro = new ResizeObserver(measure); ro.observe(island); }
    return () => { window.removeEventListener('resize', measure); ro?.disconnect(); };
  }, [mobileShell, anchorRef]);

  const open = (n) => {
    // `kind` says which producer a click came from: a notification nobody
    // clicked and a bell nobody opened are different failures.
    try {
      logEvent(EV.NOTIF_CLICK, {
        kind: n.kind || null,
        was_unread: !n.read_at,
        opened_board: !!n.board_id,
      });
    } catch (_) {}
    onMarkRead?.([n.id]);
    const target = notificationTarget(n, { fileShares: fileSharesAllowed(), sharedFiles: sharedFilesAllowed() });
    if (!target) return;
    if (target.kind === 'file') {
      // Inside the app, over what you were doing; before the Shared page
      // shipped, its page in a new tab.
      if (target.inApp) openSharedFile({ token: target.token, via: 'bell' });
      else window.open('/f/' + encodeURIComponent(target.token), '_blank', 'noopener');
      return;
    }
    if (target.kind === 'settings') {
      // An editor-limit row: Members, in that row's workspace.
      onOpenSettings?.(target.tab, target.workspaceId);
      onCloseRef.current?.();
      return;
    }
    onOpenBoard?.(target.boardId);
  };

  return (
    <div className={`ntf-shell${sheet ? ' is-sheet' : ''}`} ref={shellRef}
      role="dialog" aria-label="Notifications"
      style={sheet ? undefined : { top: place.top, right: place.right }}>
    <div className="ntf-panel" ref={rootRef} tabIndex={-1}>
      <div className="ntf-head">
        <div className="ntf-title">Notifications</div>
        {unread > 0 && (
          <button type="button" className="ntf-markall" onClick={() => onMarkRead?.(null)}>
            <Icon as={Check} size={sheet ? 14 : 12} />
            <span>Mark all read</span>
          </button>
        )}
        {sheet && (
          <button type="button" className="ntf-x" onClick={() => onCloseRef.current?.()}
            title="Close" aria-label="Close notifications">
            <Icon as={X} size={18} />
          </button>
        )}
      </div>

      <div className="ntf-body">
        {loading && items.length === 0 ? (
          <div className="ntf-empty">Loading…</div>
        ) : items.length === 0 ? (
          <div className="ntf-empty">
            Nothing yet. When someone shares a file with you or comments
            on one, it lands here.
          </div>
        ) : (
          <ul className="ntf-list">
            {items.map((n) => (
              <li key={n.id}>
                <button type="button"
                  className={`ntf-row${n.read_at ? '' : ' is-unread'}`}
                  data-kind={n.kind || undefined}
                  onClick={() => open(n)}>
                  <span className="ntf-dot" aria-hidden="true" />
                  <span className="ntf-row-main">
                    <span className="ntf-row-title">{n.title}</span>
                    {n.body && <span className="ntf-row-body">{n.body}</span>}
                  </span>
                  <span className="ntf-row-ago">{agoLabel(n.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
    </div>
  );
}
