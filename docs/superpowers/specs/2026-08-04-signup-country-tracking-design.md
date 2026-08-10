# Signup country tracking — design

**Date:** 2026-08-04
**Status:** approved, pending implementation
**Migration:** 0202

## Goal

Know which country users come from, so signups can be sliced by geography — and,
because it costs nothing extra, so the whole funnel (landing → signup →
activation) can be too.

## Source of truth

Cloudflare's `cf-ipcountry` header, read **server-side inside Postgres**.

Supabase's API edge is Cloudflare, and it forwards the header into PostgREST's
request context. Verified live against the production project:

```
$ curl -s -X POST .../rest/v1/rpc/<probe> -H "apikey: …"
  "cf-ipcountry": "US"
  "cf-connecting-ip": "136.55.165.172"
```

So `current_setting('request.headers', true)::jsonb ->> 'cf-ipcountry'` resolves
inside any RPC, trigger, or column default that runs in a PostgREST request.

### Alternatives rejected

| Approach | Why not |
|---|---|
| Worker `/api/geo` route (`request.cf`) + client merges into props | Also yields city/region/timezone, but costs a fetch per session, is client-supplied (spoofable), and events firing before it resolves carry no country. Kept as the upgrade path if sub-country granularity is ever wanted. |
| Client timezone heuristic (`Intl…resolvedOptions().timeZone`) | Approximate, needs a lookup table, wrong for travelers and VPN users, and unverifiable server-side. |
| Third-party IP-geo API | Extra dependency, rate limits, latency, cost — for data Cloudflare already hands us. |

### What it cannot do

`ensure_profile_for_new_user` fires on `auth.users` inside **GoTrue's** database
connection, which does not set `request.headers`. Country is therefore
unavailable at the exact instant of signup, and is instead captured on the
first PostgREST call the new user makes (see `signup_country` below) — same
session, same IP, seconds later.

## Database (migration 0202)

### 1. `public.request_country() → text`

Reads `cf-ipcountry`; validates against `^[A-Z]{2}$`; maps Cloudflare's
placeholders `XX` (unknown) and `T1` (Tor) to `null`.

**Must be exception-safe.** It is used as a column default, so in any
non-PostgREST context (pg_cron, GoTrue triggers, direct psql) it must return
`null` rather than raise — a raise would break inserts. Implemented in plpgsql
with an `exception when others then return null` block.

### 2. `analytics_events.country text default public.request_country()`

Every client-inserted event carries the country of the request that inserted it.

**No client changes.** All three delivery paths in `lib/analytics.js` —
supabase-js `.insert()`, the keepalive-fetch beacon, and the `sendBeacon`
fallback — traverse the same Supabase edge, so all three get the header.

Rows inserted server-side (e.g. `referral_signup` from the signup trigger) get
`null`, which is correct: there is no request context to attribute.

**Unspoofable by construction.** `analytics_events` already has column-scoped
INSERT grants (`id, session_id, user_id, event, props, path, occurred_at`) for
`anon`/`authenticated`. `country` is deliberately left out of that grant, so a
client cannot post a value for it. Column defaults are applied by the system and
do not require column privileges, so the default still fires. This property must
be preserved — do not add `country` to the INSERT grant.

No new index. At ~17.6k events/30d and 27MB total, the existing `occurred_at`
index carries the admin queries. Revisit if the table grows an order of
magnitude.

### 3. `profiles.signup_country text` and `profiles.country text`

Two columns, each with exactly one meaning:

- **`signup_country`** — where the user was when they signed up. Stamped **once**,
  inside `set_first_source`. That RPC already fires on a new user's first
  sign-in, and already implements "stamp once, retry durably on failure". The
  country write must sit **before** the existing `first_source` early-return and
  must be independent of it, so a user with an empty `first_source` still gets a
  country. Guarded `where signup_country is null` for idempotency.
  Forward-only: null for every account that existed before this ships.

- **`country`** — last seen. Refreshed in `bump_seconds_in_app`, the per-session
  heartbeat, guarded by `is distinct from` so it writes only on change. This is
  what fills in for *existing* users as they return, so the Users tab is not a
  column of blanks on day one.

