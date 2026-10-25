// AdminIssueDetail — one problem, opened (0582's admin_error_group): how often
// it happens, on which releases, browsers and pages, what its context says,
// and its latest occurrences with the steps before each. An occurrence from a
// browser with a session opens what that browser was doing around it.

import { useCallback, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { relativeTime, fmtDateTime, formatCount, shortDate } from '../../lib/adminFormat.js';
import { kindLabel, crumbText, beforeText, contextChips, issueText } from '../../lib/adminIssues.js';
import { useAdminData } from './useAdminData.js';
import { AdminAsync, AdminSkeleton } from './AdminStates.jsx';
import { TrendLine } from './viz/TrendLine.jsx';
import { BarRows } from './viz/BarRows.jsx';
import { CopyButton, SeverityBadge } from './AdminIssueBits.jsx';
import { AdminIssueTrail } from './AdminIssueTrail.jsx';

const FACET_LABELS = {
  op: 'Operation', code: 'Code', phase: 'Phase', surface: 'Surface',
  route: 'Request', status: 'HTTP status', pg: 'Postgres code',
};
const FACET_ORDER = ['route', 'status', 'pg', 'op', 'code', 'phase', 'surface'];
const ENV_LABELS = { prod: 'production', preview: 'preview', dev: 'dev' };

function Facet({ title, rows }) {
  return (
    <div className="iss-facet">
      <h4 className="iss-facet-title">{title}</h4>
      <BarRows rows={rows} limit={6} emptyLabel="Nothing recorded" />
    </div>
  );
}

function Occurrence({ o, group, onTrail }) {
  const [stackOpen, setStackOpen] = useState(false);
  const chips = contextChips(o.context);
  // Oldest first, ending at the error.
  const crumbs = (Array.isArray(o.breadcrumbs) ? o.breadcrumbs : [])
    .slice().sort((a, b) => (Number(b?.t) || 0) - (Number(a?.t) || 0));
  const hasStack = !!(o.stack || o.component_stack);
  return (
    <li className="iss-occ">
      <div className="iss-occ-meta t-meta">
        <span title={fmtDateTime(o.at)}>{relativeTime(o.at)}</span>
        <span>{o.ua || 'Unknown browser'}</span>
        {o.env && o.env !== 'prod' && <span>{ENV_LABELS[o.env] || o.env}</span>}
        {o.release && <span>{o.release}</span>}
        {o.path && <span className="iss-mono">{o.path}</span>}
        <span>{o.email || (o.user_id ? 'signed in' : 'signed out')}</span>
      </div>
      {o.message && o.message !== group.message && <div className="iss-occ-msg">{o.message}</div>}
      {chips.length > 0 && (
        <div className="iss-chips">{chips.map((c, i) => <span key={`${i}:${c}`} className="iss-chip">{c}</span>)}</div>
      )}
      {crumbs.length > 0 && (
        <ol className="iss-crumbs" aria-label="Steps before it">
          {crumbs.map((c, i) => (
            <li key={`${i}:${c.t}`}>
              <span className="iss-crumb-when t-meta">{beforeText(c.t)}</span>
              <span className="iss-crumb-what">{crumbText(c)}</span>
            </li>
          ))}
        </ol>
      )}
      <div className="iss-occ-actions">
        {o.session_id && (
          <button type="button" className="admin-action" onClick={() => onTrail(o)}>
            What they were doing
          </button>
        )}
        {hasStack && (
          <button type="button" className="admin-action" aria-expanded={stackOpen}
                  onClick={() => setStackOpen((v) => !v)}>
            {stackOpen ? 'Hide stack' : 'Stack'}
          </button>
        )}
        <CopyButton getText={() => issueText(group, { occurrences: [o] })} title="Copy this occurrence" />
      </div>
      {stackOpen && (
        <pre className="admin-error-stack">
          {o.stack || '(no stack)'}
          {o.component_stack ? `\n\ncomponent stack:${o.component_stack}` : ''}
        </pre>
      )}
    </li>
  );
}

// `stamp` is the list's last read: a refresh of the list re-reads what is open.
export function AdminIssueDetail({ group, days, stamp }) {
  const [trailFor, setTrailFor] = useState(null);
  const fetchGroup = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_error_group', { p_fingerprint: group.fingerprint, p_days: days });
    if (error) throw error;
    return data;
  }, [group.fingerprint, days]);
  const q = useAdminData(fetchGroup, [group.fingerprint, days, stamp]);
  const d = q.data;
  const g = d?.group || {};
  const totals = d?.totals || {};
  const occ = d?.occurrences || [];
  const trend = (d?.trend || []).map((t) => ({ v: t.n, label: shortDate(t.day) }));
  const envs = Object.entries(d?.envs || {});
  const ctx = d?.context || {};
  const facets = FACET_ORDER.filter((k) => ctx[k]?.length);

  return (
    <div className="iss-detail">
      <AdminAsync loading={q.loading} error={q.error} hasData={q.hasData} onRetry={q.refresh}
                  skeleton={<AdminSkeleton variant="table" rows={3} />}>
        {d && (
          <>
            <div className="iss-detail-head">
              <div className="iss-detail-msg">
                <SeverityBadge severity={group.severity} /> {kindLabel(group.kind)}: {group.message || '(no message)'}
              </div>
              <div className="iss-detail-sub t-meta">
                {formatCount(totals.n)} times · {formatCount(totals.people)} people · {formatCount(totals.users)} signed in · last {days} days
                {envs.length > 1 && <> · {envs.map(([k, n]) => `${formatCount(n)} ${ENV_LABELS[k] || k}`).join(', ')}</>}
                {g.first_seen && <> · first seen {fmtDateTime(g.first_seen)}{g.first_release ? ` on ${g.first_release}` : ''}</>}
                {g.status && g.status !== 'open' && g.status_at && (
                  <> · {g.status} {relativeTime(g.status_at)}{g.status_by_email ? ` by ${g.status_by_email}` : ''}</>
                )}
                {g.returned_at && <> · came back {relativeTime(g.returned_at)}</>}
              </div>
              <CopyButton getText={() => issueText(group, d)} title="Copy the problem and its latest occurrence" />
            </div>

            <div className="iss-detail-grid">
              <div className="iss-facet iss-facet-trend">
                <h4 className="iss-facet-title">Times a day</h4>
                <TrendLine points={trend} height={96} formatValue={(v) => formatCount(v)} />
              </div>
              <Facet title="Releases" rows={(d.releases || []).map((r) => ({
                key: r.release, label: r.release || '(no release)', value: r.n,
                title: `${formatCount(r.people)} people · ${fmtDateTime(r.first_at)} to ${fmtDateTime(r.last_at)}`,
              }))} />
              <Facet title="Browsers" rows={(d.browsers || []).map((b) => ({
                key: b.ua, label: b.ua, value: b.n, title: `${formatCount(b.people)} people`,
              }))} />
              <Facet title="Pages" rows={(d.paths || []).map((p) => ({
                key: p.path, label: p.path || '(none)', value: p.n, title: `${formatCount(p.people)} people`,
              }))} />
              {facets.map((k) => (
                <Facet key={k} title={FACET_LABELS[k] || k}
                       rows={ctx[k].map((x) => ({ key: x.v, label: x.v, value: x.n }))} />
              ))}
            </div>

            <h4 className="iss-facet-title iss-occs-title">
              {occ.length ? `Latest ${occ.length === 1 ? 'occurrence' : `${occ.length} occurrences`}` : 'No occurrences in this window'}
            </h4>
            {occ.length > 0 && (
              <ol className="iss-occs">
                {occ.map((o) => <Occurrence key={o.id} o={o} group={group} onTrail={setTrailFor} />)}
              </ol>
            )}
          </>
        )}
      </AdminAsync>
      {trailFor && (
        <AdminIssueTrail sessionId={trailFor.session_id} at={trailFor.at} onClose={() => setTrailFor(null)} />
      )}
    </div>
  );
}
