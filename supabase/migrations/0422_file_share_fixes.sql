-- 0422: file-share fixes from the 0421 review.
--
--   1. _file_share_card: the exact (cluster, card) row on a live cluster, or
--      nothing. The workspace-wide fallback and its heal are gone: a
--      duplicated cluster keeps card ids, so the fallback could move a
--      deleted card's link onto the copy. A share follows its card only
--      through repoint_card_refs (the client's re-id moves already call it,
--      and the server move routes call it too).
--   2. _file_share_find: the exact (cluster, card) share only; no adopting a
--      share left on another cluster.
--   3. _file_share_resolve: a takedown (suspended sharer, banned workspace
--      owner) is null, i.e. 'gone', to everyone but the signed-in team, never
--      'sign_in' / 'no_access'.
--   4. _file_share_access: a person added by a suspended account loses the
--      grant, as the link does when its setter is suspended.
--   5. add_file_share_people: emails are normalised (trim, one leading
--      mailto:, surrounding quotes and angle brackets, lower case) and the
--      check refuses quotes, brackets and separators.
--   6. _file_share_reaches(share, user): whether that user can still reach
--      the file. The comment trigger notifies the creator and the parent
--      author only while it holds.
--   7. app_config 'file_share_link_origin': the origin the two emails link
--      to, so a share made during the hold links to the preview, where /f/
--      exists. Release flips the row to production.
--
-- Each re-emit is the live (0421) definition with only those lines changed.
-- Nothing is removed by a statement here.

-- ── 1. _file_share_card: exact lookup only ──────────────────────────────────

-- The card a share points at: the (cluster, card) row on a live cluster, else
-- null. A share moves with its card only through repoint_card_refs.
create or replace function public._file_share_card(p_share public.file_shares)
returns public.card_index
language plpgsql security definer
set search_path = '' as $$
declare
  v_ci public.card_index;
begin
  if p_share.id is null then
    return null;
  end if;
  select ci.* into v_ci
    from public.card_index ci
    join public.boards b on b.id = ci.board_id and b.deleted_at is null
   where ci.board_id = p_share.board_id and ci.card_id = p_share.card_id;
  if found then
    return v_ci;
  end if;
  return null;
end;
$$;

-- ── 2. _file_share_find: exact lookup only ──────────────────────────────────

-- The owner's share for a card, found from the dialog's side: the exact
-- (cluster, card) row, or null.
create or replace function public._file_share_find(p_board uuid, p_card text)
returns public.file_shares
language plpgsql security definer
set search_path = '' as $$
declare
  v_share public.file_shares;
begin
  select s.* into v_share from public.file_shares s where s.board_id = p_board and s.card_id = p_card;
  if found then
    return v_share;
  end if;
  return null;
end;
$$;

-- ── 4. _file_share_access: a suspended inviter's people lose the grant ──────

-- The caller's access to a share: 'manage' | 'comment' | 'view' | 'none'.
--   manage  = can edit the cluster; comment = can read it (the team);
--   a person added by email gets their role; the link gives its level to anyone.
-- A suspended sharer or a banned workspace owner takes every outside grant down
-- (the team keeps comment), and a suspended inviter takes down the people they
-- added. A risky file's link works only once the account that opened the link
-- is 72 hours old.
create or replace function public._file_share_access(p_share public.file_shares, p_risky boolean)
returns text
language plpgsql stable security definer
set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_team  boolean := false;
  v_best  integer;
  v_rank  integer;
  v_email text;
