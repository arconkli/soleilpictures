// First-run setup QA harness (?setupqa=1, DEV only): the REAL AuthGate →
// TierRouter → setup gate → WorkspaceSetup, and the workspace invite link's
// sign-in banner and join card, over an in-memory fake of the Supabase client
// (local/setupqa/fakeSetupSupabase.js). Nothing reaches a backend, and every
// analytics row is marked synthetic by isAnyQaMode.
//
//   &setup=A|B          the arm (the real override, never stamped)
//   &signedout=1        start at the sign-in screen; code 000000 is refused
//   &invitee=1          already a member of Nora's Lost Time, pointed at it
//   &resume=who|invite  a setup left at that step, in a workspace called Northlight
//   &link=limit|paused|error   making the invite link fails that way
//   &invitelimit=N      the Nth email invite on is refused by the daily limit
//   &deadlink=1         the seeded Lost Time link no longer works
//   &wsjoin=<token>     arrive by a workspace link (QA_LINK_TOKEN is Lost Time's)
//   &theme=light        &latency=<ms>        &fresh=1 (drop the kept fake)
//   &share=cancel|none  the share sheet is closed unshared, or there is none
//   &clip=fail          the browser refuses the clipboard, both ways
//   &inws=tips|reask|joiner   after the setup, in the workspace: the tips and
//                       the re-ask (SetupInWorkspace) over the real sidebar
//                       (local/setupqa/InWorkspaceQa.jsx has its own params)
//
// The fake is kept in sessionStorage across reloads (joining by the card
// reloads into the workspace), so a spec starts with &fresh=1. window.__setupQa
// has db, calls, events(), clipboard, shared, setLinkMode, setLatency. The page
// sets <html data-setupqa-ready="1"> once mounted.

import { Suspense, lazy, useEffect } from 'react';
import '../styles.css';
import { installSupabaseForQa } from '../lib/supabase.js';
import { SIDEBAR_FILES_DEV_FLAG, WORKSPACE_SETUP_DEV_FLAG } from '../lib/appHost.js';
import { AuthGate, useAuth } from '../auth/AuthGate.jsx';
import { TierRouter } from '../auth/TierRouter.jsx';
import { getSetupOutcome } from '../lib/setupGate.js';
import { flushNow } from '../lib/analytics.js';
import { buildSetupDb, createSetupFake } from './setupqa/fakeSetupSupabase.js';

const InWorkspaceQa = lazy(() => import('./setupqa/InWorkspaceQa.jsx'));

const QS = new URLSearchParams(window.location.search);
const INWS = ['tips', 'reask', 'joiner'].includes(QS.get('inws')) ? QS.get('inws') : null;
const KEEP_KEY = 'soleil.setupqa.db';

// The gates the setup rides on are opt-in on dev.
try {
  localStorage.setItem(SIDEBAR_FILES_DEV_FLAG, '1');
  localStorage.setItem(WORKSPACE_SETUP_DEV_FLAG, '1');
} catch (_) { /* a storage-less browser just won't see the setup */ }

function loadDb() {
  if (QS.get('fresh') === '1') {
    try {
      sessionStorage.removeItem(KEEP_KEY);
      // Nothing from an earlier run may decide this one.
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith('soleil.boards.session.') || k.startsWith('soleil.setup.') || k.startsWith('soleil.boards.pending.')) localStorage.removeItem(k);
      }
      sessionStorage.removeItem('soleil.setup.override');
      // Once: a reload (joining by the card) keeps the fake it made.
      const url = new URL(window.location.href);
      url.searchParams.delete('fresh');
      window.history.replaceState({}, '', url.pathname + url.search);
    } catch (_) { /* fine */ }
  } else {
    try {
      const kept = JSON.parse(sessionStorage.getItem(KEEP_KEY) || 'null');
      if (kept) return kept;
    } catch (_) { /* start over */ }
  }
  const db = buildSetupDb({
    signedOut: QS.get('signedout') === '1',
    invitee: QS.get('invitee') === '1',
    resume: QS.get('resume'),
    linkMode: QS.get('link'),
    inviteLimitAt: QS.has('invitelimit') ? Number(QS.get('invitelimit')) : null,
    deadLink: QS.get('deadlink') === '1',
    inws: INWS,
  });
  // A member pointed at the workspace, the way a claim at sign-in leaves it.
  if (QS.get('invitee') === '1') {
    try { localStorage.setItem('soleil.boards.session.qa-me.workspace', JSON.stringify({ activeWorkspaceId: 'ws-lost-time' })); } catch (_) {}
  }
  return db;
}

