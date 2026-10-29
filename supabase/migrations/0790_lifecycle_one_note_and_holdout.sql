-- 0790 — lifecycle email: one note each, their own things in it, half held back.
--
-- The testing map's lifecycle line (the owner's picks of 2026-10-28):
--
--   1. activate_nudge_1 and welcome_board stop rotating 5 subjects x 4 bodies
--      (0219). At their volume twenty arms never resolved anything, so each
--      becomes ONE note: welcome_board keeps the subject that opened best
--      ("look what you made") with the body that brought people back best,
--      and activate_nudge_1 gets a new note built on what the person added.
--      board_waiting stops its A/B the same way. All three go flat with one
--      arm, "c1", so a send from here on is told apart from the old "A"/"B"
--      and "s1.b1" rows in lifecycle_email_log. The factorial stats move under
--      `retired` (the log keeps every row anyway), and the optimizer's flat
--      path (lifecycle_email_optimize) gives a single arm weight 100.
--
--   2. Half of the people due activate_nudge_1 or board_waiting are held back
--      for six weeks, to learn whether either brings anyone back at all.
--      lifecycle_claim_send (0359) already does the drawing: holdout_pct per
--      type, decided by hashtext(user id || ':' || type), so the same person
--      is always in the same group for a type, and the coin is not shared
--      with any in-app test (experiments.js draws cyrb53 of its own keys).
--      board_waiting was holding back 20; the same draw at 50 keeps those
--      people held back and adds more. holdout_from (the day this applies)
--      and holdout_weeks are for the read; nothing switches the hold-back off
--      by itself, the owner does after the read.
--
--   3. Two internal reads for the new content, both service_role only:
--
--      _lifecycle_email_added(user, board, any_board) — what is on the board
--        the email is about: counts by kind, and up to four things to show
--        (pictures first, then the newest). With any_board (activate_nudge_1)
--        the board is the one holding their newest card among the live boards
--        they made, else the board passed in. Only cards the person (or their
--        collaborators) added count: the starter cards are 'onb-' ids. A
--        label is the card's own title or file name, never a note's body and
--        never a picture's description; pictures carry no label at all.
--
--      _lifecycle_email_card_pic(board, card) — the stored picture the
--        /api/email-card Worker route serves for one card: the small preview,
--        else the larger one, else the original when it is a web image
--        (WebP, JPEG, PNG or GIF) of 1.5 MB or less; the Worker refuses any
--        object over 1.5 MB whichever it is. Nothing when the board is deleted, the card is gone,
--        it is a starter card, or the picture is outside the board's own
--        workspace (card_index is written by the app, so a card's src is only
--        trusted inside its own workspace).
--
-- No eligibility RPC (lifecycle_due_*) and no claim signature changes.
-- Either deploy order is safe: the old templates read a "c1" variant as their
-- control arms, and the new templates ignore the variant for these types.

begin;

set local lock_timeout = '3s';

-- ── 1 + 2. The experiment config ─────────────────────────────────────────────
do $$
declare
  v_n int;
begin
  update public.app_config c
     set value = c.value || jsonb_build_object(
           'activate_nudge_1',
             ((c.value -> 'activate_nudge_1') - 'factors') || jsonb_build_object(
               'arms',          jsonb_build_array('c1'),
               'weights',       jsonb_build_object('c1', 100),
               'stats',         '{}'::jsonb,
               'holdout_pct',   50,
               'holdout_from',  to_jsonb(current_date::text),
               'holdout_weeks', 6,
               'retired',       jsonb_build_object(
                                  'on', to_jsonb(current_date::text),
                                  'factors', c.value -> 'activate_nudge_1' -> 'factors')),
           'welcome_board',
             ((c.value -> 'welcome_board') - 'factors') || jsonb_build_object(
               'arms',          jsonb_build_array('c1'),
               'weights',       jsonb_build_object('c1', 100),
               'stats',         '{}'::jsonb,
               'retired',       jsonb_build_object(
                                  'on', to_jsonb(current_date::text),
                                  'factors', c.value -> 'welcome_board' -> 'factors')),
           'board_waiting',
             (c.value -> 'board_waiting') || jsonb_build_object(
               'arms',          jsonb_build_array('c1'),
               'weights',       jsonb_build_object('c1', 100),
               'stats',         '{}'::jsonb,
               'holdout_pct',   50,
               'holdout_from',  to_jsonb(current_date::text),
               'holdout_weeks', 6,
               'retired',       jsonb_build_object(
                                  'on', to_jsonb(current_date::text),
                                  'arms', c.value -> 'board_waiting' -> 'arms',
                                  'stats', c.value -> 'board_waiting' -> 'stats'))
         ),
         updated_at = now()
   where c.key = 'lifecycle_email_experiments'
     and c.value ? 'activate_nudge_1'
     and c.value ? 'welcome_board'
     and c.value ? 'board_waiting';
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception '0790: lifecycle_email_experiments is missing a type (updated % rows)', v_n;
  end if;
