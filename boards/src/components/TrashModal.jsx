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
import { groupTrashBatches } from '../lib/trashBatches.js';
import { useFeedback } from './AppFeedback.jsx';

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function insideLabel(n) {
  return n === 1 ? '1 cluster inside' : `${n} clusters inside`;
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

// canPurge: the viewer is the workspace's owner or a co-owner, the only people
// who may remove a cluster for good (0608). Everyone else can restore.
export function TrashModal({ open, workspaceId = null, canPurge = false, onClose, onBoardRestored = null }) {
  const [trash, setTrash] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const feedback = useFeedback();

  useEffect(() => {
    if (!open || !workspaceId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    listDeletedBoards(workspaceId)
      .then((rows) => { if (!cancelled) setTrash(rows); })
      .catch((e) => {
        // A failed load is not an empty trash: saying "Nothing in the trash"
        // here would tell someone their deleted cluster is gone for good.
        console.warn('trash fetch failed', e);
        if (!cancelled) setLoadError(true);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, workspaceId]);

  const refreshTrash = async () => {
    try { setTrash(await listDeletedBoards(workspaceId)); setLoadError(false); }
    catch (e) { console.warn(e); setLoadError(true); }
  };

  const retryLoad = async () => {
    setLoading(true);
    await refreshTrash();
    setLoading(false);
  };

  // One row per deletion: a cluster deleted with others inside it brings them
  // back with it (0396), so those are counted on its row, not listed again.
  const batches = groupTrashBatches(trash);

  const onRestoreTrashBoard = async (b, inside = 0) => {
    setBusyId(b.id);
    try {
      await restoreBoard(b.id);
      refreshTrash();
      onBoardRestored?.();
      const name = `"${b.name || 'Untitled cluster'}"`;
      feedback.toast({
        type: 'success',
        message: inside > 0 ? `Restored ${name} and the ${insideLabel(inside)}` : `Restored ${name}`,
      });
    } catch (e) {
      // A cap refusal (0333: restoring would carry the account past its
      // ceiling) already arrives as a full sentence naming the numbers and the
      // way out, so it is shown verbatim rather than prefixed with a second
      // explanation. It is a warning, not an error — nothing went wrong.
      const capHit = /past your limit/i.test(e?.message || '');
      feedback.toast(capHit
        ? { type: 'warning', message: e.message }
        : { type: 'error', code: 'cluster_restore_failed', message: 'Restore failed: ' + (e?.message || e) });
    } finally {
      setBusyId(null);
    }
  };

  const onHardDeleteBoard = async (b, inside = 0) => {
    const ok = await feedback.confirm({
      title: 'Permanently delete cluster?', confirmLabel: 'Delete forever', danger: true,
      message: inside > 0
        ? `"${b.name || 'Untitled cluster'}", the ${insideLabel(inside)} and ALL their content will be permanently removed. This cannot be undone.`
        : `"${b.name || 'Untitled cluster'}" and ALL its content will be permanently removed. This cannot be undone.`,
    });
    if (!ok) return;
    setBusyId(b.id);
    try {
      await hardDeleteBoard(b.id);
      refreshTrash();
      feedback.toast({ type: 'success', message: 'Permanently deleted.' });
    } catch (e) {
      feedback.toast({ type: 'error', code: 'cluster_purge_failed', message: 'Delete failed: ' + (e?.message || e) });
    } finally {
      setBusyId(null);
    }
  };

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} className="modal" labelledBy="trash-title">
      <div className="modal-hd">
        <div className="modal-title" id="trash-title">Deleted clusters</div>
        <button className="modal-x" onClick={onClose} aria-label="Close">✕</button>
      </div>

      <div className="modal-actions">
        <span className="modal-hint">
          Deleted clusters stay here for 30 days before being permanently removed.
          {!canPurge && ' Only the owner and co-owners can remove one sooner.'}
        </span>
      </div>
      <div className="modal-body">
        {loading && <div className="modal-empty">Loading…</div>}
        {!loading && loadError && (
          <div className="modal-empty">
            Couldn’t load the trash.{' '}
            <button type="button" className="tb-btn tb-btn-sm" onClick={retryLoad}>Retry</button>
          </div>
        )}
        {!loading && !loadError && batches.length === 0 && (
          <div className="modal-empty">
            Nothing in the trash. Deleted clusters land here automatically.
          </div>
        )}
        {!loading && !loadError && batches.length > 0 && (
          <div className="hist-list">
            {batches.map(({ board: b, inside }) => (
              <div key={b.id} className="hist-row">
                <div className="hist-meta">
                  <div className="hist-when" title={fmtDate(b.deleted_at)}>
                    {b.name || 'Untitled cluster'}
                  </div>
                  <div className="hist-sub">
                    <span>deleted {relTime(b.deleted_at)}</span>
                    {inside > 0 && <span>{insideLabel(inside)}</span>}
                    <span className="hist-label">{b.view || 'canvas'}</span>
                  </div>
                </div>
                <button className="tb-btn" disabled={busyId === b.id} onClick={() => onRestoreTrashBoard(b, inside)}>
                  {busyId === b.id ? 'Restoring…' : 'Restore'}
                </button>
                {canPurge && (
                  <button className="tb-btn tb-btn-sm tb-btn-danger"
                          disabled={busyId === b.id}
                          onClick={() => onHardDeleteBoard(b, inside)}>Delete now</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
