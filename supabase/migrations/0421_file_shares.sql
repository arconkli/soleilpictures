-- 0421: files can be shared on their own.
--
-- One file (an image, video, audio, pdf or any file card) gets a link of its
-- own at /f/<token>, Drive-style: "anyone with the link" and/or "only people
-- added", each with a role of view or comment. The recipient sees only that
-- file. Signed-in recipients with comment access can comment; video and audio
-- comments pin to a time, pdf comments to a page.
--
-- Shape:
--   * three server-only tables (RLS on, no policies, no client grants);
--   * _file_* helpers that find the card, describe its file and decide access
--     as the caller; every one of them revoked from public, anon, authenticated;
--   * RPCs: get_file_share / get_file_comments (signed out too), the owner's
--     settings, people and link RPCs, and the comment RPCs;
--   * two notification triggers (bell + email through _notify_email);
--   * re-emits of _outbound_gate (classify the two new templates),
--     check_security_invariants (allow the two new email triggers) and
--     repoint_card_refs (a re-id carries file shares as it carries stars).
--     Each re-emit is the live definition with only those lines changed.
--
-- Limits mirrored in boards/src/lib/fileShares.js (fileShareMigration.test.mjs
-- fails when they disagree): a comment is 1..2000 characters; 20 comments per
-- author per 10 minutes and 300 per day; 20 emails per add-people call.
--
-- Nothing is removed by a statement here: deletes are soft (revoked_at,
-- deleted_at), and functions and triggers are created or replaced.

-- ── A. Tables ───────────────────────────────────────────────────────────────

create table if not exists public.file_shares (
  id             uuid primary key default gen_random_uuid(),
  token          uuid not null unique default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  board_id       uuid not null references public.boards(id) on delete cascade,
  card_id        text not null check (char_length(card_id) between 1 and 200),
  link_access    text not null default 'none' check (link_access in ('none', 'view', 'comment')),
  link_set_by    uuid references auth.users(id) on delete set null,
  allow_download boolean not null default true,
  created_by     uuid not null references auth.users(id) on delete cascade,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (board_id, card_id)
);
create index if not exists file_shares_ws_card_idx on public.file_shares (workspace_id, card_id);

