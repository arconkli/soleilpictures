-- 0090_board_preview.sql — stored board previews (capture-once thumbnails).
--
-- Previously every board tile re-decoded the full Y.Doc and re-rasterized
-- a Canvas2D bitmap on every view. We now render each board's preview ONCE
-- to a private-R2 WebP, stamp its r2: sentinel onto the board row, and let
-- tiles display the static image with no decode / no re-render.

alter table public.boards
  add column if not exists thumb_key        text,         -- "r2:<ws>/thumbs/<id>.webp"
  add column if not exists thumb_updated_at timestamptz,   -- cache-buster + freshness signal
  add column if not exists card_count       int;           -- tile "N items" without a Y.Doc decode

-- images.storage_path has NO global unique constraint, so a plain
-- upsert(onConflict:'storage_path') can't work. Scope a PARTIAL unique
-- index to thumbnail keys only — this lets uploadBoardThumbnail upsert the
-- bookkeeping row idempotently (one row per board, reused on every regen)
-- while leaving the random-UUID media uploads completely unaffected.
create unique index if not exists images_thumb_key_uniq
  on public.images (storage_path)
  where storage_path like '%/thumbs/%';
