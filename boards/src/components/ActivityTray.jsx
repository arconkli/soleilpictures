import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from './Icon.jsx';
import { Thumb } from './activityThumb.jsx';
import {
  X, Check, ChevronDown, ChevronRight, ChevronUp,
  Warning, WifiSlash, ArrowsClockwise, ArrowClockwise, Clock, Pause, Play, DownloadSimple, Copy, CheckCircle,
} from '../lib/icons.js';
import { Rich, Ring } from './ImportTray.jsx';
import { ActivityTrayContext } from './activityTrayContext.js';
import { useActivity } from '../hooks/useActivity.js';
import { useOnline } from '../hooks/useOnline.js';
import { useMatchMedia } from '../hooks/useMatchMedia.js';
import {
  dismissBatch, pauseBatch, resumeBatch, cancelTransfer, removeTransfer, noteTrayMounted,
} from '../lib/activity.js';
import { subscribeHeld, heldSnapshot } from '../lib/heldUploads.js';
import { subscribeImportJobs, importJobsSnapshot, trayEntries } from '../lib/importJobs.js';
import { trayCopy } from '../lib/importCopy.js';
import { subscribeImportGuide, importGuideSnapshot } from '../lib/importGuide.js';
import { trayModel } from '../lib/activityTray.js';
import './importTray.css';
import './activityTray.css';

export { ActivityTrayContext };

// The activity tray: everything this tab is moving, held or waiting on, in one
// corner (the owner's pick, mockup a-tray). lib/activityTray.js decides what
// shows and every word; this file draws it. Uploads and the connection are
// drawn here; held files (HeldUploadsBar) and imports (ImportTray) are the
// children, which read ActivityTrayContext and draw their own panels in the
// column, or nothing while it is folded. They are always rendered, so their
// hooks (the import's screen lock, its guide) keep running while folded.
//
// Desktop: a column of panels above the zoom control, folding to one chip.
// Phone: a slim bar above the bottom nav, opening to a sheet.
// Neutral ink throughout: gold only on focus rings and the import's paid step.

const GLYPHS = {
  pause: Pause, check: Check, warning: Warning, offline: WifiSlash, reconnecting: ArrowsClockwise, clock: Clock, x: X,
};
// An op's chip glyphs: a download and a copy have their icon, an export (no
// progress to draw) a neutral spinner, a finished one a check.
const OP_GLYPHS = { download: DownloadSimple, copy: Copy, check: CheckCircle };
const CONN_ICONS = { offline: WifiSlash, warning: Warning, reconnecting: ArrowsClockwise, check: Check };

function Minibar({ pct }) {
  return <span className="imptray-minibar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>;
}

function DoneFold({ r, touch }) {
  const [open, setOpen] = useState(false);
  const t = touch ? ' is-touch' : '';
  return (
    <>
      <button type="button" className={'atr-row is-done atr-row-btn' + t} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="atr-th is-kind is-ok" aria-hidden="true"><Icon as={Check} size={12} weight="regular" /></span>
        <span className="n">{r.c}</span>
        <span className="atr-caret" aria-hidden="true"><Icon as={open ? ChevronDown : ChevronRight} size={12} weight="regular" /></span>
      </button>
      {open && r.done.map((d) => (
        <div key={d.key} className={'atr-row is-done' + t}>
          <span className="atr-th is-kind is-ok" aria-hidden="true"><Icon as={Check} size={12} weight="regular" /></span>
          <span className="n" dir="auto">{d.name}</span>
        </div>
      ))}
    </>
  );
}

