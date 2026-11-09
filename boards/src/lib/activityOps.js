// activityOps — a download, export or copy as one row in the activity tray.
// Node-pure, like activity.js: trackOp starts a batch with one running item,
// runs the work, and says how it ended. The words are in activityWords.js, the
// tray's rules in activityTray.js.
//
//   const out = await trackOp({ kind: 'download', label: 'Halcyon.zip', total: 120, cancellable: true,
//     doneLabel: 'Downloaded Halcyon.zip', key: 'download:<cardId>' }, ({ signal, progress }) => { ...; progress({ done, total }); });
//
// `key` makes a second call while the first is still running join it: same
// promise back, no second row, `run` not called again. Without it every call
// is its own row.
//
// Callers keep their own coded error toasts: a throw removes the row and goes
// on up. With no tray mounted (a public canvas, KeepPage, signed out) trackOp
// only runs the work, and the caller keeps its old toast path (opsHaveTray).

import { startBatch, addTransfer, updateTransfer, removeTransfer, trayMounted } from './activity.js';

export const opsHaveTray = () => trayMounted();

const noop = () => {};

// Keyed runs still going, so a quick second click joins the first.
const inflight = new Map();

export function trackOp(opts, run) {
  const key = opts.key ?? null;
  if (key == null || !trayMounted()) return trackOpRun(opts, run);
  if (inflight.has(key)) return inflight.get(key);
  const p = trackOpRun(opts, run);
  inflight.set(key, p);
  // A separate chain that only frees the key; the caller keeps `p`, so the
  // rejection here is swallowed without hiding it from them.
  p.finally(() => { if (inflight.get(key) === p) inflight.delete(key); }).catch(noop);
  return p;
}

async function trackOpRun({
  kind, label, boardId = null, boardName = null, total = null, cancellable = false, open = null,
  doneLabel, showAfterMs, lingerMs,
}, run) {
  const ctl = new AbortController();
  if (!trayMounted()) return run({ signal: ctl.signal, progress: noop });

  // A copy always shows at once; anything else waits for the tray's beat.
  const batch = startBatch({
    kind, boardId, boardName, label,
    showAfterMs: showAfterMs ?? (kind === 'copy' ? 0 : null),
    lingerMs: lingerMs ?? null,
  });
  let tid = null;
  let count = total != null ? { done: 0, total } : null;
  const cancel = cancellable ? () => { ctl.abort(); if (tid) removeTransfer(tid); } : null;
  tid = addTransfer({ batch, kind, label, boardId, state: 'running', cancel, count });

  const progress = ({ done, total: t, fraction, label: text } = {}) => {
    const patch = {};
    if (done != null || t != null) {
      count = { done: done ?? count?.done ?? 0, total: t ?? count?.total ?? 0 };
      patch.count = count;
    }
    const f = fraction != null ? fraction : (done != null && count?.total > 0 ? done / count.total : null);
    if (f != null) patch.fraction = Math.min(0.99, Math.max(0, f));   // 1 would flip the item to "finishing"
    if (text != null) patch.label = text;
    if (Object.keys(patch).length) updateTransfer(tid, patch);
  };

  let result;
  try {
    result = await run({ signal: ctl.signal, progress });
  } catch (err) {
    removeTransfer(tid);
    if (ctl.signal.aborted) return undefined;   // Cancel: nothing is left, nothing to report
    throw err;
  }
  if (ctl.signal.aborted) { removeTransfer(tid); return result; }
  const words = typeof doneLabel === 'function' ? doneLabel(result) : doneLabel;
  if (words === null) removeTransfer(tid);
  else updateTransfer(tid, { state: 'done', doneLabel: words, actions: open ? { open } : null });
  return result;
}
