-- 0894 — Admin › Feedback says who we already reached out to.
--
-- The owner asked to "make it easy to say we reached out to people who left
-- their emails" on the Feedback tab. The outreach log already exists
-- (public.user_outreach, 0122; email-keyed since 0123) and the Users and
-- Waitlist tabs write it through admin_log_outreach / admin_delete_outreach, so
-- the Feedback tab reuses that log rather than growing a second one: a mark made
-- here shows on the person's Users profile and the other way round.
--
--   1. admin_list_feedback gains p_outreach ('waiting' | 'reached' | null) and
--      four trailing columns: reached_out_at, reached_out_by, reached_out_id,
--      waiting. Every 0348 column keeps its name, type and place, and the four
--      old arguments keep their names, so a client that never sends p_outreach
--      resolves to this function through the default and ignores the extras.
--   2. admin_feedback_outreach_summary() — the counts behind the tab's
--      "N waiting for a reply" pill.
--
-- Definitions (the list and the summary share them; keep them in step):
--   reached out  an outreach to the same person (user_id, or the same email
--                case-insensitively) logged at or after the answer was sent.
--                Marking is per person, so their earlier answers count as
--                reached too, and a newer answer after the outreach is waiting
--                again. Outreach logged on the Users tab counts.
--   waiting      the author left an email (signed in; account_deleted rows have
--                no author by design, 0323), is not one of us
--                (_internal_user_ids), wrote words of their own (has_note) or
--                ticked "OK to email me" (contact_ok), and is not reached out.
--                Tap-only answers can still be marked but never wait.

-- ── 1. The list ─────────────────────────────────────────────────────────────
-- New OUT columns and a new argument change the signature, so this is DROP +
-- CREATE (42P13 otherwise), and the drop discards the ACL — re-granted below.
drop function if exists public.admin_list_feedback(integer, integer, text, text);