// One file of a batch, or of the offline list. `gap`: some row in the list has
// a button, so the ones without keep the column straight.
function Row({ r, item, touch, gap }) {
  const t = touch ? ' is-touch' : '';
  if (r.state === 'done-fold') return <DoneFold r={r} touch={touch} />;
  if (r.state === 'more') return <div className={'atr-row is-later' + t}><span className="n">{r.c}</span></div>;
  const press = () => {
    const id = r.button?.id;
    if (id === 'cancel') cancelTransfer(r.tid);
    else if (id === 'remove') item?.actions?.remove?.();
    else if (id === 'dismiss-row') removeTransfer(r.tid);
  };
  const button = r.button ? (
    <button type="button" className="imptray-ib atr-ib" aria-label={`${r.button.label}: ${r.name}`} title={r.button.label} onClick={press}>
      <Icon as={X} size={12} weight="regular" />
    </button>
  ) : gap ? <span className="atr-ib-gap" /> : null;
  if (r.state === 'fail') {
    return (
      <div className={'atr-row is-fail' + t}>
        <Thumb thumb={r.thumb} mime={r.mime} name={r.name} dim />
        <span className="atr-two"><span className="n" dir="auto" title={r.name}>{r.name}</span><span className="w">{r.why}</span></span>
        {r.retry && (
          <button type="button" className="imptray-btn is-sm atr-retry" aria-label={`Retry ${r.name}`} onClick={() => item?.actions?.retry?.()}>
            <Icon as={ArrowClockwise} size={12} weight="regular" />Retry
          </button>
        )}
        {button}
      </div>
    );
  }
  const cls = r.state === 'now' ? ' is-now' : r.state === 'later' ? ' is-later' : '';
  return (
    <div className={'atr-row' + cls + t}>
      <Thumb thumb={r.thumb} mime={r.mime} name={r.name} dim={r.state === 'later'} />
      <span className="n" dir="auto" title={r.name}>{r.name}</span>
      {r.pct != null && <Minibar pct={r.pct} />}
      <span className="c">{r.c}</span>
      {button}
    </div>
  );
}

function Rows({ rows, byId, touch }) {
  if (!rows?.length) return null;
  const gap = rows.some((r) => r.button || r.state === 'fail');
  return (
    <div className="imptray-list atr-list">
      {rows.map((r) => <Row key={r.key} r={r} item={r.tid ? byId.get(r.tid) : null} touch={touch} gap={gap} />)}
    </div>
  );
}

function FoldButton({ onFold }) {
  return (
    <button type="button" className="imptray-ib" aria-label="Fold" onClick={onFold}>
      <Icon as={ChevronDown} size={14} weight="regular" />
    </button>
  );
}

// The batch line, cut into segments at each " · ": a segment never breaks
// mid-phrase, the line wraps between segments.
function Segments({ parts }) {
  const segs = [];
  for (const p of parts || []) {
    if (typeof p === 'string' && p.startsWith(' · ')) segs.push([p.slice(1)]);
    else if (segs.length) segs[segs.length - 1].push(p);
    else segs.push([p]);
  }
  return segs.map((seg, i) => (
    <span key={i}>{i > 0 ? ' ' : null}<span className="atr-seg"><Rich parts={seg} /></span></span>
  ));
}

function BatchPanel({ s, byId, touch, onFold }) {
  const head = s.headAction;
  return (
    <section className="imptray atr is-static" tabIndex={-1} aria-label={s.title}>
      <header className="imptray-head">
        <span className="imptray-title">{s.title}</span>
        {head && (
          <button type="button" className="imptray-btn is-sm is-quiet"
                  onClick={() => (head.id === 'pause' ? pauseBatch(s.batchId) : resumeBatch(s.batchId))}>
            <Icon as={head.id === 'pause' ? Pause : Play} size={13} weight="regular" />{head.label}
          </button>
        )}
        {s.close === 'dismiss' ? (
          <button type="button" className="imptray-ib" aria-label="Dismiss" onClick={() => dismissBatch(s.batchId)}>
            <Icon as={X} size={13} weight="regular" />
          </button>
        ) : <FoldButton onFold={onFold} />}
      </header>
      <div className="imptray-sum">
        <div className="imptray-line"><Segments parts={s.line} /></div>
        {/* Nothing uploaded: no bar (a full grey one reads as progress). */}
        {!(s.finished && s.counts.done === 0) && <div className="imptray-bar" aria-hidden="true"><span style={{ width: `${s.pct}%` }} /></div>}
      </div>
      <Rows rows={s.rows} byId={byId} touch={touch} />
    </section>
  );
}

