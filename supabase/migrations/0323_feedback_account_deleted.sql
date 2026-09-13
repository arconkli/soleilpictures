-- 0323 — a leaving user can say why.
--
-- delete-own-account erases the account and records nothing about the reason.
-- The one sentence a person is most willing to type is the one at the door,
-- and the product has been throwing it away. This adds a definer RPC the
-- Settings dialog calls BEFORE the edge function runs, while the caller still
-- exists to be authenticated.
--
-- The row is written with user_id NULL on purpose: feedback.user_id cascades on
-- delete (0282), and the whole point is a sentence that outlives the account.
-- Nothing else in the row identifies the author.
--
-- The CHECK on feedback.kind must admit the new kind first — 0310 is the record
-- of what happens when a writer and the constraint disagree (every insert
-- failed and the client swallowed it). feedbackContract.test.mjs reads this
-- file's insert and the CHECK and refuses a mismatch; it also refuses a kind
-- the admin Feedback tab cannot filter to.

alter table public.feedback drop constraint if exists feedback_kind_check;
alter table public.feedback add constraint feedback_kind_check
  check (kind in ('bug', 'idea', 'praise', 'other', 'return_reason', 'account_deleted'));

create or replace function public.submit_deletion_reason(p_reason text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid  uuid := auth.uid();
  v_text text := left(btrim(coalesce(p_reason, '')), 500);
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if v_text = '' then
    return false;
  end if;
  insert into public.feedback (user_id, kind, message, url)
  values (null, 'account_deleted', v_text, '/settings');
  return true;
end $$;

revoke execute on function public.submit_deletion_reason(text) from public, anon;
grant execute on function public.submit_deletion_reason(text) to authenticated;

comment on function public.submit_deletion_reason(text) is
  'Records why a signed-in user is deleting their account, as an author-less '
  'feedback row (kind account_deleted) that survives the deletion. Truncates to '
  '500 characters; an empty reason writes nothing.';

do $$
begin
  if has_function_privilege('anon', 'public.submit_deletion_reason(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.submit_deletion_reason(text)', 'execute') then
    raise exception '0323: submit_deletion_reason grants are wrong';
  end if;
end $$;
