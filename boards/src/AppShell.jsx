// AppShell — the post-auth subtree (TierRouter + App), loaded as a single
// lazy chunk from main.jsx so the signed-out landing never downloads the
// editor (Yjs, TipTap, Three, etc.). Owns the perf-timing wrap so perf.js
// (which imports yjs) stays out of the entry chunk too.
import { TierRouter } from './auth/TierRouter.jsx';
import { App as RawApp } from './App.jsx';
import { withPerfTime } from './lib/perf.js';

// Wrap App so render.App.ms surfaces in perf.dump() without touching App.jsx.
const App = withPerfTime(RawApp, 'App');

export default function AppShell() {
  return (
    <TierRouter>
      <App />
    </TierRouter>
  );
}
