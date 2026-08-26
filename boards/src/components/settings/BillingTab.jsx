// Billing — the caller's current plan and the action appropriate to their tier:
//   admin     → "Unlimited admin access"
//   paid      → plan + status + next renewal, "Manage billing →" (Stripe Portal)
//   demo      → card count + "Upgrade to Creator" button (opens PricingModal)
//   waitlist  → defensive note (this surface shouldn't be reachable)
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { logEvent } from '../../lib/analytics.js';
import { EV } from '../../lib/analyticsEvents.js';
import { planLabel, formatPeriodEnd, grantCopy } from '../../lib/billingCopy.js';
import { startPortal } from '../../lib/checkout.js';
import { checkoutErrorMessage } from '../../lib/checkoutErrors.js';
import { useFeedback } from '../AppFeedback.jsx';
import { useMyTier } from '../../hooks/useMyTier.js';
import { useStorageUsage } from '../../hooks/useStorageUsage.js';
import { PricingModal } from '../PricingModal.jsx';

export function BillingTab({ user }) {
  const feedback = useFeedback();
  const { tier, demoCardCount, subscriptionStatus, currentPeriodEnd, cancelAtPeriodEnd,
          grantActive, grantExpiresAt, effectiveCardLimit, loading } =
    useMyTier({ userId: user?.id });
  const [sub, setSub] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    supabase.from('subscriptions')
      .select('plan, status, current_period_end, cancel_at_period_end')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled) setSub(data || null); });
    return () => { cancelled = true; };
  }, [user?.id]);

  const openPortal = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await startPortal({ surface: 'settings' });
    } catch (e) {
      feedback.toast({ type: 'error', message: checkoutErrorMessage(e) });
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="settings-section"><div className="settings-empty">Loading…</div></div>;
  }

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Billing</h3>
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
        busy={busy}
        onManage={openPortal}
        onUpgrade={() => {
          // Was dark: only the downstream modal pricing_view fired, so Settings
          // upgrades were indistinguishable from every other modal entry.
          logEvent(EV.UP_SETTINGS_CLICK, {});
          setPricingOpen(true);
        }} />

      {pricingOpen && <PricingModal onClose={() => setPricingOpen(false)} via="settings" />}
    </div>
  );
}

function fmtBytes(b) {
  if (b == null) return '—';
  const gb = b / (1024 ** 3);
  if (gb >= 1) return `${gb >= 10 ? Math.round(gb) : gb.toFixed(1)} GB`;
  const mb = b / (1024 ** 2);
  if (mb >= 1) return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
  return `${Math.round(b / 1024)} KB`;
}

// "X / 100 GB" usage meter for paid accounts (storage is a paid feature).
// Shows used / quota, the live fill bar, and a remaining + percent sub-line so
// it reads as a real usage gauge wherever it's mounted.
export function StorageMeter() {
  const usage = useStorageUsage({ enabled: true });
  const pct = usage.quota ? Math.min(100, (usage.used / usage.quota) * 100) : 0;
  const near = pct >= 90;
  const remaining = usage.remaining != null
    ? usage.remaining
    : (usage.quota != null ? Math.max(0, usage.quota - usage.used) : null);
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
          background: near ? '#ef4444' : 'var(--soleil, #ffa500)',
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
    </div>
  );
}

// The plan rows + the primary CTA. Split out from BillingTab so the framing
// (heading, hint, error UI, upgrade modal) stays with the tab and this stays a
// pure presentation of whatever tier state the caller resolved.
export function BillingSummary({
  tier, sub, subscriptionStatus, currentPeriodEnd, cancelAtPeriodEnd,
  grantActive, grantExpiresAt, demoCardCount, effectiveCardLimit,
  busy, onManage, onUpgrade,
}) {
  const status = subscriptionStatus || sub?.status || null;
  // Paid access via an admin grant (no paying Stripe sub) — there's no portal to
  // manage, so we show the complimentary note instead of Stripe status/renewal.
  const grantBacked = tier === 'paid' && grantActive && !['active', 'trialing'].includes(status || '');
  const plan = planLabel({ tier, plan: sub?.plan, demoCardCount, grantBacked, cardLimit: effectiveCardLimit });
  // Prefer the fresh RPC value; fall back to the subscriptions-row query.
  const cancelPending = cancelAtPeriodEnd ?? !!sub?.cancel_at_period_end;
  const period = formatPeriodEnd(currentPeriodEnd || sub?.current_period_end, {
    cancel: cancelPending,
  });
  const grantLine = grantBacked ? grantCopy({ grantActive, grantExpiresAt }) : null;

  return (
    <>
      {tier === 'paid' && !grantBacked && cancelPending && period && (
        <div className="settings-billing-cancel-note">
          Subscription canceled — Creator access stays on until <b>{period.value}</b>.
          You can resubscribe anytime before then.
        </div>
      )}
      <div className="settings-billing-grid">
        <span className="settings-billing-label">Plan</span>
        <span className="settings-billing-value">{plan}</span>

        {tier === 'paid' && !grantBacked && (
          <>
            <span className="settings-billing-label">Status</span>
            <span className="settings-billing-value">{status || '—'}</span>
            {period && (
              <>
                <span className="settings-billing-label">{period.label}</span>
                <span className="settings-billing-value">{period.value}</span>
              </>
            )}
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

      {tier === 'paid' && <StorageMeter />}

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
            Upgrade to Creator →
          </button>
        )}
      </div>
    </>
  );
}
