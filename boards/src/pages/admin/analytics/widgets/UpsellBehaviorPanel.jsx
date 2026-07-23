// UpsellBehaviorPanel — what people DO on the Creator pitch before they leave,
// per surface × trigger, over the up_* exposure family (migration 0197):
//   • the groups table: exposures → CTA/invite-alt rates, dismiss methods,
//     dwell/TTFI medians, toggle + pitch-line-read reach, per-day spark;
//   • the pitch-line strip: which of the 5 Creator feature rows get read
//     (up_feature_hover), keyed by CREATOR_FEATURE_KEYS;
//   • the continuity funnel: classic pricing_* counters per surface
//     (pricing_view under-counts SPA re-opens — exposures above is the honest
//     denominator; views stay for continuity with pre-up_* history);
//   • the recent-exposures feed: one line per exposure, newest first — at
//     current volume every single exposure is readable.
//
// HONESTY: every rate renders through RateCell (two-tier small-N rule),
// medians suppress below MIN_ENGAGEMENT_N summaries, sparks gate on
// MIN_POINTS. All strings here come from anon-writable props — the RPC clamps
// them, and this component renders them as inert text only (never hrefs).

import { formatCount } from '../../../../lib/adminFormat.js';
import { RateCell, Spark, PanelNote } from '../../SmallN.jsx';
import { CHART } from '../../chartTheme.js';
import { CREATOR_FEATURES, CREATOR_FEATURE_KEYS } from '../../../../lib/billingCopy.js';

// Medians rest on up_exposure_summary rows; below this many they'd be noise.
const MIN_ENGAGEMENT_N = 5;

const DISMISS_LABELS = { x: '×', backdrop: 'bkdp', maybe_later: 'later', esc: 'esc', nav: 'nav' };

