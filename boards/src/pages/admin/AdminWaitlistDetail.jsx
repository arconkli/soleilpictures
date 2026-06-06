// AdminWaitlistDetail — right pane of the two-pane Waitlist tab.
//
// The list RPC already returns the full entry (incl. its outreach log), so this
// pane does no fetching — the shell passes the selected row + handlers. Shows all
// links (un-truncated), timezone, a status timeline, status-appropriate actions
// (accept / reschedule / reject / reopen), and the shared Outreach log.

import { useState } from 'react';
import { CopyableText } from '../../components/CopyableText.jsx';
import { Icon } from '../../components/Icon.jsx';
import { Inbox, Check, RotateCcw, Link as LinkIcon, Clock } from '../../lib/icons.js';
import { fmtDate, fmtDateTime, relativeTime, isoToLocalInput, localInputToIso } from '../../lib/adminFormat.js';
import { StatusPill } from './AdminPills.jsx';
import { DetailSection } from './AdminUserDetailParts.jsx';
import { OutreachSection } from './AdminOutreachSection.jsx';

function localInputString(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function LinksSection({ links }) {
  const list = Array.isArray(links) ? links.filter(Boolean) : [];
  return (
    <DetailSection title="Links" icon={LinkIcon}>
      {list.length === 0 ? (
        <div className="admin-detail-note">No links submitted.</div>
      ) : (
        <ul className="admin-wl-links">
          {list.map((l, i) => (
            <li key={i}>
              <a href={/^https?:\/\//.test(l) ? l : `https://${l}`} target="_blank" rel="noreferrer" className="admin-link">
                {String(l).replace(/^https?:\/\//, '')}
              </a>
            </li>
          ))}
        </ul>
      )}
    </DetailSection>
  );
}

function TimelineSection({ entry }) {
  const steps = [
    { key: 'joined',    label: 'Joined',    at: entry.created_at, reached: !!entry.created_at },
    { key: 'scheduled', label: 'Scheduled', at: entry.scheduled_accept_at, reached: !!entry.scheduled_accept_at },
  ];
  if (entry.status === 'accepted')      steps.push({ key: 'accepted', label: 'Accepted', at: entry.accepted_at, reached: true });
  else if (entry.status === 'rejected') steps.push({ key: 'rejected', label: 'Rejected', at: entry.rejected_at, reached: true });
  else                                  steps.push({ key: 'pending',  label: entry.status === 'pending' ? 'Awaiting review' : entry.status, at: null, reached: false });

  return (
    <DetailSection title="Timeline" icon={Clock}>
      <ol className="admin-timeline">
        {steps.map((s) => (
          <li key={s.key} className={`admin-timeline-step ${s.reached ? 'is-reached' : 'is-pending'} ${s.key === 'accepted' ? 'is-paid' : ''}`} title={s.at ? fmtDateTime(s.at) : s.label}>
            <span className="admin-timeline-node" />
            <span className="admin-timeline-label">{s.label}</span>
            <span className="admin-timeline-date">{s.at ? fmtDate(s.at) : '—'}</span>
          </li>
        ))}
      </ol>
      {entry.reviewed_by_email && (
        <div className="admin-detail-note">Last reviewed by <b>{entry.reviewed_by_email}</b></div>
      )}
    </DetailSection>
  );
}

function Row({ label, children }) {
  return (<><dt>{label}</dt><dd>{children}</dd></>);
}

function DetailsSection({ entry }) {
  return (
    <DetailSection title="Details" icon={Inbox}>
      <dl className="admin-detail-kv">
        <Row label="Status"><StatusPill kind={entry.status} /></Row>
        <Row label="Scheduled">{entry.scheduled_accept_at ? fmtDateTime(entry.scheduled_accept_at) : '—'}</Row>
        <Row label="Timezone">{entry.timezone || <span className="is-muted">—</span>}</Row>
        <Row label="Joined">{fmtDate(entry.created_at)}</Row>
        <Row label="Account">{entry.user_id ? <span className="is-strong">signed up</span> : <span className="is-muted">not yet signed up</span>}</Row>
      </dl>
    </DetailSection>
  );
}

function ActionsSection({ entry, busy, onAccept, onReject, onReschedule, onReopen }) {
  const [draft, setDraft] = useState('');
  const minLocal = localInputString(new Date());
  const value = draft || isoToLocalInput(entry.scheduled_accept_at) || '';

  const setDate = () => {
    const iso = localInputToIso(value);
    if (iso) onReschedule(entry, { scheduled_at: iso });
  };

  return (
    <DetailSection title="Actions" icon={Check}>
      {entry.status === 'pending' ? (
        <div className="admin-wl-actions">
          <button className="admin-action admin-action-primary" disabled={busy} onClick={() => onAccept(entry)}>
            <Icon as={Check} size={13} /> Accept now
          </button>
          <div className="admin-wl-resched">
            <input
              type="datetime-local"
              className="auth-input admin-wl-when"
              min={minLocal}
              value={value}
              disabled={busy}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button className="admin-action" disabled={busy} onClick={setDate} title="Reschedule to the selected date/time">Set</button>
            <button className="admin-action" disabled={busy} onClick={() => onReschedule(entry, { days: 7 })}>+7d</button>
          </div>
          <button className="admin-action admin-action-danger" disabled={busy} onClick={() => onReject(entry)}>Reject</button>
        </div>
      ) : (
        <div className="admin-wl-actions">
          <button className="admin-action" disabled={busy} onClick={() => onReopen(entry)}>
            <Icon as={RotateCcw} size={13} /> Move back to pending
          </button>
          {entry.status === 'accepted' && (
            <span className="admin-detail-note" style={{ marginTop: 0 }}>Re-opening revokes access (demo → waitlist) until re-accepted.</span>
          )}
        </div>
      )}
    </DetailSection>
  );
}

export function AdminWaitlistDetail({
  entry, busy, isOpen, onClose,
  onAccept, onReject, onReschedule, onReopen, onLogOutreach, onDeleteOutreach,
}) {
  if (!entry) {
    return (
      <div className="admin-users-detail">
        <div className="admin-detail-empty">
          <span className="admin-detail-empty-icon"><Icon as={Inbox} size={26} /></span>
          <div className="admin-detail-empty-title">Select an entry</div>
          <div className="admin-detail-empty-hint">
            Pick someone on the left to review their links, schedule their access, and log outreach.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`admin-users-detail ${isOpen ? 'is-open' : ''}`}>
      <div className="admin-detail-header">
        <div className="admin-detail-id">
          <div className="admin-detail-idtext">
            <h3 className="admin-detail-name">{entry.email}</h3>
            <div className="admin-detail-email"><CopyableText value={entry.email} /></div>
          </div>
          <button type="button" className="admin-detail-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="admin-detail-controls">
          <StatusPill kind={entry.status} />
        </div>
      </div>

      <div className="admin-detail-body">
        <ActionsSection entry={entry} busy={busy} onAccept={onAccept} onReject={onReject} onReschedule={onReschedule} onReopen={onReopen} />
        <OutreachSection outreach={entry.outreach} row={entry} onLogOutreach={onLogOutreach} onDeleteOutreach={onDeleteOutreach} />
        <LinksSection links={entry.links} />
        <TimelineSection entry={entry} />
        <DetailsSection entry={entry} />
      </div>
    </div>
  );
}
