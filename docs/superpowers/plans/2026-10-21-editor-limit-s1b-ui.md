# Editor limit S1b: the app at the limit (direction B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the owner's pick B for the 10-editor limit in the app, behind `editorLimitAllowed()`:
- a note at the top of the share panel's invite area;
- "Can edit" locked for anyone new while the plan is full;
- "Ask Alex for room";
- Members' "People who can edit" card;
- the notices' toasts.

0520's notice copy changes to match.

**Architecture:**
- **Logic.** Copy and the "what to do" planning live in `lib/editorLimit.js`, pure, and node tests them.
- **One hook.** `hooks/useEditorLimit.js` reads the numbers. For the account's owner it also reads who holds each place.
- **Two components draw them.** `EditorLimitNote` is the share panel's note. `AccountEditorsCard` is the Members card.
- **Existing surfaces wire them in:**
  - ShareModal
  - MembersTab
  - InviteStep
  - useNotifications
  - App
- **0520** is still unapplied. It gets:
  - the picked notice copy;
  - a list shape that says where each place is, so the card can free one.

**Tech Stack:** React 18 (Vite), Supabase RPCs (Postgres, plpgsql), `node --test`, Playwright.

**Design record:**
- Plan: `~/.claude/plans/i-want-to-work-soft-ladybug.md`.
- Spec: `docs/superpowers/specs/2026-10-21-team-plan-and-editor-limit-design.md`.
- S1a: `docs/superpowers/plans/2026-10-21-editor-limit-s1a-server-and-logic.md`.
- Mockups: the S0 canvas. The owner picked B on 2026-10-21.

## Global Constraints

- **The hold.** Every new screen and sentence shows only while `editorLimitAllowed()` is true. That is dev only, behind localStorage `soleil.dev.editorLimit = '1'`. It stays OFF in the 10-22 promote.
- **Nothing calls the new RPCs with the hold off.** That covers `get_editor_capacity` and `list_my_account_editors`. 0520 isn't applied yet, so they don't exist.
- **Refusals are handled whatever the hold says.** That is any error where `editorLimitRefusal(err)` is non-null.
- **Never apply a migration.** 0520 and 0521 wait on the owner's go, and the database is shared with production. The probe runs inside a block that always raises.
- **Copy is exact.** Use the strings in this plan, with curly quotes and apostrophes (’ “ ”).
- **No gold in the limit.** The note, its buttons and the card never use gold (`--soleil`, `.share-btn-gold`). Invite and Copy link keep their one-gold rule.
- **No "Start a team" and no price anywhere yet.** S4 adds the Team plan and its button; S5 adds prices.
- **No identities in analytics.** No emails, names or link tokens in analytics props.
- **The repo is public.** No counts, revenue or user numbers in files or commit messages.
- **Subagents don't commit or push.** They report the files they changed. The main session commits by pathspec and pushes.
- **Tests pass after every task.** `cd boards && npm test` must pass at the end of each one.

**Not in this plan:**
- The setup QA fixture's editor-limit hints (`local/setupqa/fakeSetupSupabase.js`). The unit tests for `runInvitesByRole` cover the setup's stop.
- A warning when demoting someone while the account is over the limit. Pick B has none, and no account is near 10 today. It's a follow-up, not S1b.
- "Start a team" and every price (S4, S5).

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `supabase/migrations/0520_editor_limit_core.sql` | notice copy; `_account_editor_grants` + role/invite/sent; `list_my_account_editors` → `grants jsonb`; `_editor_limit_owner_first_name` | 1 |
| `boards/src/lib/editorLimitMigration.test.mjs` | pins the above | 1 |
| `boards/src/lib/editorLimit.js` (+ `.test.mjs`) | stage, the note's words, refusal sentence, toast text, missed notices, holders, the card's lines and ops | 2 |
| `boards/src/lib/inviteSubmit.js` (+ `.test.mjs`) | `runInvitesByRole`: the editor limit stops editors only | 2 |
| `boards/src/hooks/useEditorLimit.js` | numbers + the owner's list for one cluster/workspace | 3 |
| `boards/src/components/EditorLimitNote.jsx` | draws the note | 3 |
| `boards/src/components/ShareModal.jsx` | the note, locked "Can edit", ask, refusals, link line | 3 |
| `boards/src/styles.css` | `.lim-*` (Task 3); `.settings-cat-aside`, `.settings-editor-*` (Task 4) | 3, 4 |
| `boards/src/lib/analyticsEvents.js` | the `EDITOR_LIMIT_*` keys, each added by the task that emits it | 3, 4, 5 |
| `boards/src/components/settings/AccountEditorsCard.jsx` | the "People who can edit" card | 4 |
| `boards/src/components/settings/MembersTab.jsx` | the card, locked roles, refusals | 4 |
| `boards/src/components/settings/fields.jsx` | `SettingsCategory` `aside` | 4 |
| `boards/src/components/settings/saveState.jsx` | `err.userMessage` | 4 |
| `boards/src/components/setup/InviteStep.jsx` | viewers still go out when editors are full | 5 |
| `boards/src/hooks/useNotifications.js` | toast words, "See who can edit", the missed joined-as-viewer notice | 5 |
| `boards/src/App.jsx` | `onSeeEditors` (Task 3); `onOpenSettings` (Task 5) | 3, 5 |
| `boards/src/components/NotificationsPanel.jsx` | the bell's `NOTICE_OPEN` | 5 |
| `boards/src/lib/inviteAbuse.test.mjs` | pins the panel's one, shared parser | 3 |
| `boards/src/lib/featureEvents.js` | `editorLimit` measured | 5 |
| `boards/src/components/JoinBoardCard.jsx` | no "free" on the edit link's card under the hold | 5 |
| `boards/src/local/shareWorkspaceProbe.js` | `mountMembersTab` | 6 |
| `boards/tests/editor-limit.spec.js` | runtime pins | 6 |

Tasks run **in order**: each one builds on the files the one before it changed.

---

### Task 1: 0520 says what the pick says, and the owner's list says where each place is

The main session does this task (migration reasoning). It is unapplied, so `create or replace` with a new return shape is safe: no function of that name exists yet.

