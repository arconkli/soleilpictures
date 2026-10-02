-- 0355 — images.original_name: the name an uploaded file had on someone's
-- computer.
--
-- An image or a video card kept nothing of the file it came from: a folder of
-- diner_ext_dusk_04.jpg came back from Download as download.jpg, and no search
-- could find a frame by the name the photographer gave it. The card now carries
-- the name (boards/src/lib/fileIngest.js meaningfulFileName); this column is the
-- durable copy beside the bytes, written once by the uploader, so the API can
-- name a file it serves and a card whose patch was lost can get its name back.
--
-- Originals only. Posters, covers and thumbnails are derived images with no
-- name of their own, and never get one.
--
-- APPLY BEFORE THE CLIENT THAT WRITES IT. uploads.js inserts this column on
-- every upload; a client that names a column the table lacks gets a 400, and
-- every upload from it would fail. The shared DB means "before the preview
-- deploy", not "before promotion".

alter table public.images add column if not exists original_name text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'images_original_name_len') then
    alter table public.images add constraint images_original_name_len
      check (original_name is null or char_length(original_name) <= 200);
  end if;
end $$;

comment on column public.images.original_name is
  'The uploaded file''s own name (basename, NFC, no control characters, <= 200). Null for derived images and for names a browser invents for a paste.';

-- Column-privilege proof. images carries TABLE-level grants — anon and
-- authenticated hold SELECT/INSERT/UPDATE on every column and RLS decides the
-- rows — so the new column inherits exactly those. Prove the uploader can write
-- and read it, and that the table did not lose the RLS that makes those grants
-- safe. (A grant that "succeeded" proves nothing — the 0311 habit.)
do $$
begin
  if not has_column_privilege('authenticated', 'public.images', 'original_name', 'INSERT') then
    raise exception '0355: authenticated cannot write images.original_name — every upload would fail';
  end if;
  if not has_column_privilege('authenticated', 'public.images', 'original_name', 'SELECT') then
    raise exception '0355: authenticated cannot read images.original_name';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.images'::regclass) then
    raise exception '0355: images has no row level security — its table-level grants are unsafe';
  end if;
end $$;
