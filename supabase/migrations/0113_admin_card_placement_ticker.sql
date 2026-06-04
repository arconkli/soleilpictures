-- 0113_admin_card_placement_ticker.sql
--
-- Powers the admin Universe Command Center's LIVE card-placement ticker.
-- The client logs a `card_placed` analytics event at placement time (it's the
-- only place the placing user is known). To stream those to the admin in real
-- time we put analytics_events in the realtime publication — its existing
-- admin-only SELECT RLS means only admins can subscribe to the change feed.
-- The RPC backfills the ticker on open so it isn't empty before the first live
-- event arrives.

-- Stream analytics_events INSERTs over Supabase Realtime (admin-RLS-gated).
alter publication supabase_realtime add table public.analytics_events;

-- Recent card placements, newest first, with the placer's email resolved.
create or replace function public.admin_recent_card_placements(p_limit int default 20)
 returns table(occurred_at timestamptz, user_id uuid, email text, actor text, kind text, n int, board_id uuid, workspace_id uuid)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
#variable_conflict use_column
begin
  perform public._require_admin();
  p_limit := greatest(1, least(p_limit, 100));
  return query
  select e.occurred_at, e.user_id, u.email::text as email,
         e.props->>'actor' as actor, e.props->>'kind' as kind,
         coalesce((e.props->>'n')::int, 1) as n,
         nullif(e.props->>'board_id', '')::uuid as board_id,
         nullif(e.props->>'workspace_id', '')::uuid as workspace_id
    from public.analytics_events e
    left join auth.users u on u.id = e.user_id
   where e.event = 'card_placed'
   order by e.occurred_at desc
   limit p_limit;
end $function$;
revoke all on function public.admin_recent_card_placements(int) from public;
grant execute on function public.admin_recent_card_placements(int) to authenticated;
