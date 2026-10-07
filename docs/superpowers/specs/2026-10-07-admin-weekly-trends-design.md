# Admin Overview: a weekly consistency read and dated markers

**Date:** 2026-10-07
**Status:** built. This describes the design as it shipped; where review changed the
plan, what is written here is what the code does.
**Migration:** 0372
**Plan:** `docs/superpowers/plans/2026-10-07-admin-weekly-trends.md`

The Today view of the admin Overview answered "how is it going?" with one seven-day
delta and a sparkline per tile. That cannot say whether a metric has gone up
*consistently*. At this product's volume a single week is mostly noise: one viral post,
one bulk import or one holiday moves it by more than a month of real trend does, and
"+40%" looks the same whether it is the fifth rise in a row or a coin that landed heads.

This work makes Today answer the question it is opened with: has each metric held its
direction for weeks, and what changed along the way? Every number in this document is
synthetic; the repo is public.

---

## Context and outcome

### What the owner asked for

- For signups, weekly active people, people who did real work and cards created: is it
  going up **consistently**, answered as a plain sentence and a strip of per-week glyphs,
  not as a number to interpret.
- Beside the charts, **what changed and why**: releases, pipeline and ops alerts, and the
  dates a counter started meaning something else.
- A way to **pin their own dated notes** (a ship, an event, a note) on that timeline.

### Why the old tiles could not answer it

- One seven-day delta cannot say "consistently". A good week read the same as a rise that
  had held for two months.
- The sparks beside the tiles did not count what the tiles count. The signups spark had
  no internal-account exclusion. The weekly-active spark was a same-day presence snapshot
  from `metrics_daily`, not distinct people over a week. `admin_kpi_summary` compared
  eight calendar days of weekly-active people against seven in the window before, applied
  the verified rule to signups but not to weekly active, and counted cards by
  `updated_at` while the cards spark counted `created_at`.
- `metrics_daily` cannot be the series. It is a once-a-day snapshot (a missed run is a
  missing day and nothing backfills it), and what its counters mean has changed four
  times.

### What shipped

- **Migration 0372**: a weekly series computed from durable tables under one population
  definition, the owner's notes, a markers feed, and an in-place fix to the headline
  figures.
- **`trendStats.js`**: a pure library that scores complete weeks and returns a literal
  strip and one sentence, plus a noise-gated week-over-week delta.
- **`weeklySeries.js` and `adminDefinitionBreaks.js`**: the UTC week calendar, the row
  adapter, marker placement and merging, and the dated list of changes in what a counter
  means.
- **On Today**: a seven-glyph strip, a verdict sentence and a quiet week-over-week badge
  on four tiles; a stack of four weekly charts with dated markers; a "What changed" list
  with a note form and an undo; one new status-strip item (WEEKS) and a longer WINDOW
  value.
- **A harness and guards**: preview fixtures that put every state on screen without
  waiting for the calendar, node tests for every rule, and Playwright guards that were
  each seen to fail with the thing they protect broken.

### Where it lives

`/admin`, Overview, Today view (`?tab=overview&view=today`), in its first two bands:

- Band 01, **The last seven days**: the hero tiles. Unchanged title.
- Band 02, **Thirteen weeks, and what changed**: replaces "Growth". The weekly stack and
  the markers list.
- Bands 03 and 04 (activity by weekday and hour, live console, people) are unchanged.

Two widgets that nothing imported any more (`HabitCurve`, `AcquisitionBreakdown`) were
deleted. Today no longer calls `admin_signups_by_day` (twice), `admin_cards_per_day` or
`admin_habit_curve`, which fed the old Growth band and the work headline; those RPCs
remain, for the Command Center and Retention views.

This is an admin-only surface. No public-facing surface changed, so `boards/content/docs/**`
is untouched and `npm run docs:check` stays a no-op.

### The rules the design obeys

- **Honesty over confidence.** When data is thin or was never measured, the interface says
  so ("Too few weeks", hatching, a hollow point) and never prints a direction or a number
  it did not measure. A week nobody was recording is never a zero.
- **Weeks are UTC calendar weeks starting Monday**, everywhere: `date_trunc('week')` in
  SQL, `mondayOf` in JS, never a local getter. Nearly every bug in this area is two places
  disagreeing about the week, so the calendar lives in one module.
- **Durable tables, never snapshots.** Every weekly number is recomputed from
  `auth.users`, `user_active_day` and `card_index` under one definition.
- **A glyph or a word always accompanies a colour.** Direction is carried by shape;
  marker kinds are carried by shape in one neutral ink.
- **Gold (`--soleil`) is never a data colour.** No generated CSS `content:` text anywhere
  in the new surfaces (it enters the accessible name).
- **Deleting shows an undo toast**, never a confirm dialog.
- **One source for each sentence.** The strip's accessible name *is* the verdict label.

### Where the pieces live

| Path (under `boards/` unless noted) | Role |
|---|---|
| `supabase/migrations/0372_admin_weekly_series_and_notes.sql` (repo root) | The data contract |
| `src/lib/trendStats.js` | Mann-Kendall, Theil-Sen, noise floor, verdict tree, `weekDelta` |
| `src/lib/weeklySeries.js` | Week calendar, `WEEKLY_METRICS`, row adapter, cut points, marker placement, bands, merging, strip slots |
| `src/lib/adminDefinitionBreaks.js` | The dated list of definition changes |
| `src/pages/admin/viz/StreakStrip.jsx` | The seven-glyph strip |
| `src/pages/admin/viz/Metric.jsx` | Tile: `trend` prop, quiet badge, empty-spark slot |
| `src/pages/admin/viz/AreaChart.jsx` | Chart: markers, bands, hollow partial point, optional axis |
| `src/pages/admin/viz/markerGlyphs.js` | One shape per marker kind |
| `src/pages/admin/analytics/widgets/WeeklyMultiples.jsx` | The stack of four charts |
| `src/pages/admin/analytics/widgets/MarkersPanel.jsx` | The "What changed" list and note form |
| `src/pages/admin/analytics/views/TodayView.jsx` | Wiring: fetch, reads, notes, tiles, bands |
| `src/pages/admin/AdminAnalyticsTab.jsx`, `src/pages/admin/analytics/AnalyticsFiltersContext.jsx` | Status strip items |
| `src/pages/admin/admin.css` | Styles, appended at the end under "Weekly consistency", "Weekly multiples" and "Markers panel" |
| `src/local/adminFixtures.js` | Preview-harness fixtures and mock RPCs |
| `src/lib/*.test.mjs`, `tests/admin-dashboard.spec.js` | Node tests and Playwright guards |

---

## Data contract

Everything is in migration 0372, one `begin; … commit;`. It is additive: nothing is
dropped, and `admin_kpi_summary` is rewritten with `create or replace` under its existing
signature, so its ACL survives (the grants are restated anyway). A Today build from before
this work keeps working against the migrated database. The migration's header comment is
the authority; this section restates it.

