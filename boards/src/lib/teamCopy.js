// teamCopy — the words a real team's actions answer with: one plain line per
// refusal, a short line per success, and the price line a seat purchase shows
// before it is confirmed. Pure. The price line is built from the preview's own
// numbers (teamBillingApi.previewTeamSeatsCost, in cents), never from
// teamModel's client-side seatAddLine / proratedToday, which are the sample's.

import { money, dateLabel } from './teamModel.js';

const REFUSAL = {
  // TEAM_HINT (teamHints.js)
  teams_closed: 'Teams aren’t open to this account yet.',
  team_exists: 'You already have a team.',
  team_seats_full: 'Every seat is in use. Add a seat first.',
  team_seats_ceiling: 'That’s more seats than a team can have here. Talk to us for more.',
  team_seats_ask_admin: 'Every seat is in use. Ask an admin to add one.',
  team_seats_needed: 'That needs more seats than the team has.',
  team_workspace: 'Only your own personal workspaces can move into a team.',
  team_owner: 'The owner’s role and seat can’t be changed that way.',
  team_domain_freemail: 'A free email domain can’t be a team’s.',
  team_domain_taken: 'Another team has verified that domain.',
  team_domain_invalid: 'That doesn’t look like a domain.',
  team_domain_missing: 'That domain isn’t on this team.',
  team_not_member: 'You’re not in this team.',
  team_not_admin: 'Only the owner or an admin can do that.',
  team_not_owner: 'Only the owner can do that.',
  team_inbox_unproven: 'Sign in with a code sent to this address first.',
  team_view_only: 'The team is view-only until it’s paid.',
  team_checkout: 'A team starts at checkout.',
  team_checkout_rate: 'Too many checkouts started today. Try again tomorrow.',
  team_has_plan: 'This team has a plan. Manage it from billing.',
  // new_account: _refuse_if_new (0375) refuses an account under 72 hours old.
  new_account: 'That opens up once your account is three days old.',
  // 0541: the daily invitation allowance (0358/0375) and a sending hold (0369).
  invite_limit_reached: 'You’ve reached today’s invite limit. Try again tomorrow.',
  sending_on_hold: 'Sending is paused on your account while we review unusual activity.',
  // resend_team_invite (0541)
  resend_too_soon: 'That invite went out in the last day. Try again tomorrow.',
  invite_closed: 'That invite was used, withdrawn or has expired. Invite them again.',
  // team-billing
  not_available: 'That isn’t available yet.',
  price_mismatch: 'The price changed. Check it and try again.',
  stale_preview: 'That price is out of date. Check it and try again.',
  stripe_error: 'Stripe couldn’t do that. Nothing was charged.',
  no_plan: 'This team has no plan yet.',
  no_seat_item: 'This team’s plan has no seats to change.',
  retry: 'That’s still going through. Try again in a moment.',
  network: 'Couldn’t reach the server. Check your connection and try again.',
  'auth required': 'Sign in again to do that.',
  not_yet: 'That isn’t ready yet.',
  unsupported: 'That can’t be done from here yet.',
  failed: 'That didn’t work. Try again.',
  // the domain check
  too_many: 'Too many checks. Try again in a few minutes.',
};

const DEFAULT_LINE = 'That didn’t work. Try again.';

export function refusalLine(refusal) {
  const code = refusal && refusal.code;
  if (code && Object.prototype.hasOwnProperty.call(REFUSAL, code)) {
    if (code === 'team_seats_needed' && Number(refusal.needed) > 0) {
      const n = Number(refusal.needed);
      return `That needs ${n} more seat${n === 1 ? '' : 's'}.`;
    }
    return REFUSAL[code];
  }
  return DEFAULT_LINE;
}

const SUCCESS = {
  rename: 'Renamed.',
  role: 'Role changed.',
  remove: 'Removed.',
  revoke: 'Invite revoked.',
  resend: 'Invite sent again.',
  approve: 'Approved.',
  keepViewer: 'Kept as a viewer.',
  removeSeat: 'Seat removed.',
  addSeats: 'Seats added.',
  whenFull: 'Saved.',
  monthlyLimit: 'Saved.',
  invite: 'Invites sent.',
  link: 'Saved.',
  linkRole: 'Saved.',
  newLink: 'New link made. The old one has stopped working.',
  domainOn: 'Saved.',
  addDomain: 'Domain added.',
  removeDomain: 'Domain removed.',
  close: 'The team is closed. Its workspaces are in your account.',
  leave: 'You left the team.',
  seatPerk: 'Saved.',
};

