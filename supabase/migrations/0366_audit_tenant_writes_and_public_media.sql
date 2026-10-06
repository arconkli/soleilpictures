-- 0366 — security audit, part 2: tenant boundaries on writes, viewers who
-- could write, and public images that can only be what they claim.
--
-- The 2026-10-06 audit found that several write policies checked the caller's
-- right to ONE id on the row and never checked the row's OTHER id against it:
--
--   1. card_index INSERT/UPDATE checked can_write_workspace(workspace_id) but
--      not that board_id lives in that workspace. Any account could file rows
--      against another tenant's board — and the card cap counts by the BOARD's
--      owner, so a free victim's cap filled with rows they could not delete
--      (their DELETE policy is the attacker's workspace). Now the board must
--      be in the row's workspace. (0 existing rows break that; checked.)
--
--   2. comments/vote_cards UPDATE re-checked only "author = me": an author
--      could move their own comment or vote onto any board in the product.
--      The new board must now be one the author may comment on / read (an
--      editor of the destination may still move it — the cross-board card move
--      in App.jsx does exactly that, so board_id is NOT frozen). author is
--      immutable, and so is reply_to: a reply could be re-pointed at any
--      comment id. New replies must answer a comment on the same board (0
--      existing replies break that).
--
--   3. messages UPDATE let a sender re-point conversation_id / workspace_id,
--      and the sender_email trigger only filled a NULL — a client could show
--      any address. The address is now always the sender's own, kind is one
--      of 'user'/'system', and the routing columns are immutable.
--
--   4. boards INSERT's share-editor branch accepted ANY workspace_id under a
--      writable parent: a board planted in a third party's workspace. That
--      branch now requires the parent's workspace. A share-editor creating a
--      sub-cluster in their OWN workspace still passes the first branch.
--
--   5. entity_links: the same share-editor branch, the same fix.
--
--   6. Viewers could write: board_versions (delete the history, or insert a
--      forged version "by" the owner that the owner later restores),
--      board_state INSERT, and the six tagging tables. Writes now need write
--      access; reads are unchanged. board_versions.made_by is always the
--      writer. (No viewer memberships exist today, so nothing current breaks.)
--
--   7. Public images. /api/public-img serves the R2 key that
--      get_public_board_content emits, and that key came straight from the
--      card's client-written meta.src — unchecked after a cluster's approval.
--      It could name an SVG/HTML payload (stored XSS on our origin, with the
--      Worker serving the uploader's content-type) or another tenant's private
--      object. A key is emitted now only when it is an image filed on, or
--      referenced by, that card's own board. boards.thumb_key can only name
--      the board's OWN thumbnail file (all 620 existing keys do). The Worker
--      half — never echo a stored content-type on these routes — ships with
--      this migration.
--
-- Function signatures are unchanged (create or replace keeps each ACL).

begin;

-- ── 1. card_index rows belong to their board's workspace ───────────────────

drop policy if exists "card_index insert" on public.card_index;
create policy "card_index insert" on public.card_index
  for insert to public
  with check (can_write_workspace(workspace_id) and _board_in_workspace(board_id, workspace_id));

drop policy if exists "card_index update" on public.card_index;
create policy "card_index update" on public.card_index
  for update to public
  using (can_write_workspace(workspace_id))
  with check (can_write_workspace(workspace_id) and _board_in_workspace(board_id, workspace_id));

-- ── 2. comments and vote cards ───────────────────────────────────────────────

-- RLS on comments may not subquery comments (latent 42P17), so the reply
-- check lives in a definer helper. The client role calls it from the policy.
create or replace function public.comment_reply_on_board(p_reply_to uuid, p_board_id uuid)
returns boolean
language sql stable security definer
set search_path = public as $$
  select p_reply_to is null
      or exists (select 1 from public.comments c
                  where c.id = p_reply_to and c.board_id = p_board_id);
$$;
revoke all on function public.comment_reply_on_board(uuid, uuid) from public, anon;
grant execute on function public.comment_reply_on_board(uuid, uuid) to authenticated;

drop policy if exists "comments insert" on public.comments;
create policy "comments insert" on public.comments
  for insert to public
  with check ((author = auth.uid())
              and can_comment_board(board_id)
              and comment_reply_on_board(reply_to, board_id));

drop policy if exists "comments update self or editor" on public.comments;
create policy "comments update self or editor" on public.comments
  for update to public
  using ((author = auth.uid()) or can_write_board(board_id))
  with check (((author = auth.uid()) and can_comment_board(board_id)) or can_write_board(board_id));

drop policy if exists "vote_cards update self or editor" on public.vote_cards;
create policy "vote_cards update self or editor" on public.vote_cards
  for update to public
  using ((author = auth.uid()) or can_write_board(board_id))
  with check (((author = auth.uid()) and can_read_board(board_id)) or can_write_board(board_id));

-- Invoker triggers: current_user is the client role on a PostgREST write and
-- the owner inside a SECURITY DEFINER function, which may still restore,
-- soft-delete or re-home rows.
create or replace function public._tg_comments_immutable()
returns trigger
language plpgsql
set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.author is distinct from old.author then
      raise exception 'a comment''s author cannot change' using errcode = '42501';
    end if;
    if new.reply_to is distinct from old.reply_to then
      raise exception 'a reply cannot move to another thread' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public._tg_comments_immutable() from public, anon, authenticated;
drop trigger if exists comments_immutable on public.comments;
create trigger comments_immutable
  before update on public.comments
  for each row execute function public._tg_comments_immutable();

create or replace function public._tg_vote_cards_immutable()
returns trigger
language plpgsql
set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and new.author is distinct from old.author then
    raise exception 'a vote card''s author cannot change' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public._tg_vote_cards_immutable() from public, anon, authenticated;
drop trigger if exists vote_cards_immutable on public.vote_cards;
create trigger vote_cards_immutable
  before update on public.vote_cards
  for each row execute function public._tg_vote_cards_immutable();

-- ── 3. messages ──────────────────────────────────────────────────────────────

create or replace function public.messages_set_sender_email()
returns trigger
language plpgsql security definer
set search_path = public, auth as $$
begin
  -- 0366: the address shown is always the sender's own (a client used to be
  -- able to send any), and the kind is one the app renders.
  new.sender_email := coalesce((select u.email from auth.users u where u.id = new.sender_id),
                               new.sender_email);
  if new.kind is null or new.kind not in ('user', 'system') then
    new.kind := 'user';
  end if;
  return new;
end;
$$;

create or replace function public._tg_messages_immutable()
returns trigger
language plpgsql
set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.conversation_id is distinct from old.conversation_id
          or new.workspace_id   is distinct from old.workspace_id
          or new.sender_id      is distinct from old.sender_id
          or new.sender_email   is distinct from old.sender_email
          or new.kind           is distinct from old.kind) then
    raise exception 'a message can be edited, not moved' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public._tg_messages_immutable() from public, anon, authenticated;
