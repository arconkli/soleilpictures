import { useSyncExternalStore } from 'react';
import {
  discardHeld, heldEntries, heldSnapshot, markAllReady, restoreHeld, subscribeHeld,
} from '../lib/heldUploads.js';
import { storageAmountLabel } from '../lib/billingCopy.js';
import './heldUploadsBar.css';

// HeldUploadsBar — the files a drop could not place, kept in this tab until
// there is room (lib/heldUploads.js), and what they are waiting for. Mounted
// once by App while anything is held.
//
// Three states, from the store alone:
//   waiting  "3 files · 6.4GB are waiting for room": Upload now (try again —
//            the person made room by deleting, or wants to see the question
//            again) and Discard;
//   paying   a checkout or a bank's confirmation page is open for them, so
//            they will go as soon as it lands — Upload now stays, for a
//            checkout given up on;
//   ready    released, but the cluster they belong to is not open here, so
//            nothing can claim them until it is: Open names it.
//
// Discard is undoable, like every other letting-go in the app: the files are
// still on the person's disk, but they would have to find and drop them again.
// Neutral ink throughout; gold is for active, selection and focus states.
export function HeldUploadsBar({ openBoardIds = [], boardName = null, onOpenBoard = null, toast = null, raised = false, aboveNav = false }) {
  const { entries: held, awaiting } = useSyncExternalStore(subscribeHeld, heldSnapshot, heldSnapshot);
  // A bulk import's hold is the import tray's to show (lib/importStart.js):
  // it only keeps a checkout in another tab while the import waits in this one.
  const entries = held.filter((e) => e.via !== 'import');
  if (!entries.length) return null;

  const count = entries.reduce((n, e) => n + e.count, 0);
  const bytes = entries.reduce((n, e) => n + e.bytes, 0);
  const what = `${count} ${count === 1 ? 'file' : 'files'}${bytes > 0 ? ` · ${storageAmountLabel(bytes)}` : ''}`;
  const open = new Set(openBoardIds.filter(Boolean));
  const elsewhere = entries.find((e) => !open.has(e.boardId)) || null;
  const allReady = entries.every((e) => e.ready);
  const paying = !allReady && awaiting;
  const name = elsewhere ? (boardName?.(elsewhere.boardId) || 'its cluster') : null;

  let message;
  if (allReady && elsewhere) message = `${what} ready to upload to ${name}`;
  else if (paying) message = `${what} will upload as soon as your payment goes through`;
  else message = `${what} ${count === 1 ? 'is' : 'are'} waiting for room — keep this tab open`;

  const onDiscard = () => {
    const gone = heldEntries().filter((e) => e.via !== 'import');
    discardHeld(gone.map((e) => e.id));
    toast?.({
      type: 'info',
      message: `Let go of ${what}. ${count === 1 ? "It's" : "They're"} still on your computer.`,
      ttl: 8000,
      action: { label: 'Undo', onClick: () => restoreHeld(gone) },
    });
  };

  return (
    <div className={`held-uploads${raised ? ' held-uploads-raised' : ''}${aboveNav ? ' held-uploads-above-nav' : ''}`} role="status" aria-live="polite">
      <span className="held-uploads-label">{message}</span>
      {/* Even while paying: a checkout given up on without its cancel link
          must not leave the files with nothing to press. */}
      {!allReady && (
        <button type="button" className="held-uploads-btn" onClick={() => markAllReady()}>Upload now</button>
      )}
      {elsewhere && onOpenBoard && (
        <button type="button" className="held-uploads-btn" onClick={() => onOpenBoard(elsewhere.boardId)}>
          Open {name}
        </button>
      )}
      <button type="button" className="held-uploads-btn held-uploads-quiet" onClick={onDiscard}>Discard</button>
    </div>
  );
}
