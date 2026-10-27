-- 0544: Teams, part 15 — 0188's free-editor brake goes (S5).
--
-- STATUS: written 2026-10-27. NOT applied. Apply with the launch, after 0543,
-- on the owner's go. If the MCP refuses a DROP, the owner runs this file in the
-- SQL editor as it is. It did refuse (2026-10-27, twice, after 0543), so the
-- owner runs it; until then the brake stays dormant, and nothing calls it.
--
-- 0188 kept a dormant cap on editor shares (_collab_editor_cap, set through
-- admin_set_collab_editor_cap, stored in app_config.collab_free_editor_cap,
-- never switched on). 0521 took it out of the doors it guarded: the 10-editor
-- limit (0520) is the rule now. Nothing calls it; the check below refuses to
-- drop it if anything does.

begin;
set local lock_timeout = '3s';

do $$
begin
  if exists (select 1 from pg_proc q
              where q.pronamespace = 'public'::regnamespace
                and q.proname not in ('_collab_editor_cap', 'admin_set_collab_editor_cap')
                and (q.prosrc ilike '%collab_editor_cap%' or q.prosrc ilike '%collab_free_editor_cap%')) then
    raise exception '0544: a function still uses 0188''s brake';
  end if;
end $$;

drop function if exists public._collab_editor_cap();
drop function if exists public.admin_set_collab_editor_cap(integer);
delete from public.app_config where key = 'collab_free_editor_cap';

-- ── Proof ───────────────────────────────────────────────────────────────────

do $$
begin
  if to_regprocedure('public._collab_editor_cap()') is not null
     or to_regprocedure('public.admin_set_collab_editor_cap(integer)') is not null
     or exists (select 1 from public.app_config where key = 'collab_free_editor_cap') then
    raise exception '0544: 0188''s brake is still there';
  end if;
end $$;

commit;