| Object | Signature | Returns |
|---|---|---|
| `_admin_people` | `(p_exclude_internal boolean, p_verified_only boolean)` | `table(user_id uuid, created_at timestamptz)` |
| `admin_weekly_series` | `(p_weeks int default 14, p_exclude_internal boolean default true, p_verified_only boolean default true)` | eleven columns, below |
| `admin_notes` | table | the owner's notes |
| `admin_note_add` | `(p_day date, p_label text, p_kind text default 'note')` | `jsonb`, the new row |
| `admin_note_delete` | `(p_id bigint)` | `boolean` |
| `admin_note_restore` | `(p_id bigint)` | `jsonb`, the same row |
| `admin_markers` | `(p_since date default null)` | `table(day date, kind text, label text, source text, ref_id bigint)` |
| `admin_kpi_summary` | `(p_days integer default 30, p_exclude_internal boolean default true, p_verified_only boolean default true)` | `jsonb`, rewritten in place |

### One population: `_admin_people`

The one population predicate for admin reads. **Verified** is 0149's rule (email
confirmed and signed in at least once), unless `p_verified_only` is false. **Internal** is
0110's rule (`_internal_user_ids()`), unless `p_exclude_internal` is false. It is a
`security definer` helper revoked from `public, anon, authenticated` and granted to
`service_role` only: the definer functions that call it run as its owner and keep access,
and no client role can execute it. Because `admin_weekly_series` and `admin_kpi_summary`
both go through it, a tile's number and its strip count the same people.

### The weekly series: `admin_weekly_series`

One zero-filled row per UTC calendar week, oldest first, the current partial week last.
`p_weeks` is clamped to 2 through 52; Today asks for 14 (thirteen complete weeks and this
week so far). Durable tables only, never `metrics_daily`.

| Column | Meaning |
|---|---|
| `week_start` | The week's Monday (UTC) |
| `complete` | `week_start + 7 <= current_date`: the week has closed |
| `settling` | `week_start + 10 > current_date`: true for the partial week and for the newest complete week during its first three days; the figure may still move |
| `signups` | Accounts created that week, from `_admin_people` |
| `active_users` | Distinct people present (`user_active_day`), joined to `_admin_people`. NULL when unmeasurable |
| `active_measurable` | False for a week that began before `active_floor` |
| `work_users` | Distinct people with `did_work`. NULL when unmeasurable |
| `work_measurable` | False for a week that began before `work_floor` (or when no work was ever recorded) |
| `cards` | Cards created that week, by `card_index.created_at` |
| `active_floor`, `work_floor` | The first day each was ever recorded, on every row |

How the numbers are made:

- **Floors are derived, not hardcoded**: `active_floor` is `min(day)` of
  `user_active_day`, `work_floor` is `min(day)` where `did_work`. They stay true if either
  column is ever backfilled. A week that began before its floor returns **NULL with
  `*_measurable = false`**. NULL means "we were not counting"; 0 means "nobody". The two
  are treated differently everywhere downstream.
- **Cards** leave out cards whose cluster was created by an internal account (the
  `admin_cards_per_day` predicate from 0254) and include cards made on clusters deleted
  since: a card made that week was made that week. The card-count lint carries an explicit
  suppression naming this reason.
- **History can shrink.** A deleted account leaves `auth.users` and takes its
  `user_active_day` rows with it, and a deleted card leaves `card_index`, so a past week
  can read lower later than it did at the time. The weekly well's footer says so.
- **Time zone.** Weeks are bucketed with `at time zone 'utc'`; `current_date` follows the
  session time zone, which on Supabase is UTC.

### The owner's notes

`admin_notes` has `id`, `day`, `label` (1 to 120 characters), `kind` (`ship`, `event` or
`note`), `created_by` (`auth.uid()`), `created_at` and `deleted_at`. A partial index
covers live rows by day. Row-level security is on with no policies, every table grant and
the identity sequence's grants are revoked from `public, anon, authenticated`: the table
is reached only through the RPCs.

- `admin_note_add` validates, raising `22023` on each: the day must be from 2026-01-01 to
  tomorrow, the label 1 to 120 characters once trimmed, the kind one of the three. It
  returns the new row without `deleted_at`.
- `admin_note_delete` is a **soft delete**: it sets `deleted_at` where it was null and
  returns whether a live note was deleted.
- `admin_note_restore` clears `deleted_at` and returns the **same row** (same id), raising
  `22023` when there is nothing to restore. This is what lets the house undo toast bring a
  note back instead of re-adding a copy.

Every one of the three starts with `perform public._require_admin()`.

### Markers: `admin_markers`

One dated list for the charts. `p_since` defaults to 120 days ago. Rows carry
`(day, kind, label, source, ref_id)`.

| Source | Where from | Rule |
|---|---|---|
| `note` | live `admin_notes` | `kind` is the note's kind; `ref_id` is the note id |
| `discovery` | `client_errors` where `kind = 'discovery_pipeline'` | One marker per `name` per **run of consecutive UTC days**, at the run's first day. Label is the name, or `name (n days)` for a longer run. `kind` is `alert`, `ref_id` null. Clamped to 90 days, because `client_errors` is purged after 90; a run that began before that shows only its days since |
| `ops` | `ops_alerts` | One marker per run, at the run's first day, labelled `min(title)` plus ` (n days)` when the run spans more than one day. `kind` is `alert`, `ref_id` null |

The ops rules, each answering a problem found in review:

- **Excluded kinds**: `heartbeat` and `test` (a marker every week), `held_reminder`
  (daily while mail is held), `signups` (the signup spike *is* the signups line, so it
  explains nothing), and `email_health` (every discovery row also raises one, so it would
  twin each discovery marker). The list is a deny-list: any other kind, including ones
  added later such as a detected signup network, becomes a marker, because those are
  legitimate "why" markers.
- **Runs per kind**, except `invariant`, whose seven daily checks share one kind: those
  run per dedupe key, so two different failures stay two markers. No other kind is split
  by key, because account-scoped keys (hold, budget, member) would draw one marker per
  account on the same day.
- **The 2-day bridge.** A stuck invariant re-raises from a daily cron through a 24-hour
  dedupe, so start-time jitter suppresses some days at random. A run therefore continues
  while the next alert day is at most two days after the previous one (a single silent
  day does not split it), and its `n days` is the span from first alert day to last.
  Discovery runs are strictly consecutive, since their 20-hour dedupe re-fires daily.

Release notes and definition breaks are not fetched: they are repo facts, merged in by the
client (see below).

### The headline figures: `admin_kpi_summary`, fixed in place

Same signature, and 0149's body verbatim except for four things, each changed line marked
`-- 0372` (the text test checks it line by line):

1. Every user-population predicate (signups, activated, converted, demo base, weekly
   active) goes through `_admin_people`. Weekly active now carries the verified rule it
   never had.
2. Weekly active is **exactly `p_days` calendar days** in both windows, today included in
   the current one: `day > v_cur_lo::date and day <= v_now::date` for current, and
   `day > v_prev_lo::date and day <= v_cur_lo::date` for previous. It used to be today
   and the seven days before it (eight calendar days) against seven in the previous
   window, whatever `p_days` said. So at Today's `p_days` of 7 the current window shrinks
   from eight days to seven and, with item 1, gains the verified rule; for any other
   `p_days` the windows now scale with it. Today is the only caller.
3. A new `work_users` key in both `current` and `previous`: distinct people with a work
   event in the window. The Did-real-work tile's headline reads it.
4. `cards_created` counts `card_index.created_at`, not `updated_at`, in both windows.

### Grants and proofs

- `_admin_people`: revoked from `public, anon, authenticated`; granted to `service_role`.
- Every `admin_*` function: revoked from `public, anon`; granted to `authenticated,
  service_role`; first statement `_require_admin()`.
