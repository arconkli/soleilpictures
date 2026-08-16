-- 0245_schedule_email_unsub_token.sql — give the schedule email a working
-- one-click unsubscribe.
--
-- 0243 shipped the trigger without an unsubscribeToken in its payload. That is
-- not a cosmetic gap: listUnsubHeaders() in send-transactional-email early-
-- returns {} unless the token matches /^[0-9a-f]{64}$/, so the List-Unsubscribe
-- and List-Unsubscribe-Post headers would simply never be emitted — silently,
-- with a 200 and a delivered email.
--
-- A published call sheet reaches an entire crew at once, which is exactly the
-- volume shape Gmail and Yahoo's bulk-sender rules exist for. Shipping that
-- without one-click unsubscribe risks the sending domain, and the domain is
-- shared with the sign-in codes.
--
-- Tokens already exist for everyone: email_unsub_tokens is populated by a
-- trigger on profiles (0173) and keyed by user_id, not by preference — the same
-- token unsubscribes any key the allowlists permit. So this is a lookup, not a
-- mint. It is also LEFT JOIN-shaped on purpose: a missing token must cost the
-- crew member their unsubscribe header, not their call sheet.

create or replace function public._tg_schedule_notification_email() returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare
  v_email text;
  v_prod  text;
  v_token text;
begin
  if new.kind is null or new.kind not like 'schedule.%' then return new; end if;
  -- They are in the app: the toast and the bell already told them, and a
  -- duplicate email is how people learn to filter you.
  if public._is_user_online(new.user_id) then return new; end if;
  if not public._email_pref_enabled(new.user_id, 'email_schedule') then return new; end if;

  select email into v_email from auth.users where id = new.user_id;
  if v_email is null or v_email = '' then return new; end if;

  select token into v_token from public.email_unsub_tokens where user_id = new.user_id;
  v_prod := coalesce(new.data->>'production_name', 'Your schedule');

  perform public._notify_email('schedule_update', v_email, jsonb_build_object(
    'kind',             new.kind,
    'title',            new.title,
    'body',             new.body,
    'productionName',   v_prod,
    'dayLabel',         new.data->>'day_label',
    'date',             new.data->>'date',
    'prevDate',         new.data->>'prev_date',
    'version',          new.data->>'version',
    -- Drives the RFC 8058 one-click header; the Worker resolves the template to
    -- k=email_schedule so it mutes call sheets rather than product tips.
    'unsubscribeToken', v_token,
    -- AuthGate consumes these to land the reader on the day itself (0076).
    'boardId',          new.board_id,
    'workspaceId',      new.workspace_id
  ));
  new.emailed_at := now();
  return new;
exception when others then
  raise warning '_tg_schedule_notification_email failed for notification %: %', new.id, sqlerrm;
  return new;
end;
$$;
