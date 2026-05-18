// boards/party/anomalyDetector.ts
//
// Section 6 of the backups rework: in-DO mass-delete detection.
//
// Runs alongside opLog inside the PartyKit Durable Object. Maintains a
// rolling window of recent op classifications and inserts a
// workspace_anomaly_alerts row when thresholds are crossed:
//
//   - >=100 card.delete in any 5-second window, OR
//   - >=100 absolute card.delete AND >=50% of current cards in any
//     60-second window (if board has at least 50 cards)
//
// Thresholds are intentionally high. The alert is for SUBSTANTIAL,
// catastrophe-grade deletion (select-all + delete; runaway script;
// accidental sub-board wipe), not for routine cleanup. Deleting one or
// two cards must never fire it.
//
// On detection: alerts the user via a Realtime row in
// workspace_anomaly_alerts AND pauses writes for that board for 60s by
// flipping an in-DO `paused: true` flag. y-partykit's update handler
// checks the flag and refuses new updates until either:
//   - 60s elapses, OR
//   - The user clicks "Allow — intentional" on the banner, which marks
//     the alert acknowledged AND the DO observes via a brief polling
//     loop (alternative: the Realtime subscription on the alerts row).
//
// For Phase 1 of the anomaly detector we ship DETECTION + ALERT. The
// write-pause enforcement is wired into the next-phase opLog gate, since
// pausing writes mid-CRDT-stream needs careful y-partykit cooperation
// and that's a follow-up.

import type * as Party from "partykit/server";

interface DetectorOpts {
  boardId: string;
  workspaceId: string;
  supabaseUrl: string;
  serviceRoleKey: string | undefined;
}

interface OpEvent {
  ts: number;
  kind: string;
  cardIds: string[];
}

// Per-DO state. WeakMap keyed by Y.Doc instance would be cleaner but the
// detector only needs board-scoped state and the DO is single-room.
const STATE = new WeakMap<object, {
  ringbuffer: OpEvent[];
  lastAlertAt: number;
  paused: boolean;
  pauseUntil: number;
}>();

const WINDOW_5S = 5_000;
const WINDOW_60S = 60_000;
const THRESHOLD_5S = 100;
const THRESHOLD_60S_PCT = 0.50;
const THRESHOLD_60S_ABS = 100;
const MIN_CARDS_FOR_PCT = 50;
const ALERT_COOLDOWN_MS = 60_000;
const PAUSE_DURATION_MS = 60_000;

export function installAnomalyDetector(roomKey: object, opts: DetectorOpts) {
  if (!STATE.has(roomKey)) {
    STATE.set(roomKey, {
      ringbuffer: [],
      lastAlertAt: 0,
      paused: false,
      pauseUntil: 0,
    });
  }
  return {
    /**
     * Called by opLog after each Y.Update is classified. Returns whether
     * an alert was fired this call (rare; useful for caller logging).
     */
    record(classification: { op_kind: string; card_ids: string[] }, cardCountNow: number): boolean {
      const state = STATE.get(roomKey)!;
      const now = Date.now();

      // Lift expired pauses.
      if (state.paused && now >= state.pauseUntil) {
        state.paused = false;
        state.pauseUntil = 0;
      }

      // Only delete-like ops feed the detector.
      const isDelete = classification.op_kind === 'card.delete'
                    || (classification.op_kind === 'op.bulk' && classification.card_ids.length >= 3);
      if (!isDelete) return false;

      state.ringbuffer.push({ ts: now, kind: classification.op_kind, cardIds: classification.card_ids });
      // Drop entries older than 60s (the larger window).
      const cutoff = now - WINDOW_60S;
      while (state.ringbuffer.length > 0 && state.ringbuffer[0].ts < cutoff) {
        state.ringbuffer.shift();
      }

      // Cooldown — don't spam alerts after one just fired.
      if (now - state.lastAlertAt < ALERT_COOLDOWN_MS) return false;

      // Count deletes inside each window.
      const cutoff5 = now - WINDOW_5S;
      let count5 = 0;
      let count60 = 0;
      const touched5 = new Set<string>();
      const touched60 = new Set<string>();
      for (const e of state.ringbuffer) {
        for (const c of e.cardIds) {
          touched60.add(c);
          if (e.ts >= cutoff5) touched5.add(c);
        }
        count60 += e.cardIds.length;
        if (e.ts >= cutoff5) count5 += e.cardIds.length;
      }

      const trip5s = count5 >= THRESHOLD_5S;
      const trip60sPct =
        cardCountNow >= MIN_CARDS_FOR_PCT &&
        count60 >= THRESHOLD_60S_ABS &&
        count60 / cardCountNow >= THRESHOLD_60S_PCT;

      if (!trip5s && !trip60sPct) return false;

      state.lastAlertAt = now;
      state.paused = true;
      state.pauseUntil = now + PAUSE_DURATION_MS;

      // Fire and forget — never block the Y wire protocol.
      const payload = {
        delete_count: count60,
        deletes_5s: count5,
        deletes_60s: count60,
        window_seconds: trip5s ? 5 : 60,
        cards_touched: trip5s ? touched5.size : touched60.size,
        board_card_count: cardCountNow,
        trigger: trip5s ? '5s-velocity' : '60s-pct',
      };
      void postAlert(opts, payload);
      return true;
    },

    /** Returns true if writes should currently be blocked. */
    isPaused(): boolean {
      const state = STATE.get(roomKey);
      if (!state) return false;
      if (state.paused && Date.now() >= state.pauseUntil) {
        state.paused = false;
        state.pauseUntil = 0;
      }
      return state.paused;
    },

    /** Externally-cleared pause (e.g. user clicked Allow on the banner). */
    clearPause(): void {
      const state = STATE.get(roomKey);
      if (!state) return;
      state.paused = false;
      state.pauseUntil = 0;
    },
  };
}

async function postAlert(opts: DetectorOpts, payload: Record<string, any>) {
  if (!opts.serviceRoleKey) {
    console.warn(`[anomaly ${opts.boardId}] no service key; alert skipped`);
    return;
  }
  try {
    const res = await fetch(`${opts.supabaseUrl}/rest/v1/workspace_anomaly_alerts`, {
      method: "POST",
      headers: {
        apikey: opts.serviceRoleKey,
        Authorization: `Bearer ${opts.serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        workspace_id: opts.workspaceId,
        board_ids: [opts.boardId],
        kind: "mass_delete",
        severity: "critical",
        payload,
        auto_paused: true,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(`[anomaly ${opts.boardId}] alert insert ${res.status}: ${text.slice(0, 200)}`);
    }
  } catch (e: any) {
    console.warn(`[anomaly ${opts.boardId}] alert post threw: ${e?.message || e}`);
  }
}
