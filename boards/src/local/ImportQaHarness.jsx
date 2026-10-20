import { useEffect, useRef } from 'react';
import '../components/sidebar/clusterSidebar.css';
import { ImportTray } from '../components/ImportTray.jsx';
import { ImportAskDialog } from '../components/ImportAskDialog.jsx';
import { putImportJob, dropImportJob } from '../lib/importJobs.js';
import { ImportZipDialog } from '../components/ImportZipDialog.jsx';
import { SidebarMeter } from '../components/sidebar/SidebarMeter.jsx';
import { askCopy, zipAskCopy } from '../lib/importCopy.js';
import { UnplacedOffer } from '../components/UnplacedOffer.jsx';
import { ImportWaitRow } from '../components/ImportWaitRow.jsx';
import { openImportGuide } from '../lib/importGuide.js';

// Dev-only bulk-import QA page (?importqa=1), no backend. Renders the tray, its
// chip and the ask dialog from fixtures shaped like lib/importCopy.test.mjs.
//   ?state=reading|creating|run|paused|wait-free|wait-storage-paid|wait-trial|
//          wait-guest|done|done-fails|cancelled|failed|reload|redrop   (default run)
//          (reload / redrop: stopped by a reload, with and without a kept folder)
//   ?min=1 starts folded to the chip   ?phone=1 lifts it over the phone nav
//   ?theme=light|dark   ?dialog=free|creator|trial|guest|zip-takeout|zip-one|zip-many
//   ?menu=1 opens the sidebar's Upload menu (its last item opens the guide)
//   ?guide=1 opens the tray's guide: &app=drive|photos|dropbox|onedrive|icloud|other
//          &target=0 (no open cluster: drops ask which)   &plan=free|trial|paid|guest|full
//          (over ?state's import, which shows again when the guide closes)
//   ?land=night|wait|coming|plain   an imported cluster's empty canvas
//   ?row=1 adds a cluster's Files, with its "waiting for room" row while ?state waits
// window.__importQa.put / .drop add and take away imports, as App does;
// .openGuide opens the guide. The guide's drops and picks log "[importqa] guide".
// Imported only behind main.jsx's `import.meta.env.DEV &&` guard.

const GB = 1024 ** 3;
const params = new URLSearchParams(window.location.search);

const ROWS = [
  ['Night Shift', 3, 3], ['Camera tests', 61, 61], ['Casting', 752, 752], ['Locations', 395, 395], ['Lookbook', 86, 86],
  ['Script', 14, 14], ['Stills', 535, 4518], ['Storyboards', 0, 128], ['Wardrobe', 0, 236],
].map(([name, landed, files]) => ({ key: name === 'Night Shift' ? name : `Night Shift/${name}`, name, files, landed }));

// What importJob's byBoard says of one cluster the import made, its files still to come.
const camera = (status, reason = null) => ({ 'b-camera': { path: 'Night Shift › Camera tests', waiting: 52, status, reason } });

const snap = (over = {}) => ({
  status: 'running', totals: { files: 6193, bytes: 26.4 * GB, clusters: 17 }, landed: { files: 1846, bytes: 13 * GB },
  sentBytes: 13.2 * GB, waiting: { files: 0 }, failed: [], etaMs: 70 * 60000, currentRow: 'Night Shift/Stills',
  tops: [{ key: 'Night Shift', name: 'Night Shift', files: 6193, landed: 1846, boardId: 'b-night' }],
  rows: ROWS, byBoard: camera('running'),
  ...over,
});

const FAILS = [
  { relPath: 'Casting/Callbacks/take-14.mov', message: 'The file was modified during upload' },
  { relPath: 'Stills/DSC_4410.jpg', message: 'NotReadableError: could not be read' },
  { relPath: 'Stills/DSC_4411.jpg', message: 'boom' },
];

function fixture(state) {
  const job = { phase: 'job', title: 'Night Shift', targetName: 'Studio' };
  const wait = (more, extra) => ({ ...job, ...extra, snap: snap({ status: 'waiting', landed: { files: 12 }, waiting: { files: 6181 }, byBoard: camera('waiting', more.waitingReason), ...more }) });
  switch (state) {
    case 'reading': return { phase: 'reading', title: 'Night Shift', reading: { files: 2410, folders: 6, bytes: 9.1 * GB } };
    case 'creating': return { ...job, snap: snap({ status: 'creating', rows: [] }) };
    case 'paused': return { ...job, snap: snap({ status: 'paused' }) };
    case 'wait-free': return wait({ waitingReason: 'cards' }, { own: true, plan: 'free', offer: 'trial' });
    case 'wait-storage-paid': return wait({ waitingReason: 'storage' }, { own: true, plan: 'paid', offer: 'addon' });
    case 'wait-trial': return wait({ waitingReason: 'storage' }, { own: true, plan: 'trial', offer: null });
    case 'wait-guest': return wait({ waitingReason: 'cards' }, { own: false, ownerName: 'Maya Ortiz' });
    case 'done': return { ...job, snap: snap({ status: 'done', landed: { files: 6190 } }) };
    case 'done-fails': return { ...job, snap: snap({ status: 'done', landed: { files: 6190 }, failed: FAILS }) };
    case 'cancelled': return { ...job, snap: snap({ status: 'cancelled' }) };
    case 'failed': return { ...job, snap: snap({ status: 'failed', error: 'Failed to fetch' }) };
    case 'reload':
    case 'redrop': return {
      phase: 'stopped', title: 'Night Shift', targetName: 'Studio', landed: 1846, total: 6193, canResume: state === 'reload',
      stopped: { jobId: 'qa-job', targetBoardId: 'b-studio', source: 'folder', tops: ['Night Shift'], zips: [] },
    };
    default: return { ...job, snap: snap() };
  }
}

