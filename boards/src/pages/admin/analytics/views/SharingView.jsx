// SharingView — Analytics › Sharing (look A, "Route ladders").
//
// One ledger (0744) read three ways (0745), so every number here agrees with a
// profile's Sharing and the Users list's marks:
//   • the week, by measure: shares, people sharing, devices that saw a share,
//     and the four outcomes, each a sparkline over complete UTC weeks;
//   • the routes: each way a person shares, from the share to what came of it,
//     a dash where a route can't have the step (an invitation isn't "seen");
//   • who shares, most people reached first, each row opening their profile;
//   • as it happens, the ledger's newest facts in words, paged by time.
// Multiplayer and Referrals moved here from Funnel's detail, unchanged.

import { useState } from 'react';
import { supabase } from '../../../../lib/supabase.js';
import { formatCount, fmtDateTime } from '../../../../lib/adminFormat.js';
import { ROUTE_ORDER, routeLabel, plural } from '../../../../lib/shareRoutes.js';
import { ledgerSentence, shortName } from '../../../../lib/shareSentences.js';
import { useAdminData } from '../../useAdminData.js';
import { AdminAsync, AdminSkeleton } from '../../AdminStates.jsx';
import { Deck, Well, Plate } from '../../viz/Well.jsx';
import { Spark } from '../../viz/TrendLine.jsx';
import { Avatar } from '../../AdminUserDetailParts.jsx';
import { openAdminUser } from '../../adminNav.js';
import { AdminMultiplayerSection } from '../widgets/AdminMultiplayerSection.jsx';
import { AdminReferralsSection } from '../widgets/AdminReferralsSection.jsx';
import { useAnalyticsFilters, useRegisterViewRuntime, POLL_MS } from '../AnalyticsFiltersContext.jsx';

const num = (x) => (x == null || Number.isNaN(Number(x)) ? 0 : Number(x));

// A step a route can't have: nobody "sees" an invitation or an add.
const SEEN_ROUTES = new Set(['view_link', 'edit_link', 'explore', 'file_share', 'workspace_link', 'referral_link']);

const MEASURES = [
  { key: 'shares', label: 'Shares' },
  { key: 'sharers', label: 'People sharing' },
  { key: 'seen', label: 'Seen', sub: 'devices' },
  { key: 'signed_up', label: 'Signed up', people: true },
  { key: 'made_something', label: 'Made something', people: true },
  { key: 'got_in', label: 'Got in', people: true },
  { key: 'co_creating', label: 'Co-creating', people: true },
];

const STEPS = [
  { key: 'seen', label: 'Seen' },
  { key: 'signed_up', label: 'Signed up' },
  { key: 'made_something', label: 'Made something' },
  { key: 'got_in', label: 'Got in' },
  { key: 'co_creating', label: 'Co-creating' },
];

