// teamSnapshot — folds get_team (0535, times in epoch ms) and, for owners
// and admins, get_team_billing (0538, times as ISO strings) into the
// TeamSnapshot of teamModel.js's header. Pure. A member's snapshot carries
// what the server sent and nothing more: no billing, no emails made up.

const DAY = 864e5;

function ms(x) {
  if (x == null) return null;
  const n = Date.parse(x);
  return Number.isNaN(n) ? null : n;
}

export function toTeamSnapshot(team, billing) {
  const b = billing || null;

  const plan = b && b.plan
    ? {
        interval: b.plan === 'annual' ? 'year' : 'month',
        seats: b.seats,
        renewsAt: ms(b.current_period_end),
        trialEndsAt: ms(b.trial_end),
        status: b.subscription_status,
        cancelAtPeriodEnd: !!b.cancel_at_period_end,
        card: null,
        receiptsTo: null,
      }
    : null;

  const storage = b
    ? { usedBytes: b.storage_used_bytes, quotaBytes: b.storage_quota_bytes }
    : null;

  const whenFull = team.whenFull
    ? { ...team.whenFull, addedThisMonth: b?.auto_added_this_month ?? null }
    : null;

  const since = b ? (b.past_due_since ?? b.view_only_since) : null;
  const unpaid = since
    ? {
        failedAt: ms(since),
        graceEndsAt: ms(b.grace_ends_at),
        viewOnly: team.status === 'view_only',
        deleteAt: b.view_only_since ? ms(b.view_only_since) + 365 * DAY : null,
      }
    : null;

  return {
    id: team.id,
    name: team.name,
    letter: team.letter,
    color: team.color,
    sample: false,
    status: team.status,
    me: team.me,
    admins: team.admins,
    people: team.people,
    requests: team.requests ?? null,
    plan,
    storage,
    whenFull,
    joining: team.joining ?? null,
    unpaid,
    workspaces: team.workspaces,
    seats: team.seats ?? null,
  };
}

export function snapshotIsReal(t) {
  return !!t && t.sample === false;
}
