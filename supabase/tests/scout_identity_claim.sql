-- Scenario test: "I already have a Soleil account" — the /code linking flow.
--
-- Not part of any migration. Run it by hand against a database that has 0213
-- and 0214 applied; it creates two synthetic accounts, exercises the whole
-- hand-over, asserts, and ROLLS BACK. It writes nothing that survives.
--
--   supabase db execute --file supabase/tests/scout_identity_claim.sql
--   (or paste it into the SQL editor — the trailing rollback is what makes
--   that safe)
--
-- WHY THIS EXISTS. Two bugs in this exact path were invisible to every other
-- kind of test, because both failed SILENTLY and both live in ON CONFLICT
-- clauses that read fine:
--
--   * scout_bind_identity did not update user_id, so linking an account you
--     already had left the handle pointing at the old one.
--   * scout_threads is unique on (platform, thread_key), so a thread row left
--     behind on the old account meant "/board Diner Recce" answered "Switched
--     to Diner Recce" and then kept collecting in the Bin. Forever. No error.
--
-- Unit tests cannot catch either — they are properties of Postgres constraints
-- under a specific sequence of calls. Hence a scenario, run against real
-- Postgres. Every assertion below must come back true.

begin;

-- ── Given ────────────────────────────────────────────────────────────────────
-- A shell account minted behind someone who texted before they ever signed up,
-- and the real account they turn out to already have.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
  ('11111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'imessage-deadbeefdeadbeefdead@scout.soleilpictures.com','x',now(),now(),now()),
  ('22222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'real-person@example.com','x',now(),now(),now());

insert into public.workspaces (id, name, created_by)
values ('33333333-3333-4333-8333-333333333333','Personal','11111111-1111-4111-8111-111111111111');
insert into public.boards (id, workspace_id, name, view, created_by)
values ('44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','Scout Bin','canvas','11111111-1111-4111-8111-111111111111');

insert into public.workspaces (id, name, created_by)
values ('55555555-5555-4555-8555-555555555555','Studio','22222222-2222-4222-8222-222222222222');
insert into public.workspace_members (workspace_id, user_id, role)
values ('55555555-5555-4555-8555-555555555555','22222222-2222-4222-8222-222222222222','owner');
insert into public.boards (id, workspace_id, name, view, created_by)
values ('66666666-6666-4666-8666-666666666666','55555555-5555-4555-8555-555555555555','Diner Recce','canvas','22222222-2222-4222-8222-222222222222');

select public.scout_bind_identity('imessage','+15555550199','11111111-1111-4111-8111-111111111111','iMessage',true);
update public.scout_accounts set bin_board_id='44444444-4444-4444-8444-444444444444'
 where user_id='11111111-1111-4111-8111-111111111111';

-- An active thread with a sticky target, as any real conversation would have.
insert into public.scout_threads (user_id, platform, thread_key, target_board_id)
values ('11111111-1111-4111-8111-111111111111','imessage','thread-1','44444444-4444-4444-8444-444444444444');

-- ── When ─────────────────────────────────────────────────────────────────────
-- They open Settings → Scout in the account they already have, and text the code.
insert into public.scout_link_codes (code, user_id, expires_at)
values ('TESTCODE','22222222-2222-4222-8222-222222222222', now() + interval '15 minutes');

-- Lowercase and padded on purpose: the RPC upper()s and btrim()s what a person
-- actually types into a message.
create temp table claim_result as
  select * from public.scout_claim_link_code(' testcode ','imessage','+15555550199','iMessage');

-- ── Then ─────────────────────────────────────────────────────────────────────
select
  (select user_id from claim_result) = '22222222-2222-4222-8222-222222222222'        as claimed_by_real_account,
  -- the shell is reported so the service can carry its Bin across
  (select prior_user_id from claim_result) = '11111111-1111-4111-8111-111111111111'  as reported_the_shell,
  (select prior_bin_board_id from claim_result) = '44444444-4444-4444-8444-444444444444' as reported_the_shell_bin,
  -- binding a real account over a shell handle must not demote it
  (select is_shell from public.scout_accounts
    where user_id='22222222-2222-4222-8222-222222222222')                     = false as real_account_not_demoted,
  -- 0214 bug 1: the handle actually moves
  (select user_id from public.scout_identities
    where platform='imessage' and handle='+15555550199')
      = '22222222-2222-4222-8222-222222222222'                                       as handle_repointed,
  -- 0214 bug 2: the thread follows, and its stale cross-workspace target is dropped
  (select user_id from public.scout_threads where thread_key='thread-1')
      = '22222222-2222-4222-8222-222222222222'                                       as thread_followed,
  (select target_board_id from public.scout_threads where thread_key='thread-1') is null
                                                                                     as stale_target_cleared,
  (select user_id from public.scout_resolve_identity('imessage','+15555550199','thread-1'))
      = '22222222-2222-4222-8222-222222222222'                                       as resolves_to_real,
  -- and "/board Diner Recce" now sticks, which is the bug that made no noise
  public.scout_set_target_board('22222222-2222-4222-8222-222222222222','imessage','thread-1',
                                '66666666-6666-4666-8666-666666666666')              as retarget_ok,
  (select target_board_id from public.scout_resolve_identity('imessage','+15555550199','thread-1'))
      = '66666666-6666-4666-8666-666666666666'                                       as target_actually_sticks,
  -- adoption is bookkeeping, and it is idempotent
  public.scout_mark_adopted('11111111-1111-4111-8111-111111111111',
                            '22222222-2222-4222-8222-222222222222')                  as marked,
  public.scout_mark_adopted('11111111-1111-4111-8111-111111111111',
                            '22222222-2222-4222-8222-222222222222')            = false as marking_twice_is_a_no_op,
  -- a code is single use
  (select count(*) from public.scout_claim_link_code('TESTCODE','imessage','+15555550199','iMessage'))
                                                                               = 0     as code_cannot_be_reused;

rollback;
