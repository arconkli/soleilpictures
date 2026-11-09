-- 0882_layout_who_left.sql
--
-- Layout outlines, part two (0878 is part one). The owner, 2026-11-09: "the
-- biggest help will be us seeing why people fell off". Two additions:
--
--   layout_return_weekly   for the people who joined over four weeks and had
--                          their first engaged visit in them, split by
--                          whether they came back within 7 days of that
--                          visit: what each side did on its first day (cards
--                          placed, and the share that used each canvas tool).
--                          Four weeks, because one week of new people rarely
--                          puts 20 on each side. A row exists only when its
--                          side has at least 20 people. No user, workspace
--                          or cluster column. Everyone counts, as in the
--                          weekly totals: these are counts of actions, not
--                          outlines.
--
--   first-week outlines    an outline made in the week its maker joined is
--                          marked first_week, and a week later came_back
--                          (true or false; null when it can't be known). To
--                          mark it, layout_outline_pending keeps the
--                          outline_id beside the maker's user_id until the
--                          label step a week later, which deletes the pair;
--                          purge_layout_outline_pending(7), hourly, deletes
--                          any pair the label missed, so no pair reaches the
--                          8 days the privacy policy states. That table is
--                          the only place an
--                          outline meets a person, and no client role can
--                          read it. Only for people who said yes to the words
--                          that say so (consent terms >= 2, which
--                          set_layout_outlines(p_ok, p_terms) now stores). A
--                          yes given to 0878's words is never linked. Saying
--                          no deletes the person's still-linked outlines.
--
-- "Came back" is the house's back_7d (0855): a second engaged visit (ek = 2)
-- that starts within 7 days of the first (ek = 1), from
-- _admin_engaged_visits(<week> - 1, true, true, 2) (0473: internal and
-- unverified accounts out, visits merged at 2 h, engaged = active seconds or
-- real work). "First day" is created_at to created_at + 24 h, and cards are
-- card_placed's n (1 when absent), both as 0855.
--
-- The weekly run (Mondays 04:20 UTC, for the week that just ended, w) now
-- does: totals for w, labels for w - 7, outlines for w, who came back for
-- the four weeks ending with w - 7. Those people had their first engaged
-- visit by the end of w - 7, so their 7 days are over when the run comes. The two new steps
-- run in blocks of their own: a failure there leaves the totals and the
-- outlines standing, and the warning names the step.
--
-- New functions are born with the 0311 grants (authenticated + service_role).
-- The internal ones lose authenticated; set_layout_outlines and the admin
-- RPCs keep it and never reach anon. The block at the end proves each.

begin;

set local lock_timeout = '3s';

-- ── Tables ──────────────────────────────────────────────────────────────────

alter table public.cluster_outlines
  add column if not exists first_week boolean not null default false,
  add column if not exists came_back  boolean;

comment on column public.cluster_outlines.first_week is
  'Layout outlines (0882): made in the week its maker joined, by someone who said yes to the words that say so (consent terms >= 2).';
comment on column public.cluster_outlines.came_back is
  'Layout outlines (0882): for a first_week outline, whether its maker came back within 7 days of their first engaged visit (0855 back_7d). Null until labelled, or when it cannot be known.';

create table if not exists public.layout_outline_pending (
  outline_id uuid        primary key references public.cluster_outlines (outline_id) on delete cascade,
  user_id    uuid        not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists layout_outline_pending_user_idx on public.layout_outline_pending (user_id);

create table if not exists public.layout_return_weekly (
  week        date    not null,
  joined_from date    not null,
  measure     text    not null check (measure in ('tile', 'tool')),
  bucket      text    not null,
  grp         text    not null check (grp in ('left', 'back')),
  value       numeric,
  people_n    integer not null check (people_n >= 20),
  primary key (week, measure, bucket, grp)
);

alter table public.layout_outline_pending enable row level security;
alter table public.layout_return_weekly   enable row level security;

revoke all on table public.layout_outline_pending from public, anon, authenticated;
revoke all on table public.layout_return_weekly   from public, anon, authenticated;

comment on table public.layout_outline_pending is
  'Layout outlines (0882): which person made a first-week outline, kept only until the weekly label step marks came_back (a week), then deleted; purge_layout_outline_pending(7), hourly, deletes any left, so none reaches 8 days. The only place an outline meets a person. No client role can read it.';
comment on table public.layout_return_weekly is
  'Layout outlines (0882): for the people who joined from joined_from to the end of week (four weeks, fewer at first: tools were recorded only from 0878), what those who left and those who came back within 7 days did on their first day. A row exists only when people_n >= 20. No user, workspace or cluster column. Read through admin_layout_return().';

-- ── Consent ─────────────────────────────────────────────────────────────────
-- p_terms is the version of the words the person answered: 1 is 0878's, 2
-- adds the first-week note. Builds before 0882 send no p_terms and get 1. The
-- one-argument version goes, so PostgREST sees a single function.

drop function if exists public.set_layout_outlines(boolean);

create or replace function public.set_layout_outlines(p_ok boolean, p_terms integer default 1)
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
  if p_terms is null or p_terms not between 1 and 2 then
    raise exception 'unknown p_terms %', p_terms using errcode = '22023';
  end if;
  -- 'at' is UTC ISO 8601 whatever the session's TimeZone, so the weekly run
  -- (which reads it back through pg_input_is_valid) and the app agree.
  v_obj := jsonb_build_object(
    'ok', p_ok,
    'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'terms', p_terms);
  insert into public.profiles (user_id, settings)
       values (v_uid, jsonb_build_object('layout_outlines', v_obj))
  on conflict (user_id)
       do update set settings = coalesce(public.profiles.settings, '{}'::jsonb)
                                || jsonb_build_object('layout_outlines', v_obj);
  -- No: the outlines still linked to this person (first-week ones waiting for
  -- their label) go now; their pairs go with them (on delete cascade).
  if not p_ok then
    delete from public.cluster_outlines o
     using public.layout_outline_pending lp
     where lp.outline_id = o.outline_id
       and lp.user_id = v_uid;
  end if;
  return v_obj;
end $$;

revoke execute on function public.set_layout_outlines(boolean, integer) from public, anon;
grant execute on function public.set_layout_outlines(boolean, integer) to authenticated, service_role;

-- ── Outlines ────────────────────────────────────────────────────────────────
-- 0878's body, plus: cand carries the maker and whether this is their first
-- week (joined in p_week, and said yes to terms >= 2); the insert gives each
-- row its outline_id up front, goes in in random order, and a first-week row
-- gets its pending pair in the same statement.

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
    select b.id, b.workspace_id, b.created_at, b.created_by,
           (u.created_at >= v_from and u.created_at < v_to
            and case when jsonb_typeof(pc.settings->'layout_outlines'->'terms') = 'number'
                     then (pc.settings->'layout_outlines'->>'terms')::numeric >= 2
                     else false end) as first_week
      from public.boards b
      join public.profiles pc on pc.user_id = b.created_by
      join auth.users u on u.id = b.created_by
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
    select c.id, c.workspace_id, c.created_at, c.created_by, c.first_week, r.depth
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
  ),
  -- Each outline's id is drawn here, so the pending pair can name it.
  fresh as materialized (
    select gen_random_uuid() as outline_id, e.created_by as maker, e.first_week,
           jsonb_build_object(
             'w', greatest(1, round(b.bw * 200 / greatest(b.bw, b.bh)))::int,
             'h', greatest(1, round(b.bh * 200 / greatest(b.bw, b.bh)))::int) as frame,
           cj.cards,
           coalesce(sj.sections, '[]'::jsonb) as sections,
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
             'grids',    cj.grids) as stats
      from eligible e
      join box b    on b.board_id  = e.id
      join cardj cj on cj.board_id = e.id
      join kinds kd on kd.board_id = e.id
      left join sectj sj on sj.board_id = e.id
  ),
  ins as (
    insert into public.cluster_outlines (outline_id, week, frame, cards, sections, stats, first_week)
    select f.outline_id, p_week, f.frame, f.cards, f.sections, f.stats, f.first_week
      from fresh f
     order by random()
    returning outline_id
  ),
  pend as (
    insert into public.layout_outline_pending (outline_id, user_id)
    select i.outline_id, f.maker
      from ins i
      join fresh f on f.outline_id = i.outline_id
     where f.first_week
    returning outline_id
  )
  select count(*)::int into v_n from ins;

  return v_n;
end $$;

revoke execute on function public._layout_outlines_compute(date) from public, anon, authenticated;

-- ── Labels ──────────────────────────────────────────────────────────────────
-- For the first-week outlines of p_week: did the maker come back? Null when
-- they had no engaged visit, or the 7 days after their first one end after
-- p_week + 14 days (the run comes then). Then every pair of p_week or before
-- is deleted, labelled or not.

create or replace function public._layout_outlines_label(p_week date)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_end timestamptz;
  v_n   integer := 0;
begin
  if p_week is null or extract(isodow from p_week) <> 1 then
    raise exception 'layout label: week must be a Monday' using errcode = '22023';
  end if;
  v_end := (p_week + 14)::timestamp at time zone 'utc';

  if exists (select 1
               from public.layout_outline_pending lp
               join public.cluster_outlines o on o.outline_id = lp.outline_id
              where o.week = p_week) then
    with pend as (
      select lp.outline_id, lp.user_id
        from public.layout_outline_pending lp
        join public.cluster_outlines o on o.outline_id = lp.outline_id
       where o.week = p_week
    ),
    ev as materialized (
      select v.user_id, v.ek, v.first_at
        from public._admin_engaged_visits(p_week - 1, true, true, 2) v
       where v.engaged and v.user_id in (select pend.user_id from pend)
    ),
    lab as (
      select p.outline_id,
             case when e1.at is null or e1.at + interval '7 days' > v_end then null
                  else exists (select 1 from ev x
                                where x.user_id = p.user_id and x.ek = 2
                                  and x.first_at <= e1.at + interval '7 days')
             end as back
        from pend p
        cross join lateral (select min(x.first_at) as at from ev x
                             where x.user_id = p.user_id and x.ek = 1) e1
    )
    update public.cluster_outlines o
       set came_back = lab.back
      from lab
     where o.outline_id = lab.outline_id;
    get diagnostics v_n = row_count;
  end if;

  delete from public.layout_outline_pending lp
   using public.cluster_outlines o
   where o.outline_id = lp.outline_id
     and o.week <= p_week;

  return v_n;
end $$;

revoke execute on function public._layout_outlines_label(date) from public, anon, authenticated;

-- ── Who came back ───────────────────────────────────────────────────────────
-- p_week is the last of the four weeks the people joined in: one week of new
-- people rarely puts 20 on each side. The tool names are the same mapping as
-- _layout_stats_compute (0878); layoutOutlinesSql.test.mjs holds them equal.

create or replace function public._layout_return_compute(p_week date)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_from  timestamptz;
  v_to    timestamptz;
  v_start timestamptz;
  v_day   date;
  v_n     integer := 0;
begin
  if p_week is null or extract(isodow from p_week) <> 1 then
    raise exception 'layout return: week must be a Monday' using errcode = '22023';
  end if;
  v_from := (p_week - 21)::timestamp at time zone 'utc';
  v_to   := (p_week + 7)::timestamp at time zone 'utc';

  delete from public.layout_return_weekly where week = p_week;

  -- Preview and dev events never reach analytics_events (0470), so its first
  -- canvas_tool row is when the live app began recording tools. Anyone who
  -- joined before that would look as if they had used none.
  select min(e.occurred_at) into v_start
    from public.analytics_events e
   where e.event = 'canvas_tool';
  if v_start is null or v_start >= v_to then
    return 0;
  end if;
  -- The first weeks after that are a shorter span; joined_from says so.
  v_from := greatest(v_from, v_start);
  v_day  := (v_from at time zone 'utc')::date;

  with ex as materialized (
    select x.user_id from public._admin_test_excluded() x
  ),
  pop as (
    select u.id as user_id, u.created_at
      from auth.users u
     where u.created_at >= v_from
       and u.created_at < v_to
       and u.id not in (select ex.user_id from ex)
       and not public._is_service_identity(u.id)
  ),
  ev as materialized (
    select v.user_id, v.ek, v.first_at
      from public._admin_engaged_visits(p_week - 22, true, true, 2) v
     where v.engaged and v.user_id in (select pop.user_id from pop)
  ),
  per as materialized (
    select p.user_id, p.created_at,
           case when exists (select 1 from ev x
                              where x.user_id = p.user_id and x.ek = 2
                                and x.first_at <= e1.at + interval '7 days')
                then 'back' else 'left' end as grp
      from pop p
      cross join lateral (select min(x.first_at) as at from ev x
                           where x.user_id = p.user_id and x.ek = 1) e1
     where e1.at is not null
       and e1.at < v_to
  ),
  -- Day one only: the event's name, its action and its count, nothing else.
  d1 as (
    select e.user_id, e.event, e.props->>'action' as act,
           case when e.props->>'n' ~ '^[0-9]{1,6}$' then (e.props->>'n')::int else 1 end as n
      from public.analytics_events e
      join per pr on pr.user_id = e.user_id
     where e.event in ('card_placed', 'canvas_tool', 'arrow_created')
       and e.occurred_at >= v_from
       and e.occurred_at < v_to + interval '1 day'
       and e.occurred_at >= pr.created_at
       and e.occurred_at < pr.created_at + interval '24 hours'
  ),
  cards as (
    select pr.user_id, pr.grp,
           coalesce((select sum(d.n) from d1 d
                      where d.user_id = pr.user_id and d.event = 'card_placed'), 0) as n
      from per pr
  ),
  used as (
    select distinct d.user_id,
           case
             when d.event = 'arrow_created' then 'arrows'
             when d.event <> 'canvas_tool' then null
             when d.act = 'move' then 'move'
             when d.act = 'tidy' then 'arrange'
             when d.act in ('align', 'distribute') then 'align'
             when d.act in ('section_add', 'section_remove') then 'sections'
             when d.act = 'draw' then 'pen'
             when d.act in ('grid_split', 'grid_merge', 'grid_fill') then 'grid'
             when d.act = 'duplicate' then 'duplicate'
             when d.act in ('copy', 'cut', 'paste') then 'copy_paste'
             when d.act in ('undo', 'redo') then 'undo'
             when d.act = 'resize' then 'resize'
             when d.act = 'rotate' then 'rotate'
             when d.act = 'zorder' then 'layer'
             when d.act = 'select_many' then 'multi_select'
           end as tool
      from d1 d
  ),
  sized as (
    select c.grp, count(*)::int as people from cards c group by c.grp
  ),
  tiles as (
    select 'people'::text as bucket, z.grp, z.people::numeric as value, z.people as people_n
      from sized z
    union all
    select 'cards_d1', c.grp, percentile_cont(0.5) within group (order by c.n)::numeric, count(*)::int
      from cards c group by c.grp
    union all
    select 'ten_d1', c.grp, round(avg(case when c.n >= 10 then 1 else 0 end)::numeric, 4), count(*)::int
      from cards c group by c.grp
  ),
  -- Every tool on both sides, zeros included, so "nobody who left used it"
  -- reads as 0% and not as a gap.
  tools as (
    select t.tool as bucket, z.grp,
           round((select count(*) from cards c join used u on u.user_id = c.user_id
                   where c.grp = z.grp and u.tool = t.tool)::numeric / z.people, 4) as value,
           z.people as people_n
      from sized z
      cross join unnest(array['move', 'arrange', 'align', 'sections', 'arrows', 'pen', 'grid',
                              'duplicate', 'copy_paste', 'undo', 'resize', 'rotate', 'layer',
                              'multi_select']) as t(tool)
  )
  insert into public.layout_return_weekly (week, joined_from, measure, bucket, grp, value, people_n)
  select p_week, v_day, 'tile', t.bucket, t.grp, t.value, t.people_n from tiles t where t.people_n >= 20
  union all
  select p_week, v_day, 'tool', o.bucket, o.grp, o.value, o.people_n from tools o where o.people_n >= 20;
  get diagnostics v_n = row_count;

  return v_n;
end $$;

revoke execute on function public._layout_return_compute(date) from public, anon, authenticated;

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
  begin
    perform public._layout_outlines_label(v_week - 7);
  exception when others then
    raise warning 'layout weekly run: labels for % failed: %', v_week - 7, sqlerrm;
  end;
  perform public._layout_outlines_compute(v_week);
  begin
    perform public._layout_return_compute(v_week - 7);
  exception when others then
    raise warning 'layout weekly run: who came back for % failed: %', v_week - 7, sqlerrm;
  end;
end $$;

revoke execute on function public._layout_weekly_run() from public, anon, authenticated;

-- The privacy policy says a pair is kept for up to 8 days. The label deletes
-- it after 7 (the next weekly run). This purge, hourly at :13, deletes any
-- pair older than 7 days, so none outlives 7 days and an hour; :13 keeps it
-- clear of the 04:20 run that labels a pair made exactly 7 days before.
create or replace function public.purge_layout_outline_pending(p_days integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  delete from public.layout_outline_pending
   where created_at < now() - make_interval(days => greatest(coalesce(p_days, 7), 1));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke execute on function public.purge_layout_outline_pending(integer) from public, anon, authenticated;

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
           'stats',    s.week is not null,
           'return',   r.week is not null)
         order by wk.week desc), '[]'::jsonb)
    into v_out
    from (select u.week
            from (select week from public.cluster_outlines
                  union
                  select week from public.layout_stats_weekly
                  union
                  select week from public.layout_return_weekly) u
           order by u.week desc
           limit 104) wk
    left join (select week, count(*)::int as n from public.cluster_outlines group by week) o
           on o.week = wk.week
    left join (select distinct week from public.layout_stats_weekly) s
           on s.week = wk.week
    left join (select distinct week from public.layout_return_weekly) r
           on r.week = wk.week;

  return v_out;
