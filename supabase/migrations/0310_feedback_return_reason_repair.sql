-- 0310 — the return question has never once been able to store an answer.
--
-- 0282 added submit_return_reason(), which stamps kind = 'return_reason' and
-- inserts into public.feedback. public.feedback has carried a CHECK since 0080:
--
--     kind text not null check (kind in ('bug', 'idea', 'praise', 'other'))
--
-- No migration ever widened it. Every call this function has ever received
-- raised 23514 and was discarded. The client could not see it either: the
-- supabase-js builder RESOLVES with {data, error} rather than throwing, so the
-- try/catch around the call caught nothing and the error was dropped, and the
-- once-per-account marker was written BEFORE the round trip. So the product
-- asked a question, told people it was listening, retired their account from
-- ever being asked again, and stored nothing.
--
-- Everything else in 0282 landed correctly — the FK is ON DELETE CASCADE, the
-- INSERT/UPDATE/DELETE grants are revoked, the function carries the right ACL.
-- The CHECK is the whole of the database-side bug.
--
-- WHY IT SURVIVED, because the next person deserves to know: the feature was
-- not untested. Its spec asserted, at length, that 0282's TEXT contains
-- 'return_reason'. It read one side of a contract and called that coverage,
-- and it was a Playwright spec besides, so the pre-commit gate never ran it.
-- boards/src/lib/feedbackContract.test.mjs now resolves the CHECK across all
-- migrations last-writer-wins and asserts it is a superset of every kind any
-- writer stores — including send-feedback/index.ts, which lives outside the
-- app package and is the writer most likely to be forgotten.

-- ── 1. THE CONSTRAINT ───────────────────────────────────────────────────────
alter table public.feedback drop constraint if exists feedback_kind_check;

alter table public.feedback
  add constraint feedback_kind_check
  check (kind in ('bug', 'idea', 'praise', 'other', 'return_reason'));

-- ── 2. THE CHOICE, AS A COLUMN ──────────────────────────────────────────────
-- 0282 packed the answer as `choice || ' — ' || note` into message, which made
-- the category a string prefix rather than something you can group by, and put
-- a machine-written slug at the head of a field the privacy page describes as
-- text the user chose to send.
--
-- Deliberately NULLABLE and deliberately WITHOUT a check constraint. The closed
-- list is enforced inside submit_return_reason, where it can be changed in the
-- same statement as the function that depends on it; a second constraint here
-- would be a copy of that list which nothing keeps in step.
--
-- No re-grant is needed. Every privilege on this table is table-level (attacl
-- is null on every column), so a new column inherits the existing SELECT grant
-- automatically — and that grant is inert, because RLS is enabled with zero
-- policies. Worth saying out loud, because 0282 revoked INSERT/UPDATE/DELETE
-- from anon and authenticated and deliberately left SELECT in place, and the
-- next reader will wonder whether this column just became readable. It did not.
alter table public.feedback add column if not exists choice text;

comment on column public.feedback.choice is
  'For kind=''return_reason'': which answer was tapped. The closed list lives '
  'in submit_return_reason and nowhere else — do not add a CHECK here, it '
  'would be a copy of that list with nothing keeping the two in step.';

comment on column public.feedback.message is
  'User-written text, EXCEPT for a kind=''return_reason'' row whose author '
  'tapped an answer and skipped the follow-up: there message holds the '
  'server-synthesized label for the choice, because this column is NOT NULL '
  'and three export RPCs to_jsonb() the whole row. Compare against '
  '_return_reason_label(choice) to tell the two apart — admin_list_feedback '
  'returns that comparison as has_note.';

-- One answer per account, as an index rather than as a race. 0282 enforced this
-- with a `select 1 … where user_id = … and kind = 'return_reason'` that had no
-- supporting index at all (feedback_kind_time is (kind, created_at desc)). This
-- is both the correctness guard and that missing index, and it is what the
-- upsert below infers its conflict target from.
create unique index if not exists feedback_one_return_reason_per_user
  on public.feedback (user_id)
  where kind = 'return_reason';

