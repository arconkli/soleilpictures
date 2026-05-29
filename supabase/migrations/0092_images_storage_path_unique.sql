-- 0092_images_storage_path_unique.sql
--
-- Fix: board-thumbnail upserts fail with HTTP 400 on every board open.
--
-- uploadBoardThumbnail() (boards/src/lib/uploads.js) calls
--   .upsert(row, { onConflict: 'storage_path', ignoreDuplicates: true })
-- which PostgREST emits as `INSERT ... ON CONFLICT (storage_path) DO NOTHING`.
-- The only unique index on storage_path was PARTIAL (images_thumb_key_uniq,
-- WHERE storage_path ~~ '%/thumbs/%', added in 0090). Postgres will NOT infer
-- a partial unique index from a bare `ON CONFLICT (storage_path)` (the index
-- predicate would have to be restated in the ON CONFLICT clause, which
-- PostgREST cannot express) -> 42P10 "there is no unique or exclusion
-- constraint matching the ON CONFLICT specification" -> HTTP 400. Result:
-- the thumbnail images row was NEVER written (0 thumb rows in prod), so the
-- /sign-reads allowlist never authorized the thumb key and board previews
-- rendered blank.
--
-- A full (non-partial) unique index on exactly (storage_path) IS inferable by
-- `ON CONFLICT (storage_path)`, so the already-deployed client starts working
-- with no redeploy. This is also semantically correct: storage_path is an R2
-- object key and is globally unique by construction -- regular uploads use
-- <ws>/<uuid>.<ext> (boards/party/upload.ts) and thumbnails use the
-- deterministic <ws>/thumbs/<board>.webp. Verified 0 duplicate storage_path
-- values before applying.

create unique index if not exists images_storage_path_key
  on public.images (storage_path);

drop index if exists public.images_thumb_key_uniq;    -- superseded by the full unique index
drop index if exists public.images_storage_path_idx;  -- redundant non-unique btree on (storage_path)
