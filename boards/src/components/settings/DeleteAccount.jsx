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
import { getDeletionImpact, deleteOwnAccount, signOutAfterDeletion } from '../../lib/deleteAccount.js';
import { useFeedback } from '../AppFeedback.jsx';

function Impact({ data }) {
  if (!data) return null;
  const gone = data.workspaces_deleted || [];
  const moved = data.workspaces_transferred || [];
  return (
    <ul className="settings-danger-list">
      {gone.length > 0 && (
        <li>
          <b>{data.clusters_deleted} cluster{data.clusters_deleted === 1 ? '' : 's'}</b>
          {' '}in {gone.map((w) => w.name).join(', ')} — deleted, with everything on them.
        </li>
      )}
      {/* Named, because "your workspaces will be transferred" is the sort of
          sentence people agree to and then dispute afterwards. */}
      {moved.map((w) => (
        <li key={w.id}>
          <b>{w.name}</b> has other people in it, so it stays and
          {' '}<b>{w.to_name}</b> becomes its owner.
        </li>
      ))}
      {data.memberships_dropped > 0 && (
        <li>
          You leave <b>{data.memberships_dropped}</b> workspace
          {data.memberships_dropped === 1 ? '' : 's'} you were a member of. Nothing there is lost.
        </li>
      )}
      {data.subscription_active && (
        <li>Your subscription is <b>canceled</b> — no further charges.</li>
      )}
      <li>
        Comments, tags and votes you left on other people's clusters stay where
        they are, with your name removed.
      </li>
    </ul>
  );
}

export function DeleteAccount({ email }) {
  const feedback = useFeedback();
  const [open, setOpen] = useState(false);
  const [impact, setImpact] = useState(null);
  const [loading, setLoading] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  // Fetched on expand rather than on mount: it is a round-trip that only
  // matters to someone who has asked this question.
  const expand = async () => {
    setOpen(true);
    if (impact || loading) return;
    setLoading(true);
    try {
      setImpact(await getDeletionImpact());
    } catch (_) {
      feedback.toast({ type: 'error', message: 'Could not work out what deleting would affect. Try again in a moment.' });
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  const matches = typed.trim().toLowerCase() === (email || '').trim().toLowerCase();

  const run = async () => {
    if (!matches || busy) return;
    const ok = await feedback.confirm({
      title: 'Delete your account?',
      message: 'This removes your account and everything only you can see. It cannot be undone, and support cannot restore it.',
      confirmLabel: 'Delete permanently',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteOwnAccount({ confirmEmail: typed.trim() });
      await signOutAfterDeletion();
    } catch (err) {
      feedback.toast({ type: 'error', message: err.message || 'Could not delete your account.' });
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="settings-row-actions" style={{ marginTop: 18 }}>
        <button type="button" className="settings-link-btn settings-danger-link"
                onClick={expand}>Delete account…</button>
        <span style={{ flex: 1 }} />
      </div>
    );
  }

  return (
    <div className="settings-callout settings-callout-danger">
      <div className="settings-callout-title">Delete your account</div>
      {loading ? (
        <p>Working out what this would affect…</p>
      ) : (
        <>
          <p>Here is what happens to this account, right now:</p>
          <Impact data={impact} />
          <p>
            There is no undo and no grace period. To confirm, type
            {' '}<b>{email}</b> below.
          </p>
          <div className="api-token-row" style={{ marginTop: 8 }}>
            <input className="auth-input"
                   type="email"
                   autoComplete="off"
                   spellCheck={false}
                   placeholder={email}
                   aria-label="Type your email address to confirm"
                   value={typed}
                   disabled={busy}
                   onChange={(e) => setTyped(e.target.value)} />
            <button type="button" className="settings-btn settings-btn-danger"
                    disabled={!matches || busy}
                    onClick={run}>
              {busy ? 'Deleting…' : 'Delete my account'}
            </button>
            <button type="button" className="settings-btn"
                    disabled={busy}
                    onClick={() => { setOpen(false); setTyped(''); }}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}
