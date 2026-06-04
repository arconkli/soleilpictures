// SignupFunnelPanel — the hero funnel visualization.
//
// We deliberately hand-roll a stepped horizontal-bar table instead of using a
// Recharts FunnelChart: at this scale (133 → 13 → … → 1) a trapezoid chart is
// visually broken and can't show four numbers per step. Here every row shows
// the proportional bar (from-top %), the absolute count, the from-top %, and
// the step-to-step drop at once — and the single biggest drop gets a red
// accent + ⚠ so the eye lands on the one real problem (the landing→email leak).
//
// Reads admin_signup_funnel rows { ord, step, label, branch, sessions, users }.
// The shared `core` steps render once (landing → email → otp → welcome); the
// flow then forks into the waitlist and pricing branches, each denominated
// against the welcome_view count ("of those who reached the fork").

import { useMemo } from 'react';
import { formatCount, formatPct, MIN_RATE_FLAG } from '../../../../lib/adminFormat.js';
import { PanelNote } from '../../SmallN.jsx';

const SOLEIL = '#ffa500';
const GREEN  = '#50c878';
const BRANCH_META = {
  waitlist: { marker: '◆', color: SOLEIL, label: 'Waitlist intent'  },
  pricing:  { marker: '◇', color: GREEN,  label: 'Pricing intent'   },
  // FB/IG instant-demo funnel: the two choices on the AdWelcome price offer.
  demo:     { marker: '◆', color: SOLEIL, label: 'Free workspace'   },
  buy:      { marker: '◇', color: GREEN,  label: 'Creator purchase' },
};

function row(s, sessions, prev, top, branch, isForkStart) {
  const drop = prev != null ? prev - sessions : 0;
  return {
    key: `${branch}-${s.step}`,
    label: s.label,
    sessions,
    branch,
    isForkStart,
    fromTop: top > 0 ? sessions / top : 0,
    step: prev && prev > 0 ? sessions / prev : null,
    drop,
    dropPct: prev && prev > 0 ? drop / prev : 0,
  };
}

function buildRows(steps, branches) {
  const core = steps.filter((s) => s.branch === 'core');
  const top = Number(core[0]?.sessions) || 0;
  const coreRows = core.map((s, i) =>
    row(s, Number(s.sessions) || 0, i > 0 ? Number(core[i - 1].sessions) || 0 : null, top, 'core', false));

  const forkSessions = Number(core[core.length - 1]?.sessions) || 0;  // welcome_view
  const branchRows = branches.map((b) => {
    const bsteps = steps.filter((s) => s.branch === b);
    return {
      branch: b,
      rows: bsteps.map((s, i) =>
        row(s, Number(s.sessions) || 0, i > 0 ? Number(bsteps[i - 1].sessions) || 0 : forkSessions, top, b, i === 0)),
    };
  });

  // Biggest single drop across every sequential transition → gets the ⚠.
  // Skip each branch's FIRST row: its "drop" from the fork is the split between
  // the branches (e.g. chose the demo instead of buying), not a sequential
  // leak, so flagging it as the biggest leak would be misleading.
  let biggest = null;
  const scan = (rows) => rows.forEach((r) => {
    if (r.drop > 0 && (!biggest || r.dropPct > biggest.dropPct)) biggest = r;
  });
  scan(coreRows.slice(1));
  branchRows.forEach((bg) => scan(bg.rows.filter((r) => !r.isForkStart)));

  return { top, coreRows, branchRows, biggestKey: biggest?.key || null };
}

function FunnelRow({ r, lowN, biggest }) {
  const meta = BRANCH_META[r.branch];
  const color = meta?.color || SOLEIL;
  const isLeak = biggest;
  const dropText = r.drop <= 0 || r.step == null
    ? (r.step == null ? '—' : '0')
    : `−${formatCount(r.drop)} (${formatPct(r.dropPct)})`;
  return (
    <div className={`admin-funnel-row ${r.isForkStart ? 'is-fork-start' : ''} ${isLeak ? 'is-biggest-leak' : ''}`}>
      <span className="admin-funnel-row-label">
        {meta && <span className="admin-funnel-marker" style={{ color }}>{meta.marker}</span>}
        {r.label}
      </span>
      <span className="admin-funnel-bar-lg">
        <span className="admin-funnel-bar-fill" style={{ width: `${Math.max(2, Math.round(r.fromTop * 100))}%`, background: color }} />
      </span>
      <span className="admin-funnel-row-count">{formatCount(r.sessions)}</span>
      <span className={`admin-funnel-row-pct ${lowN ? 'admin-muted' : ''}`}>{formatPct(r.fromTop)}</span>
      <span className={`admin-funnel-row-drop ${lowN ? 'admin-muted' : (r.drop > 0 ? 'is-loss' : '')}`}>
        {isLeak && <span className="admin-funnel-leak-warn">⚠ </span>}{dropText}
      </span>
    </div>
  );
}

export function SignupFunnelPanel({
  steps = [],
  days = 30,
  title = 'Signup funnel',
  sub = 'where sessions fall off, top → fork → outcome',
  branches = ['waitlist', 'pricing'],
  forkLabel = 'Forks at Welcome →',
}) {
  const { top, coreRows, branchRows, biggestKey } = useMemo(() => buildRows(steps, branches), [steps, branches]);
  const lowN = top > 0 && top < MIN_RATE_FLAG;

  if (top === 0) {
    return (
      <section className="admin-chart-panel admin-chart-panel-wide">
        <header className="admin-chart-head">
          <h3 className="admin-chart-title">{title}</h3>
        </header>
        <div className="admin-empty">No funnel sessions in this window.</div>
      </section>
    );
  }

  return (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">{title}</h3>
        <span className="admin-chart-sub t-meta">{sub} · n={formatCount(top)} sessions · last {days}d</span>
      </header>
      <div className="admin-chart-body">
        <div className="admin-hero-funnel">
          <div className="admin-funnel-row admin-funnel-row-head">
            <span className="admin-funnel-row-label">Step</span>
            <span />
            <span className="admin-funnel-row-count">Sessions</span>
            <span className="admin-funnel-row-pct">From top</span>
            <span className="admin-funnel-row-drop">Drop</span>
          </div>

          {coreRows.map((r) => (
            <FunnelRow key={r.key} r={r} lowN={lowN} biggest={r.key === biggestKey} />
          ))}

          {branchRows.length > 0 && (
            <div className="admin-funnel-fork">{forkLabel}</div>
          )}

          {branchRows.map((bg) => (
            <div key={bg.branch} className="admin-funnel-branch">
              <div className="admin-funnel-branch-label" style={{ color: BRANCH_META[bg.branch]?.color }}>
                {BRANCH_META[bg.branch]?.marker} {BRANCH_META[bg.branch]?.label}
              </div>
              {bg.rows.map((r) => (
                <FunnelRow key={r.key} r={r} lowN={lowN} biggest={r.key === biggestKey} />
              ))}
            </div>
          ))}
        </div>
        {lowN && (
          <PanelNote>
            Percentages are directional at this volume (n={formatCount(top)}). Bars and counts are exact. Internal/admin traffic excluded.
          </PanelNote>
        )}
      </div>
    </section>
  );
}
