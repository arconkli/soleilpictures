import { useEffect } from 'react';
// The tray wears the files sidebar's glass (--sbf-*), as in the app.
import '../components/sidebar/clusterSidebar.css';
import { CardTransferState } from '../components/cards/CardTransferState.jsx';
import { Icon } from '../components/Icon.jsx';
import { FilePdf } from '../lib/icons.js';
import {
  startBatch, addTransfer, updateTransfer, removeTransfer, pauseBatch, setCardCanceller, __setActivityClock,
} from '../lib/activity.js';
import { exportWords, copyWords, copyDoneWords } from '../lib/activityWords.js';
import { setCanvasScale } from '../lib/canvasScale.js';
import { VersionsSection } from '../components/info/VersionsSection.jsx';
import { ActivityTray } from '../components/ActivityTray.jsx';
import { HeldUploadsBar } from '../components/HeldUploadsBar.jsx';
import { ImportTray } from '../components/ImportTray.jsx';
import { holdDrop } from '../lib/heldUploads.js';
import { putImportJob } from '../lib/importJobs.js';

// Dev-only card-upload QA page (?uploadqa=1), no backend. Renders
// CardTransferState over fake cards in every state: this tab's (the real
// activity store), teammates' and the rest (a fake peers store), sizes, and
// zoom (the canvas scale set the way CanvasSurface sets it: setCanvasScale).
//   ?theme=light|dark (default dark)
//   &tray=running|paused|problems|offline|error|reconnecting|saved|held|stack|folded|single|reconnecting-open|allfailed
//         |op-zip|op-zip-done|op-export|op-copy|op-copy-done|op-with-upload|op-export-with-upload (downloads, exports and copies)
//   &tray=version|version-row: a card with its new version on the way ("Uploading version 3 · 42%"), and Info's Versions with the same upload as its top row.
//          renders only the activity tray (components/ActivityTray.jsx) in that
//          state, seeded through the real stores; &phone=1 as on a phone.
// Imported only behind main.jsx's `import.meta.env.DEV &&` guard.

const QS = new URLSearchParams(window.location.search);
const LIGHT = QS.get('theme') === 'light';

const PHOTOS = [
  'linear-gradient(180deg,#8fa7b8 0%,#b9c6cc 38%,#5f6f5a 39%,#3d4a3a 100%)',
  'linear-gradient(160deg,#c98b5e 0%,#7a4a3a 45%,#2c2a3a 100%)',
  'linear-gradient(200deg,#6d8aa0 0%,#394a5e 55%,#1d2430 100%)',
];

// A box that looks like the real card of that kind.
// `empty`: the real placeholder of a picture with no file yet (a teammate's).
function Box({ kind, w, h, i = 0, empty = false, children }) {
  const base = { position: 'relative', width: w, height: h, borderRadius: 10, overflow: 'hidden', boxSizing: 'border-box', flex: 'none' };
  let style; let inner = null;
  if (empty && (kind === 'image' || kind === 'video')) style = { ...base, background: 'var(--bg-2)', border: '1px solid var(--line-2)' };
  else if (kind === 'image' || kind === 'video') style = { ...base, background: PHOTOS[i % PHOTOS.length] };
  else {
    style = { ...base, background: 'var(--bg-2)', border: '1px solid var(--line-2)' };
    if (kind === 'pdf') inner = <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--ink-3)' }}><Icon as={FilePdf} size={Math.min(42, h / 3)} /></div>;
    if (kind === 'file') inner = <div style={{ position: 'absolute', left: 10, top: 10, right: 10, font: '600 11px var(--font-sans)', color: 'var(--ink-1)' }}>scene-04-notes.zip<div style={{ font: '500 10px var(--font-sans)', color: 'var(--ink-3)', marginTop: 2 }}>48 MB</div></div>;
    if (kind === 'audio') inner = <div style={{ position: 'absolute', left: 10, top: 8, right: 10, font: '600 10px var(--font-sans)', color: 'var(--ink-1)' }}>pad_loop_120.wav<div style={{ height: 36, marginTop: 6, background: 'repeating-linear-gradient(90deg,var(--ink-4) 0 2px,transparent 2px 5px)', opacity: .7 }} /></div>;
  }
  return <div style={style}>{inner}{children}</div>;
}

