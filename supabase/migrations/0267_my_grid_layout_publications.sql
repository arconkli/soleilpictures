-- 0267_my_grid_layout_publications.sql
--
-- The Templates panel needs to know which of MY templates are already in the
-- public gallery, so a row can offer "Publish to gallery" or "Remove from
-- gallery" rather than showing both and letting the user find out which one
-- did something.
--
-- public_grid_layouts is revoked from anon and authenticated entirely (0266)
-- and carries only an is_admin() policy, so no plain select can reach it. That
-- makes this a legitimate SECURITY DEFINER read rather than the kind the 0217
-- audit was about: it exists to answer a question the caller's own privileges
-- deliberately cannot, and it answers it ONLY about the caller's own rows.
-- Another author's slug, use_count and takedown reason stay invisible.

create or replace function public.my_grid_layout_publications()
returns table (layout_id uuid, slug text, published_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.layout_id, p.slug, p.published_at
  from public_grid_layouts p
  join grid_layouts g on g.id = p.layout_id
  where g.created_by = auth.uid() and g.deleted_at is null;
$$;
revoke all on function public.my_grid_layout_publications() from public, anon, authenticated;
grant execute on function public.my_grid_layout_publications() to authenticated;