end
$$;

-- ── 3a. The picture behind one card ──────────────────────────────────────────
create or replace function public._lifecycle_email_card_pic(p_board_id uuid, p_card_id text)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  select jsonb_build_object('key', k.key, 'w', k.w, 'h', k.h)
    from (
      select case
               when nullif(i.preview_sm_path, '') is not null then i.preview_sm_path
               when nullif(i.preview_path, '') is not null then i.preview_path
               when i.size_bytes between 1 and 1500000
                    and i.storage_path ~* '\.(webp|jpg|jpeg|jpe|jfif|png|gif)$' then i.storage_path
             end as key,
             coalesce(i.width,
                      case when c.meta ->> 'w' ~ '^\d{1,5}$' then (c.meta ->> 'w')::int end) as w,
             coalesce(i.height,
                      case when c.meta ->> 'h' ~ '^\d{1,5}$' then (c.meta ->> 'h')::int end) as h
        from public.boards b
        join public.card_index c
          on c.board_id = b.id and c.card_id = p_card_id
        join public.images i
          on i.storage_path = regexp_replace(
               case c.kind when 'video' then c.meta ->> 'poster' else c.meta ->> 'src' end,
               '^r2:', '')
       where b.id = p_board_id
         and b.deleted_at is null
         and c.card_id not like 'onb-%'
         and c.kind in ('image', 'video', 'pdf')
         and i.deleted_at is null
         and i.workspace_id = b.workspace_id
       limit 1
    ) k
   where k.key is not null
$function$;

