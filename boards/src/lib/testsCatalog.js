// testsCatalog.js — every test the admin's Analytics › Tests view reads: what it
// is, what each side gets, when it started, when it is read, and what it is
// measured on. The numbers come from admin_tests_read (0810, its helpers re-aimed
// by 0855); the rules that turn
// them into words are in testsView.js.
//
// Pure and node-testable (testsCatalog.test.mjs): no React, no Supabase.
//
// The start instants are the code's own (BOARD_MORE_EPOCH, the sign-up box's
// startsAt), never typed again here, or the read's own for a test that starts
// with a release (startKey), and the migration is checked against them by
// testsMigration.test.mjs. The read dates are the ones each test's saved
// read was registered with. That saved read, outside this public repo, also holds
// what counts as a win: nothing here says how big a gap has to be.
//
// Every key in EXPERIMENTS must have an entry here, whether it is running, off,
// or long finished, so a new test can't go unseen (testsCatalog.test.mjs).

import { EXPERIMENTS } from './experiments.js';
import { BOARD_MORE_EPOCH } from './boardMoreEpoch.js';

// The share ask at ten cards reached everyone with production's 10-29 release.
// Its "before" is the four weeks up to the same instant.
export const SHARE_ASK_RELEASE = '2026-10-29T05:15:00Z';
export const SHARE_ASK_BEFORE_FROM = '2026-09-28T00:00:00Z';

// The email hold-back's coin began when 0790 was applied (2026-10-29 01:37:57Z).
// Emails sent earlier that day had no coin, so they aren't counted.
export const EMAIL_HOLDOUT_START = '2026-10-29T01:38:00Z';

// The sign-up box's like-for-like read weighs each kind of page and device the
// same on both sides. The page groups are landingStage.js's KEPT_CLOSE and
// STAGE_HELD copied as they were on 2026-11-03, when the like-for-like rule was
// written, and frozen here on purpose: the read's strata must not move when the
// landing stage does. Everything else on the search pages is the full stage.
// With phone or desktop that makes 6 strata: 0855 returns each device's first
// page and testsView's signupStrataOf pools them into these groups.
export const SIGNUP_BOX_PAGE_GROUPS = Object.freeze([
  Object.freeze({
    id: 'kept_close', label: 'Kept close',
    paths: Object.freeze(['/vs/pureref', '/tools/reference-board-maker', '/tools/shot-list-maker', '/tools/mood-board-maker']),
  }),
  Object.freeze({ id: 'held', label: 'Held', paths: Object.freeze(['/best/pureref-alternatives']) }),
  Object.freeze({ id: 'full', label: 'Full stage', paths: null }),
]);