create table if not exists public.file_share_people (
  share_id   uuid not null references public.file_shares(id) on delete cascade,
  email      text not null check (email = lower(btrim(email))
                                  and char_length(email) between 3 and 320
                                  and position('@' in email) > 1),
  user_id    uuid references auth.users(id) on delete cascade,
  role       text not null check (role in ('view', 'comment')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (share_id, email)
);
create index if not exists file_share_people_user_idx on public.file_share_people (user_id) where user_id is not null;
create index if not exists file_share_people_email_idx on public.file_share_people (email);

create table if not exists public.file_comments (
  id          uuid primary key default gen_random_uuid(),
  share_id    uuid not null references public.file_shares(id) on delete cascade,
  author      uuid not null references auth.users(id) on delete cascade,
  body        text not null check (char_length(btrim(body)) between 1 and 2000),
  at_ms       integer check (at_ms >= 0),
  page        integer check (page >= 1),
  version_key text,
  reply_to    uuid references public.file_comments(id) on delete cascade,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  deleted_at  timestamptz,
  deleted_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  edited_at   timestamptz
);
create index if not exists file_comments_share_created_idx on public.file_comments (share_id, created_at);
create index if not exists file_comments_author_created_idx on public.file_comments (author, created_at);
create index if not exists file_comments_reply_to_idx on public.file_comments (reply_to) where reply_to is not null;

-- Only the RPCs below touch these.
alter table public.file_shares enable row level security;
alter table public.file_share_people enable row level security;
alter table public.file_comments enable row level security;
revoke all on table public.file_shares from public, anon, authenticated;
revoke all on table public.file_share_people from public, anon, authenticated;
revoke all on table public.file_comments from public, anon, authenticated;

-- ── B. Helpers ──────────────────────────────────────────────────────────────

create or replace function public._file_share_rank(p text)
returns integer
language sql immutable security definer
set search_path = '' as $$
  select case p when 'manage' then 3 when 'comment' then 2 when 'view' then 1 else 0 end;
$$;

-- A file a browser or an OS would run rather than show. A link to one is
-- refused for an account under 72 hours old (set_file_share) and stops working
-- if the account that opened the link is that new (_file_share_access).
-- The two lists are RISKY_EXTENSIONS and RISKY_MIMES in fileShares.js.
create or replace function public._file_risky(p_name text, p_mime text)
returns boolean
language sql immutable security definer
set search_path = '' as $$
  select coalesce(lower(substring(coalesce(p_name, '') from '\.([A-Za-z0-9]{1,8})$'))
                    = any (array['exe','msi','msp','mst','com','scr','pif','cpl','bat','cmd','ps1','psm1','vbs','vbe','js','jse','wsf','wsh','hta','jar','app','dmg','pkg','command','sh','apk','ipa','appx','msix','dll','lnk','reg','iso','html','htm','xhtml','shtml','svg','xml','docm','xlsm','pptm','xll']),
                  false)
      or coalesce(btrim(split_part(lower(coalesce(p_mime, '')), ';', 1))
                    = any (array['text/html','application/xhtml+xml','image/svg+xml','application/x-msdownload','application/x-msdos-program','application/java-archive','application/vnd.android.package-archive','application/x-sh','application/javascript','text/javascript']),
                  false);
$$;

-- The card a share points at. A card moved to another cluster keeps its id, so
-- when the share's cluster no longer holds it, look for it elsewhere in the
-- workspace and move the share with it. Volatile: it heals.
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
  -- Still on its own cluster, and that cluster is in the trash: gone. Only a
  -- card that LEFT the cluster is followed, never a duplicate of one trashed.
  if exists (select 1 from public.card_index ci
              where ci.board_id = p_share.board_id and ci.card_id = p_share.card_id) then
    return null;
  end if;
  select ci.* into v_ci
    from public.card_index ci
    join public.boards b on b.id = ci.board_id and b.deleted_at is null
   where ci.workspace_id = p_share.workspace_id and ci.card_id = p_share.card_id
   order by ci.updated_at desc
   limit 1;
  if not found then
    return null;
  end if;
  update public.file_shares
     set board_id = v_ci.board_id, updated_at = now()
   where id = p_share.id
     and not exists (select 1 from public.file_shares t
                      where t.board_id = v_ci.board_id and t.card_id = p_share.card_id);
  -- Another share already owns the card where it went: that one is the live
  -- link, and this one points at nothing.
  if not found then
    return null;
  end if;
  return v_ci;
end;
$$;

-- The owner's share for a card, found from the dialog's side: the exact
-- (cluster, card) row, or one left behind on a cluster that no longer holds the
-- card, which is moved here. Called only after the card is known to be here.
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
  if not exists (select 1 from public.card_index c where c.board_id = p_board and c.card_id = p_card) then
    return null;
  end if;
  update public.file_shares f
     set board_id = p_board, updated_at = now()
   where f.id = (select s.id
                   from public.file_shares s
                   join public.boards b on b.id = p_board
                  where s.workspace_id = b.workspace_id and s.card_id = p_card
                    and not exists (select 1 from public.card_index c
                                     where c.board_id = s.board_id and c.card_id = s.card_id)
                  order by s.updated_at desc
                  limit 1)
  returning f.* into v_share;
  return v_share;
end;
$$;

-- What the file is, from the card's (client-written) meta and the images row
-- that proves the bytes are this workspace's and still live. Null when the
-- card is not a shareable file.
create or replace function public._file_share_file(p_ws uuid, p_ci public.card_index)
returns jsonb
language plpgsql stable security definer
set search_path = '' as $$
declare
  v_kind   text := p_ci.kind;
  v_meta   jsonb := case when jsonb_typeof(p_ci.meta) = 'object' then p_ci.meta else '{}'::jsonb end;
  v_ref    text;
  v_key    text;
  v_img    public.images;
  v_p      text;
  v_poster text;
  v_name   text;
  v_mime   text;
  v_ext    text;
begin
  if p_ws is null or p_ci.card_id is null or v_kind is null
     or v_kind <> all (array['image', 'video', 'audio', 'pdf', 'file']) then
    return null;
  end if;
  v_ref := v_meta->>(case v_kind when 'pdf' then 'pdfSrc' when 'file' then 'fileSrc' else 'src' end);
  if v_ref is null or left(v_ref, 3) <> 'r2:' or char_length(v_ref) < 4 then
    return null;
  end if;
  v_key := substr(v_ref, 4);
  select i.* into v_img
    from public.images i
   where i.storage_path = v_key and i.workspace_id = p_ws and i.deleted_at is null
   limit 1;
  if not found then
    return null;
  end if;

  if v_kind in ('video', 'pdf') then
    v_p := v_meta->>(case v_kind when 'video' then 'poster' else 'src' end);
    if v_p is not null and left(v_p, 3) = 'r2:'
       and exists (select 1 from public.images i
                    where i.storage_path = substr(v_p, 4) and i.workspace_id = p_ws and i.deleted_at is null) then
      v_poster := substr(v_p, 4);
    end if;
  elsif v_kind = 'image' then
    v_poster := coalesce(v_img.preview_path, v_img.preview_sm_path);
  end if;

  v_name := left(coalesce(nullif(btrim(v_meta->>'fileName'), ''),
                          nullif(btrim(v_meta->>'name'), ''),
                          nullif(btrim(p_ci.title), ''),
                          nullif(btrim(v_img.original_name), ''),
                          'File'), 200);
  v_mime := nullif(btrim(left(v_meta->>'mime', 200)), '');
  v_ext := lower(substring(v_name from '\.([A-Za-z0-9]{1,8})$'));
  if v_ext is null and lower(v_meta->>'ext') ~ '^[a-z0-9]{1,8}$' then
    v_ext := lower(v_meta->>'ext');
  end if;

  return jsonb_build_object(
    'kind', v_kind,
    'name', v_name,
    'mime', v_mime,
    'size', case when v_meta->>'sizeBytes' ~ '^\d{1,15}$' then (v_meta->>'sizeBytes')::bigint
                 else v_img.size_bytes end,
    'duration', case when v_kind in ('video', 'audio') and v_meta->>'duration' ~ '^\d{1,7}(\.\d+)?$'
                     then (v_meta->>'duration')::numeric end,
    'page_count', case when v_kind = 'pdf' and v_meta->>'pageCount' ~ '^\d{1,6}$'
                       then (v_meta->>'pageCount')::integer end,
    'ext', v_ext,
    'src', v_key,
    'poster', v_poster,
    'risky', v_kind = 'file' and public._file_risky(v_name, v_mime)
  );
end;
$$;

-- The caller's access to a share: 'manage' | 'comment' | 'view' | 'none'.
--   manage  = can edit the cluster; comment = can read it (the team);
--   a person added by email gets their role; the link gives its level to anyone.
-- A suspended sharer or a banned workspace owner takes every outside grant down
-- (the team keeps comment). A risky file's link works only once the account
-- that opened the link is 72 hours old.
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

-- Token → {share_id, access, file, ...} or null. Every failure is null, which
-- the callers turn into {status:'gone'}: a takedown, a trashed cluster and an
-- unknown token look the same.
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
  -- The heal may have moved it.
  select s.* into v_share from public.file_shares s where s.id = v_share.id;
  if not found
     or not exists (select 1 from public.boards b where b.id = v_share.board_id and b.deleted_at is null) then
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

-- ── C. RPCs ─────────────────────────────────────────────────────────────────

-- What /f/<token> shows. Volatile: it heals a moved card and stamps the
-- caller's user id onto an invitation sent to their (confirmed) email.
create or replace function public.get_file_share(p_token uuid)
returns jsonb
language plpgsql security definer
set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_r      jsonb;
  v_access text;
  v_email  text;
  v_file   jsonb;
  v_by     jsonb;
  v_count  integer;
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
    select lower(u.email) into v_email
      from auth.users u where u.id = v_uid and u.email_confirmed_at is not null;
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

  if public._file_share_rank(v_access) >= 2 then
    select count(*) into v_count
      from public.file_comments c
     where c.share_id = (v_r->>'share_id')::uuid and c.deleted_at is null;
  end if;

  v_file := v_r->'file';
  return jsonb_build_object(
    'status', 'ok',
    'access', v_access,
    'signed_in', v_uid is not null,
    'can_comment', v_uid is not null and public._file_share_rank(v_access) >= 2,
    'allow_download', coalesce((v_r->>'allow_download')::boolean, false) or v_access = 'manage',
    'file', jsonb_build_object(
      'kind', v_file->'kind', 'name', v_file->'name', 'mime', v_file->'mime',
      'size', v_file->'size', 'duration', v_file->'duration', 'page_count', v_file->'page_count',
      'ext', v_file->'ext', 'risky', v_file->'risky'),
    'keys', jsonb_build_object('src', v_file->'src', 'poster', v_file->'poster'),
    'shared_by', v_by,
    'comment_count', v_count
  ) || case when v_access = 'manage'
            then jsonb_build_object('board_id', v_r->'board_id', 'card_id', v_r->'card_id')
            else '{}'::jsonb end;
end;
$$;

-- The comments on a shared file, oldest first. Comment access or higher reads
-- them, signed out included; view access gets an empty list.
create or replace function public.get_file_comments(p_token uuid)
returns jsonb
language plpgsql security definer
set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_r      jsonb;
  v_access text;
  v_manage boolean;
  v_src    text;
  v_rows   jsonb;
begin
  v_r := public._file_share_resolve(p_token);
  if v_r is null then
    return jsonb_build_object('status', 'gone');
  end if;
  v_access := v_r->>'access';
  if v_access = 'none' then
    return jsonb_build_object('status', case when v_uid is null then 'sign_in' else 'no_access' end);
  end if;
  if public._file_share_rank(v_access) < 2 then
    return jsonb_build_object('status', 'ok', 'access', v_access, 'comments', '[]'::jsonb);
  end if;
  v_manage := v_access = 'manage';
  v_src := v_r->'file'->>'src';

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id,
           'body', case when c.deleted_at is null then c.body end,
           'deleted', c.deleted_at is not null,
           'at_ms', c.at_ms,
           'page', c.page,
           'reply_to', c.reply_to,
           'resolved', c.resolved_at is not null,
           'created_at', c.created_at,
           'edited_at', c.edited_at,
           'on_current', c.version_key is null or c.version_key = v_src,
           'mine', v_uid is not null and c.author = v_uid,
           'author', jsonb_build_object('name', coalesce(nullif(btrim(pr.display_name), ''), 'Someone'),
                                        'avatar_url', pr.avatar_url,
                                        'color', pr.color),
           'can_delete', c.deleted_at is null and v_uid is not null and (c.author = v_uid or v_manage),
           'can_resolve', v_manage and c.reply_to is null
         ) order by c.created_at, c.id), '[]'::jsonb)
    into v_rows
    from (select x.*
            from public.file_comments x
           where x.share_id = (v_r->>'share_id')::uuid
             and (x.deleted_at is null
                  or exists (select 1 from public.file_comments r
                              where r.reply_to = x.id and r.deleted_at is null))
           order by x.created_at, x.id
           limit 2000) c
    left join public.profiles pr on pr.user_id = c.author;

  return jsonb_build_object('status', 'ok', 'access', v_access, 'comments', v_rows);
