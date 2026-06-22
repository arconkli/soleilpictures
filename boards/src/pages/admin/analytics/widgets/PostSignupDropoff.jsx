// PostSignupDropoff — the "exact moment new users fall off after signing up".
// Reads admin_journey_dropoff (migration 0162) jsonb:
//   { total_journeys, phases:[{phase,ord,entered,advanced,dropped,p50_entry_ms,
//     p90_entry_ms,median_dwell_ms}], last_phase_reached:{phase:count} }
// and renders the per-phase fall-off as a horizontal funnel: how many journeys
// ENTERED each phase, with the share that DROPPED there (this was their last
// phase). The drop bar is the headline — it's literally where the journey ended.
//
// Human-glance companion to the raw event stream; the dense per-user traces (the
// real analysis surface) live in analytics_events and the admin_journey_* RPCs.
// Gated below MIN_RATE_SHOW — the post-signup cohort is tiny, so percentages stay
// honest. blocked/stuck are off-path side-states (shown, but a journey can pass
// through them and still reach first_card).

import { formatCount, MIN_RATE_SHOW } from '../../../../lib/adminFormat.js';
import { PanelNote, ChartPlaceholder } from '../../SmallN.jsx';

const SOLEIL = '#ffa500';
const DROP = '#e5484d';

function fmtMs(n) {
  const ms = Number(n);
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  if (s < 3600) return `${(s / 60).toFixed(1)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}
const prettyPhase = (p) => String(p || '').replace(/_/g, ' ');

function Panel({ children }) {
  return (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Post-signup drop-off</h3>
        <span className="admin-chart-sub t-meta">where new users fall off in their first session — signup → first card, phase by phase</span>
      </header>
      <div className="admin-chart-body">{children}</div>
    </section>
  );
}

export function PostSignupDropoff({ data }) {
  const total = Number(data?.total_journeys) || 0;
  const phases = (data?.phases || []).filter((p) => (Number(p.entered) || 0) > 0);

  if (total < MIN_RATE_SHOW || phases.length === 0) {
    return (
      <Panel>
        <ChartPlaceholder title="Post-signup journeys are still collecting"
          sub={`Needs ≥${MIN_RATE_SHOW} new-user journeys with ps_* events. So far: ${total}.`} />
      </Panel>
    );
  }

  const maxEntered = Math.max(...phases.map((p) => Number(p.entered) || 0), 1);
  // The single phase where the most journeys ended — the headline leak.
  const worst = phases.reduce((a, p) => ((Number(p.dropped) || 0) > (Number(a?.dropped) || 0) ? p : a), null);

  return (
    <Panel>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
        <span style={{ font: '700 26px/1 var(--font-display, inherit)', color: 'var(--ink-0)' }}>{formatCount(total)}</span>
        <span className="t-meta" style={{ color: 'var(--ink-3)' }}>
          journeys tracked{worst ? ` · biggest leak: ${formatCount(worst.dropped)} ended at “${prettyPhase(worst.phase)}”` : ''}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {phases.map((p) => {
          const entered = Number(p.entered) || 0;
          const dropped = Number(p.dropped) || 0;
          const advanced = Number(p.advanced) || 0;
          const wEntered = `${(100 * entered / maxEntered).toFixed(1)}%`;
          const wDrop = entered > 0 ? `${(100 * dropped / entered).toFixed(1)}%` : '0%';
          return (
            <div key={p.phase} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 132px', alignItems: 'center', gap: 8 }}>
              <span className="t-meta" style={{ color: 'var(--ink-1)', textTransform: 'capitalize', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {prettyPhase(p.phase)}
              </span>
              <div style={{ position: 'relative', height: 20, background: 'var(--bg-2, rgba(255,255,255,.04))', borderRadius: 4, overflow: 'hidden' }}
                   title={`${formatCount(entered)} entered · ${formatCount(advanced)} advanced · ${formatCount(dropped)} dropped`}>
                {/* entered bar (gold) with the dropped share overlaid (red) */}
                <div style={{ position: 'absolute', inset: 0, width: wEntered, background: 'rgba(255,165,0,.22)' }} />
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `calc(${wEntered} * ${entered > 0 ? dropped / entered : 0})`, background: DROP, opacity: 0.8 }} />
                <span style={{ position: 'absolute', left: 6, top: 2, fontSize: 11, color: 'var(--ink-1)' }}>
                  {formatCount(entered)}{dropped > 0 ? ` · ${formatCount(dropped)} left` : ''}
                </span>
              </div>
              <span className="t-meta" style={{ color: 'var(--ink-3)', fontSize: 11, textAlign: 'right' }}>
                {fmtMs(p.p50_entry_ms)} in · {fmtMs(p.median_dwell_ms)} dwell
              </span>
            </div>
          );
        })}
      </div>

      <PanelNote>
        Each bar = journeys that reached that phase; the <span style={{ color: DROP }}>red</span> share is how many
        ended there (their last phase). “in” = median time from signup to entering the phase; “dwell” = median time
        spent before advancing. <b>blocked</b>/<b>stuck</b> are off-path — a journey can pass through them and still
        reach first&nbsp;card. Tiny cohort: compare to your own past snapshots, not to absolutes.
      </PanelNote>
    </Panel>
  );
}
