-- 0091_demo_tier_lockdown.sql — close four demo-tier escalation / limit-bypass holes.
--
-- An adversarial audit found that while shared-board view-only rules are
-- enforced server-side (can_write_board / can_write_workspace in 0083 +
-- PartyKit auth), several other demo-tier limits were enforceable only in
-- client JavaScript or had RLS gaps. A demo user with a valid JWT could
-- bypass them by editing the client or calling PostgREST/RPC directly:
--
--   FIX 1 (CRITICAL): profiles self-promotion. The "self update profile"
--     RLS policy (0030) has no column restriction, and Supabase's default
--     grants give anon+authenticated UPDATE/INSERT on every profiles
--     column. So `PATCH /rest/v1/profiles {"tier":"admin"}` (or
--     {"demo_card_count":0}) succeeded — defeating the entire tier system.
--     Fix = column-level privilege lockdown: revoke broad write, re-grant
--     only the genuinely user-editable columns. Every privileged column is
--     written exclusively by SECURITY DEFINER funcs/triggers (which run as
--     the table owner and bypass column grants) or by the service-role
--     Stripe/waitlist functions (which bypass grants + RLS entirely).
--
--   FIX 2 (HIGH): workspace_members self-join. The "wm insert by workspace
--     creator" policy (0001) carried an `or user_id = auth.uid()` clause (a
--     v1 "TODO: gate by invite token" that was never closed), letting any
--     user add themselves to any workspace -> cross-workspace data read and
--     unlocking FIX 3. Recreate it creator-only. Legitimate membership
--     (invite acceptance, workspace bootstrap) is created by SECURITY
--     DEFINER RPCs that bypass RLS, so they are unaffected.
--
--   FIX 3 (HIGH): five workspace-write RPCs still gate on is_workspace_member
--     instead of the tier-aware can_write_workspace (0083 switched the rest
--     but missed these). They are SECURITY DEFINER (bypass RLS), so the
--     in-function guard is the only authorization. Recreate each IDENTICAL
--     to its latest source definition, changing ONLY the guard.
--
--   FIX 4 (MEDIUM): no server-side 100-card cap for demo. Cards are written
--     by an authenticated client upsert (boardsApi.js syncCardIndex) with no
--     ceiling. Add a BEFORE INSERT trigger on card_index that blocks demo
--     board-owners at 100. NOTE: we COUNT actual rows rather than trusting
--     the cached profiles.demo_card_count, because AFTER-row triggers (which
--     maintain that counter) fire only at end-of-statement, so a single
--     multi-row upsert would otherwise let an entire batch read the same
--     stale count and slip past the cap. A COUNT sees rows inserted earlier
--     in the same statement, so the cap holds at exactly 100 even for batches.
--
-- All statements are idempotent (drop-if-exists / create-or-replace). No
-- explicit BEGIN/COMMIT: the migration runner wraps each file in a
-- transaction (matching every other migration in this repo).

------------------------------------------------------------------
-- FIX 1 — PROFILES COLUMN-LEVEL PRIVILEGE LOCKDOWN
------------------------------------------------------------------
-- Revoke the inherited broad write privileges from BOTH roles. anon can
-- never satisfy the RLS check (user_id = auth.uid() with a null uid) but we
-- revoke for hygiene and to match the 0084 lock-down precedent.
revoke insert, update on public.profiles from authenticated;
revoke insert, update on public.profiles from anon;

-- Re-grant UPDATE only on the columns a user edits via a direct client write:
--   * display_name, color, avatar_url -> saveOwnProfile (boardsApi.js)
--   * notification_prefs              -> togglePref (SettingsPanel.jsx)
-- NOT granted (written only by SECURITY DEFINER / service-role):
--   * settings (merge_profile_settings, DEFINER)
--   * tier, demo_card_count (admin_set_tier / signup+count triggers / Stripe)
--   * seconds_in_app (bump_seconds_in_app, DEFINER)
--   * first_source, first_*_at (set_first_source / _stamp_* triggers, DEFINER)
-- NOT granted but intentionally fine:
--   * updated_at — set by the BEFORE UPDATE touch trigger (0030). Postgres
--     checks UPDATE column privilege only against columns in the SET clause,
--     never columns a trigger mutates, so no grant is required.
--   * user_id (PK) — never SET on the update path.
grant update (display_name, color, avatar_url, notification_prefs)
  on public.profiles to authenticated;

