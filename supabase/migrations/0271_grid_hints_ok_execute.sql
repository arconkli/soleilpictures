-- 0271_grid_hints_ok_execute.sql
--
-- Fixes a live break: saving a grid template failed with
--   "permission denied for function _grid_hints_ok"
--
-- 0269 added `check (public._grid_hints_ok(body))` to grid_layouts and then, out
-- of habit, revoked the function from public, anon and authenticated — the
-- internal-helper rule from 0242:177, where a `_`-prefixed helper gets no grant
-- because it is only ever reached from inside a SECURITY DEFINER body, and the
-- definer's privileges are what apply there.
--
-- A CHECK CONSTRAINT HAS NO SUCH SHELTER. Its expression is evaluated with the
-- privileges of whoever is writing the row, so the caller needs EXECUTE. That
-- makes the rule exactly backwards here.
--
-- The blast radius was the whole table, not just labelled templates: the
-- constraint is evaluated on every INSERT and every UPDATE, and the denial is on
-- CALLING the function, not on anything it returns. So save, rename, scope
-- change and soft-delete all failed — a template with no hints at all failed
-- identically. Only the SECURITY DEFINER copy paths (claim_grid_layout_link,
-- use_public_grid_layout) still worked, because those run as the owner.
--
-- The precedent was already in this schema and had it right: object_props'
-- `_props_ok`, the only other function called from a CHECK here, carries EXECUTE
-- for everyone. A sweep of pg_constraint joined to pg_depend confirms those two
-- are the complete set, and this leaves them consistent.
--
-- Granting EXECUTE gives away nothing. The function is IMMUTABLE, reads no
-- table, takes the jsonb the caller already holds, and returns a boolean about
-- it — there is no state to reach through it. What guards the table is the RLS
-- policy set from 0265, which is untouched.

grant execute on function public._grid_hints_ok(jsonb) to authenticated;

comment on function public._grid_hints_ok(jsonb) is
  'Bounds body->hints: a string array, <=64 entries, <=40 chars each. Called from the grid_layouts_hints_bounded CHECK, which is why it is a function (a CHECK may not contain a subquery) and why authenticated must hold EXECUTE (a CHECK runs as the writer, not as the owner). Do not revoke it.';
