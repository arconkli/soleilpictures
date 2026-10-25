# Team S4: the team, for real — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task. Migrations, RLS, grants and the Worker's auth stay on the main model; the client wiring
> goes to `implementer` agents one task at a time, each reviewed before the next. Steps use checkbox
> (`- [ ]`) syntax.

**Goal:** the Team plan works end to end behind its holds. Buy a team (setup → Stripe → back), run it
from its page (people, seats, billing through Stripe's portal, joining), join one (an email invite, the
team link, a verified company domain asked once, a request for edit), and make team workspaces.
Production stays closed: `teamsAllowed()` is false there, and the server's `teams_open` admits only
its test owners.

**Architecture:**
- **One set of components, two sources.** The picked look already exists on sample data
  (`components/team/*`, `lib/teamModel.js`, `lib/teamSample.js`; plans 2026-10-21-team-page-preview and
  2026-10-21-team-buy-preview). The components stop calling the reducer directly and call
  `onAction(type, payload)`. The sample preview answers it with `teamReducer` (unchanged, still
  Settings › Preview for admins); a real team answers it with `useTeam(orgId).act`, which calls the RPC
  and reloads the snapshot.
- **The snapshot.** `get_team` (0535) plus, for owners and admins, `get_team_billing` (0538), folded
  by `toTeamSnapshot()` into the TeamSnapshot contract at the top of `teamModel.js`.
- **Money goes through `team-billing`** (S3): checkout, verify, portal, seats preview and add. The
  browser comes back to `/team?checkout=…` and `/team?billing=1`.
- **Links follow the app's idiom**, query parameters AuthGate stashes across the code step, like
  `?join=` and `?wsjoin=`: `?teamjoin=<token>` (the team link) and `?teaminvite=<token>` (an email
  invite). No new public route, so the docs gate is untouched until S5.
- **The domain check is the Worker's**, as 0534 planned: a signed-in route reads the challenge as the
  caller, asks DNS over HTTPS, and marks it verified with the service role; the Worker's daily cron
  re-checks verified domains.

**Tech stack:** React (lazy `components/team/*`), Supabase RPCs, the Cloudflare Worker
(`boards/src/worker.js`), Deno edge functions for the invite email, node `--test`, Playwright.

## Global constraints

- Holds: `teamsAllowed()` opens on the preview host and in dev only; production stays closed until S5.
  Server: `app_config.teams_open = {"open": false, "test_owner_ids": [...]}`; a test owner is added
  only on the owner's go.
- The DB and edge functions are shared with production: apply a migration and deploy a function only
  on the owner's go (S4's apply and deploys are part of "go S3/S4"; say which in the commit).
- Edge deploys are built on the LIVE code plus only this stage's hunks, read back byte for byte.
  `send-transactional-email` is frozen by another session until the update email is out: message them
  before deploying it.
- Function grants per 0311: a client RPC revokes from `public, anon` and keeps `authenticated`; a `_`
  helper revokes from `public, anon, authenticated`; every migration ends with a
  `has_function_privilege` proof block.
- Never `.catch()` a `supabase.rpc()` builder. Refusals carry a stable `hint`; the client reads it with
  `teamRefusal(err)` (`lib/teamHints.js`).
- `components/team/*` stay lazy: nothing in AppShell or AuthGate imports them; `teamModel.js` stays a
  leaf (no imports). New lazy modules go in `LAZY_IN_APP` and `LAZY_MODULES`.
- Gold (`--soleil`) only for active, selection and focus states. Deleting or removing shows an undo
  toast where the action can be undone; closing a team cannot, so it confirms first.
- The repo is public: no live counts in commits or files. Run `npm test` before every commit.

## File map

| File | Responsibility |
|---|---|
| `supabase/migrations/0540_teams_setup_and_domains.sql` | `preview_team_seats`, `team_domain_challenge`; proof |
| `supabase/migrations/0541_team_invite_email.sql` | `_outbound_gate` learns `team_invite`; the `org_invites` email trigger; `resend_team_invite`; proof |
| `boards/src/worker.js` (+ a small `lib/teamDomainCheck.js` core) | `POST /api/team/domain-check`; the daily re-check |
| `supabase/functions/send-transactional-email/index.ts` | The `team_invite` template |
| `boards/src/lib/teamBillingApi.js` | The `team-billing` calls, never throwing |
| `boards/src/lib/teamsApi.js` | Adds `getTeamBilling`, `previewTeamSeats`, `checkTeamDomain` (`resendTeamInvite` with 0541) |
| `boards/src/lib/teamSnapshot.js` | `toTeamSnapshot(team, billing, now)` |
| `boards/src/hooks/useTeam.js` | Load, reload, and `act(type, payload)` |
| `boards/src/components/team/*.jsx` | `onAction` instead of `dispatch`; the real actions; no "Preview:" toast on a real team |
| `boards/src/auth/AuthGate.jsx`, `components/TeamJoinCard.jsx` | `?teamjoin=` and `?teaminvite=` |
| `boards/src/App.jsx`, `auth/TierRouter.jsx` | `/team`, the checkout return, the workspace menu's team, the domain ask |
| `boards/src/lib/appHost.js` | `teamsAllowed()` |
| Tests | `teamSnapshot.test.mjs`, `teamBillingApi.test.mjs`, `teamsS4Migration.test.mjs`, `teamDomainCheck.test.mjs`, `tests/team-live.spec.js` |