end $$;

revoke execute on function public.admin_layout_weeks() from public, anon;
grant execute on function public.admin_layout_weeks() to authenticated, service_role;

-- {week, joined_from, tiles: {people|cards_d1|ten_d1: {left, back}},
--  tools: [{tool, left, back}]}: the people who joined from joined_from to the
-- end of week, each side {value, people_n}, or null when that side had fewer
-- than 20 people. joined_from is null when the week has no rows.
create or replace function public.admin_layout_return(p_week date)
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

  select jsonb_object_agg(b.bucket, jsonb_build_object(
           'left', (select jsonb_build_object('value', r.value, 'people_n', r.people_n)
                      from public.layout_return_weekly r
                     where r.week = p_week and r.measure = 'tile' and r.bucket = b.bucket and r.grp = 'left'),
           'back', (select jsonb_build_object('value', r.value, 'people_n', r.people_n)
                      from public.layout_return_weekly r
                     where r.week = p_week and r.measure = 'tile' and r.bucket = b.bucket and r.grp = 'back')))
    into v_tiles
    from unnest(array['people', 'cards_d1', 'ten_d1']) as b(bucket);

  select coalesce(jsonb_agg(jsonb_build_object(
           'tool', t.tool,
           'left', (select jsonb_build_object('value', r.value, 'people_n', r.people_n)
                      from public.layout_return_weekly r
                     where r.week = p_week and r.measure = 'tool' and r.bucket = t.tool and r.grp = 'left'),
           'back', (select jsonb_build_object('value', r.value, 'people_n', r.people_n)
                      from public.layout_return_weekly r
                     where r.week = p_week and r.measure = 'tool' and r.bucket = t.tool and r.grp = 'back'))
         order by t.ord), '[]'::jsonb)
    into v_tools
    from unnest(array['move', 'arrange', 'align', 'sections', 'arrows', 'pen', 'grid',
                      'duplicate', 'copy_paste', 'undo', 'resize', 'rotate', 'layer',
                      'multi_select']) with ordinality as t(tool, ord)
   where exists (select 1 from public.layout_return_weekly r
                  where r.week = p_week and r.measure = 'tool' and r.bucket = t.tool);

  return jsonb_build_object(
    'week',        to_char(p_week, 'YYYY-MM-DD'),
    'joined_from', (select to_char(min(r.joined_from), 'YYYY-MM-DD')
                      from public.layout_return_weekly r where r.week = p_week),
    'tiles',       v_tiles,
    'tools',       v_tools);