- A closing `do $proof$` block (the 0311 habit: a REVOKE reporting success proves
  nothing) asserts all of it with `has_function_privilege`, that each function's
  `prosrc` contains `_require_admin()`, that `anon` and `authenticated` hold no table
  privilege on `admin_notes` and no usage on its sequence, and that `relrowsecurity` is
  true. A wrong grant raises and rolls the migration back.

---

## The consistency read

`weeklyTrend(points, { window = 8, minWeeks = 4, breaks = [], dispersion = 'poisson' })`
in `trendStats.js` scores one metric. It is pure: no React, no DOM, no clock, no
randomness. Its one import is `addDays` from `weeklySeries.js`, which owns the week
calendar.

### Inputs

A `WeekPoint` is `{ week, value, measurable, complete, settling? }`. The adapter
`toWeekPoints(rows, metric)` builds them from `admin_weekly_series` rows, per entry of
`WEEKLY_METRICS`:

| Key | Column | Label | Noise model | Measurable flag |
|---|---|---|---|---|
| `signups` | `signups` | Signups | Poisson | none |
| `active` | `active_users` | Weekly active | Poisson | `active_measurable` |
| `work` | `work_users` | Did real work | Poisson | `work_measurable` |
| `cards` | `cards` | Cards created | MAD (robust) | none |

People vary about as a Poisson count does; cards arrive in bulk imports, so their floor is
robust instead. The adapter never throws: a non-array is `[]`, a row without a real week
is dropped, a value that is not a finite number is a gap (never a zero, never a string),
and an absent flag reads cautiously, so a row that does not say it is complete is never
scored as if it were.

### Constants

| Constant | Value | Meaning |
|---|---|---|
| `DEFAULT_WINDOW` | 8 | Complete calendar weeks scored |
| `MIN_WEEKS` | 4 | Fewer usable weeks reads "Too few weeks" |
| `STEADY_WEEKS` | 6 | Weeks needed before "steady", "uneven" and flat-dominant wording |
| `EXACT_MAX_N` | 12 | The exact rank null is used up to here (untied only) |
| `ALPHA_SOLID` | 0.05 | One-sided, never halved |
| `ALPHA_LEAN` | 0.10 | One-sided |
| `NOISE_K` | 2 | Noise-floor multiplier |
| `MIN_BASE` | 2 | The Poisson floor is never computed from a base below this |
| `SPIKE_K` | 3 | Spike bar, in units of `sqrt(max(level, 1))` |
| `SHIFT_SHARE` | 0.6 | One step carrying this share of the movement is a step change |
| `PLATEAU_N` | 4 | Trailing weeks examined for "rose, then flat" |
| `MIN_DELTA_EVENTS` | 10 | `weekDelta` thin gate; also the "solid" events gate |
| `MIN_ZERO_EVENTS` | 3 | A window total below this reads "Nothing yet" |
| `STEADY_UP_SHARE` | 0.7 | "Steady" needs this share of steps up |
| `Z_90_ONE_SIDED` | 1.644854 | `weekDelta` noise line |

Four weeks is also the smallest window in which even a perfect run of rises can reach the
5% line (1/24 under the exact null; with three weeks the best possible is 1/6).

### Window selection

In order, on the points sorted by week (a point without a real ISO week is dropped):

1. A point that is not `complete` is excluded as `'incomplete'`. The latest such point is
   reported as `thisWeek` for display and is **never scored**.
2. A point that is not `measurable` is excluded as `'unmeasurable'`.
3. **Break cut.** The cut is the latest valid entry of `breaks`. Every week starting
   *before* the cut's Monday is excluded as `'break'`. While fewer than `window` usable
   weeks have accumulated since the cut, the read carries the **caveat**
   `Definition changed {date}; {k} week(s) since`, where the date is the day the change
   happened and `k` counts weeks with a reading on or after the cut. After eight weeks the
   timeline marker alone records it.
4. The window is the last `window` **calendar** weeks ending at the newest remaining
   week. A week with no row, and a week with a null value, are the same gap and stay in
   the calendar. The window opens no earlier than the oldest remaining row, so a short
   series, an unmeasured prefix or a cut shortens it rather than padding it with phantom
   gaps.
5. `window.n` is the count of weeks with a reading and `window.sum` their total.

The result is a `TrendRead`: `window` (`from`, `to`, `n`, `calendarWeeks`, `gaps`, `sum`,
`excluded`), `steps`, `counts`, `streak`, `mk`, `slope`, `spikes`, `thisWeek`, `caveat` and
`verdict` (`code`, `label`, `confidence`, `detail`).

### Steps and the streak

A **step** is one adjacent calendar pair, dated by its newer week: `dir` is the sign of
`to - from` on **exact** values (an exact tie is flat), or `null` when either side is a
gap. The strip is a literal record; the noise judgement belongs to the sentence, not to
the glyphs. Only the newest step can be `settling`, and only when its own week's point
says so. `counts` is `{ up, down, flat, gaps, total }`, where `total` (the `m` in the
labels) is the number of defined steps. `streak` is the run of same-direction steps at the
newest end; a gap as the newest step is `{ dir: 'none', len: 0 }`.

### The rank test

Mann-Kendall asks whether later weeks tend to be higher than earlier ones. It reads only
their **order**, so a viral week counts as one high rank, not as a slope.

- `S` is the sum of `sgn(x_j - x_i)` over all pairs `i < j` of usable values.
- **Exact** only when there are no ties and `n <= 12`: under the untied null `S = N - 2I`
  with `N = n(n-1)/2` and `I` the inversion count, whose distribution is the Mahonian
  numbers. `P(S >= s)` is a sum of those over `n!`. A perfect run is `1/n!` per side
  (1/40320 at eight weeks).
- **Normal** with any tie, or past 12: the tie-corrected variance
  `[n(n-1)(2n+5) - sum over tie groups of t(t-1)(2t+5)] / 18`, a continuity-corrected
  `z = (S - sgn(S)) / sqrt(Var)`, and `Phi` by an erfc approximation accurate to 1.5e-7.
- **Degenerate** when the variance is zero (all equal, or fewer than two values): `p = 1`,
  no direction.
- `p` is the smaller one-sided tail and `dir` is the sign of `S`. The read only ever asks
  "up?" or "down?", so the 5% line is one-sided and is never halved; the tile's hover text
  says so.

### The slope and the noise floor

Theil-Sen is the median of every pairwise slope on the **calendar** week index (a gap
leaves a hole in the index), so one enormous week cannot drag it. `rise` is the slope
times the span from the first to the last reading. A rank test can be certain about a rise
far too small to matter; the floor asks whether the rise is larger than what the two ends
of the window could differ by anyway.

- **Poisson floor, symmetric.** `NOISE_K * sqrt(max(baseline, MIN_BASE) + max(endLevel,
  MIN_BASE))`, where `baseline` is the median of the first `floor(n/2)` readings and
  `endLevel` the median of the last `floor(n/2)`. For counts, `Var(x_end - x_start)` is
  the sum of the two means. A floor read from the start alone is higher for a fall than
  for the same rise (it starts high), which asks a decline for more evidence. On a flat
  series both ends agree and this is exactly `NOISE_K * sqrt(2 * base)`.
