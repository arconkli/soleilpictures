-- 0873_image_seen_for_board_fast.sql
--
-- image_seen_for_board (0596) took about two seconds a call in production, and
-- far longer on a large cluster, for a read the app makes whenever it draws a
-- cluster's alt text and the API makes for every board answer. Run as the
-- reader, with every table's RLS folded into one plan, the planner did not
-- start from the cluster's own cards.
--
-- The body now takes the cluster's picture cards first, in a MATERIALIZED
-- CTE, and joins images and image_descriptions to that short list by
-- storage_path (unique) and image_id (the key). The rows are the same: the
-- same cards, the same descriptions, finished ones only, a card placed twice
-- still counted twice. Everything else is 0596's word for word: the
-- signature, security invoker (each table answers under its own RLS, so a
-- reader gets exactly the pictures they could open), stable, search_path
-- public, and the grants: nothing for anon.
--
-- Checked on production before writing, as a member of each of three clusters
-- (never committed): the old and new bodies returned identical sorted rows,
-- and the new one answered in tens of milliseconds where the old one took
-- seconds. A non-member got no rows.

begin;
set local lock_timeout = '3s';

create or replace function public.image_seen_for_board(p_board uuid)
returns table (card_id text, description text, keywords text[], attrs jsonb)
language sql
stable
security invoker
set search_path = public
as $$
  with pics as materialized (
    select ci.card_id, substr(ci.meta->>'src', 4) as storage_path
      from public.card_index ci
     where ci.board_id = p_board and ci.kind = 'image' and (ci.meta->>'src') like 'r2:%'
  )
  select p.card_id, d.description, d.keywords, d.attrs
    from pics p
    join public.images i on i.storage_path = p.storage_path and i.deleted_at is null
    join public.image_descriptions d on d.image_id = i.id
   where d.description is not null;
$$;

revoke execute on function public.image_seen_for_board(uuid) from public, anon;
grant execute on function public.image_seen_for_board(uuid) to authenticated, service_role;

do $proof$
begin
  if has_function_privilege('anon', 'public.image_seen_for_board(uuid)', 'execute') then
    raise exception '0873: anon can read pictures'' descriptions';
  end if;
  if not has_function_privilege('authenticated', 'public.image_seen_for_board(uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.image_seen_for_board(uuid)', 'execute') then
    raise exception '0873: signed-in readers cannot call image_seen_for_board';
  end if;
  if exists (select 1 from pg_proc
              where oid = 'public.image_seen_for_board(uuid)'::regprocedure
                and prosecdef) then
    raise exception '0873: a picture read runs as its definer, past RLS';
  end if;
end $proof$;

commit;
