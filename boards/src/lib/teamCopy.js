// teamCopy — the words a real team's actions answer with: one plain line per
// refusal, a short line per success, and the price line a seat purchase shows
// before it is confirmed. Pure. The price line is built from the preview's own
// numbers (teamBillingApi.previewTeamSeatsCost, in cents), never from
// teamModel's client-side seatAddLine / proratedToday, which are the sample's.

import { t as tr, plural } from '@lingui/core/macro';
import { dateLabel, money } from './teamModelWords.js';
import { WORKSPACE_LIMIT } from './workspaceLimit.js';

// The codes are the server's; the line each one gets is ours, read when it is
// asked for, never at module scope.
function refusalFor(code) {
  switch (code) {
    // TEAM_HINT (teamHints.js)
    case 'teams_closed': return tr`Teams aren’t open to this account yet.`;
    case 'team_exists': return tr`You already have a team.`;
    case 'team_seats_full': return tr`Every seat is in use. Add a seat first.`;
    case 'team_seats_ceiling': return tr`That’s more seats than a team can have here. Talk to us for more.`;
    case 'team_seats_ask_admin': return tr`Every seat is in use. Ask an admin to add one.`;
    case 'team_seats_needed': return tr`That needs more seats than the team has.`;
    case 'team_workspace': return tr`Only your own personal workspaces can move into a team.`;
    case 'team_owner': return tr`The owner’s role and seat can’t be changed that way.`;
    case 'team_domain_freemail': return tr`A free email domain can’t be a team’s.`;
    case 'team_domain_taken': return tr`Another team has verified that domain.`;
    case 'team_domain_invalid': return tr`That doesn’t look like a domain.`;
    case 'team_domain_missing': return tr`That domain isn’t on this team.`;
    case 'team_not_member': return tr`You’re not in this team.`;
    case 'team_not_admin': return tr`Only the owner or an admin can do that.`;
    case 'team_not_owner': return tr`Only the owner can do that.`;
    case 'team_inbox_unproven': return tr`Sign in with a code sent to this address first.`;
    case 'team_view_only': return tr`The team is view-only until it’s paid.`;
    case 'team_checkout': return tr`A team starts at checkout.`;
    case 'team_checkout_rate': return tr`Too many checkouts started today. Try again tomorrow.`;
    case 'team_has_plan': return tr`This team has a plan. Manage it from billing.`;
    // new_account: _refuse_if_new (0375) refuses an account under 72 hours old.
    case 'new_account': return tr`That opens up once your account is three days old.`;
    // 0856: create_workspace_with_root at 10 workspaces of your own (workspaceLimit.js).
    case 'workspace_limit': return tr`${WORKSPACE_LIMIT} workspaces of your own is the most outside a team.`;
    // 0541: the daily invitation allowance (0358/0375) and a sending hold (0369).
    case 'invite_limit_reached': return tr`You’ve reached today’s invite limit. Try again tomorrow.`;
    case 'sending_on_hold': return tr`Sending is paused on your account while we review unusual activity.`;
    // resend_team_invite (0541)
    case 'resend_too_soon': return tr`That invite went out in the last day. Try again tomorrow.`;
    case 'invite_closed': return tr`That invite was used, withdrawn or has expired. Invite them again.`;
    // team-billing
    case 'not_available': return tr`That isn’t available yet.`;
    case 'price_mismatch': return tr`The price changed. Check it and try again.`;
    case 'stale_preview': return tr`That price is out of date. Check it and try again.`;
    case 'stripe_error': return tr`Stripe couldn’t do that. Nothing was charged.`;
    case 'no_plan': return tr`This team has no plan yet.`;
    case 'no_seat_item': return tr`This team’s plan has no seats to change.`;
    case 'retry': return tr`That’s still going through. Try again in a moment.`;
    case 'network': return tr`Couldn’t reach the server. Check your connection and try again.`;
    case 'auth required': return tr`Sign in again to do that.`;
    case 'not_yet': return tr`That isn’t ready yet.`;
    case 'unsupported': return tr`That can’t be done from here yet.`;
    case 'failed': return tr`That didn’t work. Try again.`;
    // the domain check
    case 'too_many': return tr`Too many checks. Try again in a few minutes.`;
    default: return null;
  }
}

const defaultLine = () => tr`That didn’t work. Try again.`;

export function refusalLine(refusal) {
  const code = refusal && refusal.code;
  if (code) {
    if (code === 'team_seats_needed' && Number(refusal.needed) > 0) {
      const n = Number(refusal.needed);
      return tr`${plural(n, { one: 'That needs # more seat.', other: 'That needs # more seats.' })}`;
    }
    const line = refusalFor(code);
    if (line) return line;
  }
  return defaultLine();
}

