-- 0401 — Only the workspace owner manages its webhooks (audit API-14).
--
-- 0391's header says "service accounts, webhooks and workspace rewind stay
-- owner-only", but webhook_create / _update / _delete / _redeliver gated only
-- on can_write_workspace. Any editor (or co-owner) could add a webhook, point
-- the owner's at an address of their choosing, or delete it, and the owner
-- was never told: a webhook carries every event in the workspace, so where it
-- sends them is the owner's decision. Each function now also requires
-- created_by = auth.uid(); can_write_workspace stays in front of it, so a
-- suspended or waitlisted owner is still refused. No webhook exists today, so
-- nothing anyone set up stops working.
--
-- Re-emitted from the live bodies (0375's _refuse_if_new gates unchanged).
-- Same signatures, so create or replace keeps the ACLs; the block proves them.

begin;

create or replace function public.webhook_create(p_workspace_id uuid, p_url text, p_events text[], p_name text default null::text)
returns table(id uuid, secret text, created_at timestamp with time zone)
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare v_secret text; v_id uuid;
begin
  if not public.can_write_workspace(p_workspace_id) then
    raise exception 'you cannot add a webhook to this workspace' using errcode = '42501';
  end if;
  -- 0401: a webhook sends every event in the workspace; the owner decides where.
  if not exists (select 1 from public.workspaces ws
                  where ws.id = p_workspace_id and ws.created_by = auth.uid()) then
    raise exception 'only the workspace owner can add webhooks' using errcode = '42501';
  end if;
  -- 0375: not in an account's first three days.
  perform public._refuse_if_new('Adding a webhook');
  if (select count(*) from public.webhooks w
       where w.workspace_id = p_workspace_id and w.active) >= 20 then
    raise exception 'a workspace may have at most 20 active webhooks' using errcode = '54000';
  end if;
  v_secret := 'whsec_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.webhooks (workspace_id, url, events, secret, name, created_by)
  values (p_workspace_id, p_url, p_events, v_secret, left(nullif(btrim(p_name),''), 80), auth.uid())
  returning webhooks.id into v_id;
  return query select v_id, v_secret, now();
end;
$function$;

create or replace function public.webhook_update(p_id uuid, p_url text default null::text, p_events text[] default null::text[], p_name text default null::text, p_active boolean default null::boolean)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare v_ws uuid;
begin
  select w.workspace_id into v_ws from public.webhooks w where w.id = p_id;
  if v_ws is null then return false; end if;
  if not public.can_write_workspace(v_ws)
     or not exists (select 1 from public.workspaces ws where ws.id = v_ws and ws.created_by = auth.uid()) then
    raise exception 'not your webhook' using errcode = '42501';
  end if;
  -- 0375: pointing a workspace's events somewhere new is adding a webhook.
  if p_url is not null then
    perform public._refuse_if_new('Pointing a webhook at a new address');
  end if;
  update public.webhooks w
     set url    = coalesce(p_url, w.url),
         events = coalesce(p_events, w.events),
         name   = coalesce(nullif(btrim(p_name), ''), w.name),
         active = coalesce(p_active, w.active),
         failure_count   = case when p_active then 0 else w.failure_count end,
         disabled_reason = case when p_active then null else w.disabled_reason end,
         updated_at = now()
   where w.id = p_id;
  return true;
end;
$function$;

create or replace function public.webhook_delete(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare v_ws uuid;
begin
  select w.workspace_id into v_ws from public.webhooks w where w.id = p_id;
  if v_ws is null then return false; end if;
  if not public.can_write_workspace(v_ws)
     or not exists (select 1 from public.workspaces ws where ws.id = v_ws and ws.created_by = auth.uid()) then
    raise exception 'not your webhook' using errcode = '42501';
  end if;
  delete from public.webhooks w where w.id = p_id;
  return true;
end;
$function$;

create or replace function public.webhook_redeliver(p_delivery_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare v_ws uuid;
begin
  select w.workspace_id into v_ws
    from public.webhook_deliveries d join public.webhooks w on w.id = d.webhook_id
   where d.id = p_delivery_id;
  if v_ws is null then return false; end if;
  if not public.can_write_workspace(v_ws)
     or not exists (select 1 from public.workspaces ws where ws.id = v_ws and ws.created_by = auth.uid()) then
    raise exception 'not your webhook' using errcode = '42501';
  end if;
  update public.webhook_deliveries d
     set delivered_at = null, next_attempt_at = now(), attempt = 0, error = null
   where d.id = p_delivery_id;
  return true;
end;
$function$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.webhook_create(uuid,text,text[],text)',
    'public.webhook_update(uuid,text,text[],text,boolean)',
    'public.webhook_delete(uuid)',
    'public.webhook_redeliver(uuid)'
  ] loop
    if has_function_privilege('anon', f, 'execute')
       or not has_function_privilege('authenticated', f, 'execute') then
      raise exception '0401: grants are wrong on %', f;
    end if;
  end loop;
end $$;

commit;
