-- 0452 — a whole-workspace join says it joined the workspace.
--
-- The release migration of the first-run setup (boards lib/workspaceSetup.js),
-- applied at the promote that ships the sidebar's release.
--
-- Someone who comes in through a workspace invite link (0450) or a
-- workspace-level email invite joins the whole workspace, but the row that
-- tells the inviter about it (_joined_notification, 0189) has to anchor on a
-- board, so it anchors on the workspace's root cluster and both the toast and
-- the invite_accepted email read "joined "<root cluster>"". This marks those
-- rows:
--
--   1. share_notifications.scope: 'board' (every row so far, and every share)
--      or 'workspace'. The app (useShareNotifications → App's joined toast)
--      reads it and names the workspace with a Message button.
--   2. _joined_notification sets scope = 'workspace' when it was called
--      without a board, that is for a whole-workspace join. Its live body
--      (0189), unchanged otherwise.
--   3. _tg_share_notification_email passes scope and the workspace's name to
--      invite_accepted for those rows; the template (_shared/email/templates.ts
--      workspaceJoined) then names the workspace and opens it, not its root
--      cluster. Its live body (0189), unchanged otherwise. Until the email
--      function carrying workspaceJoined is deployed the extra keys are
--      ignored and the old mail goes out, so the order of the two is free.
--
-- The client selects `scope`, so this must be applied BEFORE the client that
-- selects it is served: a select naming a missing column fails, and the hook
-- then shows no share toasts at all.

begin;

-- ── 1. The column ───────────────────────────────────────────────────────────

alter table public.share_notifications
  add column if not exists scope text not null default 'board';

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.share_notifications'::regclass
                    and conname = 'share_notifications_scope_check') then
    alter table public.share_notifications
      add constraint share_notifications_scope_check check (scope in ('board', 'workspace'));
  end if;
end $$;

-- ── 2. The joined row says what was joined ──────────────────────────────────

-- 0189's body; only the scope column and its value are new (marked 0452).
create or replace function public._joined_notification(
  p_inviter uuid, p_board_id uuid, p_workspace_id uuid, p_role text, p_joiner uuid
) returns void
language plpgsql security definer
set search_path = public, auth as $$
declare
  v_board  uuid := p_board_id;
  v_name   text;
begin
  if p_inviter is null or p_joiner is null or p_inviter = p_joiner then return; end if;
  -- Workspace-level invites anchor on the workspace's root board (the
  -- notification row + email deep-link need a board). Skip if none.
  if v_board is null then
    select id into v_board from boards
    where workspace_id = p_workspace_id and parent_board_id is null and deleted_at is null
    order by created_at asc limit 1;
  end if;
  if v_board is null then return; end if;

  select coalesce(nullif(p.display_name, ''), u.email, 'Someone')
    into v_name
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  where u.id = p_joiner;

  -- 0452: no board was named, so they joined the whole workspace.
  insert into share_notifications (user_id, board_id, role, shared_by, kind, detail, scope)
  values (p_inviter, v_board,
          case when p_role = 'editor' then 'editor' else 'viewer' end,
          p_joiner, 'joined', v_name,
          case when p_board_id is null then 'workspace' else 'board' end);
exception when others then
  raise warning '_joined_notification failed: %', sqlerrm;
end;
$$;

-- ── 3. The email names the workspace ────────────────────────────────────────

-- 0189's body; only v_workspace_name and the two keys on a workspace join are
-- new (marked 0452).
create or replace function public._tg_share_notification_email()
returns trigger
language plpgsql security definer
set search_path = public, auth as $$
declare
  v_kind            text := coalesce(new.kind, 'share');
  v_recipient_email text;
  v_board_name      text;
  v_workspace_id    uuid;
  v_workspace_name  text;
  v_peer_name       text;
