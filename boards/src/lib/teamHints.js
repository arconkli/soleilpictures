// teamHints.js — the hints the Team plan's SQL (0522, 0530-0535, 0538) raises, as
// the app reads them. Every refusal carries one of these in the error's
// `hint`; teamHints.test.mjs reads the SQL and holds the strings together.
// Pure, so it runs in node.

export const TEAM_HINT = {
  teams_closed: 'teams_closed',                     // 0522's gate: teams aren't open to this account yet
  team_exists: 'team_exists',
  team_seats_full: 'team_seats_full',               // no free seat; the caller can add one
  team_seats_ceiling: 'team_seats_ceiling',
  team_seats_ask_admin: 'team_seats_ask_admin',     // no free seat; the caller can only ask an admin
  team_seats_needed: 'team_seats_needed',           // `details` is how many more seats it takes
  team_workspace: 'team_workspace',
  team_owner: 'team_owner',
  team_domain_freemail: 'team_domain_freemail',
  team_domain_taken: 'team_domain_taken',
  team_domain_invalid: 'team_domain_invalid',
  team_not_member: 'team_not_member',
  team_not_admin: 'team_not_admin',
  team_not_owner: 'team_not_owner',
  team_inbox_unproven: 'team_inbox_unproven',
  team_view_only: 'team_view_only',
  team_checkout: 'team_checkout',                   // 0538: a team starts at checkout (team-billing), not create_team
  team_checkout_rate: 'team_checkout_rate',         // too many checkouts started today
  team_has_plan: 'team_has_plan',                   // paying again while the plan is still live: manage it instead
  new_account: 'new_account',
};

// What a failed team call means: null when it wasn't a team refusal, else
// { kind, needed }. `kind` is the hint; `needed` is the seat shortfall for
// team_seats_needed (the SQL puts the count in `detail`, which supabase-js
// hands back as `details`) and null for every other kind.
export function teamRefusal(err) {
  const hint = err?.hint;
  if (!hint || !Object.prototype.hasOwnProperty.call(TEAM_HINT, hint)) return null;
  let needed = null;
  if (hint === TEAM_HINT.team_seats_needed) {
    const n = Number(err?.details ?? err?.detail);
    needed = Number.isFinite(n) ? n : null;
  }
  return { kind: hint, needed };
}
