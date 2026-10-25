-- 0540: Teams, part 11 — what setup and the domain check read (S4).
--
-- STATUS: written 2026-10-25, not applied.
--
-- Two reads the real Team surfaces need (plan
-- docs/superpowers/plans/2026-10-25-team-s4-team-page.md, Task 1):
--   * preview_team_seats: setup's "N people edit these workspaces today",
--     counted by start_team_checkout's own way (0538): make the team and move
--     the picked workspaces in inside a savepoint, read the seats it would
--     use, undo. The same refusals in the same order, so what setup shows is
--     what checkout will ask for.
--   * team_domain_challenge: the TXT record an owner or admin is asked to
--     publish. The Worker's domain check (POST /api/team/domain-check) calls
--     it with the caller's own token, so the database, not the Worker, says
--     who may check a domain; only then does the Worker mark it verified with
--     the service role (team_domain_mark_verified, 0534).
-- Both are new; nothing live is re-emitted. While teams are closed,
-- preview_team_seats refuses everyone but a test owner (teams_closed).

begin;
set local lock_timeout = '3s';

-- ── 1. Setup's seat count ───────────────────────────────────────────────────

-- The seats a new team needs for these workspaces: at least 3, else every
-- person who can edit in them (the owner, members, guests, pending editor
-- invites; _team_seats_used, 0531). Past the seat ceiling the move-in
-- refuses with team_seats_ceiling, as checkout would. Writes only inside the
-- savepoint (hence volatile), so nothing it makes outlives the call.
create or replace function public.preview_team_seats(p_workspace_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_ws   uuid[] := '{}';
  v_w    uuid;
  v_org  uuid;
  v_need integer := 3;
begin
  if v_uid is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  if not public._teams_open_for(v_uid) then
    raise exception 'teams are not open yet' using errcode = '42501', hint = 'teams_closed';
  end if;
  if exists (select 1 from public.organizations x where x.owner_id = v_uid and x.closed_at is null) then
    raise exception 'you already have a team' using errcode = '42501', hint = 'team_exists';
  end if;
  select coalesce(array_agg(distinct x), '{}'::uuid[]) into v_ws
    from unnest(coalesce(p_workspace_ids, '{}'::uuid[])) x where x is not null;
  if cardinality(v_ws) > 50 then
    raise exception 'pick at most 50 workspaces' using errcode = '22023';
  end if;
  foreach v_w in array v_ws loop
    if not exists (select 1 from public.workspaces w
                    where w.id = v_w and w.created_by = v_uid and w.org_id is null) then
      raise exception 'only your own personal workspaces can move into a team'
        using errcode = '42501', hint = 'team_workspace';
    end if;
  end loop;
  if cardinality(v_ws) = 0 then
    return v_need;
  end if;

  begin
    v_org := public._create_team_for(v_uid, 'Preview', null, 3);
    foreach v_w in array v_ws loop
      perform public._org_move_in(v_w, v_org, v_uid, true);
    end loop;
    v_need := greatest(3, public._team_seats_used(v_org));
    raise exception 'preview only' using errcode = 'SLPV0';
  exception when sqlstate 'SLPV0' then
    null;
  end;
  return v_need;
end;
$$;

-- ── 2. The domain check's challenge ─────────────────────────────────────────

-- The record to publish for one of the team's domains: a TXT on the domain
-- itself, soleil-verification=<token> (get_team shows the same pair, 0535).
create or replace function public.team_domain_challenge(p_org_id uuid, p_domain text)
returns table (txt_name text, txt_value text, verified boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  if not public._org_is_admin(p_org_id, v_uid) then
    raise exception 'only the team''s owner or an admin can do this' using errcode = '42501',
      hint = case when public._org_role(p_org_id, v_uid) is null then 'team_not_member' else 'team_not_admin' end;
  end if;
  return query
    select d.domain, 'soleil-verification=' || d.verify_token, d.verified_at is not null
      from public.org_domains d
      join public.organizations o on o.id = d.org_id and o.closed_at is null
     where d.org_id = p_org_id and d.domain = public._team_norm_domain(p_domain);
  if not found then
    raise exception 'that domain isn''t on this team' using errcode = 'P0002', hint = 'team_domain_missing';
  end if;
end;
$$;

revoke execute on function public.preview_team_seats(uuid[]) from public, anon;
revoke execute on function public.team_domain_challenge(uuid, text) from public, anon;
grant execute on function public.preview_team_seats(uuid[]) to authenticated;
grant execute on function public.team_domain_challenge(uuid, text) to authenticated;

-- ── 3. Proof ────────────────────────────────────────────────────────────────

do $$
declare
  v_fn text;
begin
  if to_regprocedure('public._create_team_for(uuid,text,text,integer)') is null
     or to_regprocedure('public._org_move_in(uuid,uuid,uuid,boolean)') is null
     or to_regprocedure('public._team_seats_used(uuid)') is null
     or to_regprocedure('public._team_norm_domain(text)') is null then
    raise exception '0540 needs 0531, 0532, 0534 and 0538 live first';
  end if;

  foreach v_fn in array array['public.preview_team_seats(uuid[])', 'public.team_domain_challenge(uuid,text)'] loop
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception '0540: % is callable signed out', v_fn;
    end if;
    if not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0540: % is not callable signed in', v_fn;
    end if;
  end loop;

  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
               and p.proname in ('preview_team_seats', 'team_domain_challenge')
              group by p.proname having count(*) > 1) then
    raise exception '0540: an overload exists (PGRST203)';
  end if;
end $$;

commit;
