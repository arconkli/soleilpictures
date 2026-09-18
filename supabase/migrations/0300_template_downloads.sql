-- Download counts for the templates WE ship (/templates/<slug>).
--
-- The store could already show a count for community templates —
-- public_grid_layouts.use_count, bumped by use_public_grid_layout — but our own
-- sixteen had no counter behind them at all, so "Most downloaded" could only
-- ever sort one item and everything else tied at zero.
--
-- ONE DOWNLOAD PER PERSON, which is what makes the number mean something and
-- what makes it match the counter it sits beside. use_public_grid_layout
-- increments use_count only when it inserts a genuinely new copy — it returns
-- early for your own template and for one you already took — so its count is
-- effectively distinct users. A primary key of (slug, user_id) gives the same
-- semantics here by construction rather than by procedure: pressing the button
-- twice, on two boards, or after deleting your copy, is still one download.
--
-- The consequence to be clear about: this starts at zero for every template and
-- only moves when somebody actually takes one. There is deliberately no seeding.
-- A fabricated count is a claim about other people's behaviour, and this repo is
-- public, so the seed would be sitting in this file for anyone to read.

create table if not exists public.template_downloads (
  -- Not a foreign key: the catalogue lives in content/templates/*.md and is
  -- compiled into the bundle, so the database has no table to point at. The
  -- CHECK bounds it to the shape gen-docs mints, and the client only ever joins
  -- these counts against slugs it already knows — a row for a slug we do not
  -- ship is inert rather than displayed.
  slug        text not null check (slug ~ '^[a-z0-9-]{1,120}$'),
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (slug, user_id)
);

-- RLS on with NO policies, on purpose. Nothing reads or writes this table
-- directly: the write is a SECURITY DEFINER recorder (a caller must not be able
-- to author arbitrary counts) and the read is a SECURITY DEFINER aggregate (a
-- caller must not be able to see WHO downloaded what). Both are things the
-- caller's own privileges deliberately cannot do, which is the bar this codebase
-- sets for using an RPC instead of going through RLS.
alter table public.template_downloads enable row level security;

-- ── record ───────────────────────────────────────────────────────────────────
-- Idempotent per (slug, user). Silent for a signed-out caller rather than an
-- error: this is fired alongside saving the template, and a counter must never
-- be able to fail the thing it is counting.
create or replace function public.record_template_download(p_slug text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return;
  end if;
  insert into public.template_downloads (slug, user_id)
  values (lower(p_slug), auth.uid())
  on conflict (slug, user_id) do nothing;
end $$;

revoke all on function public.record_template_download(text) from public, anon, authenticated;
grant execute on function public.record_template_download(text) to authenticated;

-- ── read ─────────────────────────────────────────────────────────────────────
-- Aggregate only — slug and a count, never a user. Granted to anon as well,
-- because /templates renders for signed-out visitors and the count is part of
-- the shelf.
create or replace function public.template_download_counts()
returns table (slug text, downloads bigint)
language sql stable security definer set search_path = public as $$
  select d.slug, count(*)::bigint
  from public.template_downloads d
  group by d.slug;
$$;

revoke all on function public.template_download_counts() from public, anon, authenticated;
grant execute on function public.template_download_counts() to anon, authenticated;

comment on table public.template_downloads is
  'One row per (shipped template slug, user) — a person who added that template to their library. Counted by template_download_counts(); never read directly (RLS on, no policies).';
comment on function public.record_template_download(text) is
  'Idempotent per (slug, user). Silent when signed out: a counter must not be able to fail the action it counts.';
comment on function public.template_download_counts() is
  'slug -> distinct downloaders. Aggregate only, so it never exposes who downloaded what. Granted to anon for the public store page.';
