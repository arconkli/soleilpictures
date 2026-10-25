// Billing — the caller's current plan and the action appropriate to their tier:
//   admin     → "Unlimited admin access"
//   paid      → plan + status + next renewal, "Manage billing →" (Stripe Portal)
//   demo      → card count + "Upgrade to Creator" button (opens PricingModal)
//   waitlist  → defensive note (this surface shouldn't be reachable)
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { logEvent } from '../../lib/analytics.js';
import { EV } from '../../lib/analyticsEvents.js';
import { planLabel, formatPeriodEnd, grantCopy, statusLabel, PRICING, CTA, STORAGE_ADDON_HELD, STORAGE_ADDON_BLOCK_LABEL, STORAGE_ADDON_MAX_BLOCKS } from '../../lib/billingCopy.js';
import { creatorTrialEligibility } from '../../lib/creatorTrial.js';
import { startPortal, warmPortal } from '../../lib/checkout.js';
import { checkoutErrorMessage } from '../../lib/checkoutErrors.js';
import { useFeedback } from '../AppFeedback.jsx';
import { useMyTier } from '../../hooks/useMyTier.js';
import { useStorageUsage } from '../../hooks/useStorageUsage.js';
import { formatBonusBytes } from '../../lib/inviteReward.js';
import { fmtBytes } from '../../lib/storageLabel.js';
import { PricingModal } from '../PricingModal.jsx';
import { StorageAddonSheet } from '../StorageAddonSheet.jsx';
import { useBfcacheRestore } from '../../auth/useBfcacheRestore.js';