-- ── 3b. What is on the board an email is about ───────────────────────────────
create or replace function public._lifecycle_email_added(
  p_user_id   uuid,
  p_board_id  uuid,
  p_any_board boolean default false
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  -- The kinds a person adds and would call "things": not the layout ones
  -- (grids, shapes, palettes, sub-cluster cards).
  c_kinds  constant text[] := array['image', 'video', 'note', 'link', 'file', 'pdf', 'doc', 'audio'];
  v_board  uuid := p_board_id;
  v_found  uuid;
  v_name   text;
  v_ws     uuid;
  v_counts jsonb;
  v_items  jsonb;
begin
  if p_any_board and p_user_id is not null then
    select ci.board_id into v_found
      from public.boards b
      join public.card_index ci on ci.board_id = b.id
     where b.created_by = p_user_id
       and b.deleted_at is null
       and ci.card_id not like 'onb-%'
       and ci.kind = any (c_kinds)
     order by ci.created_at desc nulls last, ci.card_id
     limit 1;
    v_board := coalesce(v_found, p_board_id);
  end if;
  if v_board is null then
    return null;
  end if;

  select b.name, b.workspace_id into v_name, v_ws
    from public.boards b
   where b.id = v_board and b.deleted_at is null;
  if not found then
    return null;
  end if;

  select coalesce(jsonb_object_agg(k.kind, k.n), '{}'::jsonb) into v_counts
    from (select ci.kind, count(*)::int as n
            from public.card_index ci
           where ci.board_id = v_board
             and ci.card_id not like 'onb-%'
             and ci.kind = any (c_kinds)
           group by ci.kind) k;

  -- A dozen newest picture cards and the four newest others are the only
  -- candidates, so a board of thousands looks up a dozen pictures, not all.
  with cand as (
    (select ci.card_id, ci.kind, ci.title, ci.meta, ci.created_at
       from public.card_index ci
      where ci.board_id = v_board
        and ci.card_id not like 'onb-%'
        and ci.kind in ('image', 'video', 'pdf')
      order by ci.created_at desc nulls last, ci.card_id
      limit 12)
    union all
    (select ci.card_id, ci.kind, ci.title, ci.meta, ci.created_at
       from public.card_index ci
      where ci.board_id = v_board
        and ci.card_id not like 'onb-%'
        and ci.kind in ('note', 'link', 'file', 'doc', 'audio')
      order by ci.created_at desc nulls last, ci.card_id
      limit 4)
  ),
  scored as (
    select c.card_id, c.kind, c.created_at,
           p.pic is not null as has_pic,
           (p.pic ->> 'w')::int as w,
           (p.pic ->> 'h')::int as h,
           case
             when c.kind = 'image' then null
             else nullif(left(btrim(regexp_replace(
                    coalesce(nullif(btrim(c.title), ''),
                             case c.kind
                               when 'file'  then c.meta ->> 'fileName'
                               when 'video' then c.meta ->> 'fileName'
                               when 'pdf'   then c.meta ->> 'name'
                             end, ''),
                    '\s+', ' ', 'g')), 40), '')
           end as label
      from cand c
      left join lateral (
        select public._lifecycle_email_card_pic(v_board, c.card_id) as pic
         where c.kind in ('image', 'video', 'pdf')
           and c.card_id ~ '^[A-Za-z0-9_-]{1,80}$'
      ) p on true
  ),
  top4 as (
    select s.*, row_number() over (order by s.has_pic desc, s.created_at desc nulls last, s.card_id) as ord
      from scored s
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'card_id', t.card_id,
           'kind',    t.kind,
           'pic',     t.has_pic,
           'label',   case when t.has_pic then null else t.label end,
           'w',       t.w,
           'h',       t.h) order by t.ord), '[]'::jsonb)
    into v_items
    from top4 t
   where t.ord <= 4;

  return jsonb_build_object(
    'board_id',     v_board,
    'workspace_id', v_ws,
    'board_name',   v_name,
    'counts',       v_counts,
    'items',        v_items);
end
$function$;

-- Internal helpers: the cron (service role) and the Worker (service role) only.
revoke execute on function public._lifecycle_email_card_pic(uuid, text) from public, anon, authenticated;
revoke execute on function public._lifecycle_email_added(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public._lifecycle_email_card_pic(uuid, text) to service_role;
grant execute on function public._lifecycle_email_added(uuid, uuid, boolean) to service_role;

-- ── Proof (the 0311 habit: a REVOKE reporting success proves nothing) ─────────
do $$
declare
  f   text;
  cfg jsonb;
begin
  foreach f in array array[
    'public._lifecycle_email_card_pic(uuid, text)',
    'public._lifecycle_email_added(uuid, uuid, boolean)'
  ] loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception '0790: anon can execute %', f;
    end if;
    if has_function_privilege('authenticated', f, 'execute') then
      raise exception '0790: authenticated can execute %', f;
    end if;
    if not has_function_privilege('service_role', f, 'execute') then
      raise exception '0790: service_role cannot execute %', f;
    end if;
  end loop;

  select value into cfg from public.app_config where key = 'lifecycle_email_experiments';
  if cfg -> 'activate_nudge_1' ? 'factors' or cfg -> 'welcome_board' ? 'factors' then
    raise exception '0790: a factorial type still carries factors';
  end if;
  if cfg -> 'activate_nudge_1' -> 'arms' <> '["c1"]'::jsonb
     or cfg -> 'welcome_board' -> 'arms' <> '["c1"]'::jsonb
     or cfg -> 'board_waiting' -> 'arms' <> '["c1"]'::jsonb then
    raise exception '0790: a type is not on the single arm c1';
  end if;
  if (cfg -> 'activate_nudge_1' ->> 'holdout_pct') is distinct from '50'
     or (cfg -> 'board_waiting' ->> 'holdout_pct') is distinct from '50' then
    raise exception '0790: the hold-back is not half';
  end if;
  if cfg -> 'welcome_board' ? 'holdout_pct' then
    raise exception '0790: welcome_board holds nobody back';
  end if;
end
$$;

commit;
