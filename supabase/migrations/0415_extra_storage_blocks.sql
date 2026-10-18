-- 0415 — Extra storage: +1TB blocks on the Creator subscription.
--
-- Owner decision, 2026-10-17: a Creator who fills the drive can add storage in
-- one click, in blocks of 1 TiB at the Creator item's own interval, up to ten.
-- Only new uploads stop at the limit.
--
-- WHERE THE BLOCKS LIVE. On the subscriptions mirror (bought) and on
-- paid_grants (comped), never on profiles. Every demotion path demotes a
-- profile's tier without knowing extra storage exists; a figure stored there
-- would outlive the plan it came with. Here a block only counts while the
-- thing that pays for it is alive: the mirror's subscription entitles
-- (_subscription_entitles below), or the grant is active. No demotion path has
-- to remember to zero anything.
--
-- WHO WRITES THE MIRROR. Stripe observations from several writers (both
-- activation paths, the webhook, the reconcile cron, the admin resync and the
-- storage-addon function), each retrieving the subscription and writing what it
-- saw. A writer that retrieved BEFORE a change and wrote AFTER one used to
-- overwrite the newer truth; each now stamps observed_at, and the guard trigger
-- discards an observation older than the one already stored.
--
-- DUNNING. One rule for who keeps the plan while a payment fails, here and in
-- activateCore.mjs (entitlementFromSubscription, PAST_DUE_GRACE_DAYS): active,
-- trialing, and past_due for at most 21 days. Until now the webhook kept a
-- past_due account paid while the nightly reconcile demoted it the next
-- morning.
--
-- Additive: no row carries a block until something sells one, so no drive
-- changes size today (the proofs check it).

-- ── 1. The figures ──────────────────────────────────────────────────────────
insert into public.app_config (key, value, updated_at)
values ('storage_addon', jsonb_build_object('block_bytes', 1099511627776, 'max_blocks', 10), now())
on conflict (key) do update set value = excluded.value, updated_at = now();

create or replace function public._storage_addon_block_bytes()
 returns bigint
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(
    (select (value->>'block_bytes')::bigint from public.app_config where key = 'storage_addon'),
    1099511627776
  );
$function$;
revoke execute on function public._storage_addon_block_bytes() from public, anon, authenticated;

create or replace function public._storage_addon_max_blocks()
 returns integer
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(
    (select (value->>'max_blocks')::integer from public.app_config where key = 'storage_addon'),
    10
  );
$function$;
revoke execute on function public._storage_addon_max_blocks() from public, anon, authenticated;

-- ── 2. Columns ──────────────────────────────────────────────────────────────
-- integer, not smallint: an out-of-range quantity must reach the clamp below,
-- not fail the mirror write on input conversion.
alter table public.subscriptions add column if not exists storage_blocks integer not null default 0;
alter table public.subscriptions add column if not exists observed_at timestamptz;
alter table public.subscriptions add column if not exists past_due_since timestamptz;
alter table public.paid_grants add column if not exists storage_blocks integer not null default 0;

comment on column public.subscriptions.storage_blocks is
  'Extra-storage blocks on this subscription (the storage item''s quantity), as last observed in Stripe. Counts toward the drive only while _subscription_entitles(status, past_due_since). 0415.';
comment on column public.subscriptions.observed_at is
  'When the Stripe state in this row was read. The mirror guard discards a write observed earlier than the stored one. 0415.';
comment on column public.subscriptions.past_due_since is
  'Set by the mirror guard when status becomes past_due; cleared when it leaves. Bounds the dunning grace. 0415.';
comment on column public.paid_grants.storage_blocks is
  'Comped extra-storage blocks; count only while the grant is active. Set with admin_set_grant_storage_blocks. 0415.';

-- ── 3. Dunning: one rule ────────────────────────────────────────────────────
create or replace function public._subscription_entitles(p_status text, p_past_due_since timestamptz)
 returns boolean
 language sql
 stable
 set search_path to 'public'
as $function$
  select coalesce(p_status, '') in ('active', 'trialing')
      or (p_status = 'past_due'
          and coalesce(p_past_due_since, now()) > now() - interval '21 days');
$function$;
revoke execute on function public._subscription_entitles(text, timestamptz) from public, anon, authenticated;