The heartbeat write **must key off `auth.uid()`, not the function's `p_user_id`
parameter.** `p_user_id` is client-supplied; keying a country write off it would
let any caller set another user's country. (Pre-existing observation, out of
scope: `seconds_in_app` in that same function is already keyed off `p_user_id`.)

`signup_country` is deliberately *not* backstopped in the heartbeat. Stamping it
there would write a returning user's *current* country into a field labelled
"signup", which would be a lie for every pre-existing account. If
`set_first_source` ever misses, the same fact is recoverable from that user's
earliest `analytics_events.country`.

### 4. `admin_geo_breakdown(p_days, p_exclude_internal) → jsonb`

Mirrors `admin_device_breakdown` (0121) exactly: `_require_admin()`, the
`_internal_session_ids()` exclusion, `p_days` clamped to `[1, 36500]`.

```json
{
  "by_country": [{ "country": "US", "sessions": 41, "users": 12 }],
  "signups":    [{ "country": "US", "signups": 9, "activated": 4 }]
}
```

`by_country` is traffic, from `analytics_events`. `signups` is from
`profiles.signup_country`, with `activated` counting `first_card_at is not null`.

### 5. `admin_user_detail` gains a `geo` key

`{ signup_country, country, breakdown: [{country, events}] }` — same shape and
placement convention as the `device` key added in 0121.

### 6. `admin_list_users` returns `country`

`profiles.country` (last seen) added to the `TABLE(...)` result — that is the
column the list row renders, because it populates for existing users too.
`signup_country` stays in `admin_user_detail`, where the distinction between
"signed up from" and "currently in" is worth the space to explain.

## Admin UI

- **`GeoBreakdown.jsx`** — new widget in `AcquisitionView`, rendered next to
  `DeviceBreakdown`. Two tables: traffic by country, and signups by country with
  activation rate.

  Deliberately a **ranked table, not a time series**: at ~123 users/30d, a
  per-country line chart is almost entirely zeros. Growth is read by moving the
  existing window slider.

  Follows `DeviceBreakdown`'s honesty convention — an explicit empty state and a
  `PanelNote` saying the data is forward-only, rather than implying the early
  window is representative.

- **`AdminUserDetail.jsx`** — country rendered beside the existing acquisition
  and device blocks.

- **`AdminUserList.jsx`** — country on the user row.

- **`lib/countries.js`** — `countryName(code)` via
  `new Intl.DisplayNames(['en'], { type: 'region' }).of(code)` (native, no
  lookup table, falls back to the raw code on any throw) and `countryFlag(code)`
  via regional-indicator codepoint math.

### Files deliberately not touched

`analyticsEvents.js`, `App.jsx`, `OnboardingCoachmark.jsx`, `UpgradeChip.jsx`,
`localMode.js`, `onboardingStarter.js` — another session has uncommitted work in
these. Only this change's own files get committed.

## Privacy

`legalContent.js` already discloses IP-address collection and Cloudflare
analytics. This needs one precise addition to that existing data list —
approximate location (country) derived from IP address — not a restructure.

## Testing

- `lib/countries.test.mjs` — node unit test, matching the existing `.test.mjs`
  convention: known codes, unknown codes, `null`/garbage input, flag math.
- SQL dry-run: `BEGIN` → apply → exercise `request_country()` in a non-request
  context (must return null, not raise) → verify the new RPCs → `ROLLBACK`,
  before applying for real. Per the standing migration-drift practice.
- Live verification after deploy: insert an event from a browser and confirm
  `country` is populated; confirm a client cannot set it (the column grant).

## Explicitly out of scope

- **Historical backfill — impossible, not merely deferred.** `auth.audit_log_entries`
  retains zero rows with an IP address, so no prior country is recoverable by any
  means. This is forward-only permanently, exactly as device tracking was.
- City / region / continent granularity (needs the Worker route above).
- A country **filter** on the Users tab. Deferred, not dropped: it requires
  re-creating both `admin_list_users` and `admin_user_count` (~5.5KB each) with a
  new predicate, plus a dropdown-options RPC in the `admin_acquisition_channels`
  mould. Cheap to add later.
