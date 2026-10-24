// "+ New cluster" — the top bar's button after the breadcrumb, behind
// clusterNudgesAllowed() (lib/appHost.js).
//
// Most people pile everything onto Studio and never make a second cluster: the
// rail's Cluster tool is one icon among eight. This says it in words, on every
// cluster, where you look to see where you are.
//
// It names the cluster first, in a small popover, because most clusters left
// "Untitled cluster" stay that way. Then it hands off to whichever surface
// shows this cluster in this pane — the canvas or the file list — through
// 'soleil-new-cluster', because only that surface knows what is picked and
// where there is room:
//   · cards picked: they move into the new cluster, which lands where they
//     were, and the move's toast undoes both (CanvasSurface createClusterFrom);
//   · nothing picked: it lands beside what is there and opens, ready to fill.
// The surface marks the event handled; one that nobody took goes to
// `onUnhandled(name)`. The count beside the label is what would move
// (lib/newClusterPick.js). The empty Studio's "Start a cluster for each" opens
// this same popover ('soleil-new-cluster-open'), so one field names a cluster
// wherever the offer was made, and the create carries that door's `via`.
//
// Raised like Share, so the two things to press in the bar look alike — a step
// quieter, its label at the trail's weight — and like Share never gold: gold
// marks active, selection and focus. The popover
// is portaled: the bar is its own stacking context (isolation), so anything
// hanging below it would sit under the canvas.

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { Icon } from './Icon.jsx';
import { Plus, Folder } from '../lib/icons.js';
import { useDismissOnOutside } from '../hooks/useDismissOnOutside.js';
import { registerModalOpen } from '../lib/modalGuard.js';
import { readNewClusterPick, subscribeNewClusterPick } from '../lib/newClusterPick.js';
import { logEvent } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { tip } from '../lib/looks.js';
import './newClusterButton.css';

// The longest name the from-selection prompt keeps (CanvasSurface).
const NAME_MAX = 200;

const cardsWord = (n) => (n === 1 ? 'card' : 'cards');

