// testsCatalog.js — every test the admin's Analytics › Tests view reads: what it
// is, what each side gets, when it started, when it is read, and what it is
// measured on. The numbers come from admin_tests_read (0810); the rules that turn
// them into words are in testsView.js.
//
// Pure and node-testable (testsCatalog.test.mjs): no React, no Supabase.
//
// The start instants are the code's own (SETUP_EPOCH, BOARD_MORE_EPOCH, the
// sign-up box's startsAt), never typed again here, and 0810 is checked against
// them by testsMigration.test.mjs. The read dates are the ones each test's saved
// read was registered with. That saved read, outside this public repo, also holds
// what counts as a win: nothing here says how big a gap has to be.
//
// Every key in EXPERIMENTS must have an entry here, whether it is running, off,
// or long finished, so a new test can't go unseen (testsCatalog.test.mjs).

import { EXPERIMENTS } from './experiments.js';
import { SETUP_EPOCH } from './setupRule.js';
import { BOARD_MORE_EPOCH } from './boardMoreEpoch.js';

// The share ask at ten cards reached everyone with production's 10-29 release.
// Its "before" is the four weeks up to the same instant.
export const SHARE_ASK_RELEASE = '2026-10-29T05:15:00Z';
export const SHARE_ASK_BEFORE_FROM = '2026-09-28T00:00:00Z';

// The email hold-back's coin began when 0790 was applied (2026-10-29 01:37:57Z).
// Emails sent earlier that day had no coin, so they aren't counted.
export const EMAIL_HOLDOUT_START = '2026-10-29T01:38:00Z';

// The four sections of the page, in order.
export const TEST_GROUPS = [
  { id: 'running', label: 'Running', sub: 'a coin flip decides who gets which side' },
  { id: 'changed', label: 'Just changed', sub: 'everyone got it; read as before against after' },
  { id: 'waiting', label: 'Waiting or off', sub: 'nothing running yet' },
  { id: 'earlier', label: 'Earlier tests', sub: 'stopped or decided' },
];