function Cell({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
      {children}
      <div style={{ font: '500 10px var(--font-sans)', color: 'var(--ink-2)', maxWidth: 240 }}>{label}</div>
    </div>
  );
}

// Sets the scale the overlay reads while it renders, as the canvas's settle does.
function Scaled({ z, children }) { setCanvasScale(z); return children; }

const mate = (code, o = {}) => ({ kind: 'mate', code, name: 'Lena Moreau', color: '#b0759a', mine: false, ...o });
// id -> [label, card kind, view, extra props]
const PEER_CASES = {
  'm-42': ['Teammate at 42%', 'image', mate(42)],
  'm-wait': ['Teammate waiting', 'pdf', mate(-1)],
  'm-prev': ['Teammate making a preview', 'pdf', mate(-3)],
  'm-fail': ['Teammate’s upload didn’t upload', 'image', mate(-2)],
  'm-mine': ['My other tab at 42%', 'image', mate(42, { mine: true })],
  'away-m': ['Teammate uploading from another cluster', 'image', { kind: 'away', name: 'Lena Moreau', color: '#b0759a', mine: false }],
  'away-v': ['Teammate away (video)', 'video', { kind: 'away', name: 'Lena Moreau', color: '#b0759a', mine: false }],
  'away-me': ['My other tab, away', 'image', { kind: 'away', name: 'Andrew', color: '#5a7fa8', mine: true }],
  legacy: ['Older build', 'file', { kind: 'legacy', name: 'Lena Moreau', color: '#b0759a' }],
  quiet: ['Quiet (grace)', 'file', { kind: 'quiet' }],
  'gone-me': ['Didn’t finish, sender (Replace + Remove)', 'file', { kind: 'gone', mine: true }],
  'gone-w': ['Didn’t finish, another writer (Remove only)', 'file', { kind: 'gone', mine: false }],
  'gone-v': ['Didn’t finish, viewer (no buttons)', 'file', { kind: 'gone', mine: false }, { canEdit: false }],
};
const peers = {
  subscribe: () => () => {},
  viewKey: (c) => JSON.stringify(PEER_CASES[c.id]?.[2] || {}),
  view: (c) => PEER_CASES[c.id]?.[2] || { kind: 'quiet' },
};

const ownIds = {};
let built = false;
function buildOwn() {
  if (built) return;
  built = true;
  // A clock that can look back, so the 42% item has run 20 s and has a rate.
  let off = 0;
  __setActivityClock(() => Date.now() + off);
  const batch = startBatch({ kind: 'upload', boardId: 'qa-board', boardName: 'QA' });
  const add = (key, state, extra = {}) => {
    ownIds[key] = `own-${key}`;
    return addTransfer({ batch, label: key, boardId: 'qa-board', cardId: ownIds[key], bytesTotal: 200e6, state, ...extra });
  };
  add('wait', 'waiting');
  off = -20000;
  const a = add('run42', 'running');
  updateTransfer(a, { fraction: 0.01 });
  off = -10000;
  updateTransfer(a, { fraction: 0.42 });
  off = 0;
  updateTransfer(add('run7', 'running'), { fraction: 0.07 });
  updateTransfer(add('fin', 'running'), { state: 'finishing' });
  add('fail', 'failed', { actions: { retry: () => {} } });
}

const noop = () => {};
function Overlay({ id, kind, w, h, canEdit = true }) {
  return (
    <CardTransferState cardId={id} kind={kind} w={w} h={h} pending
      createdBy="u-me" createdAt={Date.now()} canEdit={canEdit} me="u-me" peers={peers}
      onRetry={noop} onRemove={noop} onPickReplace={noop} />
  );
}

const h2 = { font: '700 11px var(--font-sans)', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-2)', margin: '0 0 10px' };
const Section = ({ id, title, children }) => (
  <section id={id} style={{ padding: 16, marginBottom: 14, background: 'var(--bg-1)', border: '1px solid var(--line-1)', borderRadius: 12 }}>
    <h2 style={h2}>{title}</h2>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18 }}>{children}</div>
  </section>
);

