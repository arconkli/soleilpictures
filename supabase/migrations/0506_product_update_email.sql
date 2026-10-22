-- 0506_product_update_email.sql — a release announcement to the people who use
-- Clusters, not only the people who left.
--
-- whats_new (0211 / 0237) is the only lifecycle kind that carries news, and it
-- is a win-back: it reaches dormant accounts only, and its copy says "since you
-- left". A release note for everyone needs its own kind:
--
--   product_update — once per published edition (content_version), every
--   whats_new filter EXCEPT dormancy, sent in waves (wave 1: people who read
--   our mail or used the app lately; wave 2: everyone eligible), throttled by
--   a daily cap, most recently active first.
--
-- Nothing here sends. The edition is seeded DISABLED with no version and no
-- items, and the cron skips the type before calling the RPC until a human
-- writes an edition and flips `enabled`. The copy is written at send time, so
-- no product claim lives in this file.
--
-- The edition, app_config 'lifecycle_product_update':
--   enabled    boolean  false   the gate; nothing goes out while false
--   version    text     null    the edition id, also the once-per-user key
--   wave       int      1       1 = recently engaged only, 2 (or absent) = all
--   daily_cap  int      300     sends per UTC day, claimed or sent
--   subject, preheader, greeting, intro, items[], cta_label, cta_path,
--   outro, signoff             the copy, read by the template only
--
-- Consent and suppression are the house ones: _email_pref_enabled(..,
-- 'email_lifecycle'), lifecycle_type_enabled('product_update'),
-- _email_deliverable here, and _email_engaged (the sunset) plus the one-per-day
-- index in lifecycle_claim_send.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Admit the type. The live CHECK is the 0211 list; keep every value.
-- ───────────────────────────────────────────────────────────────────────────
alter table public.lifecycle_email_log
  drop constraint if exists lifecycle_email_log_email_type_check;
alter table public.lifecycle_email_log
  add constraint lifecycle_email_log_email_type_check
  check (email_type in ('activate_nudge_1','activate_nudge_2','reengage_1',
                        'welcome_board','board_waiting','nudge_dormant_early',
                        'whats_new','product_update'));

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Once per edition. whats_new's index is partial on its own type, so
--    product_update gets the same index on its own: one row per user per
--    content_version, whatever the row's status.
-- ───────────────────────────────────────────────────────────────────────────
create unique index if not exists lifecycle_email_log_product_update_version_idx
  on public.lifecycle_email_log (user_id, email_type, content_version)
  where email_type = 'product_update';

-- ───────────────────────────────────────────────────────────────────────────
-- 3. The edition, seeded off and empty.
-- ───────────────────────────────────────────────────────────────────────────
insert into public.app_config (key, value)
values ('lifecycle_product_update', jsonb_build_object(
  'enabled',   false,
  'version',   null,
  'wave',      1,
  'daily_cap', 300,
  'subject',   '',
  'preheader', '',
  'greeting',  '',
  'intro',     '',
  'items',     '[]'::jsonb,
  'cta_label', '',
  'cta_path',  '/',
  'outro',     '',
  'signoff',   ''
))
on conflict (key) do nothing;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Who is due. The row shape is lifecycle_due_whats_new's, column for
--    column, so the cron's runType reads it the same way.
--
--    Numbers in the edition are parsed defensively: an admin-typed "300 " or
--    "two" must fall back to the default rather than make the cast throw and
--    take the whole hourly run's summary with it.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.lifecycle_due_product_update(p_hour int default null)
returns table(user_id uuid, email text, display_name text, workspace_id uuid,
              board_id uuid, board_name text, thumb_key text,
              thumb_updated_at timestamptz, unsub_token text, content_version text)
