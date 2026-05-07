-- Per-comment positional offset. When the comment author drags a
-- bubble around, we don't change which card/group/point it's anchored
-- to (so peers' "this comment was placed on card X" semantics survive),
-- we just store an offset relative to the anchor's natural location.
--
-- For card / group anchors:
--   final.x = card.x + card.w + 8 + offset_x
--   final.y = card.y           - 8 + offset_y
-- For point anchors, offset is added on top of (anchor_x, anchor_y) so
-- a peer-side card move doesn't drag the comment along.
--
-- Defaults to 0 so existing rows don't change visually.

alter table public.comments
  add column if not exists offset_x integer not null default 0,
  add column if not exists offset_y integer not null default 0;
