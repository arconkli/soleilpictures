-- 0261_drop_share_activity.sql — back out the share-activity notification.
--
-- 0259/0260 turned share-link traffic into a notification ("3 people opened
-- <cluster>") plus an email to owners who were not in the app. It worked end to
-- end and was never switched on for anyone: the producing job was parked the day
-- it shipped, pending a worker promote.
--
-- It is removed on a product judgement, not a technical one. Telling someone
-- their work is being watched is a different kind of product from a reference
-- tool, and the owner's call was that it is too much. That is the right call to
-- respect — the volume was small (a handful of owners a month) and the upside
-- was never large enough to argue about.
--
-- WHAT GOES: the producer, the mailer, and the schedule. Nothing can create a
-- share.viewed row after this.
--
-- WHAT STAYS, deliberately:
--   • public.notifications and its fanout (0242) — untouched, still the bell.
--   • The `share_activity` template in send-transactional-email, and the
--     `email_share_activity` entries in email_unsubscribe() and the worker's
--     UNSUB_KEYS. All three are unreachable with the trigger gone. They are left
--     in place because they are mutually consistent and removing the template
--     means re-uploading the whole 80KB function tree by hand for no functional
--     gain — and a repo that no longer matches the deployed function is a worse
--     outcome than an inert template. If this is ever revived, they are the hook.
--   • unsubUrl()'s key PARAMETER in templates.ts. That fixed a real latent bug
--     (the in-body unsubscribe link hardcoded k=email_lifecycle, so any second
--     unsubscribable template would have muted the wrong preference) and it is
--     worth keeping on its own merits.
--   • The bell's analytics — notif_open / notif_click. The notification system
--     shipped with no instrumentation at all, which is why nobody could say
--     whether anyone acts on a notification. That gap is real regardless of what
--     produces the rows, and the schedule producer will need it.

drop trigger if exists share_activity_email_trg on public.notifications;
drop function if exists public._tg_share_activity_email();
drop function if exists public.notify_share_activity(integer);

-- The job was created by 0259 and parked before it ever fired.
do $$
begin
  perform cron.unschedule('share-activity-daily');
exception when others then
  raise notice 'share-activity-daily already absent';
end $$;
