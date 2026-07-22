// AdminLandingScorecard — one row per public landing page, ranked so winners
// and losers are obvious at a glance: traffic (views/sessions), engagement
// (median scroll depth + median dwell from lp_dwell), intent (CTA CTR =
// sessions that clicked a signup-intent CTA), and outcome (signups attributed
// via profiles.first_source.landing_path) with a per-day views sparkline.
// Data: admin_landing_scorecard (migration 0195) over the lp_* event family.
//
// HONESTY: rates render through RateCell (two-tier small-N rule) and the
// engagement medians suppress below 5 dwell samples — early pages must never
// show "80% scroll!" off two visits. Sparklines gate on MIN_POINTS via Spark.

import { useMemo, useState } from 'react';
import { formatCount, formatPct } from '../../lib/adminFormat.js';
import { RateCell, Spark } from './SmallN.jsx';
import { CHART } from './chartTheme.js';

const CLASS_LABELS = { ai: 'AI', search: 'Search', social: 'Social', referral: 'Referral', direct: 'Direct' };
const CLASS_ORDER = ['ai', 'search', 'social', 'referral', 'direct'];

// Medians rest on lp_dwell rows; below this many samples they'd be noise.
const MIN_ENGAGEMENT_N = 5;

// props.page is attacker-writable (analytics_events has an open insert
// policy) — only linkify known internal landing paths; anything else renders
// as inert text, never an href.
const LINKABLE = /^\/(tools|vs|use-cases|c)(\/[a-z0-9-]+)*\/?$|^\/(pricing|explore)$|^\/$/;

function fmtDwell(ms) {
  if (ms == null) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

const COLS = [
  { key: 'page',       label: 'Page',     align: 'left' },
  { key: 'views',      label: 'Views' },
  { key: 'sessions',   label: 'Sessions' },
  { key: 'med_scroll', label: 'Scroll p50', title: 'Median max scroll depth (lp_dwell)' },
  { key: 'med_dwell_ms', label: 'Dwell p50', title: 'Median time on page (lp_dwell)' },
  { key: 'cta',        label: 'CTA CTR',  title: 'Sessions that clicked a signup CTA / sessions' },
  { key: 'signups',    label: 'Signups' },
  { key: 'conv',       label: 'Conv',     title: 'Signups / sessions' },
  { key: 'spark',      label: 'Trend',    sortable: false },
];

function sortValue(row, key) {
  if (key === 'page') return row.page || '';
  if (key === 'cta')  return (Number(row.cta_sessions) || 0) / Math.max(1, Number(row.sessions) || 0);
  if (key === 'conv') return (Number(row.signups) || 0) / Math.max(1, Number(row.sessions) || 0);
  return Number(row[key]) || 0;
}

export function AdminLandingScorecard({ rows }) {
  const [sort, setSort] = useState({ key: 'sessions', dir: 'desc' });

  const sorted = useMemo(() => {
    const list = Array.isArray(rows) ? [...rows] : [];
    const { key, dir } = sort;
    const mul = dir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      const av = sortValue(a, key), bv = sortValue(b, key);
      if (typeof av === 'string') return av.localeCompare(bv) * mul;
      return (av - bv) * mul;
    });
    return list;
  }, [rows, sort]);

  const clickSort = (key) => setSort((s) => (
    s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }
  ));

  if (!sorted.length) {
    return (
      <div className="t-meta admin-muted" style={{ marginBottom: 14 }}>
        No landing-page views in this window yet.
      </div>
    );
  }

  return (
    <table className="admin-table" style={{ width: '100%', marginBottom: 14 }}>
      <thead>
        <tr>
          {COLS.map((c) => (
            <th key={c.key} title={c.title}
                style={{ textAlign: c.align || 'center', cursor: c.sortable === false ? undefined : 'pointer', whiteSpace: 'nowrap' }}
                onClick={c.sortable === false ? undefined : () => clickSort(c.key)}>
              {c.label}{sort.key === c.key ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map((p) => {
          const engaged = (Number(p.dwell_n) || 0) >= MIN_ENGAGEMENT_N;
          return (
            <tr key={p.page}>
              <td style={{ textAlign: 'left' }}>
                {LINKABLE.test(p.page || '')
                  ? <a href={p.page} target="_blank" rel="noreferrer">{p.page}</a>
                  : <span>{p.page}</span>}
                {p.referrers && (
                  <div style={{ marginTop: 3 }}>
                    {CLASS_ORDER.filter((k) => p.referrers?.[k]).map((k) => (
                      <span key={k} style={{
                        font: '500 10px/1 var(--font-sans)', padding: '2px 6px', borderRadius: 999,
                        border: '1px solid var(--line-2)', marginRight: 5,
                        color: k === 'ai' ? 'var(--soleil)' : 'var(--ink-2)',
                      }}>
                        {CLASS_LABELS[k]} {p.referrers[k]}
                      </span>
                    ))}
                  </div>
                )}
              </td>
              <td style={{ textAlign: 'center' }}>{formatCount(p.views)}</td>
              <td style={{ textAlign: 'center' }}>{formatCount(p.sessions)}</td>
              <td style={{ textAlign: 'center' }}>
                {engaged && p.med_scroll != null
                  ? formatPct(Number(p.med_scroll))
                  : <span className="admin-muted" title={`n=${p.dwell_n || 0} dwell samples — too few to trust`}>—</span>}
              </td>
              <td style={{ textAlign: 'center' }}>
                {engaged && p.med_dwell_ms != null
                  ? fmtDwell(Number(p.med_dwell_ms))
                  : <span className="admin-muted" title={`n=${p.dwell_n || 0} dwell samples — too few to trust`}>—</span>}
              </td>
              <td style={{ textAlign: 'center' }} title={`${formatCount(p.cta_clicks)} signup-CTA clicks`}>
                <RateCell numer={p.cta_sessions} denom={p.sessions} />
              </td>
              <td style={{ textAlign: 'center' }}>{formatCount(p.signups)}</td>
              <td style={{ textAlign: 'center' }}>
                <RateCell numer={p.signups} denom={p.sessions} />
              </td>
              <td style={{ textAlign: 'center', minWidth: 90 }}>
                <Spark data={(p.spark || []).map((v) => ({ v: Number(v) || 0 }))} color={CHART.soleil} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
