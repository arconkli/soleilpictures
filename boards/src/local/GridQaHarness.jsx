import { useEffect } from 'react';
import { makeGridTestBridge } from '../lib/gridQa.js';

// Dev-only logic bridge for ?gridqa=1. Publishes the PURE grid layout/sequence
// helpers on window.__soleilGridTest so the Playwright spec (tests/grids.spec.js)
// can drive the fraction-tree + sequence math directly — no backend, no app
// chrome. Dropped from production by main.jsx's import.meta.env.DEV guard (same
// trust boundary as ?alignqa / ?arrowqa).
export function GridQaHarness() {
  useEffect(() => {
    window.__soleilGridTest = makeGridTestBridge();
    const root = document.getElementById('root');
    if (root) {
      root.setAttribute('data-gridqa-ready', '1');
      root.textContent = 'gridqa ready';
    }
  }, []);
  return null;
}
