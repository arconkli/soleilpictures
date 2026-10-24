# Team S2b — who pays: implementation plan

> For agentic workers: the main session executes this plan (migration, grant and parity
> reasoning stays on the main model). Steps use checkbox (`- [ ]`) syntax.

**Goal:** a team workspace's cards and files land on the team's meter, a personal workspace's on its
owner's, and a seat holder's personal workspaces get the seat perk. With no team in the database,
every gate answers exactly what it answers today.

**Architecture:** no new client surface. Three migrations. 0536 is inert while no team exists: a team
storage meter, two organization columns S3 keeps, a trigger that carries a workspace's bytes between
meters when its team changes, and `_workspace_set_owner` made team-aware. 0537 re-keys every card and
storage gate through two small resolvers, `_board_card_payer(board)` for cards and
`_drive_quota_bytes` / `_drive_used_bytes(org, owner)` for files. Each resolver calls today's helper
whenever the workspace is personal. 0650 points `record_upload_intent` at the same drives (it is
numbered after the security block's 0610, which wrote its live body, so the folder read in order
ends on the body that is live). One Worker check compares meters instead of owners.

**Design:** `docs/superpowers/specs/2026-10-21-team-plan-and-editor-limit-design.md` (S2b row and
"The Team plan"), and the resolver section of `2026-09-10-enterprise-orgs-and-seats-design.md`.

## Global constraints

- Parity: with `workspaces.org_id` null everywhere and no `org_members` row, every re-emitted gate
  returns what it returns today. The probe proves it against real accounts before 0537 is applied.
- Every re-emit starts from the live body. The md5 of each live `prosrc`, taken 2026-10-22, is recorded
  in 0537's header ("Rebased on"). Re-check it right before applying.
- Grants follow the 0311 habit. Every `_` helper is revoked from `public, anon, authenticated`. Each
  migration ends with a `has_function_privilege` proof block and a no-overloads check.
- Rolled-back probes never take a table lock on production (amendment A of S2a). So the workspaces
  trigger is applied first (0536), and the probe carries function re-emits only.
- The repo is public: no live figures in files or commits.
- The MCP applies a call of about 5k characters reliably. Split at function boundaries, each part one
  transaction with its functions' grants, and put the proof block last.
- Units match the code that already exists: 1 TB = 1 TiB, as in `_storage_quota_bytes()`, and 100 GB =
  100 GiB, as in `_storage_quota_trial_bytes()`.

## Decisions

1. **Cards: `_board_card_payer(board)` replaces `board_workspace_owner(board)` in the card gates.** It
   returns null while the board's workspace is a team's (a team has unlimited cards), or while its owner
   holds a seat with the perk on. Otherwise it returns `workspaces.created_by`, as
   `board_workspace_owner` does. Every card gate already reads a null owner as "no cap", so the only
   edit in each gate is the function name:
   - `enforce_demo_card_cap_trg`: all three calls. The "moved onto another meter" comparison becomes
     "moved onto another payer", so a card leaving a team for a personal cluster costs what an insert
     would.
   - `get_board_capacity`
   - `scout_board_capacity`
   - `restore_board`
   `_owner_card_count` gains `and w.org_id is null`, because a team's cards are not on anyone's
   personal meter. `get_my_tier` is not re-emitted: its count follows `_owner_card_count`, and its
   shape is unchanged.
2. **Files: one meter per payer.**
   - `org_storage_usage(org_id)` mirrors `storage_usage(owner_id)`, and `_org_storage_usage_apply`
     mirrors `_storage_usage_apply`. `storage_usage` itself is not altered: its FK is to `auth.users`.
   - The images trigger `storage_usage_trg` routes every delta through
     `_storage_apply_ws(workspace, bytes, objects)`. That goes to the team's meter when the workspace has
     an `org_id`, and otherwise to `_storage_usage_apply(created_by)`, which is today's
     `_image_owner` path.
   - `reconcile_storage_usage` rewrites both meters. The user truth gains `and w.org_id is null`.
