-- 0603_image_refs_stay_in_their_workspace.sql
--
-- An image is readable by the clusters listed in images.referenced_in_board_ids,
-- and recompute_image_refs keeps that list in step with the image keys each
-- cluster's document holds. A cluster now joins an image's list only when:
--   * it is in the image's own workspace, or
--   * the image's cluster is already public: published, shared by a live
--     link, or under a live link that shares its sub-clusters (remixes and
--     copies of public clusters, the onboarding showcase among them), or
--   * the image already lists it (prepare_remix's grant, a cluster moved to
--     another workspace) — such entries are kept while the key stays in the
--     cluster's document, as before.
-- The nightly full pass follows the same rule. recompute_image_refs is no
-- longer callable by signed-in clients (nothing in the app calls it; the
-- board_state trigger runs it as its owner, and the nightly job as postgres).

create or replace function public._image_source_is_public(p_board uuid)
 returns boolean
 language sql
 stable
 set search_path to 'public'
as $function$
  with recursive chain as (
    select b.id, b.parent_board_id, 0 as depth from boards b where b.id = p_board
    union all
    select b.id, b.parent_board_id, c.depth + 1
      from boards b join chain c on b.id = c.parent_board_id
     where c.depth < 32
  )
  select p_board is not null and (
    exists (select 1 from public_boards pb where pb.board_id = p_board)
    or exists (
      select 1 from chain c
        join public_share_links l on l.board_id = c.id
       where l.revoked_at is null
         and (l.expires_at is null or l.expires_at > now())
         and (c.depth = 0 or l.include_subboards)));
$function$;

revoke execute on function public._image_source_is_public(uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.recompute_image_refs(p_board_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_affected integer := 0;
begin
  if p_board_id is null then
    with live as (
      select bs.board_id, b.workspace_id as board_ws, bs.updated_at, k.r2_key
      from board_state bs
      join boards b on b.id = bs.board_id
      cross join lateral _r2_keys_in_doc(bs.doc) as k(r2_key)
    ),
    agg as (
      -- A cluster counts for an image when it is in the image's workspace,
      -- when the image already lists it, or when the image's own cluster is
      -- public (a remix or a copy of a published or linked cluster).
      select i0.id as image_id, l.r2_key,
             array_agg(distinct l.board_id) as board_ids,
             count(distinct l.board_id)     as n_boards,
             max(l.updated_at)              as last_ts
      from live l
      join images i0 on i0.storage_path = l.r2_key
      where case when l.board_ws = i0.workspace_id then true
                 when l.board_id = any(i0.referenced_in_board_ids) then true
                 else _image_source_is_public(i0.board_id) end
      group by i0.id, l.r2_key
    )
    update images i set
      referenced_in_board_ids = coalesce(a.board_ids, '{}'::uuid[]),
      ref_count               = coalesce(a.n_boards, 0),
      last_referenced_at      = case when a.r2_key is not null
                                     then greatest(coalesce(i.last_referenced_at, a.last_ts), a.last_ts)
                                     else i.last_referenced_at end,
      first_referenced_at     = case when a.r2_key is not null
                                     then coalesce(i.first_referenced_at, a.last_ts)
                                     else i.first_referenced_at end
    from images base
    left join agg a on a.image_id = base.id
    where i.id = base.id
      and (
        i.referenced_in_board_ids is distinct from coalesce(a.board_ids, '{}'::uuid[])
        or i.ref_count is distinct from coalesce(a.n_boards, 0)
        or (a.r2_key is not null and i.first_referenced_at is null)
        or (a.r2_key is not null
            and (i.last_referenced_at is null or i.last_referenced_at < a.last_ts))
      );
    get diagnostics v_affected = row_count;

  else
    with live_b as (
      select distinct k.r2_key
      from board_state bs
      cross join lateral _r2_keys_in_doc(bs.doc) as k(r2_key)
      where bs.board_id = p_board_id
    ),
    candidates as (
      select i.id from images i
       where i.storage_path in (select r2_key from live_b)
         and case when i.workspace_id = (select b.workspace_id from boards b where b.id = p_board_id) then true
                  else _image_source_is_public(i.board_id) end
      union
      select id from images where referenced_in_board_ids @> array[p_board_id]
    ),
    affected as (
      select i.id,
             i.storage_path,
             i.referenced_in_board_ids,
             i.first_referenced_at,
             (i.storage_path in (select r2_key from live_b)) as live_here
      from images i
      where i.id in (select id from candidates)
    ),
    computed as (
      select a.id,
             a.first_referenced_at,
             a.live_here,
             case when a.live_here then (
                    select coalesce(array_agg(distinct b), '{}'::uuid[])
                    from unnest(array_remove(a.referenced_in_board_ids, p_board_id) || array[p_board_id]) as b
                  )
                  else array_remove(a.referenced_in_board_ids, p_board_id)
             end as new_boards
      from affected a
    )
    update images i set
      referenced_in_board_ids = coalesce(c.new_boards, '{}'::uuid[]),
      ref_count               = coalesce(cardinality(c.new_boards), 0),
      last_referenced_at      = case when c.live_here then now() else i.last_referenced_at end,
      first_referenced_at     = case when c.live_here then coalesce(c.first_referenced_at, now())
                                     else c.first_referenced_at end
    from computed c
    where i.id = c.id
      and (
        i.referenced_in_board_ids is distinct from coalesce(c.new_boards, '{}'::uuid[])
        or i.ref_count is distinct from coalesce(cardinality(c.new_boards), 0)
        or (c.live_here and i.first_referenced_at is null)
      );
    get diagnostics v_affected = row_count;
  end if;

  return v_affected;
end;
$function$;

revoke execute on function public.recompute_image_refs(uuid) from public, anon, authenticated;

-- The 0311 habit: prove it.
do $$
begin
  if has_function_privilege('anon', 'public.recompute_image_refs(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.recompute_image_refs(uuid)', 'EXECUTE') then
    raise exception '0603: recompute_image_refs is client-callable';
  end if;
  if not has_function_privilege('service_role', 'public.recompute_image_refs(uuid)', 'EXECUTE') then
    raise exception '0603: service_role lost recompute_image_refs';
  end if;
  if has_function_privilege('anon', 'public._image_source_is_public(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._image_source_is_public(uuid)', 'EXECUTE') then
    raise exception '0603: _image_source_is_public is client-callable';
  end if;
end $$;