export function NewClusterButton({ boardId, boardName = '', paneId = 'main', onUnhandled = null }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const wrapRef = useRef(null);
  const btnRef = useRef(null);
  const fieldRef = useRef(null);
  const popRef = useRef(null);
  const [pos, setPos] = useState(null);
  const pick = useSyncExternalStore(subscribeNewClusterPick, () => readNewClusterPick(paneId, boardId));
  const n = pick.count;

  // Which door opened it: 'topbar', or the surface that asked — the empty
  // Studio's line, or the Studio bar, which asks for its whole pile at once
  // (`sweep`, how many loose cards will move).
  const viaRef = useRef('topbar');
  const surfaceRef = useRef('topbar');
  const [sweep, setSweep] = useState(0);
  const moving = sweep || n;
  const nudge = (action) => {
    try { logEvent(EV.CLUSTER_NUDGE, { surface: surfaceRef.current, action, picked: moving, board_id: boardId }); } catch (_) {}
  };
  const close = ({ dismissed = false, refocus = false } = {}) => {
    setOpen(false);
    if (dismissed) nudge('dismiss');
    if (refocus) btnRef.current?.focus();
  };
  const show = (via = 'topbar', { surface = via, sweep: sweepN = 0 } = {}) => {
    viaRef.current = via;
    surfaceRef.current = surface;
    setSweep(sweepN);
    // Picked cards start from the name "New cluster from N cards" would offer.
    setName(n && !sweepN ? (pick.suggestion || '') : '');
    setOpen(true);
    // The bar's button is always there, so its popover opening is its view;
    // another door logs its own view when it is shown.
    if (via === 'topbar') nudge('view');
  };
  // Open, and on the same tap put the cursor in the field: iOS raises the
  // keyboard only for a focus made inside the tap, and the effect below runs
  // too late for that. The flush places the popover first, so it can take focus.
  const showNow = (via, opts) => {
    flushSync(() => show(via, opts));
    const el = fieldRef.current;
    if (el && document.activeElement !== el) { el.focus({ preventScroll: true }); el.select(); }
  };
  const showRef = useRef(showNow);
  showRef.current = showNow;
  useEffect(() => {
    const onOpen = (e) => {
      const d = e.detail;
      if (!d || d.handled || d.boardId !== boardId || d.paneId !== paneId) return;
      d.handled = true;
      showRef.current(d.via || 'topbar', { surface: d.surface || d.via || 'topbar', sweep: d.sweep || 0 });
    };
    document.addEventListener('soleil-new-cluster-open', onOpen);
    return () => document.removeEventListener('soleil-new-cluster-open', onOpen);
  }, [boardId, paneId]);

  // The popover is portaled out of wrapRef: a click in it isn't outside.
  useDismissOnOutside(wrapRef, open, () => close({ dismissed: true }), { escape: false, ignore: '.ncl-pop' });
  // Under the button, kept inside the window; hidden until placed.
  useLayoutEffect(() => {
    if (!open) { setPos(null); return undefined; }
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      const w = popRef.current?.offsetWidth || 308;
      setPos({ top: Math.round(r.bottom + 8), left: Math.round(Math.max(8, Math.min(r.left, window.innerWidth - w - 8))) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);
  // A dialog while it is open: the canvas's shortcuts stand down (a Backspace
  // on a focused button would otherwise delete the picked cards behind it),
  // and Escape closes this, the top layer, only.
  useEffect(() => {
    if (!open) return undefined;
    return registerModalOpen({ onEscape: () => close({ dismissed: true, refocus: true }) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // Hidden can't take focus: the field gets it once the popover is placed.
  const placed = !!pos;
  useEffect(() => {
    if (!open || !placed) return;
    const el = fieldRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.select();
  }, [open, placed]);
  // Another cluster in this pane is another place to put it.
  useEffect(() => { setOpen(false); }, [boardId, paneId]);

  const create = () => {
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) || null;
    const detail = { boardId, paneId, name: clean, via: viaRef.current, sweep: sweep > 0, handled: false };
    nudge('accept');
    setOpen(false);
    document.dispatchEvent(new CustomEvent('soleil-new-cluster', { detail }));
    if (!detail.handled) onUnhandled?.(clean);
  };

  const help = sweep ? `All ${sweep} loose cards move into it. Undo puts them back.`
    : n ? (n === 1 ? 'The card you picked moves into it. Undo puts it back.' : `The ${n} cards you picked move into it. Undo puts them back.`)
    : `It lands on ${boardName || 'this cluster'} as a card and opens, ready to fill.`;

  return (
    <span className="ncl-wrap" ref={wrapRef}>
      <button type="button" ref={btnRef} className="tb-btn tb-newcluster"
              aria-haspopup="dialog" aria-expanded={open}
              {...tip(n ? `New cluster from the ${n} ${cardsWord(n)} you picked` : 'New cluster', n ? null : 'C',
                      n ? `New cluster from the ${n} ${cardsWord(n)} you picked` : 'New cluster (C)')}
              onClick={() => (open ? close({ dismissed: true }) : showNow('topbar'))}>
        <Icon as={Plus} size={14} weight="regular" />
        <span className="tb-btn-label">New cluster</span>
        {n > 0 && !(open && sweep) && <span className="ncl-count" aria-label={`${n} ${cardsWord(n)} picked`}>{n}</span>}
      </button>
      {open && createPortal(
        <div className="ncl-pop" role="dialog" aria-label="New cluster" ref={popRef}
             style={pos || { top: 0, left: 0, visibility: 'hidden' }}>
          <div className="ncl-pop-h"><Icon as={Folder} size={16} weight="regular" />Name this cluster</div>
          <input ref={fieldRef} className="ncl-field" type="text" value={name} maxLength={NAME_MAX}
                 placeholder="Name it, e.g. Short film" aria-label="Cluster name"
                 onChange={(e) => setName(e.target.value)}
                 onKeyDown={(e) => {
                   if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); create(); }
                 }} />
          <div className="ncl-help">{help}</div>
          <div className="ncl-acts">
            <button type="button" className="ncl-cancel" onClick={() => close({ dismissed: true, refocus: true })}>Cancel</button>
            <button type="button" className="ncl-create" onClick={create}>Create cluster</button>
          </div>
        </div>,
        document.body,
      )}
    </span>
  );
}