language sql
stable
security definer
set search_path = public
as $$
  with ed as (
    select nullif(btrim(c.value->>'version'), '') as version,
           coalesce(c.value->'enabled' = 'true'::jsonb, false) as enabled,
           jsonb_typeof(c.value->'items') = 'array'
             and jsonb_array_length(c.value->'items') > 0 as has_items,
           case when c.value->>'wave' ~ '^\s*\d{1,6}\s*$'
                then btrim(c.value->>'wave')::int else 2 end as wave,
           case when c.value->>'daily_cap' ~ '^\s*\d{1,6}\s*$'
                then btrim(c.value->>'daily_cap')::int else 300 end as daily_cap
    from public.app_config c where c.key = 'lifecycle_product_update'
  ),
  budget as (
    select greatest(0, (select daily_cap from ed)
                     - (select count(*)::int from public.lifecycle_email_log
                        where email_type = 'product_update'
                          and status in ('claimed', 'sent')
                          and sent_on = (now() at time zone 'utc')::date)) as slots
  )
  select u.id, u.email::text,
         coalesce(nullif(p.display_name,''), initcap(split_part(u.email,'@',1))),
         ws.workspace_id, bd.board_id, bd.board_name, bd.thumb_key,
         bd.thumb_updated_at, t.token, ed.version
  from auth.users u
  cross join ed
  cross join budget
  join public.profiles p on p.user_id = u.id
  join public.email_unsub_tokens t on t.user_id = u.id
  left join public.user_presence pr on pr.user_id = u.id
  left join lateral (
    select w.id as workspace_id from public.workspaces w
    where w.created_by = u.id order by w.created_at limit 1
  ) ws on true
  left join lateral (
    select b.id as board_id, b.name as board_name, b.thumb_key, b.thumb_updated_at
    from public.boards b
    where b.created_by = u.id and b.deleted_at is null
    order by (b.thumb_key is not null and coalesce(b.card_count,0) > 0) desc,
             (b.parent_board_id is not null) desc, b.updated_at desc
    limit 1
  ) bd on true
  where ed.enabled and ed.version is not null and ed.has_items
    and u.email_confirmed_at is not null and u.email is not null
    and p.tier in ('demo','paid')
    and p.banned_at is null
    and u.id not in (select iu.user_id from public._internal_user_ids() iu)
    and public._email_pref_enabled(u.id, 'email_lifecycle')
    and public._email_deliverable(u.id)
    and public.lifecycle_type_enabled('product_update')
    and (p_hour is null or coalesce(p.preferred_send_hour,
          extract(hour from coalesce(p.activated_access_at, u.created_at))::int) = p_hour)
    -- Wave 1: someone who opened or clicked any email of ours in 60 days, or
    -- was in the app in 30 (whats_new's last-active signal, the other way up).
    and (ed.wave >= 2
         or coalesce(pr.last_seen_at, u.created_at) > now() - interval '30 days'
         or exists (select 1 from public.email_sends es
                    where es.user_id = u.id
                      and (es.opened_at  > now() - interval '60 days'
                        or es.clicked_at > now() - interval '60 days')))
    -- Once per edition: any row at this version, whatever its status.
    and not exists (select 1 from public.lifecycle_email_log l
                    where l.user_id = u.id and l.email_type = 'product_update'
                      and l.content_version is not distinct from ed.version)
    -- No lifecycle email of any kind in the last 3 days.
    and not exists (select 1 from public.lifecycle_email_log l2
                    where l2.user_id = u.id
                      and l2.sent_at > now() - interval '3 days')
  order by coalesce(pr.last_seen_at, u.created_at) desc
  limit (select slots from budget);
$$;

-- An internal RPC for the cron's service role, like every lifecycle_due_*.
revoke execute on function public.lifecycle_due_product_update(int) from public, anon, authenticated;
grant execute on function public.lifecycle_due_product_update(int) to service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Prove the grants (the 0311 habit: a REVOKE reporting success proves
--    nothing), and that no overload sits beside it (PGRST203).
-- ───────────────────────────────────────────────────────────────────────────
do $$
declare
  v_fn constant text := 'public.lifecycle_due_product_update(integer)';
begin
  if has_function_privilege('anon', v_fn, 'execute') then
    raise exception '0506: % is callable signed out', v_fn;
  end if;
  if has_function_privilege('authenticated', v_fn, 'execute') then
    raise exception '0506: % is callable by any signed-in account', v_fn;
  end if;
  if not has_function_privilege('service_role', v_fn, 'execute') then
    raise exception '0506: % is not callable by the cron', v_fn;
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'lifecycle_due_product_update') <> 1 then
    raise exception '0506: lifecycle_due_product_update has an overload (PGRST203)';
  end if;
end $$;
