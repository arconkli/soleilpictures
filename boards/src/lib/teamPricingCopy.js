// teamPricingCopy.js — what /pricing promises for Team: the Team card's
// benefits and the comparison's Team column. Lazy with the Team card.
//
// Every figure comes from the code that enforces it (billingCopy.js's rule):
// the seat range and the drive from teamModel.js (start_team_checkout holds
// 3 to 100 seats, 0538; _team_storage_seat_bytes, 0539), the seat perk from
// _seat_perk_storage_bytes (0536), the trial drive from
// _storage_quota_trial_bytes (TRIAL_STORAGE_LABEL; a team's drive waits for
// its first payment, _org_storage_quota_bytes 0537). The editor limit is
// passed in (editorLimit.js EDITOR_LIMIT): importing it here would split the
// app, as teamModel.js's teamHeroLine says.
import {
  TEAM_SEAT_MIN, TEAM_SEAT_MAX, TEAM_SEAT_PRICE, TEAM_TRIAL_DAYS, TEAM_STORAGE_PER_SEAT, SEAT_PERK_STORAGE, money, sizeLabel,
} from './teamModel.js';
import { PLAN_COMPARISON, TRIAL_STORAGE_LABEL } from './billingCopy.js';

// The page writes sizes as billingCopy does ('1TB'); the team model adds a space.
const size = (bytes) => sizeLabel(bytes).replace(' ', '');

// "Talk to us" is a page of its own (TalkToUsPage, direction C of the Team
// canvas): routed in main.jsx, its title and description in the Worker's
// ROUTE_META, which reads them from here.
export const TEAM_TALK_PATH = '/pricing/talk-to-us';
export const TEAM_TALK_META = Object.freeze({
  title: 'Talk to us — Soleil Clusters',
  description: `Single sign-on, invoices and purchase orders, or more than ${TEAM_SEAT_MAX} seats on Soleil Clusters Team: tell us what your team needs, and we’ll write back.`,
});

// The card's own lines and the Talk to us line under the cards. The crawlable
// /pricing (pricingCrawlable.js) prints the same ones.
export function teamCardCopy(editorLimit) {
  return {
    name: 'Team',
    tag: `More than ${editorLimit} editors`,
    sub: `${TEAM_SEAT_MIN} seats or more. Viewers never use a seat.`,
    // The price under each billing choice of the page's toggle.
    monthly: { price: money(TEAM_SEAT_PRICE.month), unit: 'a seat /mo' },
    annual: { price: money(TEAM_SEAT_PRICE.year / 12), unit: 'a seat /mo, billed yearly' },
    cta: 'Start a Team trial',
    note: `${TEAM_TRIAL_DAYS} days free · card needed`,
    talk: `Need SSO, invoices or more than ${TEAM_SEAT_MAX} seats?`,
    talkLink: 'Talk to us',
    talkHref: TEAM_TALK_PATH,
  };
}

export function teamBenefits(editorLimit) {
  return [
    // subject_entitlement (0536): a team's workspaces have no card cap.
    { key: 'team-cards', title: 'Everything in Creator, for each editor', body: 'Unlimited cards in every team workspace.' },
    {
      key: 'team-storage',
      title: `${size(TEAM_STORAGE_PER_SEAT)} a seat, one shared drive`,
      body: `${TEAM_SEAT_MIN} seats hold **${size(TEAM_STORAGE_PER_SEAT * TEAM_SEAT_MIN)}**, and every seat you add brings ${size(TEAM_STORAGE_PER_SEAT)} more. ${TRIAL_STORAGE_LABEL} during the free trial.`,
    },
    // _team_seats_used (0531): every editor holds a seat, guests included; viewers never.
    {
      key: 'team-seats',
      title: `More than ${editorLimit} people who edit`,
      body: `A seat for each, ${TEAM_SEAT_MIN} to ${TEAM_SEAT_MAX} on your own. Viewers are free and never use one.`,
    },
    // org_members roles (0530): admins manage people and seats; workspaces.org_id keeps the work with the team.
    {
      key: 'team-admins',
      title: 'Admins, and work the team owns',
      body: 'Admins handle people and seats. Workspaces belong to the team, so the work stays when someone leaves.',
    },
    // The seat perk (0536), on unless the team's admins turn it off.
    {
      key: 'team-perk',
      title: 'Their own workspaces, too',
      body: `Everyone with a seat gets unlimited cards and ${size(SEAT_PERK_STORAGE)} more in their personal workspaces, unless the team turns it off.`,
    },
    // org_invites, team links and org_domains (0534); the domain check (0540).
    {
      key: 'team-joining',
      title: 'Join by link or company email',
      body: 'Invite a list, share a team link, or let in anyone from your verified company domain.',
    },
  ];
}

// The Team column for each of PLAN_COMPARISON's rows (a new row there needs one here).
export const TEAM_COLUMN = Object.freeze({
  cards: 'Unlimited',
  storage: `${size(TEAM_STORAGE_PER_SEAT)} a seat, shared — any file, any size`,
});

export function teamComparison(editorLimit) {
  return [
    ...PLAN_COMPARISON.map((r) => ({ ...r, team: TEAM_COLUMN[r.key] })),
    { key: 'editors', label: 'People who edit', demo: `Up to ${editorLimit}`, creator: `Up to ${editorLimit}`, team: `A seat each, ${TEAM_SEAT_MIN} to ${TEAM_SEAT_MAX}` },
    { key: 'viewers', label: 'People who view', demo: 'Unlimited', creator: 'Unlimited', team: 'Unlimited, free' },
    { key: 'admins', label: 'Admins', demo: '—', creator: '—', team: 'Yes' },
    { key: 'domain', label: 'Join by company email', demo: '—', creator: '—', team: 'Yes' },
  ];
}