const OWN = [
  ['wait', 'image', 'Waiting (picture)'],
  ['run42', 'image', 'Running 42%, time left (picture)'],
  ['run42', 'video', 'Running 42%, time left (video)'],
  ['run7', 'image', 'Running 7%, no time left yet'],
  ['fin', 'image', 'Finishing (picture)'],
  ['fail', 'image', 'Failed, Retry (picture)'],
  ['wait', 'pdf', 'Waiting (pdf)'],
  ['run42', 'file', 'Running 42% (file)'],
  ['run42', 'audio', 'Running 42% (audio)'],
  ['fin', 'pdf', 'Finishing (pdf)'],
  ['fail', 'file', 'Failed, Retry (file)'],
];
const SMALL = [['run42', 'image'], ['wait', 'file'], ['gone-me', 'file']];
const TIER_OWN = [['wait', 'image'], ['run42', 'image'], ['fin', 'file'], ['fail', 'image'], ['fail', 'file']];
const TIER_PEER = [['m-42', 'image'], ['m-wait', 'pdf'], ['m-fail', 'image'], ['away-m', 'image'], ['away-me', 'image'], ['legacy', 'file'], ['quiet', 'file'], ['gone-me', 'file'], ['gone-w', 'file']];
const TIERS = [[100, 60, 'compact'], [60, 34, 'tiny']];
const ZOOM = [['run42', 'image'], ['wait', 'file'], ['fail', 'image'], ['gone-me', 'file']];

