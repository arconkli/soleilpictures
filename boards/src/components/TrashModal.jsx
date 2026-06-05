// TrashModal — recover (or permanently remove) soft-deleted boards.
//
// Workspace-wide list of boards waiting out the 30-day purge window. Each
// row has Restore + Delete-now. Extracted from the old TimeTravelModal when
// the History tool (time-travel + comments tabs) was removed — undo is now
// the in-session Yjs UndoManager, so the snapshot-history UI is gone, but
// deleted-board recovery is genuinely useful and lives on here. Catastrophic
// workspace-wide rewind still lives in Settings (WorkspaceRecoveryModal).

import { useEffect, useState } from 'react';
import { Modal } from './Modal.jsx';
import { listDeletedBoards, restoreBoard, hardDeleteBoard } from '../lib/boardsApi.js';
import { useFeedback } from './AppFeedback.jsx';

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function relTime(iso) {
  if (!iso) return '';
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
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
}

export function TrashModal({ open, workspaceId = null, onClose, onBoardRestored = null }) {
  const [trash, setTrash] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const feedback = useFeedback();

  useEffect(() => {
    if (!open || !workspaceId) return;
    let cancelled = false;
    setLoading(true);
    listDeletedBoards(workspaceId)
      .then((rows) => { if (!cancelled) setTrash(rows); })
      .catch((e) => console.warn('trash fetch failed', e))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, workspaceId]);

  const refreshTrash = async () => {
    try { setTrash(await listDeletedBoards(workspaceId)); }
    catch (e) { console.warn(e); }
  };

  const onRestoreTrashBoard = async (b) => {
    setBusyId(b.id);
    try {
      await restoreBoard(b.id);
      refreshTrash();
      onBoardRestored?.();
      feedback.toast({ type: 'success', message: `Restored "${b.name || 'Untitled board'}"` });
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Restore failed: ' + (e?.message || e) });
    } finally {
      setBusyId(null);
    }
  };

  const onHardDeleteBoard = async (b) => {
    const ok = await feedback.confirm({
      title: 'Permanently delete board?', confirmLabel: 'Delete forever', danger: true,
      message: `"${b.name || 'Untitled board'}" and ALL its content will be permanently removed. This cannot be undone.`,
    });
    if (!ok) return;
    setBusyId(b.id);
    try {
      await hardDeleteBoard(b.id);
      refreshTrash();
      feedback.toast({ type: 'success', message: 'Permanently deleted.' });
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Delete failed: ' + (e?.message || e) });
    } finally {
      setBusyId(null);
    }
  };

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} className="modal" labelledBy="trash-title">
      <div className="modal-hd">
        <div className="modal-title" id="trash-title">Deleted boards</div>
        <button className="modal-x" onClick={onClose} aria-label="Close">✕</button>
      </div>

      <div className="modal-actions">
        <span className="modal-hint">Deleted boards stay here for 30 days before being permanently removed.</span>
      </div>
      <div className="modal-body">
        {loading && <div className="modal-empty">Loading…</div>}
        {!loading && trash.length === 0 && (
          <div className="modal-empty">
            Nothing in the trash. Deleted boards land here automatically.
          </div>
        )}
        {!loading && trash.length > 0 && (
          <div className="hist-list">
            {trash.map((b) => (
              <div key={b.id} className="hist-row">
                <div className="hist-meta">
                  <div className="hist-when" title={fmtDate(b.deleted_at)}>
                    {b.name || 'Untitled board'}
                  </div>
                  <div className="hist-sub">
                    <span>deleted {relTime(b.deleted_at)}</span>
                    <span className="hist-label">{b.view || 'canvas'}</span>
                  </div>
                </div>
                <button className="tb-btn" disabled={busyId === b.id} onClick={() => onRestoreTrashBoard(b)}>
                  {busyId === b.id ? 'Restoring…' : 'Restore'}
                </button>
                <button className="tb-btn tb-btn-sm tb-btn-danger"
                        disabled={busyId === b.id}
                        onClick={() => onHardDeleteBoard(b)}>Delete now</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