## Task 1: the server (0540)

- [ ] `preview_team_seats(p_workspace_ids uuid[]) returns integer`: the seats a new team needs for
  these workspaces, by start_team_checkout's own count (make the team and move them in inside a
  savepoint, read `greatest(3, _team_seats_used(org))`, undo with `SLPV0`). The same refusals in the
  same order: signed in and active; `teams_closed`; `team_exists`; at most 50 ids; only the caller's own
  personal workspaces (`team_workspace`). Volatile (it writes inside the savepoint).
- [ ] `team_domain_challenge(p_org_id uuid, p_domain text) returns table (txt_name text, txt_value
  text, verified boolean)`: owner or admin only (`team_not_member` / `team_not_admin`), the row's
  name and `soleil-verification=<token>`. The Worker reads it as the caller, so it never decides who may.
- [x] Written 2026-10-25 (compiles on a local copy of live's shape, its proof passes there); applies on
  the owner's go for S4.
- [x] Pins in `teamsS4Migration.test.mjs`: the savepoint and `SLPV0` in `preview_team_seats`, its
  refusals in start_team_checkout's order, both RPCs revoked from `public, anon`, the proof block, no
  DROP, no overloads.
- [ ] A rolled-back probe G on live: a test owner previews 3 for an empty pick and the right count for
  a workspace with editors; a stranger's workspace refuses `team_workspace`; a non-admin can't read a
  challenge; nothing is left behind.

## Task 2: the domain check (Worker)

- [x] `lib/teamDomainCheck.js` (pure, node-tested): `txtAnswers(dnsJson)` joins split strings and drops
  quotes; `domainMatches(answers, value)`.
- [x] `POST /api/team/domain-check {org_id, domain}` with the user's bearer: call
  `team_domain_challenge` with the user's JWT (a refusal answers 409 with its hint), skip DNS when
  already verified, ask `https://cloudflare-dns.com/dns-query?name=<txt_name>&type=TXT` with
  `accept: application/dns-json`, and on a match call `team_domain_mark_verified(org, domain, true,
  token)` with the service key. Answers `{ok, verified}`. At most one check per user every 10 seconds.
- [x] The daily cron re-checks every verified domain and calls `team_domain_mark_verified(…, false)`
  for one whose record is gone (auto-join pauses until it passes again). Done 2026-10-25 in `worker-team.js` (six
  checks a minute per session, per isolate; an unsure DNS answer changes nothing; `not_available`
  until 0540 is applied); `teamRoute.test.mjs`.

## Task 3: the client's data

- [x] `teamBillingApi.js`, modelled on `storageAddon.js:15-35`: `teamBilling(action, body)` posts to
  `${VITE_SUPABASE_URL}/functions/v1/team-billing` with the session's bearer and never throws
  (`{ok:false, error:'auth required'|'network'|'http_<status>'|<server code>}`). Exports
  `startTeamCheckout`, `verifyTeamCheckout`, `openTeamPortal`, `previewTeamSeatsCost`, `addTeamSeats`,
  `syncTeam`, `newSeatRequestId`. Every call sends `return_origin: location.origin`.
- [x] `teamsApi.js` gains `getTeamBilling` and `previewTeamSeats`; `checkTeamDomain` calls the Worker
  route (`resendTeamInvite` comes with 0541, Task 9).
- [x] `toTeamSnapshot(team, billing)`: `plan` from billing (`interval`, `seats`, `renewsAt`,
  `trialEndsAt`, `status`, `cancelAtPeriodEnd`), `storage` (`usedBytes`, `quotaBytes`), `unpaid`
  (`since`, `graceEndsAt`, `viewOnly`), `whenFull` (`mode`, `monthlyLimit`, `addedThisMonth`); a
  member (no billing) gets `plan: null`, and no emails but their own (the server cuts the roster by
  role; the client never asks for more). Unit tests on fixture rows for owner, admin, member, unpaid.
- [x] `useTeam(orgId)` returns `{ team, loading, error, reload, act }`. `act` maps every reducer action
  the components dispatch to its RPC or `team-billing` call, reloads, and resolves `{ ok }` or
  `{ refusal }`. Done 2026-10-25: `teamCalls.js` (the fetch core, node-tested), `teamBillingApi.js`,
  `teamSnapshot.js`, `teamActions.js` (`runTeamAction`, `normalizeDomain`), `hooks/useTeam.js`. Left for
  Task 4: `plan.card` and `receiptsTo` have no source (get_team_billing has no card; show the portal
  instead), `plan` is null for a member, and a `pending:` (workspace) invite can't be revoked from the
  team page yet.

## Task 4: the page, real

- [ ] The components take `onAction`. TeamPage builds it from `teamReducer` for a sample team and from
  `useTeam().act` for a real one.
- [ ] Every "Preview:" toast on a real team becomes its action: rename; close (confirm, then the
  workspaces go home); leave; the card, invoices and plan changes open the portal; approve and keep
  viewer; roles (a price line first when it buys a seat); resend and revoke an invite; remove; add seats
  (`seats_preview`'s amount today, then `seats_add` with its `proration_date` and a request id);
  remove a seat; the when-full rule and its monthly limit; invite by email; the link on, off, its role,
  a new one; domains add, on, off, remove, and "Check now"; the seat perk. Add storage stays hidden on
  a real team (S3b).
- [ ] Refusals read their hint; view-only teams show the Unpaid board's banner.

## Task 5: getting there

- [ ] `teamsAllowed()`: the preview host or dev.
- [ ] App, when allowed and signed in: `list_my_teams()` once; the workspace menu's team section shows
  the real team and its Team page; `/team` opens it (TierRouter renders the app for `/team`).
- [ ] The checkout return: `?checkout=cs_…` verifies, retrying while `not_complete` (2, 4, 8 s), then
  opens the team's page (a new team goes to setup's people step); `?checkout=canceled` says nothing was
  charged; `?billing=1` reloads billing. The URL goes back to `/` when the page closes.

## Task 6: setup, real

- [ ] `/team/new` lists the caller's own personal workspaces (a direct select; no `boardsApi` import),
  asks `preview_team_seats` (debounced) for "N people edit these workspaces today", and keeps the seat
  stepper at that count or more.
- [ ] "Continue to payment" calls `startTeamCheckout` and goes to Stripe. `teams_closed`, `team_exists`,
  `team_seats_needed` and `team_checkout_rate` each say what to do. Ending Creator with credit stays
  off until S3b.
- [ ] After payment, the people step invites by email (`invite_to_team`) and the joining step adds a
  domain; Done opens the team's page.

## Task 7: joining

- [ ] `joinUrl(token)` becomes `${origin}/?teamjoin=${token}`. AuthGate captures `?teamjoin=` and
  `?teaminvite=` like `?wsjoin=`; after sign-in, `peek_team_link` names the team on a join card
  (WorkspaceJoinCard's look), and Join calls `claim_team_link`; an email invite calls
  `accept_team_invite` (a session that can't prove the inbox is asked to sign in with the code).
- [ ] After every sign-in, `claim_my_team_invites()` once.
- [ ] The domain ask: `my_team_offers()` at boot; one dialog, "Northlight Films uses your company's
  email. Join the team?", answered with `answer_team_offer`. **Mockup first** (one artifact; the
  owner picks), in the small-things look. An offer in `auto` mode (an account made after the domain
  was verified) joins without asking and says so in a toast.
- [ ] A member without a seat asks for edit from a team workspace (`ask_team_for_edit`); admins see it
  in People (Task 4).

## Task 8: team workspaces

- [ ] New workspace asks "Northlight Films / Just me" (+ Private) when the caller holds a seat, as the
  Daily board shows, and calls `create_team_workspace` for the team.
- [ ] The share panel in a team workspace whose seats are full says so and offers "Invite to view
  instead" (Daily board), from the `team_seats_*` hints.

## Task 9: the invite email

- [ ] The `team_invite` template in `send-transactional-email`, modelled on `workspace_invite`: who
  invited them, the team, the role, and the `?teaminvite=` link.
- [ ] 0541: `_outbound_gate` (re-emitted from its live body) counts `team_invite` as stranger mail
  under the invite budget; an `org_invites` insert trigger and `resend_team_invite` call
  `_notify_email('team_invite', …)`. `resend_team_invite(p_invite_id uuid) returns text` (owner or
  admin; an open invite; `sent`, or `too_soon` within a day of the last send, kept in a `resent_at`
  column) lives here too, so it never says "sent" before an email can go. Applied only once the
  template is live.
- [ ] Deploy the template built on the live function plus this hunk, after messaging the session that
  froze it.

## Task 10: proof and the walk-through

- [ ] `tests/team-live.spec.js` (route mocks): setup to Stripe and back, a verify that waits, adding a
  seat with its price, the portal, an invite, the join card.
- [ ] Probe G passes on live; the owner's go adds their test account to `teams_open.test_owner_ids`.
- [ ] The owner's walk-through on preview (S3 Task 5): buy with the trial, add a seat, open the portal,
  cancel, see the team go view-only. Then S3b and S5.
