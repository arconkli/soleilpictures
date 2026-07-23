-- 0197_page_stats_search_type.sql — add the Search Console search-type
-- dimension (web | image) to seo_page_stats so Google Images performance is
-- measurable alongside web. Existing rows are web (they were synced before the
-- image pass existed). gsc-sync v3 writes both types per run.

alter table public.seo_page_stats add column search_type text not null default 'web';
alter table public.seo_page_stats drop constraint seo_page_stats_pkey;
alter table public.seo_page_stats add primary key (path, day, query, search_type);

-- Reader gains p_search_type (default 'web' — existing callers see identical
-- web numbers; pass 'image' for the image channel).
drop function public.admin_page_search_stats(int);
create or replace function public.admin_page_search_stats(p_days int default 90, p_search_type text default 'web')
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
             and q0.search_type = coalesce(p_search_type, 'web')
           order by q0.impressions desc
           limit 5
         ) q) as top_queries
      from (
        select distinct on (path) path, day, clicks, impressions, position
        from seo_page_stats
        where query = '' and search_type = coalesce(p_search_type, 'web')
          and day >= current_date - greatest(1, coalesce(p_days, 90))
        order by path, day desc
      ) p
    ) t
  );
end;
$$;
revoke all on function public.admin_page_search_stats(int, text) from public;
grant execute on function public.admin_page_search_stats(int, text) to authenticated;
revoke execute on function public.admin_page_search_stats(int, text) from anon;
