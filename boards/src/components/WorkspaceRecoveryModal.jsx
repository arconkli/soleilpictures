// WorkspaceRecoveryModal — Section 6 of the backups rework.
//
// Catastrophic-recovery UI: scoped to a workspace, not a single board.
// User picks a target timestamp, sees an impact preview (every board
// in the workspace, with current vs target byte length), can deselect
// individual boards if needed, then clicks one button to rewind the
// whole selection atomically.
//
// Open alerts (mass-delete detection from the DO + cron) appear at the
// top so the user can either acknowledge them or use them as a target
// timestamp for the rewind.

import { useEffect, useMemo, useState } from 'react';
import {
  previewWorkspaceRewind,
  performWorkspaceRewind,
  listWorkspaceAlerts,
  acknowledgeAlert,
} from '../lib/boardsApi.js';
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
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function ymdhmLocal(date) {
  // Build "YYYY-MM-DDTHH:mm" suitable for <input type="datetime-local">
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function localToIso(local) {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function deltaBadge(currentLen, targetLen) {
  if (targetLen == null || currentLen == null) return null;
  const delta = targetLen - currentLen;
  const pct = currentLen > 0 ? Math.round((delta / currentLen) * 100) : null;
  if (delta === 0) return <span className="wsr-delta wsr-delta-same">no change</span>;
  if (delta > 0) return <span className="wsr-delta wsr-delta-add">+{(delta / 1024).toFixed(1)}KB{pct ? ` (+${pct}%)` : ''}</span>;
  return <span className="wsr-delta wsr-delta-sub">{(delta / 1024).toFixed(1)}KB{pct ? ` (${pct}%)` : ''}</span>;
}

export function WorkspaceRecoveryModal({ open, workspaceId, onClose, onRewindComplete = null }) {
  // Default target: 15 minutes ago. Catastrophic deletes typically happen
  // within a recent window, and "15 min back" is a sensible starting point.
  const defaultTarget = useMemo(() => ymdhmLocal(new Date(Date.now() - 15 * 60 * 1000)), []);
  const [targetLocal, setTargetLocal] = useState(defaultTarget);

  const [alerts, setAlerts] = useState([]);
  const [previewRows, setPreviewRows] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [busy, setBusy] = useState(false);
  const feedback = useFeedback();

  // Load alerts when modal opens.
  useEffect(() => {
    if (!open || !workspaceId) return;
    listWorkspaceAlerts(workspaceId, { limit: 20 })
      .then(setAlerts)
      .catch((e) => console.warn('alerts fetch failed', e));
  }, [open, workspaceId]);

  const runPreview = async () => {
    if (!workspaceId) return;
    const iso = localToIso(targetLocal);
    if (!iso) {
      feedback.toast({ type: 'error', message: 'Invalid timestamp' });
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const rows = await previewWorkspaceRewind(workspaceId, iso);
      setPreviewRows(rows);
      // Default-select boards that have a target snapshot AND meaningful delta.
      const auto = new Set(
        rows.filter((r) => r.target_snapshot_id != null).map((r) => r.board_id),
      );
      setSelectedIds(auto);
    } catch (e) {
      setPreviewError(e?.message || String(e));
    } finally {
      setPreviewLoading(false);
    }
  };

  const runRewind = async () => {
    if (!previewRows.length) return;
    const targets = previewRows
      .filter((r) => selectedIds.has(r.board_id) && r.target_snapshot_id != null)
      .map((r) => ({ board_id: r.board_id, snapshot_id: r.target_snapshot_id }));
    if (targets.length === 0) {
      feedback.toast({ type: 'error', message: 'No boards selected for rewind' });
      return;
    }
    const ok = await feedback.confirm({
      title: 'Rewind workspace',
      message: `Atomically rewind ${targets.length} board${targets.length === 1 ? '' : 's'} to the state at ${fmtDate(localToIso(targetLocal))}? This is undoable per board (each gets a pre-restore snapshot), but it's a workspace-scale change.`,
      confirmLabel: `Rewind ${targets.length} board${targets.length === 1 ? '' : 's'}`,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await performWorkspaceRewind(workspaceId, targets, {
        reason: `recovery modal rewind to ${fmtDate(localToIso(targetLocal))}`,
      });
      feedback.toast({
        type: 'success',
        message: `Rewound ${result.targets_count} board${result.targets_count === 1 ? '' : 's'} to ${fmtDate(localToIso(targetLocal))}`,
      });
      if (onRewindComplete) onRewindComplete();
      // Refresh alerts (the rewind itself logged one).
      const fresh = await listWorkspaceAlerts(workspaceId, { limit: 20 });
      setAlerts(fresh);
    } catch (e) {
      console.error(e);
      feedback.toast({ type: 'error', message: 'Rewind failed: ' + (e?.message || e) });
    } finally {
      setBusy(false);
    }
  };

  const onAlertAcknowledge = async (alertId) => {
    try {
      await acknowledgeAlert(alertId);
      setAlerts((prev) => prev.map((a) => a.id === alertId ? { ...a, acknowledged_at: new Date().toISOString() } : a));
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Could not acknowledge: ' + (e?.message || e) });
    }
  };

  const onAlertRewindTo = (alert) => {
    // Use the alert's detection time minus 1 minute as the rewind target —
    // i.e. just before the mass-delete fired.
    const t = new Date(alert.detected_at);
    t.setSeconds(t.getSeconds() - 60);
    setTargetLocal(ymdhmLocal(t));
    // Auto-kick the preview so the user sees the impact right away.
    setTimeout(runPreview, 50);
  };

  if (!open) return null;

  const openCriticals = alerts.filter((a) => !a.acknowledged_at && a.severity === 'critical');
  const recentRecovery = alerts.filter((a) => a.kind === 'workspace.rewind').slice(0, 3);

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal modal-workspace-recovery" onClick={(e) => e.stopPropagation()}>
        <div className="modal-hd">
          <div className="modal-title">Workspace recovery</div>
          <button className="modal-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="wsr-body">
          {/* Open critical alerts banner */}
          {openCriticals.length > 0 && (
            <div className="wsr-alerts">
              {openCriticals.map((a) => (
                <div key={a.id} className="wsr-alert wsr-alert-critical">
                  <div className="wsr-alert-icon">⚠</div>
                  <div className="wsr-alert-body">
                    <div className="wsr-alert-title">{a.kind === 'mass_delete' ? 'Unusual deletion activity' : a.kind}</div>
                    <div className="wsr-alert-meta">
                      {fmtDate(a.detected_at)} ({relTime(a.detected_at)}) ·
                      {a.payload?.delete_count != null ? ` ${a.payload.delete_count} deletes` : ''}
                      {a.payload?.window_seconds != null ? ` in ${a.payload.window_seconds}s` : ''}
                      {a.board_ids?.length ? ` · ${a.board_ids.length} board${a.board_ids.length === 1 ? '' : 's'}` : ''}
                    </div>
                  </div>
                  <div className="wsr-alert-actions">
                    <button type="button" className="tb-btn" onClick={() => onAlertRewindTo(a)}>
                      One-click rewind
                    </button>
                    <button type="button" className="tb-btn" onClick={() => onAlertAcknowledge(a.id)}>
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Time picker + preview button */}
          <div className="wsr-picker">
            <label className="wsr-picker-label">Rewind to:</label>
            <input
              type="datetime-local"
              className="wsr-picker-input"
              value={targetLocal}
              onChange={(e) => setTargetLocal(e.target.value)}
            />
            <button
              type="button"
              className="tb-btn"
              onClick={runPreview}
              disabled={previewLoading}
            >
              {previewLoading ? 'Computing…' : 'Preview impact'}
            </button>
          </div>

          {/* Preview table */}
          {previewError && <div className="modal-empty">Preview failed: {previewError}</div>}
          {previewRows.length > 0 && (
            <div className="wsr-table-wrap">
              <table className="wsr-table">
                <thead>
                  <tr>
                    <th style={{ width: 32 }}>
                      <input
                        type="checkbox"
                        checked={previewRows.every((r) => r.target_snapshot_id == null || selectedIds.has(r.board_id))}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedIds(new Set(previewRows.filter((r) => r.target_snapshot_id != null).map((r) => r.board_id)));
                          } else {
                            setSelectedIds(new Set());
                          }
                        }}
                      />
                    </th>
                    <th>Board</th>
                    <th>Target snapshot</th>
                    <th>Now</th>
                    <th>Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((r) => {
                    const hasTarget = r.target_snapshot_id != null;
                    return (
                      <tr key={r.board_id} className={hasTarget ? '' : 'wsr-row-disabled'}>
                        <td>
                          <input
                            type="checkbox"
                            disabled={!hasTarget}
                            checked={selectedIds.has(r.board_id)}
                            onChange={(e) => {
                              setSelectedIds((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(r.board_id);
                                else next.delete(r.board_id);
                                return next;
                              });
                            }}
                          />
                        </td>
                        <td className="wsr-cell-name">{r.board_name}</td>
                        <td className="wsr-cell-target">
                          {hasTarget ? (
                            <>
                              <div>{fmtDate(r.target_at_ts)}</div>
                              <div className="wsr-cell-sub">{r.target_kind}{r.target_label ? ` · ${r.target_label}` : ''}</div>
                            </>
                          ) : (
                            <span className="wsr-cell-sub">No snapshot ≤ target time</span>
                          )}
                        </td>
                        <td className="wsr-cell-now">
                          v{r.current_version}
                          <div className="wsr-cell-sub">{(r.current_doc_len / 1024).toFixed(1)}KB</div>
                        </td>
                        <td>{hasTarget ? deltaBadge(r.current_doc_len, r.target_doc_len) : null}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Recent workspace rewinds for context */}
          {recentRecovery.length > 0 && (
            <div className="wsr-recent">
              <div className="wsr-recent-hd">Recent workspace rewinds</div>
              {recentRecovery.map((a) => (
                <div key={a.id} className="wsr-recent-row">
                  <span>{fmtDate(a.detected_at)}</span>
                  <span className="wsr-cell-sub">
                    {a.payload?.targets_count || 0} boards · {a.payload?.reason || ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-actions wsr-footer">
          <button type="button" className="tb-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            type="button"
            className="tb-btn tb-btn-primary"
            onClick={runRewind}
            disabled={busy || !previewRows.length || selectedIds.size === 0}
          >
            {busy
              ? 'Rewinding…'
              : `Rewind ${selectedIds.size} selected board${selectedIds.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
