// emailChanges.js — what changed in our lifecycle mail, and when.
//
// The "What changed" list on Emails › Impact, and the dated lines its weekly
// charts draw. Each entry is a day the mail itself changed: an email stopped
// or was paused, something went wrong, something started. A reading the
// owner has pre-registered is listed too, as `due`.
//
// Words and days only. The repo is public, so an entry never carries a count,
// a rate or a threshold: where an entry has a figure (`figure`), the view works
// it out from admin_email_impact at render time (lib/emailImpact.js,
// changeFigure). The pre-registered read's thresholds live outside the repo.
//
// Every `stop` day is the email's last send in lifecycle_email_log, or the day
// a migration says it went off (checked 2026-10-21, the team left out):
//   nudge_dormant_early, whats_new   last sent Aug 26
//   reengage_1                       last sent Aug 30
//   board_waiting                    off since Aug 30 (0359), back Oct 5
//   welcome_board                    none sent Sep 6 to 16, back Sep 17
//   activate_nudge_2                 paused Oct 5 (0359), last sent Oct 4
//
// Fields:
//   day      YYYY-MM-DD, UTC
//   until    the last day of a span, for an entry that lasted (the welcome gap)
//   kind     stop | alert | first | due; the glyph comes from viz/markerGlyphs
//   types    the lifecycle emails it is about; none means all of them
//   label    what happened, in words
//   sub      a line under it, in words
//   figure   welcome_gap | split | held: a line under it worked out from the read
//   short    what a `due` entry is called in the band at the top of the page
//   split    the day the opens are compared either side of (one entry has it)

export const EMAIL_CHANGES = Object.freeze([
  {
    day: '2026-08-26', kind: 'stop', types: ['nudge_dormant_early', 'whats_new'],
    label: 'Early nudge and What’s new: last sends',
  },
  {
    day: '2026-08-30', kind: 'stop', types: ['reengage_1'],
    label: 'Come back: last send',
  },
  {
    day: '2026-08-30', kind: 'stop', types: ['board_waiting'],
    label: 'Your cluster is waiting paused', sub: 'back on Oct 5',
  },
  {
    day: '2026-09-06', until: '2026-09-16', kind: 'alert', types: ['welcome_board'],
    label: 'No welcome emails', figure: 'welcome_gap',
  },
  {
    day: '2026-09-20', kind: 'alert', split: true,
    label: 'Invite abuse put our mail in spam', figure: 'split',
  },
  {
    day: '2026-10-05', kind: 'stop', types: ['activate_nudge_2'],
    label: 'Second nudge paused', sub: 'while the sending domain recovers',
  },
  {
    day: '2026-10-05', kind: 'first', types: ['board_waiting'],
    label: 'Your cluster is waiting back, with a group held out', figure: 'held',
  },
  {
    day: '2026-10-05', kind: 'first',
    label: 'No more mail after 3 unopened', sub: 'for every lifecycle email',
  },
  {
    day: '2026-10-26', kind: 'due', short: 'inbox read',
    label: 'Inbox read, pre-registered', sub: 'have opens come back since Sep 20?',
  },
]);

/** The day the opens are compared either side of: the entry marked `split`. */
export const SPLIT_DAY = EMAIL_CHANGES.find((c) => c.split)?.day ?? null;
