-- 0240_schedule_rpcs.sql — moving a shoot day, publishing a call sheet, and
-- telling the crew.
--
-- Background. 0238 gave a cluster a date; 0239 gave the app a durable
-- notification. This is the layer between them: the only three writes that may
-- touch boards.sched_* (they are not client-writable by design), plus the one
-- read a crew member actually wants — "what's in MY schedule".
--
-- WHEN THE CREW HEARS ABOUT IT. Not on every keystroke. A schedule card
-- re-syncs card_index every ~10s while someone types, so notifying on content
-- change means a storm, and a call sheet that pings 40 times is a call sheet
-- nobody opens. Instead:
--
--   • a DATE MOVE notifies immediately and automatically — it is structural,
--     and a day that quietly changed underneath the crew is the exact failure a
--     call sheet exists to prevent;
--   • CONTENT notifies when someone publishes, which bumps a version. "Day 12 —
--     call sheet v3" is the unit productions already work in.
--
-- Both are gated on sched_status='published'. A schedule still being built is
-- silent: you can lay out twelve weeks, drag days around, and nobody is told
-- anything until you publish. That gate is the whole reason this is usable on a
-- board shared with a hundred people.

-- Range scans for list_my_schedule ("the next 60 days"). The 0238 index leads
-- with parent_board_id and can't serve a bare date range.
create index if not exists boards_scheduled_date_idx
  on public.boards (scheduled_date)
  where scheduled_date is not null and deleted_at is null;

-- ── Display helper ───────────────────────────────────────────────────────────
-- "Day 12 — Tue Aug 18". day_label is the durable half of a day's identity and
-- boards.name the fallback; the DATE is never stored in either (see 0238), so a
-- moved day can't leave a stale title behind — it is always rendered fresh.
create or replace function public._sched_day_title(
  p_label text, p_name text, p_date date
) returns text
language sql immutable set search_path = public as $$
  select coalesce(nullif(trim(coalesce(p_label, '')), ''), p_name, 'Shoot day')
      || case when p_date is null then ''
              else ' — ' || to_char(p_date, 'Dy Mon FMDD') end;
$$;

-- ── Move / schedule a day ────────────────────────────────────────────────────
-- The ONLY path that writes boards.scheduled_date. Returns
-- {ok, prev_date, date, notified, published} so the client can render an
-- accurate undo toast without a re-fetch.
create or replace function public.set_board_schedule(
  p_board_id   uuid,
  p_date       date,
  p_end_date   date default null,
  p_day_label  text default null,
  p_notify     boolean default true
) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  v_actor  uuid := auth.uid();
  b        record;
  v_parent record;
  v_prev   date;
  v_moved  boolean;
  v_sent   int := 0;
  v_label  text;
