-- 0505 — The Command Center's Content mix counts the cards that exist.
--
-- The panel read admin_card_stats(365, false): every card made in the last
-- twelve months, the ones on trashed clusters included. The Cards figure on the
-- same wall (admin_universe_stats.total_cards, 0460) counts the cards on
-- clusters that are not trashed, so the panel's total was a second, larger card
-- count, and the two differed by exactly the trashed clusters' cards.
--
-- admin_live_card_mix() is total_cards' own population, by kind: card_index
-- joined to boards where the cluster is not trashed. The wall polls it once a
-- minute. admin_universe_stats is left alone: the party worker reads it every
-- second for every open Universe, and a per-kind count there would be paid for
-- every second just to feed a panel that is read once a minute.
--
-- New, so it is born with the 0311 grants. The revoke and grant restate them,
-- and the proof checks what actually holds.

begin;

set local lock_timeout = '3s';

create or replace function public.admin_live_card_mix()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_out jsonb;
begin
  perform public._require_admin();

  select jsonb_build_object(
           'total',   coalesce(sum(k.n), 0)::bigint,
           'by_kind', coalesce(jsonb_object_agg(k.kind, k.n), '{}'::jsonb)
         )
    into v_out
    from (select ci.kind, count(*) as n
            from public.card_index ci
            join public.boards b on b.id = ci.board_id
           where b.deleted_at is null
           group by ci.kind) k;

  return v_out;
end $function$;

comment on function public.admin_live_card_mix() is
  'Command Center › Content mix (0505): cards on clusters that are not trashed, by kind, with their total. The same population as admin_universe_stats().total_cards, so the panel and the Cards figure agree.';

revoke execute on function public.admin_live_card_mix() from public, anon;
grant execute on function public.admin_live_card_mix() to authenticated, service_role;

-- ── Proof ───────────────────────────────────────────────────────────────────
do $proof$
declare
  v_sig constant text := 'public.admin_live_card_mix()';
  v_def text;
begin
  if to_regprocedure(v_sig) is null then
    raise exception '0505: % is missing', v_sig;
  end if;
  if has_function_privilege('anon', v_sig, 'execute') then
    raise exception '0505: % is reachable signed out', v_sig;
  end if;
  if not has_function_privilege('authenticated', v_sig, 'execute')
     or not has_function_privilege('service_role', v_sig, 'execute') then
    raise exception '0505: % lost its grant', v_sig;
  end if;
  v_def := pg_get_functiondef(v_sig::regprocedure);
  if v_def not like '%perform public._require_admin();%'
     or v_def not like '%where b.deleted_at is null%' then
    raise exception '0505: % lost its gate or its live-cluster rule', v_sig;
  end if;
end $proof$;

notify pgrst, 'reload schema';

commit;
