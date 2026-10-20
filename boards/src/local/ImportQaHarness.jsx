import { useEffect } from 'react';
import '../components/sidebar/clusterSidebar.css';
import { ImportTray } from '../components/ImportTray.jsx';
import { ImportAskDialog } from '../components/ImportAskDialog.jsx';
import { putImportJob, dropImportJob } from '../lib/importJobs.js';
import { askCopy } from '../lib/importCopy.js';

// Dev-only bulk-import QA page (?importqa=1), no backend. Renders the tray, its
// chip and the ask dialog from fixtures shaped like lib/importCopy.test.mjs.
//   ?state=reading|creating|run|paused|wait-free|wait-storage-paid|wait-trial|
//          wait-guest|done|done-fails|cancelled|failed   (default run)
//   ?min=1 starts folded to the chip   ?phone=1 lifts it over the phone nav
//   ?theme=light|dark   ?dialog=free|creator|trial|guest
// Imported only behind main.jsx's `import.meta.env.DEV &&` guard.

const GB = 1024 ** 3;
const params = new URLSearchParams(window.location.search);

const ROWS = [
  ['Night Shift', 3, 3], ['Camera tests', 61, 61], ['Casting', 752, 752], ['Locations', 395, 395], ['Lookbook', 86, 86],
  ['Script', 14, 14], ['Stills', 535, 4518], ['Storyboards', 0, 128], ['Wardrobe', 0, 236],
].map(([name, landed, files]) => ({ key: name === 'Night Shift' ? name : `Night Shift/${name}`, name, files, landed }));

const snap = (over = {}) => ({
  status: 'running', totals: { files: 6193, bytes: 26.4 * GB, clusters: 17 }, landed: { files: 1846, bytes: 13 * GB },
  sentBytes: 13.2 * GB, waiting: { files: 0 }, failed: [], etaMs: 70 * 60000, currentRow: 'Night Shift/Stills',
  tops: [{ key: 'Night Shift', name: 'Night Shift', files: 6193, landed: 1846, boardId: 'b-night' }],
  rows: ROWS,
  ...over,
});

const FAILS = [
  { relPath: 'Casting/Callbacks/take-14.mov', message: 'The file was modified during upload' },
  { relPath: 'Stills/DSC_4410.jpg', message: 'NotReadableError: could not be read' },
  { relPath: 'Stills/DSC_4411.jpg', message: 'boom' },
];

function fixture(state) {
  const job = { phase: 'job', title: 'Night Shift', targetName: 'Studio' };
  const wait = (more, extra) => ({ ...job, ...extra, snap: snap({ status: 'waiting', landed: { files: 12 }, waiting: { files: 6181 }, ...more }) });
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

export function ImportQaHarness() {
  const state = params.get('state') || 'run';
  const dialog = params.get('dialog');
  const theme = params.get('theme') === 'light' ? 'light' : 'dark';

  useEffect(() => {
    document.body.setAttribute('data-sb-files', '1');
    document.documentElement.setAttribute('data-theme', theme);
    return () => document.body.removeAttribute('data-sb-files');
  }, [theme]);

  useEffect(() => {
    if (dialog) return undefined;
    putImportJob('qa', { ...fixture(state), act: (id) => console.log('[importqa] act', id) });
    return () => dropImportJob('qa');
  }, [state, dialog]);

  useEffect(() => {
    document.getElementById('root')?.setAttribute('data-importqa-ready', '1');
  }, []);

  return (
    <div className="app sb-files is-floating-chrome" style={{ position: 'fixed', inset: 0, background: 'var(--bg-0, #0b0b0d)' }}>
      <div className="cnv-zoom" style={{ position: 'fixed' }}>
        <button type="button">{'−'}</button>
        <button type="button">100%</button>
        <button type="button">+</button>
      </div>
      {dialog && DIALOGS[dialog]
        ? <ImportAskDialog model={askCopy(DIALOGS[dialog])} onChoose={(id) => console.log('[importqa] choose', id)} />
        : <ImportTray aboveNav={params.get('phone') === '1'} initialMinimized={params.get('min') === '1'} />}
    </div>
  );
}