const NIGHT = { title: 'Night Shift', folders: 14, totals: { files: 6193, bytes: 26.4 * GB, clusters: 17 }, splits: [{ name: 'Stills', of: 3 }] };
const DIALOGS = {
  free: { ...NIGHT, fit: { files: 12, bytes: 0 }, waiting: { files: 6181 }, stoppedBy: 'cards',
    budgets: { cardsLeft: 12, bytesLeft: 3.8 * GB, bytesUsed: 1.2 * GB, quota: 5 * GB }, plan: 'free', own: true, trialOffer: true },
  creator: { ...NIGHT, fit: { files: 267, bytes: 8 * GB }, waiting: { files: 5926 }, stoppedBy: 'storage',
    budgets: { bytesLeft: 8 * GB, bytesUsed: 1016 * GB, quota: 1024 * GB }, plan: 'paid', own: true, addon: true },
  trial: { title: 'Google Drive (Takeout)', source: 'zip', zips: 5, folders: 1204, totals: { files: 18402, bytes: 241 * GB, clusters: 1300 },
    fit: { files: 6730 }, waiting: { files: 11672 }, stoppedBy: 'storage', budgets: { bytesLeft: 87.6 * GB }, plan: 'trial', own: true, firstPayment: 'Nov 2' },
  guest: { ...NIGHT, fit: { files: 12 }, waiting: { files: 6181 }, stoppedBy: 'cards', plan: 'free', own: false, ownerName: 'Maya Ortiz', workspaceName: 'Lost Time' },
};

const MB = 1024 ** 2;
const ZIPS = {
  'zip-takeout': { zips: [{ name: 'takeout-20261019T091522Z-001.zip', size: 2.0 * GB }, { name: 'takeout-20261019T091522Z-002.zip', size: 1.9 * GB }], groups: [[0, 1]] },
  'zip-one': { zips: [{ name: 'Lookbook.zip', size: 300 * MB }], groups: [[0]] },
  'zip-many': { zips: ['Casting.zip', 'Locations.zip', 'Wardrobe.zip', 'Storyboards.zip', 'Camera tests.zip', 'Final stills.zip']
    .map((name, i) => ({ name, size: (180 + i * 95) * MB })), groups: [[0], [1], [2], [3], [4], [5]] },
};

// The empty canvas of a cluster the import made (r5-Land-*): its cards in Files,
// and what the import knows about it, as importJob's byBoard would say.
const LAND_PICS = ['/signin-losttime-still1.webp', '/landing/neon-noir-look-book.webp', '/signin-losttime-still2.webp'];
const landCards = (n, { kind = 'image', pending = 0 } = {}) => Array.from({ length: n }, (_, i) => {
  const pic = LAND_PICS[i % LAND_PICS.length];
  const card = { id: `qa-${i}`, kind, unplaced: true, w: 400, h: 300 };
  if (i >= n - pending) return { ...card, pending: true };
  if (kind === 'image') return { ...card, src: pic };
  if (kind === 'video') return { ...card, poster: pic };
  return { ...card, kind: 'file', fileName: `notes-${i}.txt` };
});
const LANDS = {
  night: { cards: landCards(86), from: { path: 'Night Shift › Lookbook', waiting: 0 } },
  wait: { cards: landCards(9, { kind: 'video' }), from: { path: 'Night Shift › Camera tests', waiting: 52 } },
  coming: { cards: landCards(86, { pending: 46 }), from: { path: 'Night Shift › Lookbook', waiting: 0 } },
  plain: { cards: landCards(14, { kind: 'file' }), from: null },
};

function LandQa({ which }) {
  const land = LANDS[which] || LANDS.night;
  useEffect(() => {
    if (!land.from) return undefined;
    putImportJob('qa-land', { phase: 'job', title: 'Night Shift', snap: { status: 'done', byBoard: { 'qa-board': land.from } } });
    return () => dropImportJob('qa-land');
  }, [land]);
  return (
    <div style={{
      position: 'fixed', left: 332, top: 0, right: 0, bottom: 0,
      backgroundImage: 'radial-gradient(rgba(245,245,247,.085) 1px, transparent 1px)', backgroundSize: '24px 24px',
    }}>
      <UnplacedOffer boardId="qa-board" cards={land.cards} canPut
                     onPut={(ids, layout) => console.log('[importqa] put', ids.length, layout)}
                     onChoose={() => console.log('[importqa] choose')} />
    </div>
  );
}

