-- 0305_revoke_public_execute_admin_rpcs.sql
--
-- 0304 revoked EXECUTE on the admin_* and internal helper functions FROM anon,
-- and it mostly worked -- 91 anon-callable admin_* functions dropped to 10.
-- The 10 survivors are the interesting part, and the reason this migration
-- exists.
--
-- Their ACLs look like this:
--
--   {=X/postgres, postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres}
--    ^^^^^^^^^^^
--
-- A grantee-less entry is PUBLIC. Postgres grants EXECUTE to PUBLIC by default
-- on every newly created function, and `anon` -- like every role -- inherits
-- from PUBLIC. So `revoke execute ... from anon` removes a grant that was never
-- the one doing the work, and has_function_privilege('anon', ...) still
-- answers true. The revoke reports success and changes nothing.
--
-- This is the mirror of a trap this repo has already hit once: 0264 recorded
-- that `revoke ... from public` does NOT cover `anon` (because Supabase grants
-- anon explicitly). Both directions are true, and neither revoke implies the
-- other. When closing a surface, check the resolved answer from
-- has_function_privilege(), never the fact that a REVOKE statement succeeded.
--
-- Safety precondition, asserted below rather than assumed: every function
-- targeted here also holds an EXPLICIT `authenticated=X` grant, so dropping the
-- PUBLIC entry leaves signed-in admins entirely unaffected. Verified for all 40
-- targets before applying. Functions that are legitimately anon-callable
-- (get_share_bundle, get_public_board_*, list_public_boards, ...) are not in
-- the admin_*/_* name space and are not touched.

do $$
declare
  r record;
  v_unsafe int;
begin
  -- Refuse to run if any target would lose its only path for signed-in callers.
  select count(*) into v_unsafe
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and p.prokind = 'f'
    and p.proacl is not null
    and exists (select 1 from unnest(p.proacl::text[]) a where a like '=%')
    and (p.proname like 'admin\_%' or p.proname like '\_%')
    and not exists (select 1 from unnest(p.proacl::text[]) a where a like 'authenticated=%');

  if v_unsafe > 0 then
    raise exception
      'refusing to revoke PUBLIC: % admin/internal function(s) have no explicit authenticated grant', v_unsafe;
  end if;

  for r in
    select format('%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid)) as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.prokind = 'f'
      and p.proacl is not null
      and exists (select 1 from unnest(p.proacl::text[]) a where a like '=%')
      and (p.proname like 'admin\_%' or p.proname like '\_%')
  loop
    execute format('revoke execute on function public.%s from public', r.sig);
    -- belt and braces: anon may also hold an explicit entry
    execute format('revoke execute on function public.%s from anon', r.sig);
  end loop;
end $$;

-- Post-condition: no admin_* function may be reachable by anon by any path.
do $$
declare v_left int;
begin
  select count(*) into v_left
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and p.prokind = 'f'
    and p.proname like 'admin\_%'
    and has_function_privilege('anon', p.oid, 'execute');

  if v_left > 0 then
    raise exception 'still % admin_* function(s) executable by anon', v_left;
  end if;
end $$;
