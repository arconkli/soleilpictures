// FirstCardFriction — the missing half of the funnel: of the sessions that TRIED
// to make a card (card_create_intent), how many succeeded, how many hit a blocked
// dead-end (by reason), and how many tripped the stuck signal. Reads the
// admin_first_card_friction jsonb { intents_total, intent_sessions,
// converted_sessions, stuck_sessions, intent_to_card_pct, intents_by_method[],
// blocked_by_reason[], by_source[], by_device[] }.
//
// Conversion is gated by safeRate (solid ≥20, directional 5–19, suppressed <5);
// counts are shown raw (a bar/tile of 1 honestly reads as 1).

import { formatCount, formatPct, safeRate, MIN_RATE_SHOW } from '../../../../lib/adminFormat.js';
import { BarRows } from '../../viz/BarRows.jsx';
import { Metric, MetricGrid } from '../../viz/Metric.jsx';
import { DEVICE_COLOR, VAR } from '../../viz/palette.js';
import { PanelNote, ChartPlaceholder } from '../../SmallN.jsx';

// Friendly labels for the pinned enums (see analyticsEvents.js). Unknown =
// anything emitted outside the enum, which would otherwise read as a bug.
const REASON_LABELS = {
  demo_cap: 'Demo cap hit',
  demo_blocked: 'Board locked (demo)',
  read_only: 'Read-only board',
  place_miss: 'Clicked a card, not canvas',
  stale_paste: 'Paste landed off-screen',
  noop_svg: 'Double-click hit a stroke',
  mutator_null: 'Internal (no board)',
  unknown: 'Uncategorized',
};
const METHOD_LABELS = {
  dblclick: 'Double-click',
  add_menu: '+ menu',
  context_menu: 'Right-click',
  tool_place: 'Toolbar tool',
  drag_in: 'Drag in',
  paste: 'Paste',
  empty_cta: 'Empty-board CTA',
  mobile_nav: 'Mobile + button',
  unknown: 'Uncategorized',
};
// Device colours come from viz/palette now. This file used to carry its own
// copy, with a comment explaining it was re-declared "per convention" — and
// painted mobile in the reserved gold accent.

export function FirstCardFriction({ data }) {
  if (!data) return null;
  const intents = Number(data.intent_sessions) || 0;
  const converted = Number(data.converted_sessions) || 0;
  const stuck = Number(data.stuck_sessions) || 0;
  const blocked = (data.blocked_by_reason || []).map((r) => ({
    name: REASON_LABELS[r.reason] || r.reason, sessions: Number(r.sessions) || 0,
  })).sort((a, b) => b.sessions - a.sessions);
  const methods = (data.intents_by_method || []).filter((m) => (Number(m.sessions) || 0) > 0);
  const devices = (data.by_device || []).filter((d) => (Number(d.intent_sessions) || 0) > 0);

  // Nothing emitted yet → friction events haven't shipped / no new-user traffic.
  if (intents === 0 && blocked.length === 0 && stuck === 0) {
    return (
      <section className="admin-chart-panel admin-chart-panel-wide">
        <header className="admin-chart-head">
          <h3 className="admin-chart-title">First-card friction</h3>
          <span className="admin-chart-sub t-meta">attempts → success, and where blocked</span>
        </header>
        <div className="admin-chart-body">
          <ChartPlaceholder title="No friction signal yet"
            sub="Fires once new users start trying to place cards (card_create_intent / _blocked / _stuck)." />
        </div>
      </section>
    );
  }

  const rate = safeRate(converted, intents);

  return (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">First-card friction</h3>
        <span className="admin-chart-sub t-meta">of sessions that tried to make a card — did they succeed, or hit a dead-end?</span>
      </header>
      <div className="admin-chart-body">
        <MetricGrid>
          <Metric label="Tried (sessions)" value={formatCount(intents)} sub={`${formatCount(data.intents_total)} intents`} />
          <Metric label="Intent → card"
            value={rate.hide ? null : `${formatPct(rate.rate)}${rate.flag ? ' ⚠' : ''}`}
            muted={!rate.ok}
            sub={rate.hide ? `too few (n=${formatCount(intents)})` : `${formatCount(converted)} of ${formatCount(intents)}`} />
          <Metric label="Stuck sessions" value={formatCount(stuck)}
            sub="rage-clicks or 12s with no card" />
        </MetricGrid>

        {blocked.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div className="t-meta" style={{ color: 'var(--ink-3)', marginBottom: 6 }}>
              Where the attempt died
            </div>
            {/* The one place a status colour is the mark: every row here is a
                dead end, so red is the subject rather than a category. */}
            <BarRows
              rows={blocked.map((b) => ({ label: b.name, value: b.sessions }))}
              formatValue={(v) => formatCount(v)}
              colors={VAR.bad}
            />
          </div>
        )}

        {methods.length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <span className="t-meta" style={{ color: 'var(--ink-3)' }}>Attempts by method:</span>
            {methods.map((m) => (
              <span key={m.method} className="t-meta" style={{ color: 'var(--ink-2)' }}>
                {METHOD_LABELS[m.method] || m.method} <strong style={{ color: 'var(--ink-1)' }}>{formatCount(m.sessions)}</strong>
              </span>
            ))}
          </div>
        )}

        {devices.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div className="t-meta" style={{ color: 'var(--ink-3)', marginBottom: 6 }}>
              Intent → card by device — the headline mobile-vs-desktop activation read
            </div>
            <table className="admin-table">
              <thead>
                <tr><th>Device</th><th className="num">Tried</th><th className="num">→ Card</th><th className="num">Rate</th></tr>
              </thead>
              <tbody>
                {devices.map((d) => {
                  const dr = safeRate(d.converted_sessions, d.intent_sessions);
                  return (
                    <tr key={d.device}>
                      <td style={{ textTransform: 'capitalize' }}>
                        <span aria-hidden="true" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2,
                          background: DEVICE_COLOR[d.device] || DEVICE_COLOR.unknown, marginRight: 6 }} />
                        {d.device}
                      </td>
                      <td className="num">{formatCount(d.intent_sessions)}</td>
                      <td className="num">{formatCount(d.converted_sessions)}</td>
                      <td className="num">{dr.hide ? '—' : `${formatPct(dr.rate)}${dr.flag ? ' ⚠' : ''}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <PanelNote>
          “Tried” = sessions with a card-create gesture; “Intent → card” converts to a genuine (non-seed)
          first card in the same session. Blocked bars are the silent dead-ends now made visible — a tall
          bar is a fixable UX leak{intents < MIN_RATE_SHOW ? '. Conversion is suppressed below the trust floor.' : '.'}
        </PanelNote>
      </div>
    </section>
  );
}