// A download, export or copy: a compact panel (head only, like Reconnecting)
// with a meter when the progress is known.
function OpPanel({ s, onFold }) {
  const Glyph = s.icon === 'export' ? null : OP_GLYPHS[s.icon];
  return (
    <section className="imptray atr atr-op is-static" tabIndex={-1} aria-label={s.title}>
      <header className="imptray-head">
        <span className="atr-hic" aria-hidden="true">{Glyph ? <Icon as={Glyph} size={15} weight="regular" /> : <Ring pct={null} />}</span>
        <span className="imptray-title atr-op-t" title={s.title}>{s.title}</span>
        {s.headAction && (
          <button type="button" className="imptray-btn is-sm is-quiet" aria-label={s.headAction.aria} onClick={() => s.headAction.run()}>
            {s.headAction.label}
          </button>
        )}
        {s.open && (
          <button type="button" className="imptray-btn is-sm is-quiet" aria-label={s.open.aria} onClick={() => s.open.run()}>
            {s.open.label}
          </button>
        )}
        {s.close === 'dismiss' ? (
          <button type="button" className="imptray-ib" aria-label={s.dismissAria} onClick={() => dismissBatch(s.batchId)}>
            <Icon as={X} size={13} weight="regular" />
          </button>
        ) : <FoldButton onFold={onFold} />}
      </header>
      {s.pct != null && !s.finished && (
        <div className="imptray-sum atr-op-sum"><div className="imptray-bar" aria-hidden="true"><span style={{ width: `${s.pct}%` }} /></div></div>
      )}
    </section>
  );
}

function ConnPanel({ s, byId, touch, onFold, retryConnection }) {
  const ConnIcon = CONN_ICONS[s.icon] || Warning;
  return (
    <section className="imptray atr is-static" tabIndex={-1} aria-label={s.title}>
      <header className="imptray-head">
        <span className={'atr-hic' + (s.tone === 'err' ? ' is-err' : '')} aria-hidden="true"><Icon as={ConnIcon} size={15} weight="regular" /></span>
        <span className="imptray-title">{s.title}</span>
        <FoldButton onFold={onFold} />
      </header>
      {(s.line || s.meta) && (
        <div className="imptray-sum">
          {s.line && <div className="imptray-line"><Rich parts={s.line} /></div>}
          {s.meta && <div className="imptray-meta">{s.meta}</div>}
        </div>
      )}
      <Rows rows={s.rows} byId={byId} touch={touch} />
      {s.headAction && retryConnection && (
        <footer className="imptray-foot">
          <span className="imptray-gap" />
          <button type="button" className="imptray-btn is-sm is-default" onClick={() => retryConnection()}>{s.headAction.label}</button>
        </footer>
      )}
    </section>
  );
}

function ChipGlyph({ chip }) {
  if (chip.icon === 'ring') return <Ring pct={chip.pct ?? null} />;
  if (chip.icon === 'export') return <Ring pct={null} />;
  const G = GLYPHS[chip.icon] || OP_GLYPHS[chip.icon];
  if (!G) return null;
  return (
    <span className={'atr-glyph' + (chip.tone === 'err' ? ' is-err' : '') + (chip.icon === 'reconnecting' ? ' is-turn' : '')} aria-hidden="true">
      <Icon as={G} size={14} weight="regular" />
    </span>
  );
}

// The folded tray on a computer: one chip for the lead section. A chip with an
// action (Couldn't save · Retry) is two buttons in one pill.
function Chip({ chip, onOpen, onAction, chipRef }) {
  const quiet = chip.tone === 'quiet' ? ' is-quiet' : '';
  const body = (
    <>
      <ChipGlyph chip={chip} />
      <span className="atr-chip-t"><Rich parts={chip.parts} /></span>
      {chip.chevron && <span className="atr-chev" aria-hidden="true"><Icon as={ChevronUp} size={12} weight="regular" /></span>}
    </>
  );
  if (chip.action) {
    return (
      <div className={'imptray-chip atr-chip is-group' + quiet} role="group" aria-label={chip.label}>
        <button type="button" ref={chipRef} className="atr-chip-main" aria-label={chip.label} aria-expanded={chip.chevron ? false : undefined} onClick={chip.chevron ? onOpen : undefined}>{body}</button>
        <button type="button" className="atr-chip-act" onClick={onAction}>{chip.action.label}</button>
      </div>
    );
  }
  return (
    <button type="button" ref={chipRef} className={'imptray-chip atr-chip' + quiet} aria-label={chip.label} title={chip.label}
            aria-expanded={chip.chevron ? false : undefined}
            onClick={chip.chevron ? onOpen : undefined} aria-disabled={chip.chevron ? undefined : true}>
      {body}
    </button>
  );
}

