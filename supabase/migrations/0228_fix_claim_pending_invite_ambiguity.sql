-- 0228 — claim_pending_invite: clicking the magic link in an invite email has
-- never worked. Same bug 0199 fixed in claim_collab_link, in the sibling that
-- was left behind.
--
--   claim_pending_invite: board invite     → FAILS: column reference "board_id" is ambiguous
--   claim_pending_invite: workspace invite → FAILS: column reference "workspace_id" is ambiguous
--
-- The function is declared RETURNS TABLE(workspace_id uuid, board_id uuid).
-- Those OUT parameters are in scope for the whole body, so the bare column
-- names in
--     insert into board_shares (board_id, user_id, …)      on conflict (board_id, user_id)
--     insert into workspace_members (workspace_id, user_id, …) on conflict (workspace_id, user_id)
-- are ambiguous between the OUT parameter and the table column, and plpgsql
-- refuses to guess (42702). Both branches raise, so BOTH kinds of email invite
-- die at the claim.
--
-- Why this went unnoticed: _claim_pending_invites_for_user — the backstop the
-- auth.users INSERT trigger calls at signup — returns integer, has no
-- colliding OUT parameters, and works. It quietly claimed invites for anyone
-- who signed up with the invited address, so the ledger showed claimed rows
-- while the actual /?invite=<token> path raised every time.
--
-- Fix is 0199's, verbatim: #variable_conflict use_column, so an unqualified
-- name resolves to the COLUMN. Every reference meant as a variable in this
-- body is already qualified through v_row, so nothing else changes. The rest
-- of the body is reproduced verbatim from the live definition (drift-aware:
-- 0086 → 0189).
--
-- Verify (rolled back): seed a pending_invites row for a user's own email,
-- call claim_pending_invite as that user, and assert a board_shares /
-- workspace_members row appears and claimed_at/claimed_by get stamped.
--
-- Applied via Supabase MCP.

create or replace function public.claim_pending_invite(p_token uuid)
returns table(workspace_id uuid, board_id uuid)
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
#variable_conflict use_column
declare
  v_row           pending_invites%rowtype;
  v_caller_email  text;
  v_fresh         boolean := false;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to claim invite' using errcode = '42501';
  end if;

  select email into v_caller_email from auth.users where id = auth.uid();

  select * into v_row from pending_invites where token = p_token;
  if not found then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;

  if v_row.expires_at <= now() then
    raise exception 'invite has expired' using errcode = '22023';
  end if;

  if lower(v_row.email) <> lower(coalesce(v_caller_email, '')) then
    raise exception 'this invite is for a different email' using errcode = '42501';
  end if;

  if v_row.claimed_at is not null and v_row.claimed_by is distinct from auth.uid() then
    raise exception 'invite already claimed' using errcode = '22023';
  end if;

  v_fresh := v_row.claimed_at is null;

  if v_row.board_id is not null then
    insert into board_shares (board_id, user_id, role, invited_by)
    values (v_row.board_id, auth.uid(),
            case when v_row.role = 'editor' then 'editor' else 'viewer' end,
            v_row.invited_by)
    on conflict (board_id, user_id) do nothing;
  else
    insert into workspace_members (workspace_id, user_id, role)
    values (v_row.workspace_id, auth.uid(),
            case when v_row.role = 'viewer' then 'viewer' else 'editor' end)
    on conflict (workspace_id, user_id) do nothing;
  end if;

  update pending_invites
     set claimed_at = coalesce(claimed_at, now()),
         claimed_by = coalesce(claimed_by, auth.uid())
   where id = v_row.id;

  if v_fresh then
    perform public._joined_notification(
      v_row.invited_by, v_row.board_id, v_row.workspace_id, v_row.role, auth.uid());
  end if;

  return query select v_row.workspace_id, v_row.board_id;
end;
$function$;
