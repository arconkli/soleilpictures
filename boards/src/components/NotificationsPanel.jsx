// The bell: the notification list, what changed and when. Rows persist until
// read (public.notifications, 0242), unlike share_notifications /
// mention_notifications, which are toast queues their consumers batch-dismiss
// ~8s after rendering.
//
// It had a second section, YOUR SCHEDULE, every dated cluster you could reach.
// Schedule is retired (owner, 2026-10-20: nothing related to it on
// production), so the list is all the panel is now.

import { useEffect, useRef } from 'react';
import { Icon } from './Icon.jsx';
import { X, Check } from '../lib/icons.js';
import { logEvent } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { escapeClosesPanel } from '../lib/panelEscape.js';
import { fileSharesAllowed, sharedFilesAllowed } from '../lib/appHost.js';
import { openSharedFile } from '../lib/sharedFileBus.js';
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

export function NotificationsPanel({
  items = [], unread = 0, loading = false,
  onOpenBoard = null, onMarkRead = null, onClose = null,
}) {
  // Escape closes the panel, as its "Close (Esc)" says — nothing handled it
  // (COMMS-22). The panel takes focus when it opens so the key reaches it;
  // a press meant for something outside the panel is left alone.
  const rootRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    try { rootRef.current?.focus({ preventScroll: true }); } catch (_) {}
    const onKey = (e) => { if (escapeClosesPanel(e, '.ntf-panel')) onCloseRef.current?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="ntf-panel" ref={rootRef} tabIndex={-1}>
      <div className="ntf-head">
        <div className="ntf-title">Notifications</div>
        {unread > 0 && (
          <button type="button" className="ntf-head-btn" onClick={() => onMarkRead?.(null)}
            title="Mark everything read">
            <Icon as={Check} size={12} />
            <span>Mark read</span>
          </button>
        )}
        <button type="button" className="ntf-head-icon" onClick={onClose}
          title="Close (Esc)" aria-label="Close notifications">
          <Icon as={X} size={13} />
        </button>
      </div>

      <div className="ntf-body">
        <div className="ntf-eyebrow">Updates{unread > 0 ? ` · ${unread} new` : ''}</div>
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
                  onClick={() => {
                    // The bell shipped with no instrumentation at all, so
                    // whether anyone acts on a notification has never been
                    // answerable. `kind` says which producer a click came
                    // from.
                    try {
                      logEvent(EV.NOTIF_CLICK, {
                        kind: n.kind || null,
                        was_unread: !n.read_at,
                        opened_board: !!n.board_id,
                      });
                    } catch (_) {}
                    onMarkRead?.([n.id]);
                    if (String(n.kind || '').startsWith('file.') && n.data?.token && fileSharesAllowed()) {
                      // Inside the app, over what you were doing; before the
                      // Shared page shipped, its page in a new tab.
                      if (sharedFilesAllowed()) openSharedFile({ token: n.data.token, via: 'bell' });
                      else window.open('/f/' + encodeURIComponent(n.data.token), '_blank', 'noopener');
                      return;
                    }
                    if (n.board_id) onOpenBoard?.(n.board_id);
                  }}>
                  <span className={`ntf-kind ntf-kind-${String(n.kind || '').split('.')[1] || 'other'}`}
                    aria-hidden="true" />
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
  );
}