export function successLine(type) {
  switch (type) {
    case 'rename': return tr`Renamed.`;
    case 'role': return tr`Role changed.`;
    case 'remove': return tr`Removed.`;
    case 'revoke': return tr`Invite revoked.`;
    case 'resend': return tr`Invite sent again.`;
    case 'approve': return tr`Approved.`;
    case 'keepViewer': return tr`Kept as a viewer.`;
    case 'removeSeat': return tr`Seat removed.`;
    case 'addSeats': return tr`Seats added.`;
    case 'whenFull':
    case 'monthlyLimit':
    case 'link':
    case 'linkRole':
    case 'domainOn':
    case 'seatPerk': return tr`Saved.`;
    case 'invite': return tr`Invites sent.`;
    case 'newLink': return tr`New link made. The old one has stopped working.`;
    case 'addDomain': return tr`Domain added.`;
    case 'removeDomain': return tr`Domain removed.`;
    case 'close': return tr`The team is closed. Its workspaces are in your account.`;
    case 'leave': return tr`You left the team.`;
    default: return tr`Done.`;
  }
}

// A domain check's answer ({ verified, dns }) as one line.
export function domainCheckLine(data, domain) {
  if (data && data.verified) return tr`${domain} is verified.`;
  return tr`${domain} isn’t verified yet. DNS can take a while to update.`;
}

// "$25 a month", "$25 a month each": the price of one seat for the interval.
// 'month' and 'year' are the only intervals a team plan has; any other word the
// server sent is said as it came.
function seatUnit(price, interval, each) {
  if (interval === 'month') return each ? tr`${price} a month each` : tr`${price} a month`;
  if (interval === 'year') return each ? tr`${price} a year each` : tr`${price} a year`;
  return each ? tr`${price} a ${interval} each` : tr`${price} a ${interval}`;
}

// The price of buying seats, from seats_preview's own answer (cents).
export function seatPriceLine(preview) {
  const n = Math.max(1, (preview.seats | 0) - (preview.from_seats | 0));
  const seats = tr`${plural(n, { one: '# seat', other: '# seats' })}`;
  const unit = seatUnit(money(preview.unit_amount / 100), preview.interval, n !== 1);
  if (preview.trialing) {
    const end = preview.trial_end ? dateLabel(trialMs(preview.trial_end)) : tr`soon`;
    return tr`${seats} at ${unit}. Nothing today: your trial ends ${end}.`;
  }
  const today = money(preview.amount_today / 100);
  return tr`${seats} at ${unit}, ${today} today.`;
}

// The share panel's line when a team's owner or an admin invites people to
// edit with every seat in use (the owner's pick, 2026-10-21): "Inviting
// lena@x.co to edit adds a seat: $25 a month, $9.50 today." The amounts are
// team-billing's seats_preview, as seatPriceLine's are.
export function addSeatInviteLine(preview, who) {
  const n = Math.max(1, (preview.seats | 0) - (preview.from_seats | 0));
  const adds = tr`${plural(n, { 1: 'a seat', other: '# seats' })}`;
  const unit = seatUnit(money(preview.unit_amount / 100), preview.interval, n !== 1);
  if (preview.trialing) {
    const end = preview.trial_end ? dateLabel(trialMs(preview.trial_end)) : tr`soon`;
    return tr`Inviting ${who} to edit adds ${adds}: ${unit}, nothing until your trial ends ${end}.`;
  }
  const today = money(preview.amount_today / 100);
  return tr`Inviting ${who} to edit adds ${adds}: ${unit}, ${today} today.`;
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
  const name = teamName || tr`the team`;
  switch (status) {
    case 'joined':
      return role === 'viewer'
        ? tr`You joined ${name} as a viewer. Its workspaces are in your workspace menu.`
        : tr`You’re in ${name}. Its workspaces are in your workspace menu.`;
    case 'requested': return tr`You’re in ${name} as a viewer for now. We asked its admins for a seat for you.`;
    case 'already': return tr`You’re already in ${name}.`;
    case 'off':
    case 'not_found': return tr`That team link no longer works. Ask the team for a new one.`;
    case 'removed': return tr`This link can’t add you back to ${name}. Ask one of its admins to invite you.`;
    case 'revoked': return tr`That team invite was withdrawn. Ask the team for a new one.`;
    case 'expired': return tr`That team invite has expired. Ask the team for a new one.`;
    default: return null;
  }
}

// A company's team that admitted this account by its email domain.
export function teamDomainJoinLine(teamName, domain) {
  const name = teamName || tr`the team`;
  return domain
    ? tr`You joined ${name}, your company’s team, because you signed up with a ${domain} email. Its workspaces are in your workspace menu.`
    : tr`You joined ${name}, your company’s team. Its workspaces are in your workspace menu.`;
}

// Why accept_team_invite refused.
export function teamInviteRefusalLine(err) {
  if (err && err.hint === 'team_inbox_unproven') {
    return tr`To join that team, sign in again with a code sent to the address the invite went to.`;
  }
  if (err && err.code === '42501' && /different email/i.test(String(err.message || ''))) {
    return tr`That team invite went to a different email address. Sign out, then sign in with that address to join.`;
  }
  if (err && err.code === 'P0002') return tr`That team invite no longer works. Ask the team for a new one.`;
  return defaultLine();
}

// claim_my_team_invites joined this many teams.
export function teamInvitesClaimedLine(n) {
  if (!(n >= 1)) return null;
  return tr`${plural(n, {
    1: 'You joined a team you were invited to. Its workspaces are in your workspace menu.',
    other: 'You joined # teams you were invited to. Their workspaces are in your workspace menu.',
  })}`;
}
