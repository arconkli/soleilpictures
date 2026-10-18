import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal.jsx';
import { supabase } from '../lib/supabase.js';
import { logEvent } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { storageAddonCopy } from '../lib/billingCopy.js';
import { applyStorageAddon, newAddonRequestId, previewStorageAddon, storageAddonErrorMessage } from '../lib/storageAddon.js';
import './importCapDialog.css';

// Add (or remove) 1TB of extra storage in one click, on the card the Creator
// plan already bills — no checkout (owner decision 2026-10-17).
//
// The sheet never computes a price. It asks the storage-addon function for a
// preview (Stripe's own prorated figure, at a proration date the apply then
// reuses), so the amount on the button is the amount charged. A card that
// needs 3D Secure, or is declined, changes nothing: Stripe holds the change
// until its invoice is paid, and the sheet sends the reader to that invoice.
//
// Offered since billingCopy STORAGE_ADDON_HELD lifted (2026-10-18), from
// Settings → Plan & billing, a paying owner's drive-full toasts and the
// import dialog when the drive is what overflows.
//
// `mode` 'add' | 'remove'. `surface` says what opened it, for the event.
// `onDone({ blocks, quotaBytes })` after a change that took effect.
export function StorageAddonSheet({ open, mode = 'add', surface = 'settings', onClose, onDone }) {
  const primaryRef = useRef(null);
  const [phase, setPhase] = useState('loading');   // loading | ready | working | pay | error
  const [preview, setPreview] = useState(null);
  const [message, setMessage] = useState('');
  const [payUrl, setPayUrl] = useState(null);
  // The failed step, so Try again repeats exactly it: an apply is resent with
  // the same total and the same request id, never recomputed from the mirror.
  const [failedAt, setFailedAt] = useState(null);   // 'preview' | 'apply'
  const [attempt, setAttempt] = useState(0);
  const requestIdRef = useRef(null);
  const removing = mode === 'remove';

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setPhase('loading');
    setPreview(null);
    setMessage('');
    setPayUrl(null);
    setFailedAt(null);
    requestIdRef.current = newAddonRequestId();
    if (attempt === 0) logEvent(EV.STORAGE_ADDON_VIEW, { surface, mode });
    (async () => {
      // The reader's own block count, from their mirror row (RLS: subs read
      // self). The function checks it against Stripe before anything moves.
      const { data } = await supabase.from('subscriptions').select('storage_blocks').maybeSingle();
      const current = Number(data?.storage_blocks ?? 0);
      let answer = await previewStorageAddon(removing ? current - 1 : current + 1);
      // The mirror can trail Stripe by a webhook. If the asked-for total is
      // already the live one, ask again from Stripe's own count, so the sheet
      // never offers a change that would change nothing.
      if (answer?.ok && answer.unchanged && Number.isInteger(answer.current_blocks)) {
        answer = await previewStorageAddon(removing ? answer.current_blocks - 1 : answer.current_blocks + 1);
      }
      if (cancelled) return;
      if (!answer?.ok || answer.unchanged) {
        logEvent(EV.STORAGE_ADDON_FAIL, { surface, mode, stage: 'preview', code: answer?.error ?? (answer?.unchanged ? 'unchanged' : null) });
        setMessage(storageAddonErrorMessage(answer));
        setFailedAt('preview');
        setPhase('error');
        return;
      }
      setPreview(answer);
      setPhase('ready');
    })();
    return () => { cancelled = true; };
  }, [open, mode, surface, removing, attempt]);

  if (!open) return null;

  const copy = preview
    ? storageAddonCopy({
        interval: preview.interval,
        amountToday: preview.amount_today,
        creditNext: preview.credit_next,
        removing,
      })
    : null;
  const confirm = async () => {
    if (!preview || phase === 'working') return;
    setPhase('working');
    const answer = await applyStorageAddon({
      blocks: preview.target_blocks,
      prorationDate: preview.proration_date,
      requestId: requestIdRef.current,
    });
    if (answer?.status === 'requires_payment' && answer.hosted_invoice_url) {
      setPayUrl(answer.hosted_invoice_url);
      setPhase('pay');
      window.open(answer.hosted_invoice_url, '_blank', 'noopener');
      return;
    }
    if (!answer?.ok) {
      logEvent(EV.STORAGE_ADDON_FAIL, { surface, mode, stage: 'apply', code: answer?.error ?? null });
      setMessage(storageAddonErrorMessage(answer));
      // A stale price was never charged: Try again fetches a fresh one. Any
      // other apply failure is repeated exactly, under the same request id.
      setFailedAt(answer?.error === 'stale_preview' ? 'preview' : 'apply');
      setPhase('error');
      return;
    }
    if (removing) logEvent(EV.STORAGE_ADDON_REMOVE, { surface, blocks: answer.blocks ?? preview.target_blocks });
    onDone?.({ blocks: answer.blocks ?? preview.target_blocks, quotaBytes: answer.quota_bytes ?? null });
    onClose?.();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      className="impcap"
      backdropClassName="impcap-back"
      labelledBy="addon-title"
      initialFocusRef={primaryRef}
    >
      <div className="impcap-head">
        <div className="impcap-kicker">Extra storage</div>
        <div className="impcap-title" id="addon-title">
          {copy ? copy.title : (removing ? 'Remove extra storage' : 'Add more storage')}
        </div>
      </div>

      <div className="impcap-body">
        {phase === 'loading' && <p className="impcap-lede">Checking the price…</p>}
        {(phase === 'ready' || phase === 'working') && copy && <p className="impcap-lede">{copy.body}</p>}
        {phase === 'pay' && (
          <p className="impcap-lede">
            Your bank wants to confirm this payment. Finish it on the Stripe page that just opened
            {payUrl ? <> (or <a href={payUrl} target="_blank" rel="noopener noreferrer">open it again</a>)</> : null}
            {' '}— the storage is added the moment it’s paid. Nothing changes until then.
          </p>
        )}
        {phase === 'error' && <p className="impcap-lede" role="alert">{message}</p>}
      </div>

      <div className="impcap-actions">
        <button type="button" className="impcap-btn" onClick={onClose}>
          {phase === 'pay' ? 'Done' : (removing ? 'Keep it' : 'Not now')}
        </button>
        {(phase === 'ready' || phase === 'working') && copy && (
          <button
            type="button"
            ref={primaryRef}
            className="impcap-btn impcap-btn-primary"
            disabled={phase === 'working'}
            onClick={confirm}
          >
            {phase === 'working' ? 'Working…' : copy.cta}
          </button>
        )}
        {phase === 'error' && failedAt && (
          <button
            type="button"
            className="impcap-btn impcap-btn-primary"
            // An apply is repeated as it was — same total, same request id —
            // so Stripe replays a change that already went through rather than
            // charging for it again. A failed preview simply asks again.
            onClick={() => (failedAt === 'apply' ? confirm() : setAttempt((n) => n + 1))}
          >
            Try again
          </button>
        )}
      </div>
    </Modal>
  );
}
