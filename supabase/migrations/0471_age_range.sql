-- 0471 — an optional age range, asked beside the role (owner, 2026-10-20).
--
-- "What best describes you?" (0348) gains one row under it: "Your age ·
-- optional", five bands — Under 18, 18–24, 25–34, 35–44, 45+. Never a birth
-- date, and no band under 13: the terms require 13 or over, so offering one
-- would ask people to tell us they shouldn't be here.
--
-- Stored the way every answer is (0348): one public.feedback row, kind
-- 'age_range', the band as its choice and its label as the message, which the
-- feedback_before_write trigger fills. One per account by partial unique index,
-- and the account's deletion takes it (feedback.user_id cascades, proved
-- below, since the privacy page promises it). The band rides on no analytics
-- event — age_range_answered says only that one was given — so this row is the
-- one place it lives.
--
-- The closed list has a client twin, ReturnReasonAsk.jsx AGES, compared id for
-- id and word for word by boards/src/lib/feedbackContract.test.mjs.

-- ── The kind ────────────────────────────────────────────────────────────────
alter table public.feedback drop constraint if exists feedback_kind_check;
alter table public.feedback add constraint feedback_kind_check
  check (kind in ('bug', 'idea', 'praise', 'other', 'return_reason', 'account_deleted', 'upgrade_reason', 'role', 'age_range'));

create unique index if not exists feedback_one_age_range_per_user
  on public.feedback (user_id)
  where kind = 'age_range';

-- ── The label ───────────────────────────────────────────────────────────────
-- Each must read exactly like the segment the person tapped.
create or replace function public._age_range_label(p_choice text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case p_choice
    when 'under_18' then 'Under 18'
    when '18_24'    then '18–24'
    when '25_34'    then '25–34'
    when '35_44'    then '35–44'
    when '45_plus'  then '45+'
    else null
  end
$$;

-- From the live body (0348), plus the one branch.
create or replace function public._feedback_label(p_kind text, p_choice text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case
    when p_kind = 'return_reason'  then public._return_reason_label(p_choice)
    when p_kind = 'upgrade_reason' then public._upgrade_reason_label(p_choice)
    when p_kind = 'role'           then public._role_label(p_choice)
    when p_kind = 'age_range'      then public._age_range_label(p_choice)
    when p_kind in ('bug', 'idea', 'praise', 'other') then public._feedback_topic_label(p_choice)
    else null
  end
$$;

-- ── The write ───────────────────────────────────────────────────────────────
-- One tap, no note. The first answer stands: a second call, from another
-- device or a retry, returns false and changes nothing.
create or replace function public.submit_age_range(p_range text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid   uuid := auth.uid();
  v_range text := lower(btrim(coalesce(p_range, '')));
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  if v_range not in ('under_18', '18_24', '25_34', '35_44', '45_plus') then
    raise exception 'unknown age range' using errcode = '22023';
  end if;

  insert into public.feedback (user_id, kind, choice)
  values (v_uid, 'age_range', v_range)
  on conflict (user_id) where kind = 'age_range' do nothing;

  return found;
end $$;

comment on function public.submit_age_range(text) is
  'Records the optional age range asked beside "What best describes you?". One per '
  'account (feedback_one_age_range_per_user). Returns false when this account '
  'already has one on record.';

-- ── Grants ──────────────────────────────────────────────────────────────────
-- Since 0311 a new function is born executable by authenticated and
-- service_role. The label runs only inside the trigger and definer functions.
revoke execute on function public._age_range_label(text) from public, anon, authenticated;
revoke execute on function public.submit_age_range(text) from public, anon;
grant  execute on function public.submit_age_range(text) to authenticated;

-- ── Proofs ──────────────────────────────────────────────────────────────────
-- A REVOKE reporting success proves nothing (0311). Check the state.
do $$
declare
  v_bad text := '';
  v_fn  text;
begin
  foreach v_fn in array array['public._age_range_label(text)', 'public._feedback_label(text, text)'] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      v_bad := v_bad || ' ' || v_fn || ' is reachable by a client role;';
    end if;
  end loop;

  if has_function_privilege('anon', 'public.submit_age_range(text)', 'execute') then
    v_bad := v_bad || ' submit_age_range is reachable by anon;';
  end if;
  if not has_function_privilege('authenticated', 'public.submit_age_range(text)', 'execute') then
    v_bad := v_bad || ' submit_age_range is not executable by authenticated;';
  end if;

  -- Every band has its label through the dispatcher the trigger calls, so a tap
  -- never reaches the NOT NULL message column empty, and the old kinds still
  -- resolve.
  if public._feedback_label('age_range', 'under_18') is distinct from 'Under 18'
     or public._feedback_label('age_range', '18_24') is distinct from '18–24'
     or public._feedback_label('age_range', '25_34') is distinct from '25–34'
     or public._feedback_label('age_range', '35_44') is distinct from '35–44'
     or public._feedback_label('age_range', '45_plus') is distinct from '45+'
     or public._feedback_label('role', 'artist') is distinct from 'Artist or illustrator'
     or public._feedback_label('upgrade_reason', 'price') is distinct from 'The price'
     or public._feedback_label('return_reason', 'nothing') is distinct from 'Nothing in particular'
     or public._feedback_label('bug', 'broke') is distinct from 'Something broke' then
    v_bad := v_bad || ' a label is wrong;';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.feedback'::regclass and conname = 'feedback_kind_check'
       and pg_get_constraintdef(oid) like '%''age_range''%'
       and pg_get_constraintdef(oid) like '%''role''%'
       and pg_get_constraintdef(oid) like '%''upgrade_reason''%'
       and pg_get_constraintdef(oid) like '%''return_reason''%'
       and pg_get_constraintdef(oid) like '%''account_deleted''%'
  ) then
    v_bad := v_bad || ' feedback_kind_check does not admit age_range (or lost an old kind);';
  end if;

  if not exists (select 1 from pg_indexes
                  where schemaname = 'public' and tablename = 'feedback'
                    and indexname = 'feedback_one_age_range_per_user'
                    and indexdef like 'CREATE UNIQUE INDEX%') then
    v_bad := v_bad || ' feedback_one_age_range_per_user is missing or not unique;';
  end if;

  if not exists (select 1 from pg_constraint c
                  where c.conrelid = 'public.feedback'::regclass and c.contype = 'f'
                    and c.confrelid = 'auth.users'::regclass and c.confdeltype = 'c'
                    and c.conkey = array[(select a.attnum from pg_attribute a
                                           where a.attrelid = 'public.feedback'::regclass
                                             and a.attname = 'user_id')]) then
    v_bad := v_bad || ' feedback.user_id no longer cascades from auth.users, so an answer would outlive its account;';
  end if;

  if v_bad <> '' then
    raise exception '0471:%', v_bad;
  end if;
end $$;

notify pgrst, 'reload schema';
