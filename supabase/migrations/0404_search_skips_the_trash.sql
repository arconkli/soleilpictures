-- 0404 — Search no longer finds what is in the Trash (audit SHELL-02), and a
-- tag's suggestions update live (audit TAGS-17).
--
-- SHELL-02. entity_search's board branch had no deleted_at filter, and the
-- card and group branches did not look at their cluster at all, while boards
-- RLS (my_readable_board_ids) still returns soft-deleted rows. So ⌘K offered
-- trashed clusters and the cards on them; opening one left the app on a raw
-- UUID breadcrumb over the root canvas. The @-mention trie, the hover popover
-- and the AI warm-up read the same view and offered the same dead links.
-- Card and group rows are dropped when their cluster is in the Trash: card
-- rows and boards share the my_readable_board_ids rule, so NOT EXISTS never
-- hides a card whose cluster the reader can see live.
--
-- `create or replace view` resets any reloption it does not restate — the
-- 0240 -> 0302 incident — so security_invoker is restated here and proved
-- below (securityInvokerContract.test.mjs checks the text as well).
--
-- TAGS-17. TagDetailView subscribes to tag_suggestions, but the table was
-- never in the supabase_realtime publication, so the Manage badge and the
-- pending list stayed at their mount-time values. RLS ("tag_suggestions read",
-- is_workspace_member) decides who receives each event.

begin;

create or replace view public.entity_search with (security_invoker = on) as
 SELECT b.id::text AS id,
    'board'::text AS kind,
    b.workspace_id,
    b.id AS board_id,
    NULL::text AS card_id,
    b.name AS title,
    b.meta AS body,
    NULL::jsonb AS meta,
    b.updated_at
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
    ci.updated_at
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
    gi.updated_at
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
    GREATEST(d.created_at, now()) AS updated_at
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
    t.created_at AS updated_at
   FROM tags t
  WHERE COALESCE(t.status, 'active'::text) <> 'deleted'::text;

alter publication supabase_realtime add table public.tag_suggestions;

do $$
begin
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = 'entity_search'
                    and c.reloptions @> array['security_invoker=on']) then
    raise exception '0404: entity_search lost security_invoker';
  end if;
  if has_table_privilege('anon', 'public.entity_search', 'select')
     or not has_table_privilege('authenticated', 'public.entity_search', 'select') then
    raise exception '0404: entity_search grants changed';
  end if;
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tag_suggestions') then
    raise exception '0404: tag_suggestions is not in supabase_realtime';
  end if;
end $$;

commit;
