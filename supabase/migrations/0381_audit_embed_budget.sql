-- 0381 — the embedding route spends against a daily budget (audit SE-3).
--
-- /api/tags/embed turns a signed-in request straight into OpenAI spend: up to
-- 64 texts of 8,000 characters a call, and nothing limited the calls. One
-- throwaway account in a loop could run the bill up for as long as it liked.
--
-- tags_embed_budget_take(p_chars) is asked before every call, with the
-- caller's own token, and answers yes or no. An account gets c_user_day
-- characters a day, and everyone together c_global_day — far above what
-- automatic tagging reads in a day, and a hard ceiling on what it can cost.
-- Using up the shared budget pages the owner once a day. The Worker spends only
-- on a yes, so an error here means no call, never an unmetered one.

begin;

create table if not exists public.embed_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null default current_date,
  chars   bigint not null default 0,
  primary key (user_id, day)
);
alter table public.embed_usage enable row level security;
revoke all on table public.embed_usage from public, anon, authenticated;

create or replace function public.tags_embed_budget_take(p_chars integer)
returns boolean
language plpgsql security definer
set search_path = public as $$
declare
  c_user_day   constant bigint := 2000000;
  c_global_day constant bigint := 20000000;
  v_uid  uuid := auth.uid();
  v_user bigint;
  v_all  bigint;
begin
  if v_uid is null or p_chars is null or p_chars < 0 or p_chars > 1000000 then
    return false;
  end if;
  if not public._actor_active() then
    return false;
  end if;
  -- One call at a time, so two can't both read "just under".
  perform pg_advisory_xact_lock(hashtext('embed_budget'));
  select coalesce(sum(u.chars), 0) into v_all from public.embed_usage u where u.day = current_date;
  if v_all + p_chars > c_global_day then
    perform public.ops_alert_raise('embed_budget',
      'Today''s embedding budget is used up',
      'Automatic tag suggestions stop until tomorrow (UTC). If one account used most of it, look at it in the Security tab.',
      true, 'embed_budget:' || current_date::text, interval '24 hours');
    return false;
  end if;
  select coalesce(max(u.chars), 0) into v_user from public.embed_usage u
   where u.user_id = v_uid and u.day = current_date;
  if v_user + p_chars > c_user_day then
    return false;
  end if;
  insert into public.embed_usage (user_id, day, chars) values (v_uid, current_date, p_chars)
  on conflict (user_id, day) do update set chars = public.embed_usage.chars + excluded.chars;
  return true;
end;
$$;

revoke execute on function public.tags_embed_budget_take(integer) from public, anon;
grant execute on function public.tags_embed_budget_take(integer) to authenticated;

create or replace function public.purge_old_embed_usage(p_days integer)
returns integer
language plpgsql security definer
set search_path = public as $$
declare v_n integer;
begin
  delete from public.embed_usage where day < current_date - p_days;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.purge_old_embed_usage(integer) from public, anon, authenticated;

select cron.schedule('purge-embed-usage', '31 3 * * *', $$select public.purge_old_embed_usage(30)$$);

-- ── Proofs ──────────────────────────────────────────────────────────────────

do $$
begin
  if has_function_privilege('anon', 'public.tags_embed_budget_take(integer)', 'execute')
     or not has_function_privilege('authenticated', 'public.tags_embed_budget_take(integer)', 'execute') then
    raise exception '0381: tags_embed_budget_take grants are wrong';
  end if;
  if has_function_privilege('authenticated', 'public.purge_old_embed_usage(integer)', 'execute') then
    raise exception '0381: purge_old_embed_usage is client-callable';
  end if;
  if has_table_privilege('authenticated', 'public.embed_usage', 'select')
     or has_table_privilege('authenticated', 'public.embed_usage', 'insert') then
    raise exception '0381: embed_usage is client-readable or writable';
  end if;
  if not exists (select 1 from cron.job where jobname = 'purge-embed-usage' and active) then
    raise exception '0381: the purge job is missing';
  end if;
end $$;

commit;
