-- 0219_pin_function_search_path.sql — pin search_path on the remaining
-- first-party functions, clearing the last of the security advisor's
-- function_search_path_mutable warnings.
--
-- SEVERITY: low, and worth being honest about why. A mutable search_path is a
-- privilege-escalation vector when the function is SECURITY DEFINER: an
-- attacker who can create objects in an earlier schema on the path can shadow a
-- name the function resolves, and it runs as the owner. Every one of the 22
-- functions here is SECURITY INVOKER — checked, not assumed — so they already
-- run with the caller's own rights and there is nothing to escalate to. Every
-- SECURITY DEFINER function in this schema already pins its path.
--
-- So this is hygiene, not a fix: it removes a standing advisor warning that
-- would otherwise sit alongside real ones and train us to ignore the list.
--
-- Scoped by pg_depend to first-party functions only. pg_trgm, vector and pgjwt
-- also install into public and also show up in the advisor, but they belong to
-- their extensions — altering them is the extension's business, not ours, and
-- would be reverted on the next extension upgrade anyway. (Moving those
-- extensions out of public was considered and rejected: it risks breaking index
-- operator-class resolution for a warning that carries no real exposure here.)
--
-- 'public', 'extensions' rather than a bare 'public' to match the convention
-- already used by the SECURITY DEFINER functions in this schema — several
-- resolve helpers out of the extensions schema.
--
-- Verified before applying by exercising a representative sample inside a
-- rolled-back transaction: the profiles and board counter triggers still fire
-- on a real UPDATE, and guess_entity_type / seo_referrer_class / b64_bytes /
-- _tag_slug_word_re all still resolve their names and return correctly.

do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and (p.proconfig is null
           or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
      -- Extension-owned functions are not ours to alter.
      and not exists (
        select 1 from pg_depend d
        join pg_extension e on e.oid = d.refobjid
        where d.objid = p.oid and d.deptype = 'e'
      )
  loop
    execute format('alter function %s set search_path to ''public'', ''extensions''', r.sig);
    n := n + 1;
  end loop;

  raise notice '0219: pinned search_path on % function(s)', n;
end $$;