end $$;

revoke execute on function public.admin_layout_return(date) from public, anon;
grant execute on function public.admin_layout_return(date) to authenticated, service_role;

-- 0878's list plus p_who: 'left' and 'back' are first-week outlines whose
-- maker left or came back; 'older' is every outline that is not first-week.
-- The nine-argument version goes, so PostgREST sees a single function.

drop function if exists public.admin_cluster_outlines(date, text, text, text, text, text[], text, integer, integer);

create or replace function public.admin_cluster_outlines(
  p_week     date,
  p_cards    text    default null,
  p_sections text    default null,
  p_level    text    default null,
  p_age      text    default null,
  p_has      text[]  default null,
  p_sort     text    default 'newest',
  p_limit    integer default 48,
  p_offset   integer default 0,
  p_who      text    default null
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
  if p_who is not null and p_who not in ('left', 'back', 'older') then
    raise exception 'unknown p_who %', p_who using errcode = '22023';
  end if;
  if v_sort not in ('newest', 'cards', 'sections') then
    raise exception 'unknown p_sort %', p_sort using errcode = '22023';
  end if;

  with f as (
    select o.week, o.outline_id, o.frame, o.cards, o.sections, o.stats, o.first_week, o.came_back,
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
       and (p_who is null
            or (p_who = 'left'  and f.first_week and f.came_back = false)
            or (p_who = 'back'  and f.first_week and f.came_back = true)
            or (p_who = 'older' and not f.first_week))
  )
  -- newest: youngest age band first; cards: most first; sections: most first,
  -- then most cards. outline_id breaks ties (it is random, so it says nothing).
  select (select count(*)::int from g),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'week', to_char(q.week, 'YYYY-MM-DD'), 'outline_id', q.outline_id,
                     'frame', q.frame, 'cards', q.cards, 'sections', q.sections, 'stats', q.stats,
                     'first_week', q.first_week, 'came_back', q.came_back)
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

