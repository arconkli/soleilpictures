# Signup Country Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture each visitor's country server-side from Cloudflare's `cf-ipcountry` header so signups — and the whole funnel — can be sliced by geography.

**Architecture:** Supabase's API edge is Cloudflare, and it forwards `cf-ipcountry` into PostgREST's request context. A SQL helper reads it, a column default stamps it onto every analytics event, and two `profiles` columns record signup country (once) and last-seen country (on heartbeat). Admin RPCs and a widget read it back. No client code is needed to *capture* country — only to *display* it.

**Tech Stack:** Postgres/PostgREST (Supabase project `ehlhlmbpwwalmeisvmdp`), React + Vite, plain-Node ESM unit tests.

**Spec:** `docs/superpowers/specs/2026-08-04-signup-country-tracking-design.md`

## Global Constraints

- **Work directly on `main`.** No feature branches in this repo. Push immediately after every commit.
- **A concurrent session holds uncommitted work** in `boards/src/App.jsx`, `boards/src/lib/analyticsEvents.js`, `boards/src/components/OnboardingCoachmark.jsx`, `boards/src/components/UpgradeChip.jsx`, `boards/src/lib/localMode.js`, `boards/src/lib/onboardingStarter.js`, and several `boards/tests/*.spec.js`. **Never `git add -A` or `git commit -a`.** Always `git add <explicit paths>` then verify with `git diff --cached --name-only` before committing. Never `git stash pop`.
- **Migrations:** apply via the Supabase MCP (`mcp__supabase__apply_migration`), not the local `supabase` CLI — the local CLI is linked to the wrong account. Every migration is also committed as a file under `supabase/migrations/`.
- **Migration ordinals are contended.** Two migrations were applied on 2026-08-04 already, and the concurrent session may add more. Immediately before applying, re-check `ls supabase/migrations/ | tail -3` and take the next free ordinal. This plan says 0202/0203; use whatever is actually free.
- **Migration drift is real.** Before re-creating any existing function, fetch its *live* definition with `pg_get_functiondef` and patch that — never assume the migration file on disk matches production.
- **Never put business metrics in commit messages.** This repo is public.
- Country values are ISO 3166-1 alpha-2, uppercase. The string `'unknown'` (lowercase, 7 chars) is the SQL-side sentinel for "no country"; it is deliberately not a valid 2-letter code, so client helpers reject it and render it as Unknown.

---

## File Structure

| File | Responsibility |
|---|---|
| `boards/src/lib/countries.js` (create) | Pure ISO-code → display name / flag helpers. No table — delegates to `Intl.DisplayNames`. |
| `boards/src/lib/countries.test.mjs` (create) | Node unit test for the above. |
| `supabase/migrations/0202_country_capture.sql` (create) | **Write path:** `request_country()`, the columns, and the two stamps. Ships first so data starts accruing while the read path is built. |
| `supabase/migrations/0203_admin_geo.sql` (create) | **Read path:** `admin_geo_breakdown`, plus `geo` on `admin_user_detail` and `country` on `admin_list_users`. |
| `boards/src/pages/admin/analytics/widgets/GeoBreakdown.jsx` (create) | Traffic-by-country and signups-by-country tables. |
| `boards/src/pages/admin/analytics/views/AcquisitionView.jsx` (modify) | Fetch `admin_geo_breakdown`, render `<GeoBreakdown>`. |
| `boards/src/pages/admin/AdminUserDetail.jsx` (modify) | Country rows in the Engagement section. |
| `boards/src/pages/admin/AdminUserList.jsx` (modify) | Flag + code on each user row. |
| `boards/src/auth/legalContent.js` (modify) | One clause added to the existing usage-data disclosure. |

---

### Task 1: `countries.js` — code → name and flag

Pure, dependency-free, and used by every later UI task. Build it first so the display layer has a stable interface.

**Files:**
- Create: `boards/src/lib/countries.js`
- Test: `boards/src/lib/countries.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `normalizeCountry(code: unknown) => string | null` — uppercased 2-letter code, or null.
  - `countryName(code: unknown) => string` — e.g. `'United States'`; `'Unknown'` for anything not a well-formed code.
  - `countryFlag(code: unknown) => string` — e.g. `'🇺🇸'`; `'🌐'` for anything not a well-formed code.

- [ ] **Step 1: Write the failing test**

Create `boards/src/lib/countries.test.mjs`:

```js
// countries.test.mjs
//
// Unit test for the country display helpers. Run with:
//   cd boards && node src/lib/countries.test.mjs
//
// Plain Node ESM, no test framework — exit code 0 on pass, non-zero on failure
// (matches demoCardCap.test.mjs / op_classifier.test.mjs). Pure helpers, so no
// backend, no DOM.