-- Re-grant INSERT only on the columns saveOwnProfile sends on its upsert
-- insert path, so a fresh row cannot be inserted with tier='admin'. The
-- privileged columns fall back to their column defaults on insert.
grant insert (user_id, display_name, color, avatar_url, notification_prefs)
  on public.profiles to authenticated;

-- SELECT is left intact (row visibility is governed by the existing
-- self-read / ws-mate-read policies in 0030).
--
-- MAINTAINER NOTE: profiles is now FAIL-CLOSED for writes. Any NEW
-- user-editable profiles column MUST be added to the GRANT lists above, or
-- client writes to it will fail with "permission denied for column".
-- Privileged columns must be written only via SECURITY DEFINER functions.

------------------------------------------------------------------
-- FIX 2 — WORKSPACE_MEMBERS: CREATOR-ONLY INSERT
------------------------------------------------------------------
-- Drop the policy that allowed self-join (`or user_id = auth.uid()`) and
-- recreate it creator-only. Invite acceptance (claim_pending_invite,
-- _claim_pending_invites_for_user, invite_workspace_member) and bootstrap
-- (get_or_create_personal_workspace, create_workspace_with_root) are all
-- SECURITY DEFINER and bypass RLS, so they keep working. The owner-side
-- client invite (App.jsx inviteToWorkspace) inserts user_id=<invitee> and
-- satisfies the creator clause, so it is unaffected.
--
-- DRIFT NOTE: production renamed this policy to "wm insert by workspace
-- creator or self" via a manual (non-migration) edit, so we drop BOTH that
-- name and the original 0001 name to be sure the self-join policy is gone
-- (permissive INSERT policies are OR'd, so a leftover would defeat the fix).
drop policy if exists "wm insert by workspace creator or self" on public.workspace_members;
drop policy if exists "wm insert by workspace creator" on public.workspace_members;
create policy "wm insert by workspace creator" on public.workspace_members
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.workspaces w
      where w.id = workspace_id and w.created_by = auth.uid()
    )
  );

------------------------------------------------------------------
-- FIX 3 — SWAP is_workspace_member -> can_write_workspace IN WRITE RPCs
-- Each function is reproduced verbatim from its latest source definition;
-- the ONLY change is the authorization guard. can_write_workspace delegates
-- to is_workspace_member for admin/paid (0083), so legitimate members are
-- unaffected; demo non-owners are now correctly denied.
------------------------------------------------------------------

