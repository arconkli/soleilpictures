-- 0138_gsc_stats.sql — GSC measurement loop data-in + reader semantics.
--
-- seo_board_stats (0137) holds Search Console performance per board. Both data
-- sources write a "snapshot" row per slug at a given day:
--   * admin_import_gsc_csv  — admin pastes the GSC "Pages" CSV (range-aggregated
--     totals) → one row per slug at the chosen as-of date. Works with ZERO GCP
--     setup (the immediately-usable MVP).
--   * gsc-sync edge function — service-account → Search Console API → rolling
--     28-day snapshot per slug per run (the automated path; needs GCP setup).
-- The reader returns the LATEST snapshot per slug, so the two sources are
-- interchangeable and re-imports never double-count (vs the prior SUM reader).

-- Reader: latest snapshot per slug within a freshness window.
create or replace function public.admin_public_board_stats(p_days int default 90)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return (
    select coalesce(json_agg(to_jsonb(t) order by t.impressions desc nulls last), '[]'::json)
    from (
      select distinct on (s.slug)
        s.slug, s.clicks, s.impressions, s.ctr, s.position, s.day, s.top_query
      from seo_board_stats s
      where s.day >= current_date - greatest(1, coalesce(p_days, 90))
      order by s.slug, s.day desc
    ) t
  );
end;
$$;

-- CSV import: rows = [{ page|slug, clicks, impressions, ctr, position, top_query? }].
-- The client parses the GSC CSV (strips %, etc.) and sends clean numbers. Slug is
-- taken from `slug` or extracted from a `page` URL's /c/<slug>. Upserts at p_as_of.
create or replace function public.admin_import_gsc_csv(p_rows jsonb, p_as_of date default current_date)
returns int language plpgsql security definer set search_path = public as $$
declare r jsonb; v_slug text; n int := 0;
begin
  if not is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_slug := coalesce(
      nullif(r->>'slug', ''),
      (regexp_match(coalesce(r->>'page', ''), '/c/([a-z0-9][a-z0-9-]{0,79})'))[1]
    );
    if v_slug is null then continue; end if;
    insert into seo_board_stats (slug, day, clicks, impressions, ctr, position, top_query, updated_at)
    values (
      v_slug, p_as_of,
      coalesce((r->>'clicks')::int, 0),
      coalesce((r->>'impressions')::int, 0),
      nullif(r->>'ctr', '')::numeric,
      nullif(r->>'position', '')::numeric,
      nullif(r->>'top_query', ''),
      now()
    )
    on conflict (slug, day) do update set
      clicks = excluded.clicks,
      impressions = excluded.impressions,
      ctr = excluded.ctr,
      position = excluded.position,
      top_query = coalesce(excluded.top_query, seo_board_stats.top_query),
      updated_at = now();
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.admin_import_gsc_csv(jsonb, date) from public;
grant execute on function public.admin_import_gsc_csv(jsonb, date) to authenticated;
revoke execute on function public.admin_import_gsc_csv(jsonb, date) from anon;
