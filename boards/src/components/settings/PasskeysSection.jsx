// Settings › Profile › Passkeys (2026-10-29): the passkeys this account can
// sign in with, when each was added and last used, a way to add one on this
// device, and Remove.
//
// Remove follows the house rule: the row goes at once and an Undo toast
// offers it back. A deleted passkey can't be restored, so the delete itself
// waits until the Undo has run out (UNDO_MS, the toast's own life, plus a beat).
//
// Shown only where a passkey can work (lib/passkeys.js passkeySupport): never
// on a preview host or localhost, where every ceremony would fail.
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { passkeySupport, savePasskey, passkeyRows } from '../../lib/passkeys.js';
import { passkeyErrorWords, passkeyFailReason } from '../../lib/passkeyWords.js';
import { logEvent } from '../../lib/analytics.js';
import { EV } from '../../lib/analyticsEvents.js';
import { useFeedback } from '../AppFeedback.jsx';
import { Field } from './fields.jsx';

const UNDO_MS = 8000;
// Deletes waiting out their Undo. Module-level, so closing Settings doesn't
// cancel one; a page closed before it runs leaves the passkey in place.
const pending = new Map();

function when(iso) {
  const t = Date.parse(String(iso || ''));
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function PasskeysSection() {
  const feedback = useFeedback();
  const [supported, setSupported] = useState(false);
  const [list, setList] = useState(null);   // null = loading
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  const load = async () => {
    const { data, error } = await supabase.auth.passkey.list();
    if (error) { setProblem("Couldn't load your passkeys."); setList([]); return; }
    setProblem(null);
    setList(passkeyRows(data).filter((p) => !pending.has(p.id)));
  };

  useEffect(() => {
    let live = true;
    passkeySupport().then((s) => {
      if (!live || !s.link) return;
      setSupported(true);
      load();
    }).catch(() => {});
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!supported) return null;

  const add = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const { error } = await savePasskey();
    setBusy(false);
    if (error) {
      try { logEvent(EV.PASSKEY_SAVE_FAILED, { via: 'settings', reason: passkeyFailReason(error) }); } catch (_) {}
      const words = passkeyErrorWords(error, { saving: true });
      if (words) setProblem(words);
      return;
    }
    try { logEvent(EV.PASSKEY_SAVED, { via: 'settings' }); } catch (_) {}
    feedback.toast({ type: 'success', message: 'Passkey saved. Next time, tap the email box and pick it.' });
    load();
  };

  const remove = (p) => {
    setList((cur) => (cur || []).filter((x) => x.id !== p.id));
    // The delete waits a beat past the toast, so an Undo pressed as it fades
    // still wins; once it has started, Undo has nothing left to take back.
    const timer = setTimeout(async () => {
      pending.delete(p.id);
      const { error } = await supabase.auth.passkey.delete({ passkeyId: p.id });
      if (error) {
        feedback.toast({ type: 'error', code: 'passkey_remove_failed', message: "Couldn't remove that passkey. Try again." });
        load();
        return;
      }
      try { logEvent(EV.PASSKEY_REMOVED); } catch (_) {}
    }, UNDO_MS + 1500);
    pending.set(p.id, timer);
    feedback.toast({
      type: 'info',
      message: 'Passkey removed.',
      ttl: UNDO_MS,
      action: {
        label: 'Undo',
        onClick: () => {
          if (!pending.has(p.id)) return;
          clearTimeout(pending.get(p.id));
          pending.delete(p.id);
          load();
        },
      },
    });
  };

  return (
    <Field label="Passkeys">
      <p className="settings-section-hint" style={{ marginTop: 0 }}>
        Sign in with your face, fingerprint or device PIN instead of an emailed code.
      </p>
      {list === null && <div className="settings-empty">Loading…</div>}
      {list && list.length > 0 && (
        <ul className="settings-member-list">
          {list.map((p) => {
            const added = when(p.created_at);
            const used = when(p.last_used_at);
            return (
              <li key={p.id} className="settings-member-row">
                <span className="settings-member-name">{p.friendly_name || 'Passkey'}</span>
                <span className="settings-member-role">
                  {added ? `Added ${added}` : ''}{used ? ` · Last used ${used}` : ''}
                </span>
                <span className="settings-member-actions">
                  <button type="button" className="settings-link-btn" onClick={() => remove(p)}>Remove</button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {problem && <div className="settings-empty" role="alert">{problem}</div>}
      <div className="settings-row-actions" style={{ marginTop: 10 }}>
        <button type="button" className="settings-btn" onClick={add} disabled={busy || list === null}>
          {busy ? 'Waiting for your device…' : 'Add a passkey'}
        </button>
      </div>
    </Field>
  );
}
