-- 0702 — webhooks for comments and tags (API + MCP plan, P2).
--
-- The outbox (0222) learns two more families, written by the same kind of
-- statement-level trigger, so a comment made or a tag put on in the APP fires
-- a webhook exactly as one made through the API does:
--
--   comment.created  comment.updated  comment.resolved  comment.reopened
--   comment.deleted  comment.restored        — comments on the canvas
--   tag.applied      tag.removed             — a tag on a card, group, board
--                                              or doc page (a merge is both)
--
-- Payloads carry ids and counts, never a comment's words: a receiver that
-- wants them reads them through the API, as the person its token belongs to,
-- under that person's permissions. Threads inside docs and notes live in the
-- doc itself, not in this table, so they fire none of these.
--
-- Every emit keeps 0222's guard, an EXISTS against an active webhook for the
-- workspace: with none, which is nearly every workspace, a statement costs an
-- index probe and writes nothing. Nothing here raises. A webhook must never be
-- the reason a comment or a tag fails to save.
--
-- The functions are triggers and helpers, called by nobody: EXECUTE is
-- revoked from everyone but the owner (a trigger fires whatever its caller's
-- grants, as the tags guard on entity_links already does), and the block at
-- the end proves it.

-- The triggers lock comments and entity_links for a moment: wait at most 3s
-- for that rather than queue the app's writes behind a long transaction.
set local lock_timeout = '3s';

-- ── Comments ────────────────────────────────────────────────────────────────

-- One comment as a webhook carries it, in the names GET /boards/:id/comments
-- uses (lib/apiComments.js): a reply names its thread, and rows from before a
-- doc's comments moved into the doc read as the doc's.
create or replace function public._webhook_comment(c public.comments)
returns jsonb language sql immutable
set search_path = public as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', c.id,
    'thread_id', coalesce(c.reply_to, c.id),
    'reply', c.reply_to is not null,
    'on', case c.anchor_kind when 'doc_range' then 'doc' else c.anchor_kind end,
    'card_id', case when c.anchor_kind in ('card', 'doc_range') then c.anchor_id end,
    'group_id', case when c.anchor_kind = 'group' then c.anchor_id end,
    'page_id', case when c.anchor_kind = 'doc_range' then c.doc_page_id end,
    'author_id', c.author,
    'resolved', c.resolved));
$$;

create or replace function public.webhook_emit_comments_ins()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  insert into public.webhook_events (workspace_id, board_id, event, resource)
  select n.workspace_id, n.board_id, 'comment.created', public._webhook_comment(n)
    from newtab n
   where exists (select 1 from public.webhooks w
                  where w.workspace_id = n.workspace_id and w.active);
  return null;
end;
$$;

-- One event per comment that changed in a way a receiver cares about, the
-- weightiest first: a delete or a restore, then (for a comment still there) a
-- resolve, a reopen, or new words. Moving a pin or hiding one is neither.
create or replace function public.webhook_emit_comments_upd()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  insert into public.webhook_events (workspace_id, board_id, event, resource)
  select n.workspace_id, n.board_id, e.event, public._webhook_comment(n)
    from newtab n
    join oldtab o on o.id = n.id
   cross join lateral (select case
       when o.deleted_at is null and n.deleted_at is not null then 'comment.deleted'
       when o.deleted_at is not null and n.deleted_at is null then 'comment.restored'
       when n.deleted_at is not null then null
       when not o.resolved and n.resolved then 'comment.resolved'
       when o.resolved and not n.resolved then 'comment.reopened'
       when o.body is distinct from n.body then 'comment.updated'
     end as event) e
   where e.event is not null
     and exists (select 1 from public.webhooks w
                  where w.workspace_id = n.workspace_id and w.active);
  return null;
end;
$$;

create or replace trigger comments_webhook_ins after insert on public.comments
  referencing new table as newtab
  for each statement execute function public.webhook_emit_comments_ins();

create or replace trigger comments_webhook_upd after update on public.comments
  referencing new table as newtab old table as oldtab
  for each statement execute function public.webhook_emit_comments_upd();

-- ── Tags ────────────────────────────────────────────────────────────────────

-- One thing a tag is on, as GET /tags/:id names it (lib/apiTags.js): a card,
-- a group, a board, or a doc's page (its doc card's id and the page's).
create or replace function public._webhook_tag_item(l public.entity_links)
returns jsonb language sql immutable
set search_path = public as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'kind', case l.source_kind when 'doc' then 'doc_page' else l.source_kind end,
    'id', l.source_id,
    'page_id', l.source_page_id));
$$;

