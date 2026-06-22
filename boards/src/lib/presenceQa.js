// Dev-only presence QA bridge (?presenceqa=1). Builds a FAKE y-awareness that
// drives the REAL <CanvasPresence> so a Playwright spec can inject hundreds of
// synthetic peers and assert the graceful-degradation caps hold:
//   - rendered cursor DOM nodes never exceed CURSOR_RENDER_CAP (+ off-screen
//     cursors are culled)
//   - injected peer-selection CSS rules never exceed SELECTION_RULE_CAP
//   - a cursor-only flood produces ZERO extra `peers` commits (the render-storm
//     guard — this is the bug the 1a fix exists to prevent)
//
// No backend, no sockets, no real Y.Doc. Dropped from production by main.jsx's
// import.meta.env.DEV guard (same trust boundary as ?alignqa / ?arrowqa).

import * as perf from './perf.js';
import { PRESENCE_TUNING } from './presenceTuning.js';

// Minimal stand-in for y-protocols Awareness — only the surface CanvasPresence
// actually touches: getStates(), meta.get(id).lastUpdated, on/off('change').
export function makeFakeAwareness() {
  const states = new Map();   // clientId → state
  const meta = new Map();     // clientId → { lastUpdated }
  const listeners = new Set();
  let seq = 1;
  const emit = () => { for (const fn of [...listeners]) { try { fn(); } catch (_) {} } };
  return {
    clientID: 0,
    getStates() { return states; },
    meta,
    on(ev, fn) { if (ev === 'change') listeners.add(fn); },
    off(ev, fn) { if (ev === 'change') listeners.delete(fn); },
    // ── test controls ───────────────────────────────────────────────────
    _setState(clientId, state) { states.set(clientId, state); meta.set(clientId, { lastUpdated: seq++ }); },
    _touch(clientId) { meta.set(clientId, { lastUpdated: seq++ }); },
    _delete(clientId) { states.delete(clientId); meta.delete(clientId); },
    _emit: emit,
    _states: states,
  };
}

// The control surface the spec drives via window.__soleilPresenceTest.
export function makePresenceTestBridge({ aw, boardId }) {
  return {
    tuning: PRESENCE_TUNING,

    // Seed `n` peers, each with an identity + a cursor on this board. The first
    // `offscreen` peers are parked far off-screen (to exercise viewport
    // culling); the rest are laid out inside a 1280x800 viewport. With
    // `selectionsPerPeer > 0` each peer also selects that many cards (to
    // exercise the selection-ring rule cap).
    seedPeers(n, { offscreen = 0, selectionsPerPeer = 0 } = {}) {
      aw._states.clear();
      for (let i = 0; i < n; i++) {
        const isOff = i < offscreen;
        const x = isOff ? -10000 - i * 10 : 40 + (i % 12) * 60;
        const y = isOff ? -10000 : 40 + (i % 8) * 70;
        const state = {
          user: { id: 'u' + i, name: 'User' + i, color: '#4f8df8' },
          canvasCursor: { boardId, x, y },
        };
        if (selectionsPerPeer > 0) {
          state.canvasSelection = {
            boardId,
            cardIds: Array.from({ length: selectionsPerPeer }, (_, k) => `c${i}_${k}`),
            strokeIds: [], arrowIds: [],
          };
        }
        aw._setState(i + 1, state);
      }
      aw._emit();
    },

    // The render-storm scenario: jiggle EVERY peer's cursor and emit a change,
    // `frames` times. Pure cursor motion must NOT trigger a single `peers`
    // commit (the fingerprint excludes cursor position).
    floodCursors(frames = 60) {
      for (let f = 0; f < frames; f++) {
        for (const [id, st] of aw._states) {
          if (st.canvasCursor) {
            st.canvasCursor = { ...st.canvasCursor, x: st.canvasCursor.x + ((f % 2) ? 1 : -1) };
            aw._touch(id);
          }
        }
        aw._emit();
      }
    },

    // DOM / perf readouts for the assertions.
    renderedCursorCount() { return document.querySelectorAll('.cursors-layer .cursor').length; },
    injectedRuleCount() {
      const el = document.querySelector('style[data-canvas-presence]');
      const txt = el && el.textContent;
      if (!txt) return 0;
      return (txt.match(/}/g) || []).length;
    },
    setPeersCount() { return perf.snapshot().counters['presence.setPeers'] || 0; },
    perfEnable() { perf.enable(); },
    perfReset() { perf.reset(); },
  };
}
