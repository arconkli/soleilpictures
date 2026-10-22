import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  CaretDown, X, Pause, Play, Check, Warning, Clock, ArrowSquareOut,
  GoogleDriveLogo, GooglePhotosLogo, DropboxLogo, Cloud, AppleLogo, DotsThreeOutline,
} from '@phosphor-icons/react';
import { Icon } from './Icon.jsx';
import { subscribeImportJobs, importJobsSnapshot, trayEntries, dropImportJob } from '../lib/importJobs.js';
import { trayCopy } from '../lib/importCopy.js';
import {
  GUIDE_APPS, guideApp, guideAppName, guideRoom, subscribeImportGuide, importGuideSnapshot, closeImportGuide, chooseGuideApp,
} from '../lib/importGuide.js';
import { captureDropEntries, captureDropHandles, hasDirectory } from '../lib/folderWalk.js';
import { logEvent } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { useMatchMedia } from '../hooks/useMatchMedia.js';
import { useScreenAwake } from '../hooks/useScreenAwake.js';
import './importTray.css';

// The bulk import's tray (the owner's pick A, 2026-10-19): bottom-right, just
// above the zoom control, showing the import that is going now and folding to
// a corner chip. Every word comes from lib/importCopy.js trayCopy() and every
// button calls the entry's own act(id); this file only draws them. Gold is on
// the paid step (.is-primary) and on focus, nowhere else.

const RING_C = 2 * Math.PI * 6;
const GLYPHS = { clock: Clock, pause: Pause, check: Check, warning: Warning, x: X };

// A rich line is strings and { b } runs: text and <b>, never markup from strings.
function Rich({ parts }) {
  return (parts || []).map((p, i) => (typeof p === 'string' ? p : <b key={i}>{p.b}</b>));
}

// ── The guide (lib/importGuide.js, the owner's pick D, 2026-10-20) ─────────
// How to bring files over from another app, in the tray's own spot: the apps
// as tabs, the chosen one's steps, its link, and pickers for what its
// download is. Dropping on it, or picking, starts the import, and the tray
// shows that instead. A pick is a neutral selection; a file dragged over the
// tray is a drop target, so gold.
const APP_ICONS = {
  drive: GoogleDriveLogo, photos: GooglePhotosLogo, dropbox: DropboxLogo,
  onedrive: Cloud, icloud: AppleLogo, other: DotsThreeOutline,
};
const ZIP_ACCEPT = '.zip,application/zip,application/x-zip-compressed';
const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');