-- A statement that tags forty cards is one event per board and tag, carrying
-- the count and the first 25 things, as 0222's card events do. Automatic
-- tagging is told apart (auto), since a receiver may care only about people.
create or replace function public.webhook_emit_tags_ins()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  insert into public.webhook_events (workspace_id, board_id, event, resource)
  select n.source_workspace, n.source_board_id, 'tag.applied',
         jsonb_build_object(
           'id', n.target_id,
           'auto', n.source <> 'user',
           'count', count(*),
           'items', to_jsonb((array_agg(public._webhook_tag_item(n)
                               order by n.source_kind, n.source_id, n.source_page_id))[1:25]))
    from newtab n
   where n.link_kind = 'applied' and n.target_kind = 'tag' and n.target_id is not null
     and exists (select 1 from public.webhooks w
                  where w.workspace_id = n.source_workspace and w.active)
   group by n.source_workspace, n.source_board_id, n.target_id, n.source <> 'user';
  return null;
end;
$$;

create or replace function public.webhook_emit_tags_del()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  insert into public.webhook_events (workspace_id, board_id, event, resource)
  select o.source_workspace, o.source_board_id, 'tag.removed',
         jsonb_build_object(
           'id', o.target_id,
           'auto', o.source <> 'user',
           'count', count(*),
           'items', to_jsonb((array_agg(public._webhook_tag_item(o)
                               order by o.source_kind, o.source_id, o.source_page_id))[1:25]))
    from oldtab o
   where o.link_kind = 'applied' and o.target_kind = 'tag' and o.target_id is not null
     and exists (select 1 from public.webhooks w
                  where w.workspace_id = o.source_workspace and w.active)
   group by o.source_workspace, o.source_board_id, o.target_id, o.source <> 'user';
  return null;
end;
$$;

-- A merge (merge_tags_v2) moves a tag's links onto the tag it merges into, and
-- its undo moves them back: rows that change tag, not new rows, so each reads
-- as the old tag removed and the new one applied. A person confirming an
-- automatic tag (tagsApi confirmAppliedTag) changes no tag and is no event.
create or replace function public.webhook_emit_tags_upd()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  insert into public.webhook_events (workspace_id, board_id, event, resource)
  select m.workspace_id, m.board_id, m.event,
         jsonb_build_object(
           'id', m.tag_id,
           'auto', m.auto,
           'count', count(*),
           'items', to_jsonb((array_agg(m.item order by m.k, m.sid, m.pid))[1:25]))
    from (select o.source_workspace as workspace_id, o.source_board_id as board_id,
                 'tag.removed' as event, o.target_id as tag_id, o.source <> 'user' as auto,
                 public._webhook_tag_item(o) as item, o.source_kind as k, o.source_id as sid,
                 o.source_page_id as pid
            from oldtab o join newtab n on n.id = o.id
           where o.link_kind = 'applied' and o.target_kind = 'tag' and o.target_id is not null
             and (n.link_kind <> 'applied' or n.target_kind <> 'tag'
                  or n.target_id is distinct from o.target_id)
          union all
          select n.source_workspace, n.source_board_id, 'tag.applied', n.target_id, n.source <> 'user',
                 public._webhook_tag_item(n), n.source_kind, n.source_id, n.source_page_id
            from newtab n join oldtab o on o.id = n.id
           where n.link_kind = 'applied' and n.target_kind = 'tag' and n.target_id is not null
             and (o.link_kind <> 'applied' or o.target_kind <> 'tag'
                  or o.target_id is distinct from n.target_id)) m
   where exists (select 1 from public.webhooks w
                  where w.workspace_id = m.workspace_id and w.active)
   group by m.workspace_id, m.board_id, m.event, m.tag_id, m.auto;
  return null;
end;
$$;

create or replace trigger entity_links_webhook_ins after insert on public.entity_links
  referencing new table as newtab
  for each statement execute function public.webhook_emit_tags_ins();

create or replace trigger entity_links_webhook_upd after update on public.entity_links
  referencing old table as oldtab new table as newtab
  for each statement execute function public.webhook_emit_tags_upd();

create or replace trigger entity_links_webhook_del after delete on public.entity_links
  referencing old table as oldtab
  for each statement execute function public.webhook_emit_tags_del();

-- ── Grants ──────────────────────────────────────────────────────────────────

revoke execute on function public._webhook_comment(public.comments) from public, anon, authenticated;
revoke execute on function public._webhook_tag_item(public.entity_links) from public, anon, authenticated;
revoke execute on function public.webhook_emit_comments_ins() from public, anon, authenticated;
revoke execute on function public.webhook_emit_comments_upd() from public, anon, authenticated;
revoke execute on function public.webhook_emit_tags_ins() from public, anon, authenticated;
revoke execute on function public.webhook_emit_tags_upd() from public, anon, authenticated;
revoke execute on function public.webhook_emit_tags_del() from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public._webhook_comment(public.comments)',
    'public._webhook_tag_item(public.entity_links)',
    'public.webhook_emit_comments_ins()',
    'public.webhook_emit_comments_upd()',
    'public.webhook_emit_tags_ins()',
    'public.webhook_emit_tags_upd()',
    'public.webhook_emit_tags_del()'
  ] loop
    if has_function_privilege('anon', f, 'execute')
       or has_function_privilege('authenticated', f, 'execute') then
      raise exception '0702: % is still callable by a signed-in or anonymous caller', f;
    end if;
  end loop;
end;
$$;
