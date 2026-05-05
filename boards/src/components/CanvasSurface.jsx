import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  BoardCard, BoardLinkCard, ImageCard, NoteCard, LinkCard,
  PaletteCard, DocCard, ScheduleCard, ShapeCard,
} from './cards.jsx';
import { RichDocCard } from './DocCard.jsx';

// Reuse ShapeCard as our drag-preview renderer.
const ShapePreview = ShapeCard;
import { LiveCursor } from './primitives.jsx';
import { CanvasPresence } from './CanvasPresence.jsx';
import { CardContextMenu } from './CardContextMenu.jsx';
import { BackgroundContextMenu } from './BackgroundContextMenu.jsx';
import { ToolOptionsBar } from './ToolOptionsBar.jsx';
import { ColorPicker } from './ColorPicker.jsx';
import { useFeedback } from './AppFeedback.jsx';
import { TEAMMATES } from '../data.js';
import { INBOX_MIME, BOARD_REF_MIME, CARD_TRANSFER_MIME, inboxItemToCard } from '../lib/dragMimes.js';
import { uploadImage } from '../lib/uploads.js';
import { setClipboard, getClipboard, clipboardSize } from '../lib/clipboard.js';
import { addRecentColor } from '../lib/recentColors.js';

const RESIZE_HANDLE_PX = 14;
const MIN_W = 60, MIN_H = 40;
const ZOOM_MIN = 0.1, ZOOM_MAX = 5.0;
const DRAW_DEFAULT_COLOR = '#f5f5f6';
const DRAW_DEFAULT_WIDTH = 3;
const ERASER_DEFAULT_WIDTH = 16;
const VIRTUAL_CANVAS_PX = 100000;
const STROKE_HIT_PADDING = 12; // invisible hit region added around each stroke

function distPointToSegment(p, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = p.x - a.x;
  const wy = p.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2)) : 0;
  const px = a.x + t * vx;
  const py = a.y + t * vy;
  return Math.hypot(p.x - px, p.y - py);
}

function distPointToPolyline(p, points = []) {
  if (points.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    best = Math.min(best, distPointToSegment(
      p,
      { x: points[i - 1][0], y: points[i - 1][1] },
      { x: points[i][0], y: points[i][1] },
    ));
  }
  return best;
}

function pointInRect(p, rect) {
  return p.x >= rect.minX && p.x <= rect.maxX && p.y >= rect.minY && p.y <= rect.maxY;
}

function strokeIntersectsRect(stroke, rect) {
  const pts = stroke?.points || [];
  if (pts.some(([x, y]) => pointInRect({ x, y }, rect))) return true;
  for (let i = 1; i < pts.length; i++) {
    const a = { x: pts[i - 1][0], y: pts[i - 1][1] };
    const b = { x: pts[i][0], y: pts[i][1] };
    if ((Math.min(a.x, b.x) <= rect.maxX && Math.max(a.x, b.x) >= rect.minX) &&
        (Math.min(a.y, b.y) <= rect.maxY && Math.max(a.y, b.y) >= rect.minY)) return true;
  }
  return false;
}

function splitStrokeByEraser(stroke, eraserPoints, radius) {
  const sourcePoints = stroke?.points || [];
  const points = [];
  for (let i = 0; i < sourcePoints.length; i++) {
    const point = sourcePoints[i];
    if (i === 0) {
      points.push(point);
      continue;
    }
    const prev = sourcePoints[i - 1];
    const dist = Math.hypot(point[0] - prev[0], point[1] - prev[1]);
    const steps = Math.max(1, Math.ceil(dist / 6));
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      points.push([
        Math.round((prev[0] + (point[0] - prev[0]) * t) * 10) / 10,
        Math.round((prev[1] + (point[1] - prev[1]) * t) * 10) / 10,
      ]);
    }
  }
  if (points.length < 2 || eraserPoints.length < 2) return [stroke];
  const pieces = [];
  let current = [];
  const keepPoint = ([x, y]) => distPointToPolyline({ x, y }, eraserPoints) > radius;

  for (const point of points) {
    if (keepPoint(point)) {
      current.push(point);
      continue;
    }
    if (current.length > 1) pieces.push({ ...stroke, points: current });
    current = [];
  }
  if (current.length > 1) pieces.push({ ...stroke, points: current });
  return pieces;
}

function readImageDims(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight, url });
    };
    img.onerror = () => {
      resolve({ width: null, height: null, url });
    };
    img.src = url;
  });
}

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || '');

// Per-user presence color, drawn from the warm cover palette. Stable per
// user id so the same person always shows up in the same color across
// sessions. Falls back to soleil for unknown ids.
const PRESENCE_COLORS = ['#d4a04a', '#6b8090', '#9a6b88', '#c9a577', '#6b9088', '#b88958'];
function pickPresenceColor(id) {
  if (!id) return PRESENCE_COLORS[0];
  let h = 0; for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return PRESENCE_COLORS[Math.abs(h) % PRESENCE_COLORS.length];
}
const cmdKey = isMac ? '⌘' : 'Ctrl';

