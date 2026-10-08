-- 0384 — joining one cluster does not hand you everyone's email address
-- (audit AC-7).
--
-- list_messageable_users returned the address of everyone you can message:
-- every member of every workspace behind any cluster you can open, and
-- everyone else shared onto it. Joining one cluster through an edit link —
-- one posted somewhere public, say — handed over the owner's whole team's
-- addresses, and the name fallback and the search did the same even when an
-- address was hidden.
--
-- Now an address is returned, used as a fallback name, or searchable only for
-- people who share a WORKSPACE with you. Everyone else is still messageable,
-- and shows their name.

begin;

CREATE OR REPLACE FUNCTION public.list_messageable_users(p_workspace uuid, p_query text DEFAULT NULL::text)
 RETURNS TABLE(user_id uuid, email text, name text, color text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with cands as (
    select wm.user_id
    from workspace_members wm
    where wm.workspace_id = p_workspace
      and is_workspace_member(p_workspace)
    union
    select o.other_uid
    from (
      select b.id as board_id, b.workspace_id
      from boards b
      where exists (select 1 from workspace_members wm
                      where wm.workspace_id = b.workspace_id and wm.user_id = auth.uid())
         or exists (select 1 from board_shares s
                      where s.board_id = b.id and s.user_id = auth.uid())
    ) mb
    cross join lateral (
      select wm2.user_id as other_uid from workspace_members wm2 where wm2.workspace_id = mb.workspace_id
      union
      select s2.user_id  as other_uid from board_shares s2     where s2.board_id = mb.board_id
    ) o
  )
  -- An address is shown only to someone who shares a WORKSPACE with its owner
  -- (0384, audit AC-7). Everyone on one cluster you joined through an edit
  -- link is messageable, but their addresses are not yours to collect; you see
  -- their name. The search below matches an address on the same terms.
  , mates as (
    select distinct them.user_id
    from workspace_members me
    join workspace_members them on them.workspace_id = me.workspace_id
    where me.user_id = auth.uid()
  )
  select
    u.id::uuid                                                                   as user_id,
    case when mt.user_id is not null then u.email::text end                      as email,
    coalesce(nullif(pr.display_name, ''), u.raw_user_meta_data->>'full_name',
             case when mt.user_id is not null then u.email::text end)::text      as name,
    pr.color::text                                                               as color
  from (select distinct user_id from cands) c
  join auth.users u on u.id = c.user_id
  left join mates mt on mt.user_id = c.user_id
  left join profiles pr on pr.user_id = u.id
  where c.user_id <> auth.uid()
    and (
      p_query is null or btrim(p_query) = ''
      or coalesce(pr.display_name, '')                        ilike '%' || p_query || '%'
      or coalesce(u.raw_user_meta_data->>'full_name', '')     ilike '%' || p_query || '%'
      or (mt.user_id is not null and coalesce(u.email, '')   ilike '%' || p_query || '%')
    )
  order by name nulls last;
$function$;

do $$
begin
  if has_function_privilege('anon', 'public.list_messageable_users(uuid,text)', 'execute') then
    raise exception '0384: list_messageable_users is callable signed out';
  end if;
end $$;

commit;