end;
$$;

-- The owner dialog's view of a card's share.
create or replace function public.get_file_share_settings(p_board uuid, p_card text)
returns jsonb
language plpgsql security definer
set search_path = '' as $$
declare
  v_share public.file_shares;
begin
  if auth.uid() is null or not coalesce(public.can_write_board(p_board), false) then
    raise exception 'you cannot share files in this cluster' using errcode = '42501';
  end if;
  v_share := public._file_share_find(p_board, p_card);
  if v_share.id is null then
    return jsonb_build_object('exists', false);
  end if;
  return jsonb_build_object(
    'exists', true,
    'token', v_share.token,
    'link_access', v_share.link_access,
    'allow_download', v_share.allow_download,
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
               'email', p.email,
               'role', p.role,
               'pending', p.user_id is null,
               'name', nullif(btrim(pr.display_name), ''),
               'avatar_url', pr.avatar_url
             ) order by p.created_at, p.email)
        from public.file_share_people p
        left join public.profiles pr on pr.user_id = p.user_id
       where p.share_id = v_share.id and p.revoked_at is null), '[]'::jsonb),
    'comment_count', (select count(*) from public.file_comments c
                       where c.share_id = v_share.id and c.deleted_at is null)
  );
end;
$$;

-- Create a card's share or change its link and download settings.
create or replace function public.set_file_share(p_board uuid, p_card text, p_link_access text, p_allow_download boolean)
returns jsonb
language plpgsql security definer
set search_path = '' as $$
declare
  v_uid  uuid := auth.uid();
  v_link text := coalesce(p_link_access, 'none');
  v_ws   uuid;
  v_ci   public.card_index;
  v_file jsonb;
begin
  if v_uid is null or not coalesce(public.can_write_board(p_board), false) then
    raise exception 'you cannot share files in this cluster' using errcode = '42501';
  end if;
  if v_link not in ('none', 'view', 'comment') then
    raise exception 'link access must be none, view or comment' using errcode = '22023';
  end if;
  select b.workspace_id into v_ws from public.boards b where b.id = p_board and b.deleted_at is null;
  if v_ws is null then
    raise exception 'file not found' using errcode = 'P0002';
  end if;
  select ci.* into v_ci from public.card_index ci where ci.board_id = p_board and ci.card_id = p_card;
  if not found then
    raise exception 'file not found' using errcode = 'P0002';
  end if;
  v_file := public._file_share_file(v_ws, v_ci);
  if v_file is null then
    raise exception 'this file cannot be shared' using errcode = '22023', hint = 'not_shareable';
  end if;
  if coalesce((v_file->>'risky')::boolean, false) and v_link <> 'none' and public._account_is_new() then
    raise exception 'new accounts cannot share this kind of file by link yet'
      using errcode = '42501', hint = 'new_account_risky';
  end if;

  perform public._file_share_find(p_board, p_card);
  insert into public.file_shares as f
         (workspace_id, board_id, card_id, link_access, link_set_by, allow_download, created_by)
  values (v_ws, p_board, p_card, v_link,
          case when v_link <> 'none' then v_uid end,
          coalesce(p_allow_download, true), v_uid)
  on conflict (board_id, card_id) do update
     set link_access = excluded.link_access,
         link_set_by = case when excluded.link_access <> 'none' then v_uid else f.link_set_by end,
         allow_download = coalesce(p_allow_download, f.allow_download),
         updated_at = now();

  return public.get_file_share_settings(p_board, p_card);
end;
$$;

-- Add people by email. A new (or re-added) person spends invite budget and is
-- emailed by _tg_file_share_person_email; a live person only changes role.
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
    v_norm := lower(btrim(coalesce(v_e, '')));
    if v_norm !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_norm) > 320 or v_norm = v_self then
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

-- Change a person's role, or remove them (p_role null). A role on a removed
-- person brings them back: that is the undo toast, and it sends no email.
create or replace function public.set_file_share_person(p_board uuid, p_card text, p_email text, p_role text)
returns jsonb
language plpgsql security definer
set search_path = '' as $$
declare
  v_share public.file_shares;
  v_norm  text := lower(btrim(coalesce(p_email, '')));