- **MAD floor** (cards): `NOISE_K * 1.4826 * MAD` of the week-to-week differences, which
  one bulk import barely moves. It applies only with at least three differences and a
  non-zero MAD; otherwise the Poisson floor is used.
- `clears` is `|rise| >= floor`. `slope` also reports `perWeek`, `pctOfLevelPerWeek`,
  `level` (the median), `baseline`, `endLevel`, `floor` and `floorKind`.

### Confidence

- **solid**: `p <= 0.05`, the rise clears the floor, **and** the window holds at least 10
  events.
- **directional**: `p <= 0.10` but not solid. A significant rank test whose rise sits
  inside the noise, or rests on fewer than 10 events, is directional on purpose.
- **none**: `p > 0.10`.

### Spikes

A **spike** is an *isolated* week: more than `SPIKE_K * sqrt(max(level, 1))` above the
larger of its nearest neighbours that have readings (an endpoint has one). It is judged
against its neighbours and not the median, because the median flags the top of every clean
rise. Spikes are reported in `spikes` and in the verdict's `detail`, **never removed** from
the scoring.

### The verdict

The first match wins. Labels are shown verbatim (the strip's accessible name is the
label), so tests pin every one. `n` is weeks with a reading, `u`, `d`, `f` the up, down
and flat steps, `m` their total, `g` the weeks missing from the window.

| Order | Condition | Code | Label | Confidence |
|---|---|---|---|---|
| 1 | `n < 4` | `too_few` | `Too few weeks ({n} of {minWeeks})` | none |
| 2 | `sum < 3` | `zero` | `Nothing yet ({sum} in {n} weeks)` | none |
| 3 | confidence none | `flat` | `Up this week, flat over {n}` or `Down this week, flat over {n}` when the newest step is outside the noise (`weekDelta` says up or down); else `Flat over {n} weeks` | none |
| 4 | at least 4 defined steps, and one step in the trend's direction carries at least 60% of that direction's movement and is itself outside the noise | `shift_up` or `shift_down` | `Stepped up (week of {MM-DD} carried most of the rise)` or `Stepped down (week of {MM-DD} carried most of the drop)` | solid or directional |
| 5 | `n >= 6`, rising, `S` over the newest 4 readings `<= 0`, and their median at or above the level | `plateau` | `Rose, then flat for 4 weeks` | solid or directional |
| 5 | the mirror, falling | `trough` | `Fell, then flat for 4 weeks` | solid or directional |
| 6 | directional | `leaning_up` or `leaning_down` | `Leaning up, {u} of {m} weeks` or `Leaning down, {d} of {m} weeks` | directional |
| 7 | solid, `g > 0` | `rising` or `falling` | `Up {u} of {m} measured weeks, {g} missing` (`Down {d} …`) | solid |
| 7 | solid, `n >= 6`, `u >= 0.7 m` and `d <= 1` | `rising` or `falling` | `Up {u} of the last {m} weeks, steady` | solid |
| 7 | solid, `n >= 6`, `f > u` | `rising` or `falling` | `Up {u}, flat {f} of the last {m} weeks` | solid |
| 7 | solid, `n >= 6` | `rising` or `falling` | `Up {u} of the last {m} weeks, uneven` | solid |
| 7 | solid, `n` of 4 or 5 | `rising` or `falling` | `Up {u} of the last {m} weeks` | solid |

For a fall the counts swap (`Down {d} …`, with `u` and `d` exchanged in the steady and
flat rules). Where the count is exactly one the sentence says "1 measured week" and the
caveat says "1 week since"; no other label pluralizes.

**`detail`** is a string joined with ` · `, or null. It is null for `too_few` and `zero`.
Otherwise it holds, in order: `one spike week ({week})` or `{k} spike weeks`;
`{sum} events in {n} weeks` when the rank test passed 5% on fewer than 10 events (the
events gate is why the read is not solid); and `newest week still settling` when the
newest step is settling. The `caveat` is separate and never part of `detail`.

### Week-over-week: `weekDelta`

The tiles' single-week comparison gets the same honesty. `weekDelta(cur, prev, { kind })`
is null when either side is not a number.

- `kind: 'count'` (people, cards): if `cur + prev < 10`, **thin** (`dir: 'thin'`, the
  signed absolute change as text, e.g. `+2`; a bare percentage would have said
  "+200%"). If `prev` is 0, **new**. Otherwise `z = (cur - prev) / sqrt(cur + prev)`:
  inside `|z| < 1.645` it is **flat with `noise: true`** and keeps its percentage;
  outside, up or down with the signed rounded percentage. No change at all is flat
  without `noise`.
- `kind: 'exact'` (MRR, a ledger with no sampling noise): the plain sign, no gate, no
  `noise` key; zero to something is "new".

### The settling flag

A week that has just closed can still move. The newest complete week is `settling` for
its first three days, and the partial week always is. The flag travels from the RPC to the
point to the newest step, where it does three things: the strip cell is drawn as an
outline, the cell's title ends " · still settling", and the verdict's detail says "newest
week still settling". It never changes the verdict itself.

### Why a perfectly ordered rise can read "Leaning"

Seven rises in a row is the strongest evidence the rank test can see: eight weeks of
`20, 22, 24 … 34` has an exact `p` of 1/40320. But "steady" also requires the rise to be
larger than week-to-week noise, and for counts that noise grows with the level (the
floor goes with its square root, while a fixed weekly increment does not grow). The same
series has a rise of 14 against a floor of about 14.7 and reads **"Leaning up, 7 of 7
weeks"**. Started from `10`, with the same increments, the floor is about 11.7 and it
reads **"Up 7 of the last 7 weeks, steady"**. This is by design: the same climb is less
convincing on a larger base. The tile's hover text says so ("a perfectly ordered rise
inside the noise reads 'Leaning'") so that nobody promises seven straight rises is always
"steady".

---

## Definition breaks

A weekly trend is a claim that this week is comparable to last week, and the claim is
false across a change in what a counter counts. `adminDefinitionBreaks.js` is the one
place those dates live. It does two jobs: a `cut` entry tells the trend where to stop
scoring, and every entry, cut or not, is a dated marker inside the thirteen-week window
Today shows: the What-changed list lists each one, and a weekly chart draws only those
whose `series` names that chart's column, so a step in a line has its explanation printed
beside it.

| Date | Migration | Series | Cuts | Label |
|---|---|---|---|---|
| 2026-06-01 | 0102 | `metrics_daily` | no | User counts become email-verified only |
| 2026-06-18 | 0149 | `metrics_daily` | no | Verified now means confirmed and signed in |
| 2026-08-17 | 0248 | `work_users` | no | Work tracking starts (did_work) |
| 2026-08-22 | 0254 | `cards` | no | Cards get a creation time (backfilled from first index) |
| 2026-09-04 | 0294 | `events` | no | Crawler and QA rows quarantined from analytics |
| 2026-09-15 | 0327 | `metrics_daily` | no | Money counters become trial-aware |
| 2026-09-17 | 0332 | `metrics_daily` | no | MRR counts active subscriptions only |
| 2026-10-01 | 0347 | `work_users` | **yes** | did_work no longer stamped on no-op re-syncs |

`date` is the day the migration file was first committed, so each entry can be re-derived:
`git log --format=%ad --date=short --diff-filter=A -- supabase/migrations/<file>`.

### Which cut, and why only one

