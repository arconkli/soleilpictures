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
//
// Ban (0371/0373) is the existing admin-account-action: the account is signed
// out everywhere, and everything it shared, published or sent stops working.
// Unban brings all of it back, because nothing was deleted — the record of
// what it had out in the world is kept in account_actions either way.
import { useEffect, useState } from 'react';
import { useFeedback } from '../AppFeedback.jsx';
import { SettingsCategory } from './fields.jsx';
import {
  securityOverview, releaseBreaker, sendHeldMail, dropHeldMail, sendHeldMailIds, dropHeldMailIds,
  liftSendingHold, ackAlert, sendTestAlert, banAccount, unbanAccount,
} from '../../lib/securityAdminApi.js';

const ACTION_LABEL = {
  ban: 'Banned',
  unban: 'Unbanned',
  send_hold: 'Sharing paused',
  send_release: 'Sharing restored',
};

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
  const [openAction, setOpenAction] = useState(null);

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
  const banned = data?.banned_accounts || [];
  const actions = data?.actions || [];
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
    if (ok) act(() => (g.actor ? sendHeldMail(g.actor) : sendHeldMailIds(g.ids || [])),
                (sent) => `Sent ${plural(Number(sent) || 0, 'email')}.`);
  };

  const onDrop = async (g) => {
    const who = g.email || 'this account';
    const ok = await feedback.confirm({
      title: `Drop ${plural(Number(g.count), 'held email')} from ${who}?`,
      message: 'They are discarded and never sent.',
      confirmLabel: 'Drop them',
      danger: true,
    });
    if (ok) act(() => (g.actor ? dropHeldMail(g.actor) : dropHeldMailIds(g.ids || [])),
                (dropped) => `Dropped ${plural(Number(dropped) || 0, 'email')}.`);
  };

  const onLift = async (a) => {
    const ok = await feedback.confirm({
      title: `Let ${a.email} share and invite again?`,
      message: 'Their unclaimed invitations start working again. Mail held from them stays held until you send or drop it.',
      confirmLabel: 'Lift the hold',
    });
    if (ok) act(() => liftSendingHold(a.user_id), `${a.email} can share again.`);
  };

  const onBan = async (a) => {
    const reason = await feedback.prompt({
      title: `Ban ${a.email}?`,
      message: 'They are signed out everywhere and cannot sign in. Their share links, published clusters, invitations and API keys stop working, and any subscription is cancelled. Unbanning brings everything back except the subscription.',
      label: 'Reason (kept with the record)',
      defaultValue: a.reason || '',
      confirmLabel: 'Ban account',
    });
    if (reason == null) return;
    act(() => banAccount(a.user_id, String(reason).trim() || 'banned from the Security tab'), `${a.email} is banned.`);
  };

  const onUnban = async (a) => {
    const ok = await feedback.confirm({
      title: `Unban ${a.email}?`,
      message: 'They can sign in again, and their links, published clusters, invitations and keys work again. A cancelled subscription is not restored.',
      confirmLabel: 'Unban',
    });
    if (ok) act(() => unbanAccount(a.user_id), `${a.email} is unbanned.`);
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
              {(g.actor || (g.ids && g.ids.length > 0)) && (
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
                <button type="button" className="settings-link-btn is-danger" disabled={busy} onClick={() => onBan(a)}>Ban</button>
              </span>
            </li>
          ))}
        </ul>
      </SettingsCategory>

      <SettingsCategory title="Banned accounts" desc="Signed out, and nothing they shared, published or sent works">
        {data && banned.length === 0 && <div className="settings-empty">None.</div>}
        <ul className="settings-member-list">
          {banned.map((a) => (
            <li key={a.user_id} className="settings-member-row">
              <span className="settings-member-name" title={a.reason || ''}>{a.email}</span>
              <span className="settings-member-role">since {when(a.since)}</span>
              <span className="settings-member-actions">
                <button type="button" className="settings-link-btn" disabled={busy} onClick={() => onUnban(a)}>Unban</button>
              </span>
            </li>
          ))}
        </ul>
      </SettingsCategory>

      <SettingsCategory title="Account actions" desc="Every ban and sharing hold, with what the account had out at the time">
        {data && actions.length === 0 && <div className="settings-empty">None yet.</div>}
        <ul className="settings-member-list">
          {actions.map((x) => (
            <li key={x.id} className="settings-member-row" style={{ flexWrap: 'wrap' }}>
              <button type="button" className="settings-link-btn settings-member-name" style={{ textAlign: 'left' }}
                      aria-expanded={openAction === x.id} disabled={!x.evidence && !x.reason}
                      onClick={() => setOpenAction(openAction === x.id ? null : x.id)}>
                {ACTION_LABEL[x.action] || x.action} · {x.email || x.user_id}
              </button>
              <span className="settings-member-role">{when(x.created_at)}</span>
              {openAction === x.id && (
                <p className="settings-section-hint"
                   style={{ flexBasis: '100%', maxWidth: 'none', whiteSpace: 'pre-wrap', margin: '6px 0 0', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }}>
                  {[x.reason, x.evidence ? JSON.stringify(x.evidence, null, 2) : ''].filter(Boolean).join('\n\n')}
                </p>
              )}
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
                <p className="settings-section-hint" style={{ flexBasis: '100%', maxWidth: 'none', whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>
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