-- ── 4. The mirror guard ─────────────────────────────────────────────────────
-- BEFORE, so it can refuse a stale write and clamp a block count. It writes no
-- event itself: an upsert runs the BEFORE INSERT trigger even when the row then
-- turns into an UPDATE, so an event logged here would record a change that
-- never happened. That is the AFTER trigger's job, below.
create or replace function public._tg_subscriptions_mirror_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_max    integer := public._storage_addon_max_blocks();
  v_blocks integer := coalesce(new.storage_blocks, 0);
begin
  -- An older observation never overwrites a newer one. Writes that carry no
  -- observation of their own (the trial-reminder claim) keep the stored
  -- observed_at and pass.
  if tg_op = 'UPDATE' and new.observed_at is not null and old.observed_at is not null
     and new.observed_at < old.observed_at then
    return null;
  end if;

  -- Clamped, never refused: a CHECK here would fail the webhook's write and
  -- leave the mirror on the older truth while Stripe retries. Flagged on the
  -- UPDATE pass only, for the reason in the header above.
  if v_blocks < 0 or v_blocks > v_max then
    if tg_op = 'UPDATE' then
      begin
        insert into public.analytics_events (user_id, event, props, path)
        values (new.user_id, 'billing_flag',
                jsonb_build_object('kind', 'storage_blocks_clamped', 'observed', v_blocks, 'max', v_max,
                                   'subscription_id', new.stripe_subscription_id),
                '/db/subscriptions');
      exception when others then
        raise warning 'subscriptions mirror guard: billing_flag insert failed: %', sqlerrm;
      end;
    end if;
    v_blocks := greatest(0, least(v_blocks, v_max));
  end if;
  new.storage_blocks := v_blocks;

  if new.status = 'past_due' then
    new.past_due_since := case when tg_op = 'UPDATE' and old.status = 'past_due'
                               then coalesce(old.past_due_since, now())
                               else now() end;
  else
    new.past_due_since := null;
  end if;
  return new;
end $function$;
revoke execute on function public._tg_subscriptions_mirror_guard() from public, anon, authenticated;

create or replace trigger subscriptions_mirror_guard
  before insert or update on public.subscriptions
  for each row execute function public._tg_subscriptions_mirror_guard();

-- The one server-side record of a purchase or a removal, whichever writer saw
-- it first (the storage-addon function, the webhook or the cron) — once,
-- because the next writer finds nothing changed. AFTER, so it fires only for a
-- row actually written, never for a stale write the guard turned away.
create or replace function public._tg_subscriptions_blocks_changed()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_prev integer := case when tg_op = 'UPDATE' then coalesce(old.storage_blocks, 0) else 0 end;
begin
  if new.storage_blocks is distinct from v_prev then
    begin
      insert into public.analytics_events (user_id, event, props, path)
      values (new.user_id, 'storage_blocks_changed',
              jsonb_build_object('from', v_prev, 'to', new.storage_blocks, 'status', new.status,
                                 'subscription_id', new.stripe_subscription_id),
              '/db/subscriptions');
    exception when others then
      raise warning 'subscriptions blocks trigger: storage_blocks_changed insert failed: %', sqlerrm;
    end;
  end if;
  return null;
end $function$;
revoke execute on function public._tg_subscriptions_blocks_changed() from public, anon, authenticated;

create or replace trigger subscriptions_blocks_changed
  after insert or update of storage_blocks on public.subscriptions
  for each row execute function public._tg_subscriptions_blocks_changed();

-- ── 5. Whose drive is how big ───────────────────────────────────────────────
-- The per-owner _storage_quota_bytes comes FIRST of the quota functions in this
-- file: tests read the first definition in the latest migration. The helpers
-- it calls come before it, because a SQL function is checked when it is made.
create or replace function public._storage_grant_blocks(p_owner uuid)
 returns integer
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select least(greatest(coalesce((
           select max(g.storage_blocks) from public.paid_grants g
            where g.user_id = p_owner
              and g.revoked_at is null
              and (g.expires_at is null or g.expires_at > now())), 0), 0),
         public._storage_addon_max_blocks());
$function$;
revoke execute on function public._storage_grant_blocks(uuid) from public, anon, authenticated;

create or replace function public._storage_addon_blocks(p_owner uuid)
 returns integer
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select least(greatest(coalesce((
           select s.storage_blocks from public.subscriptions s
            where s.user_id = p_owner
              and public._subscription_entitles(s.status, s.past_due_since)), 0), 0),
         public._storage_addon_max_blocks())
       + public._storage_grant_blocks(p_owner);
