# Team plan and a 10-editor limit on Free and Creator — design

Status: approved by the owner 2026-10-21. Built in stages behind holds; everything launches
together. Supersedes the packaging in
[`2026-09-10-enterprise-orgs-and-seats-design.md`](2026-09-10-enterprise-orgs-and-seats-design.md)
(its organizations / seats / Stripe architecture is reused, re-cut to the decisions below).

## Why

Editors are free and unlimited on every plan today. The owner wants collaboration at
organisation scale to be the paid line: a personal account (Free or Creator) can have at most
**10 people who can edit**, and a group that needs more buys a **Team**. A business should be
able to buy a Team directly and run it themselves (people, seats, storage), with no sales call
and as little manual work on our side as possible.

## Decisions

### The limit (Free and Creator)

- **10 people who can edit, counted per account**: the distinct people who can edit anything in
  any workspace the account owns. The owner and co-owners count. API service accounts don't.
  Viewers never count and stay unlimited. A banned account can't write, so it frees its slot.
- A sent editor email invite **holds a slot** until it is cancelled or expires (30 days).
- A "Can edit" invite link (cluster or whole workspace) opened when the account is full lets
  the person in **as a viewer**, tells them why, and notifies the owner.
- Someone who isn't the owner and tries to add an editor when full is offered **"Ask the
  owner"**; the owner is notified.
- **Freeze**: an account that ends up over 10 (an ownership transfer, a restore, a closed team)
  keeps everyone editing and admits no new editor until it is at 10 or fewer.

### The Team plan