3. **A workspace's bytes follow its team.**
   - An `after update of org_id` trigger on `workspaces` (`when old.org_id is distinct from
     new.org_id`) sums the workspace's counted images, as transfer does (0530). It takes them off the
     old payer's meter and puts them on the new one's.
   - `_workspace_set_owner` (0532) moves bytes between people only while the workspace is personal.
     0532 sets the team first and then the owner (in), and clears the team first and then sets the owner
     (out). Close re-owns workspaces while they are still the team's. So the trigger and the helper
     never move the same bytes twice.
   - `transfer_workspace_ownership` already refuses a team workspace (0530), so it is unchanged.
4. **Drives.**
   - `_storage_used_bytes` and `_storage_pending_bytes` (personal) gain `and w.org_id is null`. New
     `_org_storage_used_bytes` and `_org_storage_pending_bytes` sum by `w.org_id`.
   - `_org_storage_quota_bytes(org)` is the trial drive (`_storage_quota_trial_bytes()`, 100 GB) until
     `organizations.first_paid_at` is set. After that it is greatest(1 TB, 250 GB × seats) plus
     `storage_blocks` × the 1 TB block. S3 writes `first_paid_at` and `storage_blocks`. Until then a
     test team sits on the trial drive, which is what the design says a team has before its first
     payment.
   - `_drive_quota_bytes(org, owner)` and `_drive_used_bytes(org, owner)` pick the team's figures when
     `org` is set, and otherwise call today's `_storage_quota_bytes(owner)` and
     `_storage_used_bytes(owner) + _storage_pending_bytes(owner)`.
   - `authorize_upload`, `authorize_image_upload` and `record_upload_intent` read
     `(created_by, org_id)` and call the two drive functions. `record_upload_intent`'s lock key stays
     `'soleil.upload_space:' || owner` for a personal workspace and is `'soleil.upload_space:org:' ||
     org` for a team's. The two drives never share bytes, so one lock per drive is the whole of it
     (agreed with the security session, 2026-10-22). `record_upload_intent` is re-emitted in **0650**,
     not 0537: 0610 (security block 0600–0649) re-emitted it last, and a 0537 copy would sort before
     the live body.
   - `my_storage_usage` is not re-emitted: it is the caller's personal drive, and its helpers now
     exclude team workspaces.
5. **The seat perk.**
   - `_seat_perk_on(user)`: the user holds a seat (`org_members.seat`) in an open, active team whose
     `seat_perk` is on.
   - It lifts the personal card cap (through `_board_card_payer`) and adds 50 GB
     (`_seat_perk_storage_bytes()`) on top of `_storage_quota_bytes(owner)` and
     `_storage_quota_if_blocks`. Leaving the team takes the perk away, and the freeze follows from the
     same gates: no new card or upload past the limit.
6. **Not in S2b.**
   - View-only enforcement for a team that stopped paying, the subscription mirror, blocks and
     `first_paid_at` writers: S3.
   - The client knowing about the perk (`get_my_tier` still reports the personal cap, so a perk holder's
     wall shows until the client reads the perk), a team storage meter in the UI, and `get_team`'s
     `storage`: S4. Its `teamsApi` reads land there.
   - A general `subject_entitlement` resolver: when S4's workspace meter needs one.

## Files

- Create `supabase/migrations/0536_teams_pay_meters.sql`. It adds the columns, the table, the
  apply helper, the trigger and its function, and the `_workspace_set_owner` re-emit, then the proofs.
- Create `supabase/migrations/0537_teams_pay_gates.sql`. It has the resolvers, the constants and the
  re-emits listed above, then the proofs.
- Create `supabase/migrations/0650_teams_pay_upload_reserve.sql`: the `record_upload_intent` re-emit,
  its grants and proofs. It needs 0537 live.
- Create `boards/src/lib/teamsPayMigration.test.mjs` to pin all three files.
- Modify `boards/src/worker-api.js` (`/boards/:id/cards/move`). It reads `org_id` with `created_by`,
  and the capacity question is asked when the two workspaces are on different meters.
- Modify every older test that pins one of these functions' latest file to an older migration. Change
  the file it expects and keep every content assertion.

## Tasks

### Task 1: 0536 the meters (inert)

