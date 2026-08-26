// The bell. Two sections, and the second is the point.
//
// UPDATES is the notification list — what changed and when. Rows persist until
// read (public.notifications, 0242), unlike share_notifications /
// mention_notifications, which are toast queues their consumers batch-dismiss
// ~8s after rendering.
//
// YOUR SCHEDULE is the phrase made literal: every dated cluster you can reach,
// from today forward, whichever production it belongs to. Without it a
// notification saying a day moved has nowhere useful to point — you would know
// something changed and still not know what you are called for.

import { useMemo } from 'react';
import { Icon } from './Icon.jsx';
import { X, Calendar, Check } from '../lib/icons.js';
import { parseISO, dayTitle, shortDate, todayISO, daysBetween } from '../lib/schedDates.js';
import { logEvent } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import './notificationsPanel.css';

// "in 3 days" / "today" / "tomorrow" — a crew member reads relative time faster
// than a date, and the date is right there next to it anyway.
function whenLabel(iso, today = todayISO()) {
  if (!parseISO(iso)) return '';
  if (iso === today) return 'Today';
  const ahead = daysBetween(today, iso);
  if (ahead === 1) return 'Tomorrow';
  if (ahead > 0) return `in ${ahead} day${ahead === 1 ? '' : 's'}`;
  const back = daysBetween(iso, today);
  return back === 1 ? 'Yesterday' : `${back} days ago`;
}

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
  items = [], schedule = [], unread = 0, loading = false,
  onOpenBoard = null, onMarkRead = null, onClose = null,
}) {
  const today = todayISO();
  // Group the schedule by date so a day with two units reads as one heading
  // rather than two near-identical rows.
  const byDate = useMemo(() => {
    const out = [];
    for (const row of schedule || []) {
      const last = out[out.length - 1];
      if (last && last.date === row.scheduled_date) last.rows.push(row);
      else out.push({ date: row.scheduled_date, rows: [row] });
    }
    return out;
  }, [schedule]);

  return (
    <div className="ntf-panel">
      <div className="ntf-head">
        <div className="ntf-title">Schedule</div>
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
            Nothing yet. When a shoot day moves or a call sheet is published,
            it lands here.
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
                    // answerable. `kind` is what separates one producer from
                    // another once more than one fills this list.
                    try {
                      logEvent(EV.NOTIF_CLICK, {
                        kind: n.kind || null,
                        was_unread: !n.read_at,
                        opened_board: !!n.board_id,
                      });
                    } catch (_) {}
                    onMarkRead?.([n.id]);
                    if (n.board_id) onOpenBoard?.(n.board_id);
                  }}>
                  <span className={`ntf-kind ntf-kind-${String(n.kind || '').split('.')[1] || 'other'}`}
                    aria-hidden="true" />
                  <span className="ntf-row-main">
                    <span className="ntf-row-title">{n.title}</span>
                    {n.body && <span className="ntf-row-body">{n.body}</span>}
                    {n.data?.production_name && (
                      <span className="ntf-row-meta">{n.data.production_name}</span>
                    )}
                  </span>
                  <span className="ntf-row-ago">{agoLabel(n.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="ntf-eyebrow ntf-eyebrow-2">Your schedule</div>
        {byDate.length === 0 ? (
          <div className="ntf-empty">
            No upcoming days. Dated clusters you can reach show up here.
          </div>
        ) : (
          <ul className="ntf-sched">
            {byDate.map(({ date, rows }) => (
              <li key={date} className={`ntf-day${date === today ? ' is-today' : ''}`}>
                <div className="ntf-day-head">
                  <Icon as={Calendar} size={11} />
                  <span className="ntf-day-date">{dayTitle(date)}</span>
                  <span className="ntf-day-when">{whenLabel(date, today)}</span>
                </div>
                {rows.map((r) => (
                  <button key={r.board_id} type="button"
                    className={`ntf-sched-row is-${r.sched_status || 'draft'}`}
                    onClick={() => onOpenBoard?.(r.board_id)}>
                    <span className="ntf-sched-label">{r.day_label || r.board_name}</span>
                    {r.scheduled_end && r.scheduled_end !== r.scheduled_date && (
                      <span className="ntf-sched-span">→ {shortDate(r.scheduled_end)}</span>
                    )}
                    {r.sched_status === 'published' && r.sched_version > 0 && (
                      <span className="ntf-sched-v">v{r.sched_version}</span>
                    )}
                    {r.sched_status === 'draft' && <span className="ntf-sched-tag">draft</span>}
                    {r.sched_status === 'cancelled' && <span className="ntf-sched-tag">cancelled</span>}
                    {r.unread_count > 0 && <span className="ntf-sched-dot" aria-label="Changed" />}
                    <span className="ntf-sched-prod">{r.production_name || ''}</span>
                  </button>
                ))}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
