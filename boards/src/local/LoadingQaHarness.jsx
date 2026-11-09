import { useEffect, useRef } from 'react';
// The cmdk-empty and sidebar note styles live in the app stylesheet and the sidebar sheet.
import '../components/sidebar/clusterSidebar.css';
import { LoadingScreen } from '../components/LoadingScreen.jsx';
import { BoardOpening } from '../components/BoardOpening.jsx';
import { PanelWait } from '../components/PanelWait.jsx';
import { LoadFailed } from '../components/LoadFailed.jsx';
import { CardCouldntLoad } from '../components/cards/CardCouldntLoad.jsx';
import { Icon } from '../components/Icon.jsx';
import { ArrowClockwise } from '../lib/icons.js';
import { WaitNote } from '../components/WaitNote.jsx';
import { ImportTray } from '../components/ImportTray.jsx';
import { putImportJob } from '../lib/importJobs.js';
import '../components/composerUploadMeter.css';
import { setCanvasScale } from '../lib/canvasScale.js';

// Dev-only loading-screens QA page (?loadqa=<state>), no backend. Renders the
// loading / failed-list / failed-picture surfaces by themselves.
//   ?theme=light|dark (default dark)
//   &loadqa=boot-8|boot-15|switch|switch-15|cluster|cluster-offline|panel|sidebar|palette|cards
//        |quicklook-slow|pdf-slow|composer-uploading|import-offline
// Sets html[data-loadqa-ready="1"] once drawn.
// Imported only behind main.jsx's `import.meta.env.DEV &&` guard.

const QS = new URLSearchParams(window.location.search);
const STATE = QS.get('loadqa') || 'boot-8';
const LIGHT = QS.get('theme') === 'light';

const noop = () => {};
// R2Image sits in a card that fills it; the harness card is a plain box.
const FILL = { width: '100%', height: '100%' };

