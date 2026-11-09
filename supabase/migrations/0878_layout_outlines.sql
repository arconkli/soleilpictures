-- 0878_layout_outlines.sql
--
-- Layout outlines: how people lay clusters out, learned without anything that
-- is in the cards and without anything that points back to a person.
--
-- Two stores, both filled once a week by cron for the week that just ended
-- (Monday to Monday, UTC):
--
--   layout_stats_weekly   a few totals over every cluster that changed that
--                         week, plus how many people used each canvas tool by
--                         how old the cluster was. A row is stored only when
--                         at least 20 distinct people are behind it (k >= 20).
--                         No user, workspace or cluster column.
--
--   cluster_outlines      one outline per cluster whose creator said yes
--                         (profiles.settings.layout_outlines.ok, written only
--                         by set_layout_outlines below). An outline is plain
--                         boxes: kind, place, size, turn, add order, section
--                         boxes, grid box count, and coarse counts. The row
--                         carries no id but its own random outline_id, no
--                         timestamp finer than the week, and rows go in in
--                         random order, so nothing in it leads back to the
--                         cluster, its workspace or its people.
--
-- The outline compute reads card_index's kind, created_at and card_id (for the
-- add order) and only these meta keys: pos, unplaced, groupId, sectionHeader,
-- rot, and the LENGTH of cells. Never title, body, or any other meta key.
-- layoutOutlinesSql.test.mjs holds the file to that.
--
-- A cluster is outlined only when it was made on or after the epoch, is not
-- trashed, is in a personal (non-Team) workspace that is not an unclaimed
-- assistant draft, was made by someone who said yes, no one who can edit it
-- (workspace owner/coowner/admin/editor, or an editor share on it or on any
-- cluster above it) said no or is internal, and neither it nor any cluster
-- above it is published or has a live public link. A cluster whose chain of
-- parents can't be walked to the workspace root (a cycle, or deeper than the
-- walk goes) is left out, because then that last rule can't be proved.
--
-- Cost: the stats run reads board_state (no index on updated_at; a small
-- table), card_index only for the boards that changed that week, and
-- analytics_events through events_event_time for four event names in one week.
-- The outline run reads card_index only for that week's eligible clusters.
--
-- Retention: purge_old_cluster_outlines(400), daily. The privacy policy states
-- the same number; legalContent.test.mjs reads it from the cron below.
--
-- New functions are born with the 0311 grants (authenticated + service_role).
-- The internal ones lose authenticated; set_layout_outlines and the admin
-- RPCs keep it and never reach anon. The block at the end proves each.

begin;

set local lock_timeout = '3s';

-- ── Tables ──────────────────────────────────────────────────────────────────

create table if not exists public.layout_stats_weekly (
  week       date    not null,
  measure    text    not null check (measure in ('tile', 'tool_by_age')),
  bucket     text    not null,
  value      numeric,
  people_n   integer not null check (people_n >= 20),
  clusters_n integer not null default 0,
  primary key (week, measure, bucket)
);

create table if not exists public.cluster_outlines (
  outline_id uuid  primary key default gen_random_uuid(),
  week       date  not null,
  frame      jsonb not null,
  cards      jsonb not null,
  sections   jsonb not null,
  stats      jsonb not null
);

create index if not exists cluster_outlines_week_idx on public.cluster_outlines (week);

alter table public.layout_stats_weekly enable row level security;
alter table public.cluster_outlines   enable row level security;

revoke all on table public.layout_stats_weekly from public, anon, authenticated;
revoke all on table public.cluster_outlines   from public, anon, authenticated;

comment on table public.layout_stats_weekly is
  'Layout outlines (0878): weekly totals over clusters that changed, and canvas tool use by cluster age. A row exists only when people_n >= 20. No user, workspace or cluster column. Read through admin_layout_stats().';
comment on table public.cluster_outlines is
  'Layout outlines (0878): one plain-box outline per consenting cluster per week. No id but outline_id, no timestamp finer than week, inserted in random order. Read through admin_cluster_outlines(). Purged after 400 days.';

-- ── The epoch ───────────────────────────────────────────────────────────────

create or replace function public._layout_outline_epoch()
returns date
language sql
immutable
set search_path = public, pg_temp
as $$ select date '2026-11-10' $$;

