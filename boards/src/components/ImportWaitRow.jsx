import { useSyncExternalStore } from 'react';
import { subscribeImportJobs, importForBoard, importKeyForBoard, importJobEntry } from '../lib/importJobs.js';
import { waitRowCopy } from '../lib/importCopy.js';
import './importTray.css';

// The top of a cluster's Files while the import that made it waits for room
// (mockup r5-Land-Wait): how many of its files are still to come, why, and the
// tray's own one step, so the two never disagree. Every word is
// importCopy.waitRowCopy's; the button calls the tray entry's act(id).
//
// Its own component so the import store's ticks re-render this, never the
// sidebar: it selects one cluster's entry and its tray key, both steady.
// name: the cluster's name now (else the last folder of the import's path).
export function ImportWaitRow({ boardId, name = null }) {
  const b = useSyncExternalStore(subscribeImportJobs, () => importForBoard(boardId), () => null);
  const key = useSyncExternalStore(subscribeImportJobs, () => importKeyForBoard(boardId), () => null);
  if (!b || b.status !== 'waiting' || !(b.waiting > 0)) return null;
  const entry = importJobEntry(key);
  const copy = waitRowCopy({
    waiting: b.waiting, name: name || String(b.path || '').split(' › ').pop(), reason: b.reason,
    offer: entry?.offer, plan: entry?.plan, own: entry?.own, ownerName: entry?.ownerName,
    trialOffer: entry?.trialOffer, addon: entry?.addon, source: entry?.source, zips: entry?.zips,
    tops: (entry?.snap?.tops || []).length,
  });
  if (!copy) return null;
  return (
    <div className="imptray-waitrow" role="status">
      <span className="imptray-waitrow-t">{copy.title}</span>
      <span className="imptray-waitrow-s">{copy.sub}</span>
      {copy.action && entry?.act && (
        <div className="imptray-row-actions">
          <button type="button" className="imptray-btn is-primary is-sm" onClick={() => entry.act(copy.action.id)}>
            {copy.action.label}
          </button>
        </div>
      )}
    </div>
  );
}