create function public.admin_list_feedback(
  p_limit    integer default 100,
  p_offset   integer default 0,
  p_kind     text    default null,
  p_q        text    default null,
  p_outreach text    default null
) returns table (
  id uuid, user_id uuid, email text, kind text, choice text,
  message text, has_note boolean, has_image boolean,
  url text, viewport text, user_agent text, created_at timestamptz,
  context jsonb, contact_ok boolean,
  reached_out_at timestamptz, reached_out_by text, reached_out_id uuid,
  waiting boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_q        text := nullif(trim(coalesce(p_q, '')), '');
  v_outreach text := nullif(lower(trim(coalesce(p_outreach, ''))), '');
begin
  perform public._require_admin();
  if v_outreach is not null and v_outreach not in ('waiting', 'reached') then
    raise exception 'unknown outreach filter: %', p_outreach using errcode = '22023';
  end if;
  p_limit  := greatest(1, least(p_limit, 500));
  p_offset := greatest(0, p_offset);
  return query
  with base as (
    select f.id, f.user_id, u.email::text as email, f.kind, f.choice,
           f.message,
           (f.message is distinct from public._feedback_label(f.kind, f.choice)) as has_note,
           (f.image_data_url is not null) as has_image,
           f.url, f.viewport, f.user_agent, f.created_at,
           f.context, f.contact_ok,
           o.reached_at          as reached_out_at,
           o.reached_by_email    as reached_out_by,
           o.id                  as reached_out_id,
           exists (select 1 from public._internal_user_ids() i
                    where i.user_id = f.user_id) as is_internal
      from public.feedback f
      left join auth.users u on u.id = f.user_id
      left join lateral (
        select uo.id, uo.reached_at, uo.reached_by_email::text as reached_by_email
          from public.user_outreach uo
         where u.email is not null
           and (uo.user_id = f.user_id or lower(uo.email) = lower(u.email))
           and uo.reached_at >= f.created_at
         order by uo.reached_at desc
         limit 1
      ) o on true
     where (p_kind is null or f.kind = p_kind)
       and (v_q is null
            or f.message ilike '%' || v_q || '%'
            or f.choice  ilike '%' || v_q || '%'
            or u.email   ilike '%' || v_q || '%')
  ), marked as (
    select b.*,
           (b.email is not null
            and not b.is_internal
            and (b.has_note or coalesce(b.contact_ok, false))
            and b.reached_out_at is null) as is_waiting
      from base b
  )
  select m.id, m.user_id, m.email, m.kind, m.choice,
         m.message, m.has_note, m.has_image,
         m.url, m.viewport, m.user_agent, m.created_at,
         m.context, m.contact_ok,
         m.reached_out_at, m.reached_out_by, m.reached_out_id,
         m.is_waiting
    from marked m
   where v_outreach is null
      or (v_outreach = 'waiting' and m.is_waiting)
      or (v_outreach = 'reached' and m.reached_out_at is not null)
   order by m.created_at desc
   limit p_limit offset p_offset;
end $$;

comment on function public.admin_list_feedback(integer, integer, text, text, text) is
  'Admin › Feedback rows, newest first. p_outreach: null (everyone), ''waiting'' '
  '(left an email and words, not reached out since) or ''reached''. reached_out_* '
  'is the latest user_outreach for that person at or after the answer (0894).';

-- ── 2. The pill ─────────────────────────────────────────────────────────────
-- Counts over every answer from someone who left an email, team excluded.
-- waiting_rows matches what the list's 'waiting' filter shows; the people
-- counts collapse several answers from one person.
create function public.admin_feedback_outreach_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_out jsonb;
begin
  perform public._require_admin();
  with base as (
    select lower(u.email) as person,
           ((f.message is distinct from public._feedback_label(f.kind, f.choice))
            or coalesce(f.contact_ok, false)) as asked,
           exists (select 1 from public.user_outreach uo
                    where (uo.user_id = f.user_id or lower(uo.email) = lower(u.email))
                      and uo.reached_at >= f.created_at) as reached
      from public.feedback f
      join auth.users u on u.id = f.user_id and u.email is not null
     where not exists (select 1 from public._internal_user_ids() i
                        where i.user_id = f.user_id)
  )
  select jsonb_build_object(
           'waiting_rows',      count(*)               filter (where asked and not reached),
           'waiting_people',    count(distinct person) filter (where asked and not reached),
           'reached_people',    count(distinct person) filter (where reached),
           'with_email_people', count(distinct person))
    into v_out
    from base;
  return v_out;
end $$;

comment on function public.admin_feedback_outreach_summary() is
  'Admin › Feedback "waiting for a reply" counts; same definitions as '
  'admin_list_feedback''s waiting column (0894).';

-- ── Grants ──────────────────────────────────────────────────────────────────
-- Admin reads: the guard is inside, and anon never gets as far as calling it.
revoke execute on function public.admin_list_feedback(integer, integer, text, text, text) from public, anon;
grant  execute on function public.admin_list_feedback(integer, integer, text, text, text) to authenticated, service_role;
revoke execute on function public.admin_feedback_outreach_summary() from public, anon;
grant  execute on function public.admin_feedback_outreach_summary() to authenticated, service_role;

-- ── Proofs ──────────────────────────────────────────────────────────────────
-- A REVOKE reporting success proves nothing (0311). Check the state.
do $$
declare
  v_bad text := '';
  v_fn  text;
begin
  foreach v_fn in array array[
    'public.admin_list_feedback(integer, integer, text, text, text)',
    'public.admin_feedback_outreach_summary()'
  ] loop
    if has_function_privilege('anon', v_fn, 'execute') then
      v_bad := v_bad || ' ' || v_fn || ' is reachable by anon;';
    end if;
    if not has_function_privilege('authenticated', v_fn, 'execute') then
      v_bad := v_bad || ' ' || v_fn || ' is not executable by authenticated;';
    end if;
  end loop;

  -- The superseded overload must be gone, or two signatures answer one name
  -- and PostgREST cannot choose between them for a four-argument call.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'admin_list_feedback'
       and pg_get_function_identity_arguments(p.oid)
           = 'p_limit integer, p_offset integer, p_kind text, p_q text'
  ) then
    v_bad := v_bad || ' the old admin_list_feedback(integer, integer, text, text) survives;';
  end if;

  if v_bad <> '' then
    raise exception '0894:%', v_bad;
  end if;
end $$;

-- The list's signature changed; tell PostgREST now rather than on its next
-- cache refresh.
notify pgrst, 'reload schema';
