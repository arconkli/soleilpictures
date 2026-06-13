-- 0137_seo_tooling.sql — operationalize ranking for public marketing boards (0136).
--
-- Adds: a durable sidecar for AI-generated image alt text (the empty-alt fix that
-- unlocks Google Images), a related-boards query (internal-linking lever),
-- an admin SEO audit (the publish-quality gate inputs), and a stats table for
-- the Google Search Console measurement loop.
--
-- WHY a sidecar for alt: card content lives in Yjs Y.Docs; there is no server-side
-- Y.Doc mutation path, and card_index.meta.alt is re-derived from the Y.Doc on every
-- client save (~10s) so writing there is clobbered. card_alts mirrors the proven
-- card_tags (0032) sidecar pattern: keyed (board_id, card_id), can_write_board RLS.

-- ── 1. card_alts sidecar ────────────────────────────────────────────────────
create table if not exists public.card_alts (
  workspace_id uuid,
  board_id     uuid not null references public.boards(id) on delete cascade,
  card_id      text not null,
  alt          text not null,
  source       text not null default 'ai' check (source in ('ai','user','auto')),
  updated_at   timestamptz not null default now(),
  primary key (board_id, card_id)
);
alter table public.card_alts enable row level security;
drop policy if exists "card_alts read" on public.card_alts;
create policy "card_alts read" on public.card_alts for select using (can_read_board(board_id));
drop policy if exists "card_alts write" on public.card_alts;
create policy "card_alts write" on public.card_alts for all
  using (can_write_board(board_id)) with check (can_write_board(board_id));
-- The AI route writes via the service-role key (bypasses RLS); these policies
-- govern any direct client read/write.

-- ── 2. get_public_board_content: prefer AI alt (coalesce sidecar over meta) ──
-- Lockstep clone of the 0136 body + a card_alts left join. board_id is now
-- carried in `picked` so the join keys correctly across the sub-board set.
create or replace function public.get_public_board_content(p_slug text, p_limit int default 60)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_target uuid;
  v_cards  json;
  v_subs   json;
  v_total  int;
  v_lim    int;
begin
  v_target := _resolve_published_board(p_slug);
  if v_target is null then
    raise exception 'no such public board' using errcode = 'P0002';
  end if;
  v_lim := greatest(1, least(coalesce(p_limit, 60), 200));

  with recursive sub as (
    select id from boards where id = v_target and deleted_at is null
    union all
    select b.id from boards b join sub s on b.parent_board_id = s.id
    where b.deleted_at is null
  ),
  picked as (
    select ci.board_id, ci.card_id, ci.kind, ci.title, ci.body, ci.meta, ci.updated_at
    from card_index ci
    where ci.board_id in (select id from sub)
      and ci.kind in ('image','note','doc','link')
    order by ci.updated_at desc, ci.card_id
    limit v_lim
  )
  select coalesce(json_agg(json_build_object(
           'card_id', p.card_id,
           'kind',    p.kind,
           'title',   nullif(p.title, ''),
           'body',    nullif(p.body, ''),
           'href',    case when p.kind = 'link' then p.meta->>'url' else null end,
           'media',   case
             when p.kind = 'image' and (p.meta->>'src') like 'r2:%'
             then json_build_object(
                    'alt',         coalesce(nullif(ca.alt, ''), p.meta->>'alt'),
                    'src_key',     p.meta->>'src',
                    'preview_key', img.preview_path,
                    'blur',        img.blur_hash
                  )
             else null end
         ) order by p.updated_at desc, p.card_id), '[]'::json)
    into v_cards
  from picked p
  left join card_alts ca on ca.board_id = p.board_id and ca.card_id = p.card_id
  left join images img
    on img.storage_path = regexp_replace(p.meta->>'src', '^r2:', '')
   and img.deleted_at is null;

  select coalesce(json_agg(json_build_object('id', b.id, 'name', b.name)
           order by b.name), '[]'::json)
    into v_subs
  from boards b where b.parent_board_id = v_target and b.deleted_at is null;

  select count(*) into v_total
  from card_index ci
  where ci.board_id = v_target and ci.kind in ('image','note','doc','link');

  return json_build_object(
    'board_id',  v_target,
    'cards',     v_cards,
    'subboards', v_subs,
    'truncated', (v_total > v_lim)
  );
end;
$$;
revoke all on function public.get_public_board_content(text, int) from public;
grant execute on function public.get_public_board_content(text, int) to anon, authenticated;

-- ── 3. get_related_public_boards: board_tags overlap (internal linking) ─────
create or replace function public.get_related_public_boards(p_slug text, p_limit int default 6)
returns json language plpgsql security definer set search_path = public as $$
declare v_target uuid;
begin
  v_target := _resolve_published_board(p_slug);
  if v_target is null then return '[]'::json; end if;
  return (
    select coalesce(json_agg(json_build_object('slug', t.slug, 'seo_title', t.seo_title)
             order by t.overlap desc, t.published_at desc), '[]'::json)
    from (
      select pb.slug, coalesce(pb.seo_title, b.name) as seo_title, x.overlap, pb.published_at
      from (
        select bt2.board_id, count(*) as overlap
        from board_tags bt1
        join board_tags bt2 on bt2.tag_id = bt1.tag_id and bt2.board_id <> bt1.board_id
        where bt1.board_id = v_target
        group by bt2.board_id
      ) x
      join public_boards pb on pb.board_id = x.board_id and pb.published_at is not null
      join boards b on b.id = pb.board_id and b.deleted_at is null
      order by x.overlap desc, pb.published_at desc
      limit greatest(1, least(coalesce(p_limit, 6), 24))
    ) t
  );