// The folded tray on a phone: a slim bar above the bottom nav, with a 2px line
// for the progress (so a ring would say it twice).
function Slim({ chip, onOpen, onAction, chipRef }) {
  const showGlyph = !(chip.icon === 'ring' && chip.pct != null);
  return (
    <div className={'atr-slim' + (chip.tone === 'quiet' ? ' is-quiet' : '')}>
      <button type="button" ref={chipRef} className="atr-slim-main" aria-label={chip.label} aria-expanded={chip.chevron ? false : undefined} onClick={chip.chevron ? onOpen : undefined}>
        {showGlyph && <ChipGlyph chip={chip} />}
        <span className="atr-slim-t"><Rich parts={chip.parts} /></span>
      </button>
      {chip.action && <button type="button" className="atr-chip-act atr-slim-act" onClick={onAction}>{chip.action.label}</button>}
      {chip.chevron && (
        <button type="button" className="imptray-ib atr-slim-ib" aria-label="Open" aria-expanded={false} onClick={onOpen} tabIndex={-1}>
          <Icon as={ChevronUp} size={14} weight="regular" />
        </button>
      )}
      {chip.icon === 'ring' && chip.pct != null && <span className="atr-slim-line" aria-hidden="true"><i style={{ width: `${chip.pct}%` }} /></span>}
    </div>
  );
}

const FOLD_DRAG_PX = 60;