function Guide({ app, guide, aboveNav }) {
  const target = guide?.target || null;
  const canFolder = !!guide?.canFolder && typeof document !== 'undefined' && 'webkitdirectory' in document.createElement('input');
  const m = guideApp(app, { target, canFolder });
  const room = guideRoom(guide?.room || {});
  const tabsRef = useRef(null);
  const zipRef = useRef(null);
  const folderRef = useRef(null);
  const [over, setOver] = useState(false);
  // Enter and leave fire for every child the drag crosses: counted, so the
  // frame stays lit until the drag has left the tray itself.
  const depth = useRef(0);
  // The keyboard starts on the chosen app.
  useEffect(() => { tabsRef.current?.querySelector('[aria-selected="true"]')?.focus(); }, []);

  const send = (input) => { Promise.resolve(guide?.onImport?.(input)).catch(() => {}); };
  const pick = (ref) => { const el = ref.current; if (el) { el.value = ''; el.click(); } };
  const choose = (id) => {
    if (id === app) return;
    chooseGuideApp(id);
    logEvent(EV.IMPORT_JOB, { phase: 'guide_app', source: 'bulk_guide', app: id });
  };
  // Arrows move through the apps in reading order and choose as they go.
  const onTabKey = (e) => {
    const i = GUIDE_APPS.indexOf(app);
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    let next = null;
    if (step) next = GUIDE_APPS[(i + step + GUIDE_APPS.length) % GUIDE_APPS.length];
    else if (e.key === 'Home') next = GUIDE_APPS[0];
    else if (e.key === 'End') next = GUIDE_APPS[GUIDE_APPS.length - 1];
    if (!next) return;
    e.preventDefault();
    choose(next);
    requestAnimationFrame(() => tabsRef.current?.querySelector(`[data-app="${next}"]`)?.focus());
  };
  // Read off the drop while it is being dispatched (Chrome empties it after),
  // the handles too, so an import a reload stops can go on.
  const onDrop = (e) => {
    if (!hasFiles(e) || !guide?.onImport) return;
    e.preventDefault();
    e.stopPropagation();
    depth.current = 0;
    setOver(false);
    const entries = captureDropEntries(e.dataTransfer);
    const handles = captureDropHandles(e.dataTransfer);
    if (hasDirectory(entries)) { send({ entries, handles }); return; }
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) send({ files, handles });
  };

  return (
    <section className={'imptray is-guide' + (aboveNav ? ' is-above-nav' : '') + (over ? ' is-over' : '')}
             aria-labelledby="imptray-guide-title"
             onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); closeImportGuide(); } }}
             onDragEnter={(e) => { if (!hasFiles(e) || !guide?.onImport) return; depth.current += 1; setOver(true); }}
             onDragOver={(e) => { if (!hasFiles(e) || !guide?.onImport) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
             onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); }}
             onDrop={onDrop}>
      <header className="imptray-head">
        <span className="imptray-title" id="imptray-guide-title">Bring files from another app</span>
        <button type="button" className="imptray-ib" aria-label="Close" onClick={closeImportGuide}>
          <Icon as={X} size={13} weight="regular" />
        </button>
      </header>
      <div className="imptray-guide-tabs" role="tablist" aria-label="Apps" ref={tabsRef} onKeyDown={onTabKey}>
        {GUIDE_APPS.map((id) => (
          <button key={id} type="button" role="tab" data-app={id} id={`imptray-guide-tab-${id}`}
                  className="imptray-guide-tab" aria-selected={id === app} aria-controls="imptray-guide-panel"
                  tabIndex={id === app ? 0 : -1} onClick={() => choose(id)}>
            <Icon as={APP_ICONS[id]} size={15} weight="regular" />
            <span>{guideAppName(id)}</span>
          </button>
        ))}
      </div>
      <div className="imptray-guide-body" role="tabpanel" id="imptray-guide-panel" aria-labelledby={`imptray-guide-tab-${m.id}`}>
        <div className="imptray-meta">{m.lede}</div>
        <ol className="imptray-steps">
          {m.steps.map((parts, i) => (
            <li key={i} className="imptray-step"><span className="imptray-step-n" aria-hidden="true">{i + 1}</span><span><Rich parts={parts} /></span></li>
          ))}
        </ol>
        {m.link && (
          <div className="imptray-row-actions">
            <a className="imptray-btn is-sm is-default" href={m.link.href} target="_blank" rel="noopener noreferrer"
               onClick={() => logEvent(EV.IMPORT_JOB, { phase: 'guide_link', source: 'bulk_guide', app: m.id })}>
              {m.link.label}<Icon as={ArrowSquareOut} size={12} weight="regular" />
            </a>
          </div>
        )}
        {m.notes.length > 0 && (
          <div className="imptray-notes">
            {m.notes.map((parts, i) => <div key={i} className="imptray-note"><Rich parts={parts} /></div>)}
          </div>
        )}
      </div>
      <footer className="imptray-foot">
        {m.picks.map((p) => (
          <button key={p.kind} type="button" className="imptray-btn is-sm" onClick={() => pick(p.kind === 'folder' ? folderRef : zipRef)}>{p.label}</button>
        ))}
        {room && <div className="imptray-meta imptray-guide-room"><Rich parts={room} /></div>}
        <input ref={zipRef} type="file" multiple hidden accept={ZIP_ACCEPT} data-guide-pick="zips"
               onChange={(e) => { const zips = [...(e.target.files || [])]; if (zips.length) send({ zips }); }} />
        {canFolder && (
          <input ref={(el) => { folderRef.current = el; if (el) el.setAttribute('webkitdirectory', ''); }} type="file" multiple hidden data-guide-pick="folder"
                 onChange={(e) => { const files = [...(e.target.files || [])]; if (files.length) send({ pickedFiles: files }); }} />
        )}
      </footer>
    </section>
  );
}

