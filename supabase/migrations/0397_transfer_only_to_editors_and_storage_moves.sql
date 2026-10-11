-- 0397 — A workspace can only be handed to someone who can edit it, and its
-- storage moves with it (audit DB-04 / SHARE-2, DB-06).
--
-- transfer_workspace_ownership checked only that the recipient was a member,
-- so the owner could hand the workspace to a viewer or a service account. The
-- old owner is demoted to editor in the same step, so a transfer to an
-- uncooperative viewer, or to an API bot that has no way to hand it back, was
-- irreversible. The recipient must now hold coowner, admin or editor: the
-- same people _deletion_heir (0388) will pass a workspace to.
--
-- The storage counter (storage_usage, keyed by owner) was not moved either, so
-- after a transfer the old owner was over-counted and the new owner
-- under-counted until reconcile_storage_usage at 03:55 UTC. The workspace's
-- live image bytes now move with it, in the same transaction.
--
-- Re-emitted from 0395's body: the 0371 suspend check, created_by-only, and
-- the best-effort 'workspace.ownership_received' notice are unchanged. create
-- or replace keeps the ACL; the block at the end proves it.

begin;

create or replace function public.transfer_workspace_ownership(p_workspace_id uuid, p_new_owner uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_old     uuid;
  v_name    text;
  v_tier    text;
  v_cap     integer;
  v_count   integer;
  v_role    text;
  v_bytes   bigint;
  v_objects bigint;
begin
  -- 0371: a suspended account acts on nothing.
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;
  -- A banned account's clusters stop serving, so it can't be handed one.
  if public._user_banned(p_new_owner) then
    raise exception 'that account cannot own a workspace' using errcode = '42501';
  end if;
  if p_new_owner = auth.uid() then
    raise exception 'cannot transfer ownership to yourself'
      using errcode = '22023';
  end if;

  select created_by, name into v_old, v_name from workspaces where id = p_workspace_id;
  if v_old is null then
    raise exception 'workspace % not found', p_workspace_id using errcode = '42704';
  end if;
  if v_old <> auth.uid() then
    raise exception 'only the current owner can transfer ownership'
      using errcode = '42501';
  end if;
  select role into v_role from workspace_members
   where workspace_id = p_workspace_id and user_id = p_new_owner;
  if v_role is null then
    raise exception 'new owner must already be a workspace member'
      using errcode = '42704';
  end if;
  -- 0397: only someone who can edit it. A viewer or a service account would
  -- receive a workspace they cannot run, from an owner just demoted to editor.
  if v_role not in ('coowner', 'admin', 'editor') then
    raise exception 'only an editor or co-owner can become the owner — make them an editor first'
      using errcode = '42501';
  end if;

  update workspaces set created_by = p_new_owner where id = p_workspace_id;
  update workspace_members set role = 'owner'
    where workspace_id = p_workspace_id and user_id = p_new_owner;
  update workspace_members set role = 'editor'
    where workspace_id = p_workspace_id and user_id = v_old;

  -- 0397: the workspace's stored files now count toward the new owner, as the
  -- nightly reconcile would decide; move them now rather than at 03:55 UTC.
  select coalesce(sum(i.size_bytes), 0)::bigint, count(*)::bigint
    into v_bytes, v_objects
    from public.images i
   where i.workspace_id = p_workspace_id and i.deleted_at is null;
  perform public._storage_usage_apply(v_old, -v_bytes, -v_objects);
  perform public._storage_usage_apply(p_new_owner, v_bytes, v_objects);

  -- 0395: tell the new owner, with their own numbers (counted AFTER the
  -- hand-over, so this workspace is included). Only the free plan has a card
  -- cap (enforce_demo_card_cap_trg), so only it gets numbers.
  begin
    select coalesce(p.tier, 'demo'), coalesce(p.card_cap_base, 50) + coalesce(p.bonus_card_credits, 0)
      into v_tier, v_cap
      from public.profiles p where p.user_id = p_new_owner;
    v_tier  := coalesce(v_tier, 'demo');
    v_cap   := coalesce(v_cap, 50);
    v_count := public._owner_card_count(p_new_owner);

    insert into public.notifications (user_id, kind, workspace_id, actor_id, title, body, data)
    values (
      p_new_owner,
      'workspace.ownership_received',
      p_workspace_id,
      auth.uid(),
      format('You now own "%s"', coalesce(nullif(btrim(v_name), ''), 'a workspace')),
      case
        when v_tier = 'demo' and v_count > v_cap then
          format('Its cards, files and storage now count toward your plan. You''re at %s of %s cards, so no new cards can be added to workspaces you own until you upgrade or clear space.', v_count, v_cap)
        when v_tier = 'demo' then
          format('Its cards, files and storage now count toward your plan. You''re at %s of %s cards.', v_count, v_cap)
        else
          'Its cards, files and storage now count toward your plan.'
      end,
      jsonb_build_object(
        'card_count', v_count,
        'card_limit', case when v_tier = 'demo' then v_cap end,
        'over_limit', (v_tier = 'demo' and v_count > v_cap)
      )
    );
  exception when others then
    raise warning 'transfer_workspace_ownership: could not notify the new owner of %: %', p_workspace_id, sqlerrm;
  end;
end;
$function$;

do $$
begin
  if has_function_privilege('anon', 'public.transfer_workspace_ownership(uuid,uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.transfer_workspace_ownership(uuid,uuid)', 'execute') then
    raise exception '0397: grants are wrong';
  end if;
end $$;

commit;
