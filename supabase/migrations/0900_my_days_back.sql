-- 0900: my_days_back() -- how many separate earlier days the signed-in person
-- used the app (user_active_day rows before today, UTC).
--
-- The app paces its unasked-for pop-ups by it (lib/popupPace.js): someone who
-- has been back many days needs no tips, and is asked for things less often.
-- Own rows only (auth.uid()); signed-out callers cannot run it.

create or replace function public.my_days_back()
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int
    from public.user_active_day
   where user_id = auth.uid()
     and day < current_date;
$$;

revoke execute on function public.my_days_back() from public, anon;
grant execute on function public.my_days_back() to authenticated;

do $$
declare
  v_fn regprocedure := 'public.my_days_back()'::regprocedure;
begin
  if has_function_privilege('anon', v_fn, 'execute')
     or not has_function_privilege('authenticated', v_fn, 'execute')
     or not has_function_privilege('service_role', v_fn, 'execute') then
    raise exception '0900: grants are wrong on my_days_back';
  end if;
end $$;
