-- 0112_admin_feedback_search.sql
--
-- Add a search term to the feedback list so the admin Feedback tab can filter
-- by message/email text (it already paginates via p_limit/p_offset). Waitlist
-- search + pagination is done client-side (it reads waitlist_entries directly),
-- so only this one RPC needs a server change.
--
-- Arg count changes (adds p_q), so DROP before CREATE to avoid an ambiguous
-- overload. Existing 3-named-arg callers keep working (p_q defaults null).

drop function if exists public.admin_list_feedback(integer, integer, text);
create or replace function public.admin_list_feedback(
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0,
  p_kind text DEFAULT NULL::text,
  p_q text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, user_id uuid, email text, kind text, message text, url text, viewport text, user_agent text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare v_q text := nullif(trim(coalesce(p_q, '')), '');
begin
  perform public._require_admin();
  p_limit  := greatest(1, least(p_limit, 500));
  p_offset := greatest(0, p_offset);
  return query
  select f.id, f.user_id, u.email::text, f.kind, f.message, f.url, f.viewport, f.user_agent, f.created_at
    from public.feedback f
    left join auth.users u on u.id = f.user_id
   where (p_kind is null or f.kind = p_kind)
     and (v_q is null or f.message ilike '%' || v_q || '%' or u.email ilike '%' || v_q || '%')
   order by f.created_at desc
   limit p_limit offset p_offset;
end $function$;
revoke all on function public.admin_list_feedback(integer, integer, text, text) from public;
grant execute on function public.admin_list_feedback(integer, integer, text, text) to authenticated;
