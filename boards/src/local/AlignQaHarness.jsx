import { useEffect } from 'react';
import { makeSnapTestBridge } from '../lib/snapQa.js';

// Dev-only logic bridge for ?alignqa=1. Publishes the PURE snap helpers on
// window.__soleilAlignTest so the Playwright spec (tests/align.spec.js) can drive
// the snap math directly — no backend, no app chrome. Dropped from production by
// main.jsx's import.meta.env.DEV guard (same trust boundary as ?arrowqa).
export function AlignQaHarness() {
  useEffect(() => {
    window.__soleilAlignTest = makeSnapTestBridge();
    const root = document.getElementById('root');
    if (root) {
      root.setAttribute('data-alignqa-ready', '1');
      root.textContent = 'alignqa ready';
    }
  }, []);
  return null;
}
