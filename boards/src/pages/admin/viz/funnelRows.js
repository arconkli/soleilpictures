// funnelRows — the arithmetic behind FunnelSteps and LeaksSummary, kept in one
// place so the ⚠ on the funnel and the "Biggest leak" beside it can never name
// different transitions. Plain JS, no JSX, so node --test can drive it
// (src/lib/adminFunnelRows.test.mjs).
//
// Reads admin_signup_funnel / admin_fb_funnel rows
// { ord, step, label, branch, sessions, users }.

// Steps the RPC still returns but the product no longer has. welcome_view is
// the waitlist's Welcome page: it is only rendered for tier='waitlist', and the
// waitlist has been off since 2026-06-13, so the step has counted zero ever
// since. Left in the core chain it was the LAST core step, which made
// "OTP verified -> Welcome page" a permanent 100% drop that won "Biggest leak"
// every time and forked the pricing branch from a zero. Dropping it here rather
// than in the RPC keeps the step countable if the waitlist ever comes back.
export const RETIRED_STEPS = new Set(['welcome_view']);

export function liveSteps(steps = []) {
  return (steps || []).filter((s) => !RETIRED_STEPS.has(s.step));
}

function row(s, sessions, prevStep, prev, top, branch, isForkStart) {
  const drop = prev != null ? prev - sessions : 0;
  return {
    key: `${branch}-${s.step}`,
    label: s.label,
    from: prevStep?.label ?? null,
    sessions,
    branch,
    isForkStart,
    fromTop: top > 0 ? sessions / top : 0,
    step: prev && prev > 0 ? sessions / prev : null,
    drop,
    dropPct: prev && prev > 0 ? drop / prev : 0,
  };
}

/**
 * Rows for the core chain and each requested branch, plus the single biggest
 * sequential drop. Branches fork from the last LIVE core step.
 */
export function buildFunnelRows(rawSteps, branches = []) {
  const steps = liveSteps(rawSteps);
  const core = steps.filter((s) => s.branch === 'core');
  const top = Number(core[0]?.sessions) || 0;
  const coreRows = core.map((s, i) => row(
    s, Number(s.sessions) || 0,
    i > 0 ? core[i - 1] : null, i > 0 ? Number(core[i - 1].sessions) || 0 : null,
    top, 'core', false,
  ));

  const forkStep = core[core.length - 1] || null;
  const forkSessions = Number(forkStep?.sessions) || 0;
  const branchRows = branches.map((b) => {
    const bsteps = steps.filter((s) => s.branch === b);
    return {
      branch: b,
      rows: bsteps.map((s, i) => row(
        s, Number(s.sessions) || 0,
        i > 0 ? bsteps[i - 1] : forkStep,
        i > 0 ? Number(bsteps[i - 1].sessions) || 0 : forkSessions,
        top, b, i === 0,
      )),
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

  return { top, coreRows, branchRows, biggest, biggestKey: biggest?.key || null };
}