**Files:**
- Modify: `supabase/migrations/0520_editor_limit_core.sql`
- Modify: `boards/src/lib/editorLimitMigration.test.mjs`
- Scratchpad (not committed): `probe_checks.sql`, `build_probe.py` (S1a's rolled-back probe)

**Interfaces:**
- **Produces** `list_my_account_editors()` with these columns:
  - `slot_key text`
  - `user_id uuid`
  - `email text`
  - `display_name text`
  - `source text`, which is `'owner' | 'member' | 'share' | 'pending'`
  - `grants jsonb`
- **Each element of `grants`** is an object with:
  - `source`: `'owner' | 'member' | 'share' | 'pending'`
  - `role`: `'owner' | 'coowner' | 'admin' | 'editor' | 'workspace'`
  - `workspace_id`
  - `workspace_name`
  - `board_id`
  - `board_name`
  - `invite_id`: a `pending_invites.id`, or null
  - `sent_at`: `pending_invites.created_at`, or null
- **Notices.** `editors.limit_reached` bodies read either:
  - `Your plan already has 10 people who can edit.` (link), or `Your plan has 10 people who can edit, the most it allows.` (ask), for the owner;
  - the same with `Alex’s plan` or `The owner’s plan` in place of `Your plan`, for a co-owner.
- **The joiner's notice.** `editors.joined_as_viewer` has:
  - title: `You joined “Feature film” as a viewer`
  - body: `Alex’s plan already has 10 people who can edit, so you can view for now. We told Alex.`
  - with no name for the owner, the body reads `Its owner’s plan … We told the owner.`

- [ ] **Step 1: Write the failing tests** in `editorLimitMigration.test.mjs`.

Add `'_editor_limit_owner_first_name(uuid)'` to the helper list in the test `'0520: helpers are revoked, …'`. Then append:

```js
test('the notices are worded as the owner picked (B): whose plan, curly quotes, names', () => {
  const n = def('_notify_editor_limit').body;
  assert.ok(n.includes("'%s has %s people who can edit, the most it allows.'"));
  assert.ok(n.includes("'%s already has %s people who can edit.'"));
  assert.ok(n.includes("'Your plan'"), 'the owner hears "Your plan"');
  assert.ok(n.includes("'’s plan'") && n.includes("'The owner’s plan'"), 'a co-owner hears whose plan');
  assert.ok(n.includes("'“' || coalesce(v_board, v_ws) || '”'"), 'the place sits in curly quotes');
  const j = def('_notify_joined_as_viewer').body;
  assert.ok(j.includes("'%s already has %s people who can edit, so you can view for now. We told %s.'"));
  assert.ok(j.includes("'Its owner’s plan'") && j.includes("'the owner'"));
  for (const b of [n, j]) assert.doesNotMatch(code(b), /'"' \|\|/, 'no straight quotes round a name');
  assert.match(code(def('_editor_limit_owner_first_name').body), /not like '%@%'/, 'an address is never a name');
});

test('the owner\'s list says where each place is, so the app can free it', () => {
  assert.match(def('_account_editor_grants').body,
    /returns table\s*\(\s*user_id uuid,\s*email text,\s*source text,\s*workspace_id uuid,\s*board_id uuid,\s*role text,\s*invite_id uuid,\s*sent_at timestamptz\s*\)/i);
  const d = def('list_my_account_editors');
  assert.match(d.body,
    /returns table\s*\(\s*slot_key text,\s*user_id uuid,\s*email text,\s*display_name text,\s*source text,\s*grants jsonb\s*\)/i);
  const l = code(d.body);
  for (const k of ["'source'", "'role'", "'workspace_id'", "'workspace_name'", "'board_id'", "'board_name'", "'invite_id'", "'sent_at'"])
    assert.ok(l.includes(k), `a grant lacks ${k}`);
});
```

- [ ] **Step 2: Run the tests and see them fail.**
  - Run: `cd boards && node --test src/lib/editorLimitMigration.test.mjs`
  - Expected: FAIL, with the new tests and the helper-revoke test red.

- [ ] **Step 3: Rewrite the 0520 pieces.**

STATUS line (line 4) becomes:

```sql
-- STATUS: written 2026-10-21; notice copy and the owner's list reworked the same
-- day for the owner's pick (B). NOT APPLIED until the owner says go.
```

`_account_editor_grants` becomes:

```sql
create or replace function public._account_editor_grants(p_owner uuid)
returns table (user_id uuid, email text, source text, workspace_id uuid, board_id uuid,
               role text, invite_id uuid, sent_at timestamptz)
language sql
stable
security definer
set search_path = public, auth
as $$
  with ws as (
    select w.id from public.workspaces w where w.created_by = p_owner
  ),
  people as (
    select p_owner as user_id, 'owner'::text as source,
           null::uuid as workspace_id, null::uuid as board_id, 'owner'::text as role
    union all
    select m.user_id, 'member', m.workspace_id, null::uuid, m.role::text
      from public.workspace_members m
     where m.workspace_id in (select ws.id from ws)
       and m.role in ('owner', 'coowner', 'admin', 'editor')
    union all
    select s.user_id, 'share', b.workspace_id, s.board_id, s.role::text
      from public.board_shares s
      join public.boards b on b.id = s.board_id
     where b.workspace_id in (select ws.id from ws)
       and b.deleted_at is null
       and s.role = 'editor'
  )
  select u.id, lower(u.email), pp.source, pp.workspace_id, pp.board_id, pp.role,
         null::uuid, null::timestamptz
    from people pp
    join auth.users u on u.id = pp.user_id
   where not public._user_banned(u.id)
     and not public._is_service_identity(u.id)
  union all
  -- An invite holds its place until it is claimed, expires or is cancelled.
  -- One the outbound breaker holds (0369), or one sent by an account that is
  -- now suspended, will never be delivered, so it holds nothing. Its id and
  -- date let the owner's list revoke it and say when it went.
  select null::uuid, lower(pi.email), 'pending', pi.workspace_id, pi.board_id, pi.role::text,
         pi.id, pi.created_at
    from public.pending_invites pi
   where pi.workspace_id in (select ws.id from ws)
     and pi.role in ('editor', 'workspace')
     and pi.claimed_at is null
     and pi.expires_at > now()
     and pi.held_at is null
     and not public._sharer_suspended(pi.invited_by)
     and (pi.board_id is null
          or exists (select 1 from public.boards b
                      where b.id = pi.board_id and b.deleted_at is null));
$$;
```

Insert this before `_notify_editor_limit`, in section 4:

```sql
-- The account owner's first name, for "Alex’s plan" in the notices a co-owner
-- and a joiner read. Null for no name, or a name that is an address.
create or replace function public._editor_limit_owner_first_name(p_owner uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(split_part(btrim(p.display_name), ' ', 1), '')
    from public.profiles p
   where p.user_id = p_owner
     and p.display_name not like '%@%';
$$;
```

`_notify_editor_limit` changes in four places:
- new `declare` lines;
- `v_where` in curly quotes;
- `v_first` read once;
- `v_plan` per recipient, and the two bodies.

The full function:

```sql
create or replace function public._notify_editor_limit(p_workspace uuid, p_board uuid, p_actor uuid, p_via text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_owner uuid;
  v_ws    text;
  v_board text;
  v_name  text;
  v_where text;
  v_first text;
  v_plan  text;
  r       record;
begin
  select w.created_by, nullif(btrim(w.name), '') into v_owner, v_ws
    from public.workspaces w where w.id = p_workspace;
  if v_owner is null or not public._editor_limit_on(v_owner) then
    return;
  end if;
  if p_board is not null then
    select nullif(btrim(b.name), '') into v_board from public.boards b where b.id = p_board;
  end if;
  v_where := coalesce('“' || coalesce(v_board, v_ws) || '”', 'your workspace');
  select coalesce(nullif(btrim(p.display_name), ''), u.email, 'Someone')
    into v_name
    from auth.users u left join public.profiles p on p.user_id = u.id
   where u.id = p_actor;
  v_name := coalesce(v_name, 'Someone');
  v_first := public._editor_limit_owner_first_name(v_owner);

  for r in
    select v_owner as user_id
    union
    select m.user_id from public.workspace_members m
     where m.workspace_id = p_workspace and m.role = 'coowner'
  loop
    continue when r.user_id is not distinct from p_actor;
    continue when exists (
      select 1 from public.notifications n
       where n.user_id = r.user_id
         and n.kind = 'editors.limit_reached'
         and n.actor_id is not distinct from p_actor
         and n.data ->> 'via' = p_via
         and n.created_at > now() - interval '24 hours');
    -- The owner reads "Your plan"; a co-owner reads whose plan it is.
    v_plan := case when r.user_id = v_owner then 'Your plan'
                   else coalesce(v_first || '’s plan', 'The owner’s plan') end;
    insert into public.notifications (user_id, kind, workspace_id, board_id, actor_id, title, body, data)
    values (
      r.user_id, 'editors.limit_reached', p_workspace, p_board, p_actor,
      case p_via
        when 'ask' then format('%s asked for room to add an editor', v_name)
        else format('%s joined %s as a viewer', v_name, v_where)
      end,
      case p_via
        when 'ask' then format('%s has %s people who can edit, the most it allows.', v_plan, public._editor_limit())
        else format('%s already has %s people who can edit.', v_plan, public._editor_limit())
      end,
      jsonb_build_object('via', p_via, 'editor_limit', public._editor_limit(),
                         'account_owner', r.user_id = v_owner));
  end loop;
exception when others then
  raise warning '_notify_editor_limit failed for %: %', p_workspace, sqlerrm;
end;
$$;
```

`_notify_joined_as_viewer`:

```sql
create or replace function public._notify_joined_as_viewer(p_user uuid, p_workspace uuid, p_board uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_place text;
  v_owner uuid;
  v_first text;
begin
  if exists (select 1 from public.notifications n
              where n.user_id = p_user
                and n.kind = 'editors.joined_as_viewer'
                and n.workspace_id = p_workspace
                and n.board_id is not distinct from p_board
                and n.created_at > now() - interval '24 hours') then
    return;
  end if;
  select coalesce(nullif(btrim(b.name), ''), nullif(btrim(w.name), '')), w.created_by
    into v_place, v_owner
    from public.workspaces w
    left join public.boards b on b.id = p_board
   where w.id = p_workspace;
  v_first := public._editor_limit_owner_first_name(v_owner);
  -- The toast reads "<title>. <body>" (lib/editorLimit.js noticeToastText).
  insert into public.notifications (user_id, kind, workspace_id, board_id, title, body, data)
  values (
    p_user, 'editors.joined_as_viewer', p_workspace, p_board,
    format('You joined %s as a viewer', coalesce('“' || v_place || '”', 'a workspace')),
    format('%s already has %s people who can edit, so you can view for now. We told %s.',
           coalesce(v_first || '’s plan', 'Its owner’s plan'), public._editor_limit(),
           coalesce(v_first, 'the owner')),
    jsonb_build_object('editor_limit', public._editor_limit()));
exception when others then
  raise warning '_notify_joined_as_viewer failed for %: %', p_user, sqlerrm;
end;
$$;
```

`list_my_account_editors`. Replace the comment above it and the function:

```sql
-- The owner's own list: everyone holding a place, plus the invites still
-- waiting, each with every grant that holds it (where, at what role, and for
-- an invite its id and date), so Members can say where someone edits and
-- free the place: make them a viewer, remove them, or revoke the invite.
create or replace function public.list_my_account_editors()
returns table (slot_key text, user_id uuid, email text, display_name text, source text,
               grants jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if auth.uid() is null or not public._actor_active() then
    raise exception 'sign in to see this' using errcode = '42501';
  end if;
  return query
  with g as (
    select * from public._account_editor_grants(auth.uid())
  )
  select s.slot_key, s.user_id, s.email,
         (select nullif(btrim(p.display_name), '') from public.profiles p where p.user_id = s.user_id),
         s.source,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'source', g.source, 'role', g.role,
                    'workspace_id', g.workspace_id, 'workspace_name', w.name,
                    'board_id', g.board_id, 'board_name', b.name,
                    'invite_id', g.invite_id, 'sent_at', g.sent_at)
                  order by g.source, w.name, b.name)
             from g
             left join public.workspaces w on w.id = g.workspace_id
             left join public.boards b on b.id = g.board_id
            where (s.user_id is not null and g.user_id = s.user_id)
               or (s.user_id is null and g.user_id is null and g.email = s.email)
         ), '[]'::jsonb)
    from public._account_editor_slots(auth.uid()) s
   order by (s.source = 'owner') desc, (s.source = 'pending'), s.email;
end;
$$;
```

In section 6, add after the `_editor_limit_on` revoke:

```sql
revoke execute on function public._editor_limit_owner_first_name(uuid) from public, anon, authenticated;
```

In section 7's first array, add `'public._editor_limit_owner_first_name(uuid)',` after `'public._editor_limit_on(uuid)',`.

- [ ] **Step 4: Run the tests and see them pass.**
  - Run: `cd boards && node --test src/lib/editorLimitMigration.test.mjs && npm test`
  - Expected: PASS.

- [ ] **Step 5: Re-run S1a's rolled-back probe.**
  - In the scratchpad's `probe_checks.sql`, change check 20 to also count the rows whose `grants` is a non-empty array. It must equal the row count.
  - Add check 23. It reads the newest `editors.limit_reached` body for the owner and the newest `editors.joined_as_viewer` body for a joiner. Expect `Your plan…` and `…so you can view for now. We told …`.
  - Rebuild: `python3 -I build_probe.py <worktree> <scratchpad>`.
  - Compact the result: strip comment-only lines and indentation to stay under 50k characters.
  - Run it through the Supabase MCP `execute_sql`. Expected: `PROBE_REPORT` with every line `ok`. The block always raises, so the database keeps nothing.

- [ ] **Step 6: Commit** (main session).

```bash
git commit -m "<message>" -- supabase/migrations/0520_editor_limit_core.sql boards/src/lib/editorLimitMigration.test.mjs
```

---

### Task 2: The words and the plans, pure

**Files:**
- Modify: `boards/src/lib/editorLimit.js` (append)
- Modify: `boards/src/lib/editorLimit.test.mjs` (extend the import, append tests)
- Modify: `boards/src/lib/inviteSubmit.js` (append)
- Modify: `boards/src/lib/inviteSubmit.test.mjs` (extend the import, append tests)

**Interfaces.**

Consumes `normalizeEditorCapacity` output: `{enforced, limit, used, pending, taken, left, full, isAccountOwner, subject}`.

Produces, from `lib/editorLimit.js`:

| Function | Returns |
|---|---|
| `editorLimitStage(cap)` | `'over' \| 'full' \| 'near' \| 'room' \| null` |
| `editorLimitFull(cap)` | boolean |
| `firstName(name)` | string or null |
| `ownerPlan(ownerName, { start })` | string |
| `editorLimitNote(cap, { ownerName, asked })` | null, or `{ stage, lead, body, seeWho: 'link' \| 'button' \| null, ask: string \| null, done: string \| null }` |
| `editorLimitRefusalMessage(refusal, { ownerName, limit })` | string |
| `noticeToastText(n)` | string |
| `missedJoinedAsViewer(rows, { now, toasted })` | rows |
| `accountHolders(rows)` | `{ ids: Set, emails: Set }` |
| `holdsPlace(holders, { userId, email })` | boolean |
| `accountEditorSub(row)` | string |
| `makeViewerOps(row)`, `removeOps(row)`, `revokeOps(row)` | ops: `{op:'member_role', workspaceId, userId, role}` \| `{op:'share_role', boardId, email, role}` \| `{op:'unshare', boardId, userId}` \| `{op:'remove_member', workspaceId, userId}` \| `{op:'revoke', inviteId}` |

Produces, from `lib/inviteSubmit.js`:
- `runInvitesByRole(byRole, sendFor)` returns `{ runs: [{ role, granted, pending, fail }], budget: null | { reason, unsent }, editors: null | { ask, reason, unsent } }`.

- [ ] **Step 1: Write the failing tests.**

In `editorLimit.test.mjs`, replace the import with:

```js
import {
  EDITOR_LIMIT, EDITOR_LIMIT_HINT, EDITOR_LIMIT_ASK_HINT,
  editorLimitRefusal, normalizeEditorCapacity,
  editorLimitStage, editorLimitFull, firstName, ownerPlan, editorLimitNote, editorLimitRefusalMessage,
  noticeToastText, missedJoinedAsViewer, accountHolders, holdsPlace,
  accountEditorSub, makeViewerOps, removeOps, revokeOps,
} from './editorLimit.js';
```

Then append:

```js
const cap = (over) => normalizeEditorCapacity({
  enforced: true, editor_limit: 10, used: 8, pending: 0, is_full: false,
  i_am_account_owner: true, subject: 'account', ...over,
});

test('the stage: room, near at two left, full, over; null while off or unknown', () => {
  assert.equal(editorLimitStage(null), null);
  assert.equal(editorLimitStage(cap({ enforced: false })), null);
  assert.equal(editorLimitStage(cap({ used: 7 })), 'room');
  assert.equal(editorLimitStage(cap({ used: 8 })), 'near');
  assert.equal(editorLimitStage(cap({ used: 9 })), 'near');
  assert.equal(editorLimitStage(cap({ used: 9, pending: 1, is_full: true })), 'full');
  assert.equal(editorLimitStage(cap({ used: 12, is_full: true })), 'over');
  assert.equal(editorLimitFull(cap({ used: 10, is_full: true })), true);
  assert.equal(editorLimitFull(cap({ used: 12, is_full: true })), true);
  assert.equal(editorLimitFull(cap({ used: 9 })), false);
  assert.equal(editorLimitFull(null), false);
});

test('a first name, never an address or a stand-in; whose plan', () => {
  assert.equal(firstName('Alex Moreau'), 'Alex');
  assert.equal(firstName('  Maya  '), 'Maya');
  assert.equal(firstName('alex@moreau.studio'), null);
  assert.equal(firstName('Member'), null);
  assert.equal(firstName('You'), null);
  assert.equal(firstName(''), null);
  assert.equal(firstName(null), null);
  assert.equal(ownerPlan('Alex'), 'Alex’s plan');
  assert.equal(ownerPlan(null), 'the owner’s plan');
  assert.equal(ownerPlan(null, { start: true }), 'The owner’s plan');
});

test('the owner hears from two places left, in the words of the pick', () => {
  assert.equal(editorLimitNote(cap({ used: 7 })), null);
  assert.deepEqual(editorLimitNote(cap({ used: 8 })), {
    stage: 'near', lead: '2 places left for people who can edit.',
    body: 'Your plan has room for 10, across all your workspaces.', seeWho: 'link', ask: null, done: null,
  });
  assert.equal(editorLimitNote(cap({ used: 9 })).lead, '1 place left for people who can edit.');
  assert.deepEqual(editorLimitNote(cap({ used: 10, is_full: true })), {
    stage: 'full', lead: 'No places left for people who can edit.',
    body: 'Your plan has room for 10, across all your workspaces. Invite people to view, or make room.',
    seeWho: 'button', ask: null, done: null,
  });
  assert.deepEqual(editorLimitNote(cap({ used: 12, is_full: true })), {
    stage: 'over', lead: '12 people can edit, and your plan has room for 10.',
    body: 'Everyone keeps editing. Nobody new can edit until you’re under 10.',
    seeWho: 'button', ask: null, done: null,
  });
});

test('anyone else hears once it is full, and can ask the owner by name', () => {
  const ed = (over) => cap({ i_am_account_owner: false, ...over });
  assert.equal(editorLimitNote(ed({ used: 9 }), { ownerName: 'Alex' }), null, 'near is the owner’s news');
  assert.deepEqual(editorLimitNote(ed({ used: 10, is_full: true }), { ownerName: 'Alex' }), {
    stage: 'full', lead: 'No places left for people who can edit.',
    body: 'Alex’s plan has room for 10. Invite people to view, or ask Alex to make room.',
    seeWho: null, ask: 'Ask Alex for room', done: null,
  });
  const asked = editorLimitNote(ed({ used: 10, is_full: true }), { ownerName: 'Alex', asked: true });
  assert.equal(asked.ask, null);
  assert.equal(asked.done, 'We told Alex you’d like to add an editor.');
  const nameless = editorLimitNote(ed({ used: 11, is_full: true }));
  assert.equal(nameless.stage, 'over');
  assert.equal(nameless.body, 'The owner’s plan has room for 10. Invite people to view, or ask the owner to make room.');
  assert.equal(nameless.ask, 'Ask the owner for room');
});

test('a refusal, as one sentence', () => {
  assert.equal(editorLimitRefusalMessage({ ask: false }),
    'No places left for people who can edit: your plan has room for 10. Invite them to view, or make room.');
  assert.equal(editorLimitRefusalMessage({ ask: true }, { ownerName: 'Alex' }),
    'No places left for people who can edit: Alex’s plan has room for 10. Invite them to view, or ask Alex to make room.');
  assert.equal(editorLimitRefusalMessage({ ask: true }),
    'No places left for people who can edit: the owner’s plan has room for 10. Invite them to view, or ask the owner to make room.');
  assert.equal(editorLimitRefusalMessage(null), '');
});

test('a notice toasts as title — body, and the joiner’s as two sentences', () => {
  assert.equal(noticeToastText({ kind: 'editors.limit_reached', title: 'Rosa Vidal joined “Feature film” as a viewer', body: 'Your plan already has 10 people who can edit.' }),
    'Rosa Vidal joined “Feature film” as a viewer — Your plan already has 10 people who can edit.');
  assert.equal(noticeToastText({ kind: 'editors.joined_as_viewer', title: 'You joined “Feature film” as a viewer', body: 'Alex’s plan already has 10 people who can edit, so you can view for now. We told Alex.' }),
    'You joined “Feature film” as a viewer. Alex’s plan already has 10 people who can edit, so you can view for now. We told Alex.');
  assert.equal(noticeToastText({ kind: 'file.shared', title: 'Lena shared a file', body: '' }), 'Lena shared a file');
});

test('the joined-as-viewer notices a first load missed: unread, from the last day, not toasted, newest first', () => {
  const now = Date.parse('2026-10-21T12:00:00Z');
  const row = (id, hoursAgo, extra = {}) => ({
    id, kind: 'editors.joined_as_viewer', read_at: null,
    created_at: new Date(now - hoursAgo * 3600e3).toISOString(), ...extra,
  });
  const rows = [row('a', 1), row('b', 3), row('c', 30), row('d', 2, { read_at: '2026-10-21T11:00:00Z' }),
    row('e', 1, { kind: 'editors.limit_reached' }), row('f', 0.5)];
  assert.deepEqual(missedJoinedAsViewer(rows, { now, toasted: new Set(['f']) }).map((n) => n.id), ['a', 'b']);
  assert.deepEqual(missedJoinedAsViewer(null, { now }), []);
});

test('who holds a place: by account, or by address for a waiting invite', () => {
  const h = accountHolders([{ user_id: 'u1', email: 'Lena@castbox.io' }, { user_id: null, email: 'kai@northlight.tv' }]);
  assert.equal(holdsPlace(h, { userId: 'u1' }), true);
  assert.equal(holdsPlace(h, { email: 'lena@CASTBOX.io' }), true);
  assert.equal(holdsPlace(h, { email: ' kai@northlight.tv ' }), true);
  assert.equal(holdsPlace(h, { userId: 'u2', email: 'x@y.co' }), false);
  assert.equal(holdsPlace(null, { userId: 'u1' }), false);
});

const G = (o) => ({
  source: 'member', role: 'editor', workspace_id: 'w1', workspace_name: 'Studio',
  board_id: null, board_name: null, invite_id: null, sent_at: null, ...o,
});

test('a row says where its person can edit, the widest place first', () => {
  assert.equal(accountEditorSub({ source: 'owner', email: 'alex@moreau.studio', grants: [] }), 'alex@moreau.studio · every workspace');
  assert.equal(accountEditorSub({ source: 'member', email: 's@o.studio', grants: [G({ role: 'coowner' })] }), 'Co-owner of Studio');
  assert.equal(accountEditorSub({ source: 'member', email: 'm@l.co', grants: [G({})] }), 'Edits Studio');
  assert.equal(accountEditorSub({ source: 'share', email: 'l@c.io', grants: [G({ source: 'share', board_id: 'b1', board_name: 'Feature film' })] }),
    'Can edit “Feature film” in Studio');
  assert.equal(accountEditorSub({ source: 'share', email: 'n@h.co', grants: [
    G({ source: 'share', board_id: 'b2', board_name: 'Casting' }), G({ workspace_name: 'Commercials', workspace_id: 'w2' }),
  ] }), 'Edits Commercials, and 1 more');
  const sent = '2026-10-19T15:00:00Z';
  const day = new Date(sent).toLocaleDateString();
  assert.equal(accountEditorSub({ source: 'pending', email: 'kai@northlight.tv', grants: [G({ source: 'pending', role: 'workspace', invite_id: 'i1', sent_at: sent })] }),
    `Invited to edit Studio · sent ${day} · holds a place until it’s accepted`);
  assert.equal(accountEditorSub({ source: 'pending', email: 'd@l.co', grants: [G({ source: 'pending', role: 'editor', board_id: 'b1', board_name: 'Feature film', invite_id: 'i2', sent_at: sent })] }),
    `Invited to edit “Feature film” in Studio · sent ${day} · holds a place until it’s accepted`);
});

test('freeing a place: Make viewer keeps them in, Remove takes shares first, Revoke cancels the invites', () => {
  const row = { user_id: 'u1', email: 'ben@a.co', source: 'member', grants: [
    G({ role: 'coowner' }),
    G({ source: 'share', role: 'editor', workspace_id: 'w2', board_id: 'b1', board_name: 'Music video' }),
    G({ role: 'owner', workspace_id: 'w3' }),
  ] };
  assert.deepEqual(makeViewerOps(row), [
    { op: 'member_role', workspaceId: 'w1', userId: 'u1', role: 'viewer' },
    { op: 'share_role', boardId: 'b1', email: 'ben@a.co', role: 'viewer' },
  ]);
  assert.deepEqual(removeOps(row), [
    { op: 'unshare', boardId: 'b1', userId: 'u1' },
    { op: 'remove_member', workspaceId: 'w1', userId: 'u1' },
  ]);
  const inv = { user_id: null, email: 'kai@n.tv', source: 'pending', grants: [
    G({ source: 'pending', role: 'workspace', invite_id: 'i1' }),
    G({ source: 'pending', role: 'editor', board_id: 'b1', invite_id: 'i2' }),
  ] };
  assert.deepEqual(revokeOps(inv), [{ op: 'revoke', inviteId: 'i1' }, { op: 'revoke', inviteId: 'i2' }]);
  assert.deepEqual(makeViewerOps(inv), []);
  assert.deepEqual(removeOps(inv), []);
});
```

In `inviteSubmit.test.mjs`, change the import to:

```js
import { parseEmails, runInvites, runInvitesByRole, inviteLimitReason, inviteLimitKind } from './inviteSubmit.js';
```

Then append:

```js
test('by role: the editor limit stops the editors, and the viewers still go out', async () => {
  const sent = [];
  const why = 'editor limit reached: you have 10 people who can edit across your workspaces, the most a personal plan allows';
  const sendFor = (role) => async (email) => {
    sent.push(`${role}:${email}`);
    if (role === 'editor' && email === 'b@x.io') throw Object.assign(new Error(why), { hint: 'editor_limit' });
    return 'pending';
  };
  const r = await runInvitesByRole({ editor: ['a@x.io', 'b@x.io', 'c@x.io'], viewer: ['v@x.io'] }, sendFor);
  assert.deepEqual(sent, ['editor:a@x.io', 'editor:b@x.io', 'viewer:v@x.io']);
  assert.deepEqual(r.runs.map((x) => [x.role, x.pending]), [['editor', ['a@x.io']], ['viewer', ['v@x.io']]]);
  assert.equal(r.budget, null);
  assert.deepEqual(r.editors, { ask: false, reason: why, unsent: ['b@x.io', 'c@x.io'] });
});

test('by role: the invite budget stops everything after it, viewers included', async () => {
  const sendFor = () => async (email) => {
    if (email === 'b@x.io') throw new Error('invite limit reached: try tomorrow');
    return 'granted';
  };
  const r = await runInvitesByRole({ editor: ['a@x.io', 'b@x.io'], viewer: ['v@x.io', 'w@x.io'] }, sendFor);
  assert.deepEqual(r.runs.map((x) => x.role), ['editor']);
  assert.deepEqual(r.budget, { reason: 'try tomorrow', unsent: ['b@x.io', 'v@x.io', 'w@x.io'] });
  assert.equal(r.editors, null);
});

test('by role: an empty role is skipped, and what it was given is left as it was', async () => {
  const byRole = { editor: [], viewer: ['v@x.io'] };
  const r = await runInvitesByRole(byRole, () => async () => 'granted');
  assert.deepEqual(r.runs, [{ role: 'viewer', granted: ['v@x.io'], pending: [], fail: [] }]);
  assert.deepEqual(byRole, { editor: [], viewer: ['v@x.io'] });
});
```

- [ ] **Step 2: Run the tests and see them fail.**
  - Run: `cd boards && node --test src/lib/editorLimit.test.mjs src/lib/inviteSubmit.test.mjs`
  - Expected: FAIL. The import names don't exist.

- [ ] **Step 3: Write the code.**

Append to `boards/src/lib/editorLimit.js`:

```js

// Where an account stands against the limit: 'over' (more than the limit,
// after a transfer or a restore: everyone keeps editing, nobody new joins),
// 'full', 'near' (two places or fewer left), 'room', or null while unknown or
// off.
export function editorLimitStage(cap) {
  if (!cap || !cap.enforced) return null;
  if (cap.taken > cap.limit) return 'over';
  if (cap.full || cap.taken >= cap.limit) return 'full';
  if (cap.limit - cap.taken <= 2) return 'near';
  return 'room';
}

// No room for anyone new to edit: full, or over.
export function editorLimitFull(cap) {
  const s = editorLimitStage(cap);
  return s === 'full' || s === 'over';
}

// "Alex" out of "Alex Moreau", for "Alex’s plan". null for nothing, an
// address, or a stand-in that names nobody (the share panel says "Member"
// and "You" when it has no name).
export function firstName(name) {
  const s = String(name ?? '').trim();
  if (!s || s.includes('@') || s === 'Member' || s === 'You') return null;
  return s.split(/\s+/)[0];
}

// "Alex’s plan", or "the owner’s plan" when we don't know their name.
export function ownerPlan(ownerName, { start = false } = {}) {
  if (ownerName) return `${ownerName}’s plan`;
  return start ? 'The owner’s plan' : 'the owner’s plan';
}

// The note at the top of the share panel's invite area (the owner's pick B,
// 2026-10-21), or null when there is nothing to say. Only the account's owner
// hears that places are running low; anyone else hears once there are none,
// and can ask the owner for room.
//   → { stage, lead, body, seeWho: 'link'|'button'|null, ask: label|null, done: line|null }
export function editorLimitNote(cap, { ownerName = null, asked = false } = {}) {
  const stage = editorLimitStage(cap);
  if (!stage || stage === 'room') return null;
  const { limit, taken } = cap;
  if (cap.isAccountOwner) {
    if (stage === 'over') {
      return {
        stage, lead: `${taken} people can edit, and your plan has room for ${limit}.`,
        body: `Everyone keeps editing. Nobody new can edit until you’re under ${limit}.`,
        seeWho: 'button', ask: null, done: null,
      };
    }
    if (stage === 'full') {
      return {
        stage, lead: 'No places left for people who can edit.',
        body: `Your plan has room for ${limit}, across all your workspaces. Invite people to view, or make room.`,
        seeWho: 'button', ask: null, done: null,
      };
    }
    const left = limit - taken;
    return {
      stage, lead: `${left} ${left === 1 ? 'place' : 'places'} left for people who can edit.`,
      body: `Your plan has room for ${limit}, across all your workspaces.`,
      seeWho: 'link', ask: null, done: null,
    };
  }
  if (stage === 'near') return null;
  const who = ownerName || 'the owner';
  return {
    stage,
    lead: 'No places left for people who can edit.',
    body: `${ownerPlan(ownerName, { start: true })} has room for ${limit}. Invite people to view, or ask ${who} to make room.`,
    seeWho: null,
    ask: asked ? null : `Ask ${who} for room`,
    done: asked ? `We told ${who} you’d like to add an editor.` : null,
  };
}

// A door's refusal (editorLimitRefusal) as one sentence for a toast.
export function editorLimitRefusalMessage(refusal, { ownerName = null, limit = EDITOR_LIMIT } = {}) {
  if (!refusal) return '';
  if (!refusal.ask) {
    return `No places left for people who can edit: your plan has room for ${limit}. Invite them to view, or make room.`;
  }
  return `No places left for people who can edit: ${ownerPlan(ownerName)} has room for ${limit}. Invite them to view, or ask ${ownerName || 'the owner'} to make room.`;
}

// A live notice as its toast says it: "title — body", except the person an
// edit link let in as a viewer, who reads two sentences (0520's copy).
export function noticeToastText(n) {
  const title = String(n?.title ?? '');
  const body = String(n?.body ?? '');
  if (!body) return title;
  return n?.kind === 'editors.joined_as_viewer' ? `${title}. ${body}` : `${title} — ${body}`;
}

// The joined-as-viewer notices a first load finds unseen: an edit link is
// claimed before the app subscribes to its pings. Unread, from the last day,
// not toasted already; newest first.
export function missedJoinedAsViewer(rows, { now = Date.now(), toasted = null } = {}) {
  const DAY = 24 * 3600 * 1000;
  return (Array.isArray(rows) ? rows : [])
    .filter((n) => n && n.kind === 'editors.joined_as_viewer' && !n.read_at
      && !(toasted && toasted.has(n.id))
      && now - Date.parse(n.created_at) < DAY)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

// Who holds a place, from the owner's list (list_my_account_editors). A
// viewer who edits somewhere else in the account can be made an editor here
// without taking another place, so the app keeps "Can edit" open for them.
export function accountHolders(rows) {
  const ids = new Set();
  const emails = new Set();
  for (const r of rows || []) {
    if (r?.user_id) ids.add(r.user_id);
    if (r?.email) emails.add(String(r.email).trim().toLowerCase());
  }
  return { ids, emails };
}

export function holdsPlace(holders, { userId = null, email = null } = {}) {
  if (!holders) return false;
  if (userId && holders.ids.has(userId)) return true;
  return !!email && holders.emails.has(String(email).trim().toLowerCase());
}

// ── The owner's list in Settings › Members ─────────────────────────────────
// A row is list_my_account_editors' (0520): { slot_key, user_id, email,
// display_name, source, grants: [{ source, role, workspace_id,
// workspace_name, board_id, board_name, invite_id, sent_at }] }.

const MEMBER_RANK = { owner: 0, coowner: 0, admin: 1, editor: 1 };
const grantRank = (g) => (g.source === 'member' ? (MEMBER_RANK[g.role] ?? 1) : g.source === 'share' ? 2 : 3);
const EDITING_MEMBER = ['coowner', 'admin', 'editor'];

function grantPhrase(g) {
  const ws = g.workspace_name || 'a workspace';
  const board = g.board_name ? `“${g.board_name}”` : 'a cluster';
  if (g.source === 'member') return g.role === 'coowner' || g.role === 'owner' ? `Co-owner of ${ws}` : `Edits ${ws}`;
  if (g.source === 'share') return `Can edit ${board} in ${ws}`;
  return g.board_id ? `Invited to edit ${board} in ${ws}` : `Invited to edit ${ws}`;
}

// The line under a person in "People who can edit": where they can edit, the
// widest place first, and for a waiting invite when it went and what it holds.
export function accountEditorSub(row) {
  if (!row) return '';
  if (row.source === 'owner') return `${row.email} · every workspace`;
  const grants = (row.grants || []).filter((g) => g && g.source !== 'owner')
    .slice().sort((a, b) => grantRank(a) - grantRank(b));
  if (grants.length === 0) return row.email || '';
  let s = grantPhrase(grants[0]);
  if (grants.length > 1) s += `, and ${grants.length - 1} more`;
  if (row.source === 'pending') {
    const sent = grants.map((g) => g.sent_at).filter(Boolean).sort()[0];
    if (sent) s += ` · sent ${new Date(sent).toLocaleDateString()}`;
    s += ' · holds a place until it’s accepted';
  }
  return s;
}

// What freeing one person's place does, as calls AccountEditorsCard makes.
// Make viewer: every place they can edit becomes one they can view, so they
// keep everything they could open.
export function makeViewerOps(row) {
  const ops = [];
  for (const g of row?.grants || []) {
    if (g.source === 'member' && EDITING_MEMBER.includes(g.role)) {
      ops.push({ op: 'member_role', workspaceId: g.workspace_id, userId: row.user_id, role: 'viewer' });
    } else if (g.source === 'share') {
      ops.push({ op: 'share_role', boardId: g.board_id, email: row.email, role: 'viewer' });
    }
  }
  return ops;
}

// Remove: their cluster shares first, then their memberships. Removing a
// member drops their shares in that workspace too (0318), so the other order
// would fail on rows already gone.
export function removeOps(row) {
  const grants = row?.grants || [];
  return [
    ...grants.filter((g) => g.source === 'share')
      .map((g) => ({ op: 'unshare', boardId: g.board_id, userId: row.user_id })),
    ...grants.filter((g) => g.source === 'member' && EDITING_MEMBER.includes(g.role))
      .map((g) => ({ op: 'remove_member', workspaceId: g.workspace_id, userId: row.user_id })),
  ];
}

// Revoke: every invite holding that address's place.
export function revokeOps(row) {
  return (row?.grants || []).filter((g) => g.source === 'pending' && g.invite_id)
    .map((g) => ({ op: 'revoke', inviteId: g.invite_id }));
}
```

Append to `boards/src/lib/inviteSubmit.js`:

```js

// Send a list split by role, editors first. The invite budget stops the whole
// list: past it every address is refused the same way, so whatever it never
// reached comes back in budget.unsent. The editor limit (0521) stops only the
// editors: viewers never take a place, so they still go out.
//   byRole: { editor: [email], viewer: [email] }; sendFor(role) → send(email)
//   → { runs: [{ role, granted, pending, fail }],
//       budget: null | { reason, unsent: [email] },
//       editors: null | { ask, reason, unsent: [email] } }
export async function runInvitesByRole(byRole, sendFor) {
  const runs = [];
  let budget = null;
  let editors = null;
  for (const role of ['editor', 'viewer']) {
    const emails = Array.isArray(byRole?.[role]) ? byRole[role] : [];
    if (emails.length === 0) continue;
    if (budget) { budget.unsent.push(...emails); continue; }
    const r = await runInvites(emails, sendFor(role));
    runs.push({ role, granted: r.granted, pending: r.pending, fail: r.fail });
    if (r.limit?.kind === 'editors') editors = { ask: r.limit.ask, reason: r.limit.reason, unsent: [...r.limit.unsent] };
    else if (r.limit) budget = { reason: r.limit.reason, unsent: [...r.limit.unsent] };
  }
  return { runs, budget, editors };
}
```

- [ ] **Step 4: Run the tests and see them pass.**
  - Run: `cd boards && node --test src/lib/editorLimit.test.mjs src/lib/inviteSubmit.test.mjs && npm test`
  - Expected: PASS.

- [ ] **Step 5: Report** the four changed files. The main session commits them.

---

### Task 3: The share panel at the limit

**Files:**
- Create: `boards/src/hooks/useEditorLimit.js`
- Create: `boards/src/components/EditorLimitNote.jsx`
- Modify: `boards/src/components/ShareModal.jsx`
- Modify: `boards/src/styles.css`, in two places:
  - after line 2530, `.share-reward-more .share-linkish {…}`;
  - in the phone block, after `.share-foot-btn { min-height: 44px; … }` (line ~21577).
- Modify: `boards/src/lib/analyticsEvents.js`, after `EDITOR_LIMIT_VIEWER_FALLBACK` (line ~485).
- Modify: `boards/src/App.jsx`, the `<ShareModal` props (line ~11580).

**Interfaces:**
- **Consumes, from Task 2:** `editorLimitStage`, `editorLimitFull`, `editorLimitNote`, `editorLimitRefusal`, `editorLimitRefusalMessage`, `firstName`, `ownerPlan`, `accountHolders`, `holdsPlace`.
- **Consumes, from `lib/inviteSubmit.js`:** `parseEmails`.
- **Consumes, from `boardsApi`:** `getEditorCapacity`, `listMyAccountEditors`, `askOwnerForEditorSlot`.
- **Produces `useEditorLimit({ boardId, workspaceId, enabled, list })`.** It returns `{ cap, editors, holders, refresh }`:
  - `list`: `'full'` (the default) or `'always'`;
  - `refresh()`: returns a Promise.
- **Produces `<EditorLimitNote note onSeeWho onAsk asking />`.**
- **Produces the ShareModal prop `onSeeEditors(workspaceId)`.**
- **Produces EV keys:** `EDITOR_LIMIT_SEEN`, `EDITOR_LIMIT_REFUSED`, `EDITOR_LIMIT_ASK_SENT`, `EDITOR_LIMIT_SEE_WHO`.

- [ ] **Step 1: Create `boards/src/hooks/useEditorLimit.js`.**

```js
// useEditorLimit — the 10-editor limit for one cluster's or workspace's
// account, as the share panel and Members read it (held: editorLimitAllowed).
//
// cap is get_editor_capacity's numbers (lib/editorLimit.js
// normalizeEditorCapacity), or null while unknown, off, or held: callers treat
// null as room, because the server refuses anyway. With the hold off nothing
// is fetched at all (0520 isn't applied while it is held).
//
// The account's owner also gets the list of who holds the places
// (list_my_account_editors): always for Members, which draws it, and only once
// the account is full for the share panel, which reads it for "already holds a
// place". A viewer who edits elsewhere in the account can be made an editor
// here without taking another place.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getEditorCapacity, listMyAccountEditors } from '../lib/boardsApi.js';
import { editorLimitAllowed } from '../lib/appHost.js';
import { accountHolders, editorLimitFull } from '../lib/editorLimit.js';

export function useEditorLimit({ boardId = null, workspaceId = null, enabled = true, list = 'full' } = {}) {
  const [cap, setCap] = useState(null);
  const [editors, setEditors] = useState([]);
  const seq = useRef(0);
  const on = !!enabled && editorLimitAllowed() && !!(boardId || workspaceId);

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    if (!on) { setCap(null); setEditors([]); return null; }
    let next = null;
    try { next = await getEditorCapacity({ boardId, workspaceId }); } catch (_) { next = null; }
    if (mine !== seq.current) return next;
    setCap(next);
    const wantList = !!next?.enforced && next.isAccountOwner
      && (list === 'always' || editorLimitFull(next));
    if (!wantList) { setEditors([]); return next; }
    try {
      const rows = await listMyAccountEditors();
      if (mine === seq.current) setEditors(rows);
    } catch (_) {
      if (mine === seq.current) setEditors([]);
    }
    return next;
  }, [on, boardId, workspaceId, list]);

  useEffect(() => { refresh(); }, [refresh]);

  const holders = useMemo(() => accountHolders(editors), [editors]);
  return { cap, editors, holders, refresh };
}
```

- [ ] **Step 2: Create `boards/src/components/EditorLimitNote.jsx`.**

```jsx
// EditorLimitNote — the note at the top of the share panel's invite area (the
// owner's pick B, 2026-10-21). lib/editorLimit.js editorLimitNote says what it
// reads; this draws it. Ink on the panel's raised ground: the limit is news,
// not an action, so nothing here is gold.
import { Users as UsersIcon, Check as CheckIcon } from '../lib/icons.js';
import { Icon as Glyph } from './Icon.jsx';

export function EditorLimitNote({ note, onSeeWho = null, onAsk = null, asking = false }) {
  if (!note) return null;
  const seeWhoButton = note.seeWho === 'button' && onSeeWho;
  const askButton = note.ask && onAsk;
  return (
    <div className="lim-note" role="status">
      <span className="lim-note-icon" aria-hidden="true"><Glyph as={UsersIcon} size={15} weight="regular" /></span>
      <div className="lim-note-text">
        <span className="lim-note-lead">{note.lead}</span> {note.body}
        {note.seeWho === 'link' && onSeeWho && (
          <> <button type="button" className="share-linkish" onClick={onSeeWho}>See who</button></>
        )}
        {(seeWhoButton || askButton) && (
          <div className="lim-note-acts">
            {seeWhoButton && (
              <button type="button" className="lim-btn" onClick={onSeeWho}>See who can edit</button>
            )}
            {askButton && (
              <button type="button" className="lim-btn" onClick={onAsk} disabled={asking}>
                {asking ? 'Asking…' : note.ask}
              </button>
            )}
          </div>
        )}
        {note.done && (
          <div className="lim-line lim-done">
            <Glyph as={CheckIcon} size={13} weight="regular" />{note.done}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add the CSS.**

In `boards/src/styles.css`, insert after the line `.share-reward-more .share-linkish { font: 600 11.5px/1.4 var(--font-sans); }`:

```css

/* The 10-editor limit's note, at the top of the invite area (the owner's pick
   B, 2026-10-21): from two places left for the account's owner, and once
   there are none for anyone who can invite. The reward note's strip on the
   panel's raised ground; the limit is news, not an action, so nothing in it
   is gold. */
.lim-note {
  display: flex; align-items: flex-start; gap: 8px;
  margin-bottom: 12px;
  padding: 9px 10px;
  border-radius: var(--radius);
  background: var(--bg-2);
}
.lim-note-icon { flex: 0 0 auto; display: inline-flex; color: var(--ink-1); margin-top: 2px; }
.lim-note-text { flex: 1 1 auto; min-width: 0; font: 500 12.5px/1.45 var(--font-sans); color: var(--ink-2); }
.lim-note-lead { font-weight: 600; color: var(--ink-0); }
.lim-note-acts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px; }
.lim-btn {
  appearance: none;
  background: var(--bg-3);
  border: 1px solid var(--line-2);
  border-radius: var(--radius);
  color: var(--ink-0);
  font: 600 12px/1 var(--font-sans);
  padding: 7px 12px;
  cursor: pointer;
}
.lim-btn:hover { background: var(--bg-hov); }
.lim-btn:disabled { opacity: .6; cursor: default; }
.lim-line { margin-top: 7px; font: 400 12px/1.5 var(--font-sans); color: var(--ink-2); }
.lim-done { display: flex; align-items: center; gap: 6px; color: var(--ink-1); }
```

In the phone block, after `.share-foot-btn { min-height: 44px; padding-left: 16px; padding-right: 16px; }`, add:

```css
  .lim-btn { min-height: 40px; padding-left: 14px; padding-right: 14px; }