const db = loadDb();
const keep = (d) => { try { sessionStorage.setItem(KEEP_KEY, JSON.stringify(d)); } catch (_) {} };
keep(db);
const fake = createSetupFake({ db, latency: Number(QS.get('latency')) || 0, onWrite: keep });
installSupabaseForQa(fake);

// Nothing leaves the page. The analytics beacon posts straight to the REST
// endpoint, past the client, so it is caught here and kept with the rest; any
// other call that slips past the fake gets an empty answer.
const realFetch = window.fetch.bind(window);
const keepRows = (body) => {
  try {
    const rows = JSON.parse(typeof body === 'string' ? body : '[]');
    db.events.push(...(Array.isArray(rows) ? rows : [rows]));
    keep(db);
  } catch (_) { /* not rows */ }
};
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input?.url || String(input));
  if (/\/rest\/v1\/analytics_events/.test(url)) { keepRows(init?.body); return new Response(null, { status: 201 }); }
  if (/\/(rest|auth|functions|storage)\/v1\//.test(url)) return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  return realFetch(input, init);
};
try {
  navigator.sendBeacon = (url, data) => {
    if (/\/rest\/v1\/analytics_events/.test(String(url))) keepRows(typeof data === 'string' ? data : null);
    return true;
  };
} catch (_) { /* fine */ }

// The clipboard and the share sheet, recorded rather than real. events()
// sends the analytics queue first, so a spec reads every row logged so far.
const qa = { ...fake.qa, events: () => { flushNow(); return fake.qa.events(); }, clipboard: [], shared: [] };
try {
  const refuse = QS.get('clip') === 'fail';
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (t) => {
        if (refuse) throw new DOMException('Write permission denied.', 'NotAllowedError');
        qa.clipboard.push(String(t));
      },
    },
  });
  if (refuse) {
    const exec = document.execCommand.bind(document);
    document.execCommand = (cmd, ...rest) => (String(cmd).toLowerCase() === 'copy' ? false : exec(cmd, ...rest));
  }
  Object.defineProperty(navigator, 'share', {
    configurable: true,
    value: QS.get('share') === 'none' ? undefined : async (data) => {
      if (QS.get('share') === 'cancel') throw new DOMException('Share canceled', 'AbortError');
      qa.shared.push(data);
    },
  });
} catch (_) { /* a browser that refuses: the spec says so */ }
window.__setupQa = qa;

if (QS.get('theme') === 'light') document.documentElement.setAttribute('data-theme', 'light');
else document.documentElement.setAttribute('data-theme', 'dark');

// Stands in for the app: what the setup left behind for it.
function AppStub() {
  const { user } = useAuth();
  let slot = null;
  try { slot = JSON.parse(localStorage.getItem(`soleil.boards.session.${user?.id}.workspace`) || 'null'); } catch (_) {}
  const outcome = getSetupOutcome(user?.id);
  return (
    <main data-testid="qa-app" style={{ padding: 32, font: '14px/1.5 var(--font-sans)', color: 'var(--ink-1)', background: 'var(--bg-0)', minHeight: '100vh' }}>
      <h1 style={{ font: '600 20px var(--font-sans)', color: 'var(--ink-0)' }}>The app</h1>
      <pre data-testid="qa-outcome">{JSON.stringify(outcome)}</pre>
      <pre data-testid="qa-slot">{JSON.stringify(slot)}</pre>
    </main>
  );
}

export function SetupQaHarness() {
  useEffect(() => { document.documentElement.setAttribute('data-setupqa-ready', '1'); }, []);
  if (INWS) {
    return (
      <Suspense fallback={null}>
        <InWorkspaceQa db={db} mode={INWS} qs={QS} />
      </Suspense>
    );
  }
  return (
    <AuthGate>
      <TierRouter>
        <AppStub />
      </TierRouter>
    </AuthGate>
  );
}