function Chip({ m, onOpen, aboveNav, besideMessages }) {
  const { chip } = m;
  const dash = chip.pct === null ? RING_C / 4 : (RING_C * chip.pct) / 100;
  const Glyph = GLYPHS[chip.icon];
  return (
    <button type="button" className={'imptray-chip' + (aboveNav ? ' is-above-nav' : '') + (besideMessages ? ' is-beside-msg' : '')}
            aria-label={chip.label} title={chip.label} onClick={onOpen}>
      {chip.kind === 'ring' ? (
        <svg className={chip.pct === null ? 'is-spin' : undefined} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={{ display: 'block' }}>
          <circle className="imptray-ring-track" cx="8" cy="8" r="6" fill="none" strokeWidth="2" />
          <circle className="imptray-ring-arc" cx="8" cy="8" r="6" fill="none" strokeWidth="2" strokeLinecap="round"
                  strokeDasharray={`${dash} ${RING_C}`} transform="rotate(-90 8 8)" />
        </svg>
      ) : Glyph ? <Icon as={Glyph} size={14} weight="regular" /> : null}
      <span>{chip.text}</span>
    </button>
  );
}

// Still moving files: read, made into clusters, or sent. Not paused, not
// waiting for room, not finished.
const GOING = new Set(['idle', 'creating', 'running']);
const isGoing = (e) => e.phase === 'reading' || (e.phase === 'job' && GOING.has(e.snap?.status || 'idle'));