// The share ask's misses: why someone who took a cluster past 10 cards wasn't
// asked in that visit (share_ask_skipped's reason, else the ask never had a
// crossing in view).
export const SHARE_ASK_MISSES = Object.freeze({
  tour: 'The welcome tour was showing',
  board_stamp: 'Already asked on that cluster',
  weekly_stamp: 'Already asked this week',
  not_editor: 'They can’t edit that cluster',
  already_shared: 'The cluster was already shared',
  slot_busy: 'Another ask had the slot',
  not_in_view: 'The cluster wasn’t in view as it passed 10',
});

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
// from: 'strata' reads the measure like for like over the read's strata
// (Mantel-Haenszel), not from measures.<id>.
// target: a reach the test was registered with, read on B alone by its exact
// range (share ask); a number, never text.
// startKey: the read's own key for the start, when the code can't know it (a
// test that starts with a release); startIso is then absent.
export const TESTS = [
  // first_board_more — the written rule (saved read first_board_more_read.sql,
  // 2026-11-03): it is decided on the people who reached the moment (a third card
  // on their first board, both sides, the first 'eligible' moment), not on
  // everyone, since only they can be moved by the ask. The decider is 10 or more
  // genuine cards within 24 hours of the moment, B against A, read with the
  // power row the saved read carries (about 64 reaching the moment a week, a
  // base near 13 in 100) and the early close it names (about Nov 24) if the
  // guardrails go wrong. Coming back within 7 days, a first card and deleting
  // half are guardrails; ten on day one for everyone stays as the score it first
  // aimed at. The ask's click-through is health, not a measure.
  {
    key: 'first_board_more', group: 'running', kind: 'coin', unit: 'account', registry: true,
    name: 'First board asks for more',
    what: 'When a third card lands on someone’s first board, ask for a whole folder or a note.',
    aName: 'As before', a: 'Nothing is shown.',
    bName: 'The ask', b: 'One toast, “Good start. Add more?”, with Bring in a folder and Add a note.',
    startIso: BOARD_MORE_EPOCH,
    reads: [{ iso: '2026-11-26', what: 'Guardrails, early close' }, { iso: '2027-01-07', what: 'Verdict' }],
    verdictIso: '2027-01-07',
    neitherNote: 'never reached the app',
    // Only B is ever shown the ask: a view from someone in A is a leak.
    leak: 'were shown the ask',
    measures: [
      { id: 'ten_after_1d', label: '10+ cards within a day of the moment', sub: 'people who reached it: a third card on their first board', role: 'decides', windowDays: 1 },
      { id: 'more_1d', label: 'Another card within a day of the moment', sub: 'people who reached it', role: 'also read', windowDays: 1 },
      { id: 'ten_1d', label: '10 or more cards on day one', sub: 'everyone: the score it first aimed at', role: 'also read', windowDays: 1 },
      { id: 'back_7d', label: 'Came back within 7 days', sub: 'a second working visit within 7 days of the first', role: 'guardrail', windowDays: 7 },
      { id: 'card_1d', label: 'Placed a first card on day one', sub: 'within 24 hours of signing up', role: 'guardrail', windowDays: 1 },
      { id: 'deleted_half_7d', label: 'Deleted half their cards or more', sub: 'within 7 days, of those who placed any', role: 'guardrail', windowDays: 7, lowerIsBetter: true },
    ],
    // The ask itself: shown to people in B once their first board reaches 3
    // cards. Its click-through (signals.click) shows under it.
    signals: [{ id: 'shown', label: 'The ask', due: 'people in B reached 3 cards', quietDays: 3, minDue: 3, click: 'click' }],
  },
  // signup_box — the written rule (saved read signup_box_read.sql, 2026-11-03):
  // decided like for like, Mantel-Haenszel over the 6 frozen strata (page group
  // × phone or desktop, SIGNUP_BOX_PAGE_GROUPS), because the landing stage
  // changed which pages carried B's box mid-test and phones sign up at a
  // different rate. Stop rule (b): at the Dec 31 read it is called only if
  // |z| ≥ 2.36; otherwise it runs to Jan 28 and is called at |z| ≥ 2.02. It
  // planned on about 149 devices a week, times 1.37 to 1.48 for the strata.
  // The raw sign-up line stays beside it, read only. The saved read also splits
  // the funnel and leaves the held paths out.
  {
    key: 'signup_box', group: 'running', kind: 'coin', unit: 'device', registry: true,
    name: 'Sign-up box on search pages',
    what: 'On /vs, /tools, /use-cases and /best, sign up right on the page.',
    aName: 'As before', a: 'The gold button, which goes to the home page’s form.',
    bName: 'The box', b: 'A one-line email box in place of the button; the code is typed in the same spot.',
    startIso: EXPERIMENTS.signup_box.startsAt,
    reads: [{ iso: '2026-11-12', what: 'Safety check' }, { iso: '2026-12-31', what: 'Early stop look' }, { iso: '2027-01-28', what: 'Verdict' }],
    verdictIso: '2027-01-28',
    inNote: 'Per device, signed-out visitors only',
    measures: [
      { id: 'signup_like', from: 'strata', label: 'Made an account within 24 hours, like for like', sub: 'each kind of page, and phone or desktop, weighed the same on both sides', role: 'decides', windowDays: 1 },
      { id: 'signup_1d', label: 'Made an account within 24 hours', sub: 'of first seeing the page, all together', role: 'also read', windowDays: 1 },
      { id: 'card_1d', label: 'First card within 24 hours of signing up', sub: 'of those who signed up', role: 'guardrail', windowDays: 1 },
    ],
    // The box sends a code when someone in B types an email into it. Few do,
    // so it takes many quiet views before silence means anything.
    signals: [{ id: 'box_sent', label: 'A box send', due: 'devices in B saw the box', quietDays: 3, minDue: 150 }],
  },
  // email_holdout — the written rule (saved read email_holdout_read.sql,
  // 2026-11-03): decided on one pooled measure, opened the app within 72 hours,
  // both emails together and each person once (their first due email), held
  // back against sent. Two looks on an O'Brien-Fleming boundary: Dec 10 is
  // called only at |z| ≥ 2.80, Jan 24 at |z| ≥ 1.98. Unsubscribing within 7 days
  // is the guard. The hold-back runs 12 weeks (app_config holdout_weeks, 0855).
  // The per-email "made something" lines are counted, no longer deciding.
  {
    key: 'email_holdout', group: 'running', kind: 'holdout', unit: 'email', registry: false,
    name: 'Follow-up emails, half held back',
    what: 'Do the day-one nudge and the “your board is waiting” email bring people back?',
    aName: 'Sent', a: 'The email goes out, as it always did.',
    bName: 'Held back', b: 'Half of the people due each email don’t get it, for 12 weeks.',
    // Held back minus sent, so a gap below zero is the email helping: the email
    // is the thing in use, and its side being ahead is the good news.
    goodSide: 'A',
    gapNote: 'held back minus sent: below zero means the email helps',
    // The read returns the live start: app_config's holdout_from, or this
    // instant if it is later.
    startIso: EMAIL_HOLDOUT_START,
    reads: [
      { iso: '2026-11-12', what: 'Health look' },
      { iso: '2026-12-10', what: 'Small look' },
      { iso: '2027-01-24', what: 'Verdict' },
    ],
    verdictIso: '2027-01-24',
    noneText: 'None due yet',
    // Opened the app: an app_open in the window. Made something: a card placed
    // or edited, or a doc edited, in the 72 hours after the send, or after the
    // moment a held-back person would have had it (admin_email_impact's
    // measure, 0494).
    measures: [
      { id: 'open_72h', label: 'Opened the app within 72 hours', sub: 'both emails, each person once', role: 'decides', windowDays: 3 },
      { id: 'unsub', label: 'Turned these emails off', sub: 'by the read, each person at least 7 days after their first email', role: 'guardrail', windowDays: 7, lowerIsBetter: true },
      { id: 'nudge_made_72h', label: 'Made something within 72 hours', sub: 'day-one nudge', role: 'counted', windowDays: 3 },
      { id: 'waiting_made_72h', label: 'Made something within 72 hours', sub: 'board waiting', role: 'counted', windowDays: 3 },
      { id: 'nudge_open_7d', label: 'Opened the app within 7 days', sub: 'day-one nudge', role: 'also read', windowDays: 7 },
      { id: 'waiting_open_7d', label: 'Opened the app within 7 days', sub: 'board waiting', role: 'also read', windowDays: 7 },
    ],
    signals: [],
  },
  // share_ask — the written rule (saved read share_ask_read.sql, 2026-11-03):
  // the read restarts at the tour fix, cut by build (fix_from is the first
  // sighting of the first fixed build; never read within 3 days of a ship). It
  // is judged on the reach it was registered with: of the people whose first
  // crossing of 10 cards came on a fixed build, how many were asked in that same
  // visit, against the registered target (the measure's target), by the exact
  // binomial range on B alone: reaching it when the range's low end clears the
  // target, short of it when its high end is below, else too early to say. The
  // misses say why the rest weren't asked; crowding (a power tip or the banner
  // in a new account's first sitting) and the median-cards check guard it, and
  // the saved read follows 7-day outcomes. The tips guardrail, which could only
  // pass, is replaced by the crowding lines. Not a coin flip: at a few people a
  // day no flip would read for months.
  {
    key: 'share_ask', group: 'changed', kind: 'beforeafter', unit: 'person', registry: false,
    name: 'Share ask at ten cards',
    what: 'Not a coin flip: everyone got the change, so it’s read as before against after.',
    aName: 'Oct 29 → the fix', a: 'Asked when a cluster just reaches 10 cards, on the builds before the tour fix.',
    bName: 'Since the fix', b: 'The same ask on fixed builds, where a finished tour no longer comes back and takes its place.',
    startIso: SHARE_ASK_RELEASE,
    // The after side starts at the read's fix_from, the first fixed build seen.
    fixKey: 'fix_from',
    reads: [{ iso: '2026-11-19', what: 'First read' }, { iso: '2026-11-26', what: 'Verdict' }],
    verdictIso: '2026-11-26',
    inNote: 'People who took a cluster past 10 cards (before: Sep 28 to Oct 29)',
    noneText: 'No one has reached 10 since the release',
    measures: [
      { id: 'reach_load', label: 'Asked in the visit they reached 10', sub: 'their first time past 10 cards: its reach', role: 'decides', windowDays: 0, target: 80 },
      { id: 'shown_1d', label: 'Shown the ask within a day of reaching 10', sub: 'since Oct 29, as first read', role: 'also read', windowDays: 1 },
      { id: 'crowd_reveal', label: 'Saw a power tip in their first sitting', sub: 'new accounts: the ask must not crowd it out', role: 'guardrail', windowDays: 0 },
      { id: 'crowd_banner', label: 'Saw the banner in their first sitting', sub: 'new accounts: the ask must not crowd it out', role: 'guardrail', windowDays: 0 },
    ],
    missReasons: SHARE_ASK_MISSES,
    signals: [{ id: 'ask_at_10', label: 'An ask at 10', due: 'people reached 10 cards', quietDays: 2, minDue: 5 }],
    // signals.lost_to_ask: upgrade offers that gave the slot to the ask.
    lostKey: 'lost_to_ask',
  },
  // trial_early — owner pick #234 (2026-11-03): switched on as the built 50/50
  // coin, every free account by hash, old ones too; A stays the reference. Not
  // readable as a test at this volume (about 1 or 2 a week per side), so it is
  // watched (saved read trial_early_read.sql, T2 to T4): T2 that B's offers
  // really carry the early trial, T3 the decider below on people whose first
  // offer came while under 13 cards, T4 the stop rule. It starts with the
  // release that carries it: on_from is the first sighting of a build that logs
  // its events.
  {
    key: 'trial_early', group: 'running', kind: 'coin', unit: 'account', registry: true,
    name: 'Free trial from the first card',
    what: 'Offer the 14-day Creator trial from someone’s first card.',
    aName: 'As before', a: 'The trial is offered once there’s a body of work (13 cards) or near a limit: the wall, the card cap, storage.',
    bName: 'From card one', b: 'The trial is offered from the first card.',
    startKey: 'on_from',
    reads: [{ iso: '2026-12-01', what: 'First look' }, { iso: '2027-01-19', what: 'Verdict' }],
    verdictIso: '2027-01-19',
    inNote: 'Free accounts with a side since the release, old ones too',
    measures: [
      { id: 'press_14d', label: 'Pressed an upgrade button within 14 days', sub: 'their first offer while under 13 cards', role: 'decides', windowDays: 14 },
    ],
    signals: [],
    // Health from the read's signals: reach, B's offers under 13 cards and how
    // many offered the early trial; leak, offers of it to A (must be none).
    reachKey: 'reach',
    leakKey: 'leak',
  },
];

// Finished, stopped and paused tests: the folded list at the bottom. `key` ties
// a registry entry to its line here.
export const EARLIER_TESTS = [
  // Ended 2026-11-03 (owner pick #233 A): it could not meet its Dec 17 rule.
  { key: 'workspace_setup', name: 'Workspace setup steps', when: 'Nov 3', out: 'Ended: couldn’t win by Dec 17' },
  // Idle since its Aug 26 send with no winner (readout, 2026-11-03).
  { key: 'whats_new', name: 'What’s new email, two versions', when: 'Aug 26', out: 'Retired: no winner' },
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
