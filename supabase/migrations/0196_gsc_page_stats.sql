-- 0196_gsc_page_stats.sql — page-level Search Console performance for ALL site
-- paths (landing pages, /, /pricing, /explore, AND /c/ boards), with per-query
-- rows. Complements seo_board_stats (0137/0138), which stays /c/-only.
--
-- Written by the gsc-sync edge function (page-dimension totals land as query='',
-- page+query rows land with the query text). Snapshot semantics match 0138: one
-- rolling-28-day row per (path, query) at the sync day; the reader returns the
-- LATEST snapshot per path, so re-runs never double-count.

create table if not exists public.seo_page_stats (
  path text not null,
  day date not null,
  query text not null default '',   -- '' = the page-total row
  clicks int not null default 0,
  impressions int not null default 0,
  position numeric,
  updated_at timestamptz not null default now(),
  primary key (path, day, query)
);
alter table public.seo_page_stats enable row level security;
drop policy if exists "seo_page_stats admin" on public.seo_page_stats;
create policy "seo_page_stats admin" on public.seo_page_stats for all
  using (is_admin()) with check (is_admin());

-- Reader: latest page-total snapshot per path within the window, each with its
-- top-5 queries from the same snapshot day. Raw numerators only (SmallN
-- discipline — rates are computed client-side).
create or replace function public.admin_page_search_stats(p_days int default 90)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return (
    select coalesce(json_agg(to_jsonb(t) order by t.impressions desc nulls last), '[]'::json)
    from (
      select p.path, p.day, p.clicks, p.impressions, p.position,
        (select coalesce(json_agg(json_build_object(
             'q', q.query, 'clicks', q.clicks, 'impressions', q.impressions, 'position', q.position)
             order by q.impressions desc), '[]'::json)
         from (
           select q0.query, q0.clicks, q0.impressions, q0.position
           from seo_page_stats q0
           where q0.path = p.path and q0.day = p.day and q0.query <> ''
           order by q0.impressions desc
           limit 5
         ) q) as top_queries
      from (
        select distinct on (path) path, day, clicks, impressions, position
        from seo_page_stats
        where query = '' and day >= current_date - greatest(1, coalesce(p_days, 90))
        order by path, day desc
      ) p
    ) t
  );
end;
$$;
revoke all on function public.admin_page_search_stats(int) from public;
grant execute on function public.admin_page_search_stats(int) to authenticated;
revoke execute on function public.admin_page_search_stats(int) from anon;