function Padlock() {
  return (
    <div className="r2-img r2-img-blocked" aria-label="No access">
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <rect x="5" y="9" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 9 V6 a3 3 0 0 1 6 0 V9" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

// A picture card laid out at its logical size, shown at the canvas zoom.
function CanvasCard({ w, h, label, children }) {
  return (
    <div style={{ width: w * 0.37, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ width: w * 0.37, height: h * 0.37, position: 'relative' }}>
        <div className="card" style={{ position: 'absolute', left: 0, top: 0, width: w, height: h, transform: 'scale(0.37)', transformOrigin: '0 0', borderRadius: 10, overflow: 'hidden' }}>
          {children}
        </div>
      </div>
      <div style={{ font: '500 10px var(--font-sans)', color: 'var(--ink-2)', width: 160 }}>{label}</div>
    </div>
  );
}

const PHOTO = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fa7b8"/><stop offset=".4" stop-color="#b9c6cc"/><stop offset=".41" stop-color="#5f6f5a"/><stop offset="1" stop-color="#3d4a3a"/></linearGradient></defs><rect width="400" height="300" fill="url(#g)"/></svg>')}`;

function Cards() {
  const a = useRef(null);
  const b = useRef(null);
  useEffect(() => { setCanvasScale(0.37); }, []);
  return (
    <div style={{ display: 'flex', gap: 24, padding: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <CanvasCard w={520} h={360} label="CardCouldntLoad, full"><CardCouldntLoad rootRef={a} onRetry={noop} style={FILL} /></CanvasCard>
      <CanvasCard w={120} h={80} label="Icon tier"><CardCouldntLoad rootRef={b} onRetry={noop} style={FILL} /></CanvasCard>
      <CanvasCard w={520} h={360} label="The padlock (no access)"><Padlock /></CanvasCard>
      <CanvasCard w={520} h={360} label="A loaded picture"><img src={PHOTO} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /></CanvasCard>
    </div>
  );
}

const GB = 1024 ** 3;
function ImportOffline() {
  useEffect(() => {
    putImportJob('qa-offline', {
      phase: 'job', title: 'Night Shift', targetName: 'Studio',
      snap: {
        status: 'running', totals: { files: 6193, bytes: 26.4 * GB, clusters: 17 }, landed: { files: 1846, bytes: 13 * GB },
        sentBytes: 13.2 * GB, waiting: { files: 0 }, failed: [], etaMs: 70 * 60000, currentRow: 'Night Shift/Stills',
        tops: [{ key: 'Night Shift', name: 'Night Shift', files: 6193, landed: 1846, boardId: 'b-night' }], rows: [], byBoard: {},
      },
      act: noop,
    });
  }, []);
  return <ImportTray />;
}

function Body() {
  switch (STATE) {
    case 'boot-8': return <LoadingScreen dark={!LIGHT}force={1} />;
    case 'boot-15': return <LoadingScreen dark={!LIGHT}force={2} />;
    case 'switch': return <LoadingScreen dark={!LIGHT}name="Sundown Films" />;
    case 'switch-15': return <LoadingScreen dark={!LIGHT}name="Sundown Films" force={2} />;
    case 'cluster':
    case 'cluster-offline':
      return (
        <div style={{ position: 'fixed', inset: 0, background: 'var(--bg-1)' }}>
          <BoardOpening name="Halcyon" backLabel="Go back" onBack={noop} force={1} />
        </div>
      );
    case 'panel': return <PanelWait title="Settings" variant="modal" onClose={noop} />;
    case 'sidebar':
      return (
        <div style={{ width: 280, padding: '12px 0', background: 'var(--bg-2)', borderRight: '1px solid var(--line-2)', minHeight: 200 }}>
          <div className="sbf-note is-error" role="alert" style={{ paddingLeft: 14 }}>
            <span>Couldn’t load your files</span>
            <button type="button" className="sbf-more-btn" onClick={noop}>
              <Icon as={ArrowClockwise} size={13} weight="regular" /> Retry
            </button>
          </div>
        </div>
      );
    case 'palette':
      return (
        <div className="cmdk-list" style={{ width: 560, background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 12, margin: 24 }}>
          <LoadFailed className="cmdk-empty" what="search results" onRetry={noop} />
        </div>
      );
    case 'cards': return <Cards />;
    case 'quicklook-slow':
      return (
        <div style={{ position: 'fixed', inset: 0, background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <WaitNote label="Opening Halcyon_treatment.mov…" slowAfterMs={1} onRetry={noop} />
        </div>
      );
    case 'pdf-slow':
      return (
        <div className="pdfv pdfv-loading">
          <WaitNote label="Opening Halcyon_treatment.pdf…" spinnerLabel="Loading PDF" slowAfterMs={1} onClose={noop} />
        </div>
      );
    case 'composer-uploading':
      return (
        <div style={{ width: 420, margin: 24 }}>
          <div className="msg-composer-attachments">
            <div className="msg-composer-att-chip is-uploading" title="Lookbook.pdf">
              <span className="msg-composer-att-name">Lookbook.pdf</span>
              <span className="msg-composer-att-size">8.0 MB</span>
              <span className="msg-composer-att-state" role="status">Uploading · 42%</span>
              <span className="msg-composer-att-meter" aria-hidden="true"><span style={{ width: '42%' }} /></span>
            </div>
          </div>
        </div>
      );
    case 'import-offline': return <ImportOffline />;
    default: return <div style={{ padding: 24, color: 'var(--ink-1)' }}>Unknown loadqa state: {STATE}</div>;
  }
}

export function LoadingQaHarness() {
  useEffect(() => {
    document.documentElement.dataset.theme = LIGHT ? 'light' : 'dark';
    if (STATE === 'cluster-offline' || STATE === 'import-offline') {
      try { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }); } catch (_) { /* */ }
      window.dispatchEvent(new Event('offline'));
    }
    const t = setTimeout(() => { document.documentElement.dataset.loadqaReady = '1'; }, 150);
    return () => clearTimeout(t);
  }, []);
  return <div style={{ minHeight: '100vh', background: 'var(--bg-1)', color: 'var(--ink-1)' }}><Body /></div>;
}
