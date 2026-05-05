// Floating modal listing snapshot versions for the current board, with a
// Restore button per row. Restoring replaces the live Y.Doc state with the
// version's saved bytes (the change becomes a normal local edit, so it's
// undoable in turn).

import { useEffect, useState } from 'react';
import { listBoardVersions, loadBoardVersionDoc, saveBoardVersion } from '../lib/boardsApi.js';
import { restoreVersionInto } from '../lib/yboard.js';
import { useFeedback } from './AppFeedback.jsx';

function relTime(iso) {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  return `${d}d ago`;
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

export function HistoryModal({ open, boardId, ydoc, userId, onClose }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const feedback = useFeedback();

  useEffect(() => {
    if (!open || !boardId) return;
    let cancelled = false;
    setLoading(true);
    listBoardVersions(boardId, 100).then(rows => {
      if (cancelled) return;
      setVersions(rows);
      setLoading(false);
    }).catch(e => { console.error(e); setLoading(false); });
    return () => { cancelled = true; };
  }, [open, boardId]);

  const onRestore = async (v) => {
    if (!ydoc) return;
    const ok = await feedback.confirm({
      title: 'Restore version',
      message: `Restore the version from ${fmtDate(v.snapshot_at)}? Your current state will be saved as a new version first.`,
      confirmLabel: 'Restore',
    });
    if (!ok) return;
    setBusyId(v.id);
    try {
      // Snapshot the CURRENT state first as a "before-restore" version.
      try { await saveBoardVersion(boardId, ydoc, { label: 'before-restore', userId }); }
      catch (e) { console.warn('pre-restore version save failed', e); }
      const b64 = await loadBoardVersionDoc(v.id);
      restoreVersionInto(ydoc, b64);
      // Refresh the list — the pre-restore save just added one.
      const rows = await listBoardVersions(boardId, 100);
      setVersions(rows);
    } catch (e) {
      console.error(e);
      feedback.toast({ type: 'error', message: 'Restore failed: ' + (e.message || e) });
    } finally {
      setBusyId(null);
    }
  };

  const onSaveCurrent = async () => {
    if (!ydoc) return;
    const label = await feedback.prompt({
      title: 'Save version',
      label: 'Label',
      placeholder: 'manual',
      defaultValue: 'manual',
      confirmLabel: 'Save snapshot',
    });
    if (label == null) return;
    try {
      await saveBoardVersion(boardId, ydoc, { label: label || 'manual', userId });
      const rows = await listBoardVersions(boardId, 100);
      setVersions(rows);
      feedback.toast({ type: 'success', message: 'Snapshot saved.' });
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Save failed: ' + (e.message || e) });
    }
  };

  if (!open) return null;

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal modal-history" onClick={(e) => e.stopPropagation()}>
        <div className="modal-hd">
          <div className="modal-title">Version history</div>
          <button className="modal-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-actions">
          <button className="tb-btn" onClick={onSaveCurrent}>Save snapshot now</button>
          <span className="modal-hint">Auto-snapshots every minute of editing</span>
        </div>
        <div className="modal-body">
          {loading && <div className="modal-empty">Loading…</div>}
          {!loading && versions.length === 0 && <div className="modal-empty">No versions yet — keep editing and they'll start appearing here.</div>}
          {!loading && versions.length > 0 && (
            <div className="hist-list">
              {versions.map(v => (
                <div key={v.id} className="hist-row">
                  <div className="hist-meta">
                    <div className="hist-when" title={fmtDate(v.snapshot_at)}>{relTime(v.snapshot_at)}</div>
                    <div className="hist-sub">
                      <span>{fmtDate(v.snapshot_at)}</span>
                      {v.label && <span className="hist-label">{v.label}</span>}
                      <span>{v.card_count ?? '?'} cards</span>
                    </div>
                  </div>
                  <button className="tb-btn" disabled={busyId === v.id} onClick={() => onRestore(v)}>
                    {busyId === v.id ? 'Restoring…' : 'Restore'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