begin
  if new.shared_by is null or new.shared_by = new.user_id then
    return new;
  end if;

  if v_kind = 'joined' then
    if public._is_user_online(new.user_id) then return new; end if;
    if not public._email_pref_enabled(new.user_id, 'email_invite_accepted') then return new; end if;
  elsif v_kind = 'share' then
    if not public._email_pref_enabled(new.user_id, 'email_board_shared') then return new; end if;
  else
    return new;  -- explore_* & future kinds: in-app only
  end if;

  select email into v_recipient_email
  from auth.users where id = new.user_id;
  if v_recipient_email is null then return new; end if;

  select name, workspace_id into v_board_name, v_workspace_id
  from public.boards where id = new.board_id;

  -- 'share': the sharer; 'joined': the joiner.
  select coalesce(nullif(p.display_name, ''), u.email, 'Someone on Clusters')
  into v_peer_name
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  where u.id = new.shared_by;

  if v_kind = 'joined' then
    -- 0452: a whole-workspace join names the workspace (the template cleans it).
    if new.scope = 'workspace' then
      select w.name into v_workspace_name from public.workspaces w where w.id = v_workspace_id;
    end if;
    perform public._notify_email(
      'invite_accepted',
      v_recipient_email,
      jsonb_build_object(
        'boardName',   coalesce(v_board_name, 'a board'),
        'joinerName',  coalesce(nullif(new.detail, ''), v_peer_name, 'Someone'),
        'role',        coalesce(new.role, 'viewer'),
        'workspaceId', v_workspace_id::text,
        'boardId',     new.board_id::text
      ) || case when new.scope = 'workspace' and nullif(v_workspace_name, '') is not null
                then jsonb_build_object('scope', 'workspace', 'workspaceName', v_workspace_name)
                else '{}'::jsonb end
    );
  else
    perform public._notify_email(
      'board_shared',
      v_recipient_email,
      jsonb_build_object(
        'boardName',   coalesce(v_board_name,  'a board'),
        'sharerName',  coalesce(v_peer_name, 'Someone on Clusters'),
        'role',        coalesce(new.role, 'viewer'),
        'workspaceId', v_workspace_id::text,
        'boardId',     new.board_id::text
      )
    );
  end if;

  return new;
end;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────

-- Both are internal: the claim functions call the first as the definer, and
-- the second runs as a trigger, which needs no EXECUTE from whoever inserts.
revoke execute on function public._joined_notification(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public._tg_share_notification_email() from public, anon, authenticated;

-- ── Proofs (the 0311 habit: a REVOKE reporting success proves nothing) ──────

do $$
declare
  v_fn  text;
  v_src text;
  r     record;
begin
  foreach v_fn in array array[
    'public._joined_notification(uuid,uuid,uuid,text,uuid)',
    'public._tg_share_notification_email()'] loop
    if to_regprocedure(v_fn) is null then
      raise exception '0452: % is missing', v_fn;
    end if;
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0452: % is client-executable', v_fn;
    end if;
    if not (select p.prosecdef from pg_proc p where p.oid = v_fn::regprocedure) then
      raise exception '0452: % is no longer security definer', v_fn;
    end if;
  end loop;

  -- Each body keeps what it had and does what it is for.
  for r in
    select * from (values
      ('public._joined_notification(uuid,uuid,uuid,text,uuid)', 'p_inviter = p_joiner then return'),
      ('public._joined_notification(uuid,uuid,uuid,text,uuid)', 'case when p_board_id is null then ''workspace'' else ''board'' end'),
      ('public._joined_notification(uuid,uuid,uuid,text,uuid)', 'exception when others then'),
      ('public._tg_share_notification_email()',                 'public._is_user_online(new.user_id)'),
      ('public._tg_share_notification_email()',                 '''email_invite_accepted'''),
      ('public._tg_share_notification_email()',                 '''email_board_shared'''),
      ('public._tg_share_notification_email()',                 'jsonb_build_object(''scope'', ''workspace'', ''workspaceName'', v_workspace_name)')
    ) as t(fn, marker)
  loop
    select prosrc into v_src from pg_proc where oid = r.fn::regprocedure;
    if position(r.marker in v_src) = 0 then
      raise exception '0452: % lacks %', r.fn, r.marker;
    end if;
  end loop;

  -- The trigger still fires the email on every new row.
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.share_notifications'::regclass
                    and t.tgname = 'share_notification_email_trigger'
                    and t.tgfoid = 'public._tg_share_notification_email()'::regprocedure
                    and not t.tgisinternal) then
    raise exception '0452: share_notification_email_trigger no longer runs the email function';
  end if;

  -- The column exists, is never null, and takes only the two words.
  if not exists (select 1 from information_schema.columns c
                  where c.table_schema = 'public' and c.table_name = 'share_notifications'
                    and c.column_name = 'scope' and c.is_nullable = 'NO') then
    raise exception '0452: share_notifications.scope is missing or nullable';
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.share_notifications'::regclass
                    and conname = 'share_notifications_scope_check') then
    raise exception '0452: share_notifications.scope has no check';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