Exactly one entry cuts, and that is a judgement made series by series, not an omission:

- **work_users, 0347.** `did_work` before 0347 was also stamped on no-op re-syncs and
  credited the board creator, so the weeks before it over-count and must not be scored
  against the weeks after it. This is the cut.
- **signups** need none: the verified rule filters on *current* column values, so the
  series is computed the same way for every week back in time.
- **cards** need none: `card_index.created_at` was backfilled from `updated_at`, which
  the client never updates, so it is first-index time throughout, uniform on both sides of
  0254. 0254 is a marker, not a cut.
- **0248** is the work floor. Before it nothing was recorded, so those weeks are
  `unmeasurable` (a hatched band), which is a different thing from a break. SQL returns it
  as `work_floor`.
- The `metrics_daily` and `events` entries describe feeds the weekly series does not read.
  They are markers only.

### From date to cut point

`breaksFor(col, breaks)` turns each cut entry whose `series` lists the column into
`{ week, date, label, migration }`, where `week` is `mondayOnOrAfter(date)`. A Thursday
change cuts at the following Monday, so the week that *contains* the change (which mixes
both definitions) is excluded along with everything before it. The date rides along for
the caveat: the Monday is where the cut falls, not when anything changed. Only a literal
`cut: true` counts and `series` must be a real list (`'cards'.includes('card')` is true,
and a cut firing on a substring would be impossible to find).

### What the owner will see

With the real list, the first week that can be scored after 0347 is the one starting
2026-10-05. The Did-real-work tile reads **"Too few weeks (n of 4)"** with the caveat
"Definition changed 2026-10-01; n weeks since" until four complete weeks exist on or after
that Monday, which is when the week starting 2026-10-26 has closed. The caveat drops after
eight such weeks. Its spark is empty under "Too few weeks" and the proportion bar stands
in, which is true. This is the honesty rule working, not a defect.

### Adding one

Derive the date from git, add the entry, and decide whether the series was uniform across
it. The test requires exactly one cut: "one discontinuity makes weeks incomparable; more
needs a reason written down".

---

## The Today view

### What the view fetches

`TodayView` makes nine RPCs in one `Promise.allSettled`, keyed on the toolbar's
two population flags (`excludeInternal`, `verifiedOnly`) and polled every five minutes and
on focus:

1. `admin_kpi_summary` with `p_days: 7`. **First, and the only call that gates the view**:
   everything else degrades in place.
2. `admin_metrics_history` (60 days), for the MRR spark and its prior value only.
3. `admin_weekly_series` with `p_weeks: 14` and the same two flags, so a tile's number and
   its strip count the same people.
4. `admin_markers` (default 120 days).
5. `admin_active_now`, `admin_user_dormancy`, `admin_list_users`, `admin_universe_stats`,
   `admin_activity_heatmap`: unchanged.

On demand: `admin_note_add`, `admin_note_delete`, `admin_note_restore`. Every call is
`const { data, error } = await supabase.rpc(…)`, never `.catch()` on the builder (it is a
thenable, not a promise).

### The tiles (band 01)

Six hero tiles, left to right: Signups, Weekly active, Did real work, Trials, MRR, Cards
created. Four carry the weekly read (`trend` prop); Trials is unchanged and **MRR has
none**, because 0372 deliberately has no money column, so there is no weekly MRR series to
read.

- **The headline stays the trailing seven days**, from `admin_kpi_summary`. Did real work
  reads `current.work_users`, and is a dash when the key is absent (null, never 0).
- **The strip**: `StreakStrip` draws seven cells (`DEFAULT_WINDOW - 1`), newest right,
  from `streakSlots(trend)`. It is a `role="img"` whose `aria-label` is the verdict label;
  the cells are `aria-hidden`. Under `too_few`, every cell is unmeasured. Otherwise the
  last seven steps map to up, down or flat and are left-padded with unmeasured cells.

  | State | Drawn | Meaning |
  |---|---|---|
  | `up` | `▲`, good colour | The week rose |
  | `down` | `▼`, bad colour | The week fell |
  | `flat` | `·`, ink-2, weight 700 | Exactly equal: a measured "no change" |
  | `gap` | hatched, empty | A week with no reading; a flat dot here would be a measured zero |
  | `unmeasured` | hatched, empty | Nothing was being recorded, or the series is too short to read |

  A settling cell is outlined (a border, not a shadow: forced-colors drops shadows). A
  cell's title is the week and the move, `wk of Sep 15: 12 → 15`, plus " · still
  settling".
- **The sentence** is `.admin-stat-verdict`, two lines reserved so a short verdict does
  not sit a line higher than its neighbour. Its hover title is the caveat, else the
  detail. When a `caveat` exists it prints on a muted line below, with non-breaking
  hyphens so the date never splits across lines.
- **The badge** (week over week) moves to the sub line, **quiet** (neutral ink, glyph
  kept) and named **"vs prior 7d"**, because six hero tiles cannot hold a label, a badge
  and a strip in one head row. `thin` and `noise` both draw `·` with screen-reader words
  ("too few to compare", "flat, within noise") and a hover title.
- **The spark** draws the weeks the strip is eligible to read: complete, measured, and on
  this side of the metric's latest cut, up to thirteen of them, and **nothing under "Too
  few weeks"**, so the picture never says more than the sentence. A tile with a read and
  no spark prints "collecting…" in the slot to keep the rail's height, and the Did-real-work
  tile's proportion bar (work of weekly active) stands in while it has none. Sparks and
  bars are pinned to the tile's foot so the rail lines up across tiles of different
  height.
- **MRR** keeps its badge in the head, with the `exact` kind, and its spark, only when MRR
  is above zero; at zero it draws the reason it is zero.
- **Hover text** on a trended tile states the rule: the strip is one glyph per week,
  newest right; a read of "Steady" means the order of the last eight complete weeks is
  non-random at 5% one-sided *and* the move is larger than week-to-week noise; a
  perfectly ordered rise inside the noise reads "Leaning"; an outlined glyph is still
  settling; hatched is not measured. The window and the threshold are interpolated from
  `DEFAULT_WINDOW` and `ALPHA_SOLID`, so the sentence cannot drift from the code.

### The weekly stack (band 02, left)

`Well span=8`, titled "Weekly, by metric", meta "13 complete weeks + this week so far ·
UTC Monday", footer "History can shrink: deleted accounts and cards leave it."

`WeeklyMultiples` stacks one `AreaChart` per `WEEKLY_METRICS` entry, in that order, each
96px tall with its own y scale: the four series sit an order of magnitude apart, so they
share the x axis and never the y. Rows are keyed by the metric key (`signups`, `active`,
`work`, `cards`); a row's key maps to its column through `COLUMN_OF` (`active` to
`active_users`, `work` to `work_users`), and that column is what a definition break's
`series` lists. Hues follow the metric's family (acquisition, engagement, output), not
four decorative colours.

- **One shared axis.** Each chart omits its own date row; the stack draws one, under the
  plot column, from the same two custom properties the rows are laid out with (first week,
  middle week, "so far"). Charts are told `vLines = n - 1`, so each vertical division is
  one week and the graticule keeps a whole number of minor cells per major.
- **The week so far is a hollow point the line never reaches.** The newest reading is
  excluded from the path, the fill and the called-out last dot, and drawn as a hollow dot
  (plot-ground fill, series-colour ring). A line into a half-counted week would read as a
  collapse every Monday. On hover it stays hollow and the tip says "so far".