export function CanvasSurface({
  board, boards, cards, arrows, strokes,
  ydoc, // raw Y.Doc — needed by doc cards to access their per-card YMap
  getAwareness,            // () => Awareness | null  — for live presence
  currentUser,             // { id, name, color }     — for awareness localState
  onOpenBoard, tweak, depth, onOpenPicker,
  onDropInboxItem, onDropFileImage,
  workspaceId, userId, personalWorkspaceId,
  selectedTool = 'select', setSelectedTool = () => {},
  mutators = {},
  autoFocusId, clearAutoFocus,
  useLocalImages = false,
  peersHereByBoard,        // Map<boardId, Peer[]>  — workspace presence
  peersBelowByBoard,       // Map<boardId, Peer[]>  — descendants
}) {
  const wrapRef = useRef(null);
  const [pan, setPan] = useState({ x: 40, y: 60 });
  const [zoom, setZoom] = useState(1);
  // Mirror pan/zoom into refs so live handlers (cursor broadcast,
  // pointermove → canvas-space conversion) can read the latest values
  // without the owning effect needing to re-bind on every pan tick.
  // Re-binding caused the effect's cleanup to fire repeatedly during a
  // pan, which would null out our canvasCursor for peers — the cursor
  // appeared to disappear from their screen while we panned.
  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);
  panRef.current = pan;
  zoomRef.current = zoom;
  const [smoothXform, setSmoothXform] = useState(false); // true → CSS transition on canvas transform
  const [dragOver, setDragOver] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [selectedStrokes, setSelectedStrokes] = useState(() => new Set());
  const [selectedArrows, setSelectedArrows] = useState(() => new Set());
  const [drag, setDrag] = useState(null);
  const [resize, setResize] = useState(null);
  const [rotateState, setRotateState] = useState(null); // { id, rot }
  const [marquee, setMarquee] = useState(null);
  const [arrowFrom, setArrowFrom] = useState(null);
  const [activeStroke, setActiveStroke] = useState(null);
  const [activeFreeArrow, setActiveFreeArrow] = useState(null); // { from:{x,y}, to:{x,y} }

  // Live presence — once awareness is bound, write our own user info, our
  // canvas-cursor (canvas-space coords, throttled), and our selection.
  // Peers' presence is rendered by <CanvasPresence/> below.
  useEffect(() => {
    const aw = getAwareness?.();
    if (!aw || !currentUser) return;
    aw.setLocalStateField('user', {
      id: currentUser.id,
      name: currentUser.name || currentUser.email?.split('@')[0] || 'You',
      color: currentUser.color || pickPresenceColor(currentUser.id),
    });
  }, [getAwareness, currentUser?.id, currentUser?.name, currentUser?.color]);

  // Cursor broadcast — write to awareness on a fixed interval rather than
  // every pointermove/rAF so we don't blow past Supabase Realtime's per-
  // tenant rate limit. ~120ms feels live-enough for collab cursors and
  // sits well below the broadcast cap.
  useEffect(() => {
    const aw = getAwareness?.();
    const wrap = wrapRef.current;
    if (!aw || !wrap) return;
    let pending = null;
    let last = { x: null, y: null };
    let timer = null;
    const flush = () => {
      timer = null;
      if (!pending) return;
      // Skip a write if the cursor hasn't actually moved (rounded).
      if (Math.round(pending.x) === last.x && Math.round(pending.y) === last.y) {
        pending = null;
        return;
      }
      last = { x: Math.round(pending.x), y: Math.round(pending.y) };
      aw.setLocalStateField('canvasCursor', { boardId: board.id, x: last.x, y: last.y });
      pending = null;
    };
    const onMove = (e) => {
      const r = wrap.getBoundingClientRect();
      const p = panRef.current;
      const z = zoomRef.current || 1;
      pending = {
        x: (e.clientX - r.left - p.x) / z,
        y: (e.clientY - r.top  - p.y) / z,
      };
      if (!timer) timer = setTimeout(flush, 16);
    };
    const onLeave = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      pending = null;
      last = { x: null, y: null };
      aw.setLocalStateField('canvasCursor', null);
    };
    wrap.addEventListener('pointermove', onMove);
    wrap.addEventListener('pointerleave', onLeave);
    return () => {
      wrap.removeEventListener('pointermove', onMove);
      wrap.removeEventListener('pointerleave', onLeave);
      if (timer) clearTimeout(timer);
      try { aw.setLocalStateField('canvasCursor', null); } catch (_) {}
    };
  }, [getAwareness, board.id]);

  // Peer live-edit notes — cardId → in-flight html broadcast by peers via
  // awareness. We display this html instead of the canonical Y.Doc html
  // while the peer is typing, so the text appears live without waiting
  // for commit-on-blur.
  const [peerNoteEdits, setPeerNoteEdits] = useState({});
  useEffect(() => {
    const aw = getAwareness?.();
    if (!aw) return;
    const refresh = () => {
      const map = {};
      aw.getStates().forEach((state) => {
        if (!state?.user || state.user.id === currentUser?.id) return;
        const ne = state.noteEdit;
        if (!ne || ne.boardId !== board.id || !ne.cardId) return;
        map[ne.cardId] = ne.html;
      });
      setPeerNoteEdits(map);
    };
    refresh();
    aw.on('change', refresh);
    return () => aw.off('change', refresh);
  }, [getAwareness, board.id, currentUser?.id]);

  // Peer live-drag state — read each peer's awareness liveDrag and map
  // (cardId → {x, y}) so we can render the card at the peer's reported
  // position while they're dragging it. Y.Doc commit on drag-end snaps it
  // into the final position.
  const [peerDrags, setPeerDrags] = useState({});
  useEffect(() => {
    const aw = getAwareness?.();
    if (!aw) return;
    const refresh = () => {
      const map = {};
      aw.getStates().forEach((state) => {
        if (!state?.user || state.user.id === currentUser?.id) return;
        const drag = state.liveDrag;
        if (!drag || drag.boardId !== board.id) return;
        for (const dc of (drag.cards || [])) {
          if (dc?.id) map[dc.id] = { x: dc.x, y: dc.y };
        }
      });
      setPeerDrags(map);
    };
    refresh();
    aw.on('change', refresh);
    return () => aw.off('change', refresh);
  }, [getAwareness, board.id, currentUser?.id]);

  // Marquee broadcast — write the live marquee box to awareness so peers
  // see it as a translucent rectangle in our color while we're drag-selecting.
  useEffect(() => {
    const aw = getAwareness?.();
    if (!aw) return;
    if (marquee) {
      aw.setLocalStateField('marquee', {
        boardId: board.id,
        x0: Math.round(Math.min(marquee.x0, marquee.x1)),
        y0: Math.round(Math.min(marquee.y0, marquee.y1)),
        x1: Math.round(Math.max(marquee.x0, marquee.x1)),
        y1: Math.round(Math.max(marquee.y0, marquee.y1)),
      });
    } else {
      aw.setLocalStateField('marquee', null);
    }
  }, [getAwareness, board.id, marquee]);

  // Selection broadcast — when our local selection set changes, push the
  // card-id list to awareness so peers can render our selection ring.
  useEffect(() => {
    const aw = getAwareness?.();
    if (!aw) return;
    const ids = [...selected];
    aw.setLocalStateField('canvasSelection', ids.length ? { boardId: board.id, cardIds: ids } : null);
  }, [getAwareness, board.id, selected]);

  // Signal sent to ImageCard to enter inline edit mode for a specific field
  // (title or caption). Bumps `n` so a re-trigger on the same card still
  // re-fires the effect. No popup — same UX as board-name editing.
  const [editFieldSignal, setEditFieldSignal] = useState({ id: null, field: null, n: 0 });
  const triggerInlineEdit = (id, field) => setEditFieldSignal((s) => ({ id, field, n: s.n + 1 }));
  // Lightbox: previewing an image inline (e.g. clicked from a list-board's
  // child row). Null when closed.
  const [lightbox, setLightbox] = useState(null);
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e) => { if (e.key === 'Escape') setLightbox(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);
  const [drawOptions, setDrawOptions] = useState({
    mode: 'pen',
    color: DRAW_DEFAULT_COLOR,
    width: DRAW_DEFAULT_WIDTH,
    eraserWidth: ERASER_DEFAULT_WIDTH,
  });
  const [shapeOptions, setShapeOptions] = useState({
    shape: 'rect', stroke: '#f5f5f6', fill: 'transparent', strokeWidth: 2, dash: 'solid',
  });
  const [arrowOptions, setArrowOptions] = useState({ straight: false, dashed: false });
  const [activeShape, setActiveShape] = useState(null); // { x, y, w, h } during shape drag
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [ctx, setCtx] = useState({ open: false, x: 0, y: 0, cardId: null });
  const [bgCtx, setBgCtx] = useState({ open: false, x: 0, y: 0, canvasPos: null });
  const [picker, setPicker] = useState(null); // { value, onChange, x, y, allowTransparent } | null
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [spaceDown, setSpaceDown] = useState(false);
  const lastMouseCanvasRef = useRef({ x: 200, y: 200 });
  const feedback = useFeedback();

  // Briefly enable smooth transform after programmatic zoom changes.
  const enableSmoothTransform = useCallback(() => {
    setSmoothXform(true);
    setTimeout(() => setSmoothXform(false), 220);
  }, []);

  useEffect(() => {
    if (autoFocusId && clearAutoFocus) {
      const t = setTimeout(() => clearAutoFocus(), 60);
      return () => clearTimeout(t);
    }
  }, [autoFocusId, clearAutoFocus]);

  useEffect(() => {
    if (!wrapRef.current) return;
    if (!cards || cards.length === 0) {
      setPan({ x: 40, y: 60 });
      setZoom(1);
      return;
    }
    const r = wrapRef.current.getBoundingClientRect();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of cards) {
      minX = Math.min(minX, c.x);
      minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x + c.w);
      maxY = Math.max(maxY, c.y + c.h);
    }
    const contentW = Math.max(1, maxX - minX);
    const contentH = Math.max(1, maxY - minY);
    const margin = 80;
    const z = Math.max(ZOOM_MIN, Math.min(1, Math.min(
      (r.width - margin * 2) / contentW,
      (r.height - margin * 2) / contentH,
    )));
    setZoom(z);
    setPan({
      x: (r.width  - contentW * z) / 2 - minX * z,
      y: (r.height - contentH * z) / 2 - minY * z,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.id]);

  useEffect(() => { setArrowFrom(null); setActiveStroke(null); setActiveFreeArrow(null); }, [selectedTool, board.id]);
  useEffect(() => {
    setSelected(new Set());
    setSelectedStrokes(new Set());
    setSelectedArrows(new Set());
    setCtx(c => ({ ...c, open: false }));
    setBgCtx(c => ({ ...c, open: false }));
  }, [board.id]);

  const sortedCards = useMemo(() => {
    const arr = (cards || []).slice();
    arr.sort((a, b) => ((a.z || 0) - (b.z || 0)) || (a.id < b.id ? -1 : 1));
    return arr;
  }, [cards]);

  const cardById = useMemo(() => {
    const m = {}; (cards || []).forEach(c => m[c.id] = c); return m;
  }, [cards]);

  // Aggregate every palette card's swatches. `palettes` keeps each palette
  // distinct (with its name + swatches) so the ColorPicker can page through
  // them; `paletteColors` is the legacy flat list still used by callers
  // that just want a quick swatch rail (e.g. ToolOptionsBar shape rows).
  const palettes = useMemo(() => {
    return (cards || [])
      .filter(c => c.kind === 'palette' && Array.isArray(c.swatches) && c.swatches.length > 0)
      .map((c, i) => ({
        id: c.id,
        name: c.title || `Palette ${i + 1}`,
        swatches: c.swatches.filter(s => s && s.hex),
      }));
  }, [cards]);
  const paletteColors = useMemo(() => {
    const out = [];
    palettes.forEach(p => p.swatches.forEach(s => { if (s.hex) out.push(s.hex); }));
    return [...new Set(out)];
  }, [palettes]);

  // Resolve an arrow endpoint reference to a center point.
  // ref is either a card id (string) or a free point ({x,y}).
  const resolveCenter = (ref) => {
    if (!ref) return { x: 0, y: 0 };
    if (typeof ref === 'object') return { x: ref.x, y: ref.y };
    const c = cardById[ref];
    return c ? { x: c.x + c.w/2, y: c.y + c.h/2 } : { x: 0, y: 0 };
  };
  const resolveEdge = (ref, tx, ty) => {
    if (!ref) return { x: tx, y: ty };
    if (typeof ref === 'object') return { x: ref.x, y: ref.y };
    const c = cardById[ref]; if (!c) return { x: tx, y: ty };
    const cx = c.x + c.w/2, cy = c.y + c.h/2;
    const dx = tx - cx, dy = ty - cy;
    if (!dx && !dy) return { x: cx, y: cy };
    const sx = (c.w/2 + 4) / Math.abs(dx || 1e-4);
    const sy = (c.h/2 + 4) / Math.abs(dy || 1e-4);
    const s = Math.min(sx, sy);
    return { x: cx + dx*s, y: cy + dy*s };
  };

  const clientToCanvas = useCallback((clientX, clientY) => {
    const rect = wrapRef.current.getBoundingClientRect();
    return {
      x: (clientX - rect.left - pan.x) / zoom,
      y: (clientY - rect.top  - pan.y) / zoom,
    };
  }, [pan.x, pan.y, zoom]);

  const imageFileToPayload = useCallback(async (file, x, y) => {
    if (useLocalImages) {
      const dims = await readImageDims(file);
      return { publicUrl: dims.url, width: dims.width, height: dims.height, x, y };
    }
    const up = await uploadImage({ file, workspaceId, userId });
    return { publicUrl: up.publicUrl, width: up.width, height: up.height, x, y };
  }, [useLocalImages, workspaceId, userId]);

  useEffect(() => {
    const onMove = (e) => {
      if (!wrapRef.current) return;
      const rect = wrapRef.current.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right ||
          e.clientY < rect.top || e.clientY > rect.bottom) return;
      lastMouseCanvasRef.current = clientToCanvas(e.clientX, e.clientY);
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [clientToCanvas]);

  useEffect(() => {
    const onDown = (e) => {
      if (e.code !== 'Space') return;
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
      e.preventDefault();
      setSpaceDown(true);
    };
    const onUp = (e) => {
      if (e.code !== 'Space') return;
      setSpaceDown(false);
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp); };
  }, []);

  // Wheel: cmd-wheel zoom around cursor; plain wheel = pan.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (e.target.closest && e.target.closest('.inbox, .ctx-menu, .modal-bg, .modal, .twk-panel, .tob')) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.0009);
        const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom * factor));
        if (newZoom === zoom) return;
        const cx = (e.clientX - rect.left - pan.x) / zoom;
        const cy = (e.clientY - rect.top  - pan.y) / zoom;
        const newPanX = e.clientX - rect.left - cx * newZoom;
        const newPanY = e.clientY - rect.top  - cy * newZoom;
        setZoom(newZoom);
        setPan({ x: newPanX, y: newPanY });
      } else {
        setPan(p => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [pan.x, pan.y, zoom]);

  // ── Confirm + delete cards ────────────────────────────────────────────────
  const buildDeleteMessage = useCallback((ids) => {
    const sel = ids.map(id => cardById[id]).filter(Boolean);
    const boardCards = sel.filter(c => c.kind === 'board');
    const total = sel.length;
    const bn = boardCards.length;
    if (bn > 0 && total === bn) {
      if (bn === 1) {
        const name = boards[boardCards[0].id]?.name || 'this board';
        return `Delete board "${name}" and ALL its content? This cannot be undone.`;
      }
      return `Delete ${bn} boards and ALL their content? This cannot be undone.`;
    }
    if (bn > 0) {
      return `Delete ${total} items, including ${bn} board${bn > 1 ? 's' : ''} (their content will also be lost)? This cannot be undone.`;
    }
    if (total === 1) return 'Delete this card?';
    return `Delete ${total} cards?`;
  }, [cardById, boards]);

  const doDeleteIds = useCallback(async (ids) => {
    if (!ids?.length) return;
    const msg = buildDeleteMessage(ids);
    if (msg) {
      const ok = await feedback.confirm({
        title: 'Delete selection',
        message: msg,
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;
    }
    mutators.deleteCards?.(ids);
    setSelected(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.delete(id));
      return next;
    });
  }, [buildDeleteMessage, feedback, mutators]);

  // Delete-selected handles cards, strokes, AND arrows.
  const doDeleteSelected = useCallback(async () => {
    if (selectedStrokes.size > 0) {
      mutators.deleteStrokes?.([...selectedStrokes]);
      setSelectedStrokes(new Set());
    }
    if (selectedArrows.size > 0) {
      mutators.deleteArrows?.([...selectedArrows]);
      setSelectedArrows(new Set());
    }
    if (selected.size > 0) await doDeleteIds([...selected]);
  }, [doDeleteIds, selected, selectedStrokes, selectedArrows, mutators]);

  // ── Internal clipboard ───────────────────────────────────────────────────
  const doCopy = useCallback(() => {
    const items = [...selected].map(id => cardById[id]).filter(Boolean);
    if (items.length === 0) return;
    setClipboard(items, board.id);
  }, [selected, cardById, board.id]);

  const doCut = useCallback(async () => {
    const items = [...selected].map(id => cardById[id]).filter(Boolean);
    if (items.length === 0) return;
    setClipboard(items, board.id);
    await doDeleteIds([...selected]);
  }, [selected, cardById, board.id, doDeleteIds]);

  const doPaste = useCallback((atCanvas) => {
    const items = getClipboard();
    if (!items.length) return;
    const minX = Math.min(...items.map(c => c.x));
    const minY = Math.min(...items.map(c => c.y));
    const target = atCanvas || lastMouseCanvasRef.current;
    const dx = target.x - minX;
    const dy = target.y - minY;
    const newCards = items.map(c => {
      const copy = { ...c };
      if (copy.kind === 'board') return null;
      copy.id = `${copy.kind || 'card'}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      copy.x = Math.round((copy.x || 0) + dx);
      copy.y = Math.round((copy.y || 0) + dy);
      return copy;
    }).filter(Boolean);
    if (!newCards.length) return;
    mutators.addCards?.(newCards);
    setSelected(new Set(newCards.map(c => c.id)));
  }, [mutators]);

  const doDuplicate = useCallback(() => {
    const ids = [...selected];
    if (!ids.length) return;
    const newIds = mutators.duplicateCards?.(ids) || [];
    if (newIds.length) setSelected(new Set(newIds));
  }, [selected, mutators]);

  const selectAll = useCallback(() => {
    setSelected(new Set((cards || []).map(c => c.id)));
  }, [cards]);

  // ── System clipboard ─────────────────────────────────────────────────────
  useEffect(() => {
    const onPaste = async (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
      const items = e.clipboardData?.items;
      let handled = false;
      if (items) {
        for (const item of items) {
          if (item.type.startsWith('image/')) {
            e.preventDefault();
            handled = true;
            const file = item.getAsFile();
            if (file) {
              try {
                const pos = lastMouseCanvasRef.current;
                onDropFileImage && onDropFileImage(await imageFileToPayload(file, pos.x, pos.y));
              } catch (err) {
                console.error('image paste failed', err);
                feedback.toast({ type: 'error', message: 'Image paste failed: ' + (err.message || err) });
              }
            }
            break;
          }
        }
      }
      if (!handled && getClipboard().length > 0) {
        e.preventDefault();
        doPaste();
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [feedback, imageFileToPayload, onDropFileImage, doPaste]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
      const cmd = e.metaKey || e.ctrlKey;

      if (cmd && e.key === 'z' && !e.shiftKey) { e.preventDefault(); mutators.undo?.(); return; }
      if ((cmd && e.key === 'z' && e.shiftKey) || (cmd && e.key === 'y')) { e.preventDefault(); mutators.redo?.(); return; }
      if (cmd && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); selectAll(); return; }
      if (cmd && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); doDuplicate(); return; }
      if (cmd && (e.key === 'c' || e.key === 'C')) { doCopy(); return; }
      if (cmd && (e.key === 'x' || e.key === 'X')) { doCut(); return; }

      if (cmd && e.key === '0') { e.preventDefault(); enableSmoothTransform(); setZoom(1); setPan({ x: 40, y: 60 }); return; }
      if (cmd && (e.key === '=' || e.key === '+')) { e.preventDefault(); enableSmoothTransform(); setZoom(z => Math.min(ZOOM_MAX, z * 1.25)); return; }
      if (cmd && (e.key === '-')) { e.preventDefault(); enableSmoothTransform(); setZoom(z => Math.max(ZOOM_MIN, z / 1.25)); return; }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selected.size > 0 || selectedStrokes.size > 0 || selectedArrows.size > 0) {
          e.preventDefault(); doDeleteSelected();
        }
        return;
      }
      if (e.key === 'Escape') {
        setAddMenuOpen(false);
        setSelected(new Set());
        setSelectedStrokes(new Set());
        setSelectedArrows(new Set());
        setSelectedTool('select');
        setArrowFrom(null);
        setActiveStroke(null);
        setActiveFreeArrow(null);
        setCtx(c => ({ ...c, open: false }));
        setBgCtx(c => ({ ...c, open: false }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mutators, selectAll, doDuplicate, doCopy, doCut, doDeleteSelected, selected.size, selectedStrokes.size, selectedArrows.size, setSelectedTool, enableSmoothTransform]);

  // ── Pan helpers ───────────────────────────────────────────────────────────
  const startPan = (e) => {
    e.preventDefault();
    const startClient = { x: e.clientX, y: e.clientY };
    const startPan = { ...pan };
    document.body.style.cursor = 'grabbing';
    const onMove = (ev) => {
      setPan({ x: startPan.x + (ev.clientX - startClient.x), y: startPan.y + (ev.clientY - startClient.y) });
    };
    const onUp = () => {
      document.body.style.cursor = '';
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // ── Card pointer handlers ─────────────────────────────────────────────────
  const onCardPointerDown = (e, c) => {
    if (e.button === 1) { startPan(e); return; }
    if (e.button !== 0) return;
    if (spaceDown || selectedTool === 'pan') { startPan(e); return; }
    if (e.target.isContentEditable) return;
    if (e.target.closest?.('.editable.is-editing, .note-toolbar, .rb-swatch-pop, .ic-link, .ic-add-caption, .editable')) return;

    if (selectedTool === 'arrow') {
      e.stopPropagation();
      if (!arrowFrom) setArrowFrom(c.id);
      else {
        if (arrowFrom !== c.id) mutators.addArrow?.(arrowFrom, c.id, arrowOptions);
        setArrowFrom(null);
      }
      return;
    }
    if (selectedTool !== 'select') return;
    if (e.target.closest?.('.card-resize')) return;
    if (e.target.closest?.('.card-rotate')) return;

    e.stopPropagation();
    // NOTE: deliberately NOT calling setPointerCapture. Capturing the pointer
    // on the wrapper interferes with native dblclick on inner content
    // (notes, link cards, etc.) — pointerup gets routed to the capturer
    // instead of the original target, breaking the click/dblclick chain in
    // some browsers. Window-level pointermove/pointerup listeners below give
    // us full drag tracking without needing capture.
    const openOnClick = (c.kind === 'board' && e.target.closest?.('.bc-cover')) ||
      (c.kind === 'boardlink' && boards[c.target]);

    let nextSelected;
    if (e.shiftKey) {
      nextSelected = new Set(selected);
      if (nextSelected.has(c.id)) nextSelected.delete(c.id);
      else nextSelected.add(c.id);
    } else if (selected.has(c.id) && selected.size > 1) {
      nextSelected = selected;
    } else {
      nextSelected = new Set([c.id]);
    }
    setSelected(nextSelected);
    setSelectedStrokes(new Set());
    setSelectedArrows(new Set());
    if (nextSelected.has(c.id)) mutators.bringToFront?.(c.id);
    if (e.shiftKey) return;

    const dragIds = [...nextSelected];
    const dragSet = new Set(dragIds);
    const startPositions = {};
    dragIds.forEach(id => {
      const dc = cardById[id];
      if (dc) startPositions[id] = { x: dc.x, y: dc.y };
    });
    const startClient = { x: e.clientX, y: e.clientY };

    // Snap targets: every non-dragged card's edges & centers, captured once
    // at drag start so we don't recompute on every mousemove.
    const SNAP_PX = 6;
    const targetsX = []; // edges to align/abut on the X axis
    const targetsY = [];
    cards.forEach(card => {
      if (dragSet.has(card.id)) return;
      targetsX.push(card.x, card.x + card.w, card.x + card.w / 2);
      targetsY.push(card.y, card.y + card.h, card.y + card.h / 2);
    });
    // Bounding box of dragged group at start (for snapping the group as one).
    const dragBBoxStart = (() => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      dragIds.forEach(id => {
        const dc = cardById[id]; if (!dc) return;
        minX = Math.min(minX, dc.x);
        minY = Math.min(minY, dc.y);
        maxX = Math.max(maxX, dc.x + dc.w);
        maxY = Math.max(maxY, dc.y + dc.h);
      });
      return { minX, minY, maxX, maxY };
    })();
    const computeSnap = (rawDx, rawDy) => {
      // Snap thresholds scale with zoom so they FEEL like ~SNAP_PX on screen
      // regardless of zoom level.
      const thresh = SNAP_PX / zoom;
      const left   = dragBBoxStart.minX + rawDx;
      const right  = dragBBoxStart.maxX + rawDx;
      const top    = dragBBoxStart.minY + rawDy;
      const bottom = dragBBoxStart.maxY + rawDy;
      const cx     = (left + right) / 2;
      const cy     = (top + bottom) / 2;
      let bestX = null, bestXDist = thresh + 0.001;
      let bestY = null, bestYDist = thresh + 0.001;
      // X-axis: try to align left/right/center to any target X.
      for (const tx of targetsX) {
        for (const [edge, adjust] of [[left, tx - left], [right, tx - right], [cx, tx - cx]]) {
          const d = Math.abs(adjust);
          if (d < bestXDist) { bestXDist = d; bestX = adjust; }
        }
      }
      for (const ty of targetsY) {
        for (const [edge, adjust] of [[top, ty - top], [bottom, ty - bottom], [cy, ty - cy]]) {
          const d = Math.abs(adjust);
          if (d < bestYDist) { bestYDist = d; bestY = adjust; }
        }
      }
      return {
        dx: rawDx + (bestX ?? 0),
        dy: rawDy + (bestY ?? 0),
      };
    };
    setDrag({ ids: dragIds, dx: 0, dy: 0, startPositions });

    const onMove = (ev) => {
      const rawDx = (ev.clientX - startClient.x) / zoom;
      const rawDy = (ev.clientY - startClient.y) / zoom;
      // Hold Alt/Option to bypass snap.
      const skip = ev.altKey;
      const { dx, dy } = skip ? { dx: rawDx, dy: rawDy } : computeSnap(rawDx, rawDy);
      setDrag({ ids: dragIds, dx, dy, startPositions });
      // Live cross-pane / inbox hover signal — other panes use this to
      // highlight themselves as drop targets while the pointer is over them.
      document.dispatchEvent(new CustomEvent('soleil-cross-pane-hover', {
        detail: { sourceBoardId: board.id, clientX: ev.clientX, clientY: ev.clientY },
      }));
      // Broadcast the live drag positions to peers via awareness so they can
      // see the card move in real time (Y.Doc only commits on drag END, so
      // without this peers wouldn't see anything until the user lets go).
      const aw = getAwareness?.();
      if (aw) {
        aw.setLocalStateField('liveDrag', {
          boardId: board.id,
          cards: dragIds.map(id => {
            const start = startPositions[id];
            return start ? { id, x: Math.round(start.x + dx), y: Math.round(start.y + dy) } : null;
          }).filter(Boolean),
        });
      }
    };
    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const rawDx = (ev.clientX - startClient.x) / zoom;
      const rawDy = (ev.clientY - startClient.y) / zoom;
      const skip = ev.altKey;
      const { dx, dy } = skip ? { dx: rawDx, dy: rawDy } : computeSnap(rawDx, rawDy);
      // Clear our live-drag awareness so peers see the card snap to its
      // committed position. (The Y.Doc updateCards call below propagates
      // the final position via Yjs sync.)
      try { getAwareness?.()?.setLocalStateField('liveDrag', null); } catch (_) {}
      // ── Cross-pane transfer detection ──
      const dropEl = document.elementFromPoint(ev.clientX, ev.clientY);
      const dropWrap = dropEl?.closest?.('.canvas-wrap');
      const sourceWrap = wrapRef.current;
      // Always clear the cross-pane drop hint regardless of where we landed.
      document.dispatchEvent(new CustomEvent('soleil-cross-pane-end'));
      // Drop onto a different canvas pane.
      if (dropWrap && sourceWrap && dropWrap !== sourceWrap && Math.abs(dx) + Math.abs(dy) > 4) {
        const isCopy = ev.metaKey || ev.ctrlKey;
        const movedCards = dragIds.map(id => cardById[id]).filter(Boolean);
        document.dispatchEvent(new CustomEvent('soleil-cross-pane-drop', {
          detail: {
            sourceBoardId: board.id,
            isCopy,
            cards: movedCards,
            clientX: ev.clientX,
            clientY: ev.clientY,
          },
        }));
        setDrag(null);
        return;
      }
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        const updates = dragIds.map(id => ({
          id, patch: {
            x: Math.round(startPositions[id].x + dx),
            y: Math.round(startPositions[id].y + dy),
          }
        }));
        mutators.updateCards?.(updates);
      } else if (openOnClick) {
        if (c.kind === 'board') onOpenBoard(c.id);
        if (c.kind === 'boardlink') onOpenBoard(c.target);
      }
      setDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onResizePointerDown = (e, c) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setSelected(new Set([c.id]));
    const startClient = { x: e.clientX, y: e.clientY };
    setResize({ id: c.id, dw: 0, dh: 0 });

    const onMove = (ev) => {
      const dx = (ev.clientX - startClient.x) / zoom;
      const dy = (ev.clientY - startClient.y) / zoom;
      setResize({ id: c.id, dw: dx, dh: dy });
    };
    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const dx = (ev.clientX - startClient.x) / zoom;
      const dy = (ev.clientY - startClient.y) / zoom;
      const newW = Math.max(MIN_W, Math.round(c.w + dx));
      const newH = Math.max(MIN_H, Math.round(c.h + dy));
      if (newW !== c.w || newH !== c.h) {
        // Manual resize sticks — note auto-sizing stops once the user has
        // committed a hand-set size. Only matters for note cards but the
        // flag is harmless on other kinds.
        const patch = { w: newW, h: newH };
        if (c.kind === 'note' && !c.manuallyResized) patch.manuallyResized = true;
        mutators.updateCard?.(c.id, patch);
      }
      setResize(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onRotatePointerDown = (e, c) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setSelected(new Set([c.id]));
    const wrapper = e.currentTarget.closest('.card');
    if (!wrapper) return;
    const r = wrapper.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx);
    const startRot = c.rotation || 0;

    const compute = (ev) => {
      const angle = Math.atan2(ev.clientY - cy, ev.clientX - cx);
      let next = startRot + (angle - startAngle) * 180 / Math.PI;
      if (ev.shiftKey) next = Math.round(next / 15) * 15;
      next = ((next % 360) + 360) % 360;
      return next;
    };
    setRotateState({ id: c.id, rot: startRot });
    const onMove = (ev) => setRotateState({ id: c.id, rot: compute(ev) });
    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const rot = compute(ev);
      mutators.updateCard?.(c.id, { rotation: Math.round(rot) || null });
      setRotateState(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // ── Stroke / arrow click (select tool selects) ───────────────────────────
  const onStrokeClick = (e, idx) => {
    e.stopPropagation();
    if (selectedTool === 'select') {
      const sel = e.shiftKey ? new Set(selectedStrokes) : new Set();
      if (sel.has(idx)) sel.delete(idx); else sel.add(idx);
      setSelectedStrokes(sel);
      if (!e.shiftKey) { setSelected(new Set()); setSelectedArrows(new Set()); }
    }
  };

  const onArrowClick = (e, idx) => {
    e.stopPropagation();
    if (selectedTool === 'select') {
      const sel = e.shiftKey ? new Set(selectedArrows) : new Set();
      if (sel.has(idx)) sel.delete(idx); else sel.add(idx);
      setSelectedArrows(sel);
      if (!e.shiftKey) { setSelected(new Set()); setSelectedStrokes(new Set()); }
    }
  };

  // ── Card context menu ─────────────────────────────────────────────────────
  const onCardContextMenu = (e, c) => {
    e.preventDefault();
    e.stopPropagation();
    setBgCtx(b => ({ ...b, open: false }));
    if (!selected.has(c.id)) setSelected(new Set([c.id]));
    setCtx({ open: true, x: e.clientX, y: e.clientY, cardId: c.id });
  };
  const closeCardMenu = () => setCtx(c => ({ ...c, open: false }));

  const buildMenu = (c) => {
    const items = [];
    const multi = selected.size > 1 && selected.has(c.id);

    if (!multi) {
      if (c.kind === 'image') {
        items.push({ id: 'title', label: c.title ? 'Edit title' : 'Add title', run: () => {
          triggerInlineEdit(c.id, 'title');
        }});
        items.push({ id: 'caption', label: c.caption ? 'Edit caption' : 'Add caption', run: () => {
          triggerInlineEdit(c.id, 'caption');
        }});
        items.push({ id: 'link', label: c.link ? 'Edit hyperlink' : 'Add hyperlink', run: async () => {
          const v = await feedback.prompt({
            title: c.link ? 'Edit image hyperlink' : 'Add image hyperlink',
            label: 'URL',
            placeholder: 'https://...',
            defaultValue: c.link || '',
            confirmLabel: 'Save link',
          });
          if (v == null) return;
          mutators.updateCard?.(c.id, { link: v.trim() || null });
        }});
        items.push({ id: 'replace', label: 'Replace image…', run: () => {
          const input = document.createElement('input');
          input.type = 'file'; input.accept = 'image/*';
          input.onchange = async () => {
            const f = input.files?.[0]; if (!f) return;
            try {
              const payload = await imageFileToPayload(f, c.x + c.w / 2, c.y + c.h / 2);
              mutators.updateCard?.(c.id, { src: payload.publicUrl });
            } catch (err) {
              feedback.toast({ type: 'error', message: 'Upload failed: ' + (err.message || err) });
            }
          };
          input.click();
        }});
      } else if (c.kind === 'shape') {
        items.push({ id: 'shape-kind', label: 'Shape', submenu: [
          { id: 'sk-rect', label: 'Rectangle', run: () => mutators.updateCard?.(c.id, { shape: 'rect' }) },
          { id: 'sk-ellipse', label: 'Ellipse', run: () => mutators.updateCard?.(c.id, { shape: 'ellipse' }) },
          { id: 'sk-line', label: 'Line', run: () => mutators.updateCard?.(c.id, { shape: 'line' }) },
          { id: 'sk-arrow', label: 'Arrow', run: () => mutators.updateCard?.(c.id, { shape: 'arrow' }) },
          { id: 'sk-diamond', label: 'Diamond', run: () => mutators.updateCard?.(c.id, { shape: 'diamond' }) },
          { id: 'sk-triangle', label: 'Triangle', run: () => mutators.updateCard?.(c.id, { shape: 'triangle' }) },
          { id: 'sk-hex', label: 'Hexagon', run: () => mutators.updateCard?.(c.id, { shape: 'hexagon' }) },
          { id: 'sk-star', label: 'Star', run: () => mutators.updateCard?.(c.id, { shape: 'star' }) },
        ]});
        items.push({ id: 'shape-stroke', label: 'Stroke color…', run: () => {
          setPicker({
            value: c.stroke || '#f5f5f6',
            onChange: (col) => mutators.updateCard?.(c.id, { stroke: col }),
            x: ctx.x, y: ctx.y, allowTransparent: false,
          });
        }});
        items.push({ id: 'shape-fill', label: 'Fill color…', run: () => {
          setPicker({
            value: c.fill && c.fill !== 'transparent' ? c.fill : '#1c1c1f',
            onChange: (col) => mutators.updateCard?.(c.id, { fill: col }),
            x: ctx.x, y: ctx.y, allowTransparent: true,
          });
        }});
        items.push({ id: 'shape-strokew', label: 'Stroke width…', submenu: [
          { id: 'sw-1', label: '1 px', run: () => mutators.updateCard?.(c.id, { strokeWidth: 1 }) },
          { id: 'sw-2', label: '2 px', run: () => mutators.updateCard?.(c.id, { strokeWidth: 2 }) },
          { id: 'sw-4', label: '4 px', run: () => mutators.updateCard?.(c.id, { strokeWidth: 4 }) },
          { id: 'sw-8', label: '8 px', run: () => mutators.updateCard?.(c.id, { strokeWidth: 8 }) },
        ]});
      } else if (c.kind === 'board') {
        items.push({ id: 'open', label: 'Open board', run: () => onOpenBoard(c.id) });
        const target = boards[c.id];
        if (target && personalWorkspaceId && target.workspace_id !== personalWorkspaceId) {
          items.push({ id: 'clone', label: 'Copy to my workspace', run: () => mutators.cloneBoardToPersonal?.(c.id) });
        }
      } else if (c.kind === 'boardlink') {
        items.push({ id: 'open', label: 'Open linked board', run: () => boards[c.target] && onOpenBoard(c.target) });
      } else if (c.kind === 'link') {
        items.push({ id: 'edit-title', label: c.title ? 'Edit title' : 'Add title', run: () => {
          triggerInlineEdit(c.id, 'title');
        }});
        if (c.source || c.link) {
          items.push({ id: 'open', label: 'Open link', run: () => {
            const url = c.link || c.source;
            window.open(url.startsWith('http') ? url : `https://${url}`, '_blank', 'noopener');
          }});
        }
      }
      if (items.length > 0) items.push({ divider: true });
    }

    items.push({ id: 'cut', label: multi ? `Cut (${selected.size})` : 'Cut', shortcut: `${cmdKey}X`, run: doCut });
    items.push({ id: 'copy', label: multi ? `Copy (${selected.size})` : 'Copy', shortcut: `${cmdKey}C`, run: doCopy });
    items.push({ id: 'duplicate', label: multi ? `Duplicate (${selected.size})` : 'Duplicate', shortcut: `${cmdKey}D`, run: doDuplicate });
    items.push({ id: 'front', label: 'Bring to front', run: () => {
      const ids = multi ? [...selected] : [c.id];
      ids.forEach(id => mutators.bringToFront?.(id));
    }});
    items.push({ divider: true });
    items.push({ id: 'delete', label: multi ? `Delete (${selected.size})` : 'Delete',
      shortcut: '⌫', danger: true,
      run: () => doDeleteIds(multi ? [...selected] : [c.id]) });
    return items;
  };

  // ── Background pointer + context ──────────────────────────────────────────
  const onBackgroundPointerDown = (e) => {
    if (e.button === 1) { startPan(e); return; }
    if (e.button !== 0) return;
    if (e.target.closest('.cnv-tool, .cnv-tools, .cnv-zoom, .inbox, .ctx-menu, .cnv-hint, .modal-bg, .tob')) return;

    setAddMenuOpen(false);
    closeCardMenu();
    setBgCtx(b => ({ ...b, open: false }));

    if (spaceDown || selectedTool === 'pan') { startPan(e); return; }

    // Drawing
    if (selectedTool === 'draw') {
      e.preventDefault();
      const start = clientToCanvas(e.clientX, e.clientY);
      const points = [[start.x, start.y]];
      if (drawOptions.mode === 'eraser') {
        const radius = Math.max(4, (drawOptions.eraserWidth || ERASER_DEFAULT_WIDTH) / 2);
        setActiveStroke({ color: 'rgba(239,68,68,.75)', width: radius * 2, points: [...points], eraser: true });
        const onMove = (ev) => {
          const p = clientToCanvas(ev.clientX, ev.clientY);
          const last = points[points.length - 1];
          if (Math.hypot(p.x - last[0], p.y - last[1]) < 1.5) return;
          points.push([Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]);
          setActiveStroke({ color: 'rgba(239,68,68,.75)', width: radius * 2, points: [...points], eraser: true });
        };
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          if (points.length > 1) {
            const next = [];
            (strokes || []).forEach(stroke => {
              next.push(...splitStrokeByEraser(stroke, points, radius));
            });
            mutators.replaceStrokes?.(next);
            setSelectedStrokes(new Set());
          }
          setActiveStroke(null);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        return;
      }
      const { color, width } = drawOptions;
      setActiveStroke({ color, width, points: [...points] });
      const onMove = (ev) => {
        const p = clientToCanvas(ev.clientX, ev.clientY);
        const last = points[points.length - 1];
        if (Math.hypot(p.x - last[0], p.y - last[1]) < 1.5) return;
        points.push([Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]);
        setActiveStroke({ color, width, points: [...points] });
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (points.length > 1) mutators.addStroke?.({ color, width, points });
        setActiveStroke(null);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      return;
    }

    // Free-arrow drag (arrow tool, click+drag on empty canvas)
    if (selectedTool === 'arrow' && !arrowFrom) {
      const startC = clientToCanvas(e.clientX, e.clientY);
      let moved = false;
      const startClient = { x: e.clientX, y: e.clientY };
      const onMove = (ev) => {
        if (!moved && Math.abs(ev.clientX - startClient.x) < 4 && Math.abs(ev.clientY - startClient.y) < 4) return;
        moved = true;
        const p = clientToCanvas(ev.clientX, ev.clientY);
        setActiveFreeArrow({ from: startC, to: p });
      };
      const onUp = (ev) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (moved) {
          const end = clientToCanvas(ev.clientX, ev.clientY);
          mutators.addFreeArrow?.({ x: startC.x, y: startC.y }, { x: end.x, y: end.y }, arrowOptions);
        }
        setActiveFreeArrow(null);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      return;
    }

    // Other "place a thing" tools
    // Shape tool: click-and-drag to define bounds (Illustrator-style).
    // A simple click without drag drops a default-sized shape.
    if (selectedTool === 'shape') {
      e.preventDefault();
      const startC = clientToCanvas(e.clientX, e.clientY);
      const startClient = { x: e.clientX, y: e.clientY };
      let moved = false;
      let lastBounds = null;
      const onMove = (ev) => {
        if (!moved && Math.abs(ev.clientX - startClient.x) < 4 && Math.abs(ev.clientY - startClient.y) < 4) return;
        moved = true;
        const cur = clientToCanvas(ev.clientX, ev.clientY);
        let w = cur.x - startC.x, h = cur.y - startC.y;
        // Shift = constrain to square
        if (ev.shiftKey) {
          const m = Math.max(Math.abs(w), Math.abs(h));
          w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m;
        }
        lastBounds = {
          x: Math.min(startC.x, startC.x + w),
          y: Math.min(startC.y, startC.y + h),
          w: Math.abs(w), h: Math.abs(h),
        };
        setActiveShape(lastBounds);
      };
      const onUp = (ev) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (moved && lastBounds && lastBounds.w > 6 && lastBounds.h > 6) {
          // Create at the bounds (NOT centered on click point)
          const id = `shape-${Date.now()}`;
          mutators.addCard?.({
            id, kind: 'shape',
            shape: shapeOptions.shape || 'rect',
            stroke: shapeOptions.stroke || '#f5f5f6',
            fill: shapeOptions.fill || 'transparent',
            strokeWidth: shapeOptions.strokeWidth || 2,
            dash: shapeOptions.dash || 'solid',
            x: Math.round(lastBounds.x),
            y: Math.round(lastBounds.y),
            w: Math.round(lastBounds.w),
            h: Math.round(lastBounds.h),
          });
        } else {
          // Simple click — drop default-sized at click point
          mutators.addShape?.(startC, shapeOptions);
        }
        // Now that the shape is committed, push its colors into the recent
        // list. The picker that selected them ran with disableRecent=true.
        if (shapeOptions.stroke) addRecentColor(shapeOptions.stroke);
        if (shapeOptions.fill && shapeOptions.fill !== 'transparent') addRecentColor(shapeOptions.fill);
        setActiveShape(null);
        setSelectedTool('select');
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      return;
    }

    if (selectedTool !== 'select') {
      const pos = clientToCanvas(e.clientX, e.clientY);
      if (selectedTool === 'board')   { mutators.addNewBoard?.(pos);  setSelectedTool('select'); return; }
      if (selectedTool === 'image')   { mutators.addImageAt?.(pos);   setSelectedTool('select'); return; }
      if (selectedTool === 'text')    { mutators.addNote?.(pos);      setSelectedTool('select'); return; }
      if (selectedTool === 'palette') { mutators.addPalette?.(pos);   setSelectedTool('select'); return; }
      return;
    }

    // Select tool: marquee
    const startClient = { x: e.clientX, y: e.clientY };
    const startCanvas = clientToCanvas(e.clientX, e.clientY);
    setMarquee({ x0: startCanvas.x, y0: startCanvas.y, x1: startCanvas.x, y1: startCanvas.y });
    const wasShift = e.shiftKey;
    const initialSelection = wasShift ? new Set(selected) : null;
    if (!wasShift) {
      setSelected(new Set());
      setSelectedStrokes(new Set());
      setSelectedArrows(new Set());
    }

    let moved = false;
    const onMove = (ev) => {
      const dxClient = ev.clientX - startClient.x;
      const dyClient = ev.clientY - startClient.y;
      if (!moved && Math.abs(dxClient) < 3 && Math.abs(dyClient) < 3) return;
      moved = true;
      const cur = clientToCanvas(ev.clientX, ev.clientY);
      setMarquee(prev => prev ? { ...prev, x1: cur.x, y1: cur.y } : null);
    };
    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (moved) {
        const cur = clientToCanvas(ev.clientX, ev.clientY);
        const minX = Math.min(startCanvas.x, cur.x);
        const maxX = Math.max(startCanvas.x, cur.x);
        const minY = Math.min(startCanvas.y, cur.y);
        const maxY = Math.max(startCanvas.y, cur.y);
        const rect = { minX, maxX, minY, maxY };
        const hits = (cards || [])
          .filter(c => c.x < maxX && c.x + c.w > minX && c.y < maxY && c.y + c.h > minY)
          .map(c => c.id);
        const strokeHits = (strokes || [])
          .map((stroke, index) => strokeIntersectsRect(stroke, rect) ? index : null)
          .filter(index => index !== null);
        const arrowHits = (arrows || [])
          .map((arrow, index) => {
            const fc = resolveCenter(arrow.from), tc = resolveCenter(arrow.to);
            const s = resolveEdge(arrow.from, tc.x, tc.y), e = resolveEdge(arrow.to, fc.x, fc.y);
            return (pointInRect(s, rect) || pointInRect(e, rect) ||
              (Math.min(s.x, e.x) <= rect.maxX && Math.max(s.x, e.x) >= rect.minX &&
               Math.min(s.y, e.y) <= rect.maxY && Math.max(s.y, e.y) >= rect.minY)) ? index : null;
          })
          .filter(index => index !== null);
        const next = new Set(initialSelection || []);
        hits.forEach(id => next.add(id));
        setSelected(next);
        setSelectedStrokes(new Set(strokeHits));
        setSelectedArrows(new Set(arrowHits));
      }
      setMarquee(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onBackgroundContextMenu = (e) => {
    if (e.target.closest('.card, .cnv-tool, .cnv-zoom, .inbox')) return;
    e.preventDefault();
    closeCardMenu();
    const pos = clientToCanvas(e.clientX, e.clientY);
    setBgCtx({ open: true, x: e.clientX, y: e.clientY, canvasPos: pos });
  };
  const closeBgMenu = () => setBgCtx(b => ({ ...b, open: false }));

  const buildBgMenu = () => {
    const pos = bgCtx.canvasPos || lastMouseCanvasRef.current;
    return [
      { id: 'add', label: 'Add', submenu: [
        { id: 'board', label: 'Board',  run: () => mutators.addNewBoard?.(pos) },
        { id: 'image', label: 'Image',  run: () => mutators.addImageAt?.(pos) },
        { id: 'note',  label: 'Text note', run: () => mutators.addNote?.(pos) },
        { id: 'doc',   label: 'Doc',    run: () => mutators.addDocCard?.(pos) },
        { id: 'shape', label: 'Shape',  run: () => mutators.addShape?.(pos, shapeOptions) },
        { id: 'palette', label: 'Color palette', run: () => mutators.addPalette?.(pos) },
      ]},
      { divider: true },
      { id: 'paste', label: clipboardSize() ? `Paste (${clipboardSize()})` : 'Paste',
        shortcut: `${cmdKey}V`, disabled: clipboardSize() === 0,
        run: () => doPaste(pos) },
      { id: 'selectall', label: 'Select all', shortcut: `${cmdKey}A`, run: selectAll },
      { divider: true },
      { id: 'bg', label: 'Background', submenu: [
        { id: 'bg-default', swatch: 'transparent', label: 'Default', run: () => mutators.setBoardBgColor?.(null) },
        { id: 'bg-paper',   swatch: '#f5f2ec', label: 'Paper',   run: () => mutators.setBoardBgColor?.('#f5f2ec') },
        { id: 'bg-mid',     swatch: '#0a1428', label: 'Midnight',run: () => mutators.setBoardBgColor?.('#0a1428') },
        { id: 'bg-mauve',   swatch: '#1d1822', label: 'Mauve',   run: () => mutators.setBoardBgColor?.('#1d1822') },
        { id: 'bg-cream',   swatch: '#fef7ec', label: 'Cream',   run: () => mutators.setBoardBgColor?.('#fef7ec') },
        { id: 'bg-sage',    swatch: '#e8f0e6', label: 'Sage',    run: () => mutators.setBoardBgColor?.('#e8f0e6') },
        { id: 'bg-charcoal',swatch: '#1a1a1a', label: 'Charcoal',run: () => mutators.setBoardBgColor?.('#1a1a1a') },
        { divider: true },
        { id: 'bg-custom',  label: 'Custom…', run: () => {
          setPicker({
            value: board.bg_color || '#1c1c1f',
            onChange: (c) => mutators.setBoardBgColor?.(c),
            x: bgCtx.x, y: bgCtx.y,
            allowTransparent: false,
          });
        }},
      ]},
      { divider: true },
      { id: 'fit', label: 'Reset zoom (⌘0)', run: () => { enableSmoothTransform(); setZoom(1); setPan({ x: 40, y: 60 }); } },
      { id: 'clearstrokes', label: 'Clear all drawings', disabled: !(strokes && strokes.length > 0),
        danger: true, run: () => mutators.clearStrokes?.() },
    ];
  };

  // ── Card double-click ─────────────────────────────────────────────────────
  // For images we let the card itself handle dbl-click (focus title editor).
  // For boards: only the cover area triggers open — title/meta dbl-click
  // does nothing (so accidental clicks near the title don't navigate).
  const onCardDoubleClick = (e, c) => {
    if (e.target.isContentEditable) return;
    if (e.target.closest && e.target.closest('.editable')) return;
    if (c.kind === 'board') {
      if (e.target.closest && e.target.closest('.bc-cover')) onOpenBoard(c.id);
      return;
    }
    if (c.kind === 'boardlink') { boards[c.target] && onOpenBoard(c.target); return; }
    // image / note / link / etc — defer to inner editors so dbl-click
    // re-enters edit mode reliably. (Open link via the link-card icon or
    // right-click → Open instead.)
  };

  // Cards that support rotation. Excludes board / boardlink (their click
  // semantics get muddled when rotated) — easy to add later.
  const ROTATABLE = new Set(['shape', 'note', 'image', 'link', 'doc', 'palette']);

  // ── Render a card ─────────────────────────────────────────────────────────
  // Live "would-be-selected" preview while marqueeing — show the soleil
  // selection ring on cards under the active marquee box so the user sees
  // exactly what they're highlighting before pointerup commits.
  const marqueePreviewIds = (() => {
    if (!marquee) return null;
    const minX = Math.min(marquee.x0, marquee.x1);
    const maxX = Math.max(marquee.x0, marquee.x1);
    const minY = Math.min(marquee.y0, marquee.y1);
    const maxY = Math.max(marquee.y0, marquee.y1);
    if (Math.abs(maxX - minX) < 3 && Math.abs(maxY - minY) < 3) return null;
    const out = new Set();
    for (const c of (cards || [])) {
      if (c.x < maxX && c.x + c.w > minX && c.y < maxY && c.y + c.h > minY) out.add(c.id);
    }
    return out;
  })();

  const renderCard = (c) => {
    const inDrag = drag && drag.ids.includes(c.id);
    const dragDelta = inDrag ? drag : null;
    const resizeDelta = (resize && resize.id === c.id) ? resize : null;
    // If a peer is currently dragging this card, override (x, y) with their
    // awareness-reported live position so we see the card move in realtime.
    // Local drag still wins (we never read peer position for our own drag).
    const peerDrag = !inDrag ? peerDrags[c.id] : null;
    const x = peerDrag ? peerDrag.x : (c.x + (dragDelta?.dx || 0));
    const y = peerDrag ? peerDrag.y : (c.y + (dragDelta?.dy || 0));
    const w = Math.max(MIN_W, c.w + (resizeDelta?.dw || 0));
    const h = Math.max(MIN_H, c.h + (resizeDelta?.dh || 0));
    const isSelected = selected.has(c.id)
      || (marqueePreviewIds && marqueePreviewIds.has(c.id))
      || arrowFrom === c.id;
    const rotation = (rotateState && rotateState.id === c.id ? rotateState.rot : c.rotation) || 0;
    const canRotate = ROTATABLE.has(c.kind);

    const wrapperStyle = {
      position: 'absolute', left: x, top: y, width: w, height: h, zIndex: c.z || 0,
    };
    if (rotation) {
      wrapperStyle.transform = `rotate(${rotation}deg)`;
      wrapperStyle.transformOrigin = 'center center';
    }
    const wrapper = {
      style: wrapperStyle,
      className: `card ${isSelected ? 'is-selected' : ''} ${inDrag ? 'is-dragging' : ''} ${arrowFrom === c.id ? 'is-arrow-source' : ''}`,
      'data-card-id': c.id,
      onPointerDown: (e) => onCardPointerDown(e, c),
      onContextMenu: (e) => onCardContextMenu(e, c),
      onDoubleClick: (e) => onCardDoubleClick(e, c),
    };

    const onUpdate = (patch) => mutators.updateCard?.(c.id, patch);
    const af = (autoFocusId === c.id);

    let inner = null;
    if (c.kind === 'board') {
      const target = boards[c.id];
      const peersHere  = peersHereByBoard?.get?.(c.id)  || [];
      const peersBelow = peersBelowByBoard?.get?.(c.id) || [];
      inner = target
        ? <BoardCard board={target} boards={boards} teammates={TEAMMATES}
                     peersHere={peersHere} peersBelow={peersBelow}
                     onOpenChild={(childId) => onOpenBoard(childId)}
                     onOpenItem={(item) => {
                       // Image rows pop a lightbox so users can preview without
                       // diving into the list board. Returning true tells
                       // BoardCard we handled it; falsy → BoardCard's fallback.
                       if (item.kind === 'image' && item.src) {
                         setLightbox({ src: item.src, title: item.name });
                         return true;
                       }
                       return false;
                     }}
                     onRename={(name) => mutators.renameBoardById?.(c.id, name)}
                     autoFocus={af} />
        : <div className="bc bc-missing">Missing board</div>;
    } else if (c.kind === 'boardlink') {
      const target = boards[c.target];
      inner = <BoardLinkCard targetBoard={target} note={c.note} onOpen={() => target && onOpenBoard(c.target)} />;
    } else if (c.kind === 'image')   inner = <ImageCard src={c.src} tone={c.tone} label={c.label} title={c.title} link={c.link} aspect={`${c.w}/${c.h}`} caption={c.caption} onUpdate={onUpdate} autoFocus={af}
                                                     editTitleAt={editFieldSignal.id === c.id && editFieldSignal.field === 'title' ? editFieldSignal.n : 0}
                                                     editCaptionAt={editFieldSignal.id === c.id && editFieldSignal.field === 'caption' ? editFieldSignal.n : 0}
                                                     onAfterEdit={() => { setSelected(new Set()); setAutoFocusId(null); }} />;
    else if (c.kind === 'note')      inner = <NoteCard body={c.body} html={c.html} bgColor={c.bgColor} textColor={c.textColor} onUpdate={onUpdate} autoFocus={af}
                                                manuallyResized={!!c.manuallyResized}
                                                awareness={getAwareness?.() || null}
                                                cardId={c.id} boardId={board.id}
                                                peerLiveHtml={peerNoteEdits[c.id] ?? null}
                                                onEditingChange={(editing) => setEditingNoteId(editing ? c.id : (prev => (prev === c.id ? null : prev)))} />;
    else if (c.kind === 'link')      inner = <LinkCard title={c.title} source={c.source} onUpdate={onUpdate} autoFocus={af}
                                                       editTitleAt={editFieldSignal.id === c.id && editFieldSignal.field === 'title' ? editFieldSignal.n : 0} />;
    else if (c.kind === 'palette')   inner = <PaletteCard title={c.title} swatches={c.swatches} onUpdate={onUpdate} autoFocus={af} />;
    else if (c.kind === 'doc') {
      // Rich doc card. Pull the live cardYMap so RichDocCard can read its
      // per-card pages/content/bookmarks/comments via cardScope().
      const cardYMap = ydoc?.getMap('cards')?.get(c.id);
      // Legacy 'doc' cards (from inbox / static-doc days) won't have
      // docPages/etc. initialized — fall back to a stub render.
      const isRich = !!cardYMap?.get('docPages');
      inner = isRich ? (
        <RichDocCard card={c} ydoc={ydoc} cardYMap={cardYMap}
                     workspaceId={workspaceId} userId={userId}
                     boards={boards}
                     getAwareness={undefined}
                     currentUser={undefined}
                     autoFocus={af}
                     onUpdate={onUpdate} />
      ) : <DocCard title={c.title} lines={c.lines} author={c.author} date={c.date} onUpdate={onUpdate} autoFocus={af} />;
    }
    else if (c.kind === 'schedule')  inner = <ScheduleCard title={c.title} rows={c.rows} />;
    else if (c.kind === 'shape')     inner = <ShapeCard shape={c.shape} stroke={c.stroke} fill={c.fill} strokeWidth={c.strokeWidth} dash={c.dash} />;
    else inner = <div className="card-unknown">{c.kind}</div>;

    return (
      <div key={c.id} {...wrapper}>
        {inner}
        {selectedTool === 'select' && (
          <div className="card-resize" onPointerDown={(e) => onResizePointerDown(e, c)}
               style={{ width: RESIZE_HANDLE_PX, height: RESIZE_HANDLE_PX }} />
        )}
        {selectedTool === 'select' && isSelected && canRotate && (
          <div className="card-rotate" onPointerDown={(e) => onRotatePointerDown(e, c)} title="Drag to rotate (shift = 15° steps)" />
        )}
      </div>
    );
  };

  // ── HTML5 drag-drop ───────────────────────────────────────────────────────
  const handleDragOver = (e) => {
    const types = e.dataTransfer.types;
    if (!types.includes(INBOX_MIME) &&
        !types.includes(BOARD_REF_MIME) &&
        !types.includes(CARD_TRANSFER_MIME) &&
        !types.includes('application/x-soleil-doc-page') &&
        !types.includes('text/uri-list') &&
        !types.includes('Files')) return;
    e.preventDefault();
    // Cross-pane card transfer defaults to MOVE; hold ⌘/Ctrl to copy.
    if (types.includes(CARD_TRANSFER_MIME)) {
      e.dataTransfer.dropEffect = (e.metaKey || e.ctrlKey) ? 'copy' : 'move';
    } else {
      e.dataTransfer.dropEffect = 'copy';
    }
    if (!dragOver) setDragOver(true);
  };
  const handleDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDragOver(false);
  };
  const handleDrop = async (e) => {
    setDragOver(false);
    const types = e.dataTransfer.types;
    const { x: cx, y: cy } = clientToCanvas(e.clientX, e.clientY);

    // Doc page → boardlink to the doc (page-level deep link reserved for later).
    if (types.includes('application/x-soleil-doc-page')) {
      e.preventDefault();
      let payload;
      try { payload = JSON.parse(e.dataTransfer.getData('application/x-soleil-doc-page')); }
      catch (_) { return; }
      if (!payload?.boardId) return;
      const w = 220, h = 160;
      mutators.addCard?.({
        id: `xlink-${Date.now()}`,
        kind: 'boardlink', target: payload.boardId,
        note: payload.pageName ? `Doc · ${payload.pageName}` : null,
        x: Math.max(8, Math.round(cx - w / 2)),
        y: Math.max(8, Math.round(cy - h / 2)),
        w, h,
      });
      return;
    }

    // Plain URL drag (e.g. from a list-board link row, browser address bar).
    if (types.includes('text/uri-list')) {
      e.preventDefault();
      const url = e.dataTransfer.getData('text/uri-list').split('\n')[0]?.trim();
      if (!url) return;
      const w = 280, h = 130;
      mutators.addCard?.({
        id: `link-${Date.now()}`,
        kind: 'link', source: url, link: url, title: url,
        x: Math.max(8, Math.round(cx - w / 2)),
        y: Math.max(8, Math.round(cy - h / 2)),
        w, h,
      });
      return;
    }

    // Sidebar board → drop a board card pointing at it.
    if (types.includes(BOARD_REF_MIME)) {
      e.preventDefault();
      let payload;
      try { payload = JSON.parse(e.dataTransfer.getData(BOARD_REF_MIME)); }
      catch (_) { return; }
      if (!payload?.boardId) return;
      const w = 280, h = 220;
      mutators.addCard?.({
        id: payload.boardId, kind: 'board',
        x: Math.max(8, Math.round(cx - w / 2)),
        y: Math.max(8, Math.round(cy - h / 2)),
        w, h,
      });
      return;
    }

    // Card moved/copied across panes (or within the same canvas — harmless).
    if (types.includes(CARD_TRANSFER_MIME)) {
      e.preventDefault();
      let payload;
      try { payload = JSON.parse(e.dataTransfer.getData(CARD_TRANSFER_MIME)); }
      catch (_) { return; }
      if (!payload?.card) return;
      const isCopy = e.metaKey || e.ctrlKey;
      const c = { ...payload.card };
      // Re-id unless we're moving (same id is fine for move, but using a
      // new id is safest if it's the same board → would otherwise clobber).
      if (isCopy || payload.sourceBoardId === board.id) {
        c.id = `${c.kind || 'card'}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      }
      c.x = Math.max(8, Math.round(cx - (c.w || 100) / 2));
      c.y = Math.max(8, Math.round(cy - (c.h || 100) / 2));
      // Don't try to "move" board-kind cards across boards — they reference
      // a single postgres board which can't have two parents on one canvas.
      // Just create a boardlink instead.
      if (c.kind === 'board' && payload.sourceBoardId !== board.id) {
        mutators.addCard?.({
          id: `xlink-${Date.now()}`,
          kind: 'boardlink', target: c.id,
          x: c.x, y: c.y, w: c.w || 220, h: c.h || 160,
        });
      } else {
        mutators.addCard?.(c);
      }
      // For move: dispatch a custom event the source canvas listens for to
      // delete itself. Key by the original id + sourceBoardId.
      if (!isCopy) {
        document.dispatchEvent(new CustomEvent('soleil-card-transferred', {
          detail: { sourceBoardId: payload.sourceBoardId, cardId: payload.card.id },
        }));
      }
      return;
    }

    // Inbox item.
    const inboxRaw = e.dataTransfer.getData(INBOX_MIME);
    if (inboxRaw) {
      e.preventDefault();
      let item;
      try { item = JSON.parse(inboxRaw); } catch (_) { return; }
      const card = inboxItemToCard(item, 0, 0);
      if (!card) return;
      card.x = Math.round(cx - card.w / 2);
      card.y = Math.round(cy - card.h / 2);
      onDropInboxItem && onDropInboxItem(item.id, card);
      return;
    }

    // Files (images dragged from Finder).
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      e.preventDefault();
      const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
      let offsetX = 0;
      for (const f of imageFiles) {
        try {
          onDropFileImage && onDropFileImage(await imageFileToPayload(f, cx + offsetX, cy));
          offsetX += 260;
        } catch (err) {
          console.error(err);
          feedback.toast({ type: 'error', message: 'Image upload failed: ' + (err.message || err) });
        }
      }
    }
  };

  // Listen for "card was moved out of this canvas" events so we can delete
  // the source after a successful cross-pane move.
  useEffect(() => {
    const onTransferred = (e) => {
      const { sourceBoardId, cardIds } = e.detail || {};
      if (sourceBoardId !== board.id) return;
      mutators.deleteCards?.(cardIds);
    };
    document.addEventListener('soleil-card-transferred', onTransferred);
    return () => document.removeEventListener('soleil-card-transferred', onTransferred);
  }, [board.id, mutators]);

  // Highlight ourselves as a drop target while another pane's pointer drag
  // is over us. The source pane fires "hover" on every pointermove and "end"
  // on pointerup. We toggle `dragOver` (which already drives is-drop-target).
  useEffect(() => {
    const onHover = (e) => {
      const { sourceBoardId, clientX, clientY } = e.detail || {};
      if (sourceBoardId === board.id) return; // own pane never highlights itself
      const wrap = wrapRef.current; if (!wrap) return;
      const overEl = document.elementFromPoint(clientX, clientY);
      const over = overEl && wrap.contains(overEl);
      setDragOver(prev => over !== prev ? over : prev);
    };
    const onEnd = () => setDragOver(false);
    document.addEventListener('soleil-cross-pane-hover', onHover);
    document.addEventListener('soleil-cross-pane-end', onEnd);
    return () => {
      document.removeEventListener('soleil-cross-pane-hover', onHover);
      document.removeEventListener('soleil-cross-pane-end', onEnd);
    };
  }, [board.id]);

  // Listen for cross-pane drops aimed at THIS canvas (the source canvas
  // emits this event after detecting pointerup over a different .canvas-wrap).
  useEffect(() => {
    const onDrop = (e) => {
      const { sourceBoardId, isCopy, cards: payload, clientX, clientY } = e.detail || {};
      if (!payload?.length || sourceBoardId === board.id) return;
      const wrap = wrapRef.current;
      if (!wrap) return;
      // Only accept if the pointer is actually over THIS wrap.
      const dropEl = document.elementFromPoint(clientX, clientY);
      if (!dropEl || !wrap.contains(dropEl)) return;
      const { x: cx, y: cy } = clientToCanvas(clientX, clientY);
      // Maintain relative positions between the dragged group's items.
      let minX = Infinity, minY = Infinity;
      payload.forEach(c => { if (c.x < minX) minX = c.x; if (c.y < minY) minY = c.y; });
      const newCards = payload.map(c => {
        const isBoard = c.kind === 'board';
        const baseX = (c.x - minX) + (cx - 60);
        const baseY = (c.y - minY) + (cy - 40);
        // Cross-board 'board' cards become 'boardlink' cards instead.
        if (isBoard && !isCopy) {
          return {
            id: `xlink-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
            kind: 'boardlink', target: c.id,
            x: Math.max(8, Math.round(baseX)), y: Math.max(8, Math.round(baseY)),
            w: c.w || 220, h: c.h || 160,
          };
        }
        return {
          ...c,
          id: `${c.kind || 'card'}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
          x: Math.max(8, Math.round(baseX)), y: Math.max(8, Math.round(baseY)),
        };
      });
      mutators.addCards?.(newCards);
      if (!isCopy) {
        // Tell the source canvas to delete the originals.
        document.dispatchEvent(new CustomEvent('soleil-card-transferred', {
          detail: { sourceBoardId, cardIds: payload.map(c => c.id) },
        }));
      }
    };
    document.addEventListener('soleil-cross-pane-drop', onDrop);
    return () => document.removeEventListener('soleil-cross-pane-drop', onDrop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.id, mutators]);

  // ── Toolbar ───────────────────────────────────────────────────────────────
  const tools = [
    { id: 'select', title: 'Select / move (V)', label: 'Select tool', svg: <path d="M5 3 L17 12 L11 13 L13 19 L10 20 L8 14 L4 17 Z" fill="currentColor"/> },
    { id: 'pan',    title: 'Pan canvas (H or Space)', label: 'Pan tool', svg: <path d="M6 13 V8 A1 1 0 0 1 8 8 V11 V6 A1 1 0 0 1 10 6 V11 V5 A1 1 0 0 1 12 5 V11 V7 A1 1 0 0 1 14 7 V13 A4 4 0 0 1 6 13 Z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/> },
    { id: 'text',   title: 'Add note', label: 'Add note tool', svg: <path d="M4 5 H16 M10 5 V16 M8 16 H12" stroke="currentColor" strokeWidth="1.2" fill="none"/> },
    { id: 'image',  title: 'Add image', label: 'Add image tool', svg: <><rect x="3" y="4" width="14" height="11" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none"/><circle cx="7" cy="8" r="1.2" fill="currentColor"/><path d="M3 12 L7 9 L11 12 L14 10 L17 12 V14 H3 Z" fill="currentColor" opacity=".5"/></> },
    { id: 'shape',  title: 'Add shape', label: 'Add shape tool', svg: <rect x="3" y="5" width="14" height="10" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none"/> },
    { id: 'draw',   title: 'Free-draw', label: 'Free-draw tool', svg: <path d="M3 16 L7 13 L13 5 L16 8 L8 16 Z M11 7 L14 10" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinejoin="round"/> },
    { id: 'arrow',  title: 'Arrow - click 2 cards, or drag on empty canvas', label: 'Arrow tool', svg: <path d="M3 10 H15 M12 7 L15 10 L12 13" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round"/> },
  ];

  const addMenuItems = [
    { label: 'Board', action: () => setSelectedTool('board') },
    { label: 'Text note', action: () => setSelectedTool('text') },
    { label: 'Doc', action: () => mutators.addDocCard?.() },
    { label: 'Palette', action: () => setSelectedTool('palette') },
    { label: 'Linked board', action: () => onOpenPicker() },
  ];

  const marqueeRect = marquee && {
    left: Math.min(marquee.x0, marquee.x1),
    top: Math.min(marquee.y0, marquee.y1),
    width: Math.abs(marquee.x1 - marquee.x0),
    height: Math.abs(marquee.y1 - marquee.y0),
  };

  const strokeToPath = (pts) => {
    if (!pts || pts.length === 0) return '';
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) d += ` L${pts[i][0].toFixed(1)},${pts[i][1].toFixed(1)}`;
    return d;
  };

  const isPanMode = spaceDown || selectedTool === 'pan';
  const strokesInteractive = selectedTool === 'select';

  const gz = Math.max(8, 80 * zoom);
  const dz = Math.max(2, 20 * zoom);
  const wrapStyle = {
    '--canvas-bg': board.bg_color || undefined,
    backgroundColor: board.bg_color || undefined,
    backgroundImage: `linear-gradient(to right, var(--grid-line) 1px, transparent 1px), linear-gradient(to bottom, var(--grid-line) 1px, transparent 1px), radial-gradient(circle at center, var(--grid-dot) 1px, transparent 1.5px)`,
    backgroundSize: `${gz}px ${gz}px, ${gz}px ${gz}px, ${dz}px ${dz}px`,
    backgroundPosition: `${pan.x}px ${pan.y}px, ${pan.x}px ${pan.y}px, ${pan.x}px ${pan.y}px`,
  };

  return (
    <div className={`canvas-wrap ${dragOver ? 'is-drop-target' : ''} tool-${selectedTool} ${isPanMode ? 'is-pan' : ''}`}
         ref={wrapRef}
         style={wrapStyle}
         onDragOver={handleDragOver}
         onDragLeave={handleDragLeave}
         onDrop={handleDrop}
         onPointerDown={onBackgroundPointerDown}
         onContextMenu={onBackgroundContextMenu}>
      <CanvasPresence
        getAwareness={getAwareness}
        boardId={board.id}
        pan={pan}
        zoom={zoom}
        selfId={currentUser?.id}
      />
      <div className={`canvas ${smoothXform ? 'is-smooth' : ''}`}
           style={{
             transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
             transformOrigin: '0 0',
           }}>
        <div className="cards-layer">{sortedCards.map(renderCard)}</div>

        {marqueeRect && (
          <div className="marquee" style={marqueeRect} />
        )}

        {activeShape && (
          <div className="shape-preview"
               style={{
                 position: 'absolute',
                 left: activeShape.x, top: activeShape.y,
                 width: activeShape.w, height: activeShape.h,
                 pointerEvents: 'none',
               }}>
            <ShapePreview shape={shapeOptions.shape}
                          stroke={shapeOptions.stroke}
                          fill={shapeOptions.fill}
                          strokeWidth={shapeOptions.strokeWidth}
                          dash={shapeOptions.dash} />
          </div>
        )}

        {/* Arrows layer — visually on top, but the SVG itself doesn't capture
            pointer events. Only the per-arrow hit-target paths have
            pointer-events:stroke when select/erase is active, so cards
            underneath remain clickable. */}
        {tweak.showArrows && (arrows?.length || activeFreeArrow) && (
          <svg className="arrows-layer" width={VIRTUAL_CANVAS_PX} height={VIRTUAL_CANVAS_PX}
               style={{ position: 'absolute', left: 0, top: 0,
                        pointerEvents: 'none',
                        overflow: 'visible' }}>
            {(arrows || []).map((a, i) => {
              const fc = resolveCenter(a.from), tc = resolveCenter(a.to);
              const s = resolveEdge(a.from, tc.x, tc.y), e = resolveEdge(a.to, fc.x, fc.y);
              const dx = e.x - s.x, dy = e.y - s.y;
              const len = Math.hypot(dx, dy) || 1;
              // Tangent at endpoint differs for curved vs straight arrows.
              let path, ux, uy;
              if (a.straight) {
                path = `M${s.x},${s.y} L${e.x},${e.y}`;
                ux = dx/len; uy = dy/len;
              } else {
                const ox = (-dy/len) * Math.min(36, len*0.12);
                const oy = (dx/len) * Math.min(36, len*0.12);
                const cx = (s.x+e.x)/2 + ox, cy = (s.y+e.y)/2 + oy;
                path = `M${s.x},${s.y} Q${cx},${cy} ${e.x},${e.y}`;
                const tdx = e.x - cx, tdy = e.y - cy;
                const tl = Math.hypot(tdx, tdy) || 1;
                ux = tdx/tl; uy = tdy/tl;
              }
              const head = `${e.x},${e.y} ${e.x-ux*9-uy*4},${e.y-uy*9+ux*4} ${e.x-ux*9+uy*4},${e.y-uy*9-ux*4}`;
              // Label position — same offset logic for both styles
              const cx = (s.x+e.x)/2 + (a.straight ? 0 : (-dy/len) * Math.min(36, len*0.12));
              const cy = (s.y+e.y)/2 + (a.straight ? 0 : (dx/len)  * Math.min(36, len*0.12));
              const sel = selectedArrows.has(i);
              return (
                <g key={i}>
                  {/* Hit target — only path with pointer-events; svg root is none. */}
                  <path d={path} fill="none" stroke="transparent" strokeWidth="14"
                        pointerEvents={strokesInteractive ? 'stroke' : 'none'}
                        style={{ cursor: strokesInteractive ? 'pointer' : 'default' }}
                        onPointerDown={strokesInteractive ? (ev) => onArrowClick(ev, i) : undefined} />
                  {sel && <path d={path} fill="none" stroke="rgba(245,158,11,.55)" strokeWidth="6" strokeLinecap="round" pointerEvents="none" />}
                  <path d={path} fill="none" stroke="currentColor" strokeWidth="1.1" opacity=".5"
                        strokeDasharray={a.dashed ? '4 4' : '0'} strokeLinecap="round" pointerEvents="none" />
                  <polygon points={head} fill="currentColor" opacity=".5" pointerEvents="none" />
                  {a.label && (
                    <foreignObject x={cx-70} y={cy-11} width="140" height="22" pointerEvents="none">
                      <div className="arrow-label">{a.label}</div>
                    </foreignObject>
                  )}
                </g>
              );
            })}
            {activeFreeArrow && (() => {
              const s = activeFreeArrow.from, e = activeFreeArrow.to;
              const path = `M${s.x},${s.y} L${e.x},${e.y}`;
              return <path d={path} stroke="rgba(245,158,11,.8)" strokeWidth="1.5" strokeDasharray="4 3" fill="none" pointerEvents="none" />;
            })()}
          </svg>
        )}

        {/* Strokes layer — visually on top of cards, but clicks pass through
            EXCEPT on actual stroke pixels (pointer-events:stroke on hit path). */}
        <svg className="strokes-layer" width={VIRTUAL_CANVAS_PX} height={VIRTUAL_CANVAS_PX}
             style={{ position: 'absolute', left: 0, top: 0,
                      pointerEvents: 'none',
                      overflow: 'visible' }}>
          {(strokes || []).map((s, i) => {
            const sel = selectedStrokes.has(i);
            const w = s.width || DRAW_DEFAULT_WIDTH;
            const path = strokeToPath(s.points);
            const hitW = Math.max(w + STROKE_HIT_PADDING, 14);
            return (
              <g key={i}>
                <path d={path} fill="none" stroke="transparent" strokeWidth={hitW}
                      pointerEvents={strokesInteractive ? 'stroke' : 'none'}
                      style={{ cursor: strokesInteractive ? 'pointer' : 'default' }}
                      onPointerDown={strokesInteractive ? (ev) => onStrokeClick(ev, i) : undefined} />
                {sel && <path d={path} fill="none" stroke="rgba(245,158,11,.55)"
                              strokeWidth={w + 6} strokeLinecap="round" strokeLinejoin="round"
                              pointerEvents="none" />}
                <path d={path} fill="none"
                      stroke={s.color || DRAW_DEFAULT_COLOR}
                      strokeWidth={w}
                      strokeLinecap="round" strokeLinejoin="round"
                      pointerEvents="none" />
              </g>
            );
          })}
          {activeStroke && (
            <path d={strokeToPath(activeStroke.points)} fill="none"
                  stroke={activeStroke.color}
                  strokeWidth={activeStroke.width}
                  strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />
          )}
        </svg>

      </div>

      <div className="cnv-tools">
        <div className="cnv-add-wrap">
          <div
            className={`cnv-tool ${addMenuOpen ? 'active' : ''}`}
            title="Add"
            role="button"
            tabIndex={0}
            aria-label="Add menu"
            aria-expanded={addMenuOpen}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setAddMenuOpen(open => !open);
              } else if (e.key === 'Escape') {
                setAddMenuOpen(false);
              }
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              setAddMenuOpen(open => !open);
            }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M10 4 V16 M4 10 H16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          {addMenuOpen && (
            <div className="cnv-add-menu" role="menu" aria-label="Add">
              {addMenuItems.map(item => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    setAddMenuOpen(false);
                    item.action();
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="cnv-tool-sep" />
        {tools.map(t => (
          <div key={t.id}
               className={`cnv-tool ${selectedTool === t.id ? 'active' : ''}`}
               title={t.title}
               role="button"
               tabIndex={0}
               aria-label={t.label}
               aria-pressed={selectedTool === t.id}
               onKeyDown={(e) => {
                 if (e.key === 'Enter' || e.key === ' ') {
                   e.preventDefault();
                   setSelectedTool(t.id);
                 }
               }}
               onPointerDown={(e) => { e.stopPropagation(); setSelectedTool(t.id); }}>
            <svg width="20" height="20" viewBox="0 0 20 20">{t.svg}</svg>
          </div>
        ))}
      </div>

      {selectedTool === 'arrow' && (
        <div className="cnv-hint">
          {arrowFrom ? 'Click target card to connect' : 'Click a card to start, or drag on empty canvas for a free arrow'}
          <button className="cnv-hint-x" onClick={() => { setSelectedTool('select'); setArrowFrom(null); }}>esc</button>
        </div>
      )}
      {selectedTool === 'draw' && (
        <div className="cnv-hint">{drawOptions.mode === 'eraser' ? 'Drag to erase strokes' : 'Drag to draw'} <button className="cnv-hint-x" onClick={() => setSelectedTool('select')}>esc</button></div>
      )}
      {selectedTool === 'pan' && (
        <div className="cnv-hint">Drag to pan <button className="cnv-hint-x" onClick={() => setSelectedTool('select')}>esc</button></div>
      )}
      {(selectedTool === 'board' || selectedTool === 'image' || selectedTool === 'text' || selectedTool === 'shape' || selectedTool === 'palette') && (
        <div className="cnv-hint">
          Click on the canvas to place a {selectedTool === 'text' ? 'note' : selectedTool}
          <button className="cnv-hint-x" onClick={() => setSelectedTool('select')}>esc</button>
        </div>
      )}
      {(selected.size + selectedStrokes.size + selectedArrows.size) > 1 && (
        <div className="cnv-selcount">{selected.size + selectedStrokes.size + selectedArrows.size} selected</div>
      )}

      <div className="cnv-zoom">
        <button onClick={() => { enableSmoothTransform(); setZoom(z => Math.max(ZOOM_MIN, z / 1.25)); }}>−</button>
        <span className="cnv-zoom-val" title="Reset zoom (⌘0)"
              onClick={() => { enableSmoothTransform(); setZoom(1); setPan({ x: 40, y: 60 }); }}>
          {Math.round(zoom * 100)}%
        </span>
        <button onClick={() => { enableSmoothTransform(); setZoom(z => Math.min(ZOOM_MAX, z * 1.25)); }}>+</button>
      </div>

      <CardContextMenu
        open={ctx.open}
        x={ctx.x}
        y={ctx.y}
        items={ctx.cardId ? buildMenu(cardById[ctx.cardId] || {}) : []}
        onClose={closeCardMenu}
        workspaceId={workspaceId}
        boardId={board?.id}
        card={ctx.cardId ? cardById[ctx.cardId] : null}
      />

      <BackgroundContextMenu
        open={bgCtx.open}
        x={bgCtx.x}
        y={bgCtx.y}
        items={buildBgMenu()}
        onClose={closeBgMenu}
        workspaceId={workspaceId}
        boardId={board?.id}
      />

      <ToolOptionsBar
        selectedTool={selectedTool}
        drawOptions={drawOptions} setDrawOptions={setDrawOptions}
        shapeOptions={shapeOptions} setShapeOptions={setShapeOptions}
        arrowOptions={arrowOptions} setArrowOptions={setArrowOptions}
        editingNoteCard={editingNoteId ? cardById[editingNoteId] : null}
        onUpdateEditingNote={editingNoteId ? (patch) => mutators.updateCard?.(editingNoteId, patch) : null}
        // When exactly one shape card is selected, surface its style controls.
        editingShapeCard={(() => {
          if (selected.size !== 1) return null;
          const id = [...selected][0];
          const c = cardById[id];
          return c && c.kind === 'shape' ? c : null;
        })()}
        onUpdateEditingShape={(patch) => {
          if (selected.size !== 1) return;
          const id = [...selected][0];
          mutators.updateCard?.(id, patch);
        }}
        paletteColors={paletteColors}
        openColorPicker={(opts) => setPicker(opts)}
      />

      {picker && (
        <ColorPicker
          value={picker.value}
          onChange={picker.onChange}
          onClose={() => setPicker(null)}
          position={{ x: picker.x, y: picker.y }}
          allowTransparent={picker.allowTransparent}
          paletteColors={picker.paletteColors || paletteColors}
          palettes={picker.palettes || palettes}
          disableRecent={picker.disableRecent}
        />
      )}
      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)} role="dialog" aria-label="Image preview">
          <button className="lightbox-x" aria-label="Close" onClick={(e) => { e.stopPropagation(); setLightbox(null); }}>×</button>
          <img className="lightbox-img"
               src={lightbox.src}
               alt={lightbox.title || ''}
               onClick={(e) => e.stopPropagation()} />
          {lightbox.title && <div className="lightbox-cap">{lightbox.title}</div>}
        </div>
      )}
    </div>
  );
}
