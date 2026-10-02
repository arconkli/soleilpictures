-- 0352 — the return question was answered, but never marked as asked.
--
-- The return banner ("What brings you back today?") is asked once per account,
-- ever, and the privacy page says so: answering is recorded on the server, so
-- it will not come back if you clear your browser storage. The server half of
-- "asked" is profiles.settings.onboarding.return_reason_asked_at, written by
-- the banner's delivery tick once it has been on screen for eight seconds. A
-- tap inside those eight seconds — the ordinary one-tap answer — retired the
-- tick before it ran, so the stamp was never written and every other browser
-- asked again, where a typed note then overwrote the stored choice. The client
-- now does the tick's work on a tap or a close (ReturnReasonAsk markDelivered).
-- This stamps the accounts it already missed: an account holding an answer
-- was, by definition, asked.
--
-- Stamped with the time of the account's first answer. Only that key is added;
-- the rest of onboarding is kept as it is. No function is created or replaced,
-- so no grants move.

update public.profiles p
   set settings = jsonb_set(
         coalesce(p.settings, '{}'::jsonb),
         '{onboarding}',
         (case when jsonb_typeof(p.settings -> 'onboarding') = 'object'
               then p.settings -> 'onboarding' else '{}'::jsonb end)
           || jsonb_build_object('return_reason_asked_at',
                to_char(f.first_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
         true)
  from (select user_id, min(created_at) as first_at
          from public.feedback
         where kind = 'return_reason' and user_id is not null
         group by user_id) f
 where p.user_id = f.user_id
   and coalesce(p.settings #>> '{onboarding,return_reason_asked_at}', '') = '';

-- ── Proof ───────────────────────────────────────────────────────────────────
do $$
begin
  if exists (
    select 1
      from public.feedback f
      join public.profiles p on p.user_id = f.user_id
     where f.kind = 'return_reason'
       and coalesce(p.settings #>> '{onboarding,return_reason_asked_at}', '') = ''
  ) then
    raise exception '0352: an account that answered the return question is still not marked as asked';
  end if;
end $$;