// kind: 'coin' (a coin flip per account or device), 'holdout' (half of those
// due an email don't get it), 'beforeafter' (everyone got it on a date),
// 'rotation' (two versions take turns).
//
// A measure's role: 'decides' or 'aims at' (what the test is read on),
// 'guardrail' (must not get worse), 'counted' (shown, not read).
// windowDays: how long after joining someone has to have had before they count.
export const TESTS = [
  {
    key: 'workspace_setup', group: 'running', kind: 'coin', unit: 'account', registry: true,
    name: 'Workspace setup',
    what: 'New people set up their workspace before they reach the board.',
    aName: 'As before', a: 'Straight to the board.',
    bName: 'Setup steps', b: 'Name the workspace, who it’s for and what work it holds, get the invite link; one more invite ask at 6 cards.',
    startIso: SETUP_EPOCH,
    reads: [{ iso: '2026-11-19', what: 'Guardrails' }, { iso: '2026-12-17', what: 'Verdict' }],
    verdictIso: '2026-12-17',
    neitherNote: 'never reached the app',
    // Only B's setup steps log setup_step: one from someone in A is a leak.
    leak: 'got the setup steps',
    measures: [
      { id: 'back_7d', label: 'Came back within 7 days', sub: 'a second working visit within 7 days of the first', role: 'decides', windowDays: 7 },
      { id: 'joined_7d', label: 'Someone joined their work within 7 days', sub: 'a teammate joined, took the invite, or opened a shared cluster', role: 'also read', windowDays: 7 },
      { id: 'card_1d', label: 'Placed a first card on day one', sub: 'within 24 hours of signing up', role: 'guardrail', windowDays: 1 },
      { id: 'board_1d', label: 'Reached the board on day one', sub: 'the app opened within 24 hours', role: 'guardrail', windowDays: 1 },
    ],
    signals: [],
  },
  {
    key: 'first_board_more', group: 'running', kind: 'coin', unit: 'account', registry: true,
    name: 'First board asks for more',
    what: 'When a third card lands on someone’s first board, ask for a whole folder or a note.',
    aName: 'As before', a: 'Nothing is shown.',
    bName: 'The ask', b: 'One toast, “Good start. Add more?”, with Bring in a folder and Add a note.',
    startIso: BOARD_MORE_EPOCH,
    reads: [{ iso: '2026-11-26', what: 'Guardrails' }, { iso: '2027-01-07', what: 'Verdict' }],
    verdictIso: '2027-01-07',
    neitherNote: 'never reached the app',
    // Only B is ever shown the ask: a view from someone in A is a leak.
    leak: 'were shown the ask',
    measures: [
      { id: 'ten_1d', label: '10 or more cards on day one', sub: 'the score it aims at', role: 'aims at', windowDays: 1 },
      { id: 'back_7d', label: 'Came back within 7 days', sub: 'a second working visit within 7 days of the first', role: 'decides', windowDays: 7 },
      { id: 'card_1d', label: 'Placed a first card on day one', sub: 'within 24 hours of signing up', role: 'guardrail', windowDays: 1 },
      { id: 'deleted_half_7d', label: 'Deleted half their cards or more', sub: 'within 7 days, of those who placed any', role: 'guardrail', windowDays: 7, lowerIsBetter: true },
    ],
    // The ask itself: shown to people in B once their first board reaches 3 cards.
    signals: [{ id: 'shown', label: 'The ask', due: 'people in B reached 3 cards', quietDays: 3, minDue: 3 }],
  },
  {
    key: 'signup_box', group: 'running', kind: 'coin', unit: 'device', registry: true,
    name: 'Sign-up box on search pages',
    what: 'On /vs, /tools, /use-cases and /best, sign up right on the page.',
    aName: 'As before', a: 'The gold button, which goes to the home page’s form.',
    bName: 'The box', b: 'A one-line email box in place of the button; the code is typed in the same spot.',
    startIso: EXPERIMENTS.signup_box.startsAt,
    reads: [{ iso: '2026-11-12', what: 'Safety check' }, { iso: '2026-12-31', what: 'Verdict' }],
    verdictIso: '2026-12-31',
    inNote: 'Per device, signed-out visitors only',
    measures: [
      { id: 'signup_1d', label: 'Made an account within 24 hours', sub: 'of first seeing the page', role: 'decides', windowDays: 1 },
      { id: 'card_1d', label: 'First card within 24 hours of signing up', sub: 'of those who signed up', role: 'guardrail', windowDays: 1 },
    ],
    // The box sends a code when someone in B types an email into it. Few do,
    // so it takes many quiet views before silence means anything.
    signals: [{ id: 'box_sent', label: 'A box send', due: 'devices in B saw the box', quietDays: 3, minDue: 150 }],
  },
  {
    key: 'email_holdout', group: 'running', kind: 'holdout', unit: 'email', registry: false,
    name: 'Follow-up emails, half held back',
    what: 'Do the day-one nudge and the “your board is waiting” email bring people back?',
    aName: 'Sent', a: 'The email goes out, as it always did.',
    bName: 'Held back', b: 'Half of the people due each email don’t get it, for 6 weeks.',
    // Held back minus sent, so a gap below zero is the email helping: the email
    // is the thing in use, and its side being ahead is the good news.
    goodSide: 'A',
    gapNote: 'held back minus sent: below zero means the email helps',
    // The read returns the live start: app_config's holdout_from, or this
    // instant if it is later.
    startIso: EMAIL_HOLDOUT_START,
    reads: [{ iso: '2026-11-12', what: 'First look' }, { iso: '2026-12-14', what: 'Verdict' }],
    verdictIso: '2026-12-14',
    noneText: 'None due yet',
    // Made something: a card placed or edited, or a doc edited, in the 72 hours
    // after the send, or after the moment a held-back person would have had it
    // (admin_email_impact's measure, 0494). Opened the app: an app_open in the 7 days.
    measures: [
      { id: 'nudge_made_72h', label: 'Made something within 72 hours', sub: 'day-one nudge', role: 'decides', windowDays: 3 },
      { id: 'waiting_made_72h', label: 'Made something within 72 hours', sub: 'board waiting', role: 'decides', windowDays: 3 },
      { id: 'nudge_open_7d', label: 'Opened the app within 7 days', sub: 'day-one nudge', role: 'also read', windowDays: 7 },
      { id: 'waiting_open_7d', label: 'Opened the app within 7 days', sub: 'board waiting', role: 'also read', windowDays: 7 },
    ],
    signals: [],
  },
  {
    key: 'share_ask', group: 'changed', kind: 'beforeafter', unit: 'person', registry: false,
    name: 'Share ask at ten cards',
    what: 'Not a coin flip: everyone got the change, so it’s read as before against after.',
    aName: 'Before', a: 'Asked at 6 cards, and only if no other ask came first that visit (Sep 28 to Oct 29).',
    bName: 'Since Oct 29', b: 'Asked when a cluster just reaches 10 cards, even after a tip.',
    startIso: SHARE_ASK_RELEASE,
    reads: [{ iso: '2026-11-05', what: 'First read' }, { iso: '2026-11-12', what: 'Verdict' }],
    verdictIso: '2026-11-12',
    inNote: 'People who took a cluster past 10 cards (before: Sep 28 to Oct 29)',
    noneText: 'No one has reached 10 since the release',
    measures: [
      { id: 'shown_1d', label: 'Shown the ask within a day of reaching 10', sub: 'its reach', role: 'aims at', windowDays: 1 },
      { id: 'tips', label: 'Tips taken when shown', sub: 'every tip shown, everyone; tips must not suffer', role: 'guardrail', windowDays: 0 },
    ],
    signals: [{ id: 'ask_at_10', label: 'An ask at 10', due: 'people reached 10 cards', quietDays: 2, minDue: 5 }],
  },
  {
    key: 'trial_early', group: 'waiting', kind: 'coin', unit: 'account', registry: true,
    name: 'Free trial from the first card',
    what: 'Offer the 14-day Creator trial from someone’s first card.',
    aName: 'As before', a: 'The trial is offered from 13 cards.',
    bName: 'From card one', b: 'The trial is offered from the first card.',
    offNote: 'Switched off until about Nov 19, after the wall-trial read.',
    reads: [],
    verdictIso: null,
    measures: [],
    signals: [],
  },
  {
    key: 'whats_new', group: 'waiting', kind: 'rotation', unit: 'email', registry: false,
    name: 'What’s new email, two versions',
    what: 'Two versions of the update email take turns.',
    aName: 'Version A', a: 'The first version.',
    bName: 'Version B', b: 'The second version.',
    inNote: 'Sent so far',
    reads: [],
    verdictIso: null,
    measures: [
      { id: 'back_1d', label: 'Came back within a day', sub: 'of the email', role: 'counted', windowDays: 1 },
    ],
    signals: [],
  },
];

