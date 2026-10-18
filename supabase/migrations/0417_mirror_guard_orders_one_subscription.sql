-- 0417 — The mirror guard orders observations of ONE subscription, and the
-- "would removing blocks strand your files?" check counts invite storage.
--
-- Review of 0415 before its edge functions deploy, 2026-10-17:
--
-- 1. The guard compared observed_at across DIFFERENT subscriptions, which are
--    not ordered against each other. A resubscribe's activation reads the new
--    subscription, the old one's cancel is written, then the activation lands
--    with the earlier timestamp. The guard discarded it, leaving the mirror on
--    the old, canceled subscription while the tier said paid — and the
--    nightly reconcile would then demote a paying customer. Which
--    subscription may hold the row is the writers' rule (activateCore
--    subscriptionEventAction; the webhook's cancel and the reconcile write
--    only to the row still tracking the subscription they read). The guard
--    now only orders two observations of the same one.
--
-- 2. _storage_quota_if_blocks left out the invite storage 0416 added to every
--    drive, so it understated what a Creator would have after removing blocks.
--    It now adds the same term _storage_quota_bytes(p_owner) does, so the two
--    agree on everything except the blocks being asked about.
--
-- 3. Recorded, not changed: _subscription_entitles cannot see Stripe's retry
--    schedule, so in SQL a past_due subscription is entitled for 21 days from
--    when the mirror first saw it past_due, even if Stripe has already given
--    up. The JS twin (activateCore entitlementFromSubscription) knows from
--    the invoice whether Stripe is still retrying, and the webhook and the
--    nightly reconcile demote on it — so the SQL readers (revoke, set_tier,
--    the grant sweep, the drive) can be at most a day more generous than the
--    JS rule, never less.

-- ── 1. The guard ────────────────────────────────────────────────────────────
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
  -- An older observation never overwrites a newer one OF THE SAME
  -- SUBSCRIPTION (0417). Writes that carry no observation of their own (the
  -- trial-reminder claim) keep the stored observed_at and pass.
  if tg_op = 'UPDATE' and new.observed_at is not null and old.observed_at is not null
     and new.observed_at < old.observed_at
     and new.stripe_subscription_id is not distinct from old.stripe_subscription_id then
    return null;
  end if;

  -- Clamped, never refused: a CHECK here would fail the webhook's write and
  -- leave the mirror on the older truth while Stripe retries. Flagged on the
  -- UPDATE pass only: an upsert runs the BEFORE INSERT pass too, even when the
  -- row then turns into an UPDATE.
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

-- ── 2. What a Creator's drive would be ──────────────────────────────────────
create or replace function public._storage_quota_if_blocks(p_owner uuid, p_purchased integer)
 returns bigint
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  -- The full Creator drive (the storage-addon function refuses a trial or a
  -- per-account figure first), the blocks being asked about plus any comped
  -- ones, and the person's invite storage (0416) — the same terms
  -- _storage_quota_bytes(p_owner) adds.
  select public._storage_quota_bytes()
       + (least(greatest(coalesce(p_purchased, 0), 0), public._storage_addon_max_blocks())
          + public._storage_grant_blocks(p_owner))::bigint * public._storage_addon_block_bytes()
       + coalesce((select p.bonus_storage_bytes from public.profiles p where p.user_id = p_owner), 0);
$function$;
revoke execute on function public._storage_quota_if_blocks(uuid, integer) from public, anon, authenticated;

-- ── 3. The recorded difference ──────────────────────────────────────────────
comment on function public._subscription_entitles(text, timestamptz) is
  'Who keeps the plan while a payment fails: active, trialing, or past_due for at most 21 days from past_due_since. Cannot see whether Stripe is still retrying; activateCore.entitlementFromSubscription can, and the webhook and nightly reconcile demote on it. 0415, 0417.';

-- ── 4. Proofs ───────────────────────────────────────────────────────────────
do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'public._tg_subscriptions_mirror_guard()',
    'public._storage_quota_if_blocks(uuid, integer)'
  ] loop
    if has_function_privilege('anon', v_sig, 'execute')
       or has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception '0417: % is callable by a client', v_sig;
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public._storage_quota_if_blocks(uuid, integer)', 'execute') then
    raise exception '0417: the storage-addon function cannot ask what a drive would be';
  end if;
  -- With no blocks anywhere, asking about the blocks a Creator already has
  -- (none) must give exactly the drive they have now.
  if exists (
    select 1 from public.profiles p
      join public.subscriptions s on s.user_id = p.user_id
     where p.tier = 'paid' and s.status = 'active' and p.storage_quota_bytes is null
       and public._storage_quota_if_blocks(p.user_id, s.storage_blocks) <> public._storage_quota_bytes(p.user_id)
  ) then
    raise exception '0417: _storage_quota_if_blocks disagrees with _storage_quota_bytes for a paying Creator';
  end if;
end $$;
