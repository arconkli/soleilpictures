// WorkspaceAlertBanner — surfaces unacknowledged critical anomaly alerts.
//
// Only renders when workspace_anomaly_alerts has at least one row with
// severity='critical' AND acknowledged_at IS NULL for this workspace.
// Subscribes via Supabase Realtime so a fresh alert appears within
// seconds, no polling. Clicking "Open recovery" opens the
// WorkspaceRecoveryModal so the user can do a one-click rewind.
//
// This is the PRIMARY entry point for the workspace-rewind UX — the
// recovery modal is intentionally hidden when nothing is wrong. A
// manual "Workspace recovery" link in Settings → Defaults provides the
// secondary entry point for "I goofed but no anomaly fired" cases.

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { listWorkspaceAlerts, acknowledgeAlert } from '../lib/boardsApi.js';
import { t as tr, ph, plural } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';

function relTime(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const s = Math.floor(diff / 1000);
  if (s < 60) return tr`${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return tr`${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return tr`${h}h ago`;
  const d = Math.floor(h / 24);
  return tr`${d}d ago`;
}

export function WorkspaceAlertBanner({ workspaceId, onOpenRecovery }) {
  const [openAlerts, setOpenAlerts] = useState([]);
  const [hideUntil, setHideUntil] = useState(0); // soft-dismiss timestamp

  // Initial load + subscribe to Realtime inserts/updates on this workspace.
  useEffect(() => {
    if (!workspaceId) { setOpenAlerts([]); return; }
    let cancelled = false;
    const fetchOnce = async () => {
      try {
        const rows = await listWorkspaceAlerts(workspaceId, { limit: 10, onlyOpen: true });
        if (cancelled) return;
        setOpenAlerts(rows.filter((a) => a.severity === 'critical'));
      } catch (e) {
        console.warn('alert banner fetch failed', e);
      }
    };
    fetchOnce();

    const channel = supabase
      .channel(`ws-anomaly:${workspaceId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'workspace_anomaly_alerts', filter: `workspace_id=eq.${workspaceId}` },
        () => fetchOnce(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      try { supabase.removeChannel(channel); } catch (_) {}
    };
  }, [workspaceId]);

  // Soft-dismiss: a user-clicked "Hide for an hour" doesn't acknowledge
  // the underlying alert (operator still needs to investigate), but stops
  // the banner from looming on every page load.
  const visible = openAlerts.length > 0 && Date.now() > hideUntil;
  if (!visible) return null;

  const primary = openAlerts[0];
  const more = openAlerts.length - 1;

  const labelFor = (a) => {
    if (a.kind === 'mass_delete') return tr`Unusual deletion activity detected`;
    if (a.kind === 'velocity_spike') return tr`Unusual edit velocity detected`;
    return a.kind || tr`Anomaly detected`;
  };
  const metaFor = (a) => {
    const parts = [];
    if (a.payload?.delete_count != null) parts.push(plural(a.payload.delete_count, { one: '# deletes', other: '# deletes' }));
    if (a.payload?.window_seconds != null) parts.push(tr`in ${ph({ seconds: a.payload.window_seconds })}s`);
    if (a.board_ids?.length) parts.push(plural(a.board_ids.length, { one: '# board', other: '# boards' }));
    parts.push(relTime(a.detected_at));
    return parts.join(' · ');
  };

  const onDismiss = async (a) => {
    try {
      await acknowledgeAlert(a.id);
      setOpenAlerts((prev) => prev.filter((x) => x.id !== a.id));
    } catch (e) { console.warn(e); }
  };

  return (
    <div className="ws-alert-banner" role="alert">
      <span className="ws-alert-banner-icon" aria-hidden>⚠</span>
      <div className="ws-alert-banner-body">
        <div className="ws-alert-banner-title">
          {labelFor(primary)}
          {more > 0 && <span className="ws-alert-banner-more"><Trans>+{more} more</Trans></span>}
        </div>
        <div className="ws-alert-banner-meta">{metaFor(primary)}</div>
      </div>
      <div className="ws-alert-banner-actions">
        {onOpenRecovery ? (
          <button type="button" className="tb-btn tb-btn-primary" onClick={onOpenRecovery}>
            <Trans>Open recovery</Trans>
          </button>
        ) : (
          // Only the owner can run the rewind; offering it to anyone else
          // ends in a refusal.
          <span className="ws-alert-banner-meta"><Trans>The workspace owner can rewind this.</Trans></span>
        )}
        <button type="button" className="tb-btn" onClick={() => onDismiss(primary)}>
          <Trans>Dismiss</Trans>
        </button>
        <button type="button"
                className="tb-btn tb-btn-sm"
                title={tr`Hide the banner for 1 hour without acknowledging the alert`}
                onClick={() => setHideUntil(Date.now() + 60 * 60 * 1000)}>
          <Trans>Hide 1h</Trans>
        </button>
      </div>
    </div>
  );
}
