-- 0596 — What a described picture shows, read by the people who can see it
-- (photo vision, 2026-10-27).
--
--   image_seen_for_board(board)   every described picture on a cluster:
--                                 card_id, description, keywords, labels. The
--                                 app's alt text and Quick look's Info read it,
--                                 and the API's board answers do, as the user.
--   similar_pictures(board, card) the image cards nearest to this one in its
--                                 workspace, by their embeddings (which carry
--                                 the descriptions): "More like this".
--
-- Both are security invoker: card_index, images, image_descriptions and
-- card_embeddings answer under their own RLS, so a reader gets exactly the
-- pictures they could open and only finished descriptions. Nothing for anon.
--
-- Applied live 2026-10-27 as 0596_picture_reads_part1 and part2_proof.

begin;
set local lock_timeout = '3s';

create or replace function public.image_seen_for_board(p_board uuid)
returns table (card_id text, description text, keywords text[], attrs jsonb)
language sql
stable
security invoker
set search_path = public
as $$
  select ci.card_id, d.description, d.keywords, d.attrs
    from public.card_index ci
    join public.images i on i.storage_path = substr(ci.meta->>'src', 4) and i.deleted_at is null
    join public.image_descriptions d on d.image_id = i.id
   where ci.board_id = p_board and ci.kind = 'image' and (ci.meta->>'src') like 'r2:%'
     and d.description is not null;
$$;

-- The same picture placed twice is not "like" itself, so cards showing the
-- same file are left out. Twelve by default, never more than 48.
create or replace function public.similar_pictures(p_board uuid, p_card text, p_limit integer default 12)
returns table (board_id uuid, card_id text, distance double precision)
language sql
stable
security invoker
set search_path = public
as $$
  with me as (
    select ce.embedding, ce.workspace_id, ci.meta->>'src' as src
      from public.card_embeddings ce
      join public.card_index ci on ci.board_id = ce.board_id and ci.card_id = ce.card_id
     where ce.entity_kind = 'card' and ce.card_id = p_card and ce.board_id = p_board and ci.kind = 'image'
  )
  select ce.board_id, ce.card_id, (ce.embedding <=> me.embedding)::double precision as distance
    from me
    join public.card_embeddings ce on ce.entity_kind = 'card' and ce.workspace_id = me.workspace_id
    join public.card_index ci on ci.board_id = ce.board_id and ci.card_id = ce.card_id and ci.kind = 'image'
   where ce.card_id <> p_card
     and (ci.meta->>'src') is distinct from me.src
     and not exists (select 1 from public.boards b where b.id = ce.board_id and b.deleted_at is not null)
   order by ce.embedding <=> me.embedding
   limit least(greatest(coalesce(p_limit, 12), 1), 48);
$$;

revoke execute on function public.image_seen_for_board(uuid) from public, anon;
revoke execute on function public.similar_pictures(uuid, text, integer) from public, anon;
grant execute on function public.image_seen_for_board(uuid) to authenticated, service_role;
grant execute on function public.similar_pictures(uuid, text, integer) to authenticated, service_role;

do $proof$
begin
  if has_function_privilege('anon', 'public.image_seen_for_board(uuid)', 'execute')
     or has_function_privilege('anon', 'public.similar_pictures(uuid,text,integer)', 'execute') then
    raise exception '0596: anon can read pictures'' descriptions';
  end if;
  if not has_function_privilege('authenticated', 'public.image_seen_for_board(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.similar_pictures(uuid,text,integer)', 'execute') then
    raise exception '0596: signed-in readers cannot call the picture reads';
  end if;
  if exists (select 1 from pg_proc
              where oid in ('public.image_seen_for_board(uuid)'::regprocedure, 'public.similar_pictures(uuid,text,integer)'::regprocedure)
                and prosecdef) then
    raise exception '0596: a picture read runs as its definer, past RLS';
  end if;
end $proof$;

commit;