```

- [ ] **Step 4: Add the EV keys.**

In `boards/src/lib/analyticsEvents.js`, after the `EDITOR_LIMIT_VIEWER_FALLBACK` line:

```js
  // The 10-editor limit in the app (held: editorLimitAllowed). Counts and
  // stages only: no address, name or token rides these.
  EDITOR_LIMIT_SEEN:       'editor_limit_seen',           // the share panel's note or Members' "People who can edit" showed {surface:'share_modal'|'members', stage:'near'|'full'|'over'|'room', owner}
  EDITOR_LIMIT_REFUSED:    'editor_limit_refused',        // a door said no for want of room {door:'share'|'workspace_invite'|'member_role'|'share_role'|'restore'|'widen', ask (the caller isn't the owner), surface}
  EDITOR_LIMIT_ASK_SENT:   'editor_limit_ask_sent',       // "Ask Alex for room" {result:'sent'|'already_sent'|'not_full'|'owner'|'error', surface}
  EDITOR_LIMIT_SEE_WHO:    'editor_limit_see_who',        // the note's See who opened Members {surface, stage}
```

- [ ] **Step 5: Wire ShareModal.**

Apply these replacements in `boards/src/components/ShareModal.jsx`. Each "old" is unique in the file.

(a) Header comment. Old:

```js
//   1. Invite — email, then "Can edit ▾ in This cluster | Whole workspace", a
//      line saying by name what that grants, and what inviting someone NEW
//      earns (InviteRewardNote)
```

New:

```js
//   1. Invite — email, then "Can edit ▾ in This cluster | Whole workspace", a
//      line saying by name what that grants, and what inviting someone NEW
//      earns (InviteRewardNote). Above it, near or at the 10-editor limit, a
//      note says so (EditorLimitNote, the owner's pick B, 2026-10-21)
```

(b) Imports. Old:

```js
  listPendingInvitesForBoard, listPendingInvitesForWorkspace,
  revokePendingInvite,
} from '../lib/boardsApi.js';
```

New:

```js
  listPendingInvitesForBoard, listPendingInvitesForWorkspace,
  revokePendingInvite, askOwnerForEditorSlot,
} from '../lib/boardsApi.js';
```

Old:

```js
import { ASSIGNABLE_ROLES } from '../lib/workspaceRoles.js';
```

New:

```js
import { ASSIGNABLE_ROLES } from '../lib/workspaceRoles.js';
import { parseEmails } from '../lib/inviteSubmit.js';
import {
  editorLimitNote, editorLimitFull, editorLimitRefusal, editorLimitRefusalMessage,
  firstName, holdsPlace, ownerPlan,
} from '../lib/editorLimit.js';
import { editorLimitAllowed } from '../lib/appHost.js';
import { useEditorLimit } from '../hooks/useEditorLimit.js';
import { EditorLimitNote } from './EditorLimitNote.jsx';
```

(c) Prop. Old:

```js
  loadReferralStats = null,
  onOpenInvites = null,
}) {
```

New:

```js
  loadReferralStats = null,
  onOpenInvites = null,
  // The editor limit's See who: the app closes the panel and opens Settings ›
  // Members, where the owner's list of people who can edit is. Takes the id
  // of the workspace the panel is about.
  onSeeEditors = null,
}) {
```

(d) The hook and the ask state. Old:

```js
  const rewardNote = rewardTier === 'demo' ? 'free' : 'paid';
```

New:

```js
  const rewardNote = rewardTier === 'demo' ? 'free' : 'paid';
  // The 10-editor limit (0520, held: editorLimitAllowed). Only people who can
  // invite read it; null while unknown or off, which reads as room.
  const editorLimit = useEditorLimit({ boardId: board?.id || null, enabled: canInvite });
  const limitCap = editorLimit.cap;
  const editFull = editorLimitFull(limitCap);
  const [askState, setAskState] = useState(null);   // null | 'asking' | 'sent'
```

(e) What the invite sends. Old:

```js
  const inviteRole = isManager && inviteScope === 'workspace'
    ? (inviteAccess === 'viewer' ? 'workspaceviewer' : 'workspace')
    : inviteAccess;
```

New:

```js
  // While the account has no room, "Can edit" is off for anyone new and the
  // invite goes out to view. Addresses that already hold a place (the owner's
  // list says so) can still be asked to edit: that takes no place.
  const typedEmails = parseEmails(inviteEmail).valid;
  const typedHoldPlaces = typedEmails.length > 0
    && typedEmails.every((e) => holdsPlace(editorLimit.holders, { email: e }));
  const editLocked = editFull && !typedHoldPlaces;
  const access = editLocked ? 'viewer' : inviteAccess;
  const inviteRole = isManager && inviteScope === 'workspace'
    ? (access === 'viewer' ? 'workspaceviewer' : 'workspace')
    : access;
```

(f) Delete the component's own `parseEmails`. The import replaces it, and a local `const` of the same name declared later would put the use in (e) in its temporal dead zone. Old (delete all of it):

```js
  // Parse a free-form email field that may contain one or many
  // addresses separated by commas, semicolons, whitespace, or newlines.
  // Loose validation: anything with "@" and a dot in the domain part.
  // Invalid entries are surfaced (not silently dropped) so a typo'd
  // address never looks like it was invited.
  const parseEmails = (raw) => {
    const parts = raw.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
    const valid = parts.filter(s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
    const invalid = parts.filter(s => !valid.includes(s));
    // The same address twice in a paste is one person, and one invite.
    const seen = new Set();
    const unique = valid.filter(s => {
      const k = s.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return { valid: unique, invalid };
  };

```

(g) Name, note, logging and handlers, after `userMeta`. Old:

```js
      email: peerEmail || profile?.email || null,
      online: !!peer,
    };
  };
```

New:

```js
      email: peerEmail || profile?.email || null,
      online: !!peer,
    };
  };

  // Whose plan it is, by first name, for anyone but its owner: "Alex’s plan".
  // A workspace the panel knows only by a share (created_by null) says "the
  // owner".
  const ownerName = !limitCap?.isAccountOwner && workspace?.created_by
    ? firstName(userMeta(workspace.created_by).name) : null;
  const planWord = limitCap?.isAccountOwner ? 'your plan' : ownerPlan(ownerName);
  const limitNote = editorLimitNote(limitCap, { ownerName, asked: askState === 'sent' });

  // Once per stage a panel shows, so the read can tell how many people the
  // note reached, and at which stage.
  const seenStage = useRef(null);
  useEffect(() => {
    if (!limitNote || seenStage.current === limitNote.stage) return;
    seenStage.current = limitNote.stage;
    try {
      logEventNow(EV.EDITOR_LIMIT_SEEN, { surface: 'share_modal', stage: limitNote.stage, owner: !!limitCap?.isAccountOwner });
    } catch (_) {}
  }, [limitNote?.stage, limitCap?.isAccountOwner]);

  const seeEditors = () => {
    try { logEventNow(EV.EDITOR_LIMIT_SEE_WHO, { surface: 'share_modal', stage: limitNote?.stage || null }); } catch (_) {}
    onSeeEditors?.(workspace?.id || board?.workspace_id || null);
  };

  // "Ask Alex for room". A door that refuses rolls its own notice back, so
  // asking is a call of its own (0520 ask_owner_for_editor_slot).
  const askForRoom = async () => {
    if (askState) return;
    setAskState('asking');
    let result = 'error';
    try { result = await askOwnerForEditorSlot({ boardId: board?.id || null }); } catch (_) { result = 'error'; }
    try { logEventNow(EV.EDITOR_LIMIT_ASK_SENT, { result, surface: 'share_modal' }); } catch (_) {}
    if (result === 'sent' || result === 'already_sent') { setAskState('sent'); return; }
    setAskState(null);
    if (result === 'error') {
      feedback.toast({ type: 'error', message: 'Could not ask — check your connection and try again.' });
      return;
    }
    editorLimit.refresh();   // 'not_full' or 'owner': there is room after all
  };

  // A door said no for want of room the panel didn't know about. Say so in
  // the panel's words, and read the numbers again so the note shows.
  const onEditorLimitRefused = (refusal, door) => {
    feedback.toast({ type: 'warning', message: editorLimitRefusalMessage(refusal, { ownerName }), ttl: 9000 });
    try { logEventNow(EV.EDITOR_LIMIT_REFUSED, { door, ask: !!refusal.ask, surface: 'share_modal' }); } catch (_) {}
    editorLimit.refresh();
  };
