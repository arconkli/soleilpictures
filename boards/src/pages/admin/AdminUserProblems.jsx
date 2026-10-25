// AdminUserProblems — what one person ran into, in the Users drawer (0582's
// admin_user_errors): the problems their account and their browsers hit in the
// last 30 days, newest first, rows from before they signed in included. A
// problem whose latest occurrence came from a browser session opens that
// browser's trail around it (AdminIssueTrail, as in Admin, Errors).

import { useCallback, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { kindLabel } from '../../lib/adminIssues.js';
import { fmtDateTime, relativeTime, formatCount } from '../../lib/adminFormat.js';
import { Warning } from '../../lib/icons.js';
import { useAdminData } from './useAdminData.js';
import { AdminAsync, AdminSkeleton } from './AdminStates.jsx';
import { DetailSection } from './AdminUserDetailParts.jsx';
import { SeverityBadge } from './AdminIssueBits.jsx';
import { AdminIssueTrail } from './AdminIssueTrail.jsx';
import './adminIssues.css';

const SHOWN = 8;

export function AdminUserProblems({ userId }) {
  const [trailFor, setTrailFor] = useState(null);
  const fetchErrors = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_user_errors', { p_user_id: userId, p_days: 30 });
    if (error) throw error;
    return data;
  }, [userId]);
  const q = useAdminData(fetchErrors, [userId]);
  const d = q.data;
  const groups = d?.groups || [];
  const days = d?.days || 30;
  // Each problem's latest occurrence among the recent ones, for its trail.
  const latest = new Map();
  for (const r of d?.recent || []) if (!latest.has(r.fingerprint)) latest.set(r.fingerprint, r);

  return (
    <DetailSection title="Problems" icon={Warning}>
      <AdminAsync loading={q.loading} error={q.error} hasData={q.hasData} onRetry={q.refresh}
                  skeleton={<AdminSkeleton variant="list" rows={2} />}>
        {groups.length === 0 ? (
          <div className="is-muted">Nothing went wrong for them in the last {days} days.</div>
        ) : (
          <>
            <div className="t-meta">
              {formatCount(groups.length)} problem{groups.length === 1 ? '' : 's'} · {formatCount(d.n)} time{d.n === 1 ? '' : 's'}
              {' '}· {formatCount(d.sessions)} browser session{d.sessions === 1 ? '' : 's'} · last {days} days
            </div>
            <ul className="iss-user-list">
              {groups.slice(0, SHOWN).map((g) => {
                const r = latest.get(g.fingerprint);
                return (
                  <li key={g.fingerprint} className="iss-user-item">
                    <div className="iss-problem-head">
                      <SeverityBadge severity={g.severity} />
                      <span className="admin-error-kind t-meta">{kindLabel(g.kind)}</span>
                      {g.status === 'resolved' && <span className="iss-badge iss-badge-resolved">Resolved</span>}
                      {g.status === 'muted' && <span className="iss-badge iss-badge-muted">Muted</span>}
                    </div>
                    <div className="iss-problem-msg">{g.message || '(no message)'}</div>
                    <div className="iss-problem-sub t-meta">
                      {formatCount(g.n)} time{g.n === 1 ? '' : 's'} · last{' '}
                      <span title={fmtDateTime(g.last_at)}>{relativeTime(g.last_at)}</span>
                      {r?.session_id && (
                        <>
                          {' · '}
                          <button type="button" className="iss-linkbtn" onClick={() => setTrailFor(r)}>
                            What they were doing
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            {groups.length > SHOWN && (
              <div className="t-meta">{formatCount(groups.length - SHOWN)} more in Admin, Errors</div>
            )}
          </>
        )}
      </AdminAsync>
      {trailFor && (
        <AdminIssueTrail sessionId={trailFor.session_id} at={trailFor.at} onClose={() => setTrailFor(null)} />
      )}
    </DetailSection>
  );
}
