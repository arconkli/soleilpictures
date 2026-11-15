-- 0890_public_cover_preview.sql
--
-- A public cluster's cover (public_boards.og_image_key) is a photo stored as
-- it was uploaded, and /api/public-thumb/<slug> sent it at that size to every
-- link preview and to the example lists on the search pages. The app already
-- keeps a share-sized WebP of a picture (images.preview_path, 0105); this
-- tells the Worker about the cover's.
--
--   1. get_public_board_meta (0860) also returns 'og_cover': the cover's own
--      size and, when it has one, its preview's key and size. Null when the
--      cluster has no cover or the cover has no images row. The Worker
--      (boards/src/lib/publicCover.js) serves the preview when it is there and
--      the original when it is not, and writes the og:image type and size from
--      whichever it serves. A Worker that has never heard of 'og_cover' ignores
--      it, and a Worker that expects it works without it, so this and the
--      Worker can ship in either order.
--   2. The preview key is returned only when it sits where the app writes
--      previews: <the picture's workspace>/previews/….webp. preview_path is
--      stamped by a workspace writer (set_image_variant), and this answer goes
--      to anyone, so a key pointing anywhere else is not passed on.
--   3. The 0311 proof block.
--
-- Nothing is written: the previews themselves are made by
-- boards/scripts/backfill-image-variants.mjs --covers.
--
-- The number leaves room after 0882 for the other migrations of the same
-- release; it has no meaning of its own.

begin;

-- get_public_board_meta: 0860 definition + 'og_cover'.
create or replace function public.get_public_board_meta(p_slug text)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_target uuid;
  v_out    json;
begin
  v_target := _resolve_published_board(p_slug);
  if v_target is null then
    raise exception 'no such public board' using errcode = 'P0002';
  end if;

  select json_build_object(
           'board_id',         pb.board_id,
           'slug',             pb.slug,
           'name',             b.name,
           'seo_title',        pb.seo_title,
           'seo_description',  pb.seo_description,
           'seo_body',         pb.seo_body,
           'target_keyword',   pb.target_keyword,
           'og_image_key',     pb.og_image_key,
           'og_cover',         (select json_build_object(
                                   'w', i.width,
                                   'h', i.height,
                                   'preview_key', pv.key,
                                   'preview_w',   case when pv.key is not null then i.preview_w end,
                                   'preview_h',   case when pv.key is not null then i.preview_h end)
                                  from images i
                                  left join lateral (
                                    select i.preview_path as key
                                     where i.preview_path like i.workspace_id::text || '/previews/%.webp'
                                       and position('..' in i.preview_path) = 0
                                  ) pv on true
                                 where i.storage_path = regexp_replace(pb.og_image_key, '^r2:', '')
                                   and i.deleted_at is null
                                 limit 1),
           'is_template',      pb.is_template,
           'unlisted',         pb.unlisted,
           'published_at',     pb.published_at,
           'updated_at',       greatest(pb.updated_at, b.updated_at),
           'thumb_key',        b.thumb_key,
           'thumb_updated_at', b.thumb_updated_at,
           'thumb_version',    b.thumb_version,
           'card_count',       (select count(*) from card_index ci where ci.board_id = pb.board_id and b.deleted_at is null)
         )
    into v_out
  from public_boards pb join boards b on b.id = pb.board_id
  where pb.board_id = v_target;

  return v_out;
end;
$$;

-- ── Proof (the 0311 habit) ──────────────────────────────────────────────────
do $proof$
declare
  v_fn   constant text := 'public.get_public_board_meta(text)';
  v_role text;
begin
  -- A public read: create or replace keeps the ACL, and this proves it.
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if not has_function_privilege(v_role, v_fn, 'execute') then
      raise exception '0890: % cannot run %', v_role, v_fn;
    end if;
  end loop;
  if not (select p.prosecdef and 'search_path=public' = any (p.proconfig)
            from pg_proc p where p.oid = v_fn::regprocedure) then
    raise exception '0890: % lost its definer rights or its search_path', v_fn;
  end if;
  if position('og_cover' in pg_get_functiondef(v_fn::regprocedure)) = 0
     or position('unlisted' in pg_get_functiondef(v_fn::regprocedure)) = 0 then
    raise exception '0890: % does not return og_cover, or lost unlisted', v_fn;
  end if;
  -- The resolver the page uses stays closed to clients.
  if has_function_privilege('anon', 'public._resolve_published_board(text)', 'execute')
     or has_function_privilege('authenticated', 'public._resolve_published_board(text)', 'execute') then
    raise exception '0890: _resolve_published_board is callable by a client';
  end if;
end $proof$;

notify pgrst, 'reload schema';

commit;