begin
  if auth.uid() is null or not coalesce(public.can_write_board(p_board), false) then
    raise exception 'you cannot share files in this cluster' using errcode = '42501';
  end if;
  if p_role is not null and p_role not in ('view', 'comment') then
    raise exception 'role must be view or comment' using errcode = '22023';
  end if;
  v_share := public._file_share_find(p_board, p_card);
  if v_share.id is null then
    raise exception 'file not found' using errcode = 'P0002';
  end if;
  if p_role is null then
    update public.file_share_people p
       set revoked_at = now()
     where p.share_id = v_share.id and p.email = v_norm and p.revoked_at is null;
  else
    update public.file_share_people p
       set role = p_role, revoked_at = null
     where p.share_id = v_share.id and p.email = v_norm;
    if not found then
      raise exception 'that person is not on this file' using errcode = 'P0002';
    end if;
  end if;
  return public.get_file_share_settings(p_board, p_card);
end;
$$;

-- Post a comment (or a reply) on a shared file.
create or replace function public.add_file_comment(p_token uuid, p_body text, p_at_ms integer default null,
                                                   p_page integer default null, p_reply_to uuid default null)
returns jsonb
language plpgsql security definer
set search_path = '' as $$
declare
  v_uid       uuid := auth.uid();
  v_body      text := btrim(coalesce(p_body, ''));
  v_r         jsonb;
  v_share_id  uuid;
  v_kind      text;
  v_n_burst   integer;
  v_n_day     integer;
  v_id        uuid;
begin
  if v_uid is null then
    raise exception 'sign in to comment' using errcode = '42501';
  end if;
  if not public._actor_active() then
    raise exception 'your account cannot comment' using errcode = '42501';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception 'a comment is 1 to 2000 characters' using errcode = '22023';
  end if;
  v_r := public._file_share_resolve(p_token);
  if v_r is null then
    raise exception 'that file is gone' using errcode = 'P0002';
  end if;
  if coalesce(v_r->>'access', 'none') not in ('comment', 'manage') then
    raise exception 'you cannot comment on this file' using errcode = '42501';
  end if;
  v_share_id := (v_r->>'share_id')::uuid;
  v_kind := v_r->'file'->>'kind';

  perform pg_advisory_xact_lock(hashtext('file_comment:' || v_uid::text));
  select count(*) filter (where c.created_at > now() - interval '10 minutes'),
         count(*)
    into v_n_burst, v_n_day
    from public.file_comments c
   where c.author = v_uid and c.created_at > now() - interval '1 day';
  if v_n_burst >= 20 or v_n_day >= 300 then
    raise exception 'too many comments: wait a few minutes'
      using errcode = 'P0001', hint = 'comment_rate_limited';
  end if;

  if p_reply_to is not null and not exists (
       select 1 from public.file_comments c
        where c.id = p_reply_to and c.share_id = v_share_id
          and c.deleted_at is null and c.reply_to is null) then
    raise exception 'that comment is gone' using errcode = 'P0002';
  end if;

  insert into public.file_comments (share_id, author, body, at_ms, page, version_key, reply_to)
  values (v_share_id, v_uid, v_body,
          case when p_reply_to is null and v_kind in ('video', 'audio')
                    and p_at_ms between 0 and 864000000 then p_at_ms end,
          case when p_reply_to is null and v_kind = 'pdf'
                    and p_page between 1 and 100000 then p_page end,
          v_r->'file'->>'src',
          p_reply_to)
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end;
$$;

-- Managers resolve (or reopen) a top-level comment.
create or replace function public.resolve_file_comment(p_id uuid, p_resolved boolean)
returns void
language plpgsql security definer
set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_c     public.file_comments;
  v_token uuid;
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  select c.* into v_c from public.file_comments c where c.id = p_id and c.deleted_at is null;
  if not found then
    raise exception 'that comment is gone' using errcode = 'P0002';
  end if;
  select s.token into v_token from public.file_shares s where s.id = v_c.share_id;
  if coalesce(public._file_share_resolve(v_token)->>'access', 'none') <> 'manage' then
    raise exception 'only people who can edit the cluster resolve comments' using errcode = '42501';
  end if;
  if v_c.reply_to is not null then
    raise exception 'only a top-level comment can be resolved' using errcode = '22023';
  end if;
  update public.file_comments c
     set resolved_at = case when coalesce(p_resolved, false) then now() end,
         resolved_by = case when coalesce(p_resolved, false) then v_uid end
   where c.id = p_id;
end;
$$;

-- The author or a manager deletes a comment (soft: the undo toast restores it).
create or replace function public.delete_file_comment(p_id uuid)
returns void
language plpgsql security definer
set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_c     public.file_comments;
  v_token uuid;
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  select c.* into v_c from public.file_comments c where c.id = p_id and c.deleted_at is null;
  if not found then
    raise exception 'that comment is gone' using errcode = 'P0002';
  end if;
  if v_c.author is distinct from v_uid then
    select s.token into v_token from public.file_shares s where s.id = v_c.share_id;
    if coalesce(public._file_share_resolve(v_token)->>'access', 'none') <> 'manage' then
      raise exception 'you cannot delete this comment' using errcode = '42501';
    end if;
  end if;
  update public.file_comments c set deleted_at = now(), deleted_by = v_uid where c.id = p_id and c.deleted_at is null;
end;
$$;

create or replace function public.restore_file_comment(p_id uuid)
returns void
language plpgsql security definer
set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_c     public.file_comments;
  v_token uuid;
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  select c.* into v_c from public.file_comments c where c.id = p_id;
  if not found then
    raise exception 'that comment is gone' using errcode = 'P0002';
  end if;
  if v_c.deleted_at is null then
    return;
  end if;
  -- An author undoes only their own delete, and only for a day; a comment a
  -- manager removed stays removed unless a manager brings it back.
  select s.token into v_token from public.file_shares s where s.id = v_c.share_id;
  if coalesce(public._file_share_resolve(v_token)->>'access', 'none') <> 'manage'
     and not (v_c.author = v_uid and v_c.deleted_by = v_uid
              and v_c.deleted_at > now() - interval '1 day') then
    raise exception 'you cannot restore this comment' using errcode = '42501';
  end if;
  update public.file_comments c set deleted_at = null, deleted_by = null where c.id = p_id;
end;
$$;

-- ── D. Notifications ────────────────────────────────────────────────────────

-- A person added to a file: a bell row when they have an account, and the
-- file_shared email (stranger class: the sharer is named by email, 0358).
-- An un-revoke emails only from add_file_share_people (app.file_share_invite);
-- the undo in set_file_share_person sends nothing.
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
    'sharerName', v_sharer, 'fileName', v_name, 'role', new.role, 'token', v_share.token::text));
  return new;
end;
$$;

