# Admin Overview: weekly consistency read + dated markers — implementation plan

Spec: `docs/superpowers/specs/2026-10-07-admin-weekly-trends-design.md` (written in Task 10).
Approved plan of record: `~/.claude/plans/i-want-to-rework-goofy-lerdorf.md` (not in the repo).

## Goal

The `/admin` Overview (Today view) answers "is this metric going up **consistently** over
weeks?" with a streak strip of per-week glyphs and a plain verdict computed from complete
UTC calendar weeks, and leads with "what changed, and why" through dated markers (changelog
entries, discovery and ops alerts, definition breaks) plus the owner's own dated notes.

## Global Constraints (bind every task)

- **Workspace:** `/Users/andrewconklin/soleilpictures-1-trends` (detached worktree at
  `origin/main`). Another session edits the sibling tree; never touch it. **Commit by
  pathspec only:** `git commit -- <your files>` (never a bare `git commit`, never
  `git add -A`). Do not push; the controller pushes.
- **Public repo.** No live business figures (user counts, signups, revenue, cards) in any
  committed file, fixture, test or commit message. Fixtures are synthetic.
- **Commit subjects** read like this repo's: one sentence, sentence case, describing the
  user-visible effect (e.g. "The Signups tile says whether the rise has held for weeks").
  End the message with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- **Tests.** `cd boards && npm test` runs `node --test src/lib/*.test.mjs` only; tests
  import `.js` modules, never `.jsx`. New pure logic goes in `boards/src/lib/*.js` with a
  sibling `*.test.mjs`, TDD (red, then green; keep RED/GREEN evidence in the report).
  Playwright: `cd boards && PW_PORT=5181 npx playwright test tests/admin-dashboard.spec.js --project=desktop-chrome`
  (`PW_PORT` is mandatory: another tree's dev server may own 5174). The pre-existing test
  "the page refreshes itself" (poll count) is a KNOWN failure; leave it.
- **Weeks** are UTC calendar weeks starting Monday (`date_trunc('week')` in SQL;
  `mondayOf` in JS). Never local time.
- **Palette rules** (`boards/src/pages/admin/viz/palette.js`): gold (`--soleil`,
  `rgb(255,165,0)`) is never a data colour; good/bad direction is always carried by a glyph
  or a word as well as colour; marker kinds are neutral ink, distinguished by shape.
- **No CSS `content:` text ornament** (it enters the accessible name). Glyphs are real
  text or SVG.
- **Never `.catch()` a `supabase.rpc()` builder** (it is a thenable). Always
  `const { data, error } = await supabase.rpc(...)`.
- **Harness-only code** sits behind `import.meta.env.DEV`.
- **`admin.css`:** `chartPalette.test.mjs` reads the FIRST `.adm-well {` block (currently
  ~L4303) and asserts the palette; append new rules at the END of the file, never add a
  bare `.adm-well {` rule above that block.
- **Deleting shows an undo toast** (`lib/undoToast.js` + `useFeedback` from
  `components/AppFeedback.jsx`), never a confirm dialog.
- **Honesty over confidence:** when data is thin or unmeasured the UI says so
  ("Too few weeks", hatched) and never prints a direction or a number it did not measure.
- **Verdict label strings are verbatim** as specified in Task 2 and pinned by tests; the
  StreakStrip's accessible name IS the verdict label (one source).
- **Migration number 0372** is reserved for this work (0369–0371 and 0373 belong to the
  security session). Apply to the database only through the controller (Supabase MCP),
  never the local CLI.

## Architecture (one paragraph)

`admin_weekly_series` (SQL, Task 3) returns one wide, zero-filled row per UTC week from
durable tables through a shared `_admin_people` predicate. `lib/weeklySeries.js` (Task 1)
adapts rows to `WeekPoint[]` per metric and resolves definition breaks to Monday cut
points; `lib/trendStats.js` (Task 2) scores a `WeekPoint[]` with Mann-Kendall + Theil-Sen,
a noise floor and a verdict tree, and replaces `deltaInfo` with the noise-gated
`weekDelta`. `viz/StreakStrip.jsx` renders steps as glyphs; `viz/Metric.jsx` gains a
`trend` prop; `viz/AreaChart.jsx` gains markers/bands/partial-week props;
`widgets/WeeklyMultiples.jsx` stacks four weekly charts with markers;
`widgets/MarkersPanel.jsx` lists markers and adds/removes notes (soft delete + restore via
undo toast). `TodayView.jsx` wires it all (Task 8). Fixtures (Task 4) keep the
`?adminpreview=1` harness honest; Playwright guards (Task 9) make each promise fail when
broken.

---

## Task 1: Definition breaks and the weekly-series adapter

**Files:** NEW `boards/src/lib/adminDefinitionBreaks.js`, `boards/src/lib/adminDefinitionBreaks.test.mjs`,
`boards/src/lib/weeklySeries.js`, `boards/src/lib/weeklySeries.test.mjs`.
Pure modules, no imports from `.jsx`, no React. Match the header-comment style of
`boards/src/lib/retentionStats.js` (why the module exists, in prose).

### `adminDefinitionBreaks.js`

```js
/** A dated change in what a series means. `cut` = the weekly trend must not be scored across it. */
export const DEFINITION_BREAKS = [
  { date: '2026-06-01', migration: '0102', series: ['metrics_daily'], cut: false,
    label: 'User counts become email-verified only' },
  { date: '2026-06-18', migration: '0149', series: ['metrics_daily'], cut: false,
    label: 'Verified now means confirmed and signed in' },
  { date: '2026-08-17', migration: '0248', series: ['work_users'], cut: false,
    label: 'Work tracking starts (did_work)' },          // the floor; SQL returns it as work_floor
  { date: '2026-08-22', migration: '0254', series: ['cards'], cut: false,
    label: 'Cards get a creation time (backfilled from first index)' },
  { date: '2026-09-04', migration: '0294', series: ['events'], cut: false,
    label: 'Crawler and QA rows quarantined from analytics' },
  { date: '2026-09-15', migration: '0327', series: ['metrics_daily'], cut: false,
    label: 'Money counters become trial-aware' },
  { date: '2026-09-17', migration: '0332', series: ['metrics_daily'], cut: false,
    label: 'MRR counts active subscriptions only' },
  { date: '2026-10-01', migration: '0347', series: ['work_users'], cut: true,
    label: 'did_work no longer stamped on no-op re-syncs' },
];
export const WEEKLY_SERIES_KEYS = ['signups', 'active_users', 'work_users', 'cards'];
```
Dates are the git commit dates of those migration files (verify with
`git log --format=%ad --date=short --diff-filter=A -- supabase/migrations/<file>`; the
values above were checked on 2026-10-07). Why only one cut: signups' verified rule filters
on CURRENT column values so the series is uniform back in time; `card_index.created_at`
was backfilled from `updated_at`, which the client never updates, so it is first-index
time throughout; `did_work` before 0347 was also stamped on no-op re-syncs and credited the
board creator, so pre-10-01 weeks over-count and must not be scored with post-10-01 weeks.

Test (`adminDefinitionBreaks.test.mjs`): dates are ISO and strictly ascending; `migration`
matches `^\d{4}$`; every `series` value ∈ `{signups, active_users, work_users, cards,
events, metrics_daily}`; exactly one entry has `cut: true` and it is `0347` for
`work_users`; labels are non-empty and ≤ 80 chars.

### `weeklySeries.js`

```js
import { DEFINITION_BREAKS } from './adminDefinitionBreaks.js';

export const WEEKLY_METRICS = [
  { key: 'signups', col: 'signups',      label: 'Signups',       family: 0, dispersion: 'poisson' },
  { key: 'active',  col: 'active_users', label: 'Weekly active', family: 1, dispersion: 'poisson', measurableCol: 'active_measurable' },
  { key: 'work',    col: 'work_users',   label: 'Did real work', family: 1, dispersion: 'poisson', measurableCol: 'work_measurable' },
  { key: 'cards',   col: 'cards',        label: 'Cards created', family: 2, dispersion: 'mad' },
];

/** UTC Monday of the week containing isoDate ('YYYY-MM-DD'); a Sunday maps to the PREVIOUS Monday. */
export function mondayOf(isoDate) {}
/** The first UTC Monday ON OR AFTER isoDate (a Monday maps to itself). */
export function mondayOnOrAfter(isoDate) {}
/** 'YYYY-MM-DD' plus n days, UTC. */
export function addDays(isoDate, n) {}

/**
 * Wide RPC rows (admin_weekly_series) -> WeekPoint[] for one metric:
 *   { week, value, measurable, complete, settling }
 * value = row[col] (null stays null); measurable = metric.measurableCol ? !!row[measurableCol] : true;
 * a null value with measurable=true is a gap (kept as null); rows sorted by week ascending.
 * Junk input (null, non-array, rows missing fields) -> [] without throwing.
 */
export function toWeekPoints(rows, metric) {}

/**
 * Cut points for a series column: entries with cut=true whose series includes col,
 * each as { week: mondayOnOrAfter(date), label, migration }. The straddling week is
 * thereby excluded from scoring (trendStats excludes weeks starting BEFORE week).
 * `breaks` is overridable (the harness passes a relative list; DEV `?breaks=0` passes []).
 */
export function breaksFor(col, breaks = DEFINITION_BREAKS) {}

/**
 * Where a day lands on an index axis of `weeks` (Monday strings, ascending, evenly spaced).
 * Returns { index, edge } or null. index = i + (day - weeks[i]) / 7 for the week containing
 * day; inside the LAST week index is clamped to weeks.length - 1 and edge = true
 * (the partial week is drawn as a single hollow point at the right rule).
 * null when day < weeks[0] or day >= addDays(weeks.at(-1), 7).
 */
export function markerIndex(day, weeks) {}

/**
 * Merge marker sources into one sorted list (by day, then source, then label):
 *   rpc:       rows from admin_markers [{ day, kind, label, source, ref_id }]
 *   changelog: CHANGELOG_ENTRIES [{ date, title, anchor }] -> { day: date, kind: 'changelog', label: title, source: 'changelog', anchor }
 *   breaks:    DEFINITION_BREAKS -> { day: date, kind: 'break', label, source: 'definition', series, migration }
 *   from/to:   inclusive 'YYYY-MM-DD' window; rows outside are dropped
 * Every output row carries { day, kind, label, source } and keeps any extra fields.
 */
export function mergeMarkers({ rpc = [], changelog = [], breaks = [], from, to } = {}) {}

/** 'wk of Sep 15' for an ISO Monday (en-US short month, UTC). */
export function weekLabel(isoMonday) {}

/**
 * Slots for the StreakStrip from a TrendRead (Task 2 shape):
 *   returns `slots` entries, newest last: { state: 'up'|'down'|'flat'|'gap'|'unmeasured', settling, title }
 * Under verdict.code === 'too_few' every slot is 'unmeasured'. Otherwise the last
 * min(slots, steps.length) steps map dir 1/0/-1/null -> up/flat/down/gap, left-padded
 * with 'unmeasured'. title = `${weekLabel(step.week)}: ${from} → ${to}` for defined steps.
 */
export function streakSlots(trend, slots = 7) {}
```

Tests (`weeklySeries.test.mjs`), each written RED first:
- `mondayOf('2026-10-04')` (a Sunday) = `'2026-09-28'`; `mondayOf('2026-09-28')` = itself;
  `mondayOnOrAfter('2026-10-01')` = `'2026-10-05'`; `mondayOnOrAfter('2026-10-05')` = itself.
- `toWeekPoints` maps a wide row to `{week, value, measurable, complete, settling}`;
  `work_users: null, work_measurable: false` → `measurable: false`; sorts ascending; junk → `[]`.
- `breaksFor('work_users')` = `[{ week: '2026-10-05', label: …, migration: '0347' }]`;
  `breaksFor('signups')` = `[]`; `breaksFor('cards')` = `[]`; the `breaks` override is honoured
  (`breaksFor('work_users', [])` = `[]`; a relative list shifts the Monday).
- `markerIndex('2026-09-17', weeks)` (weeks from 2026-09-14) = `{ index: 3/7, edge: false }` when
  09-14 is index 0; a day inside the last week → `{ index: n-1, edge: true }`; before the first
  week or on/after last+7 → `null`.
- `mergeMarkers` sorts by day, tags sources, drops rows outside `[from, to]`, maps changelog and
  break entries, preserves `ref_id` / `anchor` / `series`.
- `weekLabel('2026-09-15')` = `'wk of Sep 15'`.
- `streakSlots`: a trend with 7 steps `[1,1,-1,1,1,1,1]` → states `up,up,down,up,up,up,up`;
  5 steps left-pads 2 `unmeasured`; `too_few` → all `unmeasured`; `settling` carried from the
  last step; a null step → `gap`.

**Done when:** both test files pass under `npm test`, output pristine; committed by pathspec.

---

## Task 2: `trendStats.js` — the weekly consistency read

**Files:** NEW `boards/src/lib/trendStats.js`, `boards/src/lib/trendStats.test.mjs`.
Pure, dependency-free (no import from retentionStats needed; the rate branch is cut). Header
comment in the `retentionStats.js` style explaining why each guard exists.

### Exports

```js
export const DEFAULT_WINDOW   = 8;     // complete calendar weeks scored
export const MIN_WEEKS        = 4;     // fewer usable weeks -> 'too_few'
export const STEADY_WEEKS     = 6;     // n >= this before "steady"/"uneven"/flat-dominant wording
export const EXACT_MAX_N      = 12;    // exact Mann-Kendall null up to here (untied only)
export const ALPHA_SOLID      = 0.05;  // one-sided; stated in the UI tooltip, never halved
export const ALPHA_LEAN       = 0.10;  // one-sided
export const NOISE_K          = 2;     // floor multiplier
export const MIN_BASE         = 2;     // Poisson floor never computed from a base below this
export const SPIKE_K          = 3;     // value > median + SPIKE_K*sqrt(max(median,1)) is a spike week
export const SHIFT_SHARE      = 0.6;   // one step carrying >= 60% of the directional movement = step change
export const PLATEAU_N        = 4;     // trailing points examined for "rose, then flat"
export const MIN_DELTA_EVENTS = 10;    // weekDelta thin gate; also the 'solid' events gate
export const MIN_ZERO_EVENTS  = 3;     // window total below this -> 'zero' verdict
export const STEADY_UP_SHARE  = 0.7;   // steady: up >= 0.7*m and down <= 1
export const Z_90_ONE_SIDED   = 1.644854;

/** @typedef {{ week:string, value:number|null, measurable:boolean, complete:boolean, settling?:boolean }} WeekPoint */
export function weeklyTrend(points, { window = DEFAULT_WINDOW, minWeeks = MIN_WEEKS, breaks = [], dispersion = 'poisson' } = {}) // -> TrendRead
export function mannKendall(values)  // -> { n, S, varS, z, pUp, pDown, p, dir, method: 'exact'|'normal'|'degenerate', ties: number[] }
export function exactTailP(n, s)     // Mahonian exact P(S_null >= s), untied, n <= EXACT_MAX_N
export function theilSen(values, t)  // -> { perWeek, rise, pairs }; t = calendar week indices (holes allowed)
export function weekDelta(cur, prev, { kind = 'count' } = {})  // kind 'count' | 'exact'
```

`TrendRead`:
```js
{ window: { from, to, n, calendarWeeks, gaps, sum, excluded: [{ week, reason: 'incomplete'|'unmeasurable'|'break' }] },
  steps:  [{ week, from, to, dir: 1|0|-1|null, settling: boolean }],  // one per adjacent calendar pair in the window; settling on the newest when its point is settling
  counts: { up, down, flat, gaps, total },                            // total = defined steps = "m" in labels
  streak: { dir: 'up'|'down'|'flat'|'none', len },
  mk:     { S, varS, z, p, dir: 'up'|'down'|'none', method },
  slope:  { perWeek, pctOfLevelPerWeek, rise, level, baseline, floor, floorKind: 'poisson'|'mad', clears },
  spikes: [{ week, value }],
  thisWeek: null | { week, value },            // the latest complete:false point; never scored
  caveat: null | 'Definition changed 2026-10-01; 0 weeks since',
  verdict: { code, label, confidence: 'solid'|'directional'|'none', detail: string|null } }
```

### Math (implement exactly; the tests pin it)

- **Mann-Kendall.** `S = Σ_{i<j} sgn(x_j − x_i)` over usable (non-null) values in time order.
  Tie groups = sizes of groups of equal values (sizes ≥ 2).
  `Var(S) = [n(n−1)(2n+5) − Σ_p t_p(t_p−1)(2t_p+5)] / 18`.
  **method:** `'exact'` ONLY when there are no ties AND `n <= EXACT_MAX_N`: `pUp = exactTailP(n, S)`,
  `pDown = exactTailP(n, −S)`. Any tie, or `n > EXACT_MAX_N`: `'normal'` with the tie-corrected
  variance and continuity correction `z = (S − sgn(S)) / sqrt(Var)` (z = 0 when S = 0),
  `pUp = 1 − Φ(z)`, `pDown = Φ(z)`, Φ via erfc (Abramowitz–Stegun 7.1.26 or equivalent,
  |err| < 1.5e-7). `Var = 0` → `'degenerate'`, `z = 0`, `p = 1`, `dir = 'none'`.
  `p = min(pUp, pDown)`, `dir` = the smaller side, `'none'` when S = 0. One-sided by design.
- **`exactTailP(n, s)`.** Under the untied null `S = N − 2I`, `N = n(n−1)/2`, `I` = inversions
  with the Mahonian distribution (coefficients of `Π_{i=1..n}(1 + x + … + x^{i−1})`, O(n³)
  convolution). `P(S ≥ s) = Σ_{k ≤ floor((N−s)/2)} M_n(k) / n!`. Anchors: `(8,16)≈0.0305`,
  `(8,14)≈0.0543`, `(5,8)≈0.0417`, `(4,6)≈0.0417`, `(6,11)≈0.0278`, `(8,28)=1/40320`.
- **Theil-Sen.** `perWeek` = median over all `i<j` of `(x_j − x_i)/(t_j − t_i)` with `t` the
  calendar week index (a null week leaves a hole in `t`). Median = middle element or mean of the
  two middle. `rise = perWeek × (t_last − t_first)`. `level` = median of usable values;
  `pctOfLevelPerWeek = 100·perWeek/level` (null when level = 0).
- **Noise floor.** `baseline` = median of the first `floor(n/2)` usable values.
  `dispersion:'poisson'` → `floor = NOISE_K · sqrt(2 · max(baseline, MIN_BASE))`.
  `dispersion:'mad'` → `floor = NOISE_K · 1.4826 · MAD(first differences of usable values)`,
  falling back to the Poisson floor when fewer than 3 differences or MAD = 0.
  `clears = |rise| >= floor`.
- **Steps.** `dir = sgn(x_t − x_{t−1})` with EXACT ties (the strip is a literal record; the verdict
  carries the noise judgement); `null` when either side is a gap. `settling` = true on the newest
  step when its `to` point has `settling: true`.
- **Streak.** From the end: last step null → `{dir:'none', len:0}`; 0 → `{dir:'flat', len: trailing zeros}`;
  else the trailing run of the same sign (a 0 or null ends it).
- **Spikes.** `value > median + SPIKE_K·sqrt(max(median,1))`; reported only, never removed.
- **`weekDelta(cur, prev, {kind})`.** null when either side is null/NaN.
  `'count'`: `cur+prev < MIN_DELTA_EVENTS` → `{ dir:'thin', n: cur+prev, text: signedAbsolute }` (e.g. `'+2'`);
  `prev === 0` → `{ dir:'up', text:'new' }`; else `z = (cur−prev)/sqrt(cur+prev)`;
  `|z| < Z_90_ONE_SIDED` → `{ dir:'flat', noise:true, z, text:'+33%' }`; else `{ dir:'up'|'down', z, text:'+108%' }`
  (percent = `round(100·(cur−prev)/prev)`, signed, `diff===0` → `dir:'flat'` without `noise`).
  `'exact'` (MRR, a ledger): plain sign, no gate, no `noise` key; `prev===0 && cur>0` → `'new'`.

### Window selection (in order)

(a) sort by week; (b) `complete:false` points are excluded (`'incomplete'`) and the latest becomes
`thisWeek`; (c) `measurable:false` → `'unmeasurable'`; (d) **break cut:** every week whose
`week < latest breaks[].week` is excluded (`'break'`) and
`caveat = 'Definition changed {break.week}; {k} weeks since'` where k = usable weeks on/after it;
(e) keep the last `window` CALENDAR weeks of what remains (nulls stay as gaps); usable = non-null;
`window.sum` = sum of usable values.

### Verdict tree (first match wins; labels verbatim)

```
usable < minWeeks                                 -> too_few   'Too few weeks ({usable} of {minWeeks})'           none
window.sum < MIN_ZERO_EVENTS                      -> zero      'Nothing yet ({sum} in {usable} weeks)'           none
conf = (p <= ALPHA_SOLID && slope.clears && sum >= MIN_DELTA_EVENTS) ? 'solid'
     : (p <= ALPHA_LEAN) ? 'directional' : 'none'
     // p <= 0.05 but !clears, or sum < MIN_DELTA_EVENTS, is 'directional' on purpose
conf === 'none':
   last = steps.at(-1); noise = last.dir === 0 || last.dir == null || weekDelta(last.to, last.from).dir in {'flat','thin'}
   last.dir === 1  && !noise -> flat   'Up this week, flat over {n}'
   last.dir === -1 && !noise -> flat   'Down this week, flat over {n}'
   else                      -> flat   'Flat over {n} weeks'
shift (counts.total >= 4): among steps in mk.dir, maxStep/sumOfStepsInDir >= SHIFT_SHARE AND weekDelta(step.to, step.from).dir === mk.dir (not noise/thin)
                                                  -> shift_up | shift_down   'Stepped up (week of {MM-DD} carried most of the rise)' | 'Stepped down (week of {MM-DD} carried most of the drop)'   conf
plateau (n >= 6, mk.dir 'up'): S over the last PLATEAU_N usable points <= 0 AND median(last 4) >= level
                                                  -> plateau   'Rose, then flat for 4 weeks'   conf
trough (mirror, mk.dir 'down', median(last 4) <= level)
                                                  -> trough    'Fell, then flat for 4 weeks'   conf
conf === 'solid' (u/d/f = counts.up/down/flat, m = counts.total, g = counts.gaps, n = usable):
   g > 0                                           -> rising|falling 'Up {u} of {m} measured weeks, {g} missing'
   n >= STEADY_WEEKS && u >= STEADY_UP_SHARE*m && d <= 1 -> 'Up {u} of the last {m} weeks, steady'
   n >= STEADY_WEEKS && f > u                      -> 'Up {u}, flat {f} of the last {m} weeks'
   n >= STEADY_WEEKS                               -> 'Up {u} of the last {m} weeks, uneven'
   else (n 4–5)                                    -> 'Up {u} of the last {m} weeks'
   ('Down {d} …' mirrors for falling, with d and u swapped in the steady/flat rules)
conf === 'directional'                             -> leaning_up | leaning_down   'Leaning up, {u} of {m} weeks' | 'Leaning down, {d} of {m} weeks'
```
`detail` (joined with ' · ', null when empty): `'one spike week ({week})'` / `'{k} spike weeks'`;
`'{sum} events in {n} weeks'` when conf was capped by `sum < MIN_DELTA_EVENTS`;
`'newest week still settling'` when the newest step is settling. The `caveat` is separate.

### Test vectors (`trendStats.test.mjs`) — TDD, each pinned

Synthetic values; weeks are consecutive Mondays from `'2026-06-01'` unless stated. "p" is the
one-sided p of `mk.p`. For TIED vectors compute S, the tie groups, Var and the normal p BY HAND in a
comment above the assertion (show the arithmetic) and assert `p` within ±0.002; for UNTIED
vectors assert the exact p within ±1e-4. Assert `slope.rise` within ±0.01 of the value you derive
from the median-of-pairwise-slopes definition (do not copy numbers from this table without
re-deriving them). Assert label strings exactly.

| # | case | values | expected |
|---|---|---|---|
| 1 | rising clean | 10,12,15,17,18,21,25,30 | steps +×7; streak up 7; S 28, exact p 2.48e-5; clears; rising · solid · "Up 7 of the last 7 weeks, steady" |
| 2 | rising, one dip | 8,10,13,12,15,18,22,26 | ++−++++; streak up 4; S 26; clears; rising · solid · "Up 6 of the last 7 weeks, steady" |
| 3 | alternating | 10,14,10,14,10,14,10,14 | tied (groups 4,4) → method normal; slope 0; flat · none · "Flat over 8 weeks" |
| 4 | viral spike in flat | 10,11,10,30,11,10,11,10 | tied; slope 0; flat · none · "Flat over 8 weeks", detail "one spike week (2026-06-22)", spikes=[w3] |
| 5 | step change | 10,10,11,10,20,21,20,21 | tied → normal; shift_up · solid · "Stepped up (week of 06-29 carried most of the rise)" |
| 6 | all zeros | 0×8 | degenerate; zero · none · "Nothing yet (0 in 8 weeks)" |
| 7 | too few | 10,12,15 | too_few · none · "Too few weeks (3 of 4)" |
| 8 | decline clean | 30,27,24,22,19,16,14,11 | S −28 exact; falling · solid · "Down 7 of the last 7 weeks, steady" |
| 9 | decline, one up | 30,27,24,26,19,16,14,11 | falling · solid · "Down 6 of the last 7 weeks, steady" |
| 10 | plateau | 5,6,8,11,14,14,13,14 | tied; plateau · solid · "Rose, then flat for 4 weeks" |
| 11 | unmeasurable prefix | 5 × measurable:false, then 8,10,13,12,15,18,22 | 5 × 'unmeasurable'; window.n 7; rising · solid · "Up 5 of the last 6 weeks, steady" |
| 12 | nulls mid | 10,12,∅,15,16,18,∅,22 | counts {up 3, gaps 4, total 3}; rising · solid · "Up 3 of 3 measured weeks, 4 missing" |
| 13 | tiny counts, flats dominate | 0,1,1,2,2,3,3,3 | tied → normal; sum 15 ≥ 10; base 1 → floor 2·sqrt(4)=4; rise ≥ 4 → clears; up 3 flat 4 → "Up 3, flat 4 of the last 7 weeks" (not steady: 3 < 4.9) |
| 14 | floor-hugging rise | 0,0,0,0,1,1,1,1 | sum 4 < MIN_DELTA_EVENTS → NOT solid; confidence 'directional' at most; detail contains "4 events in 8 weeks" |
| 15 | bulk import (cards, mad) | 300,310,290,305,700,300,310,295 with dispersion:'mad' | flat · none · "Flat over 8 weeks", detail "one spike week (…)"; NOT up |
| 16 | exact ties | 12×8 | degenerate; flat · none · "Flat over 8 weeks" |
| 17 | drift inside noise | 10,10,12,12,12,14,14,15 | tied (2,3,2) → normal, p ≤ 0.05; rise < floor (floor = 2·sqrt(2·11)=9.38) → leaning_up · directional · "Leaning up, 3 of 7 weeks" |
| 18 | up this week, flat | 10,11,10,12,11,10,11,22 | flat · none · "Up this week, flat over 8", detail "one spike week (…)" |
| 19 | five perfect | 10,12,15,18,22 | exact p 1/120; rising · solid · "Up 4 of the last 4 weeks" |
| 20 | four with dip | 10,12,11,15 | flat · none · "Flat over 4 weeks" |
| 21 | four perfect | 10,12,15,18 | exact p 1/24; rising · solid · "Up 3 of the last 3 weeks" |
| 22 | break cut | #1 with breaks=[{week: w6}] | 6 × 'break'; too_few "Too few weeks (2 of 4)"; caveat "Definition changed {w6}; 2 weeks since" |
| 23 | partial week | #1 + {week: w8, value 4, complete:false} | thisWeek {w8, 4}; 'incomplete' excluded; verdict identical to #1 |
| 24 | settling newest | #1 with the last point settling:true | steps.at(-1).settling true; verdict as #1 with detail "newest week still settling" |
| 25 | window | 13 rising points | only the last 8 scored (window.calendarWeeks 8); steps.length 7 |

Properties: `exactTailP` anchors above; exact vs normal within 0.02 at n = 12 untied;
`mannKendall` of a tied series reports `method:'normal'`; `S(reverse) = −S` and the verdict
mirrors (rising ↔ falling, same counts); adding a constant leaves S/steps/p unchanged;
multiplying #17 by 10 flips `clears` to true; `weeklyTrend(null)`, `[]`, `[{}]` → too_few
without throwing. `weekDelta`: (40,30) → flat '+33%' noise; (25,12) → up '+108%'; (3,1) →
thin n=4 text '+2'; (7,0) → thin; (70,0) → up 'new'; (null,5) → null; (30,30) → flat without
noise; exact (1200,1000) → up '+20%' with no `noise` key.

**Done when:** all vectors and properties pass, `npm test` green overall, output pristine;
committed by pathspec.

---

## Task 3: Migration 0372 — weekly series, notes, markers, kpi fixes

**Files:** NEW `supabase/migrations/0372_admin_weekly_series_and_notes.sql`,
NEW `boards/src/lib/weeklySeriesMigration.test.mjs` (text test in the style of
`boards/src/lib/featureReachMigration.test.mjs`, using `migrationText.mjs`'s `MIGRATIONS_DIR`
and `latestDefinition`). Do NOT apply the migration; the controller applies it through the
Supabase MCP after review.

Read first: `0149_verified_logged_in_users.sql` L546-646 (`admin_kpi_summary`, the function you
rewrite in place) and L103-130 (`admin_signups_by_day`, the verified rule), `0110` L37-53
(`_internal_user_ids`), `0254_universe_counter_truth.sql` L476-500 (`admin_cards_per_day`, the
cards join), `0278` L66-160 (cohort matrix: the work floor idiom), `0324` L121-139 (proof block
shape), `0335` L469-480 (discovery alerts in `client_errors`), `0369` L68-82 (`ops_alerts`),
`0311` header (grants habit), CLAUDE.md "Function grants since 0311".

### Contents, in order, wrapped in `begin; … commit;`

Header comment in the house style: WHY (one 7-day delta cannot say "consistently"; the sparks
and tiles disagreed on definitions: `admin_signups_by_day` has no internal exclusion, the
Weekly-active spark was a same-day presence snapshot from `metrics_daily`, `admin_kpi_summary`
compared 8 calendar days of WAU with 7 and counted cards by `updated_at`, and applied no verified
rule to WAU; `metrics_daily` cannot be the series: snapshot, no backfill, four definition
breaks), WHAT (the five items below), DELIBERATELY NOT DONE (no visits column; no trials/MRR
column; no DROP of anything; definition-break DATES live in the client as repo facts, only the
floors are data; history can shrink because deleted accounts and cards leave `auth.users` /
`card_index`; `admin_cards_per_day` already counts `created_at` since 0254 and is untouched).
No live figures in the comment.

1. **`public._admin_people(p_exclude_internal boolean, p_verified_only boolean)`**
   `returns table(user_id uuid, created_at timestamptz)`, `language sql stable security definer set search_path = public`:
   `select u.id, u.created_at from auth.users u where (not p_verified_only or (u.email_confirmed_at is not null and u.last_sign_in_at is not null)) and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))`.
   Internal helper: `revoke all … from public, anon, authenticated; grant execute … to service_role;`
   (definer callers run as owner and keep access). Comment: the ONE population predicate for
   admin reads; 0149's verified rule; 0110's internal rule.
2. **`public.admin_weekly_series(p_weeks int default 14, p_exclude_internal boolean default true, p_verified_only boolean default true)`**
   `returns table (week_start date, complete boolean, settling boolean, signups int, active_users int, active_measurable boolean, work_users int, work_measurable boolean, cards int, active_floor date, work_floor date)`,
   plpgsql stable security definer, `#variable_conflict use_column`, `perform public._require_admin()`.
   - `v_weeks := least(greatest(coalesce(p_weeks,14),2),52)`; `v_this := date_trunc('week', current_date)::date`;
     `v_first := v_this - (v_weeks-1)*7`; `v_active_floor := (select min(day) from user_active_day)`;
     `v_work_floor := (select min(day) from user_active_day where did_work)`.
   - CTEs: `people as (select * from public._admin_people(p_exclude_internal, p_verified_only))`;
     `weeks` via `generate_series(v_first, v_this, interval '7 days')`;
     `su`: `date_trunc('week', (p.created_at at time zone 'utc'))::date`, count per week, `created_at >= v_first`;
     `act`: from `user_active_day a join people p on p.user_id = a.user_id where a.day >= v_first`,
     `count(distinct a.user_id)` and `count(distinct a.user_id) filter (where a.did_work)` per `date_trunc('week', a.day)`;
     `ca`: from `card_index ci left join boards b on b.id = ci.board_id where ci.created_at >= v_first`
     and the 0254 internal predicate on `b.created_by`, per `date_trunc('week', (ci.created_at at time zone 'utc'))::date`.
   - Row: `complete = (week_start + 7) <= current_date`; `settling = (week_start + 7 + 3) > current_date`
     (true for the partial week and the newest complete week's first 3 days);
     `active_users` = NULL and `active_measurable=false` when `week_start < v_active_floor` (else coalesce 0);
     `work_users` = NULL and `work_measurable=false` when `v_work_floor is null or week_start < v_work_floor`;
     `cards` coalesce 0; `active_floor`, `work_floor` on every row. Order by week.
   - `revoke … from public, anon; grant execute … to authenticated, service_role;` + comment
     (durable tables only, never metrics_daily; NULL means "we were not counting"; history can shrink).
3. **`public.admin_notes`** table: `id bigint generated always as identity primary key, day date not null, label text not null check (length(label) between 1 and 120), kind text not null default 'note' check (kind in ('ship','event','note')), created_by uuid references auth.users on delete set null, created_at timestamptz not null default now(), deleted_at timestamptz`;
   partial index on `(day) where deleted_at is null`; `enable row level security`; `revoke all on table … from public, anon, authenticated`; comment.
   RPCs (all plpgsql volatile security definer, `perform public._require_admin()` first):
   - `admin_note_add(p_day date, p_label text, p_kind text default 'note') returns jsonb`: validate
     `p_day` in `[date '2026-01-01', current_date + 1]`, trimmed label 1..120, kind in set (errcode 22023 on each);
     insert with `created_by = auth.uid()`; return `to_jsonb(row) - 'deleted_at'`.
   - `admin_note_delete(p_id bigint) returns boolean`: soft delete (`deleted_at = now()` where `deleted_at is null`); returns whether a row changed.
   - `admin_note_restore(p_id bigint) returns jsonb`: clears `deleted_at` where set; raises 22023 when nothing to restore; returns the row minus `deleted_at`.
4. **`public.admin_markers(p_since date default null) returns table (day date, kind text, label text, source text, ref_id bigint)`**,
   plpgsql stable security definer, `#variable_conflict use_column`, `_require_admin()`; `v_since := coalesce(p_since, current_date - 120)`:
   - notes: `deleted_at is null and day >= v_since` → `(day, kind, label, 'note', id)`.
   - discovery alerts: `client_errors where kind = 'discovery_pipeline' and occurred_at >= v_since`,
     one marker per `name` per RUN of consecutive UTC days (gaps-and-islands: `day - row_number() over (partition by name order by day)`),
     emitted at the run's first day with label `name` when the run is 1 day, else `name || ' (' || n || ' days)'`; `kind 'alert'`, `source 'discovery'`, `ref_id null`.
   - ops alerts: `ops_alerts where created_at >= v_since and kind not in ('heartbeat','test','held_reminder','signups')`,
     one per (UTC day, kind) with `min(title)`; `kind 'alert'`, `source 'ops'`.
   - `order by day, source, label`.
5. **`admin_kpi_summary(p_days integer default 30, p_exclude_internal boolean default true, p_verified_only boolean default true)`** rewritten IN PLACE with `create or replace` (same signature; the ACL survives) — copy the 0149 body and change ONLY these things, marking each changed line `-- 0372`:
   - every user-population predicate (signups, activated, converted, demo_base, wau) goes through `people as (select * from public._admin_people(p_exclude_internal, p_verified_only))` so one definition serves all keys;
   - `wau` current = `user_active_day.day > v_cur_lo::date and day <= v_now::date` (exactly `p_days` days), previous = `day > v_prev_lo::date and day <= v_cur_lo::date`, both joined to `people`;
   - add `work_users` (distinct `user_id` where `did_work`, same two windows, same `people` join) to BOTH `current` and `previous`;
   - `cards_created` counts `ci.created_at` (select and where) instead of `updated_at`, both windows.
   Everything else (activation keys, checkout keys, as-of-now maturation) unchanged. Restate
   `revoke … from public, anon; grant execute … to authenticated, service_role;`.
6. **Proof block** (`do $proof$ … $proof$`), 0324 shape: for each of
   `public._admin_people(boolean, boolean)` (anon/authenticated must NOT execute; service_role must),
   `public.admin_weekly_series(integer, boolean, boolean)`, `public.admin_note_add(date, text, text)`,
   `public.admin_note_delete(bigint)`, `public.admin_note_restore(bigint)`, `public.admin_markers(date)`,
   `public.admin_kpi_summary(integer, boolean, boolean)` (anon must not; authenticated and service_role must);
   `admin_notes` not selectable by anon/authenticated (`has_table_privilege`); `relrowsecurity` true;
   each `admin_*` function's `prosrc` contains `_require_admin()` (the 0369 habit).

### Text test (`weeklySeriesMigration.test.mjs`)

Asserts on the file text: `latestDefinition(fn).file === '0372_…'` for the six new/rewritten
functions and `_require_admin\(\)` in each `admin_*` body; `_admin_people` is revoked from
`public, anon, authenticated` and granted to `service_role` only; every `admin_*` function has
`revoke … from public, anon` and `grant execute … to authenticated, service_role`; the proof
names all seven signatures and checks `service_role`; `admin_notes` has
`enable row level security` and `revoke all on table public.admin_notes from public, anon, authenticated`;
the file contains NO `drop function`; `admin_weekly_series` returns the eleven columns in order;
`admin_kpi_summary` body contains `created_at` in the cards CTE and no `updated_at`;
`admin_markers` excludes `'heartbeat'`, `'test'`, `'held_reminder'`, `'signups'`;
nothing defined by 0322/0347/0361/0363/0365 is re-created here. Write the test RED first (the file
does not exist), then the migration.

**Done when:** the text test passes, `npm test` green, committed by pathspec. The controller
then applies 0372 via MCP and runs the live sanity SELECTs (outside this task).

---

## Task 4: Harness fixtures for the weekly series, markers and notes

**Files:** `boards/src/local/adminFixtures.js` (edit). Read its header, the `RPCS` map, the
fixed-horizon block near L1066 and `rpcResult` (~L943-1000) first; follow the existing idioms
(`?mrr=0` URL switch, mutable fixtures, deterministic data, no `Math.random`).

Requirements (all dates RELATIVE to today; nothing may depend on the real calendar):
- `weekStarts(n)` helper: the last `n` UTC Mondays ascending ending with this week's Monday
  (`(getUTCDay()+6)%7`; correct on Sundays). Do not touch the existing `fhWeeks`.
- `RPCS.admin_weekly_series`: 14 rows `{ week_start, complete, settling, signups, active_users, active_measurable, work_users, work_measurable, cards, active_floor, work_floor }`:
  signups rising with exactly one down week (synthetic tens); active_users rising; `work_users`
  null with `work_measurable:false` for the FIRST 9 rows (structural: 4 measurable complete weeks →
  3 steps → 4 hatched slots, permanently) and `work_floor = WK[9]`; `active_measurable` true
  everywhere, `active_floor = WK[0]`; cards noisy-flat in the hundreds; the last row
  `complete:false, settling:true` with small values; the second-to-last `settling:false`.
- Mutable `NOTES` (3 rows: a `ship` dated exactly `WK[3]` (a Monday — the Playwright position
  anchor), an `event` at `WK[7]+2 days`, a `note` at `WK[11]+4 days`), `DELETED_NOTES` map,
  `ALERT_MARKERS` (two `discovery`, one `ops`, relative days).
- `rpcResult` branches: `admin_weekly_series` honours `p_weeks` (last N rows) and DEV URL param
  `?weeks=N` (keep the last N COMPLETE rows plus the partial row, so `?weeks=3` drives too_few);
  `admin_markers` → sorted `[...NOTES as {day, kind, label, source:'note', ref_id:id}, ...ALERT_MARKERS]`
  minus `DELETED_NOTES`; `admin_note_add` → pushes `{ id: next, day, label, kind, created_at }` and
  returns it; `admin_note_delete` → moves to `DELETED_NOTES`, returns true/false;
  `admin_note_restore` → moves back and returns the row, or null. `admin_kpi_summary` fixture gains
  `work_users` in `current` and `previous`.
- A DEV URL param `?breaks=0` is read by TodayView (Task 8), not here; but export
  `HARNESS_BREAKS` = `DEFINITION_BREAKS` shifted so the single `cut` entry lands at `WK[9] + 1 day`
  (then `mondayOnOrAfter` = `WK[10]`): the harness passes it to `breaksFor`, making the
  Did-real-work tile's state structural (3 usable complete weeks after the cut → too_few).
- No `.from()` changes (notes go only through RPCs; the table has no grants).

Verify by loading `/?adminpreview=1&tab=overview&view=today` in a DEV server: no console
errors (the UI does not consume the new fixtures yet, so only the absence of errors is checked
here). Add a short node test `adminFixtures.test.mjs`? NO — the fixtures file imports the
Supabase client; keep verification to the harness load and a read of `window.__admRpcCalls`.

**Done when:** fixtures present, harness loads clean, committed by pathspec.

---

## Task 5: StreakStrip, the `trend` prop on Metric, and the noise-gated delta

**Files:** NEW `boards/src/pages/admin/viz/StreakStrip.jsx`; edit `viz/Metric.jsx`,
`analytics/views/TodayView.jsx` (only the four `deltaInfo` call sites), `admin.css` (append).
Read `viz/Metric.jsx`, `admin.css` L521-610 and L3892-3961 (`.admin-stat-*`), L1699-1733
(small-N classes), L4287-4353 (`.adm-well`), and `viz/CohortMatrix.jsx` (the hatched unmeasured
cell) first.

- `StreakStrip({ trend, slots = 7 })` → `<span className="adm-streak" role="img" aria-label={trend.verdict.label}>`
  containing `streakSlots(trend, slots)` (Task 1) as `<span className="adm-streak-g is-{state}{ settling ? ' is-settling' : ''}" aria-hidden="true" title={title}>{glyph}</span>`
  with glyph `▲` up, `▼` down, `·` flat, `''` for gap/unmeasured. Text nodes only.
- `Metric` gains `trend` (TrendRead | null). When present: a `.admin-stat-streak` row renders
  BETWEEN the figures and the sub line (never in the head slot — six hero tiles cannot hold label +
  strip + verdict in one row); a `.admin-stat-verdict` line shows `trend.verdict.label`
  (`title` = `trend.caveat ?? trend.verdict.detail`); when `trend.caveat` is set a second muted line
  `.admin-stat-caveat` prints it. Head-right slot keeps `delta`/`flagN` as before.
- `DeltaBadge` gains `quiet` and `suffix`: renders `dir:'thin'` as `is-thin` with glyph `·`,
  sr-only "too few to compare" and the signed absolute; `noise:true` as `is-flat` with sr-only
  "flat, within noise" and the signed %; `quiet` collapses the colour to `--ink-3` (glyphs stay);
  `suffix` appends e.g. "vs prior 7d".
- `Metric` treats an empty `spark` array as absent (`hasSpark = Array.isArray(spark) && spark.length > 0`),
  and when `trend` is present but the series is empty renders `.admin-stat-spark-empty` so the
  rail keeps its height.
- Delete `deltaInfo` from `Metric.jsx`; TodayView imports `weekDelta` from `../../../../lib/trendStats.js`
  and calls `weekDelta(num(cur.x), num(prev.x))` for signups/wau/cards and
  `weekDelta(mrrCents, mrrPrev, { kind: 'exact' })` for MRR (the tree must stay green after this task).
- CSS (append at the end of `admin.css` under `/* ── Weekly consistency ── */`): token
  `--adm-hatch` on `:root` (dark: `repeating-linear-gradient(45deg, rgba(255,255,255,.075) 0 2px, transparent 2px 5px)`),
  on the light theme selector used elsewhere in the file (`rgba(0,0,0,.09)`), and re-declared
  inside a `.adm-well` rule APPENDED at the end (dark value) — note the chartPalette regex only reads
  the FIRST `.adm-well {` block, so an appended one is safe; repoint `.adm-cohort-cell.is-unknown`
  to `background: var(--adm-hatch)`. `.adm-streak` (inline-flex, gap 2px), `.adm-streak-g`
  (9×11px mono, centred; `is-up` `--adm-good`, `is-down` `--adm-bad`, `is-flat` `--ink-3`,
  `is-gap`/`is-unmeasured` `background: var(--adm-hatch)`, `is-settling` outlined: 1px border
  `currentColor`, transparent fill); `.admin-stat-streak` row; `.admin-stat-verdict`
  (500 12px `--ink-1`, `min-height: 2.6em; line-height: 1.3`); `.admin-stat-caveat` (11px `--ink-3`);
  `.admin-stat-delta.is-quiet` (11px mono `--ink-3`); `.admin-stat-delta.is-thin`;
  `.admin-stat-grid.is-hero` minmax raised to `190px`.
- Nothing gold; glyph classes never use `content:`.

Verification: `npm test` green (lib unchanged; `chartPalette.test.mjs` must still pass — it
reads `admin.css`), `vite build` or the DEV server compiles, the existing Playwright admin suite
passes except the known poll test. (The strip is not visible until Task 8 passes `trend`.)

**Done when:** committed by pathspec with the above verified.

---

## Task 6: AreaChart markers, bands and the partial week; WeeklyMultiples

**Files:** edit `boards/src/pages/admin/viz/AreaChart.jsx`; NEW
`boards/src/pages/admin/analytics/widgets/WeeklyMultiples.jsx`; `admin.css` (append). Read
`AreaChart.jsx` fully and `admin.css` L3987-4084 (`.adm-area*`) first.

AreaChart new props (all optional, defaults keep today's behaviour):
- `markers: [{ index, edge, kind, label, day }]` — rendered inside `.adm-area-plot` after the
  vgrids as HTML `.adm-area-marker.is-{kind}` dashed verticals at `left: index/(n-1)*100%`
  (`is-edge` draws flush at the right rule); when `markerGlyphs` is true each carries
  `.adm-area-marker-glyph` text (`GLYPH = { ship:'◆', changelog:'◇', event:'●', note:'●', alert:'⚠', break:'┆' }`,
  neutral ink, `aria-hidden`, native `title` = `day · label`). Marker lines must NOT use
  `.adm-area-vgrid` (the graph-paper guard counts those).
- `bands: [{ from, to, title }]` in index units → `.adm-area-band` (hatched `--adm-hatch`) inside the plot.
- `markPoints` → `.adm-area-pt` dot per non-null point; `partialLast` → the last point is excluded
  from the path/area and from `markLast`, and drawn as `.adm-area-pt.is-partial` (hollow: plot-ground
  fill, 1.5px stroke in the series colour).
- `axis` (default true) → when false the per-chart `.adm-area-x` is not rendered.
- Hover tooltip gains `.adm-area-tip-m` lines for markers whose `floor(index) === hover`.
- Verticals remain `vLines` equal divisions; callers pass `vLines = n − 1` for weekly data so each
  division is one week (gx = 4·(n−1) keeps the graticule guard whole).

`WeeklyMultiples({ weeks, series, markers, partialWeeks = 1 })`: `series = [{ key, name, color, values, measurable }]`
(four rows); renders `.adm-stack` with one `.adm-stack-row` per series: `.adm-stack-label`
(micro-cap name) + `<AreaChart height={96} vLines={weeks.length-1} axis={false} markers={…} markerGlyphs={i===0} markPoints partialLast bands={…} labels={weeks.map(weekLabel)} series={[row]} />`;
`bands` = contiguous runs of `measurable === false` (`title` "not measured yet"); markers via
`markerIndex(day, weeks)` (Task 1) with `kind`; one shared `.adm-area-x` under the stack
(first week · middle week · "so far"), aligned to the plot column; an `sr-only` `<ul>` of markers
("Marker, 2026-09-15, ship: …"). Top row only draws glyphs (no ribbon, no magic offsets).

CSS: `.adm-area-marker`, `.adm-area-marker-glyph`, `.adm-area-pt`, `.adm-area-pt.is-partial`,
`.adm-area-band`, `.adm-area-tip-m`, `.adm-stack`, `.adm-stack-row`, `.adm-stack-label`,
`.adm-stack-x`. Neutral ink for all marker kinds.

Pure geometry belongs in `lib/weeklySeries.js` (already: `markerIndex`); if you need another pure
helper (e.g. `bandsFromMeasurable(points)`), add it there WITH a test.

Verification: DEV server compiles; `npm test` green; Playwright "the paper subdivides the
graticule" still passes (the component is not mounted until Task 8, so also render it once in
the harness via a temporary story? NO — keep scope: static review + compile).

**Done when:** committed by pathspec.

---

## Task 7: MarkersPanel — the list and the note form

**Files:** NEW `boards/src/pages/admin/analytics/widgets/MarkersPanel.jsx`; `admin.css` (append).
Read `viz/Well.jsx` (Plate), an existing admin form (e.g. the discount form in
`AdminDiscountsTab.jsx` or `AdminGrantsTab.jsx`) for input/button classes (`auth-input`,
`admin-action`), and `components/AppFeedback.jsx` `useFeedback` + `lib/undoToast.js`.

`MarkersPanel({ markers, onAdd, onRemove, busy, todayUtc })` — presentational; TodayView owns the
RPC calls (Task 8). Renders inside a `Plate` (the caller passes `span`): list newest first, max 12
rows + "{n} more" caption; `<li className="adm-marker-row is-{kind}">` glyph span (`aria-hidden`,
same `GLYPH` map as Task 6 — export it from `WeeklyMultiples.jsx` or a tiny `viz/markerGlyphs.js`),
`MM-DD` mono date, label, changelog rows link to `/changelog#{anchor}` (`target="_blank" rel="noopener"`),
definition rows show the migration number muted, note rows get
`<button type="button" className="admin-action adm-marker-x" aria-label={`Remove note: ${label}`}>✕</button>`.
Foot = the form:
```jsx
<form onSubmit={submit} className="adm-markers-form" aria-label="Add a dated note">
  <input type="date" className="auth-input adm-markers-date" value={day} max={todayUtc} required aria-label="Date" />
  <button type="button" className="admin-action is-quiet" onClick={() => setDay(todayUtc)}>today</button>
  <select className="auth-input adm-markers-kind" value={kind} aria-label="Kind">
    <option value="note">note</option><option value="ship">ship</option><option value="event">event</option>
  </select>
  <input className="auth-input adm-markers-label" value={label} maxLength={120} placeholder="what changed…" required aria-label="Label" ref={labelRef} />
  <button type="submit" className="admin-action" disabled={busy || !label.trim()}>Add</button>
</form>
```
The date defaults to `todayUtc` and a small caption shows "UTC day" so the owner picks the day
they mean. Enter submits. `onAdd(day, label, kind)` returns a promise; on resolve the label
clears and focus returns to the label input. `onRemove(row)`.

CSS: `.adm-markers`, `.adm-marker-row`, `.adm-marker-g`, `.adm-marker-d`, `.adm-marker-x`,
`.adm-markers-form { display:grid; grid-template-columns: 128px auto 96px 1fr auto; gap:6px }`,
`@media (max-width:1400px) { .adm-plate.adm-markers { grid-column: span 12; } }`.

**Done when:** compiles, `npm test` green, committed by pathspec.

---

## Task 8: Wire the Today view

**Files:** edit `boards/src/pages/admin/analytics/views/TodayView.jsx`,
`boards/src/pages/admin/analytics/AnalyticsFiltersContext.jsx`,
`boards/src/pages/admin/AdminAnalyticsTab.jsx`; DELETE
`boards/src/pages/admin/analytics/widgets/HabitCurve.jsx` and
`widgets/AcquisitionBreakdown.jsx` (confirm zero importers with grep first).

- Fetch: add `supabase.rpc('admin_weekly_series', { p_weeks: 14, p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly })`
  and `supabase.rpc('admin_markers')`; remove both `admin_signups_by_day` calls, `admin_cards_per_day`
  and `admin_habit_curve` (the Did-real-work headline becomes `cur.work_users` from the rewritten
  `admin_kpi_summary`; keep `d.workUsers` semantics: null when the key is absent). Keep
  `admin_kpi_summary` FIRST and the only gating call; keep `admin_metrics_history` for the MRR spark.
  Result gains `weekly`, `markers`. Deps array includes `f.excludeInternal, f.verifiedOnly`.
- `trends` via `useMemo`: for each `WEEKLY_METRICS` entry
  `weeklyTrend(toWeekPoints(d.weekly, m), { breaks: breaksFor(m.col, breakList), dispersion: m.dispersion })`
  where `breakList` = `[]` when DEV `?breaks=0`, `HARNESS_BREAKS` when `isAdminPreviewMode()` (DEV only,
  import from `local/adminFixtures.js` behind `import.meta.env.DEV`), else `DEFINITION_BREAKS`.
  `completeWeeks = d.weekly.filter(r => r.complete).length`; `weeks = d.weekly.map(r => r.week_start)`.
- Notes: `useState` seeded from `d.markers.filter(m => m.source === 'note')` (effect keyed on the
  `d.markers` identity); `mergedMarkers = mergeMarkers({ rpc: [...alerts, ...notes], changelog: CHANGELOG_ENTRIES, breaks: DEFINITION_BREAKS, from: weeks[0], to: todayUtc })`.
  Handlers (never `.catch()` a builder):
  - add: `const { data, error } = await supabase.rpc('admin_note_add', { p_day, p_label, p_kind })`; on error or no row → `feedback.toast({ type:'error', message: … })`; else prepend `{ day, kind, label, source:'note', ref_id: data.id }`.
  - remove: optimistic filter; `rpc('admin_note_delete', { p_id })`; on error/false → put it back + error toast; else
    `undoToast(feedback, { message: `Note removed · ${label}`, onUndo: async () => { rpc('admin_note_restore', { p_id }) → on row put it back (same id) else error toast } })`.
- Tiles (band 01, title unchanged "The last seven days"): Signups `trend={trends.signups}`,
  `spark` = complete weekly signups (13 values), `delta={weekDelta(num(cur.signups), num(prev.signups))}`
  rendered quiet with suffix "vs prior 7d"; Weekly active likewise with `cur.wau`; Did real work:
  value `cur.work_users`, `trend={trends.work}`, spark = measurable complete weeks only (pass `null`
  when empty), keep `total` "were here"; Cards created with `cur.cards_created`; Trials and MRR untouched
  (MRR delta `weekDelta(mrrCents, mrrPrev, { kind:'exact' })`). Tile `title` tooltips mention the
  one-sided 5% rule: "Steady = rank test at 5% one-sided and a rise above the noise floor".
- Band 02 "Thirteen weeks, and what changed" replaces "Growth": `Well span={8} title="Weekly, by metric" meta="13 complete weeks + this week so far · UTC Monday" foot="History can shrink: deleted accounts and cards leave it."`
  → `WeeklyMultiples`; `Plate span={4} className="adm-markers" title="What changed" meta={`${n} markers in 13 wk`}` → `MarkersPanel`.
  Bands 03 and 04 unchanged.
- `useRegisterViewRuntime({ refresh, lastUpdated, refreshing, status })` where `status` is
  `useMemo(() => ({ weeks: completeWeeks, partialDays }), [completeWeeks, partialDays])`; in the hook
  key the effect on `status?.weeks` and `status?.partialDays` (primitives) — an object literal in the
  deps loops the provider. `partialDays` = UTC days elapsed in the current week (1..7).
- `DeckStatus` on Today: WINDOW `'7d · 13 wk UTC · {k} of 7 days'`; append `['WEEKS', `${n} complete`]`
  when `runtime.status?.weeks != null`.

Verification: DEV server renders `/?adminpreview=1&tab=overview&view=today` in both themes with no
console errors; `&weeks=3` shows "Too few weeks" everywhere; `&breaks=0` scores the work tile;
add/remove/undo a note works in the harness; `npm test` green; existing Playwright admin suite
passes except the known poll test and any test the new layout invalidates (list them in the report
for Task 9 to update — do not edit the spec file in this task).

**Done when:** committed by pathspec.

---

## Task 9: Playwright guards

**Files:** edit `boards/tests/admin-dashboard.spec.js`. Read its helpers (`watchConsole`,
`openAdmin`) and the existing guard tests first. Run with `PW_PORT=5181`.

New tests, all against `?adminpreview=1&tab=overview&view=today` (desktop-chrome; theme loop
where the existing suite loops):
1. `under four complete weeks every tile says too few, not a verdict` — `&weeks=3`; every
   `.admin-stat-verdict` inside a tile with `.adm-streak` matches `/Too few weeks/`;
   `.adm-streak-g.is-up, .adm-streak-g.is-down` count 0.
2. `the streak strip is seven glyphs and one sentence` — Signups tile `.adm-streak-g` count 7;
   `getByRole('img', { name: /of the last \d+ weeks/ })` count ≥ 2.
3. `an unmeasured week never gets a direction` — Did-real-work tile: `.adm-streak-g.is-unmeasured` ≥ 1,
   each with empty `textContent` and computed `backgroundImage` containing `repeating-linear-gradient`;
   none also `is-up|is-down`.
4. `markers land on their week, on every chart` — the fixture `ship` note on `WK[3]`: each of the 4
   `.adm-area-plot` has an `.adm-area-marker.is-ship` whose `left` ≈ `3/13*100`% ±0.5.
5. `the note form adds a marker, and removing it offers undo` — type a label, press Enter;
   `.adm-marker-row.is-note` +1 and `.adm-area-marker.is-note` +4; `__admRpcCalls.admin_note_add === 1`;
   click "Remove note: …"; a toast with "Note removed" and `getByRole('button', { name: 'Undo' })`;
   click Undo → counts restored and `__admRpcCalls.admin_note_restore === 1`.
6. `the partial week is hollow and not joined` — the last `.adm-area-pt` in each row has `is-partial`
   and no stroked path reaches the right edge.
7. `the thirteen-week well is on the first screen` — at 1440×900 `.adm-stack` top < 900.
8. `the weekly series is fetched with the toolbar's population` — toggle INTERNAL;
   `__admRpcCalls.admin_weekly_series` increments.
9. `hero tiles never overflow sideways` — at 1280×800 and 1440×900 no `.admin-stat-card.is-hero`
   has `scrollWidth > clientWidth`.
10. `four stacked charts share one axis` — exactly one `.adm-stack-x` and zero `.adm-area-x` inside `.adm-stack`.

Update existing: "Today packs the first screen" → count `.adm-well, .adm-plate, .admin-stat-card`
with floor 9; "no chart paints itself in the reserved accent" → add `.adm-streak-g`,
`.adm-area-marker`, `.adm-area-pt`, `.adm-area-band` to its selector list; "every plot well is
darker" unchanged; "the paper subdivides the graticule" must still pass; "ornament never enters an
accessible name" unchanged; leave "the page refreshes itself" alone.

**Fail-when-broken evidence (required in the report):** for tests 1, 3, 4 and 5, temporarily
break the thing guarded (e.g. make `streakSlots` emit `up` under too_few; drop the hatch token;
shift `markerIndex` by one; skip the undo toast), observe the test go red, revert. Quote the red
output.

Spec header rule: add a comment at the top of the Today tests: "No admin-dashboard test may
depend on the real date; fixtures are relative to this week's Monday."

**Done when:** the suite passes (except the known poll test), evidence recorded, committed by pathspec.

---

## Task 10: Spec document and final verification

**Files:** NEW `docs/superpowers/specs/2026-10-07-admin-weekly-trends-design.md` (the design
as built: data contract, stats API + verdict vocabulary, UI, markers, fixtures/harness rules,
tests; no live figures); this plan file is already committed.

Verification run (record outputs in the report): `cd boards && npm test`; `npm run docs:check`
(must be a no-op: nothing under `content/` changed); `PW_PORT=5181 npx playwright test tests/admin-dashboard.spec.js --project=desktop-chrome`;
`cd boards && npx vite build` with `.env.local` present and confirm the AppShell chunk is roughly its
usual size (~600 KB+) and the admin chunk contains the string `Too few weeks`.

**Done when:** spec committed by pathspec and the verification outputs are in the report.