-- 3a. merge_tags (source: 0039_merge_tags_rpc.sql)
create or replace function merge_tags(
  p_from_tag_id uuid,
  p_into_tag_id uuid
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  ws_from uuid;
  ws_into uuid;
  rewritten int;
begin
  if p_from_tag_id is null or p_into_tag_id is null then
    raise exception 'merge_tags: both ids required';
  end if;
  if p_from_tag_id = p_into_tag_id then
    return 0;
  end if;

  select t.workspace_id into ws_from from tags t where t.id = p_from_tag_id;
  select t.workspace_id into ws_into from tags t where t.id = p_into_tag_id;

  if ws_from is null or ws_into is null then
    raise exception 'merge_tags: tag not found';
  end if;
  if ws_from <> ws_into then
    raise exception 'merge_tags: tags must be in the same workspace';
  end if;

  -- CHANGED: tier-aware write guard (was is_workspace_member).
  if not can_write_workspace(ws_from) then
    raise exception 'merge_tags: not a member of this workspace';
  end if;

  delete from entity_links a
   where a.target_kind = 'tag'
     and a.target_id   = p_from_tag_id
     and exists (
       select 1 from entity_links b
        where b.target_kind = 'tag'
          and b.target_id   = p_into_tag_id
          and b.source_kind = a.source_kind
          and b.source_id   = a.source_id
          and coalesce(b.source_page_id, '') = coalesce(a.source_page_id, '')
          and coalesce(b.source_link_id, '') = coalesce(a.source_link_id, '')
          and b.link_kind   = a.link_kind
     );

  with promoted as (
    update entity_links
       set target_id = p_into_tag_id
     where target_kind = 'tag'
       and target_id   = p_from_tag_id
     returning id
  )
  select count(*) into rewritten from promoted;

  delete from tags where id = p_from_tag_id;

  return rewritten;
end $$;
revoke all on function merge_tags(uuid, uuid) from public;
grant execute on function merge_tags(uuid, uuid) to authenticated;

-- 3b. backfill_tag_applications (source: 0046_autotag_triggers_respect_ignored.sql)
create or replace function backfill_tag_applications(
  p_tag_id uuid,
  p_workspace_id uuid
)
returns int
language plpgsql security definer set search_path = public as $$
declare
  slug_text text;
  word_re text;
  total int := 0;
  delta int;
begin
  -- CHANGED: tier-aware write guard (was is_workspace_member).
  if not can_write_workspace(p_workspace_id) then
    raise exception 'not a workspace member';
  end if;
  select t.slug into slug_text from tags t where t.id = p_tag_id and t.workspace_id = p_workspace_id;
  if slug_text is null then return 0; end if;
  word_re := _tag_slug_word_re(slug_text);

  with ins as (
    insert into entity_links (source_kind, source_id, source_workspace, source_board_id, target_kind, target_id, link_kind, source)
    select 'board', b.id::text, b.workspace_id, b.id, 'tag', p_tag_id, 'applied', 'auto'
      from boards b
     where b.workspace_id = p_workspace_id and b.name is not null and lower(b.name) ~ word_re
       and not exists (
         select 1 from autotag_ignored ai
          where ai.workspace_id = p_workspace_id and ai.target_kind = 'board'
            and ai.target_id = b.id::text and ai.tag_id = p_tag_id
       )
    on conflict do nothing
    returning 1
  )
  select count(*) into delta from ins;
  total := total + coalesce(delta, 0);

  with ins as (
    insert into entity_links (source_kind, source_id, source_workspace, source_board_id, target_kind, target_id, link_kind, source)
    select 'group', gi.group_id, b.workspace_id, gi.board_id, 'tag', p_tag_id, 'applied', 'auto'
      from group_index gi
      join boards b on b.id = gi.board_id
     where b.workspace_id = p_workspace_id and gi.name is not null and lower(gi.name) ~ word_re
       and not exists (
         select 1 from autotag_ignored ai
          where ai.workspace_id = p_workspace_id and ai.target_kind = 'group'
            and ai.target_id = gi.group_id and ai.tag_id = p_tag_id
       )
    on conflict do nothing
    returning 1
  )
  select count(*) into delta from ins;
  total := total + coalesce(delta, 0);

  with ins as (
    insert into entity_links (source_kind, source_id, source_workspace, source_board_id, target_kind, target_id, link_kind, source)
    select 'card', ci.card_id, ci.workspace_id, ci.board_id, 'tag', p_tag_id, 'applied', 'auto'
      from card_index ci
     where ci.workspace_id = p_workspace_id
       and ((ci.title is not null and lower(ci.title) ~ word_re) or (ci.body is not null and lower(ci.body) ~ word_re))
       and not exists (
         select 1 from autotag_ignored ai
          where ai.workspace_id = p_workspace_id and ai.target_kind = 'card'
            and ai.target_id = ci.card_id and ai.tag_id = p_tag_id
       )
    on conflict do nothing
    returning 1
  )
  select count(*) into delta from ins;
  total := total + coalesce(delta, 0);

  return total;
end $$;
revoke all on function backfill_tag_applications(uuid, uuid) from public;
grant execute on function backfill_tag_applications(uuid, uuid) to authenticated;

-- 3c. toggle_pin (source: 0020_messaging_power_features.sql)
create or replace function toggle_pin(p_message_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_workspace uuid;
  v_pinned    boolean;
begin
  select workspace_id, is_pinned into v_workspace, v_pinned
  from messages where id = p_message_id;
  if v_workspace is null then
    raise exception 'message % not found', p_message_id using errcode = '42704';
  end if;
  -- CHANGED: tier-aware write guard (was is_workspace_member).
  if not can_write_workspace(v_workspace) then
    raise exception 'must be a workspace member to pin' using errcode = '42501';
  end if;
  update messages set is_pinned = not v_pinned where id = p_message_id;
  return not v_pinned;
end;
$$;
revoke all on function toggle_pin(uuid) from public;
grant execute on function toggle_pin(uuid) to authenticated;

-- 3d. add_entity_alias (source: 0022_entity_links_and_aliases.sql)
create or replace function add_entity_alias(
  p_workspace uuid,
  p_entity_kind text,
  p_entity_id text,
  p_alias text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  rid uuid;
begin
  uid := auth.uid();
  -- CHANGED: tier-aware write guard (was is_workspace_member).
  if uid is null or not can_write_workspace(p_workspace) then
    raise exception 'not a member of this workspace';
  end if;
  insert into entity_aliases (workspace_id, entity_kind, entity_id, alias, created_by)
  values (p_workspace, p_entity_kind, p_entity_id, trim(p_alias), uid)
  on conflict (workspace_id, entity_kind, entity_id, lower(alias))
    do update set created_at = entity_aliases.created_at
  returning id into rid;
  return rid;
end $$;
revoke all on function add_entity_alias(uuid, text, text, text) from public;
grant execute on function add_entity_alias(uuid, text, text, text) to authenticated;

-- 3e. purge_bogus_autoapplied_tags (source: 0056_purge_bogus_autoapplied_tags.sql)
-- Included despite a prior "RLS backstops the DELETE" hypothesis: this is a
-- DEFINER function owned by postgres, so it bypasses RLS on entity_links and
-- the in-function guard is the only authorization gate.
create or replace function purge_bogus_autoapplied_tags(
  p_workspace_id uuid
)
returns int
language plpgsql security definer set search_path = public as $$
declare
  total int := 0;
begin
  -- CHANGED: tier-aware write guard (was is_workspace_member).
  if not can_write_workspace(p_workspace_id) then
    raise exception 'not a workspace member';
  end if;

  with candidates as (
    select el.id, el.target_id as tag_id, el.source_kind, el.source_id,
           t.name as tag_name, coalesce(el.context_text, '') as ctx,
           case el.source_kind
             when 'card' then (
               select coalesce(ci.title, '') || ' ' || coalesce(ci.body, '')
                 from card_index ci
                where ci.card_id = el.source_id
                  and ci.workspace_id = p_workspace_id
                limit 1
             )
             when 'group' then (
               select coalesce(gi.name, '')
                 from group_index gi
                where gi.group_id = el.source_id
                  and gi.board_id = el.source_board_id
                limit 1
             )
             when 'board' then (
               select coalesce(b.name, '')
                 from boards b
                where b.id::text = el.source_id
                  and b.workspace_id = p_workspace_id
                limit 1
             )
             when 'doc' then (
               select coalesce(dpi.page_title, '') || ' ' || coalesce(dpi.page_text, '')
                 from doc_page_index dpi
                where dpi.doc_card_id = el.source_id
                  and (el.source_page_id is null
                       or dpi.page_id::text = el.source_page_id)
                  and dpi.workspace_id = p_workspace_id
                limit 1
             )
             else ''
           end as src_text
      from entity_links el
      join tags t on t.id = el.target_id
     where el.target_kind = 'tag'
       and el.link_kind = 'applied'
       and el.source in ('ai', 'auto', 'auto-paragraph', 'auto-doc', 'auto-board', 'auto-card', 'auto-group')
       and el.source_workspace = p_workspace_id
       and t.workspace_id = p_workspace_id
  ),
  bogus as (
    select c.id, c.tag_id, c.source_kind, c.source_id
      from candidates c
     where (
       select count(*)
         from regexp_split_to_table(lower(c.tag_name), '[^a-z0-9]+') tok
        where char_length(tok) >= 4
     ) > 0
       and not exists (
         select 1
           from regexp_split_to_table(lower(c.tag_name), '[^a-z0-9]+') tok
          where char_length(tok) >= 4
            and (
              position(tok in lower(c.ctx)) > 0
              or position(tok in lower(coalesce(c.src_text, ''))) > 0
            )
       )
  ),
  ignored_inserts as (
    insert into autotag_ignored (workspace_id, target_kind, target_id, tag_id)
    select p_workspace_id, b.source_kind, b.source_id, b.tag_id
      from bogus b
    on conflict (workspace_id, target_kind, target_id, tag_id) do nothing
    returning 1
  ),
  deletions as (
    delete from entity_links el
     where el.id in (select id from bogus)
    returning 1
  )
  select count(*) into total from deletions;

  return coalesce(total, 0);
end;
$$;
revoke all on function purge_bogus_autoapplied_tags(uuid) from public;
grant execute on function purge_bogus_autoapplied_tags(uuid) to authenticated;

------------------------------------------------------------------
-- FIX 4 — SERVER-SIDE 100-CARD CAP FOR DEMO OWNERS
------------------------------------------------------------------
-- BEFORE INSERT on card_index. Blocks when the board's owner
-- (boards.created_by, matching the AFTER-counter semantics in 0065) is tier
-- 'demo' and already owns >= 100 cards across boards they created.
--
-- Implementation notes:
--   * Re-syncs upsert the whole board (ON CONFLICT DO UPDATE). BEFORE INSERT
--     fires for every proposed row, even rows that resolve to UPDATE, so we
--     skip rows whose (board_id, card_id) already exists — only genuinely
--     new cards count toward the cap (mirrors the AFTER-insert counter, which
--     fires only for true inserts).
--   * We COUNT real rows rather than reading the cached demo_card_count: the
--     AFTER counter fires at end-of-statement, so within a single multi-row
--     insert every row would otherwise read the same stale cached value and
--     a batch could overshoot. A COUNT sees rows inserted earlier in the same
--     statement, so the cap holds at exactly 100 even for batch upserts.
--   * Edge case (intentional, consistent with the 0065 counter): cards on a
--     board owned by a NON-demo collaborator are neither counted nor blocked.
create or replace function public.enforce_demo_card_cap_trg()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_tier  text;
  v_count integer;
begin
  -- Existing card being re-synced -> not a new card, never blocked.
  if exists (
    select 1 from public.card_index
     where board_id = new.board_id and card_id = new.card_id
  ) then
    return new;
  end if;

  v_owner := public.board_owner(new.board_id);
  if v_owner is null then
    return new;
  end if;

  select tier into v_tier from public.profiles where user_id = v_owner;
  if v_tier is distinct from 'demo' then
    return new;  -- only demo owners are capped
  end if;

  select count(*) into v_count
    from public.card_index ci
    join public.boards b on b.id = ci.board_id
   where b.created_by = v_owner;

  if v_count >= 100 then
    raise exception
      'Demo accounts are limited to 100 cards. Upgrade to a paid plan to add more.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- Trigger functions are invoked by the trigger mechanism (as the table
-- owner) regardless of EXECUTE grants, so revoke the default PUBLIC grant
-- to keep it off the PostgREST RPC surface.
revoke all on function public.enforce_demo_card_cap_trg() from public, anon, authenticated;

drop trigger if exists card_index_demo_cap_ins on public.card_index;
create trigger card_index_demo_cap_ins
  before insert on public.card_index
  for each row execute function public.enforce_demo_card_cap_trg();
