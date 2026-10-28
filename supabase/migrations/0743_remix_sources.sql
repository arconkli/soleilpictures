-- 0743 — Where a remix came from (sharing insight, Phase 1 #4).
--
-- A remix copies a public cluster (a share link's, or a page on Explore) into
-- a fresh cluster of the remixer's own. prepare_remix resolves the source and
-- hands back its snapshot, but nothing kept which cluster or which link it
-- was, so the admin can't say whose share a remix came from.
--
--   1. remix_sources: one row per remixed cluster, keyed by the new cluster:
--      the source cluster, whether it came through a link ('token') or
--      Explore ('slug'), the link's kind and its key (left(md5(token), 12),
--      never the token), who shared it (the link's maker, or whoever put the
--      page on Explore), the source's owner, and who remixed. No client reads
--      it. It follows the new cluster away; the others go null when their row
--      goes.
--   2. prepare_remix: 0168's, restated with that one insert added once the
--      source has resolved (shareCaptureMigration.test.mjs holds it to that),
--      in a block of its own that only warns: the remix never fails on it.
--      Same signature, so its grants stay as they are; the proof holds them
--      to what they were before this ran.
--   3. Proof: closed to clients, grants unchanged, and a remix through a live
--      link exercised, then undone.

set local lock_timeout = '3s';

create temp table _0743_remix_acl on commit drop as
  select p.proacl::text as acl from pg_proc p where p.oid = 'public.prepare_remix(uuid, text, uuid)'::regprocedure;

-- ── 1. The table ─────────────────────────────────────────────────────────────
create table if not exists public.remix_sources (
  dest_board_id   uuid primary key references public.boards(id) on delete cascade,
  source_board_id uuid references public.boards(id) on delete set null,
  source_kind     text not null check (source_kind in ('token', 'slug')),
  link_kind       text,
  link_key        text,
  shared_by       uuid references auth.users(id) on delete set null,
  source_owner    uuid references auth.users(id) on delete set null,
  remixed_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists remix_sources_source_idx
  on public.remix_sources (source_board_id) where source_board_id is not null;
create index if not exists remix_sources_shared_by_idx
  on public.remix_sources (shared_by) where shared_by is not null;

alter table public.remix_sources enable row level security;
revoke all on table public.remix_sources from public, anon, authenticated;

-- ── 2. The remix ─────────────────────────────────────────────────────────────
create or replace function public.prepare_remix(p_token uuid, p_slug text, p_dest_board uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_src uuid;
  v_snapshot text;
  v_name text;
begin
  -- Caller must own/write the destination board (their own fresh board).
  if not can_write_board(p_dest_board) then
    return jsonb_build_object('snapshot', null, 'source', null, 'name', null);
  end if;

  -- Resolve + validate the PUBLIC source. Token path reuses the share-link
  -- validation (active, not expired/revoked) — which RAISES on invalid, so we
  -- catch and degrade to null. Slug path uses the published-board gate.
  if p_token is not null then
    begin
      select t.root_id into v_src from public._resolve_share_target(p_token, null) t;
    exception when others then
      v_src := null;
    end;
  elsif p_slug is not null then
    v_src := public._resolve_published_board(p_slug);
  end if;

  if v_src is null then
    return jsonb_build_object('snapshot', null, 'source', null, 'name', null);
  end if;

  -- Grant the destination board cross-workspace read on the source's images.
  -- Scoped to the validated source board only; the source is already publicly
  -- viewable, so this is no escalation.
  update public.images i
     set referenced_in_board_ids = array_append(i.referenced_in_board_ids, p_dest_board)
   where i.deleted_at is null
     and (i.board_id = v_src or v_src = any(i.referenced_in_board_ids))
     and not (p_dest_board = any(i.referenced_in_board_ids));

  -- Where the remix came from (0743), for the admin's sharing ledger: the
  -- link by its key, never its token. Its own block: the remix never fails on it.
  begin
    insert into public.remix_sources
      (dest_board_id, source_board_id, source_kind, link_kind, link_key, shared_by, source_owner, remixed_by)
    select p_dest_board, v_src,
           case when p_token is not null then 'token' else 'slug' end,
           l.kind,
           case when p_token is not null then left(md5(p_token::text), 12) end,
           case when p_token is not null then l.created_by else coalesce(pb.submitted_by, pb.created_by) end,
           (select b.created_by from public.boards b where b.id = v_src),
           auth.uid()
      from (select 1) one
      left join public.public_share_links l on p_token is not null and l.token = p_token
      left join public.public_boards pb on p_token is null and pb.board_id = v_src
    on conflict (dest_board_id) do nothing;
  exception when others then
    raise warning 'prepare_remix: remix_sources: % (%)', sqlerrm, sqlstate;
  end;

  select doc into v_snapshot from public.board_state where board_id = v_src;
  select name into v_name from public.boards where id = v_src;

  return jsonb_build_object('snapshot', v_snapshot, 'source', v_src, 'name', v_name);
end;
$$;

-- ── 3. Proof ─────────────────────────────────────────────────────────────────
do $proof$
declare
  v_who   text;
  v_link  record;
  v_dest  uuid;
  v_out   jsonb;
  v_row   public.remix_sources;
begin
  foreach v_who in array array['public', 'anon', 'authenticated'] loop
    if has_table_privilege(v_who, 'public.remix_sources', 'select, insert, update, delete') then
      raise exception '0743: % can reach remix_sources', v_who;
    end if;
  end loop;
  if (select p.proacl::text from pg_proc p where p.oid = 'public.prepare_remix(uuid, text, uuid)'::regprocedure)
       is distinct from (select a.acl from _0743_remix_acl a) then
    raise exception '0743: prepare_remix''s grants changed';
  end if;

  -- A live link an internal account made, remixed by its maker into another
  -- cluster of theirs: the first of the newest ten that resolves.
  begin
    for v_link in
      select l.token, l.board_id, l.kind, l.created_by
        from public.public_share_links l
        join public.boards s on s.id = l.board_id and s.deleted_at is null
       where l.created_by in (select i.user_id from public._internal_user_ids() i)
         and l.revoked_at is null and (l.expires_at is null or l.expires_at > now())
       order by l.created_at desc
       limit 10
    loop
      perform set_config('request.jwt.claims', json_build_object('sub', v_link.created_by, 'role', 'authenticated')::text, true);
      select b.id into v_dest
        from public.boards b
       where b.created_by = v_link.created_by and b.deleted_at is null and b.id <> v_link.board_id
         and public.can_write_board(b.id)
         and not exists (select 1 from public.remix_sources r where r.dest_board_id = b.id)
       order by b.created_at desc
       limit 1;
      continue when v_dest is null;
      v_out := public.prepare_remix(v_link.token, null, v_dest);
      exit when v_out->>'source' is not null;
      v_dest := null;
    end loop;

    if v_dest is null then
      raise notice '0743: no internal link resolved into a cluster of its maker''s; the remix was not exercised';
    else
      select * into v_row from public.remix_sources r where r.dest_board_id = v_dest;
      if v_row.dest_board_id is null then
        raise exception '0743: a remix through a live link recorded nothing';
      end if;
      if v_row.source_kind <> 'token' or v_row.link_key <> left(md5(v_link.token::text), 12)
         or v_row.link_kind is distinct from v_link.kind or v_row.shared_by is distinct from v_link.created_by
         or v_row.remixed_by is distinct from v_link.created_by
         or v_row.source_board_id is distinct from (v_out->>'source')::uuid then
        raise exception '0743: the remix was recorded wrong';
      end if;
      if row_to_json(v_row)::text like '%' || v_link.token::text || '%' then
        raise exception '0743: remix_sources holds a link token';
      end if;
    end if;
    raise exception '0743: proven' using errcode = 'SL743';
  exception when sqlstate 'SL743' then
    null;   -- every write above is undone
  end;
end
$proof$;