export function BillingTab({ user }) {
  const feedback = useFeedback();
  const { tier, demoCardCount, serverCardCount, subscriptionStatus, currentPeriodEnd, cancelAtPeriodEnd,
          grantActive, grantExpiresAt, effectiveCardLimit, creatorTrialStartedAt, loading, error, refetch } =
    useMyTier({ userId: user?.id });
  // Settings was the one upgrade entry that never named the trial to someone
  // owed it. Decided on the server's count, like every other trial surface.
  const trialOffer = creatorTrialEligibility({
    tier, cards: serverCardCount, cardLimit: effectiveCardLimit, trialStartedAt: creatorTrialStartedAt,
  }).eligible;
  const [sub, setSub] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);
  // Extra storage (held): which sheet is open, and a bump that remounts the
  // meter so it re-reads my_storage_usage after a change.
  const [addonMode, setAddonMode] = useState(null);
  const [storageEpoch, setStorageEpoch] = useState(0);
  // Back from the Stripe portal restores the page with Manage billing busy.
  useBfcacheRestore(() => setBusy(false));

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    supabase.from('subscriptions')
      .select('plan, status, current_period_end, cancel_at_period_end, storage_blocks')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled) setSub(data || null); });
    return () => { cancelled = true; };
  }, [user?.id, storageEpoch]);

  // Manage billing's function, booted and its preflight answered while the tab
  // is read (lib/checkout.js), so the click waits on Stripe alone.
  useEffect(() => { if (tier === 'paid') warmPortal(); }, [tier]);

  const openPortal = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await startPortal({ surface: 'settings' });
    } catch (e) {
      feedback.toast({ type: 'error', code: 'billing_portal_failed', message: checkoutErrorMessage(e) });
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="settings-section"><div className="settings-empty">Loading…</div></div>;
  }

  // The first get_my_tier failed (offline at open, a transient 5xx): there is
  // no plan to describe. Rendering on regardless told a paying customer they
  // were on the waitlist and hid Manage billing. A later failed refetch keeps
  // the last good tier, so this only shows when there is nothing to show.
  if (!tier && error) {
    return (
      <div className="settings-section">
        <h3 className="settings-section-title">Plan &amp; billing</h3>
        <div className="settings-empty" role="alert">
          Couldn’t load your plan.{' '}
          <button type="button" className="settings-link-btn" onClick={() => refetch?.()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Plan &amp; billing</h3>
      <p className="settings-section-hint">
        Your current plan and payment management.
      </p>

      <BillingSummary
        tier={tier}
        sub={sub}
        subscriptionStatus={subscriptionStatus}
        currentPeriodEnd={currentPeriodEnd}
        cancelAtPeriodEnd={cancelAtPeriodEnd}
        grantActive={grantActive}
        grantExpiresAt={grantExpiresAt}
        demoCardCount={demoCardCount}
        effectiveCardLimit={effectiveCardLimit}
        trialOffer={trialOffer}
        busy={busy}
        storageEpoch={storageEpoch}
        onAddStorage={() => setAddonMode('add')}
        onRemoveStorage={() => setAddonMode('remove')}
        onManage={openPortal}
        onUpgrade={() => {
          // Was dark: only the downstream modal pricing_view fired, so Settings
          // upgrades were indistinguishable from every other modal entry.
          logEvent(EV.UP_SETTINGS_CLICK, {});
          setPricingOpen(true);
        }} />

      {pricingOpen && <PricingModal onClose={() => setPricingOpen(false)} via="settings" />}
      {!STORAGE_ADDON_HELD && (
        <StorageAddonSheet
          open={addonMode != null}
          mode={addonMode || 'add'}
          surface="settings"
          onClose={() => setAddonMode(null)}
          onDone={() => setStorageEpoch((n) => n + 1)} />
      )}
    </div>
  );
}

// "X / <drive>" usage meter, for every plan: the drive is a limit on free as
// well as on Creator (0413), and my_storage_usage reports the reader's OWN
// quota since 0411. Shows used / quota, the live fill bar, and a remaining +
// percent sub-line so it reads as a real usage gauge wherever it's mounted.
export function StorageMeter() {
  const usage = useStorageUsage({ enabled: true });
  // Storage earned by invitations (0416) is already inside the quota above.
  // Say where it came from, or a drive bigger than the plan's reads like a
  // mistake next to every page that names the plan's figure.
  const [inviteBytes, setInviteBytes] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        if (!uid) return;
        const { data } = await supabase.from('profiles')
          .select('bonus_storage_bytes')
          .eq('user_id', uid)
          .maybeSingle();
        if (!cancelled) setInviteBytes(Number(data?.bonus_storage_bytes) || 0);
      } catch (_) { /* the meter is complete without the attribution line */ }
    })();
    return () => { cancelled = true; };
  }, []);
  const pct = usage.quota ? Math.min(100, (usage.used / usage.quota) * 100) : 0;
  const near = pct >= 90;
  const remaining = usage.remaining != null
    ? usage.remaining
    : (usage.quota != null ? Math.max(0, usage.quota - usage.used) : null);
  // A failed fetch is not "0 B used": say so, with a way to try again.
  if (usage.error && !usage.loading) {
    return (
      <div style={{ marginTop: 12 }} role="alert">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
          <span className="settings-billing-label">Storage</span>
          <span className="t-meta" style={{ color: 'var(--ink-3, #9aa0aa)' }}>
            Couldn’t load storage —{' '}
            <button type="button" className="btn-secondary" style={{ padding: '4px 8px', minHeight: 28 }}
                    onClick={() => usage.refetch()}>
              Retry
            </button>
          </span>
        </div>
      </div>
    );
  }
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span className="settings-billing-label">Storage</span>
        <span className="settings-billing-value" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {usage.loading ? '…' : `${fmtBytes(usage.used)} / ${usage.quota != null ? fmtBytes(usage.quota) : '—'}`}
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: 'var(--line-1, rgba(255,255,255,.12))', overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${pct}%`, borderRadius: 999,
          // Neutral ink at rest: gold is reserved for active / selection /
          // focus, and a usage bar is none of those. Red only near full.
          background: near ? '#ef4444' : 'var(--ink-2)',
          transition: 'width .3s ease',
        }} />
      </div>
      {!usage.loading && usage.quota != null && (
        <div className="t-meta" style={{ marginTop: 6, fontVariantNumeric: 'tabular-nums', color: near ? '#ef4444' : 'var(--ink-3, #9aa0aa)' }}>
          {remaining != null ? `${fmtBytes(remaining)} free` : ''}
          {remaining != null ? ' · ' : ''}
          {Math.round(pct)}% used
        </div>
      )}
      {inviteBytes > 0 && (
        <div className="t-meta" style={{ marginTop: 4, color: 'var(--ink-3, #9aa0aa)' }}>
          Includes {formatBonusBytes(inviteBytes)} from invites
        </div>
      )}
    </div>
  );
}

// The plan rows + the primary CTA. Split out from BillingTab so the framing
// (heading, hint, error UI, upgrade modal) stays with the tab and this stays a
// pure presentation of whatever tier state the caller resolved.
export function BillingSummary({
  tier, sub, subscriptionStatus, currentPeriodEnd, cancelAtPeriodEnd,
  grantActive, grantExpiresAt, demoCardCount, effectiveCardLimit,
  trialOffer = false, busy, onManage, onUpgrade,
  storageEpoch = 0, onAddStorage = null, onRemoveStorage = null,
}) {
  const status = subscriptionStatus || sub?.status || null;
  // Paid access via an admin grant (no paying Stripe sub) — there's no portal to
  // manage, so we show the complimentary note instead of Stripe status/renewal.
  const grantBacked = tier === 'paid' && grantActive && !['active', 'trialing'].includes(status || '');
  const plan = planLabel({ tier, plan: sub?.plan, demoCardCount, grantBacked, cardLimit: effectiveCardLimit, subscriptionStatus: status });
  // Prefer the fresh RPC value; fall back to the subscriptions-row query.
  const cancelPending = cancelAtPeriodEnd ?? !!sub?.cancel_at_period_end;
  const trialing = status === 'trialing';
  const period = formatPeriodEnd(currentPeriodEnd || sub?.current_period_end, {
    cancel: cancelPending,
    trial: trialing,
  });
  // Say the amount beside the date. A trial screen that shows a date and no
  // figure is the one most likely to end in "I didn't know I'd be charged".
  const priced = PRICING[sub?.plan] || PRICING.monthly;
  const grantLine = grantBacked ? grantCopy({ grantActive, grantExpiresAt }) : null;
  // Extra storage (0415), held until Stripe is set up. Only a paying Creator
  // can change it: a trial buys after its first payment, a canceling plan
  // takes its blocks with it, and comped access has no subscription to bill.
  const blocks = Number(sub?.storage_blocks ?? 0);
  const addonShown = !STORAGE_ADDON_HELD && tier === 'paid' && !grantBacked && !!onAddStorage;
  const addonChangeable = addonShown && status === 'active' && !cancelPending;

  return (
    <>
      {tier === 'paid' && !grantBacked && cancelPending && period && (
        <div className="settings-billing-cancel-note">
          {trialing
            ? <>Trial canceled — you will not be charged. Creator stays on until <b>{period.value}</b>, and anything over the free allowance stays where it is afterwards; you just cannot add more.</>
            : <>Subscription canceled — Creator access stays on until <b>{period.value}</b>.
               You can resubscribe anytime before then.</>}
        </div>
      )}
      <div className="settings-billing-grid">
        <span className="settings-billing-label">Plan</span>
        <span className="settings-billing-value">{plan}</span>

        {tier === 'paid' && !grantBacked && (
          <>
            <span className="settings-billing-label">Status</span>
            <span className="settings-billing-value">{statusLabel(status)}</span>
            {period && (
              <>
                <span className="settings-billing-label">{period.label}</span>
                <span className="settings-billing-value">
                  {period.value}
                  {trialing && !cancelPending && ` · ${priced.billedLabel}`}
                </span>
              </>
            )}
          </>
        )}

        {addonShown && (
          <>
            <span className="settings-billing-label">Extra storage</span>
            <span className="settings-billing-value">
              {blocks > 0 ? `${STORAGE_ADDON_BLOCK_LABEL} × ${blocks}` : 'None'}
              {trialing && ' · after your first payment'}
              {cancelPending && blocks > 0 && period && ` · until ${period.value}`}
            </span>
          </>
        )}

        {grantBacked && (
          <>
            <span className="settings-billing-label">Access</span>
            <span className="settings-billing-value">
              {grantExpiresAt ? `Through ${formatPeriodEnd(grantExpiresAt)?.value || '—'}` : 'No end date'}
            </span>
          </>
        )}
      </div>

      {(tier === 'paid' || tier === 'admin' || tier === 'demo') && <StorageMeter key={storageEpoch} />}

      {grantLine && (
        <p className="settings-section-hint" style={{ marginTop: 8 }}>
          {grantLine}
        </p>
      )}

      {tier === 'admin' && (
        <p className="settings-section-hint" style={{ marginTop: 8 }}>
          You have unlimited admin access — no subscription needed.
        </p>
      )}

      <div className="settings-row-actions">
        {addonChangeable && blocks > 0 && onRemoveStorage && (
          <button type="button" className="settings-btn" onClick={onRemoveStorage}>
            Remove {STORAGE_ADDON_BLOCK_LABEL}
          </button>
        )}
        {addonChangeable && blocks < STORAGE_ADDON_MAX_BLOCKS && (
          <button type="button" className="settings-btn" onClick={onAddStorage}>
            Add {STORAGE_ADDON_BLOCK_LABEL}
          </button>
        )}
        <span style={{ flex: 1 }} />
        {/* Grant-backed users have no Stripe customer — no portal to open. */}
        {tier === 'paid' && !grantBacked && onManage && (
          <button type="button"
                  className="settings-btn settings-btn-primary"
                  disabled={busy}
                  onClick={onManage}>
            {busy ? 'Opening…' : 'Manage billing →'}
          </button>
        )}
        {tier === 'demo' && onUpgrade && (
          <button type="button"
                  className="settings-btn settings-btn-primary"
                  onClick={onUpgrade}>
            {trialOffer ? `${CTA.tryCreator} →` : 'Upgrade to Creator →'}
          </button>
        )}
      </div>
    </>
  );
}
