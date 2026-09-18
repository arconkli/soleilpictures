-- 0269_grid_layout_hints.sql
--
-- Cell hints: the labels a template leaves in its empty boxes ("WIDE SHOT",
-- "ACTION"), so somebody opening your storyboard template knows what goes
-- where.
--
-- No schema change. `body` was shaped in 0265 to grow a third key without one,
-- and this is that key: body->'hints' is a string array indexed by READING
-- ORDER. Index rather than leaf id because a template's leaf ids are
-- placeholders that instantiateLayout re-mints on every placement; reading
-- order is stable for a given tree, and is also how a person counts boxes.
--
-- WHY THIS NEEDS A SERVER-SIDE BOUND AT ALL
--
-- Hints are the only free text in a template, and they publish: a labelled
-- template in the public gallery puts its author's words on a public page. The
-- client sanitizes on save and again on read, but neither is a control — a
-- client is not a trust boundary. This is.
--
-- WHY A FUNCTION AND NOT AN INLINE CHECK
--
-- Validating "every element is a short string" needs to iterate the array, and
-- a CHECK constraint may not contain a subquery. An IMMUTABLE function may, and
-- a CHECK may call one. The coalesce(..., true) matters: bool_and over an empty
-- array returns NULL, and an empty hints array is legitimate.
--
-- Applied against an empty table (verified: 0 rows), so no backfill and no risk
-- of an existing row failing the new constraint.

create or replace function public._grid_hints_ok(b jsonb) returns boolean
language sql immutable as $$
  select b -> 'hints' is null
      or ( jsonb_typeof(b -> 'hints') = 'array'
       and jsonb_array_length(b -> 'hints') <= 64
       and coalesce((select bool_and(jsonb_typeof(e) = 'string' and length(e #>> '{}') <= 40)
                     from jsonb_array_elements(b -> 'hints') e), true) );
$$;
revoke all on function public._grid_hints_ok(jsonb) from public, anon, authenticated;

alter table public.grid_layouts
  drop constraint if exists grid_layouts_hints_bounded;
alter table public.grid_layouts
  add constraint grid_layouts_hints_bounded check (public._grid_hints_ok(body));

comment on function public._grid_hints_ok(jsonb) is
  'Bounds body->hints: a string array, <=64 entries, <=40 chars each. Called from a CHECK constraint, which is why it is a function — a CHECK may not contain a subquery.';
