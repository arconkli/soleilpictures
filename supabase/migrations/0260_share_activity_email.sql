-- 0260_share_activity_email.sql — the half of 0259 that reaches a dormant owner.
--
-- 0259 puts share activity in the bell. The bell only reaches someone who opens
-- the app, and the owners this is for are exactly the ones who have not: people
-- who went quiet while their shared work was still being read. Without mail the
-- feature lands only on the people who needed it least.
--
-- Modelled on _tg_schedule_notification_email (0243), which is the established
-- shape for "a notifications row becomes an email". Same guards, plus two it
-- does not have.

-- ── The unsubscribe key ──────────────────────────────────────────────────────
-- email_unsubscribe() carries an allowlist, and boards/src/worker.js carries a
-- copy of it in UNSUB_KEYS. A new preference key has to be added to BOTH or the
-- link in the email is dead — the worker's own comment flags this. The worker
-- side ships in the same commit as this migration.
create or replace function public.email_unsubscribe(p_token text, p_key text default 'email_lifecycle')
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_uid uuid;
begin
  if p_key not in ('email_lifecycle', 'email_schedule', 'email_share_activity') then
    return false;
  end if;
  update public.profiles
     set notification_prefs = jsonb_set(coalesce(notification_prefs, '{}'::jsonb),
                                        array[p_key], 'false'::jsonb, true)
   where user_id = (select user_id from public.email_unsub_tokens where token = p_token)
   returning user_id into v_uid;
  return v_uid is not null;
end $$;

-- ── The trigger ──────────────────────────────────────────────────────────────
-- BEFORE INSERT, because it stamps emailed_at on the row being written — the
-- same reason schedule_notification_email_trg is BEFORE rather than AFTER.
create or replace function public._tg_share_activity_email()
returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare
  v_email  text;
  v_token  text;
  v_resume text;
  v_name   text;
begin
  if new.kind is distinct from 'share.viewed' then return new; end if;

  -- Already looking at the app: the bell is the whole story, and mailing
  -- someone about something they can see is how a useful signal becomes noise.
  if public._is_user_online(new.user_id) then return new; end if;

  if not public._email_pref_enabled(new.user_id, 'email_share_activity') then return new; end if;

  -- 0243's trigger does NOT check this and should. An address that has bounced
  -- and never delivered since is exactly what mailbox providers grade a sender
  -- on, and this is new volume.
  if not public._email_deliverable(new.user_id) then return new; end if;

  -- ONE share-activity email per owner per day, however many of their clusters
  -- were opened. 0259 writes one notification per cluster on purpose — the bell
  -- benefits from the detail — but an owner with several shared clusters would
  -- otherwise get several emails from a single cron run.
  --
  -- 20 hours rather than 24: the producing job runs daily at a fixed minute,
  -- and a strict 24h window would skip a day entirely the first time the run
  -- drifted a few minutes later than the one before it.
  if exists (
    select 1 from public.notifications n
    where n.user_id = new.user_id
      and n.kind = 'share.viewed'
      and n.emailed_at is not null
      and n.emailed_at > now() - interval '20 hours'
  ) then return new; end if;

  select email into v_email from auth.users where id = new.user_id;
  if v_email is null or v_email = '' then return new; end if;

  -- No unsubscribe token means no working opt-out, and mail with no working
  -- opt-out does not go out. Every account has one (created by
  -- _tg_create_unsub_token at signup), so this is a guard, not a path.
  select token into v_token from public.email_unsub_tokens where user_id = new.user_id;
  if v_token is null then
    raise warning '_tg_share_activity_email: no unsubscribe token for %; not sending', new.user_id;
    return new;
  end if;

  -- Best-effort: without it the CTA degrades to the plain app link and the
  -- template's button adds its own "signed out? we'll email a code" caveat.
  -- Worth having — this reader is, by definition, not currently in the app.
  begin
    v_resume := public.lifecycle_mint_resume_token(new.user_id, 'share_activity', null, 7);
  exception when others then
    v_resume := null;
    raise warning '_tg_share_activity_email: resume mint failed for %: %', new.user_id, sqlerrm;
  end;

  select b.name into v_name from public.boards b where b.id = new.board_id;

  perform public._notify_email('share_activity', v_email, jsonb_build_object(
    'title',            new.title,
    'boardName',        v_name,
    'viewers',          coalesce((new.data->>'viewers')::int, 1),
    'workspaceId',      new.workspace_id,
    'boardId',          new.board_id,
    'unsubscribeToken', v_token,
    'resumeToken',      v_resume
  ));
  new.emailed_at := now();
  return new;
exception when others then
  -- A mail failure must never fail the notification insert. The row in the bell
  -- is the durable half; the email is the reach.
  raise warning '_tg_share_activity_email failed for notification %: %', new.id, sqlerrm;
  return new;
end $$;

drop trigger if exists share_activity_email_trg on public.notifications;
create trigger share_activity_email_trg
  before insert on public.notifications
  for each row execute function public._tg_share_activity_email();

comment on function public._tg_share_activity_email() is
  'Emails a share.viewed notification to owners who are not currently in the app, at most once per owner per day. Never fails the insert.';