// The Files of "Camera tests" (?row=1), as the sidebar's files card shows it.
function RowQa() {
  return (
    <div className="sbf-card is-files" style={{ position: 'fixed', left: 8, top: 8, bottom: 8, width: 312, display: 'flex', flexDirection: 'column' }}>
      <ImportWaitRow boardId="b-camera" />
      <div style={{ flex: 1 }} />
    </div>
  );
}

// The tray's guide prop, as App builds it (importGuideProps).
const ROOMS = {
  free: { own: true, plan: 'free', cardsLeft: 12, bytesLeft: 3.8 * GB },
  full: { own: true, plan: 'free', cardsLeft: 0, bytesLeft: 2.8 * GB },
  trial: { own: true, plan: 'trial', cardsLeft: null, bytesLeft: 87.6 * GB },
  paid: { own: true, plan: 'paid', cardsLeft: null, bytesLeft: 412 * GB },
  guest: { own: false, plan: 'free', cardsLeft: 12, bytesLeft: 3.8 * GB },
};
const guideProps = () => ({
  target: params.get('target') === '0' ? null : 'Studio',
  room: ROOMS[params.get('plan')] || ROOMS.free,
  canFolder: params.get('phone') !== '1',
  onImport: (input) => {
    const [kind, list] = input.zips ? ['zips', input.zips] : input.pickedFiles ? ['folder', input.pickedFiles]
      : input.entries ? ['entries', input.entries] : ['files', input.files || []];
    console.log('[importqa] guide', kind, list.length);
  },
});

function MenuQa() {
  const ref = useRef(null);
  useEffect(() => {
    // Deferred so StrictMode's throwaway first mount is cleaned up before it clicks.
    const t = setTimeout(() => ref.current?.querySelector('.sbf-upload')?.click(), 50);
    return () => clearTimeout(t);
  }, []);
  const log = (k) => (files) => console.log('[importqa]', k, files.length);
  return (
    <div className="sbf-card is-files" ref={ref} style={{ position: 'fixed', left: 8, bottom: 8, width: 312, height: params.get('short') === '1' ? 140 : 560, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1 }} />
      <SidebarMeter cardsUsed={38} cardLimit={50} storage={{ used: 1.2 * 1024 ** 3, quota: 5 * 1024 ** 3 }}
                    onUpload={log('files')} onUploadFolder={log('folder')} onUploadZips={log('zips')}
                    onOpenGuide={params.get('noguide') === '1' ? null : () => openImportGuide()} />
    </div>
  );
}

export function ImportQaHarness() {
  const state = params.get('state') || 'run';
  const dialog = params.get('dialog');
  const theme = params.get('theme') === 'light' ? 'light' : 'dark';

  useEffect(() => {
    document.body.setAttribute('data-sb-files', '1');
    document.documentElement.setAttribute('data-theme', theme);
    return () => document.body.removeAttribute('data-sb-files');
  }, [theme]);

  const guide = params.get('guide') === '1';
  useEffect(() => {
    if (dialog || params.get('menu') === '1' || params.get('land') || (guide && !params.get('state'))) return undefined;
    putImportJob('qa', { ...fixture(state), act: (id) => console.log('[importqa] act', id) });
    return () => dropImportJob('qa');
  }, [state, dialog, guide]);

  useEffect(() => {
    // Over ?state's import, once the tray has seen it: an import that appears
    // while the guide is open is one the guide started, and closes it.
    const later = guide && params.get('state') ? setTimeout(() => openImportGuide(params.get('app')), 50) : null;
    if (guide && !later) openImportGuide(params.get('app'));
    window.__importQa = { put: putImportJob, drop: dropImportJob, openGuide: openImportGuide };
    document.getElementById('root')?.setAttribute('data-importqa-ready', '1');
    return () => clearTimeout(later);
  }, [guide]);

  return (
    <div className="app sb-files is-floating-chrome" style={{ position: 'fixed', inset: 0, background: 'var(--bg-0, #0b0b0d)' }}>
      <div className="cnv-zoom" style={{ position: 'fixed' }}>
        <button type="button">{'−'}</button>
        <button type="button">100%</button>
        <button type="button">+</button>
      </div>
      {dialog && ZIPS[dialog]
        ? <ImportZipDialog model={zipAskCopy(ZIPS[dialog])} onChoose={(id) => console.log('[importqa] zip', id)} />
        : dialog && DIALOGS[dialog]
        ? <ImportAskDialog model={askCopy(DIALOGS[dialog])} onChoose={(id) => console.log('[importqa] choose', id)} />
        : params.get('menu') === '1'
        ? <><MenuQa /><ImportTray guide={guideProps()} /></>
        : params.get('land')
        ? <LandQa which={params.get('land')} />
        : <>
            {params.get('row') === '1' && <RowQa />}
            <ImportTray aboveNav={params.get('phone') === '1'} initialMinimized={params.get('min') === '1'} guide={guideProps()} />
          </>}
    </div>
  );
}
