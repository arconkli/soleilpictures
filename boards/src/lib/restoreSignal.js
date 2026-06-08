// restoreSignal.js
//
// Reliable cross-client signal for "this board has been restored, clients must
// tear down + reload their Y.Doc." Replaces the legacy fire-and-forget
// `window.__soleilEmitBoardReset` event + PartyKit broadcast, which both have
// gaps (offline clients, dropped WS frames, missing window callback).
//
// Mechanism:
//  • Primary: Supabase Realtime subscription on INSERTs into
//    `board_restore_events`. A row is appended there ONLY when a board is
//    actually restored (an AFTER-UPDATE trigger on board_state_version fires
//    only when `version` advances — migration 0097). This is the low-churn
//    replacement for subscribing to board_state_version UPDATEs directly,
//    which fanned out a message on every op (latest_seq bumps) even though we
//    only care about restores. board_state_version was removed from the
//    realtime publication in the same migration.
//  • Fallback: 10-second polling of `board_state_version.version` (a plain
//    REST read, unaffected by the publication change). Catches the case where
//    Realtime is degraded, the tab was throttled, or the browser was offline
//    longer than Realtime's window. This is the durability backstop.
//
// Until migration 0060 is applied, the `board_state_version` table doesn't
// exist. In that case the channel quietly emits errors and the polling 404s.
// The module catches both, logs once, and returns a no-op subscriber.
// Restore reliability falls back to the existing event-based path. Once 0060
// is live, this module activates without code changes.

import { supabase } from './supabase.js';

// The Realtime INSERT subscription is the primary, instant signal; polling is
// only a durability backstop. So poll slowly (60s) while Realtime is healthy
// and fast (10s) only when it's degraded — cutting steady-state poll volume 6x
// per open board.
const POLL_DEGRADED_MS = 10_000;
const POLL_HEALTHY_MS = 60_000;
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
  let realtimeHealthy = false; // SUBSCRIBED → poll slowly; errors → poll fast
  const nextPollDelay = () => (realtimeHealthy ? POLL_HEALTHY_MS : POLL_DEGRADED_MS);

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
      if (!cancelled && !tableMissing) pollTimer = setTimeout(tick, nextPollDelay());
    };
    pollTimer = setTimeout(tick, nextPollDelay());
  };

  // Realtime subscription. Skipped if the version table is known to be missing.
  // Listens for INSERTs into board_restore_events (one row per real restore),
  // NOT board_state_version UPDATEs — the latter fired on every op. handleRow
  // dedupes against the polled baseline via lastVersion, so the two paths
  // can't double-fire. The event row carries `version`; latest_seq /
  // latest_snapshot_id are absent (the only consumer, useYBoard, reads only
  // `version`), so handleRow's `?? 0 / ?? null` defaults apply.
  let channel = null;
  const startRealtime = () => {
    if (tableMissing) return;
    try {
      channel = supabase
        .channel(`board-restore:${boardId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'board_restore_events',
            filter: `board_id=eq.${boardId}`,
          },
          (payload) => handleRow(payload?.new)
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            realtimeHealthy = true;   // primary signal is live → poll can slow down
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            realtimeHealthy = false;  // degraded → next poll reschedules at the fast rate
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
