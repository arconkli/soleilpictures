// AdminFeedbackTab — submissions from the in-app feedback widget.
// Kind filter at top; long messages expand on click / Enter / Space.

import { useCallback, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { CopyableText } from '../../components/CopyableText.jsx';
import { relativeTime, fmtDateTime } from '../../lib/adminFormat.js';
import { useAdminData } from './useAdminData.js';
import { AdminToolbar, AdminAsync, AdminSkeleton } from './AdminStates.jsx';
import { FeedbackKindPill } from './AdminPills.jsx';
import { MessageSquare } from '../../lib/icons.js';

const KINDS = ['bug', 'idea', 'praise', 'other'];
const PAGE_LIMIT = 200;

export function AdminFeedbackTab() {
  const [kind, setKind] = useState('');
  const [expanded, setExpanded] = useState(new Set());

  const fetchFeedback = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_list_feedback', {
      p_limit: PAGE_LIMIT,
      p_offset: 0,
      p_kind: kind || null,
    });
    if (error) throw error;
    return data || [];
  }, [kind]);

  const { data, loading, error, refreshing, lastUpdated, refresh } = useAdminData(fetchFeedback, [kind]);
  const rows = data || [];

  const toggle = (id) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  return (
    <div className="admin-section">
      <AdminToolbar onRefresh={refresh} refreshing={refreshing} lastUpdated={lastUpdated}>
        <select
          className="auth-input admin-filter-select"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          aria-label="Filter by kind"
        >
          <option value="">All kinds</option>
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <span className="admin-filter-meta t-meta">
          {loading ? 'Loading…' : `${rows.length}${rows.length >= PAGE_LIMIT ? '+ (first 200)' : ''} entries`}
        </span>
      </AdminToolbar>

      <AdminAsync
        loading={loading}
        error={error}
        onRetry={refresh}
        skeleton={<AdminSkeleton variant="list" rows={6} />}
        isEmpty={rows.length === 0}
        empty={{
          icon: MessageSquare,
          title: kind ? `No ${kind} feedback` : 'No feedback yet',
          body: kind ? 'Try a different kind filter.' : 'Submissions from the in-app feedback widget will appear here.',
        }}
      >
        <div className={`admin-feedback-list ${refreshing ? 'is-refreshing' : ''}`}>
          {rows.map((r) => {
            const isExpanded = expanded.has(r.id);
            const message = r.message || '';
            const isLong = message.length > 160;
            const preview = message.slice(0, 160);
            return (
              <div
                key={r.id}
                className="admin-feedback-row"
                role={isLong ? 'button' : undefined}
                tabIndex={isLong ? 0 : undefined}
                aria-expanded={isLong ? isExpanded : undefined}
                onClick={() => isLong && toggle(r.id)}
                onKeyDown={(e) => {
                  if (isLong && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(r.id); }
                }}
              >
                <div className="admin-feedback-meta">
                  <FeedbackKindPill kind={r.kind} />
                  {r.email
                    ? <CopyableText value={r.email} className="admin-email" />
                    : <span className="admin-email admin-muted">anonymous</span>}
                  <span className="admin-muted" title={fmtDateTime(r.created_at)}>{relativeTime(r.created_at)}</span>
                  {r.url && (
                    <a className="admin-link admin-muted" href={r.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                      {(() => { try { return new URL(r.url).pathname; } catch { return r.url; } })()}
                    </a>
                  )}
                </div>
                <div className="admin-feedback-message">
                  {isExpanded ? message : preview}{!isExpanded && isLong ? '…' : ''}
                </div>
              </div>
            );
          })}
        </div>
      </AdminAsync>
    </div>
  );
}