-- A comment: the share's creator gets a bell row and (at most every 30 minutes
-- per share, when offline and opted in) the file_commented email; a reply
-- gives the parent's author a bell row.
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

  if v_share.created_by is distinct from new.author then
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
        'unsubscribeToken', (select t.token from public.email_unsub_tokens t where t.user_id = v_share.created_by)));
    end if;
  end if;

  if new.reply_to is not null then
    select c.author into v_parent_author from public.file_comments c where c.id = new.reply_to;
    if v_parent_author is not null and v_parent_author <> new.author
       and v_parent_author is distinct from v_share.created_by then
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

create or replace trigger file_share_people_email
  after insert or update of revoked_at on public.file_share_people
  for each row execute function public._tg_file_share_person_email();

create or replace trigger file_comments_notify
  after insert on public.file_comments
  for each row execute function public._tg_file_comment_notify();

-- ── E. Re-emits (live definitions; only the named lines change) ─────────────

-- _outbound_gate: file_shared is stranger mail (it can reach someone with no
-- account), file_commented is member mail (it goes to the share's creator).
create or replace function public._outbound_gate(p_template text, p_to text, p_data jsonb)
returns text
language plpgsql security definer
set search_path = public, auth as $$
declare
  cfg       jsonb   := coalesce((select value from public.app_config where key = 'outbound_breaker'), '{}'::jsonb);
  c_warn10  integer := coalesce((cfg->>'stranger_warn_10min')::int, 10);
  c_hold_h  integer := coalesce((cfg->>'stranger_hold_hour')::int, 30);
  c_hold_d  integer := coalesce((cfg->>'stranger_hold_day')::int, 60);
  c_recip_d integer := coalesce((cfg->>'recipient_stranger_day')::int, 3);
  c_mem_ah  integer := coalesce((cfg->>'member_actor_hour')::int, 30);
  c_mem_rd  integer := coalesce((cfg->>'member_recipient_day')::int, 10);
  c_new_h   integer := coalesce((cfg->>'new_account_hours')::int, 72);
  c_slack   integer := coalesce((cfg->>'budget_slack')::int, 2);
  v_actor   uuid    := auth.uid();
  v_key     text    := public._outbound_recipient_key(p_to);
  v_risk    text;
  v_state   text    := 'send';
  v_reason  text;
  v_email   text;
  v_created timestamptz;
  v_budget  integer;
  v_hold_since timestamptz;
  v_released   timestamptz;
  v_n10 integer; v_n60 integer; v_n24 integer;
  v_actor_n integer; v_recip_n integer;
  v_recipient uuid;
begin
  v_risk := case
    when p_template in ('pending_invite', 'board_shared', 'workspace_invite', 'file_shared') then 'stranger'
    when p_template in ('mention_email', 'comment_reply_email', 'schedule_update', 'invite_accepted', 'file_commented') then 'member'
    else 'system'
  end;
  if v_actor is not null then
    select u.email, u.created_at into v_email, v_created from auth.users u where u.id = v_actor;
  end if;

  if v_actor is not null and exists (select 1 from public.profiles p
                                      where p.user_id = v_actor and p.send_hold_at is not null) then
    v_state := 'hold'; v_reason := 'sender_on_hold';

  elsif v_risk = 'stranger' then
    -- One stranger send at a time, so the counts below cannot be raced.
    perform pg_advisory_xact_lock(hashtext('outbound_breaker:stranger'));
    select b.global_hold_since, b.released_at into v_hold_since, v_released
      from public.outbound_breaker b where b.id = 1;
    if v_hold_since is not null then
      v_state := 'hold'; v_reason := 'global_hold';
    else
      -- Releasing the breaker starts the count again, or the mail that tripped
      -- it would trip it a second time on the next invitation.
      select count(*) filter (where l.created_at > now() - interval '10 minutes'),
             count(*) filter (where l.created_at > now() - interval '1 hour'),
             count(*)
        into v_n10, v_n60, v_n24
        from public.outbound_ledger l
       where l.risk = 'stranger' and l.state in ('sent', 'held', 'released')
         and l.created_at > greatest(now() - interval '24 hours', coalesce(v_released, '-infinity'::timestamptz));
      select count(*) into v_recip_n
        from public.outbound_ledger l
       where l.risk = 'stranger' and l.recipient_hash = v_key and l.state in ('sent', 'released')
         and l.created_at > now() - interval '24 hours';

      if v_recip_n >= c_recip_d then
        v_state := 'drop'; v_reason := 'recipient_daily_cap';
      elsif v_n60 + 1 > c_hold_h or v_n24 + 1 > c_hold_d then
        update public.outbound_breaker
           set global_hold_since = now(),
               reason = format('%s stranger emails in the last hour, %s in the last day', v_n60 + 1, v_n24 + 1),
               released_at = null, released_by = null
         where id = 1;
        v_state := 'hold'; v_reason := 'global_hold_tripped';
        perform public._hold_new_senders(c_new_h);
        if v_actor is not null and v_created > now() - make_interval(hours => c_new_h) then
          perform public._hold_sending(v_actor, 'a new account sending invitations when the outbound breaker tripped', 'breaker');
        end if;
        perform public.ops_alert_raise('breaker',
          'Outbound breaker tripped: invitation emails are on hold',
          format(E'%s emails to people outside the product in the last hour, %s in the last day.\nThe one that tripped it came from %s.\nEvery invitation, share and workspace email is now held until you release the breaker. New accounts that sent them were put on a sending hold.',
                 v_n60 + 1, v_n24 + 1, coalesce(v_email, 'the system')),
          true, 'breaker:tripped', interval '1 hour', v_actor);
      else
        if v_actor is not null then
          v_budget := case when v_created > now() - interval '24 hours' then 5 else 20 end;
          select count(*) into v_actor_n
            from public.outbound_ledger l
           where l.risk = 'stranger' and l.actor = v_actor and l.state in ('sent', 'released')
             and l.created_at > now() - interval '24 hours';
          if v_actor_n >= v_budget + c_slack then
            v_state := 'hold'; v_reason := 'sender_over_budget';
            perform public._hold_sending(v_actor,
              format('sent %s invitation emails in 24 hours against a budget of %s, so something got past the budget', v_actor_n + 1, v_budget),
              'breaker');
          elsif v_actor_n + 1 = v_budget then
            perform public.ops_alert_raise('budget',
              'An account used its whole invitation budget: ' || coalesce(v_email, v_actor::text),
              format('%s invitation emails in 24 hours: its whole budget.', v_budget),
              true, 'budget:' || v_actor, interval '24 hours', v_actor);
          end if;
        end if;
        if v_state = 'send' and v_n10 + 1 >= c_warn10 then
          perform public.ops_alert_raise('volume',
            format('%s invitation emails in 10 minutes', v_n10 + 1),
            format(E'Early warning: nothing is held yet. The breaker trips at %s in an hour.\nLatest sender: %s', c_hold_h, coalesce(v_email, 'the system')),
            true, 'volume:10min', interval '1 hour', v_actor);
        end if;
      end if;
    end if;

  elsif v_risk = 'member' then
    select u.id into v_recipient from auth.users u where lower(u.email) = lower(p_to) limit 1;
    if v_recipient is null
       or not exists (select 1 from public.user_presence pr where pr.user_id = v_recipient) then
      v_state := 'drop'; v_reason := 'recipient_never_opened_app';
    else
      select count(*) into v_actor_n
        from public.outbound_ledger l
       where l.risk = 'member' and l.actor = v_actor and l.state in ('sent', 'held', 'released')
         and l.created_at > now() - interval '1 hour';
      select count(*) into v_recip_n
        from public.outbound_ledger l
       where l.risk = 'member' and l.recipient_hash = v_key and l.state in ('sent', 'released')
         and l.created_at > now() - interval '24 hours';
      if v_actor is not null and v_actor_n >= c_mem_ah then
        v_state := 'hold'; v_reason := 'member_sender_hourly_cap';
        perform public.ops_alert_raise('member_volume',
          'One account sent ' || (v_actor_n + 1) || ' notification emails in an hour: ' || coalesce(v_email, v_actor::text),
          'Mentions, replies and schedule updates from this account are held. Release or drop them from the Security tab.',
          true, 'member:' || v_actor, interval '1 hour', v_actor);
      elsif v_recip_n >= c_mem_rd then
        v_state := 'hold'; v_reason := 'member_recipient_daily_cap';
        perform public.ops_alert_raise('member_volume',
          'One person was about to get more than ' || c_mem_rd || ' notification emails today',
          'Further mentions, replies and schedule updates to them are held. Latest sender: ' || coalesce(v_email, 'the system'),
          true, 'member_recipient:' || v_key, interval '6 hours', v_actor);
      end if;
    end if;
  end if;

  insert into public.outbound_ledger (actor, template, risk, recipient_hash, state, reason, payload)
  values (v_actor, p_template, v_risk, v_key,
          case v_state when 'hold' then 'held' when 'drop' then 'dropped' else 'sent' end,
          v_reason,
          case when v_state = 'hold'
               then jsonb_build_object('template', p_template, 'to', p_to, 'data', p_data, 'actor', v_actor)
          end);
  return v_state;
exception when others then
  -- Fail closed: hold it rather than send it or lose it.
  begin
    insert into public.outbound_ledger (actor, template, risk, recipient_hash, state, reason, payload)
    values (auth.uid(), p_template, 'system', md5(lower(coalesce(p_to, ''))), 'held',
            left('gate_error: ' || sqlerrm, 300),
            jsonb_build_object('template', p_template, 'to', p_to, 'data', p_data, 'actor', auth.uid()));
  exception when others then
    null;
  end;
  return 'hold';
end;
$$;
revoke execute on function public._outbound_gate(text, text, jsonb) from public, anon, authenticated;

-- check_security_invariants: the two file triggers are reviewed email senders.
CREATE OR REPLACE FUNCTION public.check_security_invariants()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_bad   text;
  v_n     integer := 0;
  v_src   text;
begin
  -- 1. HTTP from the database: any net.http call, not only http_post (0390).
  select string_agg(p.proname, ', ' order by p.proname) into v_bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prosrc ilike '%net.http%'
     and p.proname not in ('_notify_email_send', 'ops_alert_dispatch', '_cron_edge_post', '_ops_hc_ping', 'check_security_invariants');
  if v_bad is not null then
    v_n := v_n + 1;
    perform public.ops_alert_raise('invariant', 'A database function now makes HTTP calls',
      'Not on the reviewed list: ' || v_bad || E'.\nA call out of a trigger or RPC can send email without passing the outbound gate.',
      true, 'invariant:http_post', interval '24 hours');
  end if;

  -- 2. Who sends email, and through what.
  select string_agg(p.proname, ', ' order by p.proname) into v_bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prosrc ~ '_notify_email\('
     and p.proname not in ('check_security_invariants', '_notify_email',
                           '_tg_comment_reply_email', '_tg_mention_notification_email',
                           '_tg_pending_invite_email', '_tg_schedule_notification_email',
                           '_tg_share_notification_email', '_tg_workspace_member_email',
                           '_tg_file_share_person_email', '_tg_file_comment_notify');
  if v_bad is not null then
    v_n := v_n + 1;
    perform public.ops_alert_raise('invariant', 'A new path sends email',
      'Calls _notify_email and is not one of the six reviewed triggers: ' || v_bad
        || E'.\nClassify its template in _outbound_gate (stranger or member) and add it to check_security_invariants.',
      true, 'invariant:notify_email', interval '24 hours');
  end if;
  select prosrc into v_src from pg_proc where oid = to_regprocedure('public._notify_email(text,text,jsonb)');
  if v_src is null or position('_outbound_gate' in v_src) = 0 then
    v_n := v_n + 1;
    perform public.ops_alert_raise('invariant', 'The outbound gate is no longer in front of email',
      '_notify_email does not call _outbound_gate (or has a new signature). Every database email is going out unchecked.',
      true, 'invariant:gate', interval '24 hours');
  end if;

  -- 3. Internal helpers a client can run.
  select string_agg(p.oid::regprocedure::text, ', ' order by p.proname) into v_bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname like '\_%' escape '\'
     and p.prosecdef
     and p.prorettype <> 'trigger'::regtype
     and p.proname not in ('_board_in_workspace', '_require_admin')
     and (has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute'));
  if v_bad is not null then
    v_n := v_n + 1;
    perform public.ops_alert_raise('invariant', 'An internal helper is callable by clients',
      'SECURITY DEFINER and executable by anon or authenticated: ' || v_bad
        || E'.\nThe 0311 rule: revoke execute ... from public, anon, authenticated.',
      true, 'invariant:helpers', interval '24 hours');
  end if;

  -- 4. INSERT policies that accept anything.
  select string_agg(c.relname || ': ' || pol.polname, ', ' order by c.relname) into v_bad
    from pg_policy pol join pg_class c on c.oid = pol.polrelid
   where c.relnamespace = 'public'::regnamespace
     and pol.polcmd in ('a', '*')
     and coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid),
                  case when pol.polcmd = '*' then pg_get_expr(pol.polqual, pol.polrelid) end,
                  'true') = 'true'
     and not (c.relname = 'analytics_events' and pol.polname = 'anyone insert events');
  if v_bad is not null then
    v_n := v_n + 1;
    perform public.ops_alert_raise('invariant', 'A table accepts any row from a client',
      'INSERT policy with no condition: ' || v_bad || '.',
      true, 'invariant:open_insert', interval '24 hours');
  end if;

  -- 5. Row-level security everywhere.
  select string_agg(c.relname, ', ' order by c.relname) into v_bad
    from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relkind in ('r', 'p')
     and not c.relrowsecurity;
  if v_bad is not null then
    v_n := v_n + 1;
    perform public.ops_alert_raise('invariant', 'A table has row-level security off',
      'Readable and writable by any client the grants allow: ' || v_bad || '.',
      true, 'invariant:rls', interval '24 hours');
  end if;

  -- 6. The alert path itself.
  select concat_ws(', ',
           case when not exists (select 1 from public.outbound_breaker where id = 1) then 'the breaker row is gone' end,
           case when coalesce((select (value->>'enabled')::boolean from public.app_config
                                where key = 'ops_alert_dispatch'), false) is not true
                then 'alert emails are switched off (app_config ops_alert_dispatch)' end,
           (select 'missing or paused schedule: ' || string_agg(j, ', ')
              from unnest(array['ops-alert-dispatch', 'abuse-signals', 'outbound-expire-held',
                                'ops-heartbeat-weekly', 'security-invariants', 'ops-deadman']) j
             where not exists (select 1 from cron.job c where c.jobname = j and c.active)))
    into v_bad;
  if v_bad <> '' then
    v_n := v_n + 1;
    perform public.ops_alert_raise('invariant', 'Part of the alert path is off',
      v_bad || '.', true, 'invariant:alert_path', interval '24 hours');
  end if;

  return v_n;
