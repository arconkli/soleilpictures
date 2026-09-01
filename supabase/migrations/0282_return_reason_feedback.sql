-- 0282 — give users a way to say something, and stop the feedback table's
-- grants from being wider than anything can use.
--
-- public.feedback has RLS enabled and ZERO policies. That has made it
-- admin-read-only for its entire life, and it holds a single row for the whole
-- history of the product. This was not a low response rate — there has never
-- been a write path from the app at all. Nobody has ever been able to tell us
-- anything.
--
-- That is the largest gap in what we know about retention. Behaviour telemetry
-- is dense here and it can only ever say what someone did; it cannot say why
-- they decided the product was not for them.
--
-- ── 1. THE GRANTS ARE A LOADED GUN WITH THE SAFETY ON ───────────────────────
-- anon and authenticated hold INSERT, SELECT, UPDATE and DELETE on this table.
-- Every one of them is currently dead, because RLS with no policies denies
-- everything — but the only thing standing between those grants and reality is
-- the continued absence of a permissive policy, and adding one is exactly what
-- this migration was tempted to do. A policy written to allow inserts would
-- have switched on the DELETE grant sitting beside it.
--
-- This is the same shape as the table-level grant problem on public.boards: the
-- grant is the real permission, and the policy is only the part people read.
-- Writes go through the definer function below, so no policy is needed and
-- none of these grants are.
revoke insert, update, delete on public.feedback from anon, authenticated;

-- ── 2. ONE QUESTION, ANSWERABLE ONCE ────────────────────────────────────────
-- Definer rather than an RLS insert policy, because a policy would have to
-- trust the client with `kind` and with an unbounded `message`. Here the kind
-- is stamped server-side, the choice is checked against a closed list so the
-- column stays groupable, and the free text is TRUNCATED rather than rejected —
-- somebody who writes a paragraph should not lose it to a validation error.
--
-- The one-per-account rule lives here rather than in the client so that
-- clearing localStorage cannot reopen a question the user has already answered.
-- Returning false rather than raising keeps that an ordinary outcome instead of
-- an error the caller has to pattern-match.
create or replace function public.submit_return_reason(
  p_choice text,
  p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_choice text := lower(btrim(coalesce(p_choice, '')));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_msg text;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  if v_choice not in ('unfinished', 'new_material', 'reminded', 'someone_asked', 'looking') then
    raise exception 'unknown choice' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.feedback f
     where f.user_id = v_uid and f.kind = 'return_reason'
  ) then
    return false;
  end if;

  v_msg := v_choice || case when v_note is null then '' else ' — ' || left(v_note, 500) end;

  insert into public.feedback (user_id, kind, message)
  values (v_uid, 'return_reason', v_msg);

  return true;
end $$;

revoke all on function public.submit_return_reason(text, text) from public, anon;
grant execute on function public.submit_return_reason(text, text) to authenticated;

comment on function public.submit_return_reason(text, text) is
  'The only write path into public.feedback. Until now there was none at all: '
  'RLS is enabled with no policies, so the table has been admin-read-only for '
  'its whole life and no user has ever been able to say anything through the '
  'product. Definer rather than an RLS policy so the client cannot choose kind '
  'or write unbounded text — the choice is checked against a closed list and '
  'the optional note is truncated, not rejected. Returns false (not an error) '
  'if this account has already answered; the one-per-account rule lives here '
  'so clearing localStorage cannot reopen the question.';

-- ── 3. AND DELETION HAS TO ACTUALLY DELETE IT ───────────────────────────────
-- feedback.user_id was ON DELETE SET NULL. That was defensible while the table
-- held nothing a user had written: an unlinked, analytics-shaped row is exactly
-- the anonymisation the data-and-privacy page already describes for analytics
-- and error records.
--
-- It stops being defensible the moment the table holds FREE TEXT somebody
-- typed, and the function above is the first thing in the product's history to
-- put any there. Prose can identify its author in ways a metrics row cannot,
-- and "unlinked" is not "gone".
--
-- Account deletion was itself broken until 0264, when four constraints turned
-- out to be ON DELETE NO ACTION; this one was set to SET NULL in that pass and
-- is being tightened rather than fixed. Cascading here is what makes the
-- sentence on the privacy page true.
alter table public.feedback
  drop constraint feedback_user_id_fkey;

alter table public.feedback
  add constraint feedback_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;