end;
$$;
revoke all on function public.get_related_public_boards(text, int) from public;
grant execute on function public.get_related_public_boards(text, int) to anon, authenticated;

-- ── 4. admin_seo_audit: inputs for the publish-quality gate ─────────────────
create or replace function public.admin_seo_audit(p_board_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_img_total int;
  v_img_with_alt int;
  v_pb record;
  v_dup numeric;
  v_related int;
begin
  if not is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  select count(*) into v_img_total
  from card_index ci where ci.board_id = p_board_id and ci.kind = 'image';

  select count(*) into v_img_with_alt
  from card_index ci
  left join card_alts ca on ca.board_id = ci.board_id and ca.card_id = ci.card_id
  where ci.board_id = p_board_id and ci.kind = 'image'
    and coalesce(nullif(ca.alt, ''), nullif(ci.meta->>'alt', '')) is not null;

  select pb.slug, pb.seo_title, pb.seo_description, pb.seo_body, pb.target_keyword
    into v_pb from public_boards pb where pb.board_id = p_board_id;

  -- Max trigram similarity of this body vs OTHER published bodies (0 if none).
  select coalesce(max(similarity(v_pb.seo_body, pb2.seo_body)), 0) into v_dup
  from public_boards pb2
  where pb2.board_id <> p_board_id and pb2.published_at is not null
    and pb2.seo_body is not null and v_pb.seo_body is not null and length(v_pb.seo_body) > 0;

  select count(distinct bt2.board_id) into v_related
  from board_tags bt1
  join board_tags bt2 on bt2.tag_id = bt1.tag_id and bt2.board_id <> bt1.board_id
  join public_boards pb3 on pb3.board_id = bt2.board_id and pb3.published_at is not null
  where bt1.board_id = p_board_id;

  return json_build_object(
    'image_count',        v_img_total,
    'images_with_alt',    v_img_with_alt,
    'alt_pct',            case when v_img_total > 0 then round(100.0 * v_img_with_alt / v_img_total) else null end,
    'seo_title_len',      coalesce(length(v_pb.seo_title), 0),
    'seo_description_len',coalesce(length(v_pb.seo_description), 0),
    'seo_body_words',     coalesce(array_length(regexp_split_to_array(btrim(coalesce(v_pb.seo_body, '')), '\s+'), 1), 0),
    'has_target_keyword', (coalesce(v_pb.target_keyword, '') <> ''),
    'keyword_in_title',   (v_pb.target_keyword is not null and v_pb.seo_title is not null
                            and position(lower(v_pb.target_keyword) in lower(v_pb.seo_title)) > 0),
    'body_max_similarity',round(v_dup::numeric, 3),
    'related_board_count',v_related
  );
end;
$$;
revoke all on function public.admin_seo_audit(uuid) from public;
grant execute on function public.admin_seo_audit(uuid) to authenticated;

-- ── 5. seo_board_stats + reader (GSC measurement loop) ──────────────────────
create table if not exists public.seo_board_stats (
  slug        text not null,
  day         date not null,
  clicks      int  not null default 0,
  impressions int  not null default 0,
  ctr         numeric,
  position    numeric,
  top_query   text,
  updated_at  timestamptz not null default now(),
  primary key (slug, day)
);
alter table public.seo_board_stats enable row level security;
drop policy if exists "seo_board_stats admin" on public.seo_board_stats;
create policy "seo_board_stats admin" on public.seo_board_stats for all
  using (is_admin()) with check (is_admin());

create or replace function public.admin_public_board_stats(p_days int default 28)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return (
    select coalesce(json_agg(to_jsonb(t) order by t.impressions desc), '[]'::json)
    from (
      select s.slug,
        sum(s.clicks)::int      as clicks,
        sum(s.impressions)::int as impressions,
        case when sum(s.impressions) > 0 then round(100.0 * sum(s.clicks) / sum(s.impressions), 2) else 0 end as ctr,
        round(avg(s.position), 1) as position
      from seo_board_stats s
      where s.day >= (current_date - greatest(1, coalesce(p_days, 28)))
      group by s.slug
    ) t
  );
end;
$$;
revoke all on function public.admin_public_board_stats(int) from public;
grant execute on function public.admin_public_board_stats(int) to authenticated;

-- ── 6. Lock admin RPCs out of anon (Supabase default-privilege grants EXECUTE
-- to anon; is_admin() already blocks them, but defense-in-depth). ────────────
revoke execute on function public.admin_seo_audit(uuid) from anon;
revoke execute on function public.admin_public_board_stats(int) from anon;