$function$;
revoke execute on function public._storage_addon_blocks(uuid) from public, anon, authenticated;

create or replace function public._storage_quota_bytes(p_owner uuid)
 returns bigint
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  -- An explicit per-account figure wins. Otherwise a paid or admin owner gets
  -- the drive Creator sells (storage_quota_bytes) — the trial drive while the
  -- subscription is still trialing (0413) — plus any extra storage that is
  -- still paid for (0415), and a free owner gets storage_quota_free_bytes
  -- (0387, owner decision 2026-10-06).
  select coalesce(
    (select p.storage_quota_bytes from public.profiles p where p.user_id = p_owner),
    case when coalesce((select p.tier from public.profiles p where p.user_id = p_owner), 'demo') in ('paid', 'admin')
         then case when exists (select 1 from public.subscriptions s
                                 where s.user_id = p_owner and s.status = 'trialing')
                   then public._storage_quota_trial_bytes()
                   else public._storage_quota_bytes()
              end
              + public._storage_addon_blocks(p_owner)::bigint * public._storage_addon_block_bytes()
         else public._storage_quota_free_bytes()
    end
  );
$function$;
revoke execute on function public._storage_quota_bytes(uuid) from public, anon, authenticated;

-- What a Creator's drive would be with p_purchased blocks bought: the
-- storage-addon function's "would removing this strand your files?" check.
-- Only ever asked about a plain paying Creator — the function refuses a trial
-- or a per-account figure first — so the base is the full Creator drive.
create or replace function public._storage_quota_if_blocks(p_owner uuid, p_purchased integer)
 returns bigint
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select public._storage_quota_bytes()
       + (least(greatest(coalesce(p_purchased, 0), 0), public._storage_addon_max_blocks())
          + public._storage_grant_blocks(p_owner))::bigint * public._storage_addon_block_bytes();
$function$;
revoke execute on function public._storage_quota_if_blocks(uuid, integer) from public, anon, authenticated;

-- ── 6. Comped storage ───────────────────────────────────────────────────────
create or replace function public.admin_set_grant_storage_blocks(p_email text, p_blocks integer)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_email  text := lower(trim(coalesce(p_email, '')));
  v_blocks integer := greatest(0, least(coalesce(p_blocks, 0), public._storage_addon_max_blocks()));
begin
  perform public._require_admin();
  perform public._audit('set_grant_storage_blocks', v_email, jsonb_build_object('blocks', v_blocks));
  update public.paid_grants set storage_blocks = v_blocks
   where email = v_email and revoked_at is null;
  if not found then
    raise exception 'no active grant for %', p_email using errcode = 'P0002';
  end if;
  return v_blocks;
end $function$;
revoke execute on function public.admin_set_grant_storage_blocks(text, integer) from public, anon;
grant execute on function public.admin_set_grant_storage_blocks(text, integer) to authenticated;

