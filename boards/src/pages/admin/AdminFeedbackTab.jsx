// AdminFeedbackTab — submissions from the in-app feedback widget.
// Kind filter + debounced search at top; long messages expand on click /
// Enter / Space. Paginated (50 / page) via p_offset; Next is enabled while a
// full page comes back (the RPC has no count, so length === PAGE_SIZE is our
// "there may be more" signal).

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { CopyableText } from '../../components/CopyableText.jsx';
import { relativeTime, fmtDateTime, formatCount } from '../../lib/adminFormat.js';
import { useAdminData } from './useAdminData.js';
import { AdminToolbar, AdminAsync, AdminSkeleton } from './AdminStates.jsx';
import { FeedbackKindPill } from './AdminPills.jsx';
import { MessageSquare } from '../../lib/icons.js';

const KINDS = ['bug', 'idea', 'praise', 'other'];
const PAGE_SIZE = 50;

export function AdminFeedbackTab() {
  const [kind, setKind] = useState('');
  const [query, setQueryRaw] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(0);          // 0-indexed
  const [expanded, setExpanded] = useState(new Set());

  // Debounce search input (~300ms)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Reset to first page whenever the filter or query changes
  useEffect(() => { setPage(0); }, [kind, debounced]);

  const fetchFeedback = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_list_feedback', {
      p_limit: PAGE_SIZE,
      p_offset: page * PAGE_SIZE,
      p_kind: kind || null,
      p_q: debounced || null,
    });
    if (error) throw error;
    return data || [];
  }, [kind, debounced, page]);

  const { data, loading, error, refreshing, lastUpdated, refresh } = useAdminData(fetchFeedback, [kind, debounced, page]);
  const rows = data || [];

  const firstIdx = rows.length === 0 ? 0 : page * PAGE_SIZE + 1;
  const lastIdx  = page * PAGE_SIZE + rows.length;
  const hasNext  = rows.length === PAGE_SIZE;   // a full page implies there may be more

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
        <input
          className="auth-input admin-search-input"
          type="text"
          placeholder="search message or email…"
          value={query}
          onChange={(e) => setQueryRaw(e.target.value)}
          aria-label="Search feedback"
        />
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
          {loading
            ? 'Loading…'
            : rows.length === 0
              ? 'No matches'
              : `${formatCount(firstIdx)}–${formatCount(lastIdx)}`}
        </span>
      </AdminToolbar>

      <section className="admin-chart-panel admin-chart-panel-wide">
        <header className="admin-chart-head">
          <h3 className="admin-chart-title">Feedback</h3>
          <span className="admin-chart-sub t-meta">
            Submissions from the in-app feedback widget
            {kind ? ` · ${kind}` : ''}{debounced ? ` · “${debounced}”` : ''}
          </span>
        </header>
        <div className="admin-section-sub">
          Click a long entry to read the full message.
        </div>

        <AdminAsync
          loading={loading}
          error={error}
          onRetry={refresh}
          skeleton={<AdminSkeleton variant="list" rows={6} />}
          isEmpty={rows.length === 0}
          empty={{
            icon: MessageSquare,
            title: kind || debounced ? 'No feedback matches these filters' : 'No feedback yet',
            body: kind || debounced
              ? 'Try a different kind filter or a broader search.'
              : 'Submissions from the in-app feedback widget will appear here.',
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
      </section>

      {(page > 0 || hasNext) && (
        <div className="admin-pagination">
          <button className="admin-action" disabled={page === 0 || refreshing} onClick={() => setPage((p) => Math.max(0, p - 1))}>← Prev</button>
          <span className="admin-muted">Page {page + 1}</span>
          <button className="admin-action" disabled={!hasNext || refreshing} onClick={() => setPage((p) => p + 1)}>Next →</button>
        </div>
      )}
    </div>
  );
}
