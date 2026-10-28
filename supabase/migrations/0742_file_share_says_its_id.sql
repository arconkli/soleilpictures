-- 0742 — A shared file's page says which share it is (sharing insight, Phase 1 #3).
--
-- file_share_view, the event the /f/ page logs when a file opens, carries no
-- link token (0474), so a view can't be told apart from another share of the
-- same file, or credited to the person who shared it. The page can send the
-- share's id instead, once get_file_share names it.
--
--   1. get_file_share: both of its 'ok' answers carry 'share_id'. 0607's body,
--      restated with that one key added to each (shareCaptureMigration.test.mjs
--      holds it to that); same signature, so its grants stay as they are.
--      The id is no key: no function takes it alone. The doc room check
--      (doc_room_access) reads it inside a room name and still wants the
--      link's token or the caller's own access, and a doc's answer already
--      names its room, which starts with this id. No board or card id reaches
--      anyone below manage, as before.
--   2. Proof: still callable signed in and out, still no storage keys, and
--      both answers name the share.

set local lock_timeout = '3s';

-- ── 1. The read ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_file_share(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid    uuid := auth.uid();
  v_r      jsonb;
  v_access text;
  v_email  text;
  v_file   jsonb;
  v_by     jsonb;
  v_count  integer;
  v_edit   boolean;
begin
  v_r := public._file_share_resolve(p_token);
  if v_r is null then
    return jsonb_build_object('status', 'gone');
  end if;
  v_access := v_r->>'access';
  if v_access = 'none' then
    if v_uid is null then
      return jsonb_build_object('status', 'sign_in');
    end if;
    return jsonb_build_object('status', 'no_access',
                              'email', (select u.email from auth.users u where u.id = v_uid));
  end if;

  if v_uid is not null then
    -- 0607: an invitation binds to this account only when this session came
    -- from the inbox and the account has proven that address.
    perform public._stamp_inbox_proof();
    select lower(u.email) into v_email
      from auth.users u where u.id = v_uid and u.email_confirmed_at is not null
       and public._session_proves_inbox()
       and public._user_proved_inbox(v_uid);
    if v_email is not null then
      update public.file_share_people p
         set user_id = v_uid
       where p.share_id = (v_r->>'share_id')::uuid
         and p.user_id is null and p.revoked_at is null and p.email = v_email;
    end if;
  end if;

  -- Never the sharer's email: a recipient may be anyone with the link.
  select jsonb_build_object('name', coalesce(nullif(btrim(pr.display_name), ''), 'Someone on Clusters'),
                            'avatar_url', pr.avatar_url)
    into v_by
    from public.profiles pr where pr.user_id = (v_r->>'created_by')::uuid;
  v_by := coalesce(v_by, jsonb_build_object('name', 'Someone on Clusters', 'avatar_url', null));

  v_file := v_r->'file';

  -- A doc: the room it opens in (the edit room for someone who may edit),
  -- and whether signing in would let you edit.
  if v_file->>'kind' = 'doc' then
    v_edit := v_access in ('edit', 'manage');
    return jsonb_build_object(
      'status', 'ok',
      'share_id', v_r->>'share_id',
      'access', v_access,
      'signed_in', v_uid is not null,
      'can_edit', v_edit,
      'edit_needs_sign_in', v_uid is null and v_r->>'link_access' <> 'none'
                            and coalesce((v_r->>'link_can_edit')::boolean, false),
      'allow_download', coalesce((v_r->>'allow_download')::boolean, false) or v_access = 'manage',
      'file', jsonb_build_object('kind', 'doc', 'name', v_file->'name'),
      'room', (v_r->>'share_id') || case when v_edit then '.edit.' else '.view.' end
              || public._doc_room_gen((v_r->>'board_id')::uuid, v_r->>'card_id'),
      'card_key', v_file->'card_key',
      'shared_by', v_by
    ) || case when v_access = 'manage'
              then jsonb_build_object('board_id', v_r->'board_id', 'card_id', v_r->'card_id')
              else '{}'::jsonb end;
  end if;

  if public._file_share_rank(v_access) >= 2 then
    select count(*) into v_count
      from public.file_comments c
     where c.share_id = (v_r->>'share_id')::uuid and c.deleted_at is null;
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'share_id', v_r->>'share_id',
    'access', v_access,
    'signed_in', v_uid is not null,
    'can_comment', v_uid is not null and public._file_share_rank(v_access) >= 2,
    'allow_download', coalesce((v_r->>'allow_download')::boolean, false) or v_access = 'manage',
    'file', jsonb_build_object(
      'kind', v_file->'kind', 'name', v_file->'name', 'mime', v_file->'mime',
      'size', v_file->'size', 'duration', v_file->'duration', 'page_count', v_file->'page_count',
      'ext', v_file->'ext', 'risky', v_file->'risky'),
    'shared_by', v_by,
    'comment_count', v_count
  ) || case when v_access = 'manage'
            then jsonb_build_object('board_id', v_r->'board_id', 'card_id', v_r->'card_id')
            else '{}'::jsonb end;
end;
$function$;

-- ── 2. Proof ─────────────────────────────────────────────────────────────────
do $proof$
declare
  v_def text := pg_get_functiondef('public.get_file_share(uuid)'::regprocedure);
begin
  if not has_function_privilege('anon', 'public.get_file_share(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.get_file_share(uuid)', 'execute') then
    raise exception '0742: get_file_share lost a grant the /f/ page needs';
  end if;
  if v_def like '%''keys''%' or v_def like '%v_file->''src''%' or v_def like '%v_file->''poster''%' then
    raise exception '0742: get_file_share answers storage keys';
  end if;
  if array_length(string_to_array(v_def, '''share_id'', v_r->>''share_id'','), 1) <> 3 then
    raise exception '0742: both of get_file_share''s answers must name the share';
  end if;
end $proof$;
