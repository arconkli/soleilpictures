-- 0357 — images.source_url: where a saved web image came from.
--
-- An image dragged in from a web page used to stay a HOTLINK — the card
-- pointed at somebody else's server, and the board broke the day that page
-- moved, expired or put the image behind a login. POST /api/media/save-url
-- (boards/src/worker-media.js) now keeps a copy in the workspace's own storage.
-- This column records the page address it was fetched from, for two reasons:
--   · reuse — the same image dropped twice in one workspace is stored once;
--     the endpoint looks for an existing row by (workspace_id, source_url)
--     before it downloads anything, which is what the index below is for;
--   · provenance — a saved copy should still say where it came from.
--
-- Null for everything that was uploaded from a disk.
--
-- APPLY BEFORE THE WORKER THAT WRITES IT (the shared DB means: before the
-- preview deploy).

alter table public.images add column if not exists source_url text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'images_source_url_len') then
    alter table public.images add constraint images_source_url_len
      check (source_url is null or char_length(source_url) <= 2000);
  end if;
end $$;

create index if not exists images_workspace_source_url_idx
  on public.images (workspace_id, source_url)
  where source_url is not null and deleted_at is null;

comment on column public.images.source_url is
  'The http(s) address a saved web image was fetched from (worker-media.js). Null for uploads from a disk.';

-- Column-privilege proof (the 0311 habit). images carries TABLE-level grants,
-- so the column inherits SELECT/INSERT for authenticated under RLS — prove it,
-- and that RLS is still on.
do $$
begin
  if not has_column_privilege('authenticated', 'public.images', 'source_url', 'INSERT') then
    raise exception '0357: authenticated cannot write images.source_url — every web-image save would fail';
  end if;
  if not has_column_privilege('authenticated', 'public.images', 'source_url', 'SELECT') then
    raise exception '0357: authenticated cannot read images.source_url — reuse lookups would fail';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.images'::regclass) then
    raise exception '0357: images has no row level security';
  end if;
end $$;