import { normalizeCountry, countryName, countryFlag } from './countries.js';

let failed = 0;
let passed = 0;
function assertEq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    console.error(`FAIL: ${msg}\n  expected: ${b}\n  actual:   ${a}`);
    failed++;
  } else {
    passed++;
  }
}

// normalizeCountry — the gate every other helper runs through.
assertEq(normalizeCountry('US'), 'US', 'passes a well-formed code through');
assertEq(normalizeCountry('us'), 'US', 'uppercases');
assertEq(normalizeCountry('  gb  '), 'GB', 'trims surrounding whitespace');
assertEq(normalizeCountry('unknown'), null, "rejects the SQL 'unknown' sentinel");
assertEq(normalizeCountry('USA'), null, 'rejects 3-letter codes');
assertEq(normalizeCountry('U1'), null, 'rejects codes containing digits');
assertEq(normalizeCountry(''), null, 'rejects the empty string');
assertEq(normalizeCountry(null), null, 'rejects null');
assertEq(normalizeCountry(undefined), null, 'rejects undefined');
assertEq(normalizeCountry(42), null, 'rejects non-strings');

// countryName — total: always a renderable string, never a throw.
assertEq(countryName('US'), 'United States', 'names a country');
assertEq(countryName('gb'), 'United Kingdom', 'names a country case-insensitively');
assertEq(countryName('unknown'), 'Unknown', "renders the SQL sentinel as 'Unknown'");
assertEq(countryName(null), 'Unknown', "renders null as 'Unknown'");
assertEq(countryName(''), 'Unknown', "renders the empty string as 'Unknown'");

// countryFlag — regional-indicator math, with a globe for anything unusable.
assertEq(countryFlag('US'), '🇺🇸', 'builds a flag from a code');
assertEq(countryFlag('us'), '🇺🇸', 'builds a flag case-insensitively');
assertEq(countryFlag('unknown'), '🌐', 'falls back to a globe for the sentinel');
assertEq(countryFlag(null), '🌐', 'falls back to a globe for null');

