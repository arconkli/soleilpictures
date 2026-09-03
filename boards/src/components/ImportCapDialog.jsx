import { useRef } from 'react';
import { Modal } from './Modal.jsx';
import { rejectedNoun } from '../lib/demoCardCap.js';
import './importCapDialog.css';

// The over-cap folder drop, asked BEFORE anything uploads.
//
// This dialog exists because of a measured trace: someone signs up, drops a
// folder of a hundred-odd photographs minutes later, and ends up holding a
// fraction of it. The canvas drop path had no cap check at all, so the whole
// folder rendered and uploaded and was then withdrawn by the server trigger.
// The upgrade ask arrived attached to a data-loss event, which is the worst
// possible moment to make it — the pricing modal was seen once, at the wall,
// and never looked at again.
//
// So: no card is created, no byte is uploaded, and nothing is destroyed until
// this is answered. The stake named on screen is the user's OWN folder, which
// is the most concrete thing this product will ever have to sell against.
//
// Both actions are real and both are safe. "Add the first N" is not a
// consolation prize — it is the cards they are entitled to, which is precisely
// what the old path threw away along with the overflow. Cancelling keeps the
// folder on their disk and the cluster as it was.
//
// The count is stated, never estimated: `take` and `over` come from
// planImport() (importPreflight.js), which is the same evaluateDemoCap
// arithmetic the server trigger enforces.

export function ImportCapDialog({ open, n, take, over, count, limit, kinds, onTakePartial, onUpgrade, onCancel }) {
  const primaryRef = useRef(null);
  if (!open) return null;

  // Name the actual thing. A user who just dropped a folder of photographs and
  // is told "cards" has to translate; rejectedNoun already owns this decision
  // and already falls back to the neutral noun for a mixed batch.
  const noun = rejectedNoun(kinds, n);
  const takeNoun = rejectedNoun(kinds, take);

  return (
    <Modal
      open={open}
      onClose={onCancel}
      className="impcap"
      backdropClassName="impcap-back"
      labelledBy="impcap-title"
      initialFocusRef={primaryRef}
    >
      <div className="impcap-head">
        <div className="impcap-kicker">Card limit</div>
        <div className="impcap-title" id="impcap-title">
          You dropped {n} {noun}.
        </div>
      </div>

      <div className="impcap-body">
        <p className="impcap-lede">
          This free cluster holds <strong>{take}</strong> more — you&rsquo;re at {count} of {limit} cards.
        </p>
        {/* The meter is information, not pressure: it shows what the number
            already is rather than dramatising how little is left. Hidden at
            zero, where an empty track reads as a stray divider and says
            nothing the sentence above hasn't already said. */}
        {count > 0 && (
          <div className="impcap-meter" aria-hidden="true">
            <span className="impcap-meter-fill" style={{ width: `${Math.min(100, Math.round((count / (limit || 1)) * 100))}%` }} />
          </div>
        )}
        <p className="impcap-note">
          Nothing has been uploaded yet. Creator removes the limit entirely.
        </p>
      </div>

      <div className="impcap-actions">
        <button type="button" className="impcap-btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="impcap-btn" onClick={onTakePartial}>
          Add the first {take} {takeNoun}
        </button>
        <button
          type="button"
          ref={primaryRef}
          className="impcap-btn impcap-btn-primary"
          onClick={onUpgrade}
        >
          Upgrade — keep all {n}
        </button>
      </div>
    </Modal>
  );
}
