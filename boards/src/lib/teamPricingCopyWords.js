// teamPricingCopyWords — what /pricing promises for Team, read through Lingui.
//
// App only. teamPricingCopy.js stays as it is, because the Worker's route
// meta, the crawlable /pricing and gen-docs read its English. This module says
// the same things in the same shape; teamPricingCopyWords.test.mjs holds the
// two together. Every figure comes from teamModel.js and billingCopy.js, as a
// placeholder, never typed into a message.

import { t as tr, ph } from '@lingui/core/macro';
import {
  TEAM_SEAT_MIN, TEAM_SEAT_MAX, TEAM_SEAT_PRICE, TEAM_TRIAL_DAYS, TEAM_STORAGE_PER_SEAT, SEAT_PERK_STORAGE,
} from './teamModel.js';
import { money, sizeLabel } from './teamModelWords.js';
import { PLAN_COMPARISON, trialStorageLabel } from './billingCopyWords.js';
import { TEAM_TALK_PATH } from './teamPricingCopy.js';

// The page writes sizes as billingCopy does ('1TB'); the team model adds a space.
const size = (bytes) => sizeLabel(bytes).replace(' ', '');

export function teamCardCopy(editorLimit) {
  const perSeat = tr`a seat /mo`;
  return {
    name: tr`Team`,
    tag: tr`More than ${editorLimit} editors`,
    sub: tr`${TEAM_SEAT_MIN} seats or more. Viewers never use a seat.`,
    monthly: { price: money(TEAM_SEAT_PRICE.month), unit: perSeat },
    annual: { price: money(TEAM_SEAT_PRICE.year / 12), unit: tr`a seat /mo, billed yearly` },
    cta: tr`Start a Team trial`,
    note: tr`${TEAM_TRIAL_DAYS} days free · card needed`,
    talk: tr`Need SSO, invoices or more than ${TEAM_SEAT_MAX} seats?`,
    talkLink: tr`Talk to us`,
    talkHref: TEAM_TALK_PATH,
  };
}

export function teamBenefits(editorLimit) {
  const each = size(TEAM_STORAGE_PER_SEAT);
  const held = size(TEAM_STORAGE_PER_SEAT * TEAM_SEAT_MIN);
  const trial = trialStorageLabel();
  const perk = size(SEAT_PERK_STORAGE);
  return [
    { key: 'team-cards', title: tr`Everything in Creator, for each editor`, body: tr`Unlimited cards in every team workspace.` },
    {
      key: 'team-storage',
      title: tr`${each} a seat, one shared drive`,
      body: tr`${TEAM_SEAT_MIN} seats hold **${held}**, and every seat you add brings ${each} more. ${trial} during the free trial.`,
    },
    {
      key: 'team-seats',
      title: tr`More than ${editorLimit} people who edit`,
      body: tr`A seat for each, ${TEAM_SEAT_MIN} to ${TEAM_SEAT_MAX} on your own. Viewers are free and never use one.`,
    },
    {
      key: 'team-admins',
      title: tr`Admins, and work the team owns`,
      body: tr`Admins handle people and seats. Workspaces belong to the team, so the work stays when someone leaves.`,
    },
    {
      key: 'team-perk',
      title: tr`Their own workspaces, too`,
      body: tr`Everyone with a seat gets unlimited cards and ${perk} more in their personal workspaces, unless the team turns it off.`,
    },
    {
      key: 'team-joining',
      title: tr`Join by link or company email`,
      body: tr`Invite a list, share a team link, or let in anyone from your verified company domain.`,
    },
  ];
}

// The Team column for each of PLAN_COMPARISON's rows (a new row there needs one here).
export const TEAM_COLUMN = {
  get cards() { return tr`Unlimited`; },
  get storage() { const each = size(TEAM_STORAGE_PER_SEAT); return tr`${each} a seat, shared — any file, any size`; },
  get workspaces() { return tr`No limit`; },
};

export function teamComparison(editorLimit) {
  return [
    ...PLAN_COMPARISON.map((r) => ({ key: r.key, label: r.label, demo: r.demo, creator: r.creator, team: TEAM_COLUMN[r.key] })),
    { key: 'editors', label: tr`People who edit`, demo: tr`Up to ${editorLimit}`, creator: tr`Up to ${editorLimit}`, team: tr`A seat each, ${TEAM_SEAT_MIN} to ${TEAM_SEAT_MAX}` },
    { key: 'viewers', label: tr`People who view`, demo: tr`Unlimited`, creator: tr`Unlimited`, team: tr`Unlimited, free` },
    { key: 'admins', label: tr`Admins`, demo: '—', creator: '—', team: tr`Yes` },
    { key: 'domain', label: tr`Join by company email`, demo: '—', creator: '—', team: tr`Yes` },
  ];
}
