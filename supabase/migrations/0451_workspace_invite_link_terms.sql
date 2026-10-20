-- 0451 — what a workspace invite link does, for the people who can share it.
--
-- create_workspace_invite_link (0450) returns only the token. Everywhere the
-- link is offered says what it does ("Anyone with the link can join Lost Time
-- and edit. It works for 7 days, for up to 5 people."), and those terms are
-- tighter for an account under three days old (_account_is_new, 0375), which
-- is everyone the first-run setup serves. So they are read from the link's
-- row, never typed into the client.
--
-- Only the owner or a co-owner of the link's workspace gets an answer. Anyone
-- else gets no row, the same as for a token that doesn't exist. Applied ahead
-- of the client, like 0450; nothing outside the preview calls it yet.

begin;

create or replace function public.get_workspace_invite_link_terms(p_token uuid)
returns table (role text, expires_at timestamptz, max_uses integer, uses integer, live boolean)
language plpgsql stable security definer
set search_path = public as $$
declare
  v_link public.workspace_invite_links;
begin
  if auth.uid() is null or not public._actor_active() then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  select * into v_link from public.workspace_invite_links l where l.token = p_token;
  if not found or not public.can_manage_workspace(v_link.workspace_id) then
    return;
  end if;
  return query
    select v_link.role, v_link.expires_at, v_link.max_uses,
           (select count(*)::integer from public.workspace_invite_link_joins j where j.token = v_link.token),
           public._workspace_invite_link_live(v_link.token);
end;
$$;

revoke all on function public.get_workspace_invite_link_terms(uuid) from public, anon;
grant execute on function public.get_workspace_invite_link_terms(uuid) to authenticated, service_role;

-- ── Proof ───────────────────────────────────────────────────────────────────

do $$
declare
  v_src text;
begin
  if has_function_privilege('anon', 'public.get_workspace_invite_link_terms(uuid)', 'execute') then
    raise exception '0451: a link''s terms are readable signed out';
  end if;
  if not has_function_privilege('authenticated', 'public.get_workspace_invite_link_terms(uuid)', 'execute') then
    raise exception '0451: a link''s terms are not readable signed in';
  end if;
  select prosrc into v_src from pg_proc where oid = 'public.get_workspace_invite_link_terms(uuid)'::regprocedure;
  if position('public.can_manage_workspace(v_link.workspace_id)' in v_src) = 0 then
    raise exception '0451: a link''s terms are not limited to its workspace''s managers';
  end if;
  if position('public._actor_active()' in v_src) = 0 then
    raise exception '0451: a suspended account can read a link''s terms';
  end if;
end $$;

commit;
