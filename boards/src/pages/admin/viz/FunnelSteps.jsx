// FunnelSteps — the stepped-bar funnel. Moved here from
// analytics/widgets/SignupFunnelPanel.jsx, where it was the one genuinely good
// chart on the dashboard and the only one already hand-rolled.
//
// The original reasoning still holds and is worth keeping: a Recharts
// FunnelChart is visually broken at this scale (133 → 13 → … → 1) and can only
// show one number per step. Here each row carries the proportional bar, the
// absolute count, the share of the top, and the step-to-step drop at once, and
// the single biggest drop takes a red accent and a ⚠ so the eye lands on the
// actual problem.
//
// Two things changed in the move:
//
//   * The bars were gold. Gold is the reserved active/selection accent, and a
//     funnel is the largest block of colour on the page — so it was most of why
//     the dashboard read orange. Bars now use the validated series hues.
//
//   * The waitlist branch is no longer rendered by default. The waitlist has
//     been off since 2026-06-13, so ords 5-6 draw a permanent flat zero, and a
//     flat zero reads as a measurement rather than an absence. The branch and
//     its RPC are untouched — pass branches={['waitlist','pricing']} if it ever
//     comes back.
//
// Reads admin_signup_funnel rows { ord, step, label, branch, sessions, users }.

import { useMemo } from 'react';
import { formatCount, formatPct, MIN_RATE_FLAG } from '../../../lib/adminFormat.js';
import { PanelNote } from '../SmallN.jsx';
import { VAR } from './palette.js';

const BRANCH_META = {
  waitlist: { marker: '◆', color: VAR.cat[1], label: 'Waitlist intent' },
  pricing:  { marker: '◇', color: VAR.cat[1], label: 'Pricing intent' },
  // FB/IG instant-demo funnel: the two choices on the AdWelcome price offer.
  demo:     { marker: '◆', color: VAR.cat[0], label: 'Free workspace' },
  buy:      { marker: '◇', color: VAR.cat[1], label: 'Creator purchase' },
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
  }).filter((bg) => bg.rows.length > 0);

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
  // Core steps are one series and take the workhorse hue; a branch is a
  // genuinely different path, so it earns a different one.
  const color = meta?.color || VAR.cat[0];
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

export function FunnelSteps({
  steps = [],
  days = 30,
  title = 'Signup funnel',
  sub = 'where sessions fall off, top → fork → outcome',
  branches = ['pricing'],
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
        {/* Every panel states its population and window — the Command Center
            rule. "browsers" rather than "sessions" is deliberate: the funnel
            RPCs count distinct session_id, which 0248 documents as a DEVICE id
            minted once into localStorage and never rotated. */}
        <span className="admin-chart-sub t-meta">{sub} · n={formatCount(top)} browsers · last {days}d</span>
      </header>
      <div className="admin-chart-body">
        <div className="admin-hero-funnel">
          <div className="admin-funnel-row admin-funnel-row-head">
            <span className="admin-funnel-row-label">Step</span>
            <span />
            <span className="admin-funnel-row-count">Browsers</span>
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
