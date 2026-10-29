-- 0709 — the draft reaper takes drafts that are newly due before identities
-- still waiting.
--
-- mcp_draft_reap (0705) hands back two kinds of row: a draft newly due (kept,
-- or expired) whose workspace it clears now, and an earlier-reaped draft whose
-- auth user the Worker hasn't deleted yet. It sorted both by one date, and a
-- waiting identity's date (its reaped_at) is always older than anything newly
-- due, so a backlog of identities filled the whole limit and a draft that had
-- just expired was never reached until the backlog cleared. Newly due rows now
-- come first; the waiting identities follow, oldest first, as before.
--
-- Only the ORDER BY changes. CREATE OR REPLACE keeps the function's ACL, and
-- the block at the end proves it.

create or replace function public.mcp_draft_reap(p_limit integer default 25)
returns table (draft_id uuid, user_id uuid, outcome text)
language plpgsql security definer
set search_path = public
as $$
declare
  d record;
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 200));
begin
  for d in
    select m.* from public.mcp_drafts m
     where (m.reaped_at is null and (m.claimed_at is not null or m.expires_at <= now()))
        or (m.reaped_at is not null and m.user_id is not null)
     order by (m.reaped_at is not null), coalesce(m.reaped_at, m.claimed_at, m.expires_at)
     limit v_limit
     for update skip locked
  loop
    if d.reaped_at is null then
      if d.claimed_at is null and d.workspace_id is not null then
        delete from public.workspaces w
         where w.id = d.workspace_id and w.created_by is not distinct from d.user_id;
      end if;
      -- The subject stays: a ChatGPT user whose draft was kept is still told
      -- to connect their account, rather than handed a fresh draft.
      update public.mcp_drafts m set reaped_at = now() where m.id = d.id;
    end if;
    draft_id := d.id;
    user_id  := d.user_id;
    outcome  := case when d.claimed_at is null then 'expired' else 'kept' end;
    return next;
  end loop;

  delete from public.mcp_drafts m where m.reaped_at < now() - interval '90 days' and m.user_id is null;
end;
$$;
revoke execute on function public.mcp_draft_reap(integer) from public, anon, authenticated;

-- The 0311 habit: prove the grants.
do $$
begin
  if has_function_privilege('anon', 'public.mcp_draft_reap(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.mcp_draft_reap(integer)', 'execute') then
    raise exception '0709: mcp_draft_reap is callable by a client';
  end if;
  if not has_function_privilege('service_role', 'public.mcp_draft_reap(integer)', 'execute') then
    raise exception '0709: the Worker (service_role) cannot run mcp_draft_reap';
  end if;
end;
$$;