console.log(`countries.test.mjs — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd boards && node src/lib/countries.test.mjs
```

Expected: FAIL — `Cannot find module .../src/lib/countries.js`.

- [ ] **Step 3: Write the implementation**

Create `boards/src/lib/countries.js`:

```js
// countries.js — ISO 3166-1 alpha-2 code → display name and flag emoji.
//
// No lookup table: Intl.DisplayNames ships the ~250-entry country list in the
// platform, so we don't carry one. Both helpers are TOTAL — any input that
// isn't a well-formed 2-letter code returns a safe fallback instead of
// throwing, because these render inside admin tables where one malformed row
// must not blank the whole panel.
//
// The DB stores uppercase alpha-2 and uses the lowercase string 'unknown' as
// its no-country sentinel; 'unknown' is 7 characters, so normalizeCountry
// rejects it and it renders as "Unknown" like any other missing value.

const UNKNOWN_NAME = 'Unknown';
const UNKNOWN_FLAG = '🌐';
const FLAG_OFFSET = 0x1f1e6 - 'A'.charCodeAt(0);   // 'A' → REGIONAL INDICATOR SYMBOL LETTER A

// Built once and cached — constructing Intl.DisplayNames per row is measurably
// slow in a long list. `null` marks an environment without it (we then fall
// back to the raw code, which is still readable).
let displayNames;
function getDisplayNames() {
  if (displayNames !== undefined) return displayNames;
  try { displayNames = new Intl.DisplayNames(['en'], { type: 'region' }); }
  catch (_) { displayNames = null; }
  return displayNames;
}

export function normalizeCountry(code) {
  if (typeof code !== 'string') return null;
  const cc = code.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(cc) ? cc : null;
}

export function countryName(code) {
  const cc = normalizeCountry(code);
  if (!cc) return UNKNOWN_NAME;
  try { return getDisplayNames()?.of(cc) || cc; }
  catch (_) { return cc; }
}

export function countryFlag(code) {
  const cc = normalizeCountry(code);
  if (!cc) return UNKNOWN_FLAG;
  return String.fromCodePoint(...[...cc].map((c) => c.charCodeAt(0) + FLAG_OFFSET));
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd boards && node src/lib/countries.test.mjs
```

Expected: `countries.test.mjs — 19 passed, 0 failed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add boards/src/lib/countries.js boards/src/lib/countries.test.mjs
git diff --cached --name-only    # MUST list exactly those two files
git commit -m "Country display helpers: ISO code → name + flag, no lookup table"
git push
```

---

### Task 2: Migration 0202 — capture country server-side

The write path. Once this is applied, country starts accruing immediately — before any UI exists to read it.

**Files:**
- Create: `supabase/migrations/0202_country_capture.sql`

**Interfaces:**
- Produces:
  - `public.request_country() → text` — uppercase alpha-2 or `null`.
  - `public.analytics_events.country text` — defaulted, never client-writable.
  - `public.profiles.signup_country text`, `public.profiles.country text`.

**The one way this task can break production:** `request_country()` is evaluated as a **column default** by `anon` and `authenticated` on every event insert. If those roles lack `EXECUTE` on it, **every analytics insert starts failing**. The `grant execute ... to anon, authenticated` line below is load-bearing, and Step 3 exists specifically to prove it.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/0202_country_capture.sql`:

```sql
-- 0202_country_capture.sql
--
-- Capture visitor country server-side, from Cloudflare's cf-ipcountry header.
--
-- Supabase's API edge is Cloudflare, and it forwards cf-ipcountry into
-- PostgREST's request context, so `current_setting('request.headers')` carries
-- it on every client call — supabase-js inserts, the keepalive-fetch beacon and
-- the sendBeacon fallback alike. That makes country a SERVER-side fact: the
-- client never sends it and cannot forge it.
--
-- What this canNOT do: ensure_profile_for_new_user fires on auth.users inside
-- GoTrue's own database connection, which never sets request.headers. Country
-- is therefore unavailable at the instant of signup and is instead stamped on
-- the first PostgREST call the new user makes — same session, same IP, seconds
-- later. See set_first_source below.
--
-- Forward-only, permanently: auth.audit_log_entries retains no IP addresses, so
-- no historical country is recoverable for existing accounts by any means.

------------------------------------------------------------------
-- 1. request_country() — the one place the header is parsed.
------------------------------------------------------------------
-- STABLE, not IMMUTABLE: it reads session state.
-- The exception block is mandatory. This runs as a column DEFAULT, so any
-- context without a well-formed request.headers GUC — pg_cron, GoTrue
-- triggers, direct psql, the SQL editor — must yield NULL, never raise.
create or replace function public.request_country()
returns text
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_raw text;
  v_cc  text;
begin
  begin
    v_raw := current_setting('request.headers', true);
    if v_raw is null or v_raw = '' then return null; end if;
    v_cc := upper(nullif(trim((v_raw::jsonb) ->> 'cf-ipcountry'), ''));
  exception when others then
    return null;
  end;
  if v_cc is null or v_cc !~ '^[A-Z]{2}$' then return null; end if;
  -- Cloudflare's placeholders: XX = could not determine, T1 = Tor exit node.
  if v_cc in ('XX', 'T1') then return null; end if;
  return v_cc;
end $function$;

-- LOAD-BEARING: anon/authenticated evaluate this as the analytics_events
-- column default. Without EXECUTE, every event insert fails.
revoke all on function public.request_country() from public;
grant execute on function public.request_country() to anon, authenticated, service_role;

------------------------------------------------------------------
-- 2. analytics_events.country — stamped by default, never by the client.
------------------------------------------------------------------
alter table public.analytics_events add column if not exists country text;
alter table public.analytics_events alter column country set default public.request_country();

-- NOTE: `country` is deliberately NOT added to the column-level INSERT grant.
-- This table's INSERT privilege is already scoped to
-- (id, session_id, user_id, event, props, path, occurred_at) for anon and
-- authenticated, so a client cannot supply a country. Column defaults are
-- applied by the system and need no column privilege, so the default still
-- fires. DO NOT grant INSERT on this column — that would make it forgeable.

-- No index. At ~17k events/30d and 27MB the existing occurred_at index carries
-- the admin queries; revisit if the table grows an order of magnitude.

------------------------------------------------------------------
-- 3. profiles.signup_country / profiles.country
------------------------------------------------------------------
-- signup_country = where they were when they signed up (written once).
-- country        = where they were most recently seen (refreshed on heartbeat).
-- Two columns because they answer two different questions, and conflating them
-- would silently relabel a returning user's current country as their origin.
alter table public.profiles add column if not exists signup_country text;
alter table public.profiles add column if not exists country        text;

------------------------------------------------------------------
-- 4. set_first_source — stamp signup_country on first sign-in.
------------------------------------------------------------------
-- The country stamp sits BEFORE the first_source guard and is independent of
-- it: a user whose client sent an empty first_source still gets a country.
-- signup_country uses coalesce() so it is written exactly once, ever, even
-- though the surrounding UPDATE re-runs whenever `country` changes.
create or replace function public.set_first_source(p_source jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_cc  text;
begin
  if v_uid is null then return; end if;

  v_cc := public.request_country();
  if v_cc is not null then
    update public.profiles
       set signup_country = coalesce(signup_country, v_cc),
           country        = v_cc
     where user_id = v_uid
       and (signup_country is null or country is distinct from v_cc);
  end if;

  if p_source is null or p_source = '{}'::jsonb then return; end if;

  update public.profiles
     set first_source = p_source
   where user_id = v_uid
     and (first_source is null or first_source = '{}'::jsonb);
end $function$;

------------------------------------------------------------------
-- 5. bump_seconds_in_app — refresh last-seen country.
------------------------------------------------------------------
-- Verbatim re-creation of the live 3-arg function with ONE addition (marked
-- below). This is the per-session heartbeat, so it is what backfills `country`
-- for accounts that predate this migration, as they return.
--
-- The country write keys off auth.uid(), NOT p_user_id. p_user_id is a
-- client-supplied parameter, so keying a profile write off it would let any
-- caller stamp another user's country.
--
-- signup_country is deliberately NOT touched here: stamping it on a heartbeat
-- would write a returning user's CURRENT country into a field labelled
-- "signup", which is false for every pre-existing account.
create or replace function public.bump_seconds_in_app(
  p_seconds    integer,
  p_session_id uuid default null,
  p_user_id    uuid default null
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_now    timestamptz := now();
  v_sess   record;
  v_credit int;
  v_age    interval;
  v_uid    uuid;
  v_cc     text;
begin
  if p_seconds is null or p_seconds <= 0 then return 0; end if;
  p_seconds := least(p_seconds, 60);

  if p_session_id is null then
    v_credit := least(p_seconds, 5);
  else
    insert into public.heartbeat_session (session_id, window_start, seconds_used, last_bumped_at)
      values (p_session_id, v_now, 0, v_now)
      on conflict (session_id) do nothing;
    select window_start, seconds_used into v_sess
      from public.heartbeat_session where session_id = p_session_id for update;
    v_age := v_now - v_sess.window_start;
    if v_age > interval '60 seconds' then
      v_credit := p_seconds;
      update public.heartbeat_session set window_start = v_now, seconds_used = v_credit, last_bumped_at = v_now where session_id = p_session_id;
    else
      v_credit := greatest(0, least(p_seconds, 60 - v_sess.seconds_used));
      if v_credit > 0 then
        update public.heartbeat_session set seconds_used = seconds_used + v_credit, last_bumped_at = v_now where session_id = p_session_id;
      end if;
    end if;
  end if;

  -- ── ADDED IN 0202: last-seen country ──────────────────────────────
  -- Outside the v_credit guard: a rate-limited heartbeat still tells us where
  -- the user is. Guarded by `is distinct from` so it writes only on change.
  v_uid := auth.uid();
  if v_uid is not null then
    v_cc := public.request_country();
    if v_cc is not null then
      update public.profiles set country = v_cc
       where user_id = v_uid and country is distinct from v_cc;
    end if;
  end if;
  -- ──────────────────────────────────────────────────────────────────

  if v_credit > 0 then
    update public.platform_counters set value = value + v_credit, updated_at = v_now where key = 'total_seconds_in_app';
    if p_user_id is not null then
      update public.profiles set seconds_in_app = seconds_in_app + v_credit where user_id = p_user_id;
      insert into public.user_active_day (user_id, day) values (p_user_id, current_date) on conflict (user_id, day) do nothing;
    end if;
  end if;
  return v_credit;
end $function$;

revoke all on function public.bump_seconds_in_app(integer, uuid, uuid) from public;
grant execute on function public.bump_seconds_in_app(integer, uuid, uuid) to anon, authenticated;
```

- [ ] **Step 2: Re-fetch the live `bump_seconds_in_app` and reconcile**

The body above was copied from production on 2026-08-04. Confirm it has not drifted since:

```
mcp__supabase__execute_sql: select pg_get_functiondef('public.bump_seconds_in_app'::regproc);
```

Compare against the migration. If production has changed, port the change into the migration file — the only intended difference is the block marked `ADDED IN 0202`. Do the same for `set_first_source`.

- [ ] **Step 3: Dry-run the migration inside a transaction**

This is the step that proves the grant is right. Run as one `execute_sql` call:

```sql
begin;

-- <paste the entire contents of 0202_country_capture.sql here>

-- (a) Non-request context must yield NULL, not raise. If the exception block
--     were missing or the GUC parsed differently, this errors instead.
select public.request_country() as should_be_null;

-- (b) The default must fire for anon — this is the grant check. A failure here
--     is exactly the production outage this task risks.
set local role anon;
insert into public.analytics_events (event, props) values ('_geo_dryrun', '{}'::jsonb);
reset role;

-- (c) The row must exist with a NULL country (no request headers in this
--     context) — proving the default evaluated rather than erroring.
select event, country from public.analytics_events where event = '_geo_dryrun';

-- (d) The new columns must exist.
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'profiles'
   and column_name in ('country', 'signup_country');

rollback;
```

Expected: `should_be_null` is null; the anon insert succeeds; one `_geo_dryrun` row with `country` null; both profile columns listed. Everything is rolled back.

If (b) fails with `permission denied for function request_country`, the grant is wrong — fix it and re-run before going near production.

- [ ] **Step 4: Confirm the ordinal is still free, then apply**

```bash
ls supabase/migrations/ | tail -3
```

If `0202` is taken, rename the file to the next free ordinal and update its header comment. Then apply via MCP:

```
mcp__supabase__apply_migration
  project_id: ehlhlmbpwwalmeisvmdp
  name: country_capture
  query: <contents of the migration file>
```

- [ ] **Step 5: Verify against production**

```sql
-- The helper exists and is safely null outside a request context.
select public.request_country() as ctx_null;
-- The default is attached.
select column_default from information_schema.columns
 where table_schema='public' and table_name='analytics_events' and column_name='country';
-- The client STILL cannot write it: this must return exactly the 7 original
-- columns, with `country` absent.
select column_name from information_schema.column_privileges
 where table_schema='public' and table_name='analytics_events'
   and grantee='anon' and privilege_type='INSERT' order by column_name;
```

Expected: `ctx_null` null; default `request_country()`; the grant list is `event, id, occurred_at, path, props, session_id, user_id` — **`country` must not appear**.

- [ ] **Step 6: Verify end-to-end from a real browser**

Load the production app, click around for a few seconds to emit events, then:

```sql
select country, count(*) from public.analytics_events
 where occurred_at > now() - interval '10 minutes' group by 1 order by 2 desc;
```

Expected: a real 2-letter code (`US` from the US) on the new rows. A column of all-nulls means the header is not arriving — stop and diagnose before building the read path on top of it.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0202_country_capture.sql
git diff --cached --name-only
git commit -m "Country capture: cf-ipcountry → analytics_events.country + profiles country columns"
git push
```

---

### Task 3: Migration 0203 — admin read path

**Files:**
- Create: `supabase/migrations/0203_admin_geo.sql`

**Interfaces:**
- Consumes: `profiles.signup_country`, `profiles.country`, `analytics_events.country` (Task 2).
- Produces:
  - `admin_geo_breakdown(p_days integer, p_exclude_internal boolean) → jsonb` shaped `{ by_country: [{country, sessions, users}], signups: [{country, signups, activated}] }`.
  - `admin_user_detail(uuid)` gains a top-level `geo` key: `{ signup_country, country, breakdown: [{country, events}] }`.
  - `admin_list_users(...)` gains a trailing `country text` column in its `TABLE(...)` result.

- [ ] **Step 1: Write `admin_geo_breakdown`**

Create `supabase/migrations/0203_admin_geo.sql` starting with:

```sql
-- 0203_admin_geo.sql
--
-- Admin read path for country (write path: 0202). Conventions mirror
-- 0121_device_tracking: _require_admin, the _internal_session_ids exclusion,
-- p_days clamped, jsonb out.
--
-- Traffic comes from analytics_events.country; signups come from
-- profiles.signup_country. Both bucket missing values as 'unknown' — which is
-- most rows until 0202 has been live a while, and the widget says so.

create or replace function public.admin_geo_breakdown(
  p_days integer default 30, p_exclude_internal boolean default true
)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v_out jsonb;
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 36500));
  with ev as (
    select e.session_id, e.user_id,
           coalesce(nullif(e.country, ''), 'unknown') as country
      from public.analytics_events e
     where e.occurred_at >= now() - (p_days || ' days')::interval
       and (not p_exclude_internal
            or e.session_id is null
            or e.session_id not in (select isess.session_id from public._internal_session_ids() isess))
  ),
  traffic as (
    select country as value,
           count(distinct session_id)::int as sessions,
           count(distinct user_id)::int    as users
      from ev group by country
  ),
  su as (
    select coalesce(nullif(p.signup_country, ''), 'unknown') as value,
           count(*)::int as signups,
           count(*) filter (where p.first_card_at is not null)::int as activated
      from public.profiles p
      join auth.users u on u.id = p.user_id
     where u.created_at >= now() - (p_days || ' days')::interval
       and u.email_confirmed_at is not null
       and (not p_exclude_internal
            or p.user_id not in (select iu.user_id from public._internal_user_ids() iu))
     group by 1
  )
  select jsonb_build_object(
    'by_country', coalesce((select jsonb_agg(jsonb_build_object(
                     'country', value, 'sessions', sessions, 'users', users)
                     order by sessions desc) from traffic), '[]'::jsonb),
    'signups',    coalesce((select jsonb_agg(jsonb_build_object(
                     'country', value, 'signups', signups, 'activated', activated)
                     order by signups desc) from su), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $function$;

revoke all on function public.admin_geo_breakdown(integer, boolean) from public;
grant execute on function public.admin_geo_breakdown(integer, boolean) to authenticated;
```

- [ ] **Step 2: Append the `admin_user_detail` and `admin_list_users` re-creations**

Both are large existing functions. **Do not** copy them from the migration files on disk — fetch the live definitions:

```
mcp__supabase__execute_sql:
  select pg_get_functiondef('public.admin_user_detail'::regproc);
  select pg_get_functiondef('public.admin_list_users'::regproc);
```

Paste each into `0203_admin_geo.sql` verbatim as a `create or replace`, then make exactly these edits:

**`admin_user_detail`** — add one top-level key to the `jsonb_build_object`, immediately after the existing `'device'` key:

```sql
    'geo', jsonb_build_object(
      'signup_country', nullif(p.signup_country, ''),
      'country',        nullif(p.country, ''),
      'breakdown', coalesce((
        select jsonb_agg(jsonb_build_object('country', g.cc, 'events', g.n) order by g.n desc)
        from (
          select e.country as cc, count(*)::int as n
          from public.analytics_events e
          where e.user_id = u.id and nullif(e.country, '') is not null
          group by 1
        ) g
      ), '[]'::jsonb)
    ),
```

**`admin_list_users`** — two edits:
1. Append `, country text` to the end of the `RETURNS TABLE(...)` list.
2. Append `nullif(p.country, '') as country` as the last column of the `base` CTE's select list (it already left-joins `public.profiles p`).

The final `select * from base` needs no change — column order is what binds it to the `TABLE(...)` list, so `country` must be **last** in both.

- [ ] **Step 3: Dry-run**

```sql
begin;
-- <paste the entire contents of 0203_admin_geo.sql>
select public.admin_geo_breakdown(30, true);
select jsonb_pretty(public.admin_user_detail((select user_id from public.profiles limit 1)) -> 'geo');
select user_id, email, country from public.admin_list_users(3, 0, null, null, 'recent', null, null, null, 'all', 'all');
rollback;
```

Expected: `admin_geo_breakdown` returns both keys (mostly `unknown` this early — that is correct, not a bug); the `geo` key is present with three sub-keys; `admin_list_users` returns 3 rows with a `country` column.

If `admin_list_users` raises `structure of query does not match function result type`, the new column is not last in both places — fix the ordering.

- [ ] **Step 4: Apply and verify**

Re-check the free ordinal, apply via `mcp__supabase__apply_migration` with name `admin_geo`, then re-run the three selects from Step 3 (without the transaction) against production.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0203_admin_geo.sql
git diff --cached --name-only
git commit -m "Admin geo read path: admin_geo_breakdown + country on user detail and list"
git push
```

---

### Task 4: `GeoBreakdown` widget

**Files:**
- Create: `boards/src/pages/admin/analytics/widgets/GeoBreakdown.jsx`
- Modify: `boards/src/pages/admin/analytics/views/AcquisitionView.jsx`

**Interfaces:**
- Consumes: `countryName`, `countryFlag` (Task 1); `admin_geo_breakdown` (Task 3).
- Produces: `<GeoBreakdown data={jsonb} days={number} />`.

Deliberately ranked tables, not a chart: at ~123 signups/30d a per-country time series is almost all zeros, and a pie with a long tail is unreadable. Growth is read by moving the existing window slider.

- [ ] **Step 1: Write the widget**

Create `boards/src/pages/admin/analytics/widgets/GeoBreakdown.jsx`:

```jsx
// GeoBreakdown — where our traffic and our signups come from. Reads
// admin_geo_breakdown jsonb { by_country, signups }.
//
// Two ranked tables rather than a chart: the country tail is long and the
// signup counts per country are small, so a pie or a per-country time series
// would be mostly noise. Ranked rows with a share bar read better at this size.
//
// Forward-looking, permanently: events and accounts predating country capture
// bucket as "unknown" and can never be backfilled (no IPs were ever retained),
// so we label that share instead of quietly dropping it.

import { formatCount, formatPct } from '../../../../lib/adminFormat.js';
import { countryName, countryFlag } from '../../../../lib/countries.js';
import { PanelNote } from '../../SmallN.jsx';

const TOP_N = 12;

// Split into the leading rows plus a summed "Other" remainder, so a long tail
// never pushes the panel taller than the widget beside it.
function topRows(rows, valueKey) {
  const sorted = [...rows].sort((a, b) => (Number(b[valueKey]) || 0) - (Number(a[valueKey]) || 0));
  if (sorted.length <= TOP_N + 1) return sorted;
  const head = sorted.slice(0, TOP_N);
  const tail = sorted.slice(TOP_N);
  const other = tail.reduce((acc, r) => {
    for (const k in r) if (k !== 'country') acc[k] = (Number(acc[k]) || 0) + (Number(r[k]) || 0);
    return acc;
  }, { country: '__other__' });
  return [...head, other];
}

function CountryCell({ code }) {
  if (code === '__other__') return <span className="admin-muted">Other countries</span>;
  const known = code && code !== 'unknown';
  return (
    <>
      <span aria-hidden="true">{countryFlag(code)}</span>{' '}
      <span className={known ? '' : 'admin-muted'}>{countryName(code)}</span>
    </>
  );
}

function GeoTable({ title, rows, valueKey, valueLabel, extra }) {
  const total = rows.reduce((s, r) => s + (Number(r[valueKey]) || 0), 0);
  return (
    <div style={{ flex: 1, minWidth: 260 }}>
      <table className="admin-table">
        <thead>
          <tr>
            <th>{title}</th>
            <th className="num">{valueLabel}</th>
            <th className="num">{extra ? extra.label : 'Share'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.country}>
              <td><CountryCell code={r.country} /></td>
              <td className="num">{formatCount(r[valueKey])}</td>
              <td className="num admin-muted">
                {extra
                  ? extra.render(r)
                  : (total ? formatPct((Number(r[valueKey]) || 0) / total) : '—')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function GeoBreakdown({ data, days = 30 }) {
  const traffic = topRows(data?.by_country || [], 'sessions');
  const signups = topRows(data?.signups || [], 'signups');
  // "Real" = at least one identified country. Until 0202 has been live a while
  // everything is 'unknown', and pretending otherwise would be misleading.
  const hasReal = traffic.some((r) => r.country !== 'unknown' && (Number(r.sessions) || 0) > 0);

  return (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Country</h3>
        <span className="admin-chart-sub t-meta">traffic · signups · last {days}d</span>
      </header>
      <div className="admin-chart-body">
        {!hasReal ? (
          <div className="admin-empty">
            No country data yet — events started carrying country recently; this fills in as new traffic arrives.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              <GeoTable title="Traffic" rows={traffic} valueKey="sessions" valueLabel="Sessions" />
              <GeoTable
                title="Signups" rows={signups} valueKey="signups" valueLabel="Signups"
                extra={{
                  label: 'Activated',
                  render: (r) => (Number(r.signups)
                    ? `${formatPct((Number(r.activated) || 0) / Number(r.signups))}`
                    : '—'),
                }}
              />
            </div>
            <PanelNote>
              Country comes from the network edge, not the browser — VPN and proxy users read as their exit country.
              “Unknown” is traffic from before country capture shipped, which can’t be backfilled.
              Activated = signups from that country that created a card.
            </PanelNote>
          </>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Wire it into `AcquisitionView`**

In `boards/src/pages/admin/analytics/views/AcquisitionView.jsx`:

1. Add the import after the `DeviceBreakdown` import (line 12):

```jsx
import { GeoBreakdown } from '../widgets/GeoBreakdown.jsx';
```

2. Add the RPC as the **last** entry of the `Promise.allSettled` array — after `admin_referral_stats`, which is currently last. The destructuring below is positional, so appending anywhere else silently misassigns every variable after it:

```jsx
      // Country mix (traffic + signups) — graceful via val(); never blocks the funnel.
      supabase.rpc('admin_geo_breakdown',         { p_days: f.days, p_exclude_internal: f.excludeInternal }),
```

3. Widen the destructuring to match, with `geo` last:

```jsx
    const [ab, fn, fb, dv, rf, geo] = await Promise.allSettled([
```

4. Add `geo` to the returned object:

```jsx
    return { acquisition: val(ab) || [], steps: val(fn) || [], fbSteps: val(fb) || [], device: val(dv) || null, referrals: val(rf) || null, geo: val(geo) || null };
```

5. Render it after `<DeviceBreakdown …/>` (line 48):

```jsx
        <GeoBreakdown data={q.data?.geo} days={f.days} />
```

- [ ] **Step 3: Verify it builds and renders**

```bash
cd boards && npx vite build 2>&1 | tail -5
```

Expected: a successful build with no unresolved-import errors.

Use `npx vite build`, **not** `npm run build`, throughout this plan: the latter runs the `stamp-build.mjs` prebuild hook, which rewrites `src/lib/buildInfo.js` and would put an unrelated file into your working tree while another session is active.

Then load the admin Analytics → Acquisition view signed in as an admin and confirm the Country panel renders — either with real rows, or with the "No country data yet" empty state if 0202 has only just shipped. Both are correct outcomes; a red error boundary is not.

- [ ] **Step 4: Commit**

```bash
git add boards/src/pages/admin/analytics/widgets/GeoBreakdown.jsx boards/src/pages/admin/analytics/views/AcquisitionView.jsx
git diff --cached --name-only    # MUST be exactly these two
git commit -m "Admin: Country panel — traffic and signups by country"
git push
```

---

### Task 5: Country in the Users tab and user detail

**Files:**
- Modify: `boards/src/pages/admin/AdminUserDetail.jsx`
- Modify: `boards/src/pages/admin/AdminUserList.jsx`

**Interfaces:**
- Consumes: `countryName`, `countryFlag` (Task 1); the `geo` key and `country` column (Task 3).

- [ ] **Step 1: Add country rows to the detail's Engagement section**

In `boards/src/pages/admin/AdminUserDetail.jsx`:

1. Add to the imports:

```jsx
import { countryName, countryFlag } from '../../lib/countries.js';
```

2. `EngagementSection` currently takes `({ eng, tier, lastSignInAt, device })` (line 119). Add a `geo` prop:

```jsx
function EngagementSection({ eng, tier, lastSignInAt, device, geo }) {
```

3. Immediately after the existing `<Row label="Device">…</Row>` block (ends line 155), add:

```jsx
        <Row label="Country">
          {geo?.country || geo?.signup_country ? (
            <>
              <span className="is-strong">
                {countryFlag(geo.country || geo.signup_country)} {countryName(geo.country || geo.signup_country)}
              </span>
              {geo.signup_country && geo.signup_country !== geo.country && (
                <span className="is-muted"> · signed up from {countryName(geo.signup_country)}</span>
              )}
            </>
          ) : <span className="is-muted">No country data yet</span>}
        </Row>
```

4. At the call site (line 359), pass it:

```jsx
          <EngagementSection eng={detail?.engagement} tier={detail?.identity?.tier || row.tier} lastSignInAt={row.last_sign_in_at} device={detail?.device} geo={detail?.geo} />
```

- [ ] **Step 2: Add the flag to each user-list row**

In `boards/src/pages/admin/AdminUserList.jsx`:

1. Add to the imports:

```jsx
import { countryName, countryFlag } from '../../lib/countries.js';
```

2. In `UserListRow`, inside `<div className="admin-user-meta">`, as the **first** child (before the usage `<span>`):

```jsx
        {row.country && (
          <span className="admin-muted" style={{ fontSize: 12 }} title={countryName(row.country)}>
            {countryFlag(row.country)}
          </span>
        )}
```

Flag-only in the list — the row is already dense, and the full name is one hover away.

- [ ] **Step 3: Verify**

```bash
cd boards && npx vite build 2>&1 | tail -5
```

Then open the admin Users tab: rows for users seen since 0202 shipped show a flag; selecting one shows a Country row in Engagement. Users not seen since then correctly show neither — that is the forward-only behaviour, not a bug.

- [ ] **Step 4: Commit**

```bash
git add boards/src/pages/admin/AdminUserDetail.jsx boards/src/pages/admin/AdminUserList.jsx
git diff --cached --name-only
git commit -m "Admin Users: country on the list row and in user detail"
git push
```

---

### Task 6: Privacy policy disclosure

**Files:**
- Modify: `boards/src/auth/legalContent.js`

The policy already discloses IP-address collection and Cloudflare analytics, so this is one added clause to the existing list — not a restructure.

- [ ] **Step 1: Extend the usage-data clause**

In `boards/src/auth/legalContent.js`, find the "Usage and device information" string (around line 41) and add approximate location to its enumeration. Replace:

```
browser and device type, operating system, language, and IP address.
```

with:

```
browser and device type, operating system, language, IP address, and the approximate location (country only) derived from it.
```

Leave the rest of the sentence — including the trailing "We collect this through our own logging and through the analytics and advertising tools described below." — unchanged.

- [ ] **Step 2: Verify**

```bash
cd boards && npx vite build 2>&1 | tail -5
```

Load `/legal/privacy` and confirm the clause reads correctly and the page renders.

- [ ] **Step 3: Commit**

```bash
git add boards/src/auth/legalContent.js
git diff --cached --name-only
git commit -m "Privacy: disclose country-level location derived from IP"
git push
```

---

## After the plan

Pushing `main` deploys a **preview**, not production. Promoting to prod is a separate cherry-pick onto `origin/production` in an isolated worktree — and note the standing gotcha there: copy `boards/.env.local` into the worktree **before** `vite build`, or the signed-in app is silently dead-code-eliminated. Gate on `AppShell` ≈496KB and grep the `dist` marker.

The migrations apply to the single shared Supabase project, so **0202/0203 take effect for production the moment they are applied**, independent of the frontend promotion. That ordering is deliberate: capture starts accruing immediately, and the UI catches up later.
