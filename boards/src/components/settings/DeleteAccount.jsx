// The one operation in Clusters that genuinely cannot be undone.
//
// Everything else destructive here ships an undo toast, which is the house
// convention. This deliberately does not: there is nothing left to undo with
// once the auth user is gone. So the weight goes somewhere else — the screen
// states what will actually happen to THIS account, from the server, before it
// asks; and the confirmation is re-typing your own address rather than a
// button you can hit by reflex.
//
// Collapsed until asked for. A permanently-open delete panel under your
// profile picture is its own kind of hazard.
import { useState } from 'react';
import { getDeletionImpact, deleteOwnAccount, signOutAfterDeletion, submitDeletionReason } from '../../lib/deleteAccount.js';
import { useFeedback } from '../AppFeedback.jsx';
import { t, ph, plural } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { rich } from '../../lib/richParts.js';
import { shownError } from '../../lib/errorWords.js';
import { uiLocale } from '../../lib/uiLocale.js';
import { formatList } from '../../lib/intlFormat.js';

// A message with **bold** runs, drawn as bold.
const Bold = ({ text }) => rich(text).map((p, i) => (typeof p === 'string' ? p : <b key={i}>{p.b}</b>));

function Impact({ data }) {
  if (!data) return null;
  const gone = data.workspaces_deleted || [];
  const moved = data.workspaces_transferred || [];
  // English joins with ', ' exactly as before; other languages get "a, b and c".
  const names = uiLocale() === 'en' ? gone.map((w) => w.name).join(', ') : formatList(gone.map((w) => w.name));
  const clustersLine = t`${plural(data.clusters_deleted, { one: `**# cluster** in ${names} — deleted, with everything on them.`, other: `**# clusters** in ${names} — deleted, with everything on them.` })}`;
  const membershipsLine = t`${plural(data.memberships_dropped, { one: 'You leave **#** workspace you were a member of. Nothing there is lost.', other: 'You leave **#** workspaces you were a member of. Nothing there is lost.' })}`;
  return (
    <ul className="settings-danger-list">
      {gone.length > 0 && (
        <li>
          <Bold text={clustersLine} />
        </li>
      )}
      {/* Named, because "your workspaces will be transferred" is the sort of
          sentence people agree to and then dispute afterwards. */}
      {moved.map((w) => (
        <li key={w.id}>
          <Trans><b>{ph({ name: w.name })}</b> has other people in it, so it stays and <b>{ph({ to_name: w.to_name })}</b> becomes its owner.</Trans>
        </li>
      ))}
      {data.memberships_dropped > 0 && (
        <li>
          <Bold text={membershipsLine} />
        </li>
      )}
      {data.subscription_active && (
        <li><Trans>Your subscription is <b>canceled</b> — no further charges.</Trans></li>
      )}
      <li>
        <Trans>Comments, tags and votes you left on other people's clusters stay where
        they are, with your name removed.</Trans>
      </li>
    </ul>
  );
}

export function DeleteAccount({ email, onSignOut }) {
  const feedback = useFeedback();
  const [open, setOpen] = useState(false);
  const [impact, setImpact] = useState(null);
  const [loading, setLoading] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');

  // Fetched on expand rather than on mount: it is a round-trip that only
  // matters to someone who has asked this question.
  const expand = async () => {
    setOpen(true);
    if (impact || loading) return;
    setLoading(true);
    try {
      setImpact(await getDeletionImpact());
    } catch (_) {
      feedback.toast({ type: 'error', code: 'account_impact_failed', message: t`Could not work out what deleting would affect. Try again in a moment.` });
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  const matches = typed.trim().toLowerCase() === (email || '').trim().toLowerCase();

  const run = async () => {
    if (!matches || busy) return;
    const ok = await feedback.confirm({
      title: t`Delete your account?`,
      message: t`This removes your account and everything only you can see. It cannot be undone, and support cannot restore it.`,
      confirmLabel: t`Delete permanently`,
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    // The reason first, while this account can still be authenticated. It is
    // the one sentence a leaving person will type, and until now the product
    // discarded it. Best-effort: a failure here never stops the deletion.
    try { await submitDeletionReason(reason); } catch (_) { /* courtesy, not the request */ }
    try {
      await deleteOwnAccount({ confirmEmail: typed.trim() });
      await signOutAfterDeletion();
    } catch (err) {
      feedback.toast({ type: 'error', code: 'account_delete_failed', message: shownError(err, t`Could not delete your account.`) });
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="settings-row-actions" style={{ marginTop: 18 }}>
        <button type="button" className="settings-link-btn settings-danger-link"
                onClick={expand}><Trans>Delete account…</Trans></button>
        <span style={{ flex: 1 }} />
      </div>
    );
  }

  return (
    <div className="settings-callout settings-callout-danger">
      <div className="settings-callout-title"><Trans>Delete your account</Trans></div>
      {onSignOut && (
        <div className="settings-switch">
          <span><Trans>Only want to use a different email? Sign out instead: nothing is deleted, and you can sign in with the other one.</Trans></span>
          <button type="button" className="settings-btn" disabled={busy}
                  onClick={onSignOut}><Trans>Sign out</Trans></button>
        </div>
      )}
      {loading ? (
        <p><Trans>Working out what this would affect…</Trans></p>
      ) : (
        <>
          <p><Trans>Here is what happens to this account, right now:</Trans></p>
          <Impact data={impact} />
          <label className="settings-field" style={{ display: 'block', marginTop: 8 }}>
            <span className="settings-field-label">
              <Trans>Anything you want us to know? <span style={{ opacity: 0.6 }}>(optional)</span></Trans>
            </span>
            <textarea className="auth-input" rows={2} maxLength={500}
                      placeholder={t`Why you're leaving, what didn't work, what you use instead.`}
                      value={reason} disabled={busy}
                      onChange={(e) => setReason(e.target.value)} />
          </label>
          <p>
            <Trans>There is no undo and no grace period. To confirm, type
            {' '}<b>{email}</b> below.</Trans>
          </p>
          <div className="api-token-row" style={{ marginTop: 8 }}>
            <input className="auth-input"
                   type="email"
                   autoComplete="off"
                   spellCheck={false}
                   placeholder={email}
                   aria-label={t`Type your email address to confirm`}
                   value={typed}
                   disabled={busy}
                   onChange={(e) => setTyped(e.target.value)} />
            <button type="button" className="settings-btn settings-btn-danger"
                    disabled={!matches || busy}
                    onClick={run}>
              {busy ? t`Deleting…` : t`Delete my account`}
            </button>
            <button type="button" className="settings-btn"
                    disabled={busy}
                    onClick={() => { setOpen(false); setTyped(''); }}><Trans>Cancel</Trans></button>
          </div>
        </>
      )}
    </div>
  );
}