drop trigger if exists messages_immutable on public.messages;
create trigger messages_immutable
  before update on public.messages
  for each row execute function public._tg_messages_immutable();

-- ── 4. boards: the share-editor branch keeps the parent's workspace ─────────

drop policy if exists "boards insert by members or share editors" on public.boards;
create policy "boards insert by members or share editors" on public.boards
  for insert to public
  with check (can_write_workspace(workspace_id)
              or ((parent_board_id is not null)
                  and can_write_board(parent_board_id)
                  and _board_in_workspace(parent_board_id, workspace_id)));

-- ── 5. entity_links: same branch, same rule ─────────────────────────────────

drop policy if exists "entity_links write" on public.entity_links;
create policy "entity_links write" on public.entity_links
  for all to public
  using (can_write_workspace(source_workspace)
         or ((source_board_id is not null) and can_write_board(source_board_id)))
  with check (can_write_workspace(source_workspace)
              or ((source_board_id is not null)
                  and can_write_board(source_board_id)
                  and _board_in_workspace(source_board_id, source_workspace)));

-- ── 6. Viewers read; writers write ──────────────────────────────────────────

drop policy if exists "board_state insert by members" on public.board_state;

drop policy if exists "bv insert by members" on public.board_versions;
drop policy if exists "bv insert by writers" on public.board_versions;
create policy "bv insert by writers" on public.board_versions
  for insert to public
  with check (can_write_board(board_id));