```

(h) The invite loop. Old:

```js
    let limitMsg = null; let limitIdx = -1;
```

New:

```js
    let limitMsg = null; let limitIdx = -1;
    // 0521: the account has no room for another editor. Every address after
    // it would be refused the same way, so the loop stops there too.
    let editorStop = null;
```

Old:

```js
        if (/invite limit reached/i.test(msg)) { limitMsg = msg; limitIdx = i; break; }
        fail.push({ email, reason: msg });
```

New:

```js
        if (/invite limit reached/i.test(msg)) { limitMsg = msg; limitIdx = i; break; }
        const full = editorLimitRefusal(e);
        if (full) { editorStop = full; limitIdx = i; break; }
        fail.push({ email, reason: msg });
```

Old:

```js
    if (limitMsg) {
      const sent = granted.length + pending.length;
```

New:

```js
    if (editorStop) {
      const sent = granted.length + pending.length;
      const unsent = emails.slice(limitIdx);
      const why = editorLimitRefusalMessage(editorStop, { ownerName });
      const failed = fail.length
        ? ` Also failed: ${fail.slice(0, 3).map(f => `${f.email} (${f.reason})`).join(', ')}${fail.length > 3 ? '…' : ''}`
        : '';
      feedback.toast({
        type: 'warning',
        message: sent > 0 ? `Sent ${sent}; ${unsent.length} not sent. ${why}${failed}` : `${why}${failed}`,
        ttl: 9000,
      });
      try {
        logEventNow(EV.EDITOR_LIMIT_REFUSED, {
          door: isWorkspaceInvite ? 'workspace_invite' : 'share', ask: !!editorStop.ask, surface: 'share_modal',
        });
      } catch (_) {}
      editorLimit.refresh();
      // The addresses it never reached stay in the box, to send to view.
      setInviteEmail(unsent.join(', '));
      setInviting(false);
      return;
    }

    if (limitMsg) {
      const sent = granted.length + pending.length;
```

(i) Role-change, restore and widen refusals. Old:

```js
      feedback.toast({ type: 'error', message: 'Could not change role: ' + (e.message || e) });
```

New:

```js
      const full = editorLimitRefusal(e);
      if (full) { onEditorLimitRefused(full, 'share_role'); return; }
      feedback.toast({ type: 'error', message: 'Could not change role: ' + (e.message || e) });
```

Old:

```js
            feedback.toast({ type: 'error', message: 'Could not restore access: ' + (e.message || e) });
```

New:

```js
            const full = editorLimitRefusal(e);
            if (full) { onEditorLimitRefused(full, 'restore'); return; }
            feedback.toast({ type: 'error', message: 'Could not restore access: ' + (e.message || e) });
```

Old:

```js
      feedback.toast({ type: 'error', message: 'Could not change their access: ' + (e.message || e) });
```

New:

```js
      const full = editorLimitRefusal(e);
      if (full) { onEditorLimitRefused(full, 'member_role'); return; }
      feedback.toast({ type: 'error', message: 'Could not change their access: ' + (e.message || e) });
```

Old:

```js
      const msg = e?.message || String(e);
      feedback.toast(/invite limit reached/i.test(msg)
```

New:

```js
      const msg = e?.message || String(e);
      const full = editorLimitRefusal(e);
      if (full) { onEditorLimitRefused(full, 'widen'); return; }
      feedback.toast(/invite limit reached/i.test(msg)
```

(j) The invite link's toast. Old:

```js
              ? 'Invite link copied — anyone with it can join as an editor.'
```

New:

```js
              ? (editFull
                  ? `Invite link copied — while ${planWord} is full, anyone with it joins as a viewer.`
                  : 'Invite link copied — anyone with it can join as an editor.')
```

(k) The role line. Old:

```js
  const roleHint = inviteRole === 'viewer'
    ? `They can open “${boardName}” and its sub-clusters, comment and vote, but can’t change anything.`
    : inviteRole === 'workspace'
      ? `They can add, move and delete cards in every cluster in “${wsName}”. Editors are free on every plan.`
      : inviteRole === 'workspaceviewer'
        ? `They can open every cluster in “${wsName}”, comment and vote, but can’t change anything.`
        : `They can add, move and delete cards in “${boardName}” and its sub-clusters. Editors are free on every plan.`;
```

New:

```js
  // "Editors are free" stops being true with the editor limit (held).
  const freeEditors = editorLimitAllowed() ? '' : ' Editors are free on every plan.';
  const roleHint = inviteRole === 'viewer'
    ? `They can open “${boardName}” and its sub-clusters, comment and vote, but can’t change anything.`
    : inviteRole === 'workspace'
      ? `They can add, move and delete cards in every cluster in “${wsName}”.${freeEditors}`
      : inviteRole === 'workspaceviewer'
        ? `They can open every cluster in “${wsName}”, comment and vote, but can’t change anything.`
        : `They can add, move and delete cards in “${boardName}” and its sub-clusters.${freeEditors}`;
```

(l) The link row's line. Old:

```js
    const what = accessMode === 'edit' ? 'They sign in, then join as editors' : 'No account needed';
```

New:

```js
    // While the plan is full, an edit link lets people in to view (0521).
    const what = accessMode === 'edit'
      ? (editFull ? `They sign in, then join as viewers while ${planWord} is full` : 'They sign in, then join as editors')
      : 'No account needed';
```

(m) The note at the top of the invite area. Old:

```jsx
          <div className="share-section share-invite">
            <div className="share-invite-row">
```

New:

```jsx
          <div className="share-section share-invite">
            <EditorLimitNote note={limitNote}
                             onSeeWho={onSeeEditors ? seeEditors : null}
                             onAsk={askForRoom}
                             asking={askState === 'asking'} />
            <div className="share-invite-row">
```

(n) The invite access select. Old:

```jsx
              <select className="share-role-select" aria-label="Access level for invitees"
                      value={inviteAccess}
                      onChange={(e) => setInviteAccess(e.target.value)}>
                <option value="editor">Can edit</option>
                <option value="viewer">Can view</option>
              </select>
```

New:

```jsx
              <select className="share-role-select" aria-label="Access level for invitees"
                      value={access}
                      onChange={(e) => setInviteAccess(e.target.value)}>
                {editLocked ? (
                  <>
                    <option value="viewer">Can view</option>
                    <option value="editor" disabled>Can edit — full</option>
                  </>
                ) : (
                  <>
                    <option value="editor">Can edit</option>
                    <option value="viewer">Can view</option>
                  </>
                )}
              </select>
```

(o) Member rows. Old:

```js
              const levelPickable = ASSIGNABLE_ROLES.includes(m.role);
```

New:

```js
              const levelPickable = ASSIGNABLE_ROLES.includes(m.role);
              // A viewer made an editor or co-owner takes a place, unless they
              // hold one already somewhere else in the account.
              const lockEdit = editFull && m.role === 'viewer'
                && !holdsPlace(editorLimit.holders, { userId: m.user_id });
```

Old:

```jsx
                        <option value="editor">Workspace · can edit</option>
                        <option value="viewer">Workspace · can view</option>
                        <option value="coowner">Co-owner</option>
```

New:

```jsx
                        <option value="editor" disabled={lockEdit}>{lockEdit ? 'Workspace · can edit — full' : 'Workspace · can edit'}</option>
                        <option value="viewer">Workspace · can view</option>
                        <option value="coowner" disabled={lockEdit}>{lockEdit ? 'Co-owner — full' : 'Co-owner'}</option>
```

(p) Share rows. Old:

```js
              const canWiden = isManager && !workspaceMembers.some(m => m.user_id === s.user_id);
```

New:

```js
              const canWiden = isManager && !workspaceMembers.some(m => m.user_id === s.user_id);
              const lockEdit = editFull && s.role === 'viewer'
                && !holdsPlace(editorLimit.holders, { userId: s.user_id, email: s.email });
```

Old:

```jsx
                    <option value="editor">Can edit</option>
                    <option value="viewer">Can view</option>
                    {canWiden && <option value="workspace">Whole workspace · can edit</option>}
```

New:

```jsx
                    <option value="editor" disabled={lockEdit}>{lockEdit ? 'Can edit — full' : 'Can edit'}</option>
                    <option value="viewer">Can view</option>
                    {canWiden && <option value="workspace" disabled={lockEdit}>{lockEdit ? 'Whole workspace · can edit — full' : 'Whole workspace · can edit'}</option>}
```

- [ ] **Step 6: Pass `onSeeEditors` from App.**

In `boards/src/App.jsx`, the `<ShareModal` props. Old:

```jsx
            onSharesChanged={() => { refreshSharedBoards?.(); }}
```

New:

```jsx
            onSharesChanged={() => { refreshSharedBoards?.(); }}
            onSeeEditors={(wsId) => {
              setShareOpen(false); setShareInitialSection(null); setShareScope('cluster'); setShareBoardId(null);
              openNotificationSettings('members', wsId || workspace.id);
            }}
```

`openNotificationSettings` opens Members here, or after switching to the workspace it names.

- [ ] **Step 7: Run the tests and the build.**
  - Run: `cd boards && npm test && npx vite build --logLevel error > /dev/null && echo BUILD_OK`
  - Expected:
    - every test passes, including `analyticsEvents.test.mjs` (the four keys are emitted in ShareModal) and `featureEvents.test.mjs` (`editorLimit` is still `unmeasured`);
    - `BUILD_OK`.
  - If a test pins ShareModal source text these edits changed, stop and report it. Don't change that test.
  - When this task ran, `inviteAbuse.test.mjs` was pinning the dedupe line of ShareModal's own parser. It now pins two things:
    - the panel imports `lib/inviteSubmit.js`'s `parseEmails` (the same code, kept as one copy);
    - the shared parser de-duplicates.

- [ ] **Step 8: Report** the files changed. The main session commits them.

---

### Task 4: Members: People who can edit

**Files:**
- Create: `boards/src/components/settings/AccountEditorsCard.jsx`
- Modify: `boards/src/components/settings/MembersTab.jsx`
- Modify: `boards/src/components/settings/fields.jsx`, `SettingsCategory` (line ~317)
- Modify: `boards/src/components/settings/saveState.jsx`, the `save` catch (line ~54)
- Modify: `boards/src/styles.css`, after `.settings-cat-desc` (line ~18882), in the settings-cat phone block, and after `.settings-invite-row input.settings-input` (line ~23208)
- Modify: `boards/src/lib/analyticsEvents.js`, adding `EDITOR_LIMIT_MAKE_ROOM`

**Interfaces:**
- **Consumes** `useEditorLimit` (Task 3), and these from Task 2: `editorLimitStage`, `editorLimitFull`, `editorLimitRefusal`, `editorLimitRefusalMessage`, `firstName`, `ownerPlan`, `holdsPlace`, `accountEditorSub`, `makeViewerOps`, `removeOps`, `revokeOps`.
- **Produces** `<AccountEditorsCard cap editors ownerName selfId onChanged />`, plus `SettingsCategory`'s `aside` prop.

- [ ] **Step 1: `SettingsCategory` gets `aside`.**

In `fields.jsx`. Old:

```jsx
export function SettingsCategory({ title, desc, children }) {
  return (
    <div className="settings-cat">
      <div className="settings-cat-head">
        <span className="settings-cat-title">{title}</span>
        {desc && <span className="settings-cat-desc">{desc}</span>}
      </div>
```

New:

```jsx
// aside: a number the card is about, at the head's far end ("10 of 10").
export function SettingsCategory({ title, desc, aside = null, children }) {
  return (
    <div className="settings-cat">
      <div className="settings-cat-head">
        <span className="settings-cat-title">{title}</span>
        {desc && <span className="settings-cat-desc">{desc}</span>}
        {aside != null && <span className="settings-cat-aside">{aside}</span>}
      </div>
```

- [ ] **Step 2: `useSettingsSave` says a refusal in its own words.**

In `saveState.jsx`. Old:

```js
      feedback.toast({
        type: 'error',
        message: 'Save failed — check your connection and try again. (' + (err.message || err) + ')',
      });
```

New:

```js
      // A change the server refused for a reason the tab can say (the editor
      // limit) carries its sentence in userMessage; anything else is the
      // connection's.
      feedback.toast(err?.userMessage
        ? { type: 'warning', message: err.userMessage, ttl: 9000 }
        : { type: 'error', message: 'Save failed — check your connection and try again. (' + (err.message || err) + ')' });
```

- [ ] **Step 3: Add the EV key.**

In `analyticsEvents.js`, after `EDITOR_LIMIT_SEE_WHO`:

```js
  EDITOR_LIMIT_MAKE_ROOM:  'editor_limit_make_room',      // the owner freed a place from "People who can edit" {action:'make_viewer'|'remove'|'revoke', ok, grants}
```

- [ ] **Step 4: Create `boards/src/components/settings/AccountEditorsCard.jsx`.**

```jsx
// AccountEditorsCard — Settings › Members › "People who can edit": everyone
// who can edit anything in the account, against the plan's 10 (the owner's
// pick B, 2026-10-21). The account's owner sees who holds each place and can
// free one: Make viewer keeps the person in, Remove takes them out, Revoke
// cancels a waiting invite. A co-owner sees the count alone:
// list_my_account_editors is the owner's.
//
// Access changes ask first, as Members' Remove does; they aren't content
// deletes, so there is no undo toast.
import { useEffect, useState } from 'react';
import { SettingsCategory } from './fields.jsx';
import { useFeedback } from '../AppFeedback.jsx';
import { pickPresenceColor } from '../../lib/presenceColor.js';
import {
  setWorkspaceMemberRole, shareBoard, removeWorkspaceMember, unshareBoard, revokePendingInvite,
} from '../../lib/boardsApi.js';
import {
  accountEditorSub, editorLimitStage, makeViewerOps, removeOps, revokeOps, ownerPlan,
} from '../../lib/editorLimit.js';
import { logEvent } from '../../lib/analytics.js';
import { EV } from '../../lib/analyticsEvents.js';

const RUN = {
  member_role: (o) => setWorkspaceMemberRole({ workspaceId: o.workspaceId, userId: o.userId, role: o.role }),
  share_role: (o) => shareBoard({ boardId: o.boardId, email: o.email, role: o.role }),
  unshare: (o) => unshareBoard({ boardId: o.boardId, userId: o.userId }),
  remove_member: (o) => removeWorkspaceMember({ workspaceId: o.workspaceId, userId: o.userId }),
  revoke: (o) => revokePendingInvite(o.inviteId),
};

export function AccountEditorsCard({ cap, editors = [], ownerName = null, selfId = null, onChanged }) {
  const feedback = useFeedback();
  const [busy, setBusy] = useState(null);   // the slot_key whose change is running
  const owner = !!cap?.isAccountOwner;

  useEffect(() => {
    try { logEvent(EV.EDITOR_LIMIT_SEEN, { surface: 'members', stage: editorLimitStage(cap), owner }); } catch (_) {}
    // Once a mount: what the card read when it opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const desc = owner
    ? `Across all your workspaces. Your plan has room for ${cap.limit}, and viewers don’t count. Making someone a viewer frees their place and keeps them in.`
    : `Across all of ${ownerName ? `${ownerName}’s` : 'the owner’s'} workspaces. ${ownerPlan(ownerName, { start: true })} has room for ${cap.limit}, and viewers don’t count.`;

  const nameOf = (row) => row.display_name || row.email || 'Someone';

  const run = async (row, action, ops, done) => {
    setBusy(row.slot_key);
    let failed = 0;
    for (const o of ops) {
      try { await RUN[o.op](o); } catch (e) { failed += 1; console.warn(`[editors] ${o.op} failed`, e); }
    }
    setBusy(null);
    try { logEvent(EV.EDITOR_LIMIT_MAKE_ROOM, { action, ok: failed === 0, grants: ops.length }); } catch (_) {}
    feedback.toast(failed === 0
      ? { type: 'success', message: done }
      : { type: 'warning', message: 'Some of that didn’t go through. Try again.', ttl: 8000 });
    await onChanged?.();
  };

  const makeViewer = async (row) => {
    const who = nameOf(row);
    const ok = await feedback.confirm({
      title: `Make ${who} a viewer?`,
      message: 'They’ll still open everything they can now, but they won’t be able to change anything. Their place frees up.',
      confirmLabel: 'Make viewer',
    });
    if (!ok) return;
    run(row, 'make_viewer', makeViewerOps(row), `${who} can view now. Their place is free.`);
  };

  const remove = async (row) => {
    const who = nameOf(row);
    const ok = await feedback.confirm({
      title: `Remove ${who}?`,
      message: 'They’ll lose access to everything they can edit in your workspaces. Anything they can only view stays as it is.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    run(row, 'remove', removeOps(row), `Removed ${who}.`);
  };

  // Same words as Members' own Revoke.
  const revoke = async (row) => {
    const ok = await feedback.confirm({
      title: `Revoke invite to ${row.email}?`,
      message: `They'll no longer get access if they sign up.`,
      confirmLabel: 'Revoke',
      danger: true,
    });
    if (!ok) return;
    run(row, 'revoke', revokeOps(row), `Revoked the invite to ${row.email}.`);
  };

  return (
    <SettingsCategory title="People who can edit" aside={`${cap.taken} of ${cap.limit}`} desc={desc}>
      {owner && (
        <ul className="settings-editor-list">
          {editors.map((row) => {
            const pending = row.source === 'pending';
            const name = nameOf(row);
            return (
              <li key={row.slot_key} className={`settings-editor-row${busy === row.slot_key ? ' is-busy' : ''}`}>
                <span className={`settings-editor-av${pending ? ' is-neutral' : ''}`}
                      style={pending ? undefined : { background: pickPresenceColor(row.user_id || row.email) }}
                      aria-hidden="true">{name.charAt(0).toUpperCase()}</span>
                <span className="settings-editor-who">
                  <span className="settings-editor-name">{name}{row.user_id && row.user_id === selfId ? ' (you)' : ''}</span>
                  <span className="settings-editor-sub">{accountEditorSub(row)}</span>
                </span>
                {row.source === 'owner' ? (
                  <span className="settings-editor-role">Owner</span>
                ) : (
                  <span className="settings-editor-acts">
                    {pending ? (
                      <button type="button" className="settings-link-btn" disabled={!!busy}
                              onClick={() => revoke(row)}>Revoke</button>
                    ) : (
                      <>
                        <button type="button" className="settings-link-btn" disabled={!!busy}
                                onClick={() => makeViewer(row)}>Make viewer</button>
                        <button type="button" className="settings-link-btn is-danger" disabled={!!busy}
                                onClick={() => remove(row)}>Remove</button>
                      </>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SettingsCategory>
  );
}
```

- [ ] **Step 5: Wire MembersTab.**

Imports. Old:

```js
import { WORKSPACE_ROLE_LABEL as ROLE_LABEL, ASSIGNABLE_ROLES, canManageWorkspace } from '../../lib/workspaceRoles.js';
```

New:

```js
import { WORKSPACE_ROLE_LABEL as ROLE_LABEL, ASSIGNABLE_ROLES, canManageWorkspace } from '../../lib/workspaceRoles.js';
import { useEditorLimit } from '../../hooks/useEditorLimit.js';
import { editorLimitAllowed } from '../../lib/appHost.js';
import {
  editorLimitFull, editorLimitRefusal, editorLimitRefusalMessage, firstName, holdsPlace,
} from '../../lib/editorLimit.js';
import { logEvent } from '../../lib/analytics.js';
import { EV } from '../../lib/analyticsEvents.js';
import { AccountEditorsCard } from './AccountEditorsCard.jsx';
```

The hook. Old:

```js
  const [inviteRole, setInviteRole] = useState('editor');
```

New:

```js
  const [inviteRole, setInviteRole] = useState('editor');
  // The 10-editor limit (0520, held): the numbers for this workspace's
  // account and, for its owner, who holds the places.
  const editorLimit = useEditorLimit({ workspaceId, enabled: canManage, list: 'always' });
  const limitCap = editorLimit.cap;
  const editFull = editorLimitFull(limitCap);
```

Derived values and the refusal helper. Old:

```js
  const label = (m) => byId.get(m.user_id)?.title || byId.get(m.user_id)?.email || m.user_id.slice(0, 8);
```

New:

```js
  const label = (m) => byId.get(m.user_id)?.title || byId.get(m.user_id)?.email || m.user_id.slice(0, 8);

  // Whose plan it is, for a co-owner: "Alex’s plan".
  const ownerRow = members.find((x) => x.role === 'owner');
  const ownerName = !limitCap?.isAccountOwner && ownerRow ? firstName(byId.get(ownerRow.user_id)?.title) : null;
  // A viewer made an editor or co-owner takes a place, unless they hold one
  // somewhere else in the account (the owner's list says so).
  const lockedViewer = (m) => editFull && m.role === 'viewer' && !holdsPlace(editorLimit.holders, { userId: m.user_id });
  const inviteLocked = editFull && !holdsPlace(editorLimit.holders, { email: inviteEmail });
  // A door said no for want of room: log it, read the numbers again, and say
  // it in the panel's words.
  const refused = (full, door) => {
    try { logEvent(EV.EDITOR_LIMIT_REFUSED, { door, ask: !!full.ask, surface: 'members' }); } catch (_) {}
    editorLimit.refresh();
    return editorLimitRefusalMessage(full, { ownerName });
  };
```

`changeRole`. Old:

```js
  const changeRole = (m, next) => save(async () => {
    await setWorkspaceMemberRole({ workspaceId, userId: m.user_id, role: next });
    await load();
  });
```

New:

```js
  const changeRole = (m, next) => save(async () => {
    try {
      await setWorkspaceMemberRole({ workspaceId, userId: m.user_id, role: next });
    } catch (e) {
      const full = editorLimitRefusal(e);
      if (!full) throw e;
      throw Object.assign(new Error(e?.message || 'editor limit reached'), { userMessage: refused(full, 'member_role') });
    }
    await load();
    editorLimit.refresh();
  });
```

`remove`. Old:

```js
      await removeWorkspaceMember({ workspaceId, userId: m.user_id });
      feedback.toast({ type: 'success', message: `Removed ${who}.` });
      await load();
```

New:

```js
      await removeWorkspaceMember({ workspaceId, userId: m.user_id });
      feedback.toast({ type: 'success', message: `Removed ${who}.` });
      await load();
      editorLimit.refresh();
```

`revokePending`. Old:

```js
      setPending(arr => arr.filter(x => x.id !== row.id));
```

New:

```js
      setPending(arr => arr.filter(x => x.id !== row.id));
      editorLimit.refresh();
```

`invite`. Old (from `const invite = async () => {` through its closing `};`):

```js
  const invite = async () => {
    const email = inviteEmail.trim();
    if (!email || !canManage) return;
    try {
      const status = await inviteWorkspaceMember({ workspaceId, email, role: inviteRole });
      feedback.toast({
        type: status === 'already_member' ? 'warning' : 'success',
        message: status === 'pending' ? `Invited ${email} — access is waiting for them when they sign up.`
              : status === 'already_member' ? `${email} is already a member.`
              : `Added ${email} as ${inviteRole}.`,
      });
      setInviteEmail('');
      await load();
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Could not invite: ' + (e.message || e) });
    }
  };
```

New:

```js
  const invite = async () => {
    const email = inviteEmail.trim();
    if (!email || !canManage) return;
    const role = inviteLocked ? 'viewer' : inviteRole;
    try {
      const status = await inviteWorkspaceMember({ workspaceId, email, role });
      feedback.toast({
        type: status === 'already_member' ? 'warning' : 'success',
        message: status === 'pending' ? `Invited ${email} — access is waiting for them when they sign up.`
              : status === 'already_member' ? `${email} is already a member.`
              : `Added ${email} as ${role}.`,
      });
      setInviteEmail('');
      await load();
      editorLimit.refresh();
    } catch (e) {
      const full = editorLimitRefusal(e);
      if (full) { feedback.toast({ type: 'warning', message: refused(full, 'workspace_invite'), ttl: 9000 }); return; }
      feedback.toast({ type: 'error', message: 'Could not invite: ' + (e.message || e) });
    }
  };
```

The card, first in the tab. Old:

```jsx
    <div className="settings-tab-body">
      <SettingsCategory title="People in this workspace"
```

New:

```jsx
    <div className="settings-tab-body">
      {editorLimitAllowed() && canManage && limitCap?.enforced && (
        <AccountEditorsCard cap={limitCap} editors={editorLimit.editors} ownerName={ownerName}
                            selfId={user?.id}
                            onChanged={async () => { await load(); await editorLimit.refresh(); }} />
      )}
      <SettingsCategory title="People in this workspace"
```

Role options. Old:

```jsx
                    {ASSIGNABLE_ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
```

New:

```jsx
                    {ASSIGNABLE_ROLES.map(r => {
                      const locked = r !== 'viewer' && lockedViewer(m);
                      return <option key={r} value={r} disabled={locked}>{locked ? `${ROLE_LABEL[r]} — full` : ROLE_LABEL[r]}</option>;
                    })}
```

Add someone. Old:

```jsx
        <SettingsCategory title="Add someone" desc="They sign in to accept. Editors are free on every plan.">
```

New:

```jsx
        <SettingsCategory title="Add someone"
                          desc={editorLimitAllowed() ? 'They sign in to accept.' : 'They sign in to accept. Editors are free on every plan.'}>
```

Old:

```jsx
            <select className="settings-input" aria-label="Role for the new member"
                    value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
```

New:

```jsx
            <select className="settings-input" aria-label="Role for the new member"
                    value={inviteLocked ? 'viewer' : inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
              <option value="editor" disabled={inviteLocked}>{inviteLocked ? 'Editor — full' : 'Editor'}</option>
              <option value="viewer">Viewer</option>
            </select>
```

- [ ] **Step 6: Add the CSS.**

After the line `.settings-cat-desc { font: 400 11.5px/1.4 var(--font-sans); color: var(--ink-3); flex: 1 1 auto; min-width: 0; }`:

```css
/* A number the card is about, at the head's far end ("10 of 10"). */
.settings-cat-aside {
  flex: 0 0 auto; margin-left: auto;
  font: 500 12px/1 var(--font-sans); color: var(--ink-2);
  white-space: nowrap; font-variant-numeric: tabular-nums;
}
```

Inside the following `@media (max-width: 640px) { … }` block, after `.settings-cat-title { white-space: normal; }`:

```css
  .settings-cat-aside { margin-left: 0; }
```

After `.settings-invite-row input.settings-input { flex: 1; min-width: 180px; }`:

```css
/* Settings → Members → People who can edit (the 10-editor limit, 0520): the
   owner's whole account, a row a person: a face, where they edit, and the two
   ways to free a place. */
.settings-editor-list { list-style: none; margin: 0; padding: 0; }
.settings-editor-row { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-bottom: 1px solid var(--line-1); }
.settings-editor-row:last-child { border-bottom: 0; }
.settings-editor-row.is-busy { opacity: .6; }
.settings-editor-av {
  width: 28px; height: 28px; flex: none;
  display: grid; place-items: center;
  border-radius: var(--radius-md);
  font: 700 12px/1 var(--font-sans);
  color: var(--bg-0);
}
.settings-editor-av.is-neutral { background: var(--bg-4); color: var(--ink-1); }
.settings-editor-who { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.settings-editor-name, .settings-editor-sub { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.settings-editor-name { font: 600 12.5px/1.3 var(--font-sans); color: var(--ink-0); }
.settings-editor-sub { font: 400 11px/1.3 var(--font-sans); color: var(--ink-3); }
.settings-editor-role { flex: none; font: 400 12.5px/1 var(--font-sans); color: var(--ink-2); }
.settings-editor-acts { flex: none; display: flex; gap: 4px; }
/* The actions wait under the pointer, as the pick drew them; the keyboard and
   a finger always find them. */
@media (hover: hover) {
  .settings-editor-row:not(:hover):not(:focus-within) .settings-editor-acts { opacity: 0; }
}
```

- [ ] **Step 7: Run the tests and the build.**
  - Run: `cd boards && npm test && npx vite build --logLevel error > /dev/null && echo BUILD_OK`
  - Expected: every test passes, then `BUILD_OK`.

- [ ] **Step 8: Report** the files changed.

---

### Task 5: Setup invites, the notices, and the feature entry

**Files:**
- Modify: `boards/src/components/setup/InviteStep.jsx`
- Modify: `boards/src/hooks/useNotifications.js`
- Modify: `boards/src/App.jsx`, the `useNotifications(…)` call (line ~1345).
- Modify: `boards/src/components/NotificationsPanel.jsx`, its editor-limit (`settings`) branch.
- Modify: `boards/src/lib/analyticsEvents.js`, adding `EDITOR_LIMIT_NOTICE_OPEN`.
- Modify: `boards/src/lib/featureEvents.js`, making `editorLimit` measured.
- Modify: `boards/src/components/JoinBoardCard.jsx`, the editor line.

**Interfaces:**
- **Consumes** `runInvitesByRole`, `editorLimitRefusalMessage`, `noticeToastText`, `missedJoinedAsViewer` (Task 2), and `notificationTarget` (`lib/notificationsBell.js`).
- **Produces** the new `useNotifications` option `onOpenSettings(tab, workspaceId)`.

- [ ] **Step 1: InviteStep sends viewers when the editors are full.**

Imports. Old:

```js
import { parseEmails, runInvites, inviteLimitKind } from '../../lib/inviteSubmit.js';
```

New:

```js
import { parseEmails, runInvitesByRole, inviteLimitKind } from '../../lib/inviteSubmit.js';
import { editorLimitRefusalMessage } from '../../lib/editorLimit.js';
```

State. Old:

```js
  const [limit, setLimit] = useState(null);
```

New:

```js
  const [limit, setLimit] = useState(null);
  const [editorsFull, setEditorsFull] = useState(null);
```

Replace the whole `send` function. Old: from `  const send = async () => {` through its closing `  };`. That is the one ending with:

```js
    setSending(false);
    if (sentEmails.length) {
      onOut?.('email');
      onInvited?.(sentEmails);
    }
  };
```

New:

```js
  const send = async () => {
    if (sending || valid.length === 0 || !workspaceId) return;
    setSending(true);
    setLimit(null);
    setEditorsFull(null);
    const byRole = { editor: [], viewer: [] };
    for (const r of valid) for (const e of parseEmails(r.email).valid) byRole[r.role === 'viewer' ? 'viewer' : 'editor'].push(e);
    const next = [];
    const sentEmails = [];
    // The invite budget stops everything after it; the editor limit (0521)
    // stops only the editors, so the viewers still go out.
    const { runs, budget, editors } = await runInvitesByRole(byRole,
      (role) => (email) => inviteWorkspaceMember({ workspaceId, email, role }));
    for (const r of runs) {
      const { role } = r;
      for (const e of r.granted) next.push({ email: e, ok: true, label: 'Added' });
      for (const e of r.pending) next.push({ email: e, ok: true, label: 'Invite sent' });
      for (const f of r.fail) next.push({ email: f.email, ok: false, label: f.reason === 'already a member' ? 'Already in it' : 'Not sent' });
      sentEmails.push(...r.granted, ...r.pending);
      try {
        if (r.granted.length) {
          logEventNow(EV.INVITE_SENT, { role, result: 'granted', n: r.granted.length, surface, method: 'email', reward_note: 'free' });
          logEventNow(EV.ACCESS_GRANTED, { how: 'workspace', role: `workspace:${role}`, board_id: null, surface });
        }
        if (r.pending.length) logEventNow(EV.INVITE_SENT, { role, result: 'pending', n: r.pending.length, surface, method: 'email', reward_note: 'free' });
      } catch (_) { /* analytics never breaks a send */ }
    }
    setResults((prev) => [...prev, ...next]);
    if (budget) {
      setLimit(sentence(budget.reason));
      try {
        logEventNow(EV.INVITE_LIMIT_REACHED, { surface, method: 'email', kind: inviteLimitKind(budget.reason), unsent: budget.unsent.length });
      } catch (_) { /* analytics never breaks a send */ }
    }
    if (editors) {
      setEditorsFull(editorLimitRefusalMessage(editors));
      try { logEventNow(EV.EDITOR_LIMIT_REFUSED, { door: 'workspace_invite', ask: !!editors.ask, surface }); } catch (_) {}
    }
    // Sent rows clear; whatever a limit stopped stays, ready to send again.
    const keep = new Set([...(budget?.unsent || []), ...(editors?.unsent || [])].map((e) => e.toLowerCase()));
    setRows((rs) => {
      const left = rs.filter((r) => parseEmails(r.email).valid.some((e) => keep.has(e.toLowerCase())));
      return left.length ? left : [newRow()];
    });
    setSending(false);
    if (sentEmails.length) {
      onOut?.('email');
      onInvited?.(sentEmails);
    }
  };
```

JSX. Old:

```jsx
      {limit && (
        <p className="su-note" role="status"><Icon as={Info} size={16} weight="regular" />
          <span>{limit} {isPhone ? 'Share' : 'Copy'} the invite link for everyone else.</span></p>
      )}
```

New:

```jsx
      {limit && (
        <p className="su-note" role="status"><Icon as={Info} size={16} weight="regular" />
          <span>{limit} {isPhone ? 'Share' : 'Copy'} the invite link for everyone else.</span></p>
      )}
      {editorsFull && (
        <p className="su-note" role="status"><Icon as={Info} size={16} weight="regular" />
          <span>{editorsFull}</span></p>
      )}
```

- [ ] **Step 2: Add the EV key and the feature entry.**

In `analyticsEvents.js`, after `EDITOR_LIMIT_MAKE_ROOM`:

```js
  EDITOR_LIMIT_NOTICE_OPEN:'editor_limit_notice_open',    // an editors.limit_reached notice opened Members {via:'toast'|'bell'}
```

In `featureEvents.js`. Old:

```js
  editorLimit: {
    unmeasured: 'The editor limit has no screens yet: the share panel, Members and the joined-as-viewer toast wait on the owner\'s mockup pick. The server already logs editor_limit_viewer_fallback (0520/0521).',
  },
```

New:

```js
  // The 10-editor limit: the share panel's note, Members' "People who can
  // edit", and the notices. The server logs editor_limit_viewer_fallback
  // (0521); check_instrumentation watches it from S5.
  editorLimit: {
    exposure: [EV.EDITOR_LIMIT_SEEN],
    action: [EV.EDITOR_LIMIT_ASK_SENT, EV.EDITOR_LIMIT_SEE_WHO, EV.EDITOR_LIMIT_MAKE_ROOM, EV.EDITOR_LIMIT_NOTICE_OPEN],
    outcome: [EV.EDITOR_LIMIT_MAKE_ROOM, EV.EDITOR_LIMIT_ASK_SENT],
    failure: [EV.EDITOR_LIMIT_REFUSED],
  },
```

- [ ] **Step 3: Rework useNotifications.**

`fileShareWiring.test.mjs` pins three texts in this file:
- the `import { fileSharesAllowed, sharedFilesAllowed } from '../lib/appHost.js'` line, exactly;
- `fileSharesAllowed() && String(payload.kind`;
- the `sharedFilesAllowed()\n ? openSharedFile({ token: fileToken, via: 'toast' })\n : window.open('/f/' + encodeURIComponent(fileToken)` shape.

Keep all three character for character. Replace everything from the line `import { useCallback, useEffect, useRef, useState } from 'react';` to the end of the file with:

```js
import { useCallback, useEffect, useRef, useState } from 'react';
import { listNotifications, markNotificationsRead } from '../lib/boardsApi.js';
import { subscribeNotifications } from '../lib/notificationBus.js';
import { maybeShowNotification } from '../lib/browserNotifications.js';
import { fileSharesAllowed, sharedFilesAllowed } from '../lib/appHost.js';
// A line of its own: fileShareWiring.test.mjs pins the one above as it is.
import { editorLimitAllowed } from '../lib/appHost.js';
import { openSharedFile } from '../lib/sharedFileBus.js';
import { notificationTarget } from '../lib/notificationsBell.js';
import { noticeToastText, missedJoinedAsViewer } from '../lib/editorLimit.js';
import { logEvent } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';

// Notices already toasted on this page, by id: realtime can deliver a ping
// twice, and the first load's look for missed ones can reach the same row.
const toasted = new Set();

export function useNotifications({ userId, feedback = null, onOpenBoard = null, onOpenSettings = null } = {}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const onOpenRef = useRef(onOpenBoard);
  const onSettingsRef = useRef(onOpenSettings);
  const feedbackRef = useRef(feedback);
  const sweptFor = useRef(null);   // the userId whose first load was looked through
  useEffect(() => { onOpenRef.current = onOpenBoard; }, [onOpenBoard]);
  useEffect(() => { onSettingsRef.current = onOpenSettings; }, [onOpenSettings]);
  useEffect(() => { feedbackRef.current = feedback; }, [feedback]);

  // Optimistic: the badge should clear on click, not after a round trip. A
  // failed write reconciles on the next refresh rather than bouncing the UI.
  const markRead = useCallback(async (ids = null) => {
    const stamp = new Date().toISOString();
    setItems((prev) => prev.map((x) => (
      (!ids || ids.includes(x.id)) && !x.read_at ? { ...x, read_at: stamp } : x
    )));
    try { await markNotificationsRead(ids); } catch (e) { console.warn('[notifications] mark read failed', e); }
  }, []);

  const refresh = useCallback(async () => {
    if (!userId) { setItems([]); return; }
    setLoading(true);
    try {
      const rows = await listNotifications({ limit: 50 });
      setItems(rows);
      // An edit link is claimed before the app subscribes to its pings, so
      // the notice that it let someone in as a viewer (0520) lands before
      // anyone listens. The first load shows the newest one missed, once.
      if (sweptFor.current !== userId) {
        sweptFor.current = userId;
        if (editorLimitAllowed()) {
          const missed = missedJoinedAsViewer(rows, { toasted });
          if (missed.length) {
            for (const n of missed) toasted.add(n.id);
            try { feedbackRef.current?.toast({ type: 'info', message: noticeToastText(missed[0]), ttl: 12000 }); } catch (_) {}
            markRead(missed.map((n) => n.id));
          }
        }
      }
    } catch (e) {
      console.warn('[notifications] list failed', e);
    } finally {
      setLoading(false);
    }
  }, [userId, markRead]);

  useEffect(() => { refresh(); }, [refresh]);

  // Live pings: prepend optimistically so the badge moves on the same frame.
  useEffect(() => {
    if (!userId) return undefined;
    return subscribeNotifications(userId, (payload) => {
      setItems((prev) => {
        if (prev.some((x) => x.id === payload.id)) return prev;   // realtime can double-deliver
        return [{ ...payload, read_at: null }, ...prev].slice(0, 50);
      });
      if (toasted.has(payload.id)) return;
      toasted.add(payload.id);
      const openIt = () => { try { onOpenRef.current?.(payload.board_id); } catch (_) {} };
      const fileToken = fileSharesAllowed() && String(payload.kind || '').startsWith('file.') ? payload.data?.token : null;
      // An editor-limit notice opens Settings › Members in its workspace.
      const target = notificationTarget(payload);
      const openSettings = target?.kind === 'settings'
        ? () => {
            try { logEvent(EV.EDITOR_LIMIT_NOTICE_OPEN, { via: 'toast' }); } catch (_) {}
            try { onSettingsRef.current?.(target.tab, target.workspaceId); } catch (_) {}
          }
        : null;
      try {
        feedbackRef.current?.toast({
          type: 'info',
          message: noticeToastText(payload),
          ttl: 8000,
          action: fileToken
            ? { label: 'Open', onClick: () => (sharedFilesAllowed()
                ? openSharedFile({ token: fileToken, via: 'toast' })
                : window.open('/f/' + encodeURIComponent(fileToken), '_blank', 'noopener')) }
            : openSettings ? { label: 'See who can edit', onClick: openSettings }
              : (payload.board_id ? { label: 'Open', onClick: openIt } : undefined),
        });
      } catch (_) {}
      // Only fires when the tab is hidden/unfocused and permission was granted.
      maybeShowNotification({ title: payload.title, body: payload.body || '', tag: `ntf:${payload.id}`, onClick: openIt });
    });
  }, [userId]);

  const unread = items.reduce((n, x) => n + (x.read_at ? 0 : 1), 0);

  return { items, unread, loading, refresh, markRead };
}
```

- [ ] **Step 4: Wire App.**

Old:

```js
    onOpenBoard: (id) => { if (id) { openBoardAnywhere(id); setCurrentSurface('board'); } },
  });
```

New:

```js
    onOpenBoard: (id) => { if (id) { openBoardAnywhere(id); setCurrentSurface('board'); } },
    // An editor-limit notice's "See who can edit" (openNotificationSettings,
    // below, is called only once the toast is pressed).
    onOpenSettings: (tab, wsId) => openNotificationSettings(tab, wsId),
  });
```

The bell's own open is logged in `boards/src/components/NotificationsPanel.jsx`, not in App. `notificationsBellWiring.test.mjs` pins App's `onOpenSettings={openNotificationSettings}` as it is; this was found when the task ran. Old:

```js
    if (target.kind === 'settings') {
      // An editor-limit row: Members, in that row's workspace.
      onOpenSettings?.(target.tab, target.workspaceId);
```

New:

```js
    if (target.kind === 'settings') {
      // An editor-limit row: Members, in that row's workspace. Its toast logs
      // the same event with via 'toast' (useNotifications).
      try { logEvent(EV.EDITOR_LIMIT_NOTICE_OPEN, { via: 'bell' }); } catch (_) {}
      onOpenSettings?.(target.tab, target.workspaceId);
```

- [ ] **Step 5: The edit link's join card stops promising "free" under the hold.**

An edit link opened while the plan is full lets its holder in to view, so the card no longer says editing comes free. `appHost.js` is already in the entry chunk (AuthGate imports it), so the public page carries nothing new.

In `boards/src/components/JoinBoardCard.jsx`. Old:

```js
import { EV } from '../lib/analyticsEvents.js';
```

New:

```js
import { EV } from '../lib/analyticsEvents.js';
import { editorLimitAllowed } from '../lib/appHost.js';
```

Old:

```jsx
          ? 'Add cards, notes, and ideas right alongside them — free.'
```

New:

```jsx
          // With the editor limit (held), an edit link can let its holder in
          // to view, so editing isn't promised as free.
          ? (editorLimitAllowed() ? 'Add cards, notes, and ideas right alongside them.' : 'Add cards, notes, and ideas right alongside them — free.')
```

- [ ] **Step 6: Run the tests and the build.**
  - Run: `cd boards && npm test && npx vite build --logLevel error > /dev/null && echo BUILD_OK`
  - Expected:
    - every test passes, including `featureEvents.test.mjs` (`editorLimit` measured, every key emitted) and `fileShareWiring.test.mjs`;
    - `BUILD_OK`.

- [ ] **Step 7: Report** the files changed.

---

### Task 6: Runtime pins

**Files:**
- Modify: `boards/src/local/shareWorkspaceProbe.js`
- Create: `boards/tests/editor-limit.spec.js`
- Modify: `boards/tests/share-panel-simplicity.spec.js` (its pin of the Whole-workspace option, locked since Task 3)

- [ ] **Step 1: Add the probe export.**

In `shareWorkspaceProbe.js`, change the first header line to:

```js
// shareWorkspaceProbe — mounts the workspace switcher menu, the Share panel
// and Settings › Members with fixtures, for tests/share-workspace-menu.spec.js
// and tests/editor-limit.spec.js.
```

Add the import, after `import { ShareModal } …`:

```js
import { MembersTab } from '../components/settings/MembersTab.jsx';
```

Append:

```js

// Settings is a layer over the app, so the tab gets one: under it the local-QA
// canvas takes the pointer and a hover never reaches a row. Below the
// confirm and the toasts, which portal to <body> on the top tier.
export function mountMembersTab(props) {
  ReactDOM.createRoot(host()).render(React.createElement(FeedbackProvider, null,
    React.createElement('div', { style: { position: 'fixed', inset: 0, zIndex: 9999, overflow: 'auto', background: 'var(--bg-0)' } },
      React.createElement('div', { style: { width: 680, padding: 16 } },
        React.createElement(MembersTab, props)))));
  return true;
}
```

(As first written, the tab sat in the page's flow under the local-QA canvas, whose `.cards-layer` took the pointer: the Members test's `hover()` on a row timed out. The fixed layer is what the build used.)

The share panel's "Whole workspace · can edit" option gained its lock in Task 3, so `tests/share-panel-simplicity.spec.js`'s pin of that line is updated to the locked markup in this task.

- [ ] **Step 2: Write the spec, `boards/tests/editor-limit.spec.js`.**

```js
// The 10-editor limit in the app (S1b, the owner's pick B): the share panel's
// note, "Can edit" locked for anyone new, the ask, a refusal the panel didn't
// see coming, and Members' "People who can edit". Mounted through
// src/local/shareWorkspaceProbe.js with the hold on and the RPCs answered by
// fixtures.
import { expect, test } from '@playwright/test';

const ME = '00000000-0000-4000-8000-0000000000aa';
const OWNER = '00000000-0000-4000-8000-0000000000bb';
const NORA = '00000000-0000-4000-8000-0000000000cc';
const LENA = '00000000-0000-4000-8000-0000000000dd';
const SAM = '00000000-0000-4000-8000-0000000000d1';
const BEN = '00000000-0000-4000-8000-0000000000d2';
const BOARD = '00000000-0000-4000-8000-00000000b0a4';

const capRow = (o = {}) => [{
  enforced: true, editor_limit: 10, used: 8, pending: 0, is_full: false,
  i_am_account_owner: true, subject: 'account', ...o,
}];
const grant = (o) => ({
  source: 'member', role: 'editor', workspace_id: 'ws-x', workspace_name: 'Studio',
  board_id: null, board_name: null, invite_id: null, sent_at: null, ...o,
});

// rpc: { name: json | (route) => fulfill }. Anything unnamed answers [].
async function boot(page, rpc = {}) {
  await page.addInitScript(() => { try { localStorage.setItem('soleil.dev.editorLimit', '1'); } catch (_) {} });
  await page.route('https://example.supabase.co/rest/v1/rpc/**', (route) => {
    const name = route.request().url().split('/rpc/')[1].split('?')[0];
    const answer = rpc[name];
    if (typeof answer === 'function') return answer(route);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer ?? []) });
  });
  await page.goto('/?local=1&reset=1&blank=1');
  await page.waitForLoadState('domcontentloaded');
}

async function mountPanel(page, { owner = true, members = [], peers = [] } = {}) {
  await page.evaluate(async ({ me, ownerId, board, members, peers }) => {
    window.__limit = { seeWho: [] };
    const { mountShareModal } = await import('/src/local/shareWorkspaceProbe.js');
    mountShareModal({
      board: { id: board, name: 'Feature film', workspace_id: 'ws-x' },
      workspace: { id: 'ws-x', name: 'Studio', created_by: ownerId },
      workspaceMembers: [{ user_id: ownerId, role: 'owner' }, ...members],
      wsPeers: [{ user: { id: ownerId, name: 'Alex Moreau', email: 'alex@moreau.studio' } }, ...peers],
      selfUserId: me, canManage: true, rewardTier: 'paid',
      onSeeEditors: (ws) => { window.__limit.seeWho.push(ws); },
    });
  }, { me: ME, ownerId: owner ? ME : OWNER, board: BOARD, members, peers });
  const panel = page.locator('.share-modal');
  await expect(panel).toBeVisible();
  return panel;
}

test('two places left: the owner is told, with See who, and Can edit stays open', async ({ page }) => {
  await boot(page, { get_editor_capacity: capRow({ used: 8 }) });
  const panel = await mountPanel(page);
  const note = panel.locator('.lim-note');
  await expect(note).toContainText('2 places left for people who can edit.');
  await expect(note).toContainText('Your plan has room for 10, across all your workspaces.');
  await expect(panel.locator('select[aria-label="Access level for invitees"]')).toHaveValue('editor');
  await note.getByRole('button', { name: 'See who' }).click();
  expect(await page.evaluate(() => window.__limit.seeWho)).toEqual(['ws-x']);
  // The note is never gold; at rest Copy link is the one gold control.
  await expect(note.locator('.share-btn-gold')).toHaveCount(0);
});

test('full: the note says so, Can edit is off for anyone new, and only a place-holder keeps it', async ({ page }) => {
  await boot(page, {
    get_editor_capacity: capRow({ used: 9, pending: 1, is_full: true }),
    list_my_account_editors: [
      { slot_key: `u:${LENA}`, user_id: LENA, email: 'lena@castbox.io', display_name: 'Lena Fischer', source: 'share',
        grants: [grant({ source: 'share', board_id: 'b-cast', board_name: 'Casting' })] },
    ],
  });
  const panel = await mountPanel(page, {
    members: [{ user_id: NORA, role: 'viewer' }, { user_id: LENA, role: 'viewer' }],
    peers: [{ user: { id: NORA, name: 'Nora Quinn' } }, { user: { id: LENA, name: 'Lena Fischer' } }],
  });
  const note = panel.locator('.lim-note');
  await expect(note).toContainText('No places left for people who can edit.');
  await expect(note.getByRole('button', { name: 'See who can edit' })).toBeVisible();
  const access = panel.locator('select[aria-label="Access level for invitees"]');
  await expect(access).toHaveValue('viewer');
  await expect(access.locator('option[value="editor"]')).toBeDisabled();
  await expect(access.locator('option[value="editor"]')).toHaveText('Can edit — full');
  await expect(panel.locator('.share-role-hint')).toContainText('can’t change anything');
  // Nora would take a new place; Lena already holds one.
  const nora = panel.locator('.share-row', { hasText: 'Nora Quinn' }).locator('select');
  await expect(nora.locator('option[value="editor"]')).toBeDisabled();
  await expect(nora.locator('option[value="editor"]')).toHaveText('Workspace · can edit — full');
  await expect(nora.locator('option[value="coowner"]')).toHaveText('Co-owner — full');
  const lena = panel.locator('.share-row', { hasText: 'Lena Fischer' }).locator('select');
  await expect(lena.locator('option[value="editor"]')).toBeEnabled();
  // An address that already holds a place may still be asked to edit.
  await panel.locator('input[aria-label="Email addresses to invite"]').fill('lena@castbox.io');
  await expect(access).toHaveValue('editor');
  await expect(panel.locator('.share-btn-gold')).toHaveText('Invite');
});

test('someone else asks the owner by name, and is told it went', async ({ page }) => {
  const asked = [];
  await boot(page, {
    get_editor_capacity: capRow({ used: 10, is_full: true, i_am_account_owner: false }),
    ask_owner_for_editor_slot: (route) => {
      asked.push(JSON.parse(route.request().postData() || '{}'));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify('sent') });
    },
  });
  const panel = await mountPanel(page, { owner: false, members: [{ user_id: ME, role: 'editor' }] });
  const note = panel.locator('.lim-note');
  await expect(note).toContainText('Alex’s plan has room for 10. Invite people to view, or ask Alex to make room.');
  await note.getByRole('button', { name: 'Ask Alex for room' }).click();
  await expect(note.locator('.lim-done')).toHaveText('We told Alex you’d like to add an editor.');
  expect(asked[0]?.p_board_id).toBe(BOARD);
});

test('a refusal the panel did not see coming says so, keeps the address, and the next send goes out to view', async ({ page }) => {
  let capCalls = 0;
  const shares = [];
  await boot(page, {
    get_editor_capacity: (route) => {
      capCalls += 1;
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify(capCalls === 1 ? capRow({ used: 5 }) : capRow({ used: 10, is_full: true })) });
    },
    share_board: (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      shares.push(body);
      if (body.p_role === 'editor') {
        return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({
          code: '42501', hint: 'editor_limit', details: null,
          message: 'editor limit reached: you have 10 people who can edit across your workspaces, the most a personal plan allows',
        }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify('pending') });
    },
  });
  const panel = await mountPanel(page);
  const input = panel.locator('input[aria-label="Email addresses to invite"]');
  await input.fill('rosa@vidal.studio');
  await panel.getByRole('button', { name: 'Invite', exact: true }).click();
  await expect(page.locator('.toast-msg', { hasText: 'No places left for people who can edit: your plan has room for 10. Invite them to view, or make room.' })).toBeVisible();
  await expect(input).toHaveValue('rosa@vidal.studio');
  await expect(panel.locator('.lim-note')).toContainText('No places left for people who can edit.');
  await expect(panel.locator('select[aria-label="Access level for invitees"]')).toHaveValue('viewer');
  await panel.getByRole('button', { name: 'Invite', exact: true }).click();
  await expect.poll(() => shares.map((s) => s.p_role)).toEqual(['editor', 'viewer']);
});

test('Members: People who can edit lists the account, frees a place, and locks Editor for a viewer', async ({ page }) => {
  const shares = [];
  await page.route('https://example.supabase.co/rest/v1/workspace_members**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify([
      { user_id: ME, role: 'owner', created_at: '2026-01-01T00:00:00Z' },
      { user_id: NORA, role: 'viewer', created_at: '2026-02-01T00:00:00Z' },
    ]),
  }));
  await boot(page, {
    workspace_user_directory: [
      { workspace_id: 'ws-x', user_id: ME, title: 'Alex Moreau', email: 'alex@moreau.studio' },
      { workspace_id: 'ws-x', user_id: NORA, title: 'Nora Quinn', email: 'nora@quinnpost.com' },
    ],
    get_editor_capacity: capRow({ used: 9, pending: 1, is_full: true }),
    list_my_account_editors: [
      { slot_key: `u:${ME}`, user_id: ME, email: 'alex@moreau.studio', display_name: 'Alex Moreau', source: 'owner', grants: [] },
      { slot_key: `u:${SAM}`, user_id: SAM, email: 'sam@okafor.studio', display_name: 'Sam Okafor', source: 'member',
        grants: [grant({ role: 'coowner' })] },
      { slot_key: `u:${BEN}`, user_id: BEN, email: 'ben@adler.co', display_name: 'Ben Adler', source: 'share',
        grants: [grant({ source: 'share', board_id: 'b-music', board_name: 'Music video' })] },
      { slot_key: 'e:kai@northlight.tv', user_id: null, email: 'kai@northlight.tv', display_name: null, source: 'pending',
        grants: [grant({ source: 'pending', role: 'workspace', invite_id: 'inv-1', sent_at: '2026-10-19T15:00:00Z' })] },
    ],
    share_board: (route) => {
      shares.push(JSON.parse(route.request().postData() || '{}'));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify('granted') });
    },
  });
  await page.evaluate(async ({ me }) => {
    const { mountMembersTab } = await import('/src/local/shareWorkspaceProbe.js');
    mountMembersTab({ workspaceId: 'ws-x', workspaceName: 'Studio', user: { id: me }, role: 'owner' });
  }, { me: ME });

  const card = page.locator('.settings-cat', { hasText: 'People who can edit' });
  await expect(card.locator('.settings-cat-aside')).toHaveText('10 of 10');
  const rows = card.locator('.settings-editor-row');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('alex@moreau.studio · every workspace');
  await expect(rows.nth(0).locator('.settings-editor-role')).toHaveText('Owner');
  await expect(rows.nth(1)).toContainText('Co-owner of Studio');
  await expect(rows.nth(2)).toContainText('Can edit “Music video” in Studio');
  await expect(rows.nth(3)).toContainText('Invited to edit Studio · sent');
  await expect(rows.nth(3)).toContainText('holds a place until it’s accepted');
  await expect(rows.nth(3).getByRole('button', { name: 'Revoke' })).toHaveCount(1);

  const nora = page.locator('.settings-member-row', { hasText: 'Nora Quinn' }).locator('select');
  await expect(nora.locator('option[value="editor"]')).toBeDisabled();
  await expect(nora.locator('option[value="editor"]')).toHaveText('Editor — full');

  const ben = rows.nth(2);
  await ben.hover();
  await ben.getByRole('button', { name: 'Make viewer' }).click();
  await page.locator('.feedback-actions').getByRole('button', { name: 'Make viewer' }).click();
  await expect.poll(() => shares.length).toBe(1);
  expect(shares[0]).toEqual({ p_board_id: 'b-music', p_email: 'ben@adler.co', p_role: 'viewer' });
  await expect(page.locator('.toast-msg', { hasText: 'Ben Adler can view now. Their place is free.' })).toBeVisible();
});
```

- [ ] **Step 3: Run it on a server that is yours, plus the share specs it lives beside.**
  - Run: `cd boards && PW_PORT=5291 npx playwright test tests/editor-limit.spec.js tests/share-panel-invite-first.spec.js tests/share-panel-simplicity.spec.js tests/share-roles-wiring.spec.js tests/share-workspace-menu.spec.js --project=desktop-chrome`
  - Expected: all pass.
  - If a spec fails, report the failing assertion and the DOM it saw. Don't edit app code to fit the spec.

- [ ] **Step 4: Report** the files changed.

---

### Task 7: Build to match the pick

The main session does this task, with a `verifier` taking the screenshots.

- [ ] **Step 1: Take the shots.**
  - The real share panel, mounted as in Task 6, in four states:
    - owner near;
    - owner full;
    - non-owner full;
    - non-owner asked.
  - Each at 620px wide, dark and light.
  - Members' card at 800px.
  - The mockup's `Main.dc.html` (`dir=b`, stages `near`, `full`, `editor`, `asked`) and `Around.dc.html` (`view=members`), from the canvas server on port 5283.
- [ ] **Step 2: Compare them side by side.** Fix any spacing, colour or type that differs in `styles.css` / the components. The expected differences are:
  - no "Start a team" (S4);
  - no price in the card's foot (S5);
  - the mockup's simplified Settings frame vs the real one.
- [ ] **Step 3:** Re-run `npm test`, the Task 6 specs, and `npx vite build`.

### Task 8: Hand-off

- [ ] Commit any Task 7 fixes by pathspec. Push to main after a fetch and an ancestry check.
- [ ] Update the project memory (`project_team_plan_editor_limit_2026_10_21.md`) with the S1b commits.
- [ ] Tell the release coordinator the commits. The hold stays OFF in the 10-22 promote.
- [ ] Tell the owner what was built, with screenshots. The next owner step is the go to apply 0520 and then 0521, after which the hold opens on preview.