begin
  if p_share.id is null then
    return 'none';
  end if;
  if v_uid is not null and coalesce(public.can_write_board(p_share.board_id), false) then
    return 'manage';
  end if;
  v_team := v_uid is not null and coalesce(public.can_read_board(p_share.board_id), false);

  if public._sharer_suspended(p_share.created_by)
     or exists (select 1 from public.workspaces w
                 where w.id = p_share.workspace_id and public._user_banned(w.created_by)) then
    return case when v_team then 'comment' else 'none' end;
  end if;

  v_best := case when v_team then 2 else 0 end;

  if v_uid is not null then
    select lower(u.email) into v_email
      from auth.users u where u.id = v_uid and u.email_confirmed_at is not null;
    select max(public._file_share_rank(p.role)) into v_rank
      from public.file_share_people p
     where p.share_id = p_share.id and p.revoked_at is null
       and not public._sharer_suspended(p.invited_by)
       and (p.user_id = v_uid or (p.user_id is null and v_email is not null and p.email = v_email));
    v_best := greatest(v_best, coalesce(v_rank, 0));
  end if;

  if p_share.link_access <> 'none'
     and not public._sharer_suspended(p_share.link_set_by)
     and not (coalesce(p_risky, false)
              and exists (select 1 from auth.users u
                           where u.id = p_share.link_set_by and u.created_at > now() - interval '72 hours')) then
    v_best := greatest(v_best, public._file_share_rank(p_share.link_access));
  end if;

  return case when v_best >= 2 then 'comment' when v_best = 1 then 'view' else 'none' end;
end;
$$;

-- ── 3. _file_share_resolve: a takedown reads 'gone' to outsiders ────────────

-- Token → {share_id, access, file, ...} or null. Every failure is null, which
-- the callers turn into {status:'gone'}: a takedown, a trashed cluster and an
-- unknown token look the same. Only the signed-in team still sees a taken-down
-- file (as comment, from _file_share_access).
create or replace function public._file_share_resolve(p_token uuid)
returns jsonb
language plpgsql security definer
set search_path = '' as $$
declare
  v_share  public.file_shares;
  v_ci     public.card_index;
  v_file   jsonb;
  v_access text;
begin
  if p_token is null then
    return null;
  end if;
  select s.* into v_share from public.file_shares s where s.token = p_token;
  if not found then
    return null;
  end if;
  v_ci := public._file_share_card(v_share);
  if v_ci.card_id is null then
    return null;
  end if;
  if not exists (select 1 from public.boards b where b.id = v_share.board_id and b.deleted_at is null) then
    return null;
  end if;
  if (public._sharer_suspended(v_share.created_by)
      or exists (select 1 from public.workspaces w
                  where w.id = v_share.workspace_id and public._user_banned(w.created_by)))
     and not (auth.uid() is not null and coalesce(public.can_read_board(v_share.board_id), false)) then
    return null;
  end if;
  v_file := public._file_share_file(v_share.workspace_id, v_ci);
  if v_file is null then
    return null;
  end if;
  v_access := public._file_share_access(v_share, coalesce((v_file->>'risky')::boolean, false));
  return jsonb_build_object(
    'share_id', v_share.id,
    'token', v_share.token,
    'access', v_access,
    'file', v_file,
    'board_id', v_share.board_id,
    'card_id', v_share.card_id,
    'workspace_id', v_share.workspace_id,
    'created_by', v_share.created_by,
    'allow_download', v_share.allow_download
  );
end;
$$;

-- ── 5. add_file_share_people: normalised emails, tighter check ──────────────

-- Add people by email. A new (or re-added) person spends invite budget and is
-- emailed by _tg_file_share_person_email; a live person only changes role.
-- Each email is trimmed, loses one leading mailto: and any surrounding quotes
-- or angle brackets, and is lower-cased; the check refuses quotes, brackets
-- and separators anywhere in it.
create or replace function public.add_file_share_people(p_board uuid, p_card text, p_emails text[], p_role text)
returns jsonb
language plpgsql security definer
set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  v_share   public.file_shares;
  v_self    text;
  v_e       text;
  v_norm    text;
  v_strip   text := ' ' || chr(9) || chr(10) || chr(13) || '"''<>';
  v_row     public.file_share_people;
  v_target  uuid;
  v_added   text[] := '{}';
  v_skipped text[] := '{}';