drop policy if exists "bv delete by members" on public.board_versions;
drop policy if exists "bv delete by writers" on public.board_versions;
create policy "bv delete by writers" on public.board_versions
  for delete to public
  using (can_write_board(board_id));

alter table public.board_versions alter column made_by set default auth.uid();

create or replace function public._tg_board_versions_made_by()
returns trigger
language plpgsql
set search_path = public as $$
begin
  -- A version is "by" whoever saved it, never a name the client chose.
  if current_user in ('authenticated', 'anon') then
    new.made_by := auth.uid();
  end if;
  return new;
end;
$$;
revoke all on function public._tg_board_versions_made_by() from public, anon, authenticated;
drop trigger if exists board_versions_made_by on public.board_versions;
create trigger board_versions_made_by
  before insert on public.board_versions
  for each row execute function public._tg_board_versions_made_by();

do $$
declare
  t text;
begin
  foreach t in array array['card_embeddings', 'tag_centroids', 'tag_eval_labels',
                           'tag_suggestions', 'pending_clusters', 'workspace_discovery_locks'] loop
    execute format('drop policy if exists %I on public.%I', t || ' write', t);
    execute format('drop policy if exists %I on public.%I', t || ' insert', t);
    execute format('drop policy if exists %I on public.%I', t || ' update', t);
    execute format('drop policy if exists %I on public.%I', t || ' delete', t);
    execute format('create policy %I on public.%I for insert to public with check (can_write_workspace(workspace_id))', t || ' insert', t);
    execute format('create policy %I on public.%I for update to public using (can_write_workspace(workspace_id)) with check (can_write_workspace(workspace_id))', t || ' update', t);
    execute format('create policy %I on public.%I for delete to public using (can_write_workspace(workspace_id))', t || ' delete', t);
  end loop;
end $$;

-- ── 7. Public images are what they claim ────────────────────────────────────

-- A board's thumbnail key can only name that board's own thumbnail file. The
-- workspace segment is not pinned: a board may move workspaces and keep its
-- key, and an object can only exist under a prefix its uploader could write.
alter table public.boards drop constraint if exists boards_thumb_key_own_thumbnail;
alter table public.boards add constraint boards_thumb_key_own_thumbnail
  check (thumb_key is null
         or thumb_key ~ ('^r2:[0-9a-f-]{36}/thumbs/' || id::text || '(-c[0-9]+)?\.webp$'));

create or replace function public.get_public_board_content(p_slug text, p_limit integer default 60)
returns json
language plpgsql security definer
set search_path = public as $$
declare
  v_target uuid;
  v_cards  json;
  v_subs   json;
  v_total  int;
  v_lim    int;