- **Unmeasured weeks are hatched.** Runs of weeks flagged not measurable become
  `--adm-hatch` bands (`bandsFromMeasurable`), ending where the line starts; hovering one
  says "not measured yet" rather than "no data". A row with nothing measured in the whole
  window still draws its plot, hatched end to end.
- **A dot per reading** (`markPoints`), and the last complete week keeps its called-out
  dot.
- **Markers.** Each marker is placed with `markerIndex(day, weeks)`: a seventh of a column
  per day past its Monday, and any day in the last (partial) week is clamped to the right
  rule with `edge`. A marker is a dashed HTML rule inside the plot, a different class from
  the graticule's verticals (a guard counts those), and never inside the SVG.
  - **Scope per row** (`markersForColumn`): a marker with no `series` (a note, an alert, a
    release) is about the product and is drawn on every chart; a break is drawn only on
    the charts whose column its `series` names. 0248 and 0347 land on Did real work, 0254
    on Cards created, and the `metrics_daily` and `events` breaks are drawn on none; the
    list beside the stack still carries them.
  - **The glyph is drawn once**, on the first row that draws the marker, in a shared map:
    `◆` ship, `◇` changelog, `●` event and note, `△` alert, `║` break. Unknown kinds draw
    `●`. All are neutral ink; kinds are told apart by shape. The hover tip leads each
    marker line with its glyph, so a row without glyphs still says the kind.
  - **Hover** lists the markers nearest the crosshair's point, matched the way the
    crosshair snaps (`Math.round` of the pinned index), so a Sunday release note is
    listed under the Monday the crosshair stands on.
  - A screen reader gets one `sr-only` list of the drawn markers, once each:
    "Marker, {day}, {kind}: {label}".
- With fewer than two weeks or no series, the stack says "Nothing to plot yet" once.

`AreaChart` gained these as optional props (`markers`, `markerGlyphs`, `markPoints`,
`partialLast`, `bands`, `axis`); every default renders the same markup as before, so no
other chart changed. A marker's own boolean `glyph` overrides `markerGlyphs`; the stack
uses that to put the glyph on the first row only.

### What changed (band 02, right)

`Plate span=4`, class `adm-markers`, titled "What changed", meta "{n} marker(s) in 13 wk".
At 1400px and narrower the charts take the whole row and the plate drops beneath them at
full width.

**The list.** `mergeMarkers` merges three inputs into one list, sorted by day, then
source, then label, inside the stack's window (from its first week to today in UTC):

- `admin_markers` rows: the owner's notes and the pipeline and ops alerts;
- the generated changelog (`CHANGELOG_ENTRIES`), as `changelog` markers linking to
  `/changelog#{anchor}` in a new tab;
- the definition breaks inside the window, as `break` markers showing their migration
  number muted.