- Its own plan, bought directly: **$25 per editor seat a month, $240 a year** (what Creator
  costs, 20% off yearly like Creator; the owner's pick of 2026-10-25, first set at $15 / $144), **3-seat minimum**, self-serve up to 100 seats.
- Every editor uses a seat, the owner and outside guest editors included. Seats are pooled
  across the team's workspaces. Viewers are free.
- Unlimited cards. Storage pool = **1 TB × seats**, as Creator (2026-10-25, was max(1 TB, 250 GB × seats);
  0539), plus +1 TB blocks at $25 each.
- A 14-day trial with a card; storage is capped at **100 GB until the first payment**; seats
  added during the trial are charged when it converts.
- Unused seats are used first. When the seats run out, the **admins choose**:
  - "Ask first" (the default): the joiner gets in as a viewer and a join request appears;
    approving it buys one more seat, prorated.
  - "Add seats automatically", with an optional monthly cap.
- Unused seats **drop automatically at renewal**, never below 3.
- If payment stops: **14 days of grace, then view-only**. Opening and exporting always work,
  and paying restores everything. Data is kept view-only for **12 months**, with warnings,
  then deleted.
- Closing a team moves its workspaces to the **owner's personal account** (the freeze applies).
- A buyer already on Creator is offered to **end Creator with credit** if everything moves in.
  Their +1 TB blocks **move to the Team** automatically.

### Team structure

- A **separate Team owns workspaces**. Roles: owner, admins, members (each holds a seat),
  viewers (free).
- Only the owner changes the card or the plan, or cancels. **Admins can add seats** (the price
  is shown first), manage people, links and domains, and set the auto-add rule.
- The buyer **picks which workspaces move in** at setup. The rest stay personal.
- Team workspaces are visible to the **whole team by default**. An admin can make one private,
  and **the owner and admins can always open private team workspaces** (hand-overs).
- **Any member with a seat** can create team workspaces. Creating a workspace asks "Team or
  Personal".
- **Personal workspaces stay the member's.** The team never sees, opens or bills them.
- **Seat perk** (on by default; admins can turn it off): while someone holds a seat, their
  personal workspaces get unlimited cards and **+50 GB** of private storage. Leaving the team
  puts them back on their own plan with nothing lost (the freeze applies if they're over).
- The roster shows **names to everyone and emails to the owner and admins only**.

### Joining

Admins choose which of these are on:

- paste a list of emails;
- a team invite link;
- auto-join by verified company domain (a DNS TXT record; free-mail domains are refused).
  Accounts that already exist on that domain are **asked once, at their next sign-in**. Admins
  never see who already has an account.

### Surfaces

- A `/team` page with three sections: People · Seats & billing · Joining. Mockups first.
- `/pricing` gets **three cards**: Free · Creator · Team, with a seat picker on Team, and "Need
  SSO, invoices or 100+ seats? Talk to us", a short form that lands in `/admin` with an alert
  email.
- **SSO, invoices and purchase orders** are a later **Enterprise** tier (name reserved).
- The **audit log is no longer Enterprise**. The owner's security decision of 2026-10-21 made
  it a security log that records from that day, readable by a workspace's owner and admins,
  and Team uses it (an admin opening a private team workspace writes a row). The security
  plan owns it; the Team-specific requirements are in the S2a plan's amendment E.

## How it works today

Who can edit cluster C (`can_write_board`, 0318; roles via `_workspace_member_can_write`,
0391): the workspace's creator, members with role owner / coowner / admin / editor / service,
and `board_shares` with role editor on C or any ancestor. The party server admits writers
through the same RPC (`boards/party/auth.ts`). Limits follow `workspaces.created_by`
(`board_workspace_owner`, 0187).

| Door | Latest definition | Who may use it | Brake today |
|---|---|---|---|
| Invite "Can edit · This cluster", viewer → editor | `share_board` (0391) | a manager or any editor | dormant 0188 brake |
| Invite "Can edit · Whole workspace" | `invite_workspace_member` (0391) | owner / co-owner | none |
| Member role change | `set_workspace_member_role` (0391) | owner / co-owner | none |
| Cluster edit link | `create_collab_link` (0373) → `claim_collab_link` (0371) | owner or any editor | brake on new joins only |
| Email invite to a new address | `claim_pending_invite`, signup backstop `_claim_pending_invites_for_user` (0371) | — | none |
| Whole-workspace link | `claim_workspace_invite_link` (0450) | owner / co-owner | none |
| Undo a removed share | `restore_board_share` (0405) | a manager or an editor | none |
| Ownership transfer | `transfer_workspace_ownership` (0412) | owner | — |
| API service account | `service_account_register` (0375) | creator | not counted |

The 0188 brake (`app_config.collab_free_editor_cap = {"cap": null}`) counts only editor shares
and is replaced by this design.

Gaps the limit exposes:
- a refused link or invite claim is silent (`AuthGate.jsx`);
- the share panel recognises only the "invite limit reached" error.

Notices: every `notifications` insert pings `user:{uid}` live (`notifications_broadcast`,
0242), and `useNotifications` turns the ping into a toast. But the bell row sits inside App's
`!filesSidebar` block, and the new `ClusterSidebar` offers only Home and Messages, so with the
new sidebar a notice that arrives while someone is away can't be found again. The sidebar
release closes that gap with a bell of its own (2026-10-21).

## Program

Server holds are `app_config` rows, because preview and production share one database. Each
has a database-only `test_owner_ids` allowlist, so preview test accounts get real enforcement.
Client holds are `xAllowed()` in `boards/src/lib/appHost.js`. Migrations use the block
**0520–0559**.

| Stage | Delivers | Hold |
|---|---|---|
| S0 | Mockups, then the owner picks: share panel at the limit, the joined-as-viewer message, the owner's notice, `/team`, Team setup, three-card `/pricing`, "Team or Personal" on create | — |
| **S1** | **The 10-editor limit** for personal accounts, server and client | `app_config.editor_limit`, `editorLimitAllowed()` |
| S2a | Teams core: `organizations`, `org_members` (role, seat), `org_invites`, `org_domains`, `org_join_requests`, `workspaces.org_id` + `org_visibility`; the org branch in the six access choke points, the four `realtime.messages` policies and the party server's re-auth and kick; the team branch of `_editor_admit`; "Team or Personal" on create | no org row can exist unless `app_config.teams_open` or a test owner |
| S2b | Re-key who pays: `billing_subject(ws)` + `subject_entitlement`; every card, storage and capacity gate; `storage_usage` gains a subject key; the seat perk on the user subject | parity: identical while `org_id is null` |
| S3 | Team billing: a Stripe Team product with seat and storage-block prices; checkout (3–100 seats, trial); the webhook's org branch FIRST; `org_subscriptions` mirror; seat preview and apply; auto-add and its cap; renewal true-down; grace → view-only; 12-month retention; reconcile; portal; Creator credit and block move | no Price IDs → 404; `teams_open` |
| S4 | `/team` (People · Seats & billing · Joining), setup wizard, bulk invite, team link, domain verification + auto-join + the one-time ask, join requests, roster privacy, closing a team | `teamsAllowed()` |
| S5 | Launch: `/pricing` three cards, the Talk-to-us form → `/admin`, every copy site that says editors are free, docs + `{{fact:}}` FACTS, SEO probe rows, Scout, changelog, drop the 0188 brake, flip the holds | one promote: client + docs first, then the switch migration |

Gates S2b re-keys from `created_by` to the billing subject: `enforce_demo_card_cap_trg`,
`get_board_capacity`, `scout_board_capacity`, `_owner_card_count`, `get_my_tier` (return-shape
change: DROP + CREATE with grants re-issued, anon included), `authorize_upload`,
`authorize_image_upload`, `my_storage_usage`, `_storage_used_bytes`, `_storage_usage_apply`
with its trigger and reconcile, `_storage_quota_bytes`, `_storage_quota_if_blocks`,
`_storage_quota_trial_bytes`, the transfer's storage move, `board_workspace_owner`, the
Worker's `get_board_capacity` calls, and import jobs.

## S1 — the 10-editor limit

### Server (0520–0521)

Each redefined function body is re-emitted from the live `pg_get_functiondef`. Grants follow
the 0311 habit, and each migration ends with a `has_function_privilege` proof block.

**0520 — count, admit, notify, capacity**

- `_account_editor_slots(p_owner)` → `(slot_key, user_id, email, source)`. The slots are:
  - the owner;
  - `workspace_members` with role owner / coowner / admin / editor;
  - `board_shares` editors on live boards in workspaces `created_by = p_owner`.

  Banned users and service-account users are left out. Then add `pending_invites` that:
  - have role `editor` or `workspace` (a workspace invite is stored as `workspace` for an
    editor and `viewer` for a viewer);
  - are unclaimed, unexpired and not held (`held_at is null`);
  - were sent by someone who isn't suspended.

  Pending rows are de-duplicated against accounts by `lower(email)`. One slot per person.
- `_editor_limit()` = 10. `_editor_limit_on(p_owner)` is true when
  `app_config.editor_limit.enforced` is set or the owner is in `test_owner_ids`.
  `_account_editor_count(p_owner)` counts the slots.
- `_editor_admit(p_workspace, p_user, p_email)` → `ok | already | full`:
  1. Resolve the owner. If the limit is off, return `ok`.
  2. Take `pg_advisory_xact_lock(hashtext('editor_slots:' || owner))`.
  3. Someone already holding a slot returns `already`.
  4. A count at or over the limit returns `full`. This single comparison is the freeze rule.
  5. Otherwise return `ok`.

  It takes a workspace, so S2a adds the team branch here without touching any door.
- `_editor_refuse(p_workspace)` raises 42501 with a readable message and a stable hint:
  `editor_limit` when the caller is the account owner, `editor_limit_ask_owner` for anyone else.
- `_notify_editor_limit(p_workspace, p_board, p_actor, p_via)` writes `notifications` of kind
  `editors.limit_reached` to the owner and that workspace's co-owners. It is skipped when the
  limit is off, when the recipient is the actor, or when the same (user, kind, actor, via) row
  exists within 24 hours. It is wrapped so it can never break a claim. The joiner of a full
  link gets `editors.joined_as_viewer`.
- `ask_owner_for_editor_slot(p_board_id, p_workspace_id)` → `sent | already_sent | not_full`.
  A door that raises rolls back its own notice, so asking is a separate call.
- `get_editor_capacity(p_board_id, p_workspace_id)` →
  `(enforced, editor_limit, used, pending, full, i_am_account_owner, subject)`. It returns
  numbers only, never emails, and is gated on `can_write_board` or `can_manage_workspace`.
- `list_my_account_editors()` (owner only) lists the people and pending addresses holding
  slots, with their source and workspace count, so the owner can choose whom to remove.
- `app_config` row `editor_limit = {"enforced": false, "test_owner_ids": []}`.

**0521 — every door**

| Door | Change | When full |
|---|---|---|
| `share_board` | remove the 0188 block; for an editor share call `_editor_admit` after the user lookup (covers a new share, a pending invite, viewer → editor) | refuse |
| `invite_workspace_member` | same for `p_role = 'editor'`, before the pending insert and the member insert | refuse |
| `set_workspace_member_role` | when the new role is editor or coowner and the current one is viewer | refuse |
| `restore_board_share` | when restoring an editor share | refuse (the undo toast says why) |
| `claim_collab_link` | remove the brake; editor link and full → insert as viewer (a fresh join) or stay viewer (the upgrade branch); both notices and a server event `editor_limit_viewer_fallback`. **Return shape and status words unchanged** | viewer fallback |
| `claim_workspace_invite_link` | editor link and full → insert the member as viewer (still counts toward the link's uses); notices and the event; shape and statuses unchanged (`check_instrumentation` pairs `status = 'joined'`) | viewer fallback |
| `claim_pending_invite`, `_claim_pending_invites_for_user` | **no gate**: the slot was held when the invite was sent | — |
| `transfer_workspace_ownership`, the deletion heir | **no gate** (freeze); the `ownership_received` notice adds a freeze line when the recipient is over | — |
| `service_account_register`, `create_collab_link`, `create_workspace_invite_link` | unchanged | — |

`billingCopy.js` cites `collab_free_editor_cap is null` for "editors are free". It changes to
cite `_editor_limit_on() = false` (comments only). The old brake functions and their
`app_config` row are dropped in S5.

### Client (all behind `editorLimitAllowed()`, built to the S0 pick)

- `lib/editorLimit.js` holds the limit (10), the hints, `editorLimitRefusal(err)` (reads
  `err.hint`) and the copy.
- `hooks/useEditorCapacity.js` follows `useBoardCapacity.js`. It is invalidated after a share,
  an invite, a role change, an unshare, a revoke or a restore.
- `lib/inviteSubmit.js` `runInvites` stops at the first editor-limit refusal, like the invite
  budget, and returns `limit: { kind: 'editors', unsent }`.
- The share panel:
  - handles the outcome;
  - on the ask hint, calls `ask_owner_for_editor_slot` and says "We told the owner";
  - disables "Can edit" in both role selects when full (people already counted stay enabled);
  - warns before a demotion while frozen;
  - shows "Editors N of 10" when enforced;
  - stops saying "editors are free" under the hold.
- The Members settings tab gets the same, plus an owner-only list of people who can edit, with
  revoke on pending rows.
- The setup invite step renders `limit.kind === 'editors'`.
- The join cards stop saying an editor joins "free" under the hold.
- Joined-as-viewer: the live ping toasts while the app is open. AuthGate claims a link before
  App subscribes, so App also checks once after the first notifications load: an unread
  `editors.joined_as_viewer` row (deduped by id) gets one toast, then is marked read.
- `NotificationsPanel` renders `editors.limit_reached` and opens Members.
- No Notifications entry of its own. The sidebar release adds a bell to the new sidebar, mocked
  up first, with the owner picking where it goes. The owner's notice opens from it.
- Analytics:
  - client events `EDITOR_LIMIT_SEEN`, `EDITOR_LIMIT_REFUSED {door, kind}`,
    `EDITOR_LIMIT_ASK_SENT {result}`, `EDITOR_LIMIT_NOTICE_OPEN`;
  - a `featureEvents.js` entry `editorLimit` and a `featureFlags()` entry;
  - the server event joins `check_instrumentation()`'s watch list in S5.

### S1 verification

- `npm test` includes a migration-contract test (`editorLimitMigration.test.mjs`, via
  `migrationText.mjs`). It checks that:
  - the six gated doors call `_editor_admit(` and none mention `_collab_editor_cap`;
  - the claim-pending pair and transfer do not call it;
  - both link claims contain the viewer fallback;
  - the slot count excludes held, banned and service rows;
  - every `_` helper is revoked and the proof blocks are present;
  - there are no overloads;
  - the SQL limit equals the client constant;
  - both hints are present.
- Unit tests cover `editorLimit.js` and `runInvites`.
- A rolled-back probe against the real database (`begin … rollback`), with the limit enforced
  for a fixture owner and 11 fixture users, each acting as `authenticated` with their own JWT
  claims. It checks that:
  - the 11th `share_board` raises the right hint;
  - a pending invite holds a slot;
  - an address with an account counts once;
  - banned and service accounts free a slot;
  - both links fall back to viewer with one deduplicated notice;
  - the upgrade branch stays viewer;
  - a transferred-in workspace over 10 keeps everyone and admits no one;
  - `claim_pending_invite` succeeds at 10;
  - with the limit off, every door behaves exactly as before.
- Playwright `tests/editor-limit.spec.js` with RPC route mocks covers the owner refusal, the
  ask path, the disabled option and the joined-as-viewer toast. The existing share-panel and
  invite-link specs are re-run.
- Migrations are applied only after the probe passes and the owner says go. The limit stays
  off until launch.

## Traps carried into every stage

- Public docs and `{{fact:…}}` numbers change in the commit that makes a surface public (S5).
  `/team` lives in the signed-in router, which the docs gate can't see, so S5 adds a
  `teamRoutes()` extractor to `publicSurface.mjs` along with its docs.
- The SEO probe rows that assert /pricing says "no per-seat charges" and that pin the two-column
  plan table are reconciled in S5 (contract and database rows together), never deleted. Title
  changes are pre-registered.
- Stripe:
  - the webhook's org branch is tested first, because the email fallback would otherwise
    activate the buyer's personal tier;
  - `pickReusableCustomer` skips org customers;
  - the Creator credit needs a customer-balance transaction on the team's own customer.
- A return-shape change means DROP + CREATE with grants re-issued in one transaction. The
  Supabase MCP has refused DROP scripts, so plan an owner step in the SQL editor where needed.
- Never subquery a table inside its own policy (42P17). Run a rolled-back real-user UPDATE
  after any RLS change. No RPC overloads (PGRST203).
- The repo is public: no counts or revenue in commits or committed files.
