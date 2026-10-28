-- 0595 — Search finds a picture by what is in it (photo vision, 2026-10-27).
--
-- entity_search (⌘K, the Files search, and the API's search) gains a trailing
-- `seen` column: for an image card whose picture is described (0593), the
-- description, its keywords and its labels (medium, shot, light, colours, era,
-- setting, text in it); null on every other row. entitySearchFilter.js adds
-- it to the words searched, so "red car" or "night exterior" finds the photo.
--
-- The view stays security_invoker, so a row of image_descriptions the reader
-- may not see (RLS: done, and a picture they can read) joins as nothing and
-- `seen` stays null for them. It reads only the columns authenticated may
-- select (no status: a description is only ever written with status 'done').
-- Every branch is restated exactly as 0404 wrote it; only `seen` is new. The
-- picture is looked up per card (a scalar subquery on images' unique
-- storage_path), so a search never scans every picture to join them, and the
-- trash filters trashBatches.test.mjs pins keep their form.
--
-- Applied live 2026-10-27 as 0595_search_sees_pictures_part1 (a plain left
-- join), part2_proof, part3_lateral, then part4_scalar (this file's view).

begin;
set local lock_timeout = '3s';

create or replace view public.entity_search with (security_invoker = on) as
 SELECT b.id::text AS id,
    'board'::text AS kind,
    b.workspace_id,
    b.id AS board_id,
    NULL::text AS card_id,
    b.name AS title,
    b.meta AS body,
    NULL::jsonb AS meta,
    b.updated_at,
    NULL::text AS seen
   FROM boards b
  WHERE b.deleted_at IS NULL
UNION ALL
 SELECT (ci.board_id::text || ':'::text) || ci.card_id AS id,
    ci.kind,
    ci.workspace_id,
    ci.board_id,
    ci.card_id,
    ci.title,
    ci.body,
    ci.meta,
    ci.updated_at,
    (SELECT CASE WHEN d.description IS NOT NULL THEN
              concat_ws(' ', d.description,
                NULLIF(array_to_string(d.keywords, ', '), ''),
                NULLIF(concat_ws(', ', d.attrs ->> 'medium', d.attrs ->> 'shot_type', d.attrs ->> 'lighting',
                  CASE WHEN jsonb_typeof(d.attrs -> 'palette') = 'array'
                       THEN NULLIF((SELECT string_agg(p.v, ', ') FROM jsonb_array_elements_text(d.attrs -> 'palette') p(v)), '') END,
                  d.attrs ->> 'era', d.attrs ->> 'location', d.attrs ->> 'text_in_image'), ''))
            END
       FROM images i JOIN image_descriptions d ON d.image_id = i.id
      WHERE ci.kind = 'image' AND (ci.meta ->> 'src') LIKE 'r2:%'
        AND i.storage_path = substr(ci.meta ->> 'src', 4) AND i.deleted_at IS NULL) AS seen
   FROM card_index ci
  WHERE NOT EXISTS (SELECT 1 FROM boards tb WHERE tb.id = ci.board_id AND tb.deleted_at IS NOT NULL)
UNION ALL
 SELECT (gi.board_id::text || ':g:'::text) || gi.group_id AS id,
    'group'::text AS kind,
    gi.workspace_id,
    gi.board_id,
    gi.group_id AS card_id,
    gi.name AS title,
    NULL::text AS body,
    jsonb_build_object('memberCount', gi.member_count, 'outline', gi.outline, 'color', gi.color) AS meta,
    gi.updated_at,
    NULL::text AS seen
   FROM group_index gi
  WHERE NOT EXISTS (SELECT 1 FROM boards tb WHERE tb.id = gi.board_id AND tb.deleted_at IS NOT NULL)
UNION ALL
 SELECT d.user_id::text AS id,
    'user'::text AS kind,
    d.workspace_id,
    NULL::uuid AS board_id,
    NULL::text AS card_id,
    d.title,
    d.email AS body,
    NULL::jsonb AS meta,
    GREATEST(d.created_at, now()) AS updated_at,
    NULL::text AS seen
   FROM workspace_user_directory() d(user_id, workspace_id, title, email, created_at)
UNION ALL
 SELECT t.id::text AS id,
    'tag'::text AS kind,
    t.workspace_id,
    NULL::uuid AS board_id,
    NULL::text AS card_id,
    t.name AS title,
    NULL::text AS body,
    jsonb_build_object('color', t.color, 'createdKind', t.kind) AS meta,
    t.created_at AS updated_at,
    NULL::text AS seen
   FROM tags t
  WHERE COALESCE(t.status, 'active'::text) <> 'deleted'::text;

do $proof$
begin
  if not exists (select 1 from pg_attribute where attrelid = 'public.entity_search'::regclass and attname = 'seen' and not attisdropped) then
    raise exception '0595: entity_search has no seen column';
  end if;
  if not coalesce((select 'security_invoker=on' = any(reloptions) or 'security_invoker=true' = any(reloptions)
                     from pg_class where oid = 'public.entity_search'::regclass), false) then
    raise exception '0595: entity_search lost security_invoker';
  end if;
  if not has_table_privilege('authenticated', 'public.entity_search', 'select') then
    raise exception '0595: signed-in search lost its grant';
  end if;
  if has_table_privilege('anon', 'public.entity_search', 'select') then
    raise exception '0595: anon can read entity_search';
  end if;
end $proof$;

commit;