begin
  if v_actor is null then return jsonb_build_object('ok', false, 'error', 'unauthenticated'); end if;
  if p_board_id is null then return jsonb_build_object('ok', false, 'error', 'missing_board'); end if;
  if not public.can_write_board(p_board_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select id, workspace_id, parent_board_id, name, day_label,
         scheduled_date, scheduled_end, sched_status, sched_version
    into b
    from public.boards
   where id = p_board_id and deleted_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  if p_end_date is not null and p_date is not null and p_end_date < p_date then
    return jsonb_build_object('ok', false, 'error', 'end_before_start');
  end if;

  v_prev  := b.scheduled_date;
  v_moved := v_prev is distinct from p_date;
  v_label := coalesce(p_day_label, b.day_label);

  update public.boards
     set scheduled_date = p_date,
         scheduled_end  = p_end_date,
         day_label      = v_label,
         -- Without this the /api/v1 change feed (GET /boards?since=, ordered by
         -- updated_at) never surfaces a move to a synchroniser.
         updated_at     = now()
   where id = p_board_id;

  -- Match move_boards_under's auditing so a date change is as traceable as a
  -- reparent. META_TRACKED_FIELDS in boardsApi.js covers the client-side edits;
  -- these columns are RPC-only, so the RPC owns their history.
  if v_moved then
    insert into public.board_meta_history (board_id, workspace_id, field, before_value, after_value, changed_by)
    values (p_board_id, b.workspace_id, 'scheduled_date', to_jsonb(v_prev), to_jsonb(p_date), v_actor);
  end if;
  if b.scheduled_end is distinct from p_end_date then
    insert into public.board_meta_history (board_id, workspace_id, field, before_value, after_value, changed_by)
    values (p_board_id, b.workspace_id, 'scheduled_end', to_jsonb(b.scheduled_end), to_jsonb(p_end_date), v_actor);
  end if;
  if b.day_label is distinct from v_label then
    insert into public.board_meta_history (board_id, workspace_id, field, before_value, after_value, changed_by)
    values (p_board_id, b.workspace_id, 'day_label', to_jsonb(b.day_label), to_jsonb(v_label), v_actor);
  end if;

  -- Only a PUBLISHED day interrupts anyone. Building a schedule is silent.
  if p_notify and v_moved and b.sched_status = 'published' then
    select id, name into v_parent from public.boards where id = b.parent_board_id;
    v_sent := public._notify_users(
      array(select public._board_readers(p_board_id)),
      'schedule.moved',
      p_board_id,
      b.parent_board_id,
      b.workspace_id,
      v_actor,
      public._sched_day_title(v_label, b.name, p_date),
      case
        when v_prev is null then 'Added to the schedule'
        when p_date is null then 'Removed from the schedule'
        else 'Moved from ' || to_char(v_prev, 'Dy Mon FMDD') || ' to ' || to_char(p_date, 'Dy Mon FMDD')
      end,
      jsonb_build_object(
        'date', p_date, 'prev_date', v_prev, 'end_date', p_end_date,
        'day_label', v_label, 'version', b.sched_version,
        'production_name', v_parent.name)
    );
  end if;

  return jsonb_build_object('ok', true, 'prev_date', v_prev, 'date', p_date,
                            'moved', v_moved, 'notified', v_sent,
                            'published', b.sched_status = 'published');
end;
$$;
revoke all on function public.set_board_schedule(uuid, date, date, text, boolean) from public, anon;
grant execute on function public.set_board_schedule(uuid, date, date, text, boolean) to authenticated;

-- ── Publish ──────────────────────────────────────────────────────────────────
-- The replacement for the nightly attachment. One notification, one version.
create or replace function public.publish_schedule_day(
  p_board_id uuid,
  p_note     text default null
) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  v_actor uuid := auth.uid();
  b       record;
  v_parent record;
  v_next  int;
  v_sent  int := 0;
begin
  if v_actor is null then return jsonb_build_object('ok', false, 'error', 'unauthenticated'); end if;
  if not public.can_write_board(p_board_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select id, workspace_id, parent_board_id, name, day_label,
         scheduled_date, sched_version
    into b
    from public.boards
   where id = p_board_id and deleted_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  -- Publishing an undated day would notify a crew about nothing they can plan
  -- around.
  if b.scheduled_date is null then
    return jsonb_build_object('ok', false, 'error', 'not_scheduled');
  end if;

  v_next := coalesce(b.sched_version, 0) + 1;
  update public.boards
     set sched_version      = v_next,
         sched_status       = 'published',
         sched_published_at = now(),
         updated_at         = now()
   where id = p_board_id;

  select id, name into v_parent from public.boards where id = b.parent_board_id;
  v_sent := public._notify_users(
    array(select public._board_readers(p_board_id)),
    'schedule.published',
    p_board_id, b.parent_board_id, b.workspace_id, v_actor,
    public._sched_day_title(b.day_label, b.name, b.scheduled_date),
    coalesce(nullif(trim(coalesce(p_note, '')), ''),
             case when v_next = 1 then 'Call sheet published'
                  else 'Call sheet updated — v' || v_next end),
    jsonb_build_object('date', b.scheduled_date, 'version', v_next,
                       'day_label', b.day_label, 'note', p_note,
                       'production_name', v_parent.name)
  );

  return jsonb_build_object('ok', true, 'version', v_next, 'notified', v_sent);
end;
$$;
revoke all on function public.publish_schedule_day(uuid, text) from public, anon;
grant execute on function public.publish_schedule_day(uuid, text) to authenticated;

-- ── Cancel ───────────────────────────────────────────────────────────────────
-- A cancelled day stays on the calendar, struck through. Deleting it would
-- leave the crew with no record of a day they had planned around.
create or replace function public.cancel_schedule_day(
  p_board_id uuid,
  p_reason   text default null
) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  v_actor uuid := auth.uid();
  b record; v_parent record; v_sent int := 0;
begin
  if v_actor is null then return jsonb_build_object('ok', false, 'error', 'unauthenticated'); end if;
  if not public.can_write_board(p_board_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select id, workspace_id, parent_board_id, name, day_label, scheduled_date,
         sched_status, sched_version
    into b from public.boards where id = p_board_id and deleted_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  update public.boards
     set sched_status = 'cancelled', updated_at = now()
   where id = p_board_id;

  insert into public.board_meta_history (board_id, workspace_id, field, before_value, after_value, changed_by)
  values (p_board_id, b.workspace_id, 'sched_status',
          to_jsonb(b.sched_status), to_jsonb('cancelled'::text), v_actor);

  -- Only tell people who had been told it was on.
  if b.sched_status = 'published' then
    select id, name into v_parent from public.boards where id = b.parent_board_id;
    v_sent := public._notify_users(
      array(select public._board_readers(p_board_id)),
      'schedule.cancelled',
      p_board_id, b.parent_board_id, b.workspace_id, v_actor,
      public._sched_day_title(b.day_label, b.name, b.scheduled_date),
      coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'Cancelled'),
      jsonb_build_object('date', b.scheduled_date, 'reason', p_reason,
                         'version', b.sched_version,
                         'production_name', v_parent.name)
    );
  end if;

  return jsonb_build_object('ok', true, 'notified', v_sent);
end;
$$;
revoke all on function public.cancel_schedule_day(uuid, text) from public, anon;
grant execute on function public.cancel_schedule_day(uuid, text) to authenticated;

-- ── "In your schedule" ───────────────────────────────────────────────────────
-- Every dated cluster the caller can reach, across every production, from
-- p_from forward. This is the read behind the phrase — the reason a
-- notification saying "your schedule changed" has somewhere to point.
create or replace function public.list_my_schedule(
  p_from date default current_date,
  p_days int  default 60
) returns table (
  board_id uuid, board_name text, day_label text,
  scheduled_date date, scheduled_end date,
  sched_status text, sched_version int, sched_published_at timestamptz,
  production_board_id uuid, production_name text, workspace_id uuid,
  unread_count int
)
language sql stable security definer set search_path = public, auth as $$
  select b.id, b.name, b.day_label,
         b.scheduled_date, b.scheduled_end,
         b.sched_status, b.sched_version, b.sched_published_at,
         b.parent_board_id, p.name, b.workspace_id,
         (select count(*)::int from public.notifications n
           where n.board_id = b.id and n.user_id = auth.uid() and n.read_at is null)
    from public.boards b
    left join public.boards p on p.id = b.parent_board_id
   where b.scheduled_date is not null
     and b.deleted_at is null
     and b.scheduled_date >= p_from
     and b.scheduled_date < p_from + greatest(1, least(coalesce(p_days, 60), 730))
     -- Narrowed by the date range first (indexed), so the per-row access check
     -- runs over tens of clusters, not the whole table.
     and public._user_can_read_board(auth.uid(), b.id)
   order by b.scheduled_date, coalesce(b.day_label, b.name);
$$;
revoke all on function public.list_my_schedule(date, int) from public, anon;
grant execute on function public.list_my_schedule(date, int) to authenticated;

-- ── Email for the crew who aren't looking ────────────────────────────────────
-- BEFORE INSERT rather than AFTER: it stamps emailed_at on the row being
-- written instead of issuing a second UPDATE, and _notify_email uses pg_net,
-- which queues the request and fires after commit either way.
--
-- Same gating as every other activity email in the app (0075): skip if they're
-- online (they'll get the toast and the bell), skip if they've muted it.
create or replace function public._tg_schedule_notification_email() returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare
  v_email text;
  v_prod  text;
begin
  if new.kind is null or new.kind not like 'schedule.%' then return new; end if;
  if public._is_user_online(new.user_id) then return new; end if;
  if not public._email_pref_enabled(new.user_id, 'email_schedule') then return new; end if;

  select email into v_email from auth.users where id = new.user_id;
  if v_email is null or v_email = '' then return new; end if;

  v_prod := coalesce(new.data->>'production_name', 'Your schedule');

  perform public._notify_email('schedule_update', v_email, jsonb_build_object(
    'kind',           new.kind,
    'title',          new.title,
    'body',           new.body,
    'productionName', v_prod,
    'dayLabel',       new.data->>'day_label',
    'date',           new.data->>'date',
    'prevDate',       new.data->>'prev_date',
    'version',        new.data->>'version',
    -- AuthGate consumes these to land the reader on the day itself (0076).
    'boardId',        new.board_id,
    'workspaceId',    new.workspace_id
  ));
  new.emailed_at := now();
  return new;
exception when others then
  raise warning '_tg_schedule_notification_email failed for notification %: %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists schedule_notification_email_trg on public.notifications;
create trigger schedule_notification_email_trg
  before insert on public.notifications
  for each row execute function public._tg_schedule_notification_email();

-- ── Unsubscribe ──────────────────────────────────────────────────────────────
-- email_unsubscribe carries its OWN key allowlist, separate from the Worker's.
-- Widening only the Worker would render a 200 page reading "We couldn't process
-- that", because this returns false. The token is key-agnostic
-- (email_unsub_tokens is keyed by user_id), so no new token is minted.
create or replace function public.email_unsubscribe(
  p_token text, p_key text default 'email_lifecycle'
) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_uid uuid;
begin
  if p_key not in ('email_lifecycle', 'email_schedule') then return false; end if;
  update public.profiles
     set notification_prefs = jsonb_set(coalesce(notification_prefs, '{}'::jsonb),
                                        array[p_key], 'false'::jsonb, true)
   where user_id = (select user_id from public.email_unsub_tokens where token = p_token)
   returning user_id into v_uid;
  return v_uid is not null;
end $$;

comment on function public.set_board_schedule(uuid, date, date, text, boolean) is
  'The only path that writes boards.scheduled_date. Notifies readers when a PUBLISHED day moves.';
comment on function public.publish_schedule_day(uuid, text) is
  'Bump the call-sheet version and tell the crew. The replacement for the nightly attachment email.';
comment on function public.list_my_schedule(date, int) is
  'Every dated cluster the caller can reach, from p_from forward — the read behind "in your schedule".';