begin
  if v_uid is null or not coalesce(public.can_write_board(p_board), false) then
    raise exception 'you cannot share files in this cluster' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('view', 'comment') then
    raise exception 'role must be view or comment' using errcode = '22023';
  end if;
  if p_emails is null or cardinality(p_emails) < 1 then
    raise exception 'add at least one email' using errcode = '22023';
  end if;
  if cardinality(p_emails) > 20 then
    raise exception 'at most 20 people at a time' using errcode = '22023';
  end if;

  -- set_file_share validates the card; only called when there is no share
  -- yet, so adding people never rewrites who opened the link.
  v_share := public._file_share_find(p_board, p_card);
  if v_share.id is null then
    perform public.set_file_share(p_board, p_card, 'none', null);
    v_share := public._file_share_find(p_board, p_card);
  end if;
  if v_share.id is null then
    raise exception 'file not found' using errcode = 'P0002';
  end if;

  -- Tells the email trigger an un-revoke here is a real (re-)invitation, not
  -- the undo of a removal.
  perform set_config('app.file_share_invite', 'on', true);
  select lower(u.email) into v_self from auth.users u where u.id = v_uid;

  foreach v_e in array p_emails loop
    v_norm := btrim(coalesce(v_e, ''), v_strip);
    v_norm := regexp_replace(v_norm, '^mailto:', '', 'i');
    v_norm := lower(btrim(v_norm, v_strip));
    if v_norm !~ '^[^@\s"''<>(),;:\[\]]+@[^@\s"''<>(),;:\[\]]+\.[^@\s"''<>(),;:\[\]]+$'
       or char_length(v_norm) > 320 or v_norm = v_self then
      v_skipped := v_skipped || coalesce(v_e, '');
      continue;
    end if;
    if v_norm = any (v_added) then
      continue;
    end if;
    select p.* into v_row
      from public.file_share_people p
     where p.share_id = v_share.id and p.email = v_norm
       for update;
    if found and v_row.revoked_at is null then
      update public.file_share_people p set role = p_role
       where p.share_id = v_share.id and p.email = v_norm;
      v_added := v_added || v_norm;
      continue;
    end if;
    perform public._invite_budget_take();
    select u.id into v_target
      from auth.users u
     where lower(u.email) = v_norm and u.email_confirmed_at is not null
     limit 1;
    insert into public.file_share_people as p (share_id, email, user_id, role, invited_by)
    values (v_share.id, v_norm, v_target, p_role, v_uid)
    on conflict (share_id, email) do update
       set revoked_at = null,
           user_id = coalesce(excluded.user_id, p.user_id),
           role = excluded.role,
           invited_by = excluded.invited_by;
    v_added := v_added || v_norm;
  end loop;

  return public.get_file_share_settings(p_board, p_card)
         || jsonb_build_object('added', to_jsonb(v_added), 'skipped', to_jsonb(v_skipped));
end;
$$;

-- ── 6. _file_share_reaches: may this user still hear about the file? ────────

-- True when p_user can still reach the shared file: the workspace's owner or a
-- member, a cluster share on the file's cluster or an ancestor (live clusters
-- only), a live person row (their id, or their confirmed email on an unbound
-- row; not one added by a suspended account), or, while the link allows
-- comments, a live comment of theirs on it. Never a banned user. Run as the
-- definer for a user who is not the caller: notifications only.
create or replace function public._file_share_reaches(p_share public.file_shares, p_user uuid)
returns boolean
language plpgsql stable security definer
set search_path = '' as $$
declare
  v_email text;
