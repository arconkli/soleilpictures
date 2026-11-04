// workspaceLimitCopy — the words of the "You have 10 workspaces" box and the
// seat holder's "Just me" line. Pure; imported only by lazy components. Every
// number comes from WORKSPACE_LIMIT and the person's own count.
import { WORKSPACE_LIMIT } from './workspaceLimit.js';

// { title, body, primary, secondary }: `primary` is null where teams are closed
// (the single button is then `secondary`, 'OK'). `n` above the limit reads "over".
// `onTeam`: already on a team without a seat, so the way out is its admin, not a new team.
export function limitBoxCopy(n, { teams = true, onTeam = false } = {}) {
  const over = n > WORKSPACE_LIMIT;
  const title = `You have ${n} workspaces`;
  if (!teams) {
    return {
      title,
      body: over
        ? `You keep all of them. New ones open up once you have fewer than ${WORKSPACE_LIMIT}.`
        : 'That’s the most you can have. Delete one you no longer need to make room.',
      primary: null,
      secondary: 'OK',
    };
  }
  if (onTeam) {
    return {
      title,
      body: over
        ? `You keep all of them. New ones open up once you have fewer than ${WORKSPACE_LIMIT} — or ask your team’s admin for a seat; team workspaces have no limit.`
        : 'That’s the most you can have outside a team. Workspaces on your team don’t count and have no limit: ask its admin for a seat to make them. Or delete one you no longer need to make room.',
      primary: null,
      secondary: 'OK',
    };
  }
  return {
    title,
    body: over
      ? `You keep all of them. New ones open up once you have fewer than ${WORKSPACE_LIMIT} — or start a team, where there’s no limit.`
      : 'That’s the most you can have outside Team. On Team, workspaces belong to the team and there’s no limit. Or delete one you no longer need to make room.',
    primary: 'Start a team',
    secondary: 'Not now',
  };
}

// The line under the disabled "Just me" option in a seat holder's New workspace box.
export function justMeLimitLine(n) {
  return n > WORKSPACE_LIMIT
    ? `You have ${n} of your own; the most outside a team is ${WORKSPACE_LIMIT}.`
    : `You have ${WORKSPACE_LIMIT} of your own, the most outside a team.`;
}