- [x] Pins: the table has RLS on, no client privileges and an FK to `organizations` with cascade. The
  trigger is `after update of org_id` with the `is distinct from` WHEN. Its function moves
  `-bytes`/`+bytes` with the same `_image_counts(` predicate as transfer. `_workspace_set_owner` calls
  `_storage_usage_apply(` only inside `if v_org is null`. Every helper is revoked from
  `public, anon, authenticated`. The file sets `lock_timeout` before `create trigger` on `workspaces`.
- [x] Write 0536. Compile it locally (`scratchpad/pgcheck/run.sh`). Run `npm test`. Commit
  (written, not applied).

### Task 2: 0537 the gates

- [x] Pins:
  - None of the four card gates calls `board_workspace_owner(`, and each calls `_board_card_payer(`.
  - `_owner_card_count`, `_storage_used_bytes`, `_storage_pending_bytes` and the reconcile user truth
    each carry `org_id is null`.
  - The three upload gates call `_drive_quota_bytes(` and `_drive_used_bytes(`.
  - `record_upload_intent` keeps the literal `'soleil.upload_space:' ||`.
  - `storage_usage_trg` calls only `_storage_apply_ws(`.
  - The perk term appears in both quota functions.
  - The constants equal 1 TiB, 250 GiB and 50 GiB.
  - Every helper is revoked, the client RPCs keep exactly their grants (`get_board_capacity`,
    `authorize_*`, `record_upload_intent`: authenticated; `scout_board_capacity`: service role only),
    and there are no overloads.
- [x] Write 0537 and 0650 from the live bodies (`scratchpad/s2b/orig/`, built by
  `scratchpad/s2b/build_0537.py`), changing only what the decisions name. Compile them locally. Update
  the older tests' file pins (cardCapScope, inviteStorage, securityAudit, securityHardening,
  storageCounting, teamsRpcMigration). Run `npm test`. Commit.
- [x] Worker: `cards/move` compares meters. Run its test (if none pins it, add a case to the nearest
  worker-api test). Commit.

### Task 3: Probe D, parity against real accounts (rolled back, before 0537)

- [x] Sample real owners (the largest drives, the most cards, and a spread of free accounts) and, for
  each, a few live boards and workspaces. Snapshot, using the live functions:
  - `_owner_card_count`, `_storage_used_bytes`, `_storage_pending_bytes`, `_storage_quota_bytes(uuid)`,
    `_storage_quota_if_blocks(u, 2)`;
  - as the owner: `get_board_capacity`, `authorize_image_upload(b, 10 MB)`, `authorize_upload(ws, 10 MB)`
    and `my_storage_usage()`;
  - `scout_board_capacity(b, owner)`;
  - the user truth of reconcile, as a SELECT (never run reconcile itself in a probe: it updates every
    meter row).
- [x] Then create 0537's functions inside the same transaction, snapshot again, and compare: every
  line must be identical.
- [x] On fixture users only (`@probe.invalid`), check the image trigger's deltas (insert, size change,
  move between workspaces, delete) and the card trigger's refusal at the cap, old against new.
  `record_upload_intent` runs on fixtures only, because it takes the owner's lock.
- [x] Time `enforce_demo_card_cap_trg`'s payer lookup and `_drive_used_bytes` on the heaviest real
  owner, before and after (info only; never in a commit).

### Task 4: Hand-off, on the owner's go

- [x] Apply 0536 in parts. Verify live equals the file (md5) and that `select count(*) from
  organizations` = 0.
- [x] Run probe D. On all ok, re-check the "Rebased on" md5s, then apply 0537 in parts and verify live
  equals the file. Then apply 0650 (one call) and verify it the same way.
- [x] Probe E (rolled back, live functions, a test team on fixtures):
  - moving a workspace in moves its bytes to the team's meter, and moving it out moves them back;
  - a demo owner's team workspace takes cards past their personal cap;
  - a seat holder's personal cluster takes cards past the cap, and their drive is 50 GB larger;
  - turning the perk off brings both back;
  - an upload past the team's trial drive is refused with `over_quota`;
  - closing the team leaves the owner's meter holding the bytes;
  - reconcile run on the fixtures agrees with the meters.
- [x] Mark the headers applied, then commit, push, and update memory.
