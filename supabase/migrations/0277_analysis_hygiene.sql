-- 0277_analysis_hygiene.sql — three accounts that were never excluded, and the
-- one date every session-level cut has to know about.
--
-- Both faults were found the same way: a retention read on 2026-08-31 produced
-- a number that could not be right, and the cause was the dataset rather than
-- the query. Neither changes product behaviour; both change what the numbers mean.
--
-- ── 1. THE INTERNAL FILTER HAS A HOLE ────────────────────────────────────────
-- _internal_user_ids() = profiles.tier = 'admin' UNION internal_accounts. That
-- catches andrew@andrewconklin.com (admin tier) and the four founder/test
-- gmails, and misses three accounts that are just as internal:
--
--   andrew@andrewconklin      — a typo signup: no boards, no cards, never booted
--   andrew@andrewconklin.om   — the same typo again, likewise empty
--   showcase@soleilpictures.com — the curated showcase account behind
--                                 app_config 'onboarding_showcase'
--
-- The typos are small but they land in the worst place: they are indistinguishable
-- from real people who signed up and never booted, so they inflate exactly the
-- never-booted rate that activation work is judged on.
--
-- showcase@ is the bigger one. It holds a substantial body of boards and cards
-- authored deliberately for onboarding rather than by a user, and every
-- card-count aggregate in the admin surface has been carrying it. It has no
-- active days, so return and retention rates were never affected; depth and
-- per-card cuts were.
--
-- Inserted by id looked up from email rather than hardcoded, so this is a no-op
-- on any environment where these accounts do not exist.
insert into public.internal_accounts (user_id, reason)
select u.id, 'internal — typo signup or curated content account (0277)'
from auth.users u
where u.email in (
  'andrew@andrewconklin',
  'andrew@andrewconklin.om',
  'showcase@soleilpictures.com'
)
on conflict (user_id) do nothing;

-- ── 2. usage_session HAS AN EPOCH AND DOES NOT SAY SO ────────────────────────
-- The table starts on 2026-08-17. Ask it anything about the summer and it
-- answers with silence rather than an error: a day-one session cut across a
-- June cohort returns zeroes that look like "nobody used the app" instead of
-- "this table did not exist yet". That is precisely what it did during the
-- 08-31 read, and the first reading of the result was wrong.
--
-- user_active_day.did_work already carries this warning (added with 0248) and is
-- left as it is, except that "predating migration 0248" is not something you can
-- put in a WHERE clause — the date is added so it is usable.
--
-- Both comments are replacements of the existing text, extended rather than
-- rewritten; the originals explain what the columns are and that is still right.
comment on table public.usage_session is
  'Active seconds per (session, surface, board). profiles.seconds_in_app is a
   single undimensioned counter, so "canvas vs schedule vs docs" and "which
   boards hold attention" were unanswerable. Written by record_usage_slice from
   the client heartbeat, which already computes visible-and-interacting time.
   Admin-read only (RLS on, no policies — same posture as user_active_day and
   metrics_daily).

   EPOCH: the first row is 2026-08-17. There is no data before that and none can
   be reconstructed. Any cut joining this table to a cohort that predates it
   returns zeros that read as absence of usage rather than absence of the table —
   filter to day >= 2026-08-17 and say so, or use user_active_day, which goes
   back to 2026-05-19.';

comment on column public.user_active_day.did_work is
  'True when the user did real work that day (a card/doc/comment write), as
   opposed to merely being present. Written by two independent paths: the
   client heartbeat (bump_seconds_in_app.p_did_work) and a server-truth
   trigger on card_index. Always false for rows predating migration 0248
   (i.e. day < 2026-08-17) — it cannot be backfilled, so any "share of days
   with work" measured across that boundary is an artefact, not a trend.';