// ── The activity tray (&tray=<state>) ───────────────────────────────────────
const MB = 1024 ** 2;
const GB = 1024 ** 3;
// Small stand-ins for the previews a drop makes, as data URLs.
const pic = (a, b, c) => `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset=".55" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient></defs><rect width="44" height="44" fill="url(#g)"/></svg>`,
)}`;
const THUMBS = {
  i41: pic('#9aa8b2', '#5d6a70', '#2f3a36'),
  i42: pic('#3f5a5c', '#20302f', '#141a1a'),
  i43: pic('#c5ccd2', '#7f8a92', '#3d464c'),
  sct: pic('#d9a26a', '#8a4b36', '#2b2220'),
  done: pic('#b98a5c', '#5b4636', '#2a2a2e'),
};
const BOARD = 'qa-halcyon';

let trayBuilt = false;
function seedTray(state) {
  if (trayBuilt) return;
  trayBuilt = true;
  // Started 30 s ago, so the batch is past its first second and has a pace.
  let off = -30000;
  __setActivityClock(() => Date.now() + off);
  // The canvas cancels through the board's canceller (CanvasSurface registers one).
  setCardCanceller(BOARD, (cardId) => console.log('[trayqa] cancel', cardId));
  const batch = startBatch({ kind: 'upload', boardId: BOARD, boardName: 'Halcyon' });
  let n = 0;
  const add = (label, mime, bytes, st, extra = {}) => addTransfer({
    batch, label, mime, bytesTotal: bytes, state: st, boardId: BOARD, cardId: `qa-card-${++n}`, ...extra,
  });
  const run = (label, mime, bytes, fraction, rate, thumb = null) => {
    const t = add(label, mime, bytes, 'running', { thumb });
    updateTransfer(t, { fraction });
    if (rate) updateTransfer(t, { rateBps: rate });
    return t;
  };
  const failed = (label = 'Location_scout_07.jpg') => {
    const t = add(label, 'image/jpeg', 41 * MB, 'waiting', { thumb: THUMBS.sct });
    updateTransfer(t, {
      state: 'failed', retryOnline: true,
      actions: { retry: () => console.log('[trayqa] retry'), remove: () => console.log('[trayqa] remove') },
    });
  };
  const done = (k) => { for (let i = 0; i < k; i++) add(`IMG_20${30 + i}.jpg`, 'image/jpeg', 40 * MB, 'done', { thumb: THUMBS.done }); };

  if (state === 'single') {
    run('Hoarfrost_teaser.mov', 'video/quicktime', 8 * MB, 0.42, 26e3);
  } else if (state === 'offline') {
    run('IMG_2041.jpg', 'image/jpeg', 40 * MB, 0.42, 0, THUMBS.i41);
    run('Hoarfrost_teaser.mov', 'video/quicktime', 1.1 * GB, 0.18, 0);
    run('pad_loop_120.wav', 'audio/wav', 60 * MB, 0.63, 0);
  } else if (state === 'problems') {
    done(11);
    failed();
  } else if (state === 'allfailed') {
    for (const [label, thumb] of [['IMG_2041.jpg', THUMBS.i41], ['IMG_2042.jpg', THUMBS.i42], ['IMG_2043.jpg', THUMBS.i43]]) {
      const t = add(label, 'image/jpeg', 40 * MB, 'waiting', { thumb });
      updateTransfer(t, {
        state: 'failed', error: 'Didn’t upload',
        actions: { retry: () => console.log('[trayqa] retry'), remove: () => removeTransfer(t) },
      });
    }
  } else if (state === 'running' || state === 'paused' || state === 'stack' || state === 'folded' || state === 'reconnecting-open') {
    run('IMG_2041.jpg', 'image/jpeg', 40 * MB, 0.42, 0, THUMBS.i41);
    run('Hoarfrost_teaser.mov', 'video/quicktime', 1.1 * GB, 0.18, 5 * MB);
    run('pad_loop_120.wav', 'audio/wav', 60 * MB, 0.63, 0);
    const pdf = add('Treatment_v3.pdf', 'application/pdf', 30 * MB, 'running');
    updateTransfer(pdf, { state: 'finishing' });
    add('IMG_2042.jpg', 'image/jpeg', 40 * MB, 'waiting', { thumb: THUMBS.i42 });
    add('IMG_2043.jpg', 'image/jpeg', 40 * MB, 'waiting', { thumb: THUMBS.i43 });
    failed();
    done(5);
    if (state === 'paused') pauseBatch(batch);
  }
  // Downloads, exports and copies: one batch of one item each (lib/activityOps.js).
  const op = (kind, label, o = {}) => {
    const b = startBatch({ kind, boardId: BOARD, boardName: 'Halcyon', label, showAfterMs: kind === 'copy' ? 0 : null, lingerMs: 10 * 60000 });
    return addTransfer({ batch: b, kind, label, boardId: BOARD, state: 'running', ...o });
  };
  // Done 12 s after it started (one done inside the tray's first second never shows).
  const opDone = (kind, id, doneLabel, actions = null) => { off = -18000; updateTransfer(id, { state: 'done', doneLabel, actions }); };
  if (state === 'op-zip' || state === 'op-with-upload') {
    if (state === 'op-with-upload') {
      run('IMG_2041.jpg', 'image/jpeg', 40 * MB, 0.42, 0, THUMBS.i41);
      run('Hoarfrost_teaser.mov', 'video/quicktime', 1.1 * GB, 0.18, 5 * MB);
    }
    const z = op('download', 'Halcyon.zip', { count: { done: 34, total: 120 }, cancel: () => console.log('[trayqa] cancel zip') });
    updateTransfer(z, { fraction: 0.28 });
  } else if (state === 'op-export-with-upload') {
    // A running upload and a just-started export: the export leads the chip.
    run('IMG_2041.jpg', 'image/jpeg', 40 * MB, 0.42, 0, THUMBS.i41);
    run('Hoarfrost_teaser.mov', 'video/quicktime', 1.1 * GB, 0.18, 5 * MB);
    op('export', exportWords({ name: 'Treatment_v3', format: 'pdf' }));
  } else if (state === 'op-zip-done') {
    const z = op('download', 'Halcyon.zip', { count: { done: 120, total: 120 } });
    opDone('download', z, 'Downloaded Halcyon.zip');
  } else if (state === 'op-export') {
    op('export', exportWords({ name: 'Treatment_v3', format: 'pdf' }));
  } else if (state === 'op-copy') {
    const c = op('copy', copyWords({ count: 24 }), { cancel: null });
    updateTransfer(c, { fraction: 0.55 });
  } else if (state === 'op-copy-done') {
    const c = op('copy', copyWords({ count: 24 }));
    opDone('copy', c, copyDoneWords(), { open: () => console.log('[trayqa] open copy') });
  }
  if (state === 'held' || state === 'stack') {
    holdDrop({
      boardId: BOARD, via: 'canvas', limit: 'storage',
      files: [{ name: 'IMG_2042.jpg', size: 19 * MB, type: 'image/jpeg' }, { name: 'IMG_2043.jpg', size: 19 * MB, type: 'image/jpeg' }],
    });
  }
  if (state === 'stack') {
    putImportJob('qa-import', {
      phase: 'job', title: 'Night Shift', targetName: 'Studio', act: (id) => console.log('[trayqa] import', id),
      snap: {
        status: 'running', totals: { files: 6193, bytes: 26.4 * GB, clusters: 17 }, landed: { files: 1846, bytes: 13 * GB },
        sentBytes: 13.2 * GB, waiting: { files: 0 }, failed: [], etaMs: 70 * 60000, currentRow: 'Night Shift/Stills',
        tops: [{ key: 'Night Shift', name: 'Night Shift', files: 6193, landed: 1846, boardId: 'b-night' }],
        rows: [
          { key: 'Night Shift/Casting', name: 'Casting', files: 752, landed: 752 },
          { key: 'Night Shift/Stills', name: 'Stills', files: 4518, landed: 535 },
          { key: 'Night Shift/Wardrobe', name: 'Wardrobe', files: 236, landed: 0 },
        ],
        byBoard: {},
      },
    });
  }
  off = 0;
}

// What useCanvasConnection would say (lib/canvasConnection.js).
const CONNS = {
  offline: { state: 'offline', pending: true, kept: true, live: false, liveSince: null, everLive: true },
  error: { state: 'error', pending: true, kept: false, live: false, liveSince: null, everLive: true },
  reconnecting: { state: 'reconnecting', pending: false, kept: true, live: false, liveSince: null, everLive: true },
  'reconnecting-open': { state: 'reconnecting', pending: false, kept: true, live: false, liveSince: null, everLive: true },
  saved: { state: 'saved', pending: false, kept: true, live: true, liveSince: 0, everLive: true },
};

function TrayQa({ state }) {
  const phone = QS.get('phone') === '1';
  seedTray(state);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', LIGHT ? 'light' : 'dark');
    // "folded": the tray opened itself on the batch; fold it as a person would.
    const f = state === 'folded' ? setTimeout(() => document.querySelector('.atr-col [aria-label="Fold"]')?.click(), 300) : null;
    // Offline shows after its 2 s grace.
    const r = setTimeout(() => { document.documentElement.dataset.trayqaReady = '1'; }, state === 'offline' ? 2400 : 600);
    return () => { clearTimeout(f); clearTimeout(r); };
  }, [state]);
  return (
    <div className={`app sb-files${phone ? '' : ' is-floating-chrome'}`} style={{
      position: 'fixed', inset: 0, background: 'var(--bg-0)',
      backgroundImage: 'radial-gradient(color-mix(in srgb, var(--ink-0) 9%, transparent) 1px, transparent 1px)', backgroundSize: '24px 24px',
    }}>
      {phone && (
        <nav className="mb-nav" aria-label="App navigation">
          {['Home', 'Search', 'Add', 'Messages', 'Settings'].map((l) => (
            <button key={l} type="button" className="mb-nav-tab"><span className="mb-nav-lbl">{l}</span></button>
          ))}
        </nav>
      )}
      <ActivityTray phone={phone} conn={CONNS[state] || null} retryConnection={() => console.log('[trayqa] retry connection')}>
        <HeldUploadsBar openBoardIds={[BOARD]} boardName={() => 'Halcyon'} onOpenBoard={() => {}} toast={(t) => console.log('[trayqa] toast', t.message)} />
        <ImportTray guide={null} />
      </ActivityTray>
    </div>
  );
}

// A new version on the way (versionActions.addVersionFromFile registers this item).
function VersionQa({ state }) {
  const cardId = 'ver-card';
  if (!ownIds.ver) {
    ownIds.ver = cardId;
    const batch = startBatch({ kind: 'upload', boardId: 'qa-board', boardName: 'QA' });
    const t = addTransfer({
      batch, label: 'IMG_2041_v3.jpg', boardId: 'qa-board', cardId, bytesTotal: 19 * 1024 * 1024, state: 'running', mime: 'image/jpeg',
      version: { n: 3 }, actions: { retry: () => {}, remove: () => {} },
    });
    updateTransfer(t, { fraction: 0.42 });
  }
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', LIGHT ? 'light' : 'dark');
    document.documentElement.dataset.trayqaReady = '1';
  }, []);
  const card = {
    id: cardId, kind: 'image', src: 'b', createdBy: 'u-me', createdAt: '2026-11-01T10:00:00Z',
    versions: [
      { id: 'v1', n: 1, src: 'a', fileName: 'IMG_2041.jpg', sizeBytes: 14 * 1024 * 1024, by: 'u-me', at: '2026-11-01T10:00:00Z' },
      { id: 'v2', n: 2, src: 'b', fileName: 'IMG_2041_v2.jpg', sizeBytes: 16 * 1024 * 1024, by: 'u-me', at: '2026-11-05T10:00:00Z' },
    ],
  };
  return (
    <div style={{ background: 'var(--bg-0)', color: 'var(--ink-0)', minHeight: '100vh', padding: 24, boxSizing: 'border-box' }}>
      <div id="qa-version" style={{ display: 'inline-block', padding: 16, background: 'var(--bg-1)', borderRadius: 12 }}>
        {state === 'version-row'
          ? <div style={{ width: 340 }}><VersionsSection card={card} canEdit personName={() => 'You'} onUpload={() => {}} onMakeCurrent={() => {}} onDelete={() => {}} /></div>
          : <Scaled z={1}><Box kind="image" w={300} h={200}><Overlay id={cardId} kind="image" w={300} h={200} /></Box></Scaled>}
      </div>
    </div>
  );
}

export function UploadQaHarness() {
  if (QS.get('tray') === 'version' || QS.get('tray') === 'version-row') return <VersionQa state={QS.get('tray')} />;
  if (QS.get('tray')) return <TrayQa state={QS.get('tray')} />;
  buildOwn();
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', LIGHT ? 'light' : 'dark');
    document.documentElement.dataset.uploadqaReady = '1';
  }, []);
  return (
    <div style={{ background: 'var(--bg-0)', color: 'var(--ink-0)', minHeight: '100vh', padding: 16, boxSizing: 'border-box', width: 1000 }}>
      <Section id="own" title="This tab (240 x 180)">
        {OWN.map(([k, kind, label], i) => (
          <Cell key={label} label={label}><Scaled z={1}><Box kind={kind} w={240} h={180} i={i}><Overlay id={ownIds[k]} kind={kind} w={240} h={180} /></Box></Scaled></Cell>
        ))}
      </Section>
      <Section id="mates" title="Teammates and the rest (240 x 180)">
        {Object.entries(PEER_CASES).map(([id, [label, kind, , extra]], i) => (
          <Cell key={id} label={label}><Scaled z={1}><Box kind={kind} w={240} h={180} i={i} empty><Overlay id={id} kind={kind} w={240} h={180} {...(extra || {})} /></Box></Scaled></Cell>
        ))}
      </Section>
      <Section id="sizes" title="Sizes (110 x 70 and 60 x 36)">
        {[[110, 70], [60, 36]].flatMap(([w, h]) => SMALL.map(([k, kind]) => (
          <Cell key={`${w}${k}`} label={`${k} ${w} x ${h}`}>
            <Scaled z={1}><Box kind={kind} w={w} h={h}><Overlay id={ownIds[k] || k} kind={kind} w={w} h={h} /></Box></Scaled>
          </Cell>
        )))}
      </Section>
      <Section id="tiers" title="Size tiers (100 x 60 compact, 60 x 34 tiny)">
        {TIERS.flatMap(([w, h, name]) => [
          ...TIER_OWN.map(([k, kind]) => (
            <Cell key={`${name}-own-${k}-${kind}`} label={`${name}: ${k} (${kind})`}>
              <Scaled z={1}><Box kind={kind} w={w} h={h}><Overlay id={ownIds[k]} kind={kind} w={w} h={h} /></Box></Scaled>
            </Cell>
          )),
          ...TIER_PEER.map(([id, kind]) => (
            <Cell key={`${name}-${id}`} label={`${name}: ${id}`}>
              <Scaled z={1}><Box kind={kind} w={w} h={h} empty><Overlay id={id} kind={kind} w={w} h={h} /></Box></Scaled>
            </Cell>
          )),
        ])}
      </Section>
      <Section id="zoom" title="Zoom (0.5 and 2, 240 x 180 cards)">
        {[0.5, 2].flatMap((z) => ZOOM.map(([k, kind], i) => (
          <Cell key={`${z}${k}`} label={`${k} at zoom ${z}`}>
            <div style={{ width: 240 * z, height: 180 * z }}>
              <div style={{ transform: `scale(${z})`, transformOrigin: 'top left', width: 240, height: 180 }}>
                <Scaled z={z}><Box kind={kind} w={240} h={180} i={i}><Overlay id={ownIds[k] || k} kind={kind} w={240} h={180} /></Box></Scaled>
              </div>
            </div>
          </Cell>
        )))}
      </Section>
    </div>
  );
}