begin
  if p_user is null or p_share.id is null or public._user_banned(p_user) then
    return false;
  end if;
  if exists (select 1 from public.workspaces w
              where w.id = p_share.workspace_id and w.created_by = p_user)
     or exists (select 1 from public.workspace_members m
                 where m.workspace_id = p_share.workspace_id and m.user_id = p_user) then
    return true;
  end if;
  if exists (
       with recursive chain as (
         select b.id, b.parent_board_id, b.deleted_at
           from public.boards b where b.id = p_share.board_id
         union all
         select b.id, b.parent_board_id, b.deleted_at
           from public.boards b join chain c on b.id = c.parent_board_id
       )
       select 1 from chain
        join public.board_shares s on s.board_id = chain.id and s.user_id = p_user
       where chain.deleted_at is null) then
    return true;
  end if;
  select lower(u.email) into v_email
    from auth.users u where u.id = p_user and u.email_confirmed_at is not null;
  if exists (select 1 from public.file_share_people p
              where p.share_id = p_share.id and p.revoked_at is null
                and not public._sharer_suspended(p.invited_by)
                and (p.user_id = p_user
                     or (p.user_id is null and v_email is not null and p.email = v_email))) then
    return true;
  end if;
  if p_share.link_access = 'comment'
     and exists (select 1 from public.file_comments c
                  where c.share_id = p_share.id and c.author = p_user and c.deleted_at is null) then
    return true;
  end if;
  return false;
end;
$$;

-- ── 7. The origin the share emails link to ──────────────────────────────────

insert into public.app_config (key, value)
values ('file_share_link_origin', to_jsonb('https://main-soleil-boards.arconkli.workers.dev'::text))
on conflict (key) do nothing;

-- A person added to a file: a bell row when they have an account, and the
-- file_shared email (stranger class: the sharer is named by email, 0358).
-- An un-revoke emails only from add_file_share_people (app.file_share_invite);
-- the undo in set_file_share_person sends nothing. The link's origin comes
-- from app_config 'file_share_link_origin'.
create or replace function public._tg_file_share_person_email()
returns trigger
language plpgsql security definer
set search_path = '' as $$
declare
  v_share     public.file_shares;
  v_ci        public.card_index;
  v_file      jsonb;
  v_name      text;
  v_sharer_id uuid;
  v_sharer    text;
begin
  if new.revoked_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and not (old.revoked_at is not null
              and coalesce(current_setting('app.file_share_invite', true), '') = 'on') then
    return new;
  end if;
  select s.* into v_share from public.file_shares s where s.id = new.share_id;
  if not found then
    return new;
  end if;
  select ci.* into v_ci from public.card_index ci
   where ci.board_id = v_share.board_id and ci.card_id = v_share.card_id;
  if found then
    v_file := public._file_share_file(v_share.workspace_id, v_ci);
  end if;
  v_name := coalesce(v_file->>'name', 'a file');
  v_sharer_id := coalesce(new.invited_by, v_share.created_by);
  select u.email into v_sharer from auth.users u where u.id = v_sharer_id;
  v_sharer := coalesce(v_sharer, 'Someone on Clusters');

  if new.user_id is not null and new.user_id is distinct from v_sharer_id then
    insert into public.notifications (user_id, kind, actor_id, title, data)
    values (new.user_id, 'file.shared', v_sharer_id,
            left(v_sharer || ' shared “' || v_name || '” with you', 200),
            jsonb_build_object('token', v_share.token, 'file_name', v_name, 'role', new.role));
  end if;

  perform public._notify_email('file_shared', new.email, jsonb_build_object(
    'sharerName', v_sharer, 'fileName', v_name, 'role', new.role, 'token', v_share.token::text,
    'origin', coalesce((select value #>> '{}' from public.app_config where key = 'file_share_link_origin'),
                       'https://clusters.soleilpictures.com')));
  return new;
end;
$$;

-- A comment: the share's creator gets a bell row and (at most every 30 minutes
-- per share, when offline and opted in) the file_commented email; a reply
-- gives the parent's author a bell row. Each only while that person can still
-- reach the file (_file_share_reaches).
create or replace function public._tg_file_comment_notify()
returns trigger
language plpgsql security definer
set search_path = '' as $$
declare
  v_share         public.file_shares;
  v_ci            public.card_index;
  v_file          jsonb;
  v_fname         text;
  v_author_name   text;
  v_preview       text;
  v_send          boolean;
  v_creator_email text;
  v_parent_author uuid;