// Finished, stopped and paused tests: the folded list at the bottom. `key` ties
// a registry entry to its line here.
export const EARLIER_TESTS = [
  { key: 'onboarding_v2', name: 'Image-first empty board', when: 'Jun 27', out: 'B shipped to everyone' },
  { key: 'instant_entry', name: 'Straight into the board', when: 'Jun 26', out: 'B shipped to everyone' },
  { key: 'welcome_showcase', name: 'Showcase board', when: 'Jun 27', out: 'Stopped, folded into the empty-board test' },
  { key: 'first_card_cta', name: 'First-card button', when: 'Jun', out: 'Paused' },
  { key: 'coachmark_copy', name: 'Coachmark wording', when: 'Jun', out: 'Paused' },
  { key: 'winback_email', name: 'Come-back email, two versions', when: '', out: 'Off' },
  { key: 'followup_versions', name: 'Follow-up email versions', when: 'Oct 29', out: 'Stopped: one version each now' },
];

export function testByKey(key) {
  return TESTS.find((t) => t.key === key) || null;
}

// Whether a test is on in this build: a registry test follows its master switch
// and, for one with a start instant, the clock; the others are on unless they
// carry an offNote.
export function isTestOn(t, nowIso = new Date().toISOString()) {
  if (!t || t.offNote) return false;
  if (t.registry) {
    const e = EXPERIMENTS[t.key];
    if (!e || !e.enabled) return false;
  }
  if (t.startIso && Date.parse(nowIso) < Date.parse(t.startIso)) return false;
  return true;
}
