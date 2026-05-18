// restoreSignal.js
//
// Reliable cross-client signal for "this board has been restored, clients must
// tear down + reload their Y.Doc." Replaces the legacy fire-and-forget
// `window.__soleilEmitBoardReset` event + PartyKit broadcast, which both have
// gaps (offline clients, dropped WS frames, missing window callback).
//
// Mechanism:
//  • Primary: Supabase Realtime subscription on `board_state_version` row.
//    The row's `version` int is bumped on every restore, atomically with the
//    snapshot insert in the same Postgres transaction (see Section 3 of spec).
//    Realtime delivers the update durably; even an offline tab gets it on
//    reconnect via the initial-state replay.
//  • Fallback: 10-second polling of the same row. Catches the case where
//    Realtime is degraded, the tab was throttled, or the browser was offline
//    longer than Realtime's replay window.
//
// Until migration 0060 is applied, the `board_state_version` table doesn't
// exist. In that case the channel quietly emits errors and the polling 404s.
// The module catches both, logs once, and returns a no-op subscriber.
// Restore reliability falls back to the existing event-based path. Once 0060
// is live, this module activates without code changes.

import { supabase } from './supabase.js';

const POLL_INTERVAL_MS = 10_000;
const SOFT_FAILURE_LOGGED = new Set();

function softLog(boardId, message, err) {
  if (SOFT_FAILURE_LOGGED.has(boardId)) return;
  SOFT_FAILURE_LOGGED.add(boardId);
  console.warn(`[restoreSignal] ${message}`, err || '');
}

/**
 * Watch a board for restore events.
 *
 * @param {string} boardId
 * @param {(payload: { version: number, latest_seq: number, latest_snapshot_id: number | null }) => void} onRestore
 *   Fires when `version` increases. Receives the new row state.
 * @returns {() => void} unsubscribe
 */
export function watchBoardRestores(boardId, onRestore) {
  if (!supabase || !boardId || typeof onRestore !== 'function') {
    return () => {};
  }

  let lastVersion = null;
  let cancelled = false;
  let tableMissing = false; // sticky: once we see 42P01, stop polling

  // Fetch initial state. Establishes the baseline `version`. If the table is
  // missing (pre-Phase-1 migration), this 404s — we set `tableMissing` and
  // skip Realtime + polling. The legacy event path keeps working.
  const fetchOnce = async () => {
    try {
      const { data, error } = await supabase
        .from('board_state_version')
        .select('version, latest_seq, latest_snapshot_id')
        .eq('board_id', boardId)
        .maybeSingle();
      if (cancelled) return null;
      if (error) {
        const msg = String(error.message || '');
        if (msg.includes('does not exist') || msg.includes('Not Acceptable') || error.code === '42P01' || error.code === 'PGRST205') {
          tableMissing = true;
          softLog(boardId, 'board_state_version table not present yet; relying on legacy reset event');
          return null;
        }
        softLog(boardId, 'initial fetch failed; will keep polling', error);
        return null;
      }
      return data || null;
    } catch (e) {
      if (cancelled) return null;
      softLog(boardId, 'initial fetch threw; will keep polling', e);
      return null;
    }
  };

  const handleRow = (row) => {
    if (cancelled || !row || typeof row.version !== 'number') return;
    if (lastVersion == null) {
      lastVersion = row.version;
      return;
    }
    if (row.version > lastVersion) {
      lastVersion = row.version;
      try {
        onRestore({
          version: row.version,
          latest_seq: row.latest_seq ?? 0,
          latest_snapshot_id: row.latest_snapshot_id ?? null,
        });
      } catch (e) {
        console.error('[restoreSignal] onRestore handler threw', e);
      }
    }
  };

  // Polling loop. Skipped entirely if the table is missing (pre-migration).
  let pollTimer = null;
  const startPolling = () => {
    if (tableMissing) return;
    const tick = async () => {
      if (cancelled || tableMissing) return;
      try {
        const { data, error } = await supabase
          .from('board_state_version')
          .select('version, latest_seq, latest_snapshot_id')
          .eq('board_id', boardId)
          .maybeSingle();
        if (error) {
          const msg = String(error.message || '');
          if (msg.includes('does not exist') || error.code === '42P01' || error.code === 'PGRST205') {
            tableMissing = true;
            return;
          }
        } else if (data) {
          handleRow(data);
        }
      } catch (_) {
        // ignore
      }
      if (!cancelled && !tableMissing) pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
    };
    pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
  };

  // Realtime subscription. Skipped if table is known to be missing.
  let channel = null;
  const startRealtime = () => {
    if (tableMissing) return;
    try {
      channel = supabase
        .channel(`board-state-version:${boardId}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'board_state_version',
            filter: `board_id=eq.${boardId}`,
          },
          (payload) => handleRow(payload?.new)
        )
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            softLog(boardId, `realtime status=${status}; polling fallback continues`);
          }
        });
    } catch (e) {
      softLog(boardId, 'realtime subscribe threw; polling fallback continues', e);
    }
  };

  // Kick off
  fetchOnce().then((row) => {
    if (cancelled) return;
    if (row) {
      lastVersion = row.version;
    }
    startRealtime();
    startPolling();
  });

  return () => {
    cancelled = true;
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    if (channel) {
      try { supabase.removeChannel(channel); } catch (_) {}
      channel = null;
    }
  };
}

/**
 * Manually emit a restore signal locally (legacy bridge).
 * Useful during the migration window: when the new restore endpoint isn't
 * yet wired up but a client knows a restore just happened, it can call this
 * to nudge the local useYBoard remount without waiting for the network signal.
 * After Phase 5 cutover, this can be removed.
 */
export function emitLocalRestoreSignal(boardId) {
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('soleil-board-reset', { detail: { boardId } }));
    }
  } catch (_) {}
}
