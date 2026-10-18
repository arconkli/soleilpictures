// Invite & earn — the permanent home for the referral link + stats.
// Two-sided: the friend starts with extra cards and storage; the inviter gets
// cards and the same storage once that friend has opened the app and placed a
// first card (granted server-side, 0377/0416). inviteReward.js holds every
// figure, and the build holds those to the SQL that pays them.
import { useEffect, useState } from 'react';
import { getOrCreateMyReferralCode, getMyReferralStats } from '../../lib/boardsApi.js';
import { logEvent, logEventNow } from '../../lib/analytics.js';
import { EV } from '../../lib/analyticsEvents.js';
import { logClientError } from '../../lib/errorReporting.js';
import { describeReason } from '../../lib/describeReason.js';
import { REFERRAL_PITCH, referralMessage, buildShareTargets } from '../../lib/shareTargets.js';
import {
  REFERRAL_BONUS_CARDS, REFERRAL_REWARD_CARDS, REFERRAL_REWARDS_PER_30_DAYS,
  INVITE_BONUS_STORAGE_LABEL, formatBonusBytes, storageEarnedBytes,
} from '../../lib/inviteReward.js';
import { useFeedback } from '../AppFeedback.jsx';

function ReferralStat({ label, value, highlight }) {
  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1,
                    color: highlight ? 'var(--ink-0)' : 'var(--ink-1)',
                    fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div className="settings-billing-label" style={{ marginTop: 2 }}>{label}</div>
    </div>
  );
}