-- ── 7. The dunning rule where grants end ────────────────────────────────────
-- Each of these asked `status in ('active', 'trialing')`; a past_due account
-- inside the grace keeps its plan here as everywhere else. Same signatures,
-- so `create or replace` keeps their grants (proved below).
create or replace function public.admin_revoke_paid_access(p_email text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_email     text := lower(trim(coalesce(p_email, '')));
  v_admin_uid uuid := auth.uid();
  v_user_id   uuid;
  v_has_sub   boolean;
begin
  perform public._require_admin();
  perform public._audit('revoke_paid_access', p_email, '{}'::jsonb);

  if v_email = '' then
    raise exception 'email required' using errcode = '22023';
  end if;

  -- Comped storage goes with the grant (0415), so a later re-grant starts
  -- from none rather than resurrecting it.
  update public.paid_grants
     set revoked_at = now(), revoked_by = v_admin_uid, storage_blocks = 0
   where email = v_email
     and revoked_at is null
  returning user_id into v_user_id;

  if not found then
    raise exception 'no active grant for %', p_email using errcode = 'P0002';
  end if;

  if v_user_id is null then
    return;
  end if;

  select exists (
    select 1 from public.subscriptions
     where user_id = v_user_id and public._subscription_entitles(status, past_due_since)
  ) into v_has_sub;

  if not v_has_sub then
    update public.profiles set tier = 'demo'
     where user_id = v_user_id and tier = 'paid';
  end if;
end;
$function$;

create or replace function public.admin_set_tier(p_user_id uuid, p_tier text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform public._require_admin();
  perform public._audit('set_tier', p_user_id::text, jsonb_build_object('tier', p_tier));

  if p_user_id = auth.uid() then
    raise exception 'you cannot change your own tier' using errcode = '42501';
  end if;
  if p_tier not in ('admin', 'paid', 'demo', 'waitlist') then
    raise exception 'invalid tier %', p_tier using errcode = '22023';
  end if;

  if p_tier in ('demo', 'waitlist') then
    if exists (
      select 1 from public.subscriptions
      where user_id = p_user_id and public._subscription_entitles(status, past_due_since)
    ) then
      raise exception 'user has an active Stripe subscription — cancel it first'
        using errcode = '42501';
    end if;
    update public.paid_grants
       set revoked_at = now(), revoked_by = auth.uid(), storage_blocks = 0
     where user_id = p_user_id and revoked_at is null;
  end if;

  insert into public.profiles (user_id, tier)
  values (p_user_id, p_tier)
  on conflict (user_id) do update set tier = excluded.tier;
end;
$function$;

create or replace function public.sweep_expired_paid_grants()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_n int;
begin
  if auth.uid() is not null then
    perform public._require_admin();
  end if;

  with downgrades as (
    update public.profiles p
       set tier = 'demo'
     where p.tier = 'paid'
       and exists (
         select 1 from public.paid_grants g
          where g.user_id = p.user_id
            and g.revoked_at is null
            and g.expires_at is not null
            and g.expires_at <= now()
       )
       and not exists (
         select 1 from public.subscriptions s
          where s.user_id = p.user_id
            and public._subscription_entitles(s.status, s.past_due_since)
       )
    returning p.user_id
  )
  select count(*)::int into v_n from downgrades;
  return v_n;
end;
$function$;

-- ── 8. Seed past_due_since for a row already past_due ───────────────────────
-- The guard sets it on the way through.
update public.subscriptions set status = status where status = 'past_due';

-- ── 9. Proofs ───────────────────────────────────────────────────────────────
do $$
declare
  v_sig text;
begin
  if public._storage_addon_block_bytes() <> 1099511627776 or public._storage_addon_max_blocks() <> 10 then
    raise exception '0415: extra storage is not 1 TiB blocks, ten at most';
  end if;
  -- Nothing can sell a block yet, so no drive may have moved.
  if exists (select 1 from public.subscriptions where storage_blocks <> 0)
     or exists (select 1 from public.paid_grants where storage_blocks <> 0) then
    raise exception '0415: a block exists before anything can sell one';
  end if;
  if exists (select 1 from public.subscriptions where status = 'past_due' and past_due_since is null) then
    raise exception '0415: a past_due row has no past_due_since';
  end if;
  if not public._subscription_entitles('past_due', now() - interval '20 days')
     or public._subscription_entitles('past_due', now() - interval '22 days')
     or public._subscription_entitles('unpaid', null)
     or not public._subscription_entitles('trialing', null) then
    raise exception '0415: _subscription_entitles disagrees with activateCore';
  end if;

  foreach v_sig in array array[
    'public._storage_addon_block_bytes()',
    'public._storage_addon_max_blocks()',
    'public._subscription_entitles(text, timestamptz)',
    'public._tg_subscriptions_mirror_guard()',
    'public._tg_subscriptions_blocks_changed()',
    'public._storage_grant_blocks(uuid)',
    'public._storage_addon_blocks(uuid)',
    'public._storage_quota_bytes(uuid)',
    'public._storage_quota_if_blocks(uuid, integer)'
  ] loop
    if has_function_privilege('anon', v_sig, 'execute')
       or has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception '0415: % is callable by a client', v_sig;
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public._storage_quota_if_blocks(uuid, integer)', 'execute')
     or not has_function_privilege('service_role', 'public._storage_addon_blocks(uuid)', 'execute') then
    raise exception '0415: the storage-addon function cannot ask what a drive would be';
  end if;

  foreach v_sig in array array[
    'public.admin_set_grant_storage_blocks(text, integer)',
    'public.admin_revoke_paid_access(text)',
    'public.admin_set_tier(uuid, text)',
    'public.sweep_expired_paid_grants()'
  ] loop
    if has_function_privilege('anon', v_sig, 'execute') then
      raise exception '0415: % is callable signed out', v_sig;
    end if;
    if not has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception '0415: % lost its grant', v_sig;
    end if;
  end loop;
end $$;