The list shows newest first, every marker, in a box that scrolls past 440px rather than
stopping (a note's remove button lives on its row, so an old note must stay reachable).
Each row has the glyph (`aria-hidden`), a screen-reader word for the kind, `MM-DD`, and the
label. Only the owner's own notes carry a remove button; a changelog entry, a break and an
alert are facts this panel did not write.

**The form.** "Add a dated note": a date field (the viewer's calendar, so a "UTC day" hint
describes it and the note lands on a UTC day; `min` is the first week on the chart, `max`
is today), a "today" button, a kind select (note, ship, event), a label (up to 120
characters), and Add. Enter submits. The label clears and focus returns to it only on
success, so a typo costs one edit; a double Enter cannot send twice. The form lays itself
out by its own width (two rows below 560px, one above), not the window's.

**Add, remove, undo.** All writes are RPCs; the note list is local state so a change shows
at once.

- *Add* inserts the returned row. An error or an empty answer shows an error toast
  ("Note not added", with the message) and keeps what was typed.
- *Remove* takes the note off the list at once, then calls `admin_note_delete`.
  - On success: an undo toast "Note removed · {label}" with an **Undo** button. Undo
    calls `admin_note_restore` and puts back the **same row**, id and all; if the restore
    fails it says "Undo failed".
  - On `false` (no live note had that id, because another tab or admin removed it first):
    the note stays off the list, an info toast says "Already removed", and there is
    nothing to undo.
  - On an error: the note comes back and an error toast says "Note not removed".
  - A keyboard press on the remove button first moves focus to the label field, so focus
    never falls to the page when the row unmounts; a pointer click does not, since that
    scrolled the page and opened the soft keyboard on tablets.
- *Busy* is a counter of requests in flight (an undo can land while an add is out); it
  disables Add and every remove button.

**The poll-overlap guard.** A refresh that began before a change was answered can come
back without it and land after it, winding the change back for a poll interval. So every
answered change is also kept in a `pending` list and replayed over each fetched list,
until a list from a read that *began after the change was answered* has been seeded.
Every change is idempotent, so replaying one the list already shows is free. A read whose
markers call failed re-seeds nothing.

### The status strip

On Today the strip reads `WINDOW 7d · 13 wk UTC · {k} of 7 days`, where `k` is the days
of this UTC week so far (Monday is 1), and gains `WEEKS {n} complete` when the weekly read
succeeded. The view registers its calendar with the shell through
`useRegisterViewRuntime`, whose effect is keyed on the two primitives (`weeks`,
`partialDays`) and never on the object: a literal in a dependency array hands over a new
object every render and loops the provider. The strip reads the registered status on Today
only, since for one render after a view switch the previous view's runtime is still the
registered one.

### Palette and accessibility

- **Colour never works alone.** `▲ ▼ ·` carry direction in shape; good and bad are about
  1.6 apart in OKLab under deuteranopia in the dark theme and about 1.0 in the light, so
  a red and green pair alone would fail a large minority of readers.
  `chartPalette.test.mjs` asserts this stays true and reads the first `.adm-well {` block
  of `admin.css`, so new rules are only ever appended at the end of the file.
- **Markers are neutral ink and told apart by shape.** The palette has no hue to spare.
  Date, migration tag and hint text use `--ink-2`, not `--ink-3`, for contrast.
- **One hatch for "not measured"**: the `--adm-hatch` token, shared by the strip, the
  chart bands and the cohort matrix. It is declared for dark and light and re-declared
  inside `.adm-well`, because a well is the same near-black in both themes and a custom
  property resolves where it is declared. Every consumer sits in a well today, so the
  light override is a harmless fallback.
- **No gold anywhere in the new marks**, enforced by a guard over the strip's glyphs, the
  marker rules and glyphs, the points and the bands.
- **No CSS `content:`** in any of it. Glyphs are real text or SVG, and a guard checks that
  ornament never enters an accessible name.
- **Names and descriptions**: the strip is an image named by the verdict; badges carry
  screen-reader words; each list row says its kind; the remove button is "Remove note:
  {label}"; the form is "Add a dated note"; the date field is described by its "UTC day"
  hint.

### When a read fails

A failed secondary read says nothing rather than something false. If
`admin_weekly_series` fails, `weekly` stays `null` (not `[]`): the four tiles render with
no strip, no verdict, no spark and no hover rule, with their badge back in the head; no
`WEEKS` item appears, and the stack says "Nothing to plot yet". It never prints "Too few
weeks (0 of 4)" or "0 complete". If `admin_markers` fails, the notes keep the list they
have and the alerts are empty. Only `admin_kpi_summary` takes the view down.

---

## Harness and tests

### The preview harness

`?adminpreview=1` mounts the admin dashboard against `local/adminFixtures.js`, a mock
Supabase shim that exists only in DEV. The weekly fixtures follow these rules:

- **Every date is relative to this week's UTC Monday.** `weekStarts(n)` counts back from
  it (correct on a Sunday, which belongs to the previous Monday). It is written out in the
  fixture on purpose rather than borrowed from `weeklySeries.js`: a fixture that shares its
  calendar with the code under test agrees with that code's bugs. The node test computes
  the Monday a third way.
- **Structural states, not accidents.** Fourteen rows (thirteen complete, then the week so
  far). Signups rise with exactly one down week; weekly active rises every week; cards are
  noisy and flat in the hundreds; `work_users` is NULL with `work_measurable` false for
  the first nine rows (production's state, since `did_work` arrived with 0248 and was never
  backfilled). The last row is `complete: false`; the last two are `settling`. The resulting
  verdicts are Signups "Up 6 of the last 7 weeks, steady", Weekly active "Up 7 of the last
  7 weeks, steady", Did real work "Too few weeks (3 of 4)", Cards "Flat over 8 weeks". The
  headline figures are on the same scale as the series.
- **`HARNESS_BREAKS`** is `DEFINITION_BREAKS` with its one cut moved to the day after the
  harness's work floor, so the cut lands on the Monday after (row 10). That always leaves
  three complete measurable weeks, one short of the four the read needs, so the work tile
  says "Too few weeks (3 of 4)" on any day the harness is opened. The other seven entries
  keep their real dates: they are markers, not cuts. The module is imported dynamically
  inside `import.meta.env.DEV && isAdminPreviewMode()`, so the fixtures never reach a
  production chunk; until it arrives, the work tile briefly reads against the real list.
- **URL switches**, DEV only: `?weeks=N` keeps the last N complete rows plus the partial
  row (`?weeks=3` puts every tile under four weeks; `?weeks=0` leaves only the partial
  row, and the stack must tolerate a one-row series); `?breaks=0` scores every series
  straight through its cuts (the work tile then reads "Leaning up, 3 of 3 weeks", an
  ordered rise inside the noise); `?mrr=0` is the existing zero-revenue switch.
- **Notes behave like the real ones.** Mutable `NOTES` (a `ship` note exactly on the
  fourth week's Monday, the position anchor for a guard; an `event`; a `note`), a
  `DELETED_NOTES` map so an undo restores the same row, ids that are never reused, and
  alerts as two discovery markers and one ops marker at relative days. `admin_note_add`
  refuses a bad day format, label length or kind with no row; delete returns true then
  false; restore returns the same row, or null when there is nothing to restore.
- **`window.__admRpcCalls`** tallies every RPC by name, so a guard can prove a call was
  made rather than infer it.

### Node tests

`cd boards && npm test` (`node --test src/lib/*.test.mjs`). Tests import `.js` modules,
never `.jsx`.

- **`trendStats.test.mjs`**: the exact tail against known Mahonian sums; `normalCdf`;
  Mann-Kendall (exact, tied, degenerate, reversal and constant-shift invariance, exact
  against normal at n = 12); Theil-Sen on calendar weeks with holes; every `weekDelta`
  case; window selection, caveat lifetime, gaps and the oldest edge; the Poisson and MAD
  floors; isolated spikes; the plan's 25 vectors with the tied ones derived by hand in a
  comment above each assertion; every label the tree can print; mirror properties over 300
  seeded series; junk in is "Too few weeks" out. Two vectors come as pairs (an amended case
  that reaches the intended sentence, and the original kept as a pinned "Leaning" case).
- **`weeklySeries.test.mjs`**: the UTC calendar in several time zones and across daylight
  saving; `toWeekPoints`; `breaksFor`; `markerIndex`; `bandsFromMeasurable`;
  `markersForColumn`; `markersAtHover`; `mergeMarkers`; `weekLabel`; `streakSlots`.
- **`adminDefinitionBreaks.test.mjs`**: real ISO days strictly ascending, four-digit
  migration ids, known series names, exactly one cut and it is 0347 for `work_users`,
  labels of at most 80 characters.
- **`weeklySeriesMigration.test.mjs`**: a text test over the SQL, in the style of the other
  migration tests: the latest definition of each function is 0372, `_require_admin()` is
  the first statement of every `admin_*` body, grants and revokes, the proof names every
  signature, RLS and the sequence, no `drop`, the eleven columns in order against the
  client adapter, the durable-tables-only rule, the line-by-line diff of `admin_kpi_summary`
  against 0149, the marker collapse rules scoped to their own CTEs, and that nothing
  0322, 0347, 0361, 0363 or 0365 defines is re-created.
- **`adminFixtures.test.mjs`**: the harness's own promises, by name: fourteen Mondays a
  week apart ending with this one; NULL exactly where a week is unmeasurable; settling on
  exactly the last two rows and incomplete on the last only; the ship note on the fourth
  Monday; the harness cut leaving three weeks; `?weeks=3` semantics through a stubbed
  `window`; and the add, delete (true then false) and restore round trip. A drifting
  fixture otherwise fails three layers up, in a browser, as a marker "in the wrong place".

### Playwright guards

`cd boards && PW_PORT=5181 npx playwright test tests/admin-dashboard.spec.js
--project=desktop-chrome`. `PW_PORT` is mandatory when another working tree may own the
default port. Playwright starts its own server with the config's fake `VITE_SUPABASE_*`
values when none is listening; a server started by hand needs the same values, because the
worktree has a real `.env.local` and a reused server would otherwise hit real credentials.
The existing "the page refreshes itself" test is a known failure that predates this work
(it waits 60 seconds on a 300-second poll).

All run against `?adminpreview=1&tab=overview&view=today`. Where the Today tests read
theme-tokened CSS they run in both themes.

| Guard | The promise it protects |
|---|---|
| `under four complete weeks every tile says too few, not a verdict` (`?weeks=3`) | All four trended tiles read "Too few weeks"; no strip cell is up, down or flat; every slot is unmeasured; each strip's accessible name is that sentence |
| `the streak strip is seven glyphs and one sentence` | The Signups strip has seven cells and exactly one verdict; the strip's name equals the sentence; at least two strips carry a sustained read |
| `an unmeasured week never gets a direction` | In Did real work, both by default and scored (`?breaks=0`), each unmeasured cell is empty, hatched and not up or down; under `?breaks=0` the hatched cells also all come before the first directed one |
| `markers land on their week, on every chart` | The ship note sits at 3/13 of each plot's width (within half a percent, tighter than one day), as a direct child of the plot and not a graticule rule, with its glyph on the first chart only |
| `the partial week is hollow and not joined` | The newest point on each chart is the only hollow one, sits at the right rule, has a ring and a plot-ground fill, and neither the line nor the fill reaches the right edge |
| `the note form adds a marker, and removing it offers undo` | Enter adds one list row and four chart markers and calls `admin_note_add` once; remove shows the "Note removed" toast with Undo; Undo restores the same note by calling `admin_note_restore`, not a second `admin_note_add` |
| `the thirteen-week well is on the first screen` | At 1440x900 the weekly charts start above the fold |
| `the weekly series is fetched with the toolbar's population` | Flipping INTERNAL re-reads `admin_weekly_series` |
| `hero tiles never overflow sideways` | At 1280x800 and 1440x900 no hero tile is wider than its box |
| `four stacked charts share one axis` | Exactly one shared date row, none of the charts' own, and every plot's edges within 2px of it |

Two existing guards were updated: **"no chart paints itself in the reserved accent"** now
covers the strip's glyphs, the marker rules and glyphs, the points and the bands, and reads
`backgroundColor`, `stroke`, `color`, `borderLeftColor` and `borderColor`, because a glyph
is painted in `color`, a marker rule is its dashed left border and the hollow point is all
border (read only fill and stroke and any of those could turn gold unnoticed); and
**"Today packs the first screen"** counts `.adm-well, .adm-plate, .admin-stat-card` with a
floor of 9 at 1440x900, since one well and one plate now do what four wells did.

**The date rule.** No admin-dashboard test may depend on the real date; fixtures are
relative to this week's Monday. Markers are therefore counted **by kind** (`.is-note`,
`.is-ship`), never in total, because breaks and changelog entries keep their real dates
and move in and out of the window with the calendar. A test that reads the work tile waits
for "Too few weeks (3 of 4)" first, because until the harness's break list arrives that
tile is cut at the real list and what it shows depends on the day.

**Fail-when-broken.** A guard added here must be seen to fail with the thing it protects
broken before it is trusted to pass; one that cannot fail is not a guard. Each guard above
was run against a mutation of the code it protects (a strip that emits "up" under too few
weeks, a dropped hatch, a marker index shifted by a day, an undo that re-adds instead of
restoring, a gold marker) and went red with a message naming the broken promise, and each
fixture promise in the node test the same way. The one mutation that correctly stays green
is the light-theme hatch override, which no element reaches today.

### Release checks

- `cd boards && npm test` (includes the docs-surface test) and `npm run docs:check`, which
  must be a no-op for this work.
- A production build with `boards/.env.local` present (without it the signed-in app is
  dead-code-eliminated and the build only works logged out): the `AppShell` chunk is
  roughly its usual size, the admin chunk contains "Too few weeks", and no chunk contains a
  harness string such as `HARNESS_BREAKS`.

---

## Deliberately not done, and follow-ups

### Not done, on purpose

- **No visits column.** `_admin_visits` is cohort-scoped and scans `analytics_events`,
  whose crawler rows before 0294 cannot be identified. Distinct people present is the
  durable stand-in.
- **No trials or MRR column, and so no weekly MRR read.** Subscription status is rewritten
  in place, so its history cannot be recomputed; `metrics_daily` stays the money series,
  breaks and all. A weekly money read needs a weekly money series first.
- **Break dates are not data.** They are facts about this repo's migrations and live in
  the client; only the two floors are data.
- **No `DROP` of anything**, including the RPCs Today stopped calling.
- **No weekly scoring of the week so far.** It is drawn, hollow, and never read.
- **Notes can be added and removed, not edited.** The kind set is closed (ship, event,
  note).

### Where the plan was superseded

The plan stays in the repo as written. These are the places review changed it:

- The noise floor is symmetric across both ends of the window; the plan's started from the
  baseline alone and asked falls for more evidence than rises.
- A spike is an isolated week against its neighbours, not a week above the median.
- The caveat prints the day the change happened (not the cut Monday), says "1 week since",
  and drops after a full window; "{g} missing" counts missing weeks, not gap steps.
- Two test vectors were replaced (the originals could not reach their sentences under the
  plan's own formulas) and the originals were kept as "Leaning" cases.
- The alert glyph is `△` and the break glyph is `║` (the warning-sign glyph is not in the
  mono font, and its fallback read as a "4"; a dashed bar vanished into the dashed rule it
  sat on).
- The markers list has no 12-row cap; it scrolls, so every note stays removable.
- Ops markers are runs with the 2-day bridge, split by key for invariants only, with
  `email_health` also excluded and discovery clamped to 90 days. The plan had one marker
  per day and kind.
- Markers are scoped per chart row, with the glyph on the first row that draws one, and the
  hover tip matches the crosshair's snapped point.
- Tile sparks draw only eligible weeks and nothing under "Too few weeks"; MRR gets no
  trend at all.
- Note state has the poll-overlap guard, "Already removed" for a delete that found
  nothing, and failed reads stay `null`.

### Follow-ups found in review and left open

**Reading and wording**

- Gap-heavy series can print awkward counts: "Leaning up, 1 of 1 weeks", "Up 0 of 0
  measured weeks, 3 missing".
- The tile's hover text defines "Steady" by the solid test; the sentence "steady"
  additionally needs at least 70% of steps up and at most one down.
- Plateau and trough are not reversal-symmetric, and the plateau level condition is never
  decisive on its own.
- The MAD floor uses only calendar-adjacent differences, and spike neighbours skip gaps.
- `thisWeek`, `streak`, `pctOfLevelPerWeek` and the `mk` and `slope` details are part of
  the read's contract and its tests, but no view consumes them yet.
- `weekDelta(0, 0)` reads "· +0"; `kind: 'exact'` with a negative base mislabels the
  direction (a ledger like MRR is never negative).

**Charts and markers**

- On a busy window the dashed rules are dense, and the hollow ring draws 1px wide in
  Chromium at 1x.
- A tip can run past the right rule on plots narrower than about 680px, and a week with
  several markers grows its tip over the next chart.
- A failed `admin_markers` read drops the alerts silently while notes persist, and
  "Nothing to plot yet" does not distinguish a failed weekly read from an empty one.
- `markerIndex` checks only the ends of the axis, not holes in the middle; `mergeMarkers`
  does not guard a null options argument or rows lacking kind, label or source, and shares
  a break's `series` array with its input.
- `AreaChart`'s `markerGlyphs` prop has no caller (the stack uses per-marker `glyph`).

**Panel and layout**

- On a wide window (measured at 1440px) the markers plate overhangs the well by about 45px.
- At 1400px and narrower the remove button sits far from its label on the full-width
  plate, with no row hover; the date column's 128px is unmeasured on touch devices.
- A held Enter on a remove button can submit a half-typed note (it is undoable), and the
  focus glow clips at the list's 2px padding.

**Data**

- `admin_kpi_summary`'s weekly-active CTE still scans all of `user_active_day`, as 0149
  did; a day bound would be safe.
- A multi-account ops run is labelled by its alphabetically first title.
- The migration text test's group-by patterns are unanchored at the end, and the
  distinct, the since-floor and the UTC cast in the ops-days CTE are not guarded; the
  exclusion pattern pins the order of the five kinds.

**Tests and harness**

- The gold guard misses the `backgroundImage` channel and `rgba(255, 165, 0, …)` values.
- The population guard proves a re-fetch, not its parameters (the harness tallies counts
  only); the first-screen guard's proxy (`.adm-stack` above 900px) is weak; the partial-week
  guard's fill check has no existence guard.
- In the harness the stack's break markers use the real list while the tiles cut on
  `HARNESS_BREAKS`, and the header comment above the weekly fixtures says every date is
  relative while seven break entries keep real dates (production is unaffected). The
  fixtures' `admin_note_add` mock checks the day's format but not its window (2026-01-01
  to tomorrow) or that it is a real day (it accepts 2026-02-30).