export function InviteTab({ user }) {
  const feedback = useFeedback();
  const [code, setCode] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(false);
    // allSettled, not all: a failure of ONE of these RPCs must not blank the
    // whole tab. And log genuine failures — this surface used to swallow them
    // silently, which hid a server-side referral-mint outage for a day.
    Promise.allSettled([getOrCreateMyReferralCode(), getMyReferralStats()])
      .then(([codeRes, statsRes]) => {
        if (cancelled) return;
        if (codeRes.status === 'rejected') {
          try { logClientError(describeReason(codeRes.reason, 'referral code'), { kind: 'referral', op: 'get_or_create_my_referral_code' }); } catch (_) {}
        }
        if (statsRes.status === 'rejected') {
          try { logClientError(describeReason(statsRes.reason, 'referral stats'), { kind: 'referral', op: 'get_my_referral_stats' }); } catch (_) {}
        }
        const c = codeRes.status === 'fulfilled' ? codeRes.value : null;
        const s = statsRes.status === 'fulfilled' ? statsRes.value : null;
        const resolved = c || s?.code || null;
        setCode(resolved);
        setStats(s || null);
        setErr(!resolved);   // only "couldn't load" when we have no link at all
        setLoading(false);
        try { logEvent(EV.REFERRAL_TAB_VIEW, { has_code: !!resolved }); } catch (_) {}
      })
      .catch((e) => {
        if (cancelled) return;
        try { logClientError(describeReason(e, 'invite tab load'), { kind: 'referral', op: 'invite_tab_load' }); } catch (_) {}
        setErr(true);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [user?.id]);

  // window.location.origin so the link is correct wherever the app runs
  // (clusters.soleilpictures.com in prod). ?ref flows into signup metadata.
  const link = code ? `${window.location.origin}/?ref=${code}` : '';
  const canNativeShare = typeof navigator !== 'undefined' && !!navigator.share;
  const shareTargets = buildShareTargets(link);

  // Copy the PITCH + link (not a bare URL) so the value prop rides every paste.
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(referralMessage(link));
      feedback.toast({ type: 'success', message: 'Invite message copied — paste it anywhere.' });
    } catch (_) {
      feedback.toast({ type: 'info', message: link });
    }
    try { logEvent(EV.REFERRAL_LINK_COPIED, { surface: 'account_tab' }); } catch (_) {}
  };

  const share = async () => {
    if (!link) return;
    try { logEventNow(EV.REFERRAL_LINK_SHARED, { surface: 'account_tab', channel: 'native' }); } catch (_) {}
    try {
      await navigator.share({ title: 'Clusters', text: REFERRAL_PITCH, url: link });
    } catch (_) { /* user cancelled the share sheet, or it’s unsupported */ }
  };

  // Desktop has no native share sheet — log the per-channel deep-link click so
  // we can see which channels actually drive invites.
  const onShareTarget = (channel) => {
    try { logEventNow(EV.REFERRAL_LINK_SHARED, { surface: 'account_tab', channel }); } catch (_) {}
  };

  if (loading) {
    return <div className="settings-section"><div className="settings-empty">Loading…</div></div>;
  }

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Invite &amp; earn</h3>
      <p className="settings-section-hint">
        Clusters is better with people in it — invite someone to build with you.
        {' '}You <b>both</b> get more room: your friend starts with
        {' '}<b>{REFERRAL_BONUS_CARDS} extra cards and {INVITE_BONUS_STORAGE_LABEL}</b>, and once they
        {' '}place their first card, <b>you get {REFERRAL_REWARD_CARDS} cards and {INVITE_BONUS_STORAGE_LABEL} too</b>.
        {' '}When a friend <b>upgrades to a paid plan, you get a free month</b> — up to 10 a month.
      </p>

      {err || !code ? (
        <div className="settings-empty">Couldn’t load your invite link. Reopen this tab to try again.</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              readOnly
              value={link}
              onFocus={(e) => e.target.select()}
              aria-label="Your invite link"
              style={{
                flex: '1 1 240px', minWidth: 0, padding: '9px 12px', borderRadius: 10,
                border: '1px solid var(--line-1, rgba(255,255,255,.14))',
                background: 'var(--bg-2)',
                color: 'var(--ink-1)', fontSize: 13,
              }}
            />
            <button type="button" className="settings-btn settings-btn-primary" onClick={copy}>Copy message</button>
            {canNativeShare && (
              <button type="button" className="settings-btn" onClick={share}>Share…</button>
            )}
          </div>

          {/* Per-channel deep-links — pre-filled with the pitch. The mobile-only
              native sheet used to be the ONLY thing that carried the message;
              these give desktop the same one-tap share. */}
          {shareTargets.length > 0 && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              {shareTargets.map((t) => (
                <a
                  key={t.key}
                  className="settings-btn"
                  href={t.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => onShareTarget(t.key)}
                  style={{ textDecoration: 'none' }}
                >
                  {t.label}
                </a>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 22, marginTop: 18, flexWrap: 'wrap' }}>
            <ReferralStat label="Friends joined" value={stats?.friendsJoined ?? 0} />
            <ReferralStat label="Got started"    value={stats?.friendsActivated ?? 0} />
            <ReferralStat label="Cards earned"   value={stats?.cardsEarned ?? 0} highlight />
            <ReferralStat label="Storage earned" value={formatBonusBytes(storageEarnedBytes(stats?.cardsEarned))} highlight />
            {(stats?.monthsEarned ?? 0) > 0 && (
              <ReferralStat label="Free months" value={stats.monthsEarned} highlight />
            )}
          </div>
          {stats?.pending > 0 && (
            <p className="settings-section-hint" style={{ marginTop: 12 }}>
              {stats.pending} {stats.pending === 1 ? 'friend has joined but hasn’t' : 'friends have joined but haven’t'}
              {' '}placed a first card yet. You earn {REFERRAL_REWARD_CARDS} cards and {INVITE_BONUS_STORAGE_LABEL} for each friend who gets started.
            </p>
          )}
          {(stats?.rewardsWaiting ?? 0) > 0 && (
            <p className="settings-section-hint" style={{ marginTop: 8 }}>
              Rewards for {stats.rewardsWaiting} {stats.rewardsWaiting === 1 ? 'friend' : 'friends'} are on the way.
              {' '}They land as the 30-day limit frees, for up to {REFERRAL_REWARDS_PER_30_DAYS} friends a month.
            </p>
          )}
          {(stats?.friendsPaid ?? 0) > 0 && (
            <p className="settings-section-hint" style={{ marginTop: 8 }}>
              {stats.friendsPaid} {stats.friendsPaid === 1 ? 'friend' : 'friends'} you invited
              {' '}upgraded to a paid plan — that’s {stats.monthsEarned} free {stats.monthsEarned === 1 ? 'month' : 'months'} for you.
            </p>
          )}
        </>
      )}
    </div>
  );
}