function fmtMs(ms) {
  if (ms == null) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

// Strip the bold markers from a billingCopy feature line for the strip labels.
function featLabel(i) {
  return (CREATOR_FEATURES[i] || '').replaceAll('**', '');
}

function DismissChips({ methods }) {
  const entries = Object.entries(methods || {}).filter(([, n]) => Number(n) > 0);
  if (!entries.length) return <span className="admin-muted">—</span>;
  return (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
      {entries.map(([k, n]) => (
        <span key={k} className="t-meta admin-muted" title={`dismissed via ${k}`}>
          {DISMISS_LABELS[k] || k} {formatCount(n)}
        </span>
      ))}
    </span>
  );
}

// Which pitch lines get read — one bar per Creator feature row, aggregated
// across every surface (the shared FeatureList instruments them all).
function PitchLineStrip({ groups }) {
  const totals = CREATOR_FEATURE_KEYS.map((key, i) => {
    let n = 0;
    for (const g of groups) n += Number(g.feat_keys?.[key] ?? g.feat_hover?.[`r${i}`] ?? 0) || 0;
    return { key, i, n };
  });
  const max = Math.max(1, ...totals.map((t) => t.n));
  const any = totals.some((t) => t.n > 0);
  return (
    <div style={{ margin: '10px 0 14px' }}>
      <div className="t-meta admin-muted" style={{ marginBottom: 6 }}>
        Pitch lines read (hover ≥300ms on a Creator feature row, once per exposure)
      </div>
      {!any && <div className="admin-muted t-meta">No feature-row reads recorded yet.</div>}
      {any && totals.map((t) => (
        <div key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <div className="t-meta" style={{ width: 300, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={featLabel(t.i)}>
            {featLabel(t.i)}
          </div>
          <div style={{ flex: 1, height: 8, background: 'var(--bg-2)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ width: `${Math.round((t.n / max) * 100)}%`, height: '100%', background: 'var(--soleil)', borderRadius: 4 }} />
          </div>
          <div className="t-meta" style={{ width: 34, textAlign: 'right' }}>{formatCount(t.n)}</div>
        </div>
      ))}
    </div>
  );
}

function ExposureLine({ x }) {
  const bits = [
    [x.surface, x.header && x.header !== 'generic' ? x.header : null].filter(Boolean).join('·'),
    x.via ? `via ${x.via}` : null,
    x.tier || null,
    x.dwell_ms != null ? fmtMs(x.dwell_ms) : null,
    Array.isArray(x.feat_rows) && x.feat_rows.length
      ? `read ${x.feat_rows.map((r) => CREATOR_FEATURE_KEYS[r] ?? r).join(',')}` : null,
    x.toggles_n ? `${x.toggles_n} toggle${x.toggles_n > 1 ? 's' : ''}` : null,
    x.cta_hes_ms != null ? `hesitated on CTA ${fmtMs(x.cta_hes_ms)}` : null,
    x.error_seen ? 'saw an error' : null,
    x.outcome === 'dismiss' ? `dismissed via ${x.dismiss_method || '?'}` : x.outcome,
    x.exposure_n != null ? `exposure #${x.exposure_n}` : null,
    x.cap_pct != null ? `${x.cap_pct}% of cap` : null,
    x.device_type || null,
  ].filter(Boolean);
  const when = x.occurred_at ? new Date(x.occurred_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  const good = x.outcome === 'cta';
  return (
    <div className="t-meta" style={{ padding: '3px 0', borderBottom: '1px solid var(--line-1)' }}>
      <span className="admin-muted" style={{ marginRight: 8 }}>{when}</span>
      <span style={good ? { color: 'var(--soleil)', fontWeight: 600 } : undefined}>{bits.join(' · ')}</span>
    </div>
  );
}

export function UpsellBehaviorPanel({ scorecard, exposures, days }) {
  const groups = Array.isArray(scorecard?.groups) ? scorecard.groups : [];
  const funnel = Array.isArray(scorecard?.funnel) ? scorecard.funnel : [];
  const ep = scorecard?.entry_points || {};
  const feed = Array.isArray(exposures) ? exposures : [];

  if (!scorecard) {
    return <PanelNote>Upsell behavior data unavailable (admin_upsell_scorecard failed to load).</PanelNote>;
  }

  return (
    <div>
      {groups.length === 0 && (
        <PanelNote>
          No upsell exposures recorded in the last {days}d yet — up_exposure_summary rows
          start once the up_* instrumentation is deployed. The continuity funnel below
          reads the historical pricing_* events.
        </PanelNote>
      )}

      {groups.length > 0 && (
        <table className="admin-table" style={{ width: '100%', marginBottom: 10 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Surface · trigger</th>
              <th title="up_exposure_summary rows — the honest denominator">Exposures</th>
              <th>Users</th>
              <th title="outcome=cta / exposures">CTA</th>
              <th title="outcome=invite_alt / exposures">Invite alt</th>
              <th title="How dismissers left">Dismissed via</th>
              <th title="Median dwell to outcome">Dwell p50</th>
              <th title="Median time to first interaction">TTFI p50</th>
              <th title="Exposures that touched the plan toggle">Toggled</th>
              <th title="Exposures that read ≥1 pitch line">Read pitch</th>
              <th>Trend</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const o = g.outcomes || {};
              const enough = (Number(g.exposures) || 0) >= MIN_ENGAGEMENT_N;
              return (
                <tr key={`${g.surface}:${g.header}`}>
                  <td style={{ textAlign: 'left' }}>
                    {g.surface}{g.header && g.header !== 'generic' ? ` · ${g.header}` : ''}
                    {Number(g.error_seen_n) > 0 && (
                      <span className="admin-lown" title={`${g.error_seen_n} exposures rendered a checkout error`}> ⚠err</span>
                    )}
                  </td>
                  <td>{formatCount(g.exposures)}</td>
                  <td>{formatCount(g.users)}</td>
                  <td><RateCell numer={Number(o.cta) || 0} denom={Number(g.exposures) || 0} /></td>
                  <td><RateCell numer={Number(o.invite_alt) || 0} denom={Number(g.exposures) || 0} /></td>
                  <td><DismissChips methods={g.dismiss_methods} /></td>
                  <td>{enough && g.med_dwell_ms != null
                    ? fmtMs(Number(g.med_dwell_ms))
                    : <span className="admin-muted" title={`n=${g.exposures} — too few to trust`}>—</span>}</td>
                  <td>{enough && g.med_ttfi_ms != null
                    ? fmtMs(Number(g.med_ttfi_ms))
                    : <span className="admin-muted" title={`n=${g.exposures} — too few to trust`}>—</span>}</td>
                  <td><RateCell numer={Number(g.toggled_n) || 0} denom={Number(g.exposures) || 0} /></td>
                  <td><RateCell numer={Number(g.feat_read_n) || 0} denom={Number(g.exposures) || 0} /></td>
                  <td><Spark data={(g.spark || []).map((v) => ({ v: Number(v) || 0 }))} color={CHART.soleil} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <PitchLineStrip groups={groups} />

      {funnel.length > 0 && (
        <table className="admin-table" style={{ width: '100%', marginBottom: 10 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }} title="Classic pricing_* counters — continuity with pre-up_* history">Funnel (continuity)</th>
              <th title="pricing_view (once per pageload — under-counts SPA re-opens)">Views</th>
              <th>Viewers</th>
              <th title="pricing_creator_intent">Intents</th>
              <th title="pricing_abandon (modal only)">Abandons</th>
              <th title="checkout_open">Checkouts</th>
            </tr>
          </thead>
          <tbody>
            {funnel.map((f) => (
              <tr key={f.surface}>
                <td style={{ textAlign: 'left' }}>{f.surface}</td>
                <td>{formatCount(f.views)}</td>
                <td>{formatCount(f.view_who)}</td>
                <td>{formatCount(f.intents)}</td>
                <td>{formatCount(f.abandons)}</td>
                <td>{formatCount(f.checkouts)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <PanelNote>
        Entry points ({days}d): chip {formatCount(ep.chip_clicks || 0)} · settings {formatCount(ep.settings_clicks || 0)} ·
        invite-alt {formatCount(ep.invite_alt_clicks || 0)} · cap toast {formatCount(ep.cap_toast_views || 0)} ·
        paid conversions (server) {formatCount(scorecard.subs || 0)}
      </PanelNote>

      {feed.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="t-meta admin-muted" style={{ marginBottom: 4 }}>
            Recent exposures (newest first) — what each prospect actually did on the pitch
          </div>
          {feed.map((x, i) => <ExposureLine key={`${x.occurred_at}-${i}`} x={x} />)}
        </div>
      )}
    </div>
  );
}