export function ActivityTray({ phone = false, besideMessages = false, conn = null, retryConnection = null, children }) {
  const activity = useActivity();
  const held = useSyncExternalStore(subscribeHeld, heldSnapshot, heldSnapshot);
  const { list: imports } = useSyncExternalStore(subscribeImportJobs, importJobsSnapshot, importJobsSnapshot);
  const guide = useSyncExternalStore(subscribeImportGuide, importGuideSnapshot, importGuideSnapshot);
  const online = useOnline();
  // Downloads, exports and copies only go to a tray that is there to draw them.
  useEffect(() => noteTrayMounted(), []);
  const touch = useMatchMedia('(hover: none) and (pointer: coarse)');
  const [, rerender] = useReducer((n) => n + 1, 0);

  // When this tab went offline (the browser says so, or the room does): a
  // blip under OFFLINE_AFTER_MS shows nothing.
  const offlineNow = !online || conn?.state === 'offline';
  const [offlineSince, setOfflineSince] = useState(null);
  useEffect(() => { setOfflineSince(offlineNow ? Date.now() : null); }, [offlineNow]);

  const importLead = useMemo(() => {
    const { lead } = trayEntries(imports);
    return lead ? { key: lead.key, phase: lead.phase, chip: trayCopy(lead, { touch, online }).chip } : null;
  }, [imports, touch, online]);

  const now = Date.now();
  const model = trayModel({
    activity, held, importLead, guideOpen: !!guide.open, conn,
    offlineForMs: offlineNow ? (offlineSince == null ? 0 : now - offlineSince) : null,
    canRetryConnection: !!retryConnection, now,
  });

  // A rule that flips with the clock (a batch past its first second, an
  // offline spell past its grace) re-renders at that moment.
  useEffect(() => {
    if (model.wakeAt == null) return undefined;
    const t = setTimeout(rerender, Math.max(0, model.wakeAt - Date.now()) + 20);
    return () => clearTimeout(t);
  }, [model.wakeAt]);

  const panels = model.sections.filter((s) => !s.chipOnly);
  const [open, setOpen] = useState(false);

  // A section showing for the first time opens the tray on a computer, when it
  // asks to (a single file stays a chip). A connection section counts as new
  // each time its kind changes (offline, then Couldn't save).
  const seen = useRef(null);
  const sectionKeys = model.sections.map((s) => (s.kind === 'conn' ? `conn:${s.conn}` : s.key));
  const keysSig = sectionKeys.join('|');
  useEffect(() => {
    const prev = seen.current || new Set();
    let fresh = false;
    for (const s of model.sections) {
      const k = s.kind === 'conn' ? `conn:${s.conn}` : s.key;
      if (!prev.has(k) && s.opens) fresh = true;
    }
    seen.current = new Set(sectionKeys);
    if (fresh && !phone) setOpen(true);
  }, [keysSig]);   // eslint-disable-line react-hooks/exhaustive-deps
  // Messages opening is where the attention went.
  useEffect(() => { if (besideMessages) setOpen(false); }, [besideMessages]);
  // The guide is something the person asked for: it opens, on a phone too.
  useEffect(() => { if (guide.open) setOpen(true); }, [guide.open]);
  // Nothing left to show open: the next single file starts as a chip again.
  useEffect(() => { if (!panels.length) setOpen(false); }, [panels.length]);

  const folded = !open || !panels.length;
  const chipRef = useRef(null);
  const focusChip = useRef(false);
  const shellRef = useRef(null);
  useEffect(() => {
    if (folded && focusChip.current) { focusChip.current = false; chipRef.current?.focus(); }
  }, [folded]);

  // Opening from the chip or the slim bar unmounts it: focus goes to the
  // first control in the first panel, not <body>.
  const focusPanel = useRef(false);
  useEffect(() => {
    if (folded || !focusPanel.current) return;
    focusPanel.current = false;
    const shell = shellRef.current;
    if (!shell) return;
    const target = shell.querySelector('section button') || shell;
    if (target === shell) shell.tabIndex = -1;
    target.focus();
  }, [folded]);
  const onOpen = useCallback(() => { focusPanel.current = true; setOpen(true); }, []);

  // A button that removes its own row or panel (Cancel this upload, Dismiss,
  // a row that finishes under it) takes focus with it to <body>. React
  // removes it during a commit, when no blur reaches the tray, so a
  // MutationObserver on the shell notices instead: focus was inside, its node
  // is gone and nothing else holds focus. Where it goes depends on whose
  // doing the removal was. The person's own press of that button (`pressed`,
  // a click, which Enter and Space fire too) moves it to the same row's
  // successor button, as a list would. Anything else (an upload finished, a
  // batch left by itself) must not put it on another row's Cancel, where the
  // next Enter would cancel an unrelated upload: it goes to the panel itself
  // (or the panel now at its place, or the chip / slim bar when none is left).
  // A real move away (a click elsewhere, Tab out) forgets the spot.
  const lastIn = useRef(null);
  const pressed = useRef(null);
  const onFocusIn = (e) => {
    const t = e.target;
    const section = t.closest?.('section') || null;
    const row = t.closest?.('.atr-row') || null;
    const rows = section ? [...section.querySelectorAll('.atr-row')] : [];
    const sections = shellRef.current ? [...shellRef.current.querySelectorAll('section')] : [];
    lastIn.current = { node: t, section, at: row ? rows.indexOf(row) : -1, sAt: section ? sections.indexOf(section) : -1 };
  };
  const onFocusOut = (e) => {
    if (e.relatedTarget && shellRef.current?.contains(e.relatedTarget)) return;
    if (e.target?.isConnected) lastIn.current = null;
  };
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell || typeof MutationObserver === 'undefined') return undefined;
    const mo = new MutationObserver(() => {
      const was = lastIn.current;
      if (!was || was.node.isConnected) return;
      lastIn.current = null;
      const press = pressed.current;
      pressed.current = null;
      const ae = document.activeElement;
      if (ae && ae !== document.body) return;
      const btn = (el) => el?.querySelector('button:not([disabled])') || null;
      const own = !!press && press.node === was.node && performance.now() - press.at < 1500;
      let next = null;
      if (was.section?.isConnected) {
        if (own) {
          const rows = [...was.section.querySelectorAll('.atr-row')];
          if (was.at >= 0 && rows.length) next = btn(rows[Math.min(was.at, rows.length - 1)]);
        }
        next = next || was.section;
      } else {
        const sections = [...shell.querySelectorAll('section')];
        next = sections[Math.min(Math.max(was.sAt, 0), sections.length - 1)] || btn(shell);
      }
      next?.focus();
    });
    mo.observe(shell, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);

  // Every way of folding (Escape, a Fold button, the scrim, a drag): focus that
  // was inside the tray moves to the chip / slim bar once it is drawn.
  const fold = useCallback(() => {
    const el = shellRef.current;
    if (el && typeof document !== 'undefined' && el.contains(document.activeElement)) focusChip.current = true;
    setOpen(false);
  }, []);

  const ctx = useMemo(() => ({
    folded, fold, open: () => setOpen(true), phone, touch,
  }), [folded, fold, phone, touch]);

  const byId = useMemo(() => new Map(activity.items.map((i) => [i.id, i])), [activity.items]);
  const onKeyDown = (e) => {
    if (e.key !== 'Escape' || folded) return;
    e.stopPropagation();
    focusChip.current = true;
    setOpen(false);
  };

  // A downward drag on the sheet's handle or a panel's head folds it.
  const drag = useRef(null);
  const onPointerDown = (e) => {
    if (!phone || folded) return;
    if (!e.target.closest?.('.atr-grab, .imptray-head') || e.target.closest?.('button, a')) return;
    drag.current = { y: e.clientY, id: e.pointerId };
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (e.clientY - d.y > FOLD_DRAG_PX) { drag.current = null; fold(); }
  };
  const endDrag = () => { drag.current = null; };

  // Reconnecting is chip-only alone, but with other panels open it is a head-only panel at the top.
  const conns = model.sections.filter((s) => s.kind === 'conn' && (!s.chipOnly || s.conn === 'reconnecting'));
  const batches = model.sections.filter((s) => s.kind === 'batch');
  // A chip-only op (one file, an export) is drawn head-only while the tray is
  // open for something else, so what the person asked for is not hidden.
  const ops = model.sections.filter((s) => s.kind === 'op');
  const rowTouch = phone || touch;
  const onAction = model.chip?.action?.id === 'retry-conn' && retryConnection ? () => retryConnection() : undefined;

  let shell;
  if (phone) shell = folded ? 'atr-phone' : 'atr-sheet';
  else shell = 'atr-col' + (besideMessages ? ' is-beside-msg' : '');

  return (
    <ActivityTrayContext.Provider value={ctx}>
      {phone && !folded && <div className="atr-scrim" onClick={fold} aria-hidden="true" />}
      <div ref={shellRef} className={shell} role={model.sections.length ? 'region' : undefined} aria-label={model.sections.length ? 'Activity' : undefined}
           onKeyDown={onKeyDown} onClickCapture={(e) => { const b = e.target?.closest?.('button'); pressed.current = b ? { node: b, at: performance.now() } : null; }} onFocus={onFocusIn} onBlur={onFocusOut} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
        {phone && !folded && <div className="atr-grab" aria-hidden="true" />}
        {!folded && conns.map((s) => <ConnPanel key={s.key} s={s} byId={byId} touch={rowTouch} onFold={fold} retryConnection={retryConnection} />)}
        {!folded && batches.map((s) => <BatchPanel key={s.key} s={s} byId={byId} touch={rowTouch} onFold={fold} />)}
        {!folded && ops.map((s) => <OpPanel key={s.key} s={s} onFold={fold} />)}
        {children}
        {folded && model.chip && (phone
          ? <Slim chip={model.chip} onOpen={onOpen} onAction={onAction} chipRef={chipRef} />
          : <Chip chip={model.chip} onOpen={onOpen} onAction={onAction} chipRef={chipRef} />)}
      </div>
      <div className="sr-only" role="status" aria-live="polite">{model.lead?.announce || ''}</div>
    </ActivityTrayContext.Provider>
  );
}
