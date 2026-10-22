-- 0609_webhooks_read_by_owner.sql
--
-- A webhook's address, events and deliveries are read by the workspace owner,
-- who alone adds, changes and removes webhooks (0401's webhook_create rule).
-- webhook_list, webhook_deliveries_page and webhook_deliveries_list now use
-- that same rule instead of workspace membership, so members, viewers and
-- service accounts see none. The API's test-delivery route looks the webhook
-- up through webhook_list, so it follows.
--
-- Bodies re-emitted from the live definitions; return shapes unchanged.

CREATE OR REPLACE FUNCTION public.webhook_list(p_workspace_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, workspace_id uuid, name text, url text, events text[], active boolean, failure_count integer, disabled_reason text, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  select w.id, w.workspace_id, w.name, w.url, w.events, w.active,
         w.failure_count, w.disabled_reason, w.created_at, w.updated_at
    from public.webhooks w
   where public.can_write_workspace(w.workspace_id)
     and exists (select 1 from public.workspaces ws
                  where ws.id = w.workspace_id and ws.created_by = auth.uid())
     and (p_workspace_id is null or w.workspace_id = p_workspace_id)
   order by w.created_at desc;
$function$;

CREATE OR REPLACE FUNCTION public.webhook_deliveries_page(p_webhook_id uuid, p_limit integer DEFAULT 50, p_cursor_ts timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, event text, status integer, attempt integer, response_ms integer, error text, created_at timestamp with time zone, delivered_at timestamp with time zone, next_attempt_at timestamp with time zone, payload jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  select d.id, d.event, d.status, d.attempt, d.response_ms, d.error,
         d.created_at, d.delivered_at, d.next_attempt_at, d.payload
    from public.webhook_deliveries d
    join public.webhooks w on w.id = d.webhook_id
   where d.webhook_id = p_webhook_id
     and public.can_write_workspace(w.workspace_id)
     and exists (select 1 from public.workspaces ws
                  where ws.id = w.workspace_id and ws.created_by = auth.uid())
     and (p_cursor_ts is null
          or d.created_at < p_cursor_ts
          or (p_cursor_id is not null and d.created_at = p_cursor_ts and d.id < p_cursor_id))
   order by d.created_at desc, d.id desc
   limit greatest(1, least(coalesce(p_limit, 50), 501));
$function$;

CREATE OR REPLACE FUNCTION public.webhook_deliveries_list(p_webhook_id uuid, p_limit integer DEFAULT 50, p_cursor timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(id uuid, event text, status integer, attempt integer, response_ms integer, error text, created_at timestamp with time zone, delivered_at timestamp with time zone, next_attempt_at timestamp with time zone, payload jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  select d.id, d.event, d.status, d.attempt, d.response_ms, d.error,
         d.created_at, d.delivered_at, d.next_attempt_at, d.payload
    from public.webhook_deliveries d join public.webhooks w on w.id = d.webhook_id
   where d.webhook_id = p_webhook_id
     and public.can_write_workspace(w.workspace_id)
     and exists (select 1 from public.workspaces ws
                  where ws.id = w.workspace_id and ws.created_by = auth.uid())
     and (p_cursor is null or d.created_at < p_cursor)
   order by d.created_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
$function$;

-- The 0311 habit: prove the grants, don't trust them.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.webhook_list(uuid)',
    'public.webhook_deliveries_page(uuid,integer,timestamp with time zone,uuid)',
    'public.webhook_deliveries_list(uuid,integer,timestamp with time zone)'
  ] loop
    if has_function_privilege('anon', f, 'EXECUTE')
       or not has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception '0609: % grants changed', f;
    end if;
  end loop;
end $$;
