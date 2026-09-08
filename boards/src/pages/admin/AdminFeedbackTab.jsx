// AdminFeedbackTab — everything anyone has told us, in one list.
//
// Two sources land here: the in-app feedback widget (bug/idea/praise/other, via
// the send-feedback edge function) and the return question (return_reason, via
// submit_return_reason). The second could not reach this table at all until
// 0310 — it stamped a kind the table's CHECK forbade, so every answer raised
// 23514 and was discarded silently.
//
// Two things were also written and never shown. A screenshot has ridden along
// with the widget since 0095 and no surface in the product has ever displayed
// one; it is fetched by id on expand rather than returned by the list, because
// an image is capped at 3 MB and a page holds up to 500 rows. And a
// return_reason row whose author skipped the follow-up carries a message the
// SERVER wrote — the label for their choice — which is rendered as filler
// rather than as prose, because presenting our own text as theirs is a lie the
// GDPR export would repeat.
//
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
import { FeedbackKindPill, FeedbackChoicePill } from './AdminPills.jsx';
import { MessageSquare } from '../../lib/icons.js';

// Asserted against the table's CHECK by src/lib/feedbackContract.test.mjs — a
// kind the database can store and this array cannot ask for is a row written
// and then hidden behind a filter.
const KINDS = ['bug', 'idea', 'praise', 'other', 'return_reason'];
const PAGE_SIZE = 50;

export function AdminFeedbackTab() {
  const [kind, setKind] = useState('');
  const [query, setQueryRaw] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(0);          // 0-indexed
  const [expanded, setExpanded] = useState(new Set());
  const [shots, setShots] = useState({});     // id -> data URL | 'loading' | 'error'

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

  // The image is fetched only when a row is opened, and only once. Returning it
  // from the list RPC would put up to 3 MB per row on the wire for every poll.
  const loadShot = useCallback(async (id) => {
    setShots((prev) => (prev[id] ? prev : { ...prev, [id]: 'loading' }));
    const { data, error } = await supabase.rpc('admin_get_feedback_image', { p_id: id });
    setShots((prev) => ({ ...prev, [id]: error || !data ? 'error' : data }));
  }, []);

  const toggle = (r) => {
    const id = r.id;
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
    if (r.has_image && !shots[id]) loadShot(id);
  };

  // Counts by answer for the return question. Computed off the page in hand and
  // labelled as such — this is a read of what is on screen, not a total.
  const tally = kind === 'return_reason'
    ? rows.reduce((acc, r) => {
        const k = r.choice || 'unknown';
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {})
    : null;

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
            The feedback widget and the return question
            {kind ? ` · ${kind}` : ''}{debounced ? ` · “${debounced}”` : ''}
          </span>
        </header>
        <div className="admin-section-sub">
          Click an entry to read the full message or see its screenshot.
        </div>

        {tally && Object.keys(tally).length > 0 && (
          <div className="admin-feedback-tally">
            {Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
              <span key={k} className="admin-feedback-tally-item">
                <span className="admin-feedback-tally-n">{formatCount(n)}</span>{k}
              </span>
            ))}
          </div>
        )}

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
              : 'Feedback-widget submissions and return-question answers appear here.',
          }}
        >
          <div className={`admin-feedback-list ${refreshing ? 'is-refreshing' : ''}`}>
            {rows.map((r) => {
              const isExpanded = expanded.has(r.id);
              const message = r.message || '';
              const isLong = message.length > 160;
              const preview = message.slice(0, 160);
              // A row with only a screenshot has no long message, so gating the
              // expand affordance on message length alone left the image
              // unreachable even once the RPC started returning it.
              const canOpen = isLong || r.has_image;
              const isFiller = r.has_note === false;
              return (
                <div
                  key={r.id}
                  className="admin-feedback-row"
                  role={canOpen ? 'button' : undefined}
                  tabIndex={canOpen ? 0 : undefined}
                  aria-expanded={canOpen ? isExpanded : undefined}
                  onClick={() => canOpen && toggle(r)}
                  onKeyDown={(e) => {
                    if (canOpen && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(r); }
                  }}
                >
                  <div className="admin-feedback-meta">
                    <FeedbackKindPill kind={r.kind} />
                    <FeedbackChoicePill choice={r.choice} />
                    {r.email
                      ? <CopyableText value={r.email} className="admin-email" />
                      : <span className="admin-email admin-muted">anonymous</span>}
                    <span className="admin-muted" title={fmtDateTime(r.created_at)}>{relativeTime(r.created_at)}</span>
                    {r.url && (
                      <a className="admin-link admin-muted" href={r.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                        {(() => { try { return new URL(r.url).pathname; } catch { return r.url; } })()}
                      </a>
                    )}
                    {r.has_image && <span className="admin-muted">screenshot</span>}
                  </div>
                  <div className={`admin-feedback-message ${isFiller ? 'is-filler' : ''}`}>
                    {isExpanded ? message : preview}{!isExpanded && isLong ? '…' : ''}
                    {isFiller ? ' — no note written' : ''}
                  </div>
                  {isExpanded && r.has_image && (
                    shots[r.id] && shots[r.id] !== 'loading' && shots[r.id] !== 'error'
                      ? <img className="admin-feedback-shot" src={shots[r.id]} alt="Screenshot attached to this report" />
                      : <div className="admin-feedback-shot-loading">
                          {shots[r.id] === 'error' ? 'Could not load the screenshot.' : 'Loading screenshot…'}
                        </div>
                  )}
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
