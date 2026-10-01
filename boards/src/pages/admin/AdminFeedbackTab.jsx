// AdminFeedbackTab — everything anyone has told us, in one list.
//
// Four sources land here (one data model since 0348): Send feedback (bug/idea/
// praise/other, now with a one-tap topic as `choice`, via the send-feedback edge
// function), the return question (return_reason) and its role step (role), and
// "What's holding you back?" (upgrade_reason) — each with the context record
// the person was shown before sending, and their consent to be written to. The second could not reach this table at all until
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
import { MessageSquare, Image as ImageIcon } from '../../lib/icons.js';
import { describeFeedbackContext } from '../../lib/feedbackContext.js';

// Asserted against the table's CHECK by src/lib/feedbackContract.test.mjs — a
// kind the database can store and this array cannot ask for is a row written
// and then hidden behind a filter.
const KINDS = ['bug', 'idea', 'praise', 'other', 'return_reason', 'account_deleted', 'upgrade_reason', 'role'];
const PAGE_SIZE = 50;
// Long enough that most messages are shown whole — the reading column is
// capped, so this is about how many LINES a row costs, not characters on one.
const CLAMP = 260;

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

  // Counts by answer for any kind that carries one. Computed off the page in
  // hand and labelled as such — a read of what is on screen, not a total (the
  // breakdown panel above is the total).
  const tally = kind && rows.some((r) => r.choice)
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
        <FeedbackBreakdown />

        {tally && Object.keys(tally).length > 0 && (
          <div className="fbk-tally">
            {Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
              <span key={k} className="fbk-tally-item">
                <span className="fbk-tally-n">{formatCount(n)}</span>{k}
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
          <div className={`fbk-list ${refreshing ? 'is-refreshing' : ''}`}>
            {rows.map((r) => {
              const isExpanded = expanded.has(r.id);
              const message = r.message || '';
              const isLong = message.length > CLAMP;
              const preview = message.slice(0, CLAMP);
              // A row with only a screenshot has no long message, so gating the
              // expand affordance on message length alone left the image
              // unreachable even once the RPC started returning it.
              const canOpen = isLong || r.has_image;
              const isFiller = r.has_note === false;
              return (
                <div
                  key={r.id}
                  className={`fbk-row ${canOpen ? 'is-openable' : ''} ${isExpanded ? 'is-open' : ''}`}
                  role={canOpen ? 'button' : undefined}
                  tabIndex={canOpen ? 0 : undefined}
                  aria-expanded={canOpen ? isExpanded : undefined}
                  onClick={() => canOpen && toggle(r)}
                  onKeyDown={(e) => {
                    if (canOpen && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(r); }
                  }}
                >
                  {/* The message first and largest. It is the only part of a
                      row that carries information; everything else is filing. */}
                  <div className={`fbk-msg ${isFiller ? 'is-filler' : ''}`}>
                    {isExpanded ? message : preview}{!isExpanded && isLong ? '…' : ''}
                    {isFiller && <span className="fbk-nonote"> — tapped an answer, wrote nothing</span>}
                  </div>

                  <div className="fbk-meta">
                    <FeedbackKindPill kind={r.kind} />
                    <FeedbackChoicePill choice={r.choice} />
                    {r.email
                      ? <CopyableText value={r.email} className="fbk-who" />
                      : <span className="fbk-who fbk-anon">anonymous</span>}
                    <span title={fmtDateTime(r.created_at)}>{relativeTime(r.created_at)}</span>
                    {r.contact_ok && <span className="fbk-consent">may email</span>}
                    {r.context && describeFeedbackContext(r.context) && (
                      <span className="fbk-ctx" title={JSON.stringify(r.context)}>{describeFeedbackContext(r.context)}</span>
                    )}
                    {r.url && (
                      <a className="fbk-path" href={r.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                        {(() => { try { return new URL(r.url).pathname; } catch { return r.url; } })()}
                      </a>
                    )}
                    {r.has_image && <span className="fbk-shot-tag"><ImageIcon size={11} /> screenshot</span>}
                    {canOpen && <span className="fbk-more">{isExpanded ? 'less' : 'more'}</span>}
                  </div>

                  {isExpanded && r.has_image && (
                    shots[r.id] && shots[r.id] !== 'loading' && shots[r.id] !== 'error'
                      ? <img className="fbk-shot" src={shots[r.id]} alt="Screenshot attached to this report" />
                      : <div className="fbk-shot-loading">
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

// ── The breakdown ────────────────────────────────────────────────────────────
// admin_feedback_breakdown (0348): every answer counted by what was asked, what
// was said, the author's role and how deep they were when they said it. This is
// where the pre-registered reads are taken — the "What's holding you back?"
// shares by depth, and the role mix of the people who build.
const DEPTHS = ['0', '1-12', '13+', '80%+ of cap', 'anonymous', 'unknown'];
const GROUPS = [
  { id: 'upgrade_reason', label: "What's holding you back?", kinds: ['upgrade_reason'] },
  { id: 'return_reason',  label: 'What brings you back',     kinds: ['return_reason'] },
  { id: 'role',           label: 'What best describes you',  kinds: ['role'] },
  { id: 'topics',         label: 'Send feedback topics',     kinds: ['bug', 'idea', 'praise', 'other'] },
];

function FeedbackBreakdown() {
  const [group, setGroup] = useState('upgrade_reason');
  const fetchBreakdown = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_feedback_breakdown', { p_since: null, p_exclude_internal: true });
    if (error) throw error;
    return data || [];
  }, []);
  const { data, loading, error } = useAdminData(fetchBreakdown, []);

  const g = GROUPS.find((x) => x.id === group) || GROUPS[0];
  const rows = (data || []).filter((r) => g.kinds.includes(r.kind));
  const byChoice = new Map();
  const byRole = new Map();
  for (const r of rows) {
    const c = r.choice || '(words only)';
    const n = Number(r.answers) || 0;
    const e = byChoice.get(c) || { choice: c, total: 0, notes: 0, contact: 0, depth: {} };
    e.total += n;
    e.notes += Number(r.with_note) || 0;
    e.contact += Number(r.contact_ok) || 0;
    e.depth[r.depth] = (e.depth[r.depth] || 0) + n;
    byChoice.set(c, e);
    const rr = byRole.get(c) || {};
    const role = r.role || '—';
    rr[role] = (rr[role] || 0) + n;
    byRole.set(c, rr);
  }
  const list = [...byChoice.values()].sort((a, b) => b.total - a.total);
  const total = list.reduce((n, e) => n + e.total, 0);
  const depths = DEPTHS.filter((d) => list.some((e) => e.depth[d]));
  const roles = [...new Set(rows.map((r) => r.role || '—'))].sort();
  const pct = (n) => (total ? `${Math.round((100 * n) / total)}%` : '—');

  return (
    <div className="fbk-breakdown">
      <div className="fbk-breakdown-head">
        <span className="fbk-breakdown-title">All answers, external accounts</span>
        <select className="auth-input admin-filter-select" value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Which question">
          {GROUPS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
        <span className="t-meta">{loading ? 'Loading…' : error ? 'Could not load the breakdown.' : `${formatCount(total)} answers`}</span>
      </div>
      {!loading && !error && list.length > 0 && (
        <>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Answer</th>
                <th className="num">Share</th>
                {depths.map((d) => <th key={d} className="num">{d}</th>)}
                <th className="num">Wrote</th>
                <th className="num">May email</th>
              </tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.choice}>
                  <td>{e.choice}</td>
                  <td className="num">{formatCount(e.total)} · {pct(e.total)}</td>
                  {depths.map((d) => <td key={d} className="num">{e.depth[d] ? formatCount(e.depth[d]) : ''}</td>)}
                  <td className="num">{e.notes ? formatCount(e.notes) : ''}</td>
                  <td className="num">{e.contact ? formatCount(e.contact) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {group !== 'role' && roles.some((r) => r !== '—') && (
            <table className="admin-table" style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th>Answer, by role</th>
                  {roles.map((r) => <th key={r} className="num">{r}</th>)}
                </tr>
              </thead>
              <tbody>
                {list.map((e) => (
                  <tr key={e.choice}>
                    <td>{e.choice}</td>
                    {roles.map((r) => <td key={r} className="num">{byRole.get(e.choice)?.[r] ? formatCount(byRole.get(e.choice)[r]) : ''}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