begin
  v_target := _resolve_published_board(p_slug);
  if v_target is null then
    raise exception 'no such public board' using errcode = 'P0002';
  end if;
  v_lim := greatest(1, least(coalesce(p_limit, 60), 200));

  with recursive sub as (
    select id from boards where id = v_target and deleted_at is null
    union all
    select b.id from boards b join sub s on b.parent_board_id = s.id
    where b.deleted_at is null
  ),
  picked as (
    select ci.board_id, ci.card_id, ci.kind, ci.title, ci.body, ci.meta, ci.updated_at
    from card_index ci
    where ci.board_id in (select id from sub)
      and ci.kind in ('image','note','doc','link')
    order by ci.updated_at desc, ci.card_id
    limit v_lim
  )
  select coalesce(json_agg(json_build_object(
           'card_id', p.card_id,
           'kind',    p.kind,
           'title',   nullif(p.title, ''),
           'body',    nullif(p.body, ''),
           'href',    case when p.kind = 'link' then p.meta->>'url' else null end,
           -- 0366: a key is served only when it is an image filed on, or
           -- referenced by, this card's own board — never whatever meta.src says.
           'media',   case
             when p.kind = 'image' and (p.meta->>'src') like 'r2:%' and img.storage_path is not null
             then json_build_object(
                    'alt',         coalesce(nullif(ca.alt, ''), p.meta->>'alt'),
                    'src_key',     p.meta->>'src',
                    'preview_key', img.preview_path,
                    'blur',        img.blur_hash
                  )
             else null end
         ) order by p.updated_at desc, p.card_id), '[]'::json)
    into v_cards
  from picked p
  left join card_alts ca on ca.board_id = p.board_id and ca.card_id = p.card_id
  left join images img
    on img.storage_path = regexp_replace(p.meta->>'src', '^r2:', '')
   and img.deleted_at is null
   and (img.board_id = p.board_id or img.referenced_in_board_ids @> array[p.board_id]);

  select coalesce(json_agg(json_build_object('id', b.id, 'name', b.name)
           order by b.name), '[]'::json)
    into v_subs
  from boards b where b.parent_board_id = v_target and b.deleted_at is null;

  select count(*) into v_total
  from card_index ci
  where ci.board_id = v_target and ci.kind in ('image','note','doc','link');

  return json_build_object(
    'board_id',  v_target,
    'cards',     v_cards,
    'subboards', v_subs,
    'truncated', (v_total > v_lim)
  );
end;
$$;

-- ── Proofs ───────────────────────────────────────────────────────────────────

do $$
declare
  v_n   int;
  v_src text;
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'card_index'
                  and policyname = 'card_index insert' and with_check like '%_board_in_workspace%') then
    raise exception '0366: card_index insert does not tie board to workspace';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'comments'
                  and policyname = 'comments update self or editor' and with_check like '%can_comment_board%') then
    raise exception '0366: comments update does not check the destination board';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public'
              and policyname in ('bv insert by members', 'bv delete by members', 'board_state insert by members')) then
    raise exception '0366: a member-only write policy remains';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public'
              and tablename in ('card_embeddings', 'tag_centroids', 'tag_eval_labels',
                                'tag_suggestions', 'pending_clusters', 'workspace_discovery_locks')
              and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
              and coalesce(with_check, qual) like '%is_workspace_member%') then
    raise exception '0366: a tagging table still lets any member write';
  end if;
  if not has_function_privilege('authenticated', 'public.comment_reply_on_board(uuid,uuid)', 'execute')
     or has_function_privilege('anon', 'public.comment_reply_on_board(uuid,uuid)', 'execute') then
    raise exception '0366: comment_reply_on_board grants are wrong';
  end if;
  select count(*) into v_n from public.boards
   where thumb_key is not null
     and thumb_key !~ ('^r2:[0-9a-f-]{36}/thumbs/' || id::text || '(-c[0-9]+)?\.webp$');
  if v_n > 0 then
    raise exception '0366: % boards carry a thumbnail key that is not their own', v_n;
  end if;
  select prosrc into v_src from pg_proc
   where oid = 'public.get_public_board_content(text,integer)'::regprocedure;
  if position('img.storage_path is not null' in v_src) = 0
     or position('img.board_id = p.board_id' in v_src) = 0 then
    raise exception '0366: get_public_board_content still serves unchecked keys';
  end if;
  if not has_function_privilege('anon', 'public.get_public_board_content(text,integer)', 'execute') then
    raise exception '0366: get_public_board_content lost its anon grant';
  end if;
end $$;

commit;
