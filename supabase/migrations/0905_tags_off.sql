-- 0905 — Tags are off (2026-11-17).
--
-- Tags left Clusters: nobody can tag a card, group, cluster or doc passage any
-- more, the AI tagger stopped, and /api/v1, MCP and webhooks lost their tag
-- parts. Nothing is deleted. tags, the tag rows in entity_links,
-- tag_suggestions, tag_centroids, card_embeddings and autotag_ignored stay
-- stored, and so do the functions; purge_deleted_tags keeps finishing the
-- deletions people already asked for.
--
-- This migration stops the parts that still run by themselves:
--   * the five autotag triggers. They applied a tag wherever its name appeared
--     in a card, a doc page, a group or a cluster name, or when a tag was
--     renamed. Each inserts tag rows into entity_links and does nothing else
--     (checked against the live definitions on 2026-11-17).
--   * the three entity_links webhook triggers. They queued tag.applied and
--     tag.removed, which the app no longer offers, and queue nothing else.
--     Mentions and backlinks keep every other entity_links trigger.
--   * entity_search's tag branch, so search and the @ picker stop finding
--     tags. Every other branch is 0879's, restated exactly. create or replace
--     keeps the view's options and grants (security_invoker; authenticated
--     only), and the columns are unchanged.
-- The trigger functions stay, so bringing tags back means re-creating the
-- eight triggers and the branch from 0879.
--
-- Ship: with or before the app release. Either order is safe: the app drops
-- tag rows from entity_search and skips queued tag webhook events itself.

begin;
set local lock_timeout = '3s';

-- ── The eight tag triggers ──────────────────────────────────────────────────

do $off$
declare
  r record;
begin
  for r in
    select * from (values
      ('autotag_card_index',       'public.card_index'),
      ('autotag_doc_page_index',   'public.doc_page_index'),
      ('autotag_group_index',      'public.group_index'),
      ('autotag_boards_rename',    'public.boards'),
      ('autotag_tags_slug',        'public.tags'),
      ('entity_links_webhook_ins', 'public.entity_links'),
      ('entity_links_webhook_upd', 'public.entity_links'),
      ('entity_links_webhook_del', 'public.entity_links')
    ) v(tg, tbl)
  loop
    if exists (select 1 from pg_trigger
                where tgname = r.tg and tgrelid = r.tbl::regclass and not tgisinternal) then
      execute format('drop trigger %I on %s', r.tg, r.tbl);
    end if;
  end loop;
end
$off$;

-- ── entity_search: 0879 without the tag branch ──────────────────────────────

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
    NULL::text AS seen,
    nullif(public.search_fold(b.name), b.name) AS fold
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
        AND i.storage_path = substr(ci.meta ->> 'src', 4) AND i.deleted_at IS NULL) AS seen,
    ci.fold
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
    NULL::text AS seen,
    nullif(public.search_fold(gi.name), gi.name) AS fold
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
    NULL::text AS seen,
    nullif(public.search_fold(d.title), d.title) AS fold
   FROM workspace_user_directory() d(user_id, workspace_id, title, email, created_at);

-- ── Proof ───────────────────────────────────────────────────────────────────

do $proof$
begin
  if exists (select 1 from pg_trigger
              where not tgisinternal
                and tgname in ('autotag_card_index', 'autotag_doc_page_index', 'autotag_group_index',
                               'autotag_boards_rename', 'autotag_tags_slug', 'entity_links_webhook_ins',
                               'entity_links_webhook_upd', 'entity_links_webhook_del')) then
    raise exception '0905: a tag trigger is still there';
  end if;
  if exists (select 1 from pg_depend dp join pg_rewrite rw on rw.oid = dp.objid
              where rw.ev_class = 'public.entity_search'::regclass
                and dp.refobjid = 'public.tags'::regclass) then
    raise exception '0905: entity_search still reads tags';
  end if;
  if not has_table_privilege('authenticated', 'public.entity_search', 'select') then
    raise exception '0905: signed-in search lost its grant';
  end if;
  if has_table_privilege('anon', 'public.entity_search', 'select') then
    raise exception '0905: anon can read entity_search';
  end if;
  if not coalesce((select 'security_invoker=on' = any(reloptions) or 'security_invoker=true' = any(reloptions)
                     from pg_class where oid = 'public.entity_search'::regclass), false) then
    raise exception '0905: entity_search lost security_invoker';
  end if;
  if (select string_agg(attname, ',' order by attnum) from pg_attribute
       where attrelid = 'public.entity_search'::regclass and attnum > 0 and not attisdropped)
     <> 'id,kind,workspace_id,board_id,card_id,title,body,meta,updated_at,seen,fold' then
    raise exception '0905: entity_search columns changed';
  end if;
end
$proof$;

commit;