// guide: { target, room, canFolder, onImport(input) } from App — the cluster a
// drop goes into, the room line's numbers, and how the guide's drops and
// picks start an import. besideMessages: the Messages card is open at the
// right edge, so the tray folds to its chip and both sit left of the card.
export function ImportTray({ aboveNav = false, initialMinimized = false, guide = null, besideMessages = false }) {
  const { list } = useSyncExternalStore(subscribeImportJobs, importJobsSnapshot, importJobsSnapshot);
  const g = useSyncExternalStore(subscribeImportGuide, importGuideSnapshot, importGuideSnapshot);
  const { lead, more } = trayEntries(list);
  const [minimized, setMinimized] = useState(initialMinimized);
  // A phone or a tablet that locks itself stops the import: while files are
  // moving it stays awake, and the words ask for the tab to stay in front.
  const touch = useMatchMedia('(hover: none) and (pointer: coarse)');
  useScreenAwake(touch && list.some(isGoing));
  // Messages opening is where the attention went: out of its way, still live.
  useEffect(() => { if (besideMessages) setMinimized(true); }, [besideMessages]);
  const leadKey = lead?.key;
  // A new import opens expanded, whatever the last one was folded to.
  // (Not for the first import to show: initialMinimized is its own choice.)
  const seenKey = useRef(leadKey);
  useEffect(() => {
    const prev = seenKey.current;
    seenKey.current = leadKey;
    if (prev && leadKey && prev !== leadKey) setMinimized(false);
  }, [leadKey]);
  // An import that starts while the guide is open is what the guide was for:
  // the tray shows it instead, even while an earlier one still leads. (Not
  // one a reload stopped, offered again on load: nobody started that here.)
  const seenKeys = useRef(new Set(list.map((e) => e.key)));
  useEffect(() => {
    let fresh = false;
    for (const e of list) {
      if (seenKeys.current.has(e.key)) continue;
      seenKeys.current.add(e.key);
      if (e.phase !== 'stopped') fresh = true;
    }
    if (fresh) closeImportGuide();
  }, [list]);
  useEffect(() => {
    if (g.open) logEvent(EV.IMPORT_JOB, { phase: 'guide_open', source: 'bulk_guide', app: importGuideSnapshot().app });
  }, [g.open]);
  if (g.open) return <Guide app={g.app} guide={guide} aboveNav={aboveNav} />;
  if (!lead) return null;

  const m = trayCopy(lead, { touch });
  const act = (id) => lead.act?.(id);
  if (minimized) return <Chip m={m} aboveNav={aboveNav} besideMessages={besideMessages} onOpen={() => setMinimized(false)} />;

  const fin = m.finished;
  return (
    <section className={'imptray' + (aboveNav ? ' is-above-nav' : '') + (besideMessages ? ' is-beside-msg' : '')} aria-label="Imports">
      <header className="imptray-head">
        <span className="imptray-title"><span aria-live="polite">{m.title}</span></span>
        {m.close === 'close' ? (
          <button type="button" className="imptray-ib" aria-label="Close" onClick={() => { act('close'); dropImportJob(lead.key); }}>
            <Icon as={X} size={13} weight="regular" />
          </button>
        ) : (
          <button type="button" className="imptray-ib" aria-label="Minimize" onClick={() => setMinimized(true)}>
            <Icon as={CaretDown} size={14} weight="regular" />
          </button>
        )}
      </header>

      <div className="imptray-sum">
        <div className="imptray-line"><Rich parts={m.line} /></div>
        {m.bar && (
          <div className={'imptray-bar' + (m.bar.reading ? ' is-reading' : '')} aria-hidden="true">
            <span style={m.bar.reading ? undefined : { width: `${m.bar.pct}%` }} />
          </div>
        )}
        {m.meta && <div className="imptray-meta">{m.meta}</div>}
        {fin && (
          <div className="imptray-row-actions">
            {fin.resume && (
              <button type="button" className="imptray-btn is-sm" onClick={() => act('resume')}>
                <Icon as={Play} size={13} weight="regular" />Resume
              </button>
            )}
            {fin.open && <button type="button" className="imptray-btn is-sm" onClick={() => act('open')}>{fin.open.label}</button>}
            {fin.remove && <button type="button" className="imptray-btn is-sm is-quiet" onClick={() => act('remove')}>Remove this import</button>}
          </div>
        )}
      </div>

      {m.rows.length > 0 && (
        <div className="imptray-list">
          {m.rows.map((r) => (
            <div key={r.key} className={'imptray-row' + (r.state === 'now' ? ' is-now' : r.state === 'later' ? ' is-later' : r.state === 'part' ? ' is-part' : '')}>
              <span className="ok">{r.state === 'done' && <Icon as={Check} size={12} weight="regular" />}</span>
              <span className="n">{r.name}</span>
              {r.state === 'now' && <span className="imptray-minibar" aria-hidden="true"><span style={{ width: `${r.pct}%` }} /></span>}
              <span className="c">{r.count}</span>
            </div>
          ))}
        </div>
      )}

      {m.wait && (
        <div className="imptray-wait">
          <div className="imptray-wait-text"><Rich parts={m.wait.text} /></div>
          {(m.wait.action || m.wait.aside) && (
            <div className="imptray-row-actions">
              {m.wait.action && (
                <button type="button" className="imptray-btn is-primary is-sm" onClick={() => act(m.wait.action.id)}>{m.wait.action.label}</button>
              )}
              {m.wait.aside && <span className="imptray-meta">{m.wait.aside}</span>}
            </div>
          )}
        </div>
      )}

      {m.fails && (
        <div className="imptray-fails">
          <div className="imptray-fails-head"><Icon as={Warning} size={14} weight="regular" />{m.fails.head}</div>
          {m.fails.list.map((f, i) => (
            <div key={i} className="imptray-fail"><span className="p" title={f.path}>{f.path}</span><span className="w">{f.why}</span></div>
          ))}
          {m.fails.more && <div className="imptray-meta">{m.fails.more}</div>}
          {m.fails.retry && (
            <div className="imptray-row-actions" style={{ marginTop: 6 }}>
              <button type="button" className="imptray-btn is-sm" onClick={() => act('retry')}>Try these again</button>
            </div>
          )}
        </div>
      )}

      {(m.foot || more > 0) && (
        <footer className="imptray-foot">
          {m.foot?.meta && <span className="imptray-meta">{m.foot.meta}</span>}
          {more > 0 && <span className="imptray-meta">{`${more} more ${more === 1 ? 'import' : 'imports'} after this`}</span>}
          <span className="imptray-gap" />
          {(m.foot?.actions || []).map((a) => (
            <button key={a.id} type="button" className="imptray-btn is-sm is-quiet" onClick={() => act(a.id)}>
              {a.icon === 'pause' && <Icon as={Pause} size={13} weight="regular" />}
              {a.icon === 'play' && <Icon as={Play} size={13} weight="regular" />}
              {a.label}
            </button>
          ))}
        </footer>
      )}
    </section>
  );
}
