// Surface-level error boundary — isolates a render-time crash to ONE board
// pane (canvas / list) instead of letting it bubble to AppErrorBoundary,
// which unmounts the whole Workspace (and with it the live Y.Docs).
//
// Why this matters beyond UX: a cross-board card move is an async sequence
// (save target → delete source) that runs against the live Y.Docs. If a
// render crash tears down Workspace mid-move, those docs are destroyed and
// the move is orphaned. Containing the crash here keeps Workspace + the docs
// mounted so the move completes, and re-mounts just the crashed surface from
// the (intact) Yjs state.
//
// The crash we actually see is React's own commit-phase reconciliation
// throwing "Failed to execute 'removeChild' on 'Node'" while unmounting a
// batch of card subtrees (editors / embeds React doesn't fully own). It
// leaves stale DOM behind, so the fix is to REMOUNT the subtree fresh (new
// key) rather than retry in place. A small retry cap stops an infinite
// crash→remount loop if the error is somehow deterministic.
//
// Class component because hooks can't catch errors.

import { Component } from 'react';
import { logClientError } from '../lib/errorReporting.js';
import { looksLikeStaleChunk, reloadIfStaleChunk } from '../lib/lazyWithReload.js';

const MAX_AUTO_REMOUNTS = 3;

export class SurfaceErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, remounts: 0, error: null, recovering: false };
  }

  static getDerivedStateFromError(error) {
    // Pre-mark stale-deploy lazy-chunk failures (message-only check — no
    // componentStack here) so render() shows a neutral "Updating…" instead of
    // flashing the glitch panel for a frame before the one-shot reload lands.
    return { hasError: true, error, recovering: looksLikeStaleChunk(error) };
  }

  componentDidCatch(error, info) {
    // Stale-deploy recovery: a content-hashed chunk under this surface 404'd
    // (e.g. lazyWithReload's 10s guard already fired once, so the failure
    // rethrew into here instead of self-healing). Reload ONCE (guarded, shared
    // key with lazyWithReload) rather than remounting into the same dead chunk
    // and stranding the user on the "display glitch" panel.
    if (looksLikeStaleChunk(error)) {
      const reloading = reloadIfStaleChunk(error, info?.componentStack);
      logClientError(error, { kind: 'chunk-recover', componentStack: info?.componentStack });
      // Reloading → keep the neutral "Updating…" up. Guard says we already
      // reloaded and it's STILL failing → fall through to the in-pane fallback.
      this.setState(reloading ? { hasError: true, recovering: true } : { hasError: true, recovering: false });
      return;
    }

    console.error('[SurfaceErrorBoundary] caught (canvas kept alive)', error);
    console.error('[SurfaceErrorBoundary] componentStack:', info?.componentStack);
    logClientError(error, { kind: 'surface', componentStack: info?.componentStack });
    // Recover in place: bump the remount key so the children mount FRESH on
    // the next render (no stale DOM to trip reconciliation again), unless
    // we've already retried too many times — then hold the fallback so we
    // don't spin. The Y.Doc state is intact either way; a manual reopen of
    // the board always rebuilds cleanly.
    this.setState((s) =>
      s.remounts < MAX_AUTO_REMOUNTS
        ? { hasError: false, remounts: s.remounts + 1 }
        : { hasError: true });
  }

  render() {
    // Stale-deploy chunk failure: a one-shot reload is already in flight (or
    // about to be). Show a neutral, pane-scoped "Updating…" instead of the
    // alarming glitch panel for the brief moment before the page reloads.
    if (this.state.recovering) {
      return (
        <div className="surface-error" role="status" aria-live="polite">
          <div className="surface-error-text">Updating… a new version is loading.</div>
        </div>
      );
    }
    if (this.state.hasError) {
      // Exhausted auto-remounts — show a quiet, in-place recovery prompt
      // scoped to this pane (Workspace + the other pane stay alive).
      return (
        <div className="surface-error" role="alert">
          <div className="surface-error-text">This board view hit a display glitch.</div>
          <button
            className="surface-error-btn"
            onClick={() => window.location.reload()}
          >
            Reload this view
          </button>
        </div>
      );
    }
    // Keying on `remounts` forces a clean unmount/remount of the whole
    // subtree after a caught crash, discarding any stale DOM.
    return <div className="surface-eb-root" key={this.state.remounts}>{this.props.children}</div>;
  }
}