end;
$function$;
revoke execute on function public.check_security_invariants() from public, anon, authenticated;

-- repoint_card_refs: a re-id (paste, duplicate, server move) carries the
-- card's file share as it carries stars. Still returns the starred count.
CREATE OR REPLACE FUNCTION public.repoint_card_refs(p_from uuid, p_to uuid, p_pairs jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ws_from uuid;
  v_ws_to   uuid;
  v_n       integer := 0;
begin
  if p_from is null or p_to is null or p_from = p_to then
    return 0;
  end if;
  if jsonb_typeof(p_pairs) is distinct from 'array' then
    raise exception 'p_pairs must be an array of {from, to}' using errcode = '22023';
  end if;
  if jsonb_array_length(p_pairs) > 500 then
    raise exception 'at most 500 pairs at a time' using errcode = '22023';
  end if;
  if not coalesce(public.can_write_board(p_from), false)
     or not coalesce(public.can_write_board(p_to), false) then
    raise exception 'you cannot edit both clusters' using errcode = '42501';
  end if;

  select b.workspace_id into v_ws_from from public.boards b where b.id = p_from;
  select b.workspace_id into v_ws_to   from public.boards b where b.id = p_to;
  if v_ws_from is null or v_ws_from is distinct from v_ws_to then
    return 0;
  end if;

  -- A star filed under the source, or under an older cluster that no longer
  -- holds the card (sidebar_starred found it by id after a server-side move,
  -- which leaves the row where it was). Never one on a cluster that still
  -- holds a card with that id: a duplicated cluster can.
  with pairs as (
    select p->>'from' as old_id, p->>'to' as new_id
      from jsonb_array_elements(p_pairs) p
     where coalesce(p->>'from', '') <> '' and coalesce(p->>'to', '') <> ''
  )
  update public.starred_items s
     set board_id = p_to, card_id = pairs.new_id
    from pairs
   where s.workspace_id = v_ws_from
     and s.card_id = pairs.old_id
     and (s.board_id = p_from
          or not exists (select 1 from public.card_index c
                          where c.board_id = s.board_id and c.card_id = s.card_id))
     and not exists (
       select 1 from public.starred_items t
        where t.user_id = s.user_id and t.board_id = p_to and t.card_id = pairs.new_id
     );
  get diagnostics v_n = row_count;

  -- The card's file share moves with it, on the same rule as a star (0421).
  -- One share per pair, and never onto a card that already has one; a
  -- conflict here must never fail the re-id, so it leaves the share behind.
  begin
    with pairs as (
      select p->>'from' as old_id, p->>'to' as new_id
        from jsonb_array_elements(p_pairs) p
       where coalesce(p->>'from', '') <> '' and coalesce(p->>'to', '') <> ''
    )
    update public.file_shares f
       set board_id = p_to, card_id = pairs.new_id, updated_at = now()
      from pairs
     where f.id = (select s.id from public.file_shares s
                    where s.workspace_id = v_ws_from
                      and s.card_id = pairs.old_id
                      and (s.board_id = p_from
                           or not exists (select 1 from public.card_index c
                                           where c.board_id = s.board_id and c.card_id = s.card_id))
                    order by (s.board_id = p_from) desc, s.updated_at desc
                    limit 1)
       and not exists (
         select 1 from public.file_shares t
          where t.board_id = p_to and t.card_id = pairs.new_id
       );
  exception when unique_violation then
    null;
  end;
  return v_n;
end $function$;

revoke all on function public.repoint_card_refs(uuid, uuid, jsonb) from public, anon;
grant execute on function public.repoint_card_refs(uuid, uuid, jsonb) to authenticated, service_role;

-- ── F. Grants ───────────────────────────────────────────────────────────────
-- Revoked from PUBLIC as well as anon: a revoke from anon is a no-op while
-- PUBLIC still holds the grant. Signed out may only read a share and its
-- comments.
revoke all on function public.get_file_share(uuid) from public;
revoke all on function public.get_file_comments(uuid) from public;
revoke all on function public.get_file_share_settings(uuid, text) from public;
revoke all on function public.set_file_share(uuid, text, text, boolean) from public;
revoke all on function public.add_file_share_people(uuid, text, text[], text) from public;
revoke all on function public.set_file_share_person(uuid, text, text, text) from public;
revoke all on function public.add_file_comment(uuid, text, integer, integer, uuid) from public;
revoke all on function public.resolve_file_comment(uuid, boolean) from public;
revoke all on function public.delete_file_comment(uuid) from public;
revoke all on function public.restore_file_comment(uuid) from public;
revoke all on function public.get_file_share_settings(uuid, text) from anon;
revoke all on function public.set_file_share(uuid, text, text, boolean) from anon;
revoke all on function public.add_file_share_people(uuid, text, text[], text) from anon;
revoke all on function public.set_file_share_person(uuid, text, text, text) from anon;
revoke all on function public.add_file_comment(uuid, text, integer, integer, uuid) from anon;
revoke all on function public.resolve_file_comment(uuid, boolean) from anon;
revoke all on function public.delete_file_comment(uuid) from anon;
revoke all on function public.restore_file_comment(uuid) from anon;
grant execute on function public.get_file_share(uuid) to anon, authenticated, service_role;
grant execute on function public.get_file_comments(uuid) to anon, authenticated, service_role;
grant execute on function public.get_file_share_settings(uuid, text) to authenticated, service_role;
grant execute on function public.set_file_share(uuid, text, text, boolean) to authenticated, service_role;
grant execute on function public.add_file_share_people(uuid, text, text[], text) to authenticated, service_role;
grant execute on function public.set_file_share_person(uuid, text, text, text) to authenticated, service_role;
grant execute on function public.add_file_comment(uuid, text, integer, integer, uuid) to authenticated, service_role;
grant execute on function public.resolve_file_comment(uuid, boolean) to authenticated, service_role;
grant execute on function public.delete_file_comment(uuid) to authenticated, service_role;
grant execute on function public.restore_file_comment(uuid) to authenticated, service_role;

-- Helpers and trigger functions: server-only.
revoke execute on function public._file_share_rank(text) from public, anon, authenticated;
revoke execute on function public._file_risky(text, text) from public, anon, authenticated;
revoke execute on function public._file_share_card(public.file_shares) from public, anon, authenticated;
revoke execute on function public._file_share_find(uuid, text) from public, anon, authenticated;
revoke execute on function public._file_share_file(uuid, public.card_index) from public, anon, authenticated;
revoke execute on function public._file_share_access(public.file_shares, boolean) from public, anon, authenticated;
revoke execute on function public._file_share_resolve(uuid) from public, anon, authenticated;
revoke execute on function public._tg_file_share_person_email() from public, anon, authenticated;
revoke execute on function public._tg_file_comment_notify() from public, anon, authenticated;

-- ── Prove it ─────────────────────────────────────────────────────────────────
do $$
declare
  v_sig text;
  v_t   text;
begin
  foreach v_sig in array array[
    'public.get_file_share(uuid)',
    'public.get_file_comments(uuid)'
  ] loop
    if not has_function_privilege('anon', v_sig, 'execute') then
      raise exception '0421: % is not callable signed out', v_sig;
    end if;
  end loop;

  foreach v_sig in array array[
    'public.get_file_share_settings(uuid, text)',
    'public.set_file_share(uuid, text, text, boolean)',
    'public.add_file_share_people(uuid, text, text[], text)',
    'public.set_file_share_person(uuid, text, text, text)',
    'public.add_file_comment(uuid, text, integer, integer, uuid)',
    'public.resolve_file_comment(uuid, boolean)',
    'public.delete_file_comment(uuid)',
    'public.restore_file_comment(uuid)'
  ] loop
    if has_function_privilege('anon', v_sig, 'execute') then
      raise exception '0421: % is callable signed out', v_sig;
    end if;
  end loop;

  foreach v_sig in array array[
    'public.get_file_share(uuid)',
    'public.get_file_comments(uuid)',
    'public.get_file_share_settings(uuid, text)',
    'public.set_file_share(uuid, text, text, boolean)',
    'public.add_file_share_people(uuid, text, text[], text)',
    'public.set_file_share_person(uuid, text, text, text)',
    'public.add_file_comment(uuid, text, integer, integer, uuid)',
    'public.resolve_file_comment(uuid, boolean)',
    'public.delete_file_comment(uuid)',
    'public.restore_file_comment(uuid)'
  ] loop
    if not has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception '0421: % is not callable by a signed-in user', v_sig;
    end if;
  end loop;

  foreach v_sig in array array[
    'public._file_share_rank(text)',
    'public._file_risky(text, text)',
    'public._file_share_card(public.file_shares)',
    'public._file_share_find(uuid, text)',
    'public._file_share_file(uuid, public.card_index)',
    'public._file_share_access(public.file_shares, boolean)',
    'public._file_share_resolve(uuid)',
    'public._tg_file_share_person_email()',
    'public._tg_file_comment_notify()'
  ] loop
    if has_function_privilege('public', v_sig, 'execute')
       or has_function_privilege('anon', v_sig, 'execute')
       or has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception '0421: % is client-callable', v_sig;
    end if;
  end loop;

  foreach v_t in array array['public.file_shares', 'public.file_share_people', 'public.file_comments'] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = v_t::regclass) then
      raise exception '0421: % has no RLS', v_t;
    end if;
    if exists (select 1 from pg_policy p where p.polrelid = v_t::regclass) then
      raise exception '0421: % has a policy; only the RPCs may touch it', v_t;
    end if;
    if has_table_privilege('anon', v_t, 'select') or has_table_privilege('authenticated', v_t, 'select')
       or has_table_privilege('anon', v_t, 'insert') or has_table_privilege('authenticated', v_t, 'insert')
       or has_table_privilege('authenticated', v_t, 'update') or has_table_privilege('authenticated', v_t, 'delete') then
      raise exception '0421: % is reachable by a client', v_t;
    end if;
  end loop;

  if position('_sharer_suspended' in (select p.prosrc from pg_proc p
      where p.oid = 'public._file_share_access(public.file_shares, boolean)'::regprocedure)) = 0 then
    raise exception '0421: _file_share_access lost the takedown check';
  end if;
  if position('file_shares' in (select p.prosrc from pg_proc p
      where p.oid = 'public.repoint_card_refs(uuid, uuid, jsonb)'::regprocedure)) = 0 then
    raise exception '0421: repoint_card_refs does not carry file shares';
  end if;
  if position('''file_shared''' in (select p.prosrc from pg_proc p
      where p.oid = 'public._outbound_gate(text, text, jsonb)'::regprocedure)) = 0
     or position('''file_commented''' in (select p.prosrc from pg_proc p
      where p.oid = 'public._outbound_gate(text, text, jsonb)'::regprocedure)) = 0 then
    raise exception '0421: _outbound_gate does not classify the file templates';
  end if;
  if position('_tg_file_comment_notify' in (select p.prosrc from pg_proc p
      where p.oid = 'public.check_security_invariants()'::regprocedure)) = 0
     or position('_tg_file_share_person_email' in (select p.prosrc from pg_proc p
      where p.oid = 'public.check_security_invariants()'::regprocedure)) = 0 then
    raise exception '0421: check_security_invariants does not allow the file email triggers';
  end if;
end $$;