revoke execute on function public.admin_cluster_outlines(date, text, text, text, text, text[], text, integer, integer, text) from public, anon;
grant execute on function public.admin_cluster_outlines(date, text, text, text, text, text[], text, integer, integer, text) to authenticated, service_role;

-- ── Crons ───────────────────────────────────────────────────────────────────

select cron.schedule('purge-layout-outline-pending', '13 * * * *', $$select public.purge_layout_outline_pending(7)$$);

-- ── Proof (the 0311 habit) ──────────────────────────────────────────────────
do $proof$
declare
  v_internal constant text[] := array[
    'public._layout_outlines_compute(date)',
    'public._layout_outlines_label(date)',
    'public._layout_return_compute(date)',
    'public._layout_weekly_run()',
    'public.purge_layout_outline_pending(integer)'];
  v_client constant text[] := array[
    'public.set_layout_outlines(boolean,integer)',
    'public.admin_layout_weeks()',
    'public.admin_layout_return(date)',
    'public.admin_cluster_outlines(date,text,text,text,text,text[],text,integer,integer,text)'];
  v_sig text;
  v_tab text;
begin
  foreach v_sig in array v_internal || v_client loop
    if to_regprocedure(v_sig) is null then
      raise exception '0882: % is missing', v_sig;
    end if;
    if has_function_privilege('anon', v_sig, 'execute') then
      raise exception '0882: % is reachable signed out', v_sig;
    end if;
    if not has_function_privilege('service_role', v_sig, 'execute') then
      raise exception '0882: % lost its service_role grant', v_sig;
    end if;
  end loop;

  foreach v_sig in array v_internal loop
    if has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception '0882: % is client-callable', v_sig;
    end if;
  end loop;

  foreach v_sig in array v_client loop
    if not has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception '0882: % lost its authenticated grant', v_sig;
    end if;
    if v_sig like 'public.admin_%'
       and pg_get_functiondef(v_sig::regprocedure) not like '%perform public._require_admin();%' then
      raise exception '0882: % lost its admin gate', v_sig;
    end if;
  end loop;

  if to_regprocedure('public.set_layout_outlines(boolean)') is not null then
    raise exception '0882: the one-argument set_layout_outlines is still there';
  end if;
  if to_regprocedure('public.admin_cluster_outlines(date,text,text,text,text,text[],text,integer,integer)') is not null then
    raise exception '0882: the nine-argument admin_cluster_outlines is still there';
  end if;

  foreach v_tab in array array['public.cluster_outlines', 'public.layout_outline_pending',
                               'public.layout_return_weekly'] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = v_tab::regclass) then
      raise exception '0882: % has RLS off', v_tab;
    end if;
    if has_table_privilege('anon', v_tab, 'select,insert,update,delete')
       or has_table_privilege('authenticated', v_tab, 'select,insert,update,delete') then
      raise exception '0882: % is reachable from a client role', v_tab;
    end if;
  end loop;

  if not exists (select 1 from cron.job where jobname = 'layout-weekly' and active
                   and schedule = '20 4 * * 1'
                   and command = 'select public._layout_weekly_run()') then
    raise exception '0882: the weekly layout job is missing';
  end if;
  if not exists (select 1 from cron.job where jobname = 'purge-layout-outline-pending' and active
                   and schedule = '13 * * * *'
                   and command = 'select public.purge_layout_outline_pending(7)') then
    raise exception '0882: the pending purge job is missing';
  end if;
end $proof$;

notify pgrst, 'reload schema';

commit;
