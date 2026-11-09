// QuietBoundary — for chrome the page works without (the activity tray): a
// crash or a chunk that won't load draws nothing and is logged, instead of
// reaching AppErrorBoundary and taking the workspace with it.
import { Component } from 'react';
import { logClientError } from '../lib/errorReporting.js';

export class QuietBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error, info) {
    logClientError(error, { kind: this.props.logKind || 'render', componentStack: info?.componentStack });
  }
  render() { return this.state.failed ? null : this.props.children; }
}
