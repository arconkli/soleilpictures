// App-level error boundary — last line of defense against render-time
// exceptions. Without this, any throw inside the React tree unmounts
// the whole app silently and the user sees nothing (the body's
// background shows through). With this, the user gets a readable
// error panel + a copy-to-clipboard button so they can paste the
// stack trace and I can diagnose.
//
// Class component because hooks can't catch errors.

import { Component } from 'react';

export class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Log the full stack + componentStack so it's also visible in
    // devtools. The on-screen panel only shows a trimmed view.
    console.error('[AppErrorBoundary] caught', error);
    console.error('[AppErrorBoundary] componentStack:', info?.componentStack);
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
    const { error, info } = this.state;
    if (!error) return this.props.children;

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
