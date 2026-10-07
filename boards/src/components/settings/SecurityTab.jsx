// Security — the admin end of the outbound breaker (migrations 0369/0370).
//
// Every security alert email links here (?settings=security), so this is where
// an owner decides: is invitation mail on hold, whose mail is held, which
// accounts are on a sending hold, and what has been alerted lately. It is a
// Settings tab rather than an /admin page because /admin is desktop-only and an
// alert is as likely to be read on a phone.
//
// Held mail is never sent on its own. Send releases it exactly as it was
// queued, Drop discards it; both ask first, because a send cannot be taken back
// and a blast's mail must not go out on a mis-tap. Every action is an admin RPC
// behind _require_admin() — the tab only rendering for an admin is cosmetic.
import { useEffect, useState } from 'react';
import { useFeedback } from '../AppFeedback.jsx';
import { SettingsCategory } from './fields.jsx';
import {
  securityOverview, releaseBreaker, sendHeldMail, dropHeldMail,
  liftSendingHold, ackAlert, sendTestAlert,
} from '../../lib/securityAdminApi.js';

const TEMPLATE_LABEL = {
  pending_invite: 'invitation',
  board_shared: 'share',
  workspace_invite: 'workspace invite',
  mention_email: 'mention',
  comment_reply_email: 'reply',
  schedule_update: 'schedule',
  invite_accepted: 'joined',
};