export function successLine(type) {
  return SUCCESS[type] || 'Done.';
}

// A domain check's answer ({ verified, dns }) as one line.
export function domainCheckLine(data, domain) {
  if (data && data.verified) return `${domain} is verified.`;
  return `${domain} isn’t verified yet. DNS can take a while to update.`;
}

// The price of buying seats, from seats_preview's own answer (cents).
export function seatPriceLine(preview) {
  const n = Math.max(1, (preview.seats | 0) - (preview.from_seats | 0));
  const seats = `${n} seat${n === 1 ? '' : 's'}`;
  const each = n === 1 ? '' : ' each';
  const unit = `${money(preview.unit_amount / 100)} a ${preview.interval}${each}`;
  if (preview.trialing) {
    const end = preview.trial_end ? dateLabel(trialMs(preview.trial_end)) : 'soon';
    return `${seats} at ${unit}. Nothing today: your trial ends ${end}.`;
  }
  return `${seats} at ${unit}, ${money(preview.amount_today / 100)} today.`;
}

// The share panel's line when a team's owner or an admin invites people to
// edit with every seat in use (the owner's pick, 2026-10-21): "Inviting
// lena@x.co to edit adds a seat: $25 a month, $9.50 today." The amounts are
// team-billing's seats_preview, as seatPriceLine's are.
export function addSeatInviteLine(preview, who) {
  const n = Math.max(1, (preview.seats | 0) - (preview.from_seats | 0));
  const adds = n === 1 ? 'a seat' : `${n} seats`;
  const unit = `${money(preview.unit_amount / 100)} a ${preview.interval}${n === 1 ? '' : ' each'}`;
  if (preview.trialing) {
    const end = preview.trial_end ? dateLabel(trialMs(preview.trial_end)) : 'soon';
    return `Inviting ${who} to edit adds ${adds}: ${unit}, nothing until your trial ends ${end}.`;
  }
  return `Inviting ${who} to edit adds ${adds}: ${unit}, ${money(preview.amount_today / 100)} today.`;
}

// trial_end is Stripe's epoch seconds, or an ISO string.
function trialMs(v) {
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  const n = Date.parse(v);
  return Number.isNaN(n) ? Date.now() : n;
}

// ── Joining a team by its link or an invite ─────────────────────────────

// What a join answered, as one line; null for a status with nothing to say.
export function teamJoinLine(status, teamName, role) {
  const name = teamName || 'the team';
  switch (status) {
    case 'joined':
      return role === 'viewer'
        ? `You joined ${name} as a viewer. Its workspaces are in your workspace menu.`
        : `You’re in ${name}. Its workspaces are in your workspace menu.`;
    case 'requested': return `You’re in ${name} as a viewer for now. We asked its admins for a seat for you.`;
    case 'already': return `You’re already in ${name}.`;
    case 'off':
    case 'not_found': return 'That team link no longer works. Ask the team for a new one.';
    case 'removed': return `This link can’t add you back to ${name}. Ask one of its admins to invite you.`;
    case 'revoked': return 'That team invite was withdrawn. Ask the team for a new one.';
    case 'expired': return 'That team invite has expired. Ask the team for a new one.';
    default: return null;
  }
}

// A company's team that admitted this account by its email domain.
export function teamDomainJoinLine(teamName, domain) {
  const name = teamName || 'the team';
  return domain
    ? `You joined ${name}, your company’s team, because you signed up with a ${domain} email. Its workspaces are in your workspace menu.`
    : `You joined ${name}, your company’s team. Its workspaces are in your workspace menu.`;
}

// Why accept_team_invite refused.
export function teamInviteRefusalLine(err) {
  if (err && err.hint === 'team_inbox_unproven') {
    return 'To join that team, sign in again with a code sent to the address the invite went to.';
  }
  if (err && err.code === '42501' && /different email/i.test(String(err.message || ''))) {
    return 'That team invite went to a different email address. Sign out, then sign in with that address to join.';
  }
  if (err && err.code === 'P0002') return 'That team invite no longer works. Ask the team for a new one.';
  return DEFAULT_LINE;
}

// claim_my_team_invites joined this many teams.
export function teamInvitesClaimedLine(n) {
  if (!(n >= 1)) return null;
  return n === 1
    ? 'You joined a team you were invited to. Its workspaces are in your workspace menu.'
    : `You joined ${n} teams you were invited to. Their workspaces are in your workspace menu.`;
}