begin
  select s.* into v_share from public.file_shares s where s.id = new.share_id;
  if not found then
    return new;
  end if;
  select ci.* into v_ci from public.card_index ci
   where ci.board_id = v_share.board_id and ci.card_id = v_share.card_id;
  if found then
    v_file := public._file_share_file(v_share.workspace_id, v_ci);
  end if;
  v_fname := coalesce(v_file->>'name', 'a file');
  select coalesce(nullif(btrim(p.display_name), ''), 'Someone') into v_author_name
    from public.profiles p where p.user_id = new.author;
  v_author_name := coalesce(v_author_name, 'Someone');
  v_preview := left(new.body, 140) || case when char_length(new.body) > 140 then '…' else '' end;

  if v_share.created_by is distinct from new.author
     and public._file_share_reaches(v_share, v_share.created_by) then
    v_send := not exists (
                select 1 from public.notifications n
                 where n.user_id = v_share.created_by and n.kind = 'file.commented'
                   and n.data->>'share_id' = v_share.id::text
                   and n.emailed_at > now() - interval '30 minutes')
              and public._email_pref_enabled(v_share.created_by, 'email_comment_replies')
              and not public._is_user_online(v_share.created_by);
    insert into public.notifications (user_id, kind, actor_id, title, body, data, emailed_at)
    values (v_share.created_by, 'file.commented', new.author,
            left(v_author_name || ' commented on “' || v_fname || '”', 200),
            v_preview,
            jsonb_build_object('token', v_share.token, 'share_id', v_share.id,
                               'comment_id', new.id, 'file_name', v_fname),
            case when v_send then now() end);
    if v_send then
      select u.email into v_creator_email from auth.users u where u.id = v_share.created_by;
      perform public._notify_email('file_commented', v_creator_email, jsonb_build_object(
        'commenterName', v_author_name, 'fileName', v_fname, 'commentPreview', v_preview,
        'token', v_share.token::text,
        'origin', coalesce((select value #>> '{}' from public.app_config where key = 'file_share_link_origin'),
                           'https://clusters.soleilpictures.com'),
        'unsubscribeToken', (select t.token from public.email_unsub_tokens t where t.user_id = v_share.created_by)));
    end if;
  end if;

  if new.reply_to is not null then
    select c.author into v_parent_author from public.file_comments c where c.id = new.reply_to;
    if v_parent_author is not null and v_parent_author <> new.author
       and v_parent_author is distinct from v_share.created_by
       and public._file_share_reaches(v_share, v_parent_author) then
      insert into public.notifications (user_id, kind, actor_id, title, body, data)
      values (v_parent_author, 'file.replied', new.author,
              left(v_author_name || ' replied on “' || v_fname || '”', 200),
              v_preview,
              jsonb_build_object('token', v_share.token, 'share_id', v_share.id,
                                 'comment_id', new.id, 'file_name', v_fname));
    end if;
  end if;
  return new;
end;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────

-- create or replace keeps each function's ACL; these restate it.
revoke all on function public.add_file_share_people(uuid, text, text[], text) from public;
revoke all on function public.add_file_share_people(uuid, text, text[], text) from anon;
grant execute on function public.add_file_share_people(uuid, text, text[], text) to authenticated, service_role;

revoke execute on function public._file_share_card(public.file_shares) from public, anon, authenticated;
revoke execute on function public._file_share_find(uuid, text) from public, anon, authenticated;
revoke execute on function public._file_share_access(public.file_shares, boolean) from public, anon, authenticated;
revoke execute on function public._file_share_resolve(uuid) from public, anon, authenticated;
revoke execute on function public._file_share_reaches(public.file_shares, uuid) from public, anon, authenticated;
revoke execute on function public._tg_file_share_person_email() from public, anon, authenticated;
revoke execute on function public._tg_file_comment_notify() from public, anon, authenticated;

-- ── Proof (0311 habit: a REVOKE reporting success proves nothing) ───────────

do $$
declare
  v_sig text;
  v_src text;
begin
  if has_function_privilege('anon', 'public.add_file_share_people(uuid, text, text[], text)', 'execute') then
    raise exception '0422: add_file_share_people is callable signed out';
  end if;
  if not has_function_privilege('authenticated', 'public.add_file_share_people(uuid, text, text[], text)', 'execute') then
    raise exception '0422: add_file_share_people is not callable by a signed-in user';
  end if;
  foreach v_sig in array array['public.get_file_share(uuid)', 'public.get_file_comments(uuid)'] loop
    if not has_function_privilege('anon', v_sig, 'execute')
       or not has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception '0422: % lost its grants', v_sig;
    end if;
  end loop;

  foreach v_sig in array array[
    'public._file_share_card(public.file_shares)',
    'public._file_share_find(uuid, text)',
    'public._file_share_access(public.file_shares, boolean)',
    'public._file_share_resolve(uuid)',
    'public._file_share_reaches(public.file_shares, uuid)',
    'public._tg_file_share_person_email()',
    'public._tg_file_comment_notify()'
  ] loop
    if has_function_privilege('public', v_sig, 'execute')
       or has_function_privilege('anon', v_sig, 'execute')
       or has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception '0422: % is client-callable', v_sig;
    end if;
    if not (select p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=""%'
              from pg_proc p where p.oid = v_sig::regprocedure) then
      raise exception '0422: % is not security definer with an empty search_path', v_sig;
    end if;
  end loop;

  select p.prosrc into v_src from pg_proc p where p.oid = 'public._file_share_card(public.file_shares)'::regprocedure;
  if position('workspace_id' in v_src) > 0 or position('update' in v_src) > 0 then
    raise exception '0422: _file_share_card still follows the card across the workspace';
  end if;
  select p.prosrc into v_src from pg_proc p where p.oid = 'public._file_share_find(uuid, text)'::regprocedure;
  if position('update' in v_src) > 0 then
    raise exception '0422: _file_share_find still adopts shares';
  end if;
  select p.prosrc into v_src from pg_proc p where p.oid = 'public._file_share_resolve(uuid)'::regprocedure;
  if position('_sharer_suspended' in v_src) = 0 then
    raise exception '0422: _file_share_resolve lost the takedown check';
  end if;
  select p.prosrc into v_src from pg_proc p where p.oid = 'public._file_share_access(public.file_shares, boolean)'::regprocedure;
  if position('_sharer_suspended(p.invited_by)' in v_src) = 0 then
    raise exception '0422: _file_share_access ignores a suspended inviter';
  end if;
  select p.prosrc into v_src from pg_proc p where p.oid = 'public._tg_file_comment_notify()'::regprocedure;
  if position('_file_share_reaches(v_share, v_share.created_by)' in v_src) = 0
     or position('_file_share_reaches(v_share, v_parent_author)' in v_src) = 0
     or position('file_share_link_origin' in v_src) = 0 then
    raise exception '0422: _tg_file_comment_notify is missing the reach check or the origin';
  end if;
  select p.prosrc into v_src from pg_proc p where p.oid = 'public._tg_file_share_person_email()'::regprocedure;
  if position('file_share_link_origin' in v_src) = 0 then
    raise exception '0422: _tg_file_share_person_email is missing the origin';
  end if;
  if not exists (select 1 from public.app_config where key = 'file_share_link_origin') then
    raise exception '0422: app_config has no file_share_link_origin';
  end if;
end $$;