revoke execute on function public._layout_outline_epoch() from public, anon, authenticated;

-- ── Weekly totals ───────────────────────────────────────────────────────────

create or replace function public._layout_stats_compute(p_week date)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_from timestamptz;
  v_to   timestamptz;
  v_tiles integer := 0;
  v_tools integer := 0;
begin
  if p_week is null or extract(isodow from p_week) <> 1 then
    raise exception 'layout stats: week must be a Monday' using errcode = '22023';
  end if;
  v_from := p_week::timestamp at time zone 'utc';
  v_to   := v_from + interval '7 days';

  delete from public.layout_stats_weekly where week = p_week;

  -- Tiles: every live cluster whose saved state changed in the week.
  with internal as (
    select i.user_id from public._internal_user_ids() i
  ),
  c as (
    select b.id, b.created_by
      from public.board_state bs
      join public.boards b on b.id = bs.board_id
      left join public.profiles pc on pc.user_id = b.created_by
     where bs.updated_at >= v_from and bs.updated_at < v_to
       and b.deleted_at is null
       and b.created_by is not null
       and b.created_by not in (select user_id from internal)
       and not coalesce(pc.is_service, false)
       and not public._is_service_identity(b.created_by)
       and not exists (select 1 from public.mcp_drafts d
                        where d.workspace_id = b.workspace_id and d.claimed_at is null)
  ),
  per as (
    select c.id, c.created_by,
           count(ci.card_id) filter (where jsonb_typeof(ci.meta->'pos'->'x') = 'number'
                                       and jsonb_typeof(ci.meta->'pos'->'y') = 'number'
                                       and jsonb_typeof(ci.meta->'pos'->'w') = 'number'
                                       and jsonb_typeof(ci.meta->'pos'->'h') = 'number'
                                       and ci.meta->'unplaced' is distinct from 'true'::jsonb) as n,
           count(ci.card_id) filter (where ci.kind = 'image'
                                       and jsonb_typeof(ci.meta->'pos'->'x') = 'number'
                                       and jsonb_typeof(ci.meta->'pos'->'y') = 'number'
                                       and jsonb_typeof(ci.meta->'pos'->'w') = 'number'
                                       and jsonb_typeof(ci.meta->'pos'->'h') = 'number'
                                       and ci.meta->'unplaced' is distinct from 'true'::jsonb) as pics,
           coalesce(bool_or(((jsonb_typeof(ci.meta->'groupId') in ('string', 'number') and (ci.meta->>'groupId') <> '')
                             or ci.meta->'sectionHeader' = 'true'::jsonb)
                            and jsonb_typeof(ci.meta->'pos'->'x') = 'number'
                            and jsonb_typeof(ci.meta->'pos'->'y') = 'number'
                            and jsonb_typeof(ci.meta->'pos'->'w') = 'number'
                            and jsonb_typeof(ci.meta->'pos'->'h') = 'number'
                            and ci.meta->'unplaced' is distinct from 'true'::jsonb), false) as sect,
           exists (select 1 from public.boards k
                    where k.parent_board_id = c.id and k.deleted_at is null) as nested
      from c
      left join public.card_index ci on ci.board_id = c.id
     group by c.id, c.created_by
  ),
  tiles as (
    select 'clusters_changed'::text as bucket, count(*)::numeric as value,
           count(distinct created_by)::int as people_n, count(*)::int as clusters_n
      from per
    union all
    select 'median_cards', percentile_cont(0.5) within group (order by n)::numeric,
           count(distinct created_by)::int, count(*)::int
      from per
    union all
    select 'use_sections', round(avg(case when sect then 1 else 0 end)::numeric, 4),
           count(distinct created_by)::int, count(*)::int
      from per
    union all
    select 'nested', round(avg(case when nested then 1 else 0 end)::numeric, 4),
           count(distinct created_by)::int, count(*)::int
      from per
    union all
    select 'mostly_pictures', round(avg(case when pics * 2 > n then 1 else 0 end)::numeric, 4),
           count(distinct created_by)::int, count(*)::int
      from per where n >= 1
  )
  insert into public.layout_stats_weekly (week, measure, bucket, value, people_n, clusters_n)
  select p_week, 'tile', t.bucket, t.value, t.people_n, t.clusters_n
    from tiles t
   where t.people_n >= 20;
  get diagnostics v_tiles = row_count;

  -- Tools by cluster age. props->>'board_id' is only cast once it is a uuid.
  with internal as (
    select i.user_id from public._internal_user_ids() i
  ),
  ev as (
    select e.user_id, e.event, e.props->>'action' as act, e.occurred_at,
           case when (e.props->>'board_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then (e.props->>'board_id')::uuid end as bid
      from public.analytics_events e
     where e.event in ('canvas_tool', 'arrow_created', 'board_open', 'card_placed')
       and e.occurred_at >= v_from and e.occurred_at < v_to
       and e.user_id is not null
  ),
  people as (
    select u.user_id
      from (select distinct ev.user_id from ev) u
      left join public.profiles p on p.user_id = u.user_id
     where u.user_id not in (select user_id from internal)
       and not coalesce(p.is_service, false)
       and not public._is_service_identity(u.user_id)
  ),
  evb as (
    select ev.user_id, b.id as board_id,
           case
             when ev.event = 'arrow_created' then 'arrows'
             when ev.event <> 'canvas_tool' then null
             when ev.act = 'move' then 'move'
             when ev.act = 'tidy' then 'arrange'
             when ev.act in ('align', 'distribute') then 'align'
             when ev.act in ('section_add', 'section_remove') then 'sections'
             when ev.act = 'draw' then 'pen'
             when ev.act in ('grid_split', 'grid_merge', 'grid_fill') then 'grid'
             when ev.act = 'duplicate' then 'duplicate'
             when ev.act in ('copy', 'cut', 'paste') then 'copy_paste'
             when ev.act in ('undo', 'redo') then 'undo'
             when ev.act = 'resize' then 'resize'
             when ev.act = 'rotate' then 'rotate'
             when ev.act = 'zorder' then 'layer'
             when ev.act = 'select_many' then 'multi_select'
           end as tool,
           case
             when ev.occurred_at - b.created_at < interval '5 minutes' then '5m'
             when ev.occurred_at - b.created_at < interval '1 day' then '1d'
             when ev.occurred_at - b.created_at < interval '7 days' then '7d'
             else 'later'
           end as band
      from ev
      join people pp on pp.user_id = ev.user_id
      join public.boards b on b.id = ev.bid
  ),
  den as (
    select band, count(distinct user_id)::int as n from evb group by band
  ),
  num as (
    select tool, band, count(distinct user_id)::int as n, count(distinct board_id)::int as clusters_n
      from evb where tool is not null group by tool, band
  )
  insert into public.layout_stats_weekly (week, measure, bucket, value, people_n, clusters_n)
  select p_week, 'tool_by_age', num.tool || '|' || num.band,
         round(num.n::numeric / den.n, 4), den.n, num.clusters_n
    from num join den on den.band = num.band
   where den.n >= 20;
  get diagnostics v_tools = row_count;

  return v_tiles + v_tools;
end $$;

revoke execute on function public._layout_stats_compute(date) from public, anon, authenticated;

-- ── Outlines ────────────────────────────────────────────────────────────────

create or replace function public._layout_outlines_compute(p_week date)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_from timestamptz;
  v_to   timestamptz;
  v_n    integer := 0;
begin
  if p_week is null or extract(isodow from p_week) <> 1 then
    raise exception 'layout outlines: week must be a Monday' using errcode = '22023';
  end if;
  v_from := p_week::timestamp at time zone 'utc';
  v_to   := v_from + interval '7 days';

  delete from public.cluster_outlines where week = p_week;

  with recursive
  internal as (
    select i.user_id from public._internal_user_ids() i
  ),
  cand as (
    select b.id, b.workspace_id, b.created_at
      from public.boards b
      join public.profiles pc on pc.user_id = b.created_by
      join public.workspaces w on w.id = b.workspace_id
      left join public.board_state bs on bs.board_id = b.id
     where b.deleted_at is null
       and b.created_at >= (public._layout_outline_epoch()::timestamp at time zone 'utc')
       and b.created_at < v_to
       and pc.settings->'layout_outlines'->'ok' = 'true'::jsonb
       and (   (bs.updated_at >= v_from and bs.updated_at < v_to)
            or (case when pg_input_is_valid(pc.settings->'layout_outlines'->>'at', 'timestamptz')
                     then (pc.settings->'layout_outlines'->>'at')::timestamptz end) >= v_from
               and (case when pg_input_is_valid(pc.settings->'layout_outlines'->>'at', 'timestamptz')
                         then (pc.settings->'layout_outlines'->>'at')::timestamptz end) < v_to)
       and w.org_id is null
       and not coalesce(pc.is_service, false)
       and not public._is_service_identity(b.created_by)
       and b.created_by not in (select user_id from internal)
       and not exists (select 1 from public.mcp_drafts d
                        where d.workspace_id = b.workspace_id and d.claimed_at is null)
  ),
  -- The cluster itself (hop 0) and every cluster above it, cycle-safe and capped.
  chain as (
    select c.id as board_id, b.id as anc_id, b.parent_board_id as next_id, 0 as hop, array[b.id] as seen
      from cand c
      join public.boards b on b.id = c.id
    union all
    select ch.board_id, p.id, p.parent_board_id, ch.hop + 1, ch.seen || p.id
      from chain ch
      join public.boards p on p.id = ch.next_id
     where ch.hop < 64
       and not (p.id = any (ch.seen))
  ),
  roots as (
    select ch.board_id, min(ch.hop) filter (where ch.next_id is null) as depth
      from chain ch
     group by ch.board_id
  ),
  eligible as (
    select c.id, c.workspace_id, c.created_at, r.depth
      from cand c
      join roots r on r.board_id = c.id
     where r.depth is not null
       and not exists (select 1 from chain ch
                         join public.public_boards pb on pb.board_id = ch.anc_id
                        where ch.board_id = c.id and pb.published_at is not null)
       and not exists (select 1 from chain ch
                         join public.public_share_links l on l.board_id = ch.anc_id
                        where ch.board_id = c.id
                          and l.revoked_at is null
                          and (l.expires_at is null or l.expires_at > now()))
       and not exists (
             select 1
               from (select wm.user_id
                       from public.workspace_members wm
                      where wm.workspace_id = c.workspace_id
                        and wm.role in ('owner', 'coowner', 'admin', 'editor')
                     union
                     select w2.created_by
                       from public.workspaces w2
                      where w2.id = c.workspace_id
                        and w2.created_by is not null
                     union
                     select bsh.user_id
                       from chain ch
                       join public.board_shares bsh on bsh.board_id = ch.anc_id
                      where ch.board_id = c.id and bsh.role = 'editor') ed
               left join public.profiles pe on pe.user_id = ed.user_id
              where ed.user_id in (select user_id from internal)
                 or pe.settings->'layout_outlines'->'ok' = 'false'::jsonb)
  ),
  -- Placed cards. Every jsonb-to-number cast sits behind a CASE on its type.
  raw as (
    select ci.board_id, ci.card_id, ci.created_at,
           case ci.kind
             when 'image' then 'picture' when 'note' then 'note' when 'link' then 'link'
             when 'doc' then 'doc' when 'pdf' then 'file' when 'file' then 'file'
             when 'video' then 'video' when 'audio' then 'audio' when 'palette' then 'palette'
             when 'grid' then 'grid' when 'board' then 'cluster' when 'boardlink' then 'cluster'
             when 'shape' then 'shape' else 'other'
           end as k,
           case when jsonb_typeof(ci.meta->'pos'->'x') = 'number' then (ci.meta->'pos'->>'x')::numeric end as x,
           case when jsonb_typeof(ci.meta->'pos'->'y') = 'number' then (ci.meta->'pos'->>'y')::numeric end as y,
           case when jsonb_typeof(ci.meta->'pos'->'w') = 'number' then greatest((ci.meta->'pos'->>'w')::numeric, 1) end as w,
           case when jsonb_typeof(ci.meta->'pos'->'h') = 'number' then greatest((ci.meta->'pos'->>'h')::numeric, 1) end as h,
           case when jsonb_typeof(ci.meta->'rot') = 'number' then (ci.meta->>'rot')::numeric else 0 end as rot,
           case when jsonb_typeof(ci.meta->'groupId') in ('string', 'number')
                 and (ci.meta->>'groupId') <> '' then ci.meta->>'groupId' end as grp,
           coalesce(ci.meta->'sectionHeader' = 'true'::jsonb, false) as hd,
           case when ci.kind = 'grid'
                then least(coalesce(jsonb_array_length(case when jsonb_typeof(ci.meta->'cells') = 'array' then ci.meta->'cells' end), 0), 60)
           end as g,
           ci.meta->'unplaced' is distinct from 'true'::jsonb as on_board
      from public.card_index ci
      join eligible e on e.id = ci.board_id
  ),
  placed as (
    select r.board_id, r.card_id, r.k, r.x, r.y, r.w, r.h, r.rot, r.grp, r.hd, r.g,
           count(*) over (partition by r.board_id) as n,
           row_number() over (partition by r.board_id order by r.created_at, r.card_id) as z
      from raw r
     where r.on_board
       and r.x is not null and r.y is not null and r.w is not null and r.h is not null
  ),
  -- Frame: the placed cards' bounding box. w and h are >= 1 above, so the
  -- long side is >= 1 and the scale never divides by zero.
  box as (
    select p.board_id, min(p.x) as mnx, min(p.y) as mny,
           max(p.x + p.w) - min(p.x) as bw, max(p.y + p.h) - min(p.y) as bh
      from placed p
     where p.n between 3 and 1500
     group by p.board_id
  ),
  scaled as (
    select p.board_id, p.k, p.z, p.grp, p.hd, p.g,
           round((p.x - b.mnx) * 200 / greatest(b.bw, b.bh))::int as sx,
           round((p.y - b.mny) * 200 / greatest(b.bw, b.bh))::int as sy,
           greatest(1, round(p.w * 200 / greatest(b.bw, b.bh)))::int as sw,
           greatest(1, round(p.h * 200 / greatest(b.bw, b.bh)))::int as sh,
           mod(round(p.rot / 5) * 5, 360) as r360
      from placed p
      join box b on b.board_id = p.board_id
  ),
  turned as (
    select s.*,
           (case when s.r360 > 180 then s.r360 - 360
                 when s.r360 <= -180 then s.r360 + 360
                 else s.r360 end)::int as r
      from scaled s
  ),
  sect as (
    select t.board_id, t.grp, count(*)::int as n,
           min(t.sx) as x, min(t.sy) as y,
           greatest(1, max(t.sx + t.sw) - min(t.sx)) as w,
           greatest(1, max(t.sy + t.sh) - min(t.sy)) as h,
           row_number() over (partition by t.board_id order by min(t.z)) as i
      from turned t
     where t.grp is not null
     group by t.board_id, t.grp
  ),
  cardj as (
    select t.board_id,
           jsonb_agg(jsonb_build_object('k', t.k, 'x', t.sx, 'y', t.sy, 'w', t.sw, 'h', t.sh,
                                        'z', t.z, 'r', t.r, 's', s.i, 'hd', t.hd)
                     || case when t.k = 'grid' then jsonb_build_object('g', t.g) else '{}'::jsonb end
                     order by t.z) as cards,
           count(*)::int as n,
           count(*) filter (where t.r <> 0)::int as rotated,
           count(*) filter (where t.k = 'grid')::int as grids
      from turned t
      left join sect s on s.board_id = t.board_id and s.grp = t.grp
     group by t.board_id
  ),
  kinds as (
    select q.board_id, jsonb_object_agg(q.k, q.n) as kinds
      from (select t.board_id, t.k, count(*)::int as n from turned t group by t.board_id, t.k) q
     group by q.board_id
  ),
  sectj as (
    select s.board_id,
           jsonb_agg(jsonb_build_object('i', s.i, 'x', s.x, 'y', s.y, 'w', s.w, 'h', s.h, 'n', s.n)
                     order by s.i) as sections
      from sect s
     group by s.board_id
  )
  insert into public.cluster_outlines (week, frame, cards, sections, stats)
  select p_week,
         jsonb_build_object(
           'w', greatest(1, round(b.bw * 200 / greatest(b.bw, b.bh)))::int,
           'h', greatest(1, round(b.bh * 200 / greatest(b.bw, b.bh)))::int),
         cj.cards,
         coalesce(sj.sections, '[]'::jsonb),
         jsonb_build_object(
           'cards',    cj.n,
           'kinds',    kd.kinds,
           'depth',    least(e.depth, 6),
           'children', (select count(*)::int from public.boards k
                         where k.parent_board_id = e.id and k.deleted_at is null),
           'age',      case when v_to - e.created_at < interval '7 days'  then 'w1'
                            when v_to - e.created_at < interval '28 days' then 'w4'
                            when v_to - e.created_at < interval '90 days' then 'm3'
                            else 'old' end,
           'rotated',  cj.rotated,
           'grids',    cj.grids)
    from eligible e
    join box b    on b.board_id  = e.id
    join cardj cj on cj.board_id = e.id
    join kinds kd on kd.board_id = e.id
    left join sectj sj on sj.board_id = e.id
   order by random();
  get diagnostics v_n = row_count;

  return v_n;
end $$;

revoke execute on function public._layout_outlines_compute(date) from public, anon, authenticated;

-- ── Weekly run and purge ────────────────────────────────────────────────────

create or replace function public._layout_weekly_run()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_week date := date_trunc('week', now() at time zone 'utc')::date - 7;
begin
  perform public._layout_stats_compute(v_week);
  perform public._layout_outlines_compute(v_week);
end $$;

revoke execute on function public._layout_weekly_run() from public, anon, authenticated;

create or replace function public.purge_old_cluster_outlines(p_days integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  delete from public.cluster_outlines
   where week < current_date - greatest(coalesce(p_days, 400), 1);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke execute on function public.purge_old_cluster_outlines(integer) from public, anon, authenticated;

-- ── Consent ─────────────────────────────────────────────────────────────────

create or replace function public.set_layout_outlines(p_ok boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_obj jsonb;
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  if p_ok is null then
    raise exception 'p_ok must be true or false' using errcode = '22023';
  end if;
  -- 'at' is UTC ISO 8601 whatever the session's TimeZone, so the weekly run
  -- (which reads it back through pg_input_is_valid) and the app agree.
  v_obj := jsonb_build_object(
    'ok', p_ok,
    'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  insert into public.profiles (user_id, settings)
       values (v_uid, jsonb_build_object('layout_outlines', v_obj))
  on conflict (user_id)
       do update set settings = coalesce(public.profiles.settings, '{}'::jsonb)
                                || jsonb_build_object('layout_outlines', v_obj);
  return v_obj;
end $$;

revoke execute on function public.set_layout_outlines(boolean) from public, anon;
grant execute on function public.set_layout_outlines(boolean) to authenticated, service_role;

-- ── Admin reads ─────────────────────────────────────────────────────────────

create or replace function public.admin_layout_weeks()
returns jsonb
language plpgsql
stable security definer
set search_path = public, pg_temp
as $$
declare
  v_out jsonb;
begin
  perform public._require_admin();

  select coalesce(jsonb_agg(jsonb_build_object(
           'week',     to_char(wk.week, 'YYYY-MM-DD'),
           'outlines', coalesce(o.n, 0),
           'stats',    s.week is not null)
         order by wk.week desc), '[]'::jsonb)
    into v_out
    from (select u.week
            from (select week from public.cluster_outlines
                  union
                  select week from public.layout_stats_weekly) u
           order by u.week desc
           limit 104) wk
    left join (select week, count(*)::int as n from public.cluster_outlines group by week) o
           on o.week = wk.week
    left join (select distinct week from public.layout_stats_weekly) s
           on s.week = wk.week;

  return v_out;
end $$;

revoke execute on function public.admin_layout_weeks() from public, anon;
grant execute on function public.admin_layout_weeks() to authenticated, service_role;

create or replace function public.admin_layout_stats(p_week date)
returns jsonb
language plpgsql
stable security definer
set search_path = public, pg_temp
as $$
declare
  v_tiles jsonb;
  v_tools jsonb;
begin
  perform public._require_admin();
  if p_week is null then
    raise exception 'p_week is required' using errcode = '22023';
  end if;

  select jsonb_build_object(
           'clusters_changed', max(case when t.bucket = 'clusters_changed' then t.j::text end)::jsonb,
           'median_cards',     max(case when t.bucket = 'median_cards'     then t.j::text end)::jsonb,
           'use_sections',     max(case when t.bucket = 'use_sections'     then t.j::text end)::jsonb,
           'nested',           max(case when t.bucket = 'nested'           then t.j::text end)::jsonb,
           'mostly_pictures',  max(case when t.bucket = 'mostly_pictures'  then t.j::text end)::jsonb)
    into v_tiles
    from (select s.bucket, jsonb_build_object('value', s.value, 'people_n', s.people_n) as j
            from public.layout_stats_weekly s
           where s.week = p_week and s.measure = 'tile') t;

  select coalesce(jsonb_agg(jsonb_build_object(
           'tool', split_part(s.bucket, '|', 1),
           'band', split_part(s.bucket, '|', 2),
           'share', s.value,
           'people_n', s.people_n)
         order by array_position(array['move','arrange','align','sections','arrows','pen','grid',
                                       'duplicate','copy_paste','undo','resize','rotate','layer',
                                       'multi_select'], split_part(s.bucket, '|', 1)),
                  array_position(array['5m','1d','7d','later'], split_part(s.bucket, '|', 2))),
         '[]'::jsonb)
    into v_tools
    from public.layout_stats_weekly s
   where s.week = p_week and s.measure = 'tool_by_age';

  return jsonb_build_object('week', to_char(p_week, 'YYYY-MM-DD'), 'tiles', v_tiles, 'tools', v_tools);
end $$;

revoke execute on function public.admin_layout_stats(date) from public, anon;
grant execute on function public.admin_layout_stats(date) to authenticated, service_role;

create or replace function public.admin_cluster_outlines(
  p_week     date,
  p_cards    text   default null,
  p_sections text   default null,
  p_level    text   default null,
  p_age      text   default null,
  p_has      text[] default null,
  p_sort     text   default 'newest',
  p_limit    integer default 48,
  p_offset   integer default 0
)
returns jsonb
language plpgsql
stable security definer
set search_path = public, pg_temp
as $$
declare
  v_sort   text := coalesce(p_sort, 'newest');
  v_limit  integer := least(greatest(coalesce(p_limit, 48), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total  integer;
  v_rows   jsonb;
begin
  perform public._require_admin();
  if p_week is null then
    raise exception 'p_week is required' using errcode = '22023';
  end if;
  if p_cards is not null and p_cards not in ('3-9', '10-29', '30-99', '100+') then
    raise exception 'unknown p_cards %', p_cards using errcode = '22023';
  end if;
  if p_sections is not null and p_sections not in ('with', 'without') then
    raise exception 'unknown p_sections %', p_sections using errcode = '22023';
  end if;
  if p_level is not null and p_level not in ('top', '2', '3+') then
    raise exception 'unknown p_level %', p_level using errcode = '22023';
  end if;
  if p_age is not null and p_age not in ('w1', 'w4', 'm3', 'old') then
    raise exception 'unknown p_age %', p_age using errcode = '22023';
  end if;
  if v_sort not in ('newest', 'cards', 'sections') then
    raise exception 'unknown p_sort %', p_sort using errcode = '22023';
  end if;

  with f as (
    select o.week, o.outline_id, o.frame, o.cards, o.sections, o.stats,
           (o.stats->>'cards')::int as n_cards,
           jsonb_array_length(o.sections) as n_sect,
           (o.stats->>'depth')::int as depth,
           array_position(array['w1','w4','m3','old'], o.stats->>'age') as age_pos
      from public.cluster_outlines o
     where o.week = p_week
  ),
  g as (
    select f.*
      from f
     where (p_cards is null
            or (p_cards = '3-9'   and f.n_cards between 3 and 9)
            or (p_cards = '10-29' and f.n_cards between 10 and 29)
            or (p_cards = '30-99' and f.n_cards between 30 and 99)
            or (p_cards = '100+'  and f.n_cards >= 100))
       and (p_sections is null
            or (p_sections = 'with'    and f.n_sect > 0)
            or (p_sections = 'without' and f.n_sect = 0))
       and (p_level is null
            or (p_level = 'top' and f.depth <= 1)
            or (p_level = '2'   and f.depth = 2)
            or (p_level = '3+'  and f.depth >= 3))
       and (p_age is null or f.stats->>'age' = p_age)
       and (p_has is null or cardinality(p_has) = 0 or (f.stats->'kinds') ?& p_has)
  )
  -- newest: youngest age band first; cards: most first; sections: most first,
  -- then most cards. outline_id breaks ties (it is random, so it says nothing).
  select (select count(*)::int from g),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'week', to_char(q.week, 'YYYY-MM-DD'), 'outline_id', q.outline_id,
                     'frame', q.frame, 'cards', q.cards, 'sections', q.sections, 'stats', q.stats)
                   order by q.k1, q.k2, q.outline_id)
                     from (select g.*,
                                  case v_sort when 'newest' then g.age_pos
                                              when 'cards' then -g.n_cards
                                              else -g.n_sect end as k1,
                                  case v_sort when 'sections' then -g.n_cards else 0 end as k2
                             from g
                            order by k1, k2, outline_id
                            limit v_limit offset v_offset) q), '[]'::jsonb)
    into v_total, v_rows;

  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;

revoke execute on function public.admin_cluster_outlines(date, text, text, text, text, text[], text, integer, integer) from public, anon;
grant execute on function public.admin_cluster_outlines(date, text, text, text, text, text[], text, integer, integer) to authenticated, service_role;

-- ── Crons ───────────────────────────────────────────────────────────────────

select cron.schedule('layout-weekly', '20 4 * * 1', $$select public._layout_weekly_run()$$);
select cron.schedule('purge-cluster-outlines', '41 3 * * *', $$select public.purge_old_cluster_outlines(400)$$);

-- ── Proof (the 0311 habit) ──────────────────────────────────────────────────
do $proof$
declare
  v_internal constant text[] := array[
    'public._layout_outline_epoch()',
    'public._layout_stats_compute(date)',
    'public._layout_outlines_compute(date)',
    'public._layout_weekly_run()',
    'public.purge_old_cluster_outlines(integer)'];
  v_client constant text[] := array[
    'public.set_layout_outlines(boolean)',
    'public.admin_layout_weeks()',
    'public.admin_layout_stats(date)',
    'public.admin_cluster_outlines(date,text,text,text,text,text[],text,integer,integer)'];
  v_sig text;
  v_tab text;
begin
  foreach v_sig in array v_internal || v_client loop
    if to_regprocedure(v_sig) is null then
      raise exception '0878: % is missing', v_sig;
    end if;
    if has_function_privilege('anon', v_sig, 'execute') then
      raise exception '0878: % is reachable signed out', v_sig;
    end if;
    if not has_function_privilege('service_role', v_sig, 'execute') then
      raise exception '0878: % lost its service_role grant', v_sig;
    end if;
  end loop;

  foreach v_sig in array v_internal loop
    if has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception '0878: % is client-callable', v_sig;
    end if;
  end loop;

  foreach v_sig in array v_client loop
    if not has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception '0878: % lost its authenticated grant', v_sig;
    end if;
    if v_sig like 'public.admin_%'
       and pg_get_functiondef(v_sig::regprocedure) not like '%perform public._require_admin();%' then
      raise exception '0878: % lost its admin gate', v_sig;
    end if;
  end loop;

  foreach v_tab in array array['public.layout_stats_weekly', 'public.cluster_outlines'] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = v_tab::regclass) then
      raise exception '0878: % has RLS off', v_tab;
    end if;
    if has_table_privilege('anon', v_tab, 'select,insert,update,delete')
       or has_table_privilege('authenticated', v_tab, 'select,insert,update,delete') then
      raise exception '0878: % is reachable from a client role', v_tab;
    end if;
  end loop;

  if not exists (select 1 from cron.job where jobname = 'layout-weekly' and active
                   and schedule = '20 4 * * 1'
                   and command = 'select public._layout_weekly_run()') then
    raise exception '0878: the weekly layout job is missing';
  end if;
  if not exists (select 1 from cron.job where jobname = 'purge-cluster-outlines' and active
                   and schedule = '41 3 * * *'
                   and command = 'select public.purge_old_cluster_outlines(400)') then
    raise exception '0878: the outline purge job is missing';
  end if;
end $proof$;

notify pgrst, 'reload schema';

commit;
