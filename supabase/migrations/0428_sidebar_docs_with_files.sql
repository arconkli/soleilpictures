-- 0428 — Docs sit with files in the files sidebar (0419)
--
-- The sidebar is still held to the preview build. It now lists files and sums
-- up everything else with one closed heading per kind (Notes, Links, Other),
-- because the files tab should be files (owner, 2026-10-18). A doc is a file
-- people write — a script, a treatment, a shot list — so it moves off the
-- 'writing' shelf, which keeps the notes, onto 'files' with PDFs and uploads.
--
-- Only the mapping changes. Every sidebar_ function reads a card's shelf
-- through sidebar_shelf_of, so counts, pages, Recent and Starred all follow it.
-- The client twin is SHELF_OF_KIND in boards/src/lib/sidebarShelves.js;
-- sidebarShelves.test.mjs reads the newest definition of this function in the
-- migrations and fails when the two disagree. `create or replace` keeps 0419's
-- grants (signed-in only); the block below proves them.

create or replace function public.sidebar_shelf_of(p_kind text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_kind = 'image' then 'photos'
    when p_kind = 'video' then 'video'
    when p_kind = 'audio' then 'audio'
    when p_kind in ('pdf', 'file', 'doc') then 'files'
    when p_kind = 'note' then 'writing'
    when p_kind = 'link' then 'links'
    when p_kind in ('board', 'boardlink') then null
    else 'more'
  end
$$;

-- ── Prove it ─────────────────────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('anon', 'public.sidebar_shelf_of(text)', 'execute') then
    raise exception '0428: sidebar_shelf_of is callable signed out';
  end if;
  if not has_function_privilege('authenticated', 'public.sidebar_shelf_of(text)', 'execute') then
    raise exception '0428: sidebar_shelf_of is not callable by a signed-in user';
  end if;
  if public.sidebar_shelf_of('doc') is distinct from 'files'
     or public.sidebar_shelf_of('note') is distinct from 'writing' then
    raise exception '0428: docs did not move onto the files shelf';
  end if;
end $$;