function when(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function SecurityTab() {
  const feedback = useFeedback();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [openAlert, setOpenAlert] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      setData(await securityOverview());
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Could not load security: ' + (e.message || e) });
    } finally {
      setLoading(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const act = async (fn, success) => {
    setBusy(true);
    try {
      const result = await fn();
      feedback.toast({ type: 'success', message: typeof success === 'function' ? success(result) : success });
      await load();
    } catch (e) {
      feedback.toast({ type: 'error', message: e.message || String(e) });
    } finally {
      setBusy(false);
    }
  };

  const breaker = data?.breaker || null;
  const heldMail = data?.held_mail || [];
  const heldAccounts = data?.held_accounts || [];
  const alerts = data?.alerts || [];
  const week = data?.last_7d || {};
  const n = (k) => Number(week[k] || 0);

  const onReleaseBreaker = async () => {
    const ok = await feedback.confirm({
      title: 'Let invitation emails flow again?',
      message: 'New invitations, shares and workspace invites will send as normal. Mail held while the breaker was tripped stays held until you send or drop it below.',
      confirmLabel: 'Release the hold',
    });
    if (ok) act(releaseBreaker, 'Invitation emails are flowing again.');
  };

  const onSend = async (g) => {
    const who = g.email || 'this account';
    const ok = await feedback.confirm({
      title: `Send ${plural(Number(g.count), 'held email')} from ${who}?`,
      message: 'They go out exactly as they were queued. This cannot be undone.',
      confirmLabel: 'Send them',
      danger: true,
    });
    if (ok) act(() => sendHeldMail(g.actor), (sent) => `Sent ${plural(Number(sent) || 0, 'email')}.`);
  };

  const onDrop = async (g) => {
    const who = g.email || 'this account';
    const ok = await feedback.confirm({
      title: `Drop ${plural(Number(g.count), 'held email')} from ${who}?`,
      message: 'They are discarded and never sent.',
      confirmLabel: 'Drop them',
      danger: true,
    });
    if (ok) act(() => dropHeldMail(g.actor), (dropped) => `Dropped ${plural(Number(dropped) || 0, 'email')}.`);
  };

  const onLift = async (a) => {
    const ok = await feedback.confirm({
      title: `Let ${a.email} share and invite again?`,
      message: 'Their unclaimed invitations start working again. Mail held from them stays held until you send or drop it.',
      confirmLabel: 'Lift the hold',
    });
    if (ok) act(() => liftSendingHold(a.user_id), `${a.email} can share again.`);
  };

  return (
    <div className="settings-section settings-security">
      <h3 className="settings-section-title">Security</h3>
      <p className="settings-section-hint">
        Every email the app sends on someone&apos;s behalf passes the outbound breaker. When it
        {' '}holds mail or pauses an account, an alert is emailed to you and lands here.
      </p>

      <SettingsCategory title="Invitation mail" desc="Invitations, shares and workspace invites — mail to people outside the product">
        {breaker?.global_hold_since ? (
          <p className="settings-section-hint">
            <strong>On hold</strong> since {when(breaker.global_hold_since)}. {breaker.reason}
          </p>
        ) : (
          <p className="settings-section-hint">
            Flowing. If volume spikes, the breaker holds all of it and alerts you.
          </p>
        )}
        <p className="settings-section-hint">
          Last 7 days: {n('stranger:sent') + n('stranger:released')} sent, {n('stranger:held')} held,
          {' '}{n('stranger:dropped')} dropped. Mentions, replies and schedule mail:
          {' '}{n('member:sent') + n('member:released')} sent, {n('member:held')} held, {n('member:dropped')} dropped.
        </p>
        {breaker?.global_hold_since && (
          <div className="settings-row-actions">
            <span style={{ flex: 1 }} />
            <button type="button" className="settings-btn" disabled={busy} onClick={onReleaseBreaker}>
              Release the hold
            </button>
          </div>
        )}
      </SettingsCategory>

      <SettingsCategory title="Held mail" desc="Waiting for you to send or drop it. It expires after a week.">
        {loading && !data && <div className="settings-empty">Loading…</div>}
        {data && heldMail.length === 0 && <div className="settings-empty">Nothing held.</div>}
        <ul className="settings-member-list">
          {heldMail.map((g) => (
            <li key={g.actor || 'system'} className="settings-member-row">
              <span className="settings-member-name" title={g.email || ''}>
                {g.email || 'No sender (system)'}
              </span>
              <span className="settings-member-role">
                {plural(Number(g.count), 'email')} · {(g.templates || []).map((t) => TEMPLATE_LABEL[t] || t).join(', ')} · since {when(g.oldest)}
              </span>
              {g.actor && (
                <span className="settings-member-actions">
                  <button type="button" className="settings-link-btn" disabled={busy} onClick={() => onSend(g)}>Send</button>
                  <button type="button" className="settings-link-btn is-danger" disabled={busy} onClick={() => onDrop(g)}>Drop</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      </SettingsCategory>

      <SettingsCategory title="Accounts on a sending hold" desc="They can use their own clusters, but cannot share, invite or mention anyone">
        {data && heldAccounts.length === 0 && <div className="settings-empty">None.</div>}
        <ul className="settings-member-list">
          {heldAccounts.map((a) => (
            <li key={a.user_id} className="settings-member-row">
              <span className="settings-member-name" title={a.reason || ''}>{a.email}</span>
              <span className="settings-member-role">since {when(a.since)}</span>
              <span className="settings-member-actions">
                <button type="button" className="settings-link-btn" disabled={busy} onClick={() => onLift(a)}>Lift hold</button>
              </span>
            </li>
          ))}
        </ul>
      </SettingsCategory>

      <SettingsCategory title="Recent alerts" desc="The last 50. Emailed ones say so.">
        {data && alerts.length === 0 && <div className="settings-empty">No alerts yet.</div>}
        <ul className="settings-member-list">
          {alerts.map((a) => (
            <li key={a.id} className="settings-member-row" style={{ flexWrap: 'wrap' }}>
              <button type="button" className="settings-link-btn settings-member-name" style={{ textAlign: 'left' }}
                      aria-expanded={openAlert === a.id}
                      onClick={() => setOpenAlert(openAlert === a.id ? null : a.id)}>
                {a.title}
              </button>
              <span className="settings-member-role">
                {when(a.created_at)} · {a.page ? (a.paged_at ? 'emailed' : 'sending') : 'here only'}
                {a.acked_at ? ' · seen' : ''}
              </span>
              {!a.acked_at && (
                <span className="settings-member-actions">
                  <button type="button" className="settings-link-btn" disabled={busy}
                          onClick={() => act(() => ackAlert(a.id), 'Marked as seen.')}>Seen</button>
                </span>
              )}
              {openAlert === a.id && (
                <p className="settings-section-hint" style={{ flexBasis: '100%', whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>
                  {a.body}
                </p>
              )}
            </li>
          ))}
        </ul>
      </SettingsCategory>

      <SettingsCategory title="Check the alert path" desc="Sends a harmless alert to the owner's inbox">
        <div className="settings-row-actions">
          <button type="button" className="settings-btn" disabled={busy || loading} onClick={() => load()}>Refresh</button>
          <span style={{ flex: 1 }} />
          <button type="button" className="settings-btn" disabled={busy}
                  onClick={() => act(sendTestAlert, 'Test alert queued. It should arrive within two minutes.')}>
            Send a test alert
          </button>
        </div>
      </SettingsCategory>
    </div>
  );
}
