// AdminOutreachSection — the per-subject outreach log, shared by the Users tab
// (AdminUserDetail) and the Waitlist tab (AdminWaitlistDetail).
//
// Outreach is unified on email server-side (migration 0123): a note logged for a
// user shows on their waitlist entry and vice-versa, so nobody double-contacts.
// This component is deliberately generic — it just renders the list + a log form
// and calls back. The parent owns the actual RPC (by user_id or by email):
//   onLogOutreach(row, note)  -> Promise<boolean>   (true = clear the input)
//   onDeleteOutreach(row, id) -> Promise<any>
//
// `row` is opaque here — whatever the parent passes back to its handlers (a user
// list row, or a waitlist entry).

import { useState } from 'react';
import { MessageCircle as ChatCircle } from '../../lib/icons.js';
import { fmtDate } from '../../lib/adminFormat.js';
import { DetailSection } from './AdminUserDetailParts.jsx';

export function OutreachSection({ outreach, row, onLogOutreach, onDeleteOutreach }) {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const list = outreach || [];

  const submit = async (e) => {
    e?.preventDefault?.();
    if (submitting) return;
    setSubmitting(true);
    const ok = await onLogOutreach(row, note.trim() || null);
    setSubmitting(false);
    if (ok) setNote('');
  };

  const remove = async (id) => {
    setDeletingId(id);
    await onDeleteOutreach(row, id);
    setDeletingId(null);
  };

  return (
    <DetailSection title="Outreach" icon={ChatCircle}>
      <form className="admin-outreach-form" onSubmit={submit}>
        <input
          className="auth-input admin-outreach-input"
          type="text"
          placeholder="note (optional) — e.g. DM'd on IG re: pricing"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={submitting}
          aria-label="Outreach note"
        />
        <button type="submit" className="admin-action admin-action-primary admin-outreach-log" disabled={submitting}>
          {submitting ? 'Logging…' : 'Log outreach'}
        </button>
      </form>
      {list.length === 0 ? (
        <div className="admin-detail-note">No outreach logged yet — log a note when you reach out so nobody double-contacts them.</div>
      ) : (
        <div className="admin-detail-grants">
          {list.map((o) => (
            <div key={o.id} className="admin-detail-grant">
              <div className="admin-detail-grant-meta">
                <span>by <b>{o.reached_by_email || '—'}</b></span>
                {o.reached_at && <span>{fmtDate(o.reached_at)}</span>}
                <button
                  type="button"
                  className="admin-outreach-del"
                  title="Remove this entry"
                  disabled={deletingId === o.id}
                  onClick={() => remove(o.id)}
                  aria-label="Remove outreach entry"
                >
                  {deletingId === o.id ? '…' : '×'}
                </button>
              </div>
              {o.note && <div className="admin-detail-grant-note">{o.note}</div>}
            </div>
          ))}
        </div>
      )}
    </DetailSection>
  );
}
