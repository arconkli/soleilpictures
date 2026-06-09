// App-level error boundary — last line of defense against render-time
// exceptions. Without this, any throw inside the React tree unmounts
// the whole app silently and the user sees nothing (the body's
// background shows through). With this, the user gets a readable
// error panel + a copy-to-clipboard button so they can paste the
// stack trace and I can diagnose.
//
// Class component because hooks can't catch errors.

import { Component } from 'react';
import { logClientError } from '../lib/errorReporting.js';
import { looksLikeStaleChunk, reloadIfStaleChunk } from '../lib/lazyWithReload.js';

export class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    // Pre-mark stale-deploy lazy-chunk failures as `recovering` (message-only
    // check — no componentStack here) so render() shows a neutral "Updating…"
    // instead of flashing the crash panel for a frame before we reload.
    return { error, recovering: looksLikeStaleChunk(error) };
  }

  componentDidCatch(error, info) {
    // Last-resort stale-deploy recovery: a content-hashed chunk vanished after a
    // deploy and the failure slipped past lazyWithReload (unusual error phrasing,
    // an undefined-module `.default` read, etc.). Reload ONCE (guarded, shared
    // key) instead of stranding the user on the crash panel.
    if (looksLikeStaleChunk(error)) {
      const reloading = reloadIfStaleChunk(error, info?.componentStack);
      // Still observable, but flagged distinctly so it doesn't read as a hard
      // render crash in client_errors.
      logClientError(error, { kind: 'chunk-recover', componentStack: info?.componentStack });
      if (reloading) { this.setState({ info }); return; }
      // Guard says we already reloaded and it's STILL failing (broken deploy or
      // a real bug that merely looks like a chunk error) — surface the panel.
      this.setState({ recovering: false, info });
      return;
    }

    // Log the full stack + componentStack so it's also visible in
    // devtools. The on-screen panel only shows a trimmed view.
    console.error('[AppErrorBoundary] caught', error);
    console.error('[AppErrorBoundary] componentStack:', info?.componentStack);
    // Log to our first-party client_errors table (keepalive beacon, no SDK).
    logClientError(error, { kind: 'render', componentStack: info?.componentStack });
    this.setState({ info });
  }

  reload = () => { window.location.reload(); };

  copy = () => {
    const { error, info } = this.state;
    const text = [
      error?.name || 'Error',
      error?.message || '',
      '',
      error?.stack || '',
      '',
      'Component stack:',
      info?.componentStack || '(none)',
    ].join('\n');
    try { navigator.clipboard.writeText(text); } catch (_) {}
  };

  render() {
    const { error, info, recovering } = this.state;
    if (!error) return this.props.children;

    // Stale-deploy lazy-chunk failure: a one-shot reload is already in flight
    // (componentDidCatch). Show a neutral "Updating…" rather than the alarming
    // red crash panel for the brief moment before the page reloads. Styled
    // inline so it never depends on (or is restyled by) the shared error CSS.
    if (recovering) {
      return (
        <div className="app-error-boundary" role="status" aria-live="polite"
             style={{ position: 'fixed', inset: 0, zIndex: 999, display: 'flex',
                      alignItems: 'center', justifyContent: 'center', padding: 24,
                      background: 'rgba(10, 10, 12, 0.85)', backdropFilter: 'blur(6px)',
                      font: '400 14px/1.45 system-ui, sans-serif', color: '#e7e7ea',
                      textAlign: 'center' }}>
          <div>
            <div style={{ font: '600 16px/1.2 system-ui, sans-serif' }}>Updating…</div>
            <div style={{ marginTop: 4, opacity: 0.7 }}>A new version is loading.</div>
          </div>
        </div>
      );
    }

    // Trim component stack to the top ~15 frames for the on-screen
    // view. The clipboard copy gets the full thing.
    const compStack = (info?.componentStack || '').trim().split('\n').slice(0, 15).join('\n');

    return (
      <div className="app-error-boundary">
        <div className="app-error-panel" role="alertdialog" aria-modal="true">
          <div className="app-error-header">
            <span className="app-error-title">Something broke.</span>
            <span className="app-error-sub">
              The screen would normally go blank — this panel is here so
              you can see what happened.
            </span>
          </div>

          <div className="app-error-message">
            <div className="app-error-name">{error.name || 'Error'}</div>
            <div className="app-error-text">{error.message || String(error)}</div>
          </div>

          {compStack && (
            <pre className="app-error-stack">{compStack}</pre>
          )}

          <div className="app-error-actions">
            <button className="app-error-btn" onClick={this.copy}>
              Copy error
            </button>
            <button className="app-error-btn is-primary" onClick={this.reload}>
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
