-- 0254 — true per-day Search Console rows, alongside the rolling snapshots.
--
-- WHY (2026-08-22 data review): seo_page_stats (0196/0197) stores a rolling
-- 28-DAY WINDOW stamped with the SYNC DATE. That is deliberate and its reader,
-- admin_page_search_stats, handles it correctly (`distinct on (path) … day desc`
-- = take the latest snapshot). But it makes a copy change ungradeable: the
-- effect of a new <title> is diluted 1/28 per day and takes 28 days to fully
-- appear, and any "before" window overlaps its own "after" window. The 2026-08-04
-- and 2026-08-21 retitles were graded on an instrument that cannot resolve them.
--
-- Search Console's API will return a `date` dimension. This table stores that:
-- one row per (path, REAL GSC date, query, search_type). Written by the same
-- gsc-sync edge function in a third query pass.
--
-- A NEW TABLE, NOT A SCHEMA CHANGE. `seo_page_stats.day` means "sync date" in
-- every existing row; admin_page_search_stats and admin_public_board_stats both
-- depend on that meaning. Redefining the column in place would silently make the
-- history mean two different things.

create table if not exists public.seo_page_daily (
  path text not null,
  day date not null,                 -- the REAL Search Console date, not a sync stamp
  query text not null default '',    -- '' = the page-total row, same convention as 0196
  search_type text not null default 'web',
  clicks int not null default 0,
  impressions int not null default 0,
  position numeric,
  updated_at timestamptz not null default now(),
  primary key (path, day, query, search_type)
);

create index if not exists seo_page_daily_day_idx on public.seo_page_daily (day);
create index if not exists seo_page_daily_path_day_idx on public.seo_page_daily (path, day desc);

alter table public.seo_page_daily enable row level security;
drop policy if exists "seo_page_daily admin" on public.seo_page_daily;
create policy "seo_page_daily admin" on public.seo_page_daily for all
  using (is_admin()) with check (is_admin());

-- The trap, recorded where `\d+` and the Supabase table view will show it.
comment on table public.seo_page_stats is
  'Rolling 28-DAY WINDOW snapshots stamped with the SYNC date (not per-day metrics). '
  'NEVER SUM impressions/clicks across days — that multiplies by ~28. Read the LATEST '
  'row per path (see admin_page_search_stats). For true per-day series use seo_page_daily (0254).';

comment on table public.seo_page_daily is
  'True per-day Search Console rows: `day` is the real GSC date. Safe to SUM across days. '
  'Written by the gsc-sync edge function; Google restates the trailing ~3 days, so the '
  'sync re-fetches a 10-day tail and upserts.';

-- ── Readers ────────────────────────────────────────────────────────────────
-- Raw numerators only (SmallN discipline, same as 0196 — rates client-side).
-- Position is IMPRESSION-WEIGHTED whenever it is aggregated; a plain avg() over
-- days would weight a 1-impression day the same as a 500-impression day.

create or replace function public.admin_page_search_daily(
  p_path text default null,
  p_days int default 90,
  p_search_type text default 'web'
)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return (
    select coalesce(json_agg(to_jsonb(t) order by t.day), '[]'::json)
    from (
      select d.path, d.day, d.clicks, d.impressions, d.position
      from seo_page_daily d
      where d.query = ''
        and d.search_type = coalesce(p_search_type, 'web')
        and d.day >= current_date - greatest(1, coalesce(p_days, 90))
        and (p_path is null or d.path = p_path)
      order by d.day
    ) t
  );
end;
$$;

-- Grade a change: compare the p_window days BEFORE p_pivot against the
-- p_window days FROM p_pivot forward. This is the tool the 08-04 and 08-21
-- retitles did not have.
create or replace function public.admin_page_search_change(
  p_pivot date,
  p_window int default 7,
  p_search_type text default 'web'
)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_win int := greatest(1, coalesce(p_window, 7));
begin
  if not is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return (
    select coalesce(json_agg(to_jsonb(t) order by t.imp_after desc nulls last), '[]'::json)
    from (
      select
        d.path,
        sum(d.impressions) filter (where d.day <  p_pivot) as imp_before,
        sum(d.clicks)      filter (where d.day <  p_pivot) as clk_before,
        round(sum(d.position * d.impressions) filter (where d.day < p_pivot)
              / nullif(sum(d.impressions) filter (where d.day < p_pivot), 0), 1) as pos_before,
        sum(d.impressions) filter (where d.day >= p_pivot) as imp_after,
        sum(d.clicks)      filter (where d.day >= p_pivot) as clk_after,
        round(sum(d.position * d.impressions) filter (where d.day >= p_pivot)
              / nullif(sum(d.impressions) filter (where d.day >= p_pivot), 0), 1) as pos_after,
        count(*) filter (where d.day <  p_pivot) as days_before,
        count(*) filter (where d.day >= p_pivot) as days_after
      from seo_page_daily d
      where d.query = ''
        and d.search_type = coalesce(p_search_type, 'web')
        and d.day >= p_pivot - v_win
        and d.day <  p_pivot + v_win
      group by d.path
    ) t
  );
end;
$$;

revoke all on function public.admin_page_search_daily(text, int, text) from public;
revoke all on function public.admin_page_search_change(date, int, text) from public;
grant execute on function public.admin_page_search_daily(text, int, text) to authenticated;
grant execute on function public.admin_page_search_change(date, int, text) to authenticated;
