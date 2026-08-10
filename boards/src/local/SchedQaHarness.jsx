import { useEffect } from 'react';
import { makeSchedTestBridge } from '../lib/schedQa.js';

// Dev-only logic bridge for ?schedqa=1. Publishes the PURE schedule date/
// layout/graft helpers on window.__soleilSchedTest so the Playwright spec
// (tests/schedule.spec.js) can drive the calendar math directly — no backend,
// no app chrome. Dropped from production by main.jsx's import.meta.env.DEV
// guard (same trust boundary as ?gridqa).
export function SchedQaHarness() {
  useEffect(() => {
    window.__soleilSchedTest = makeSchedTestBridge();
    const root = document.getElementById('root');
    if (root) {
      root.setAttribute('data-schedqa-ready', '1');
      root.textContent = 'schedqa ready';
    }
  }, []);
  return null;
}