-- ── 3. THE LABELS, IN ONE PLACE ─────────────────────────────────────────────
-- Used twice: to fill message when someone answers without writing anything,
-- and to decide whether a stored message is prose or our own filler.
create or replace function public._return_reason_label(p_choice text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case p_choice
    when 'resuming'  then 'Picking up where I left off'
    when 'adding'    then 'Adding material I''ve collected since'
    when 'starting'  then 'Starting something new'
    when 'reviewing' then 'Looking back through what I''ve got'
    when 'sharing'   then 'Showing it to someone, or working together'
    when 'nothing'   then 'Nothing in particular'
    else null
  end
$$;

revoke all on function public._return_reason_label(text) from public, anon;
grant execute on function public._return_reason_label(text) to authenticated, service_role;

-- ── 4. THE WRITE ────────────────────────────────────────────────────────────
-- Two calls per answer, by design. The tap is banked immediately, so a person
-- who taps and then closes the tab has still been heard; the follow-up updates
-- the row the tap wrote. A dropped second call costs the note, never the
-- choice. That is the whole reason this upserts instead of inserting once at
-- the end of a two-step flow.
--
-- The closed list is checked here rather than trusted from the client, so the
-- column stays groupable. It changed wholesale in this migration: the old list
-- mixed a JOB (unfinished, new_material) with a TRIGGER (reminded,
-- someone_asked), so a person with a true answer on each axis had to discard
-- one and which one they discarded depended on salience — the buckets could
-- never be pooled. The new list is one axis: what you are here to do.
create or replace function public.submit_return_reason(
  p_choice text,
  p_note   text default null
) returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid    uuid := auth.uid();
  v_choice text := lower(btrim(coalesce(p_choice, '')));
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_label  text;
  v_existing record;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  if v_choice not in ('resuming', 'adding', 'starting', 'reviewing', 'sharing', 'nothing') then
    raise exception 'unknown choice' using errcode = '22023';
  end if;

  v_label := public._return_reason_label(v_choice);

  select id, choice, message into v_existing
    from public.feedback
   where user_id = v_uid and kind = 'return_reason'
   for update;

  if found then
    -- Already carries prose, or the follow-up added nothing: done. Returning
    -- false rather than raising keeps "you already answered" an ordinary
    -- outcome instead of an error the caller has to pattern-match.
    if v_note is null or v_existing.message is distinct from public._return_reason_label(v_existing.choice) then
      return false;
    end if;
    update public.feedback
       set message = left(v_note, 500),
           choice  = v_choice
     where id = v_existing.id;
    return true;
  end if;

  -- The note is TRUNCATED, never rejected. Somebody who writes a paragraph
  -- should not lose it to a validation error.
  insert into public.feedback (user_id, kind, choice, message)
  values (v_uid, 'return_reason', v_choice, coalesce(left(v_note, 500), v_label));

  return true;
end $$;

comment on function public.submit_return_reason(text, text) is
  'Records the return question. Call once with the choice, then again with the '
  'note — the second call updates the row the first wrote, so a dropped '
  'follow-up costs the note and never the choice. One answer per account, '
  'enforced by feedback_one_return_reason_per_user rather than by the client, '
  'so clearing localStorage cannot reopen it.';

revoke all on function public.submit_return_reason(text, text) from public, anon;
grant execute on function public.submit_return_reason(text, text) to authenticated;

-- ── 5. THE READ ─────────────────────────────────────────────────────────────
-- Must be DROPped, not CREATE OR REPLACEd: adding OUT columns changes the
-- return type and Postgres refuses that with 42P13.
--
-- And the drop discards the ACL. 0305 revoked EXECUTE on every admin_* function
-- from PUBLIC in a one-shot DO loop that will not run again, so a bare
-- CREATE FUNCTION here would silently hand this back to PUBLIC — Postgres
-- grants EXECUTE to PUBLIC by default. The revoke/grant pair below is not
-- decoration.
--
-- has_image rather than the image itself: a screenshot is capped at 3 MB by
-- send-feedback and p_limit clamps to 500, so returning image_data_url from a
-- LIST call would put up to a gigabyte and a half of base64 on the wire for
-- every poll of a tab that shows fifty rows of text. The image is fetched by id
-- when a row is opened.
drop function if exists public.admin_list_feedback(integer, integer, text, text);

create function public.admin_list_feedback(
  p_limit  integer default 100,
  p_offset integer default 0,
  p_kind   text    default null,
  p_q      text    default null
) returns table (
  id uuid, user_id uuid, email text, kind text, choice text,
  message text, has_note boolean, has_image boolean,
  url text, viewport text, user_agent text, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare v_q text := nullif(trim(coalesce(p_q, '')), '');
begin
  perform public._require_admin();
  p_limit  := greatest(1, least(p_limit, 500));
  p_offset := greatest(0, p_offset);
  return query
  select f.id, f.user_id, u.email::text, f.kind, f.choice,
         f.message,
         (f.message is distinct from public._return_reason_label(f.choice)) as has_note,
         (f.image_data_url is not null) as has_image,
         f.url, f.viewport, f.user_agent, f.created_at
    from public.feedback f
    left join auth.users u on u.id = f.user_id
   where (p_kind is null or f.kind = p_kind)
     and (v_q is null
          or f.message ilike '%' || v_q || '%'
          or f.choice  ilike '%' || v_q || '%'
          or u.email   ilike '%' || v_q || '%')
   order by f.created_at desc
   limit p_limit offset p_offset;
end $$;

revoke all on function public.admin_list_feedback(integer, integer, text, text) from public, anon;
grant execute on function public.admin_list_feedback(integer, integer, text, text) to authenticated, service_role;

-- Fetched on demand, when an admin opens a row. Screenshots have been written
-- since 0095 and have never been visible anywhere in the product.
create or replace function public.admin_get_feedback_image(p_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_img text;
begin
  perform public._require_admin();
  select image_data_url into v_img from public.feedback where id = p_id;
  return v_img;
end $$;

revoke all on function public.admin_get_feedback_image(uuid) from public, anon;
grant execute on function public.admin_get_feedback_image(uuid) to authenticated, service_role;