function Weekly({ o }) {
  const weeks = Array.isArray(o.weekly) ? o.weekly : [];
  const t = o.totals || {};
  // The last week is the one in progress: the sparkline shows the complete ones.
  const done = weeks.slice(0, -1);
  return (
    <div className="adm-sh-measures">
      {MEASURES.map((m) => (
        <div key={m.key} className={`adm-sh-measure${m.people ? ' is-people' : ''}`}>
          <span className="adm-sh-measure-n">{formatCount(num(t[m.key]))}</span>
          <span className="adm-sh-measure-l">{m.label}{m.sub ? <small> · {m.sub}</small> : null}</span>
          <div className="adm-sh-measure-spark">
            <Spark values={done.map((w) => num(w[m.key]))} height={26} />
          </div>
          {weeks.length > 0 && (
            <span className="adm-sh-measure-w">this week so far {formatCount(num(weeks[weeks.length - 1][m.key]))}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function Routes({ o }) {
  const routes = (Array.isArray(o.routes) ? o.routes : [])
    .slice().sort((a, b) => ROUTE_ORDER.indexOf(a.route) - ROUTE_ORDER.indexOf(b.route));
  const max = Object.fromEntries(STEPS.map((s) => [s.key, Math.max(1, ...routes.map((r) => num(r[s.key])))]));
  if (!routes.length) return <div className="admin-detail-note">Nothing shared in this window.</div>;
  return (
    <div className="adm-sh-rt" role="table" aria-label="Routes">
      <div className="adm-sh-rt-row adm-sh-rt-head" role="row">
        <span role="columnheader">Route</span>
        <span role="columnheader">Shared</span>
        {STEPS.map((s) => <span key={s.key} role="columnheader">{s.label}</span>)}
      </div>
      {routes.map((r) => (
        <div key={r.route} className="adm-sh-rt-row" role="row">
          <span className="adm-sh-rt-name" role="cell">{routeLabel(r.route)}</span>
          <span className="adm-sh-rt-cell" role="cell">
            <b>{formatCount(num(r.shared))}</b>
            <small>{plural(num(r.sharers), 'person', 'people')}{num(r.copies) > 0 ? ` · ${formatCount(num(r.copies))} copies` : ''}</small>
          </span>
          {STEPS.map((s) => {
            if (s.key === 'seen' && !SEEN_ROUTES.has(r.route)) {
              return <span key={s.key} className="adm-sh-rt-cell is-none" role="cell" title="A route that can't have this step">—</span>;
            }
            const n = num(r[s.key]);
            return (
              <span key={s.key} className={`adm-sh-rt-cell${n === 0 ? ' is-zero' : ''}${s.key !== 'seen' && n > 0 ? ' is-people' : ''}`} role="cell">
                <b>{formatCount(n)}</b>
                <span className="adm-sh-track"><span style={{ width: `${Math.round((n / max[s.key]) * 100)}%` }} /></span>
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Sharers({ o }) {
  const rows = Array.isArray(o.top_sharers) ? o.top_sharers : [];
  if (!rows.length) return <div className="admin-detail-note">Nobody shared in this window.</div>;
  return (
    <div className="adm-sh-tt" role="table" aria-label="Who shares">
      <div className="adm-sh-tt-row adm-sh-tt-head" role="row">
        <span>Person</span><span>Shared</span><span>Copies</span><span>Seen</span>
        <span>Got in</span><span>Signed up</span><span>Made something</span><span>Co-creating</span>
      </div>
      {rows.map((s) => (
        <button key={s.user_id} type="button" className="adm-sh-tt-row" role="row"
                onClick={() => openAdminUser(s)} title={`Open ${s.email || 'this person'} in Users`}>
          <span className="adm-sh-tt-who"><Avatar email={s.email} name={s.name} size={22} />{shortName(s)}</span>
          <span>{formatCount(num(s.shared))}</span>
          <span>{formatCount(num(s.copies))}</span>
          <span>{formatCount(num(s.seen))}</span>
          {['got_in', 'signed_up', 'made_something', 'co_creating'].map((k) => (
            <span key={k} className={num(s[k]) > 0 ? 'is-people' : 'is-zero'}>{formatCount(num(s[k]))}</span>
          ))}
        </button>
      ))}
    </div>
  );
}

function Feed({ f }) {
  const [pages, setPages] = useState([null]);
  const q = useAdminData(async () => {
    const out = [];
    let next = null;
    for (const before of pages) {
      const { data, error } = await supabase.rpc('admin_sharing_recent', {
        p_limit: 30, p_before: before, p_exclude_internal: f.excludeInternal,
      });
      if (error) throw error;
      out.push(...(data?.rows || []));
      next = data?.next_before || null;
    }
    return { rows: out, next };
  }, [pages, f.excludeInternal], { pollIntervalMs: POLL_MS.sharing });
  const rows = q.data?.rows || [];
  let day = null;
  return (
    <AdminAsync loading={q.loading} error={q.error} hasData={q.hasData} onRetry={q.refresh}
                skeleton={<AdminSkeleton variant="list" rows={6} />}>
      {rows.length === 0 ? <div className="admin-detail-note">Nothing shared yet.</div> : (
        <ol className="adm-sh-feed">
          {rows.map((r, i) => {
            const d = String(r.at || '').slice(0, 10);
            const head = d !== day ? d : null;
            day = d;
            return (
              <li key={`${r.at}:${r.fact}:${i}`}>
                {head && <div className="adm-sh-feed-day">{fmtDayHead(head)}</div>}
                <div className="adm-sh-feed-row">
                  <span className="adm-sh-feed-t" title={fmtDateTime(r.at)}>{String(r.at || '').slice(11, 16)}</span>
                  <span className="adm-sh-feed-s">{ledgerSentence(r) || r.fact}</span>
                  <span className="adm-sh-feed-tag">{r.route ? routeLabel(r.route) : ''}</span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {q.data?.next && (
        <button type="button" className="admin-action adm-sh-older" onClick={() => setPages((p) => [...p, q.data.next])}>
          Show older
        </button>
      )}
    </AdminAsync>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDayHead(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y) return ymd;
  const today = new Date().toISOString().slice(0, 10);
  if (ymd === today) return 'Today';
  return `${MONTHS[m - 1]} ${d}`;
}

export function SharingView() {
  const f = useAnalyticsFilters();
  const days = f.days;
  const q = useAdminData(async () => {
    const [ov, rf, mp] = await Promise.allSettled([
      supabase.rpc('admin_sharing_overview', { p_days: days, p_exclude_internal: f.excludeInternal }),
      supabase.rpc('admin_referral_stats', { p_days: days, p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly }),
      supabase.rpc('admin_multiplayer_stats', { p_days: days, p_exclude_internal: f.excludeInternal }),
    ]);
    const val = (r) => (r.status === 'fulfilled' && !r.value.error ? r.value.data : null);
    if (ov.status === 'rejected') throw ov.reason;
    if (ov.value.error) throw ov.value.error;
    return { overview: ov.value.data || {}, referrals: val(rf), multiplayer: val(mp) };
  }, [days, f.excludeInternal, f.verifiedOnly], { pollIntervalMs: POLL_MS.sharing, refetchOnFocus: true });

  useRegisterViewRuntime({ refresh: q.refresh, lastUpdated: q.lastUpdated, refreshing: q.refreshing });

  const o = q.data?.overview || {};
  const t = o.totals || {};
  const weeks = Array.isArray(o.weekly) ? o.weekly.length - 1 : 0;
  const banned = o.banned_left_out || {};
  return (
    <AdminAsync loading={q.loading} error={q.error} hasData={q.hasData} onRetry={q.refresh}
      skeleton={<><AdminSkeleton variant="chart" /><div style={{ height: 16 }} /><AdminSkeleton variant="table" /></>}>
      <div className="adm-view">
        <h2 className="admin-section-title">Week by week</h2>
        <div className="admin-section-sub">
          Complete UTC weeks, Monday to Sunday; the week in progress is left off the line and named under it.
        </div>
        <Deck>
          <Well span={12} title="Sharing, by measure" meta={`${days} days · ${plural(weeks, 'complete week')} · UTC Monday`}
                foot="A workspace link counts as a share only once someone copied it: the setup step makes one for everyone. Seen counts devices, leaving out the sharer’s own and anyone already inside; the rest count accounts.">
            <Weekly o={o} />
          </Well>
        </Deck>

        <h2 className="admin-section-title">Routes</h2>
        <div className="admin-section-sub">
          Every way a person shares, from the share to what came of it. A dash is a step that route can’t have.
        </div>
        <Deck>
          <Plate span={12} title="Routes" meta={`${days} days · from the share to what came of it`}
                 foot={`${plural(num(t.signed_up), 'person', 'people')} signed up through a share · ${formatCount(num(t.made_something))} made something · ${formatCount(num(t.co_creating))} co-create with whoever shared${num(banned.shares) > 0 ? ` · ${plural(num(banned.accounts), 'banned account')}’ ${formatCount(num(banned.shares))} shares are left out` : ''}`}>
            <Routes o={o} />
          </Plate>
        </Deck>

        <h2 className="admin-section-title">Who shares</h2>
        <div className="admin-section-sub">Most people reached first. A row opens that person’s profile in Users.</div>
        <Deck>
          <Plate span={12} title="Who shares" meta={`most people reached first · ${days} days`}>
            <Sharers o={o} />
          </Plate>
        </Deck>

        <h2 className="admin-section-title">As it happens</h2>
        <div className="admin-section-sub">Every share and what came of it, in words, newest first. Times are UTC.</div>
        <Deck>
          <Plate span={12} title="Sharing, as it happened" meta="newest first · UTC">
            <Feed f={f} />
          </Plate>
        </Deck>

        <h2 className="admin-section-title">Clusters with two people, and referrals</h2>
        <AdminMultiplayerSection data={q.data?.multiplayer} days={days} />
        <AdminReferralsSection data={q.data?.referrals} days={days} />
      </div>
    </AdminAsync>
  );
}
