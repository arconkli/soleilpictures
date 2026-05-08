import { useState, useEffect, useRef, useMemo, useCallback, Fragment } from 'react';
import {
  BoardCard, BoardLinkCard, ImageCard, NoteCard, LinkCard,
  PaletteCard, DocCard, ScheduleCard, ShapeCard, VideoCard,
} from './cards.jsx';
import { RichDocCard } from './DocCard.jsx';

// Reuse ShapeCard as our drag-preview renderer.
const ShapePreview = ShapeCard;
import { LiveCursor, COVER_TINTS } from './primitives.jsx';
import { CanvasPresence } from './CanvasPresence.jsx';
import { CardContextMenu } from './CardContextMenu.jsx';
import { SketchPadOverlay } from './SketchPadOverlay.jsx';
import { BackgroundContextMenu } from './BackgroundContextMenu.jsx';
import { ToolOptionsBar } from './ToolOptionsBar.jsx';
import { ColorPicker } from './ColorPicker.jsx';
import { useFeedback } from './AppFeedback.jsx';
import { Eye, EyeOff, MessageCircle } from '../lib/icons.js';
import { Icon } from './Icon.jsx';
import { TEAMMATES } from '../data.js';
import { INBOX_MIME, BOARD_REF_MIME, CARD_TRANSFER_MIME, ENTITY_REF_MIME, ENTITY_REF_LIST_MIME, inboxItemToCard } from '../lib/dragMimes.js';
import { coerceRef } from '../lib/entityRef.js';
import { uploadImage, uploadVideo } from '../lib/uploads.js';
import { R2Image } from './R2Image.jsx';
import { setClipboard, getClipboard, clipboardSize } from '../lib/clipboard.js';
import { addRecentColor } from '../lib/recentColors.js';
import { relativeTimeShort } from '../lib/relativeTime.js';
import { exportBoardAsPng, exportBoardAsPdf, svgToPngBlob } from '../lib/exportBoard.js';
import { BoardThumbnail } from './BoardThumbnail.jsx';
import { saveBoardTemplate } from '../lib/templatesApi.js';
import { CanvasCommentLayer, CommentArchivePopover } from './CanvasComment.jsx';
import { useCanvasComments } from '../hooks/useCanvasComments.js';
import { addComment, updateComment, unhideAllOnBoard } from '../lib/commentsApi.js';
import { pickCommentOffset, pickCommentOffsetForGroup } from '../lib/commentPlacement.js';
import { TagPicker } from './TagPicker.jsx';
import { useWorkspaceTags } from '../hooks/useWorkspaceTags.js';
import { ensureTag, tagCard, untagCard, tagBoard, untagBoard, tagGroup, untagGroup, confirmAppliedTag, dismissAutotagSuggestion } from '../lib/tagsApi.js';
import { syncCardIndex } from '../lib/boardsApi.js';

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
  board, boards, cards, arrows, strokes, groups = [],
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
  wsPeers = [],            // Workspace peers — passed into doc cards so the
                           // doc-card overlay can render its own peer
                           // avatars + page-tree dots scoped to that card.
  onJumpToPeer,            // (location) => void  — click peer avatar/dot
  canEdit = true,          // false → view-only board: hide drawing tools
                           // and gray the toolbar (RLS is the real defense)
  autotagSuggest,          // (content, target) => Promise<[{tagId,score,reason}]>
  autotagReady = false,    // worker hydration finished
}) {
  const wrapRef = useRef(null);

  // Force one syncCardIndex run when the board opens. card_index
  // only refreshes on yjs edits or tab-close, so a user who just
  // refreshes the page may sit on a stale snapshot indefinitely.
  // syncCardIndex is throttled + idempotent — calling it here is
  // free if it already ran recently, and ensures rich-note text
  // (c.html) gets html-stripped into card_index.body so the tag
  // detail view + suggestion engine see real content.
  useEffect(() => {
    if (!board?.id || !ydoc) return;
    syncCardIndex({ boardId: board.id, ydoc }).catch(() => {});
  }, [board?.id, ydoc]);

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
  // Hidden BoardThumbnail used for PNG/PDF export. Same render path as
  // the canvas card preview, just scaled up at export time.
  const exportSvgRef = useRef(null);
  const [drag, setDrag] = useState(null);
  // While dragging, computeSnap fills this with the matched alignment lines
  // so the canvas can render thin gold guides at those coords.
  // { xs: [{ x, y0, y1 }], ys: [{ y, x0, x1 }] } — both in canvas-space.
  const [snapHints, setSnapHints] = useState(null);
  const [resize, setResize] = useState(null);
  const [rotateState, setRotateState] = useState(null); // { id, rot }
  const [marquee, setMarquee] = useState(null);
  const [arrowFrom, setArrowFrom] = useState(null);
  const [activeStroke, setActiveStroke] = useState(null);
  const [activeFreeArrow, setActiveFreeArrow] = useState(null); // { from:{x,y}, to:{x,y} }
  // Per-card upload progress (cardId → 0..1). Threaded into ImageCard so
  // the spinner overlay can show a percentage while uploading.
  const [uploadProgressById, setUploadProgressById] = useState({});
  // IDs of cards/boards currently highlighted because the user is hovering
  // an EntityLink that points at them. Drives the .is-link-target class
  // so the canvas reflects what the link will navigate to.
  const [linkHoverIds, setLinkHoverIds] = useState(() => new Set());
  // Card-info popover state (right-click → Info). Anchored to the click
  // point. cardId is the card we're showing metadata for.
  const [infoFor, setInfoFor] = useState(null);
  // While dragging cards, this holds the id of the board *card* the user
  // is hovering over — so when they release we can move the dragged cards
  // INTO that board. Drives a .is-card-drop-target class on the matching
  // board card so the affordance is visible.
  const [boardDropTarget, setBoardDropTarget] = useState(null);
  // Eyedropper mode — when set to a palette card id, the next click on
  // an image card on this board samples a pixel and adds it as a swatch
  // to that palette. Escape exits the mode.
  const [eyedropFor, setEyedropFor] = useState(null);
  // Sketch pad — full-screen overlay drawing modal. When closed with
  // strokes, they're committed to the current board's strokes Y.Array.
  const [sketchpadOpen, setSketchpadOpen] = useState(false);
  // Local-only blob URL previews keyed by cardId. We don't write blob URLs
  // into the Yjs doc (peers can't resolve them), so the optimistic preview
  // lives here and is passed to ImageCard as a fallback src until the
  // upload finishes and the real R2 url lands in the doc.
  const [localImagePreview, setLocalImagePreview] = useState({});

  // Listen for the EntityLink hover broadcast and translate the refs into
  // a set of card/board ids on this board, so we can ring-highlight them.
  useEffect(() => {
    const onHover = (e) => {
      const refs = e?.detail;
      if (!refs || !refs.length) { setLinkHoverIds(new Set()); return; }
      const ids = new Set();
      for (const r of refs) {
        if (!r) continue;
        if (r.kind === 'card' && r.cardId) ids.add(r.cardId);
        if (r.kind === 'board' && r.id) ids.add(r.id);
        if (r.kind === 'doc' && r.docCardId) ids.add(r.docCardId);
        if (r.kind === 'docPos' && r.docCardId) ids.add(r.docCardId);
      }
      setLinkHoverIds(ids);
    };
    window.addEventListener('soleil:link-hover', onHover);
    return () => window.removeEventListener('soleil:link-hover', onHover);
  }, []);

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
  // We also broadcast stroke + arrow selections so peers see *every*
  // primitive a user is acting on, not just card cards.
  useEffect(() => {
    const aw = getAwareness?.();
    if (!aw) return;
    const ids = [...selected];
    const strokeIds = [...selectedStrokes];
    const arrowIds = [...selectedArrows];
    const empty = ids.length === 0 && strokeIds.length === 0 && arrowIds.length === 0;
    aw.setLocalStateField('canvasSelection', empty
      ? null
      : { boardId: board.id, cardIds: ids, strokeIds, arrowIds });
  }, [getAwareness, board.id, selected, selectedStrokes, selectedArrows]);

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

  // Auto-fit camera on board open. We can't depend on `cards` directly
  // (would re-fit every time anyone moves a card); instead, fit once per
  // board change, the first time cards becomes non-empty after opening
  // it. fitOnceForRef stores the board id we've already fit so a return
  // visit re-fits and intra-session moves don't disrupt the user's pan.
  const fitOnceForRef = useRef(null);
  useEffect(() => {
    fitOnceForRef.current = null; // new board → arm fit
    setPan({ x: 40, y: 60 });
    setZoom(1);
  }, [board.id]);
  useEffect(() => {
    if (!wrapRef.current) return;
    if (!cards) return;
    if (fitOnceForRef.current === board.id) return;
    if (cards.length === 0) return; // wait for Yjs sync
    const r = wrapRef.current.getBoundingClientRect();
    // Defer if the canvas wrap hasn't measured yet — re-runs next time
    // cards change (or once a layout pass lands the rect dimensions).
    if (r.width < 50 || r.height < 50) return;
    fitOnceForRef.current = board.id;
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
    enableSmoothTransform();
    setZoom(z);
    setPan({
      x: (r.width  - contentW * z) / 2 - minX * z,
      y: (r.height - contentH * z) / 2 - minY * z,
    });
  }, [cards, board.id]);

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

  // groupId → array of member cards. Drives the group-outline render
  // and the drag-together logic. Also used by "Ungroup" / "Toggle
  // outline" menu actions to know whether a card is in a group.
  const cardsByGroup = useMemo(() => {
    const m = new Map();
    for (const c of (cards || [])) {
      if (!c.groupId) continue;
      if (!m.has(c.groupId)) m.set(c.groupId, []);
      m.get(c.groupId).push(c);
    }
    return m;
  }, [cards]);
  const groupById = useMemo(() => {
    const m = {}; (groups || []).forEach(g => m[g.id] = g); return m;
  }, [groups]);
  // Expand any selection / drag set to include all groupmates of any
  // card whose group has 2+ visible members. Single-orphan group
  // members aren't expanded — orphaned groups just behave like
  // single cards.
  const expandWithGroupmates = (ids) => {
    const out = new Set(ids);
    for (const id of ids) {
      const c = cardById[id];
      if (!c?.groupId) continue;
      const members = cardsByGroup.get(c.groupId);
      if (!members || members.length < 2) continue;
      for (const m of members) out.add(m.id);
    }
    return out;
  };

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

  // Inverse of clientToCanvas — returns viewport-relative pixel coords for
  // a canvas-space point. Used by the comments layer to anchor floating
  // bubbles correctly under live pan/zoom.
  const canvasToViewport = useCallback((cx, cy) => ({
    x: cx * zoom + pan.x,
    y: cy * zoom + pan.y,
  }), [pan.x, pan.y, zoom]);

  const imageFileToPayload = useCallback(async (file, x, y) => {
    if (useLocalImages) {
      const dims = await readImageDims(file);
      return { publicUrl: dims.url, width: dims.width, height: dims.height, x, y };
    }
    // Used by the "replace image" path on existing cards — keeps the
    // synchronous-await contract since there's no card to add.
    const up = await uploadImage({ file, workspaceId, boardId: board?.id, userId });
    return { publicUrl: up.src, width: up.width, height: up.height, x, y };
  }, [useLocalImages, workspaceId, board?.id, userId]);

  // Optimistic image drop/paste. Adds the card immediately with a local
  // blob URL + pending:true so the user sees their image right away (and
  // can already drag/select it), then uploads in the background. When the
  // upload resolves we patch the card with the real R2 url and clear
  // pending. On failure, we drop the card and toast the error.
  const optimisticDropImage = useCallback(async (file, cx, cy) => {
    if (!file) return;
    if (useLocalImages) {
      // Local QA path — no upload. Just add the card directly.
      try {
        const dims = await readImageDims(file);
        onDropFileImage?.({ publicUrl: dims.url, width: dims.width, height: dims.height, x: cx, y: cy });
      } catch (err) {
        feedback.toast({ type: 'error', message: 'Image failed: ' + (err.message || err) });
      }
      return;
    }
    let blobUrl = null;
    try { blobUrl = URL.createObjectURL(file); } catch (_) {}
    let dims = { width: 0, height: 0 };
    try { dims = await readImageDims(file); } catch (_) {}
    let w = 240, h = 200;
    if (dims.width && dims.height) {
      const ar = dims.width / dims.height;
      if (ar >= 1) { w = 280; h = Math.round(280 / ar); }
      else { h = 240; w = Math.round(240 * ar); }
      h = Math.max(80, Math.min(360, h));
      w = Math.max(80, Math.min(420, w));
    }
    const id = `img-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    if (blobUrl) setLocalImagePreview(prev => ({ ...prev, [id]: blobUrl }));
    // src omitted here — blob URLs aren't useful to peers, so we keep the
    // doc clean and let localImagePreview drive the local view.
    mutators.addCard?.({
      id, kind: 'image',
      x: Math.max(8, Math.round(cx - w / 2)),
      y: Math.max(8, Math.round(cy - h / 2)),
      w, h,
      pending: true,
    });
    try {
      const onProgress = (frac) => {
        setUploadProgressById(prev => ({ ...prev, [id]: frac }));
      };
      const up = await uploadImage({ file, workspaceId, boardId: board?.id, userId, onProgress });
      mutators.updateCard?.(id, { src: up.src, pending: false });
    } catch (err) {
      console.error('image upload failed', err);
      feedback.toast({ type: 'error', message: 'Image upload failed: ' + (err.message || err) });
      mutators.deleteCard?.(id);
    } finally {
      setUploadProgressById(prev => { const { [id]: _drop, ...rest } = prev; return rest; });
      setLocalImagePreview(prev => { const { [id]: _drop, ...rest } = prev; return rest; });
      if (blobUrl) { try { URL.revokeObjectURL(blobUrl); } catch (_) {} }
    }
  }, [useLocalImages, workspaceId, board?.id, userId, feedback, mutators, onDropFileImage]);

  // Upload a video file and place a video card centered on (cx, cy).
  // Validates duration via uploadVideo (default cap 60s, 30 MB). Toast
  // surfaces upload errors.
  const dropVideoFile = useCallback(async (file, cx, cy) => {
    if (!workspaceId) throw new Error('workspaceId required');
    const up = await uploadVideo({ file, workspaceId, boardId: board?.id, userId });
    const w = Math.max(240, Math.min(560, up.width || 360));
    const aspect = up.height && up.width ? (up.height / up.width) : 9 / 16;
    const h = Math.max(160, Math.round(w * aspect));
    mutators.addCard?.({
      id: `vid-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      kind: 'video',
      src: up.src,
      x: Math.round(cx - w / 2),
      y: Math.round(cy - h / 2),
      w, h,
    });
  }, [workspaceId, board?.id, userId, mutators]);

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
              const pos = lastMouseCanvasRef.current;
              // Adds an optimistic card immediately + uploads in the
              // background; spinner overlay shows progress.
              optimisticDropImage(file, pos.x, pos.y);
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
  }, [feedback, optimisticDropImage, doPaste]);

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
  // Eyedropper helpers ── load the clicked image into an offscreen canvas,
  // sample the pixel under the click, append it as a swatch on the palette
  // that initiated the mode, and exit. R2 needs CORS for canvas pixel
  // access — if it taints, we toast a friendly error.
  const sampleImagePixel = useCallback(async (e, imageCard, paletteId) => {
    const palette = cardById[paletteId];
    if (!palette || palette.kind !== 'palette') {
      setEyedropFor(null);
      return;
    }
    try {
      const imgEl = e.target?.closest?.('.ic-imgwrap')?.querySelector('img');
      if (!imgEl) {
        feedback.toast({ type: 'error', message: 'Could not find the image element.' });
        setEyedropFor(null);
        return;
      }
      const rect = imgEl.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width;
      const py = (e.clientY - rect.top) / rect.height;
      // Use the displayed image's natural dimensions for accurate sampling.
      const nW = imgEl.naturalWidth || rect.width;
      const nH = imgEl.naturalHeight || rect.height;
      // Load via a fresh Image() so we control crossOrigin. Fall back
      // to the on-page <img> if the fresh load fails (e.g. for blob:).
      const sample = (sourceEl) => {
        const cv = document.createElement('canvas');
        cv.width = Math.min(nW, 4096); cv.height = Math.min(nH, 4096);
        const ctx = cv.getContext('2d');
        ctx.drawImage(sourceEl, 0, 0, cv.width, cv.height);
        const x = Math.max(0, Math.min(cv.width - 1, Math.round(px * cv.width)));
        const y = Math.max(0, Math.min(cv.height - 1, Math.round(py * cv.height)));
        const d = ctx.getImageData(x, y, 1, 1).data;
        const hex = '#' + [d[0], d[1], d[2]].map(n => n.toString(16).padStart(2, '0')).join('').toUpperCase();
        return hex;
      };
      let hex = null;
      let taintedFallbackUsed = false;
      try {
        // Try a clean reload with crossOrigin set so the canvas isn't tainted.
        const fresh = new Image();
        fresh.crossOrigin = 'anonymous';
        await new Promise((resolve, reject) => {
          fresh.onload = resolve;
          fresh.onerror = reject;
          fresh.src = imgEl.src;
        });
        hex = sample(fresh);
      } catch (_) {
        // The fresh load failed (most likely the storage bucket doesn't
        // return Access-Control-Allow-Origin). The on-page image was
        // loaded WITHOUT crossOrigin, so its canvas would also taint —
        // but try anyway in case the source is same-origin or a data:
        // URI. If it throws, surface a clear instruction.
        try {
          taintedFallbackUsed = true;
          hex = sample(imgEl);
        } catch (sampleErr) {
          feedback.toast({
            type: 'error',
            message: 'In-image sampling needs CORS on the image bucket. Use “Eyedrop color (anywhere on screen)” instead.',
          });
          return;
        }
      }
      if (!hex) {
        feedback.toast({
          type: 'error',
          message: taintedFallbackUsed
            ? 'Image bucket missing CORS headers — try “Eyedrop color (anywhere on screen)”.'
            : 'Could not read pixel.',
        });
        return;
      }
      const next = [...(palette.swatches || []), { name: 'Color', hex }];
      mutators.updateCard?.(palette.id, { swatches: next });
      feedback.toast({ type: 'success', message: `Added ${hex} to palette.` });
    } catch (err) {
      console.error('eyedrop sample failed', err);
      feedback.toast({ type: 'error', message: 'Sample failed: ' + (err.message || err) });
    } finally {
      setEyedropFor(null);
    }
  }, [cardById, mutators, feedback]);

  // Escape exits eyedropper mode without sampling.
  useEffect(() => {
    if (!eyedropFor) return;
    const onKey = (e) => { if (e.key === 'Escape') setEyedropFor(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [eyedropFor]);

  const onCardPointerDown = (e, c) => {
    if (e.button === 1) { startPan(e); return; }
    if (e.button !== 0) return;
    // Eyedropper mode — clicking an image card samples a pixel and
    // appends a swatch to the palette that started this mode. Other
    // clicks (non-image cards) do nothing; Escape exits.
    if (eyedropFor && c.kind === 'image') {
      e.stopPropagation();
      e.preventDefault();
      sampleImagePixel(e, c, eyedropFor);
      return;
    }
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

    // Expand the drag set to cover every groupmate of every selected
    // card so groups always move as a unit.
    const expanded = expandWithGroupmates(nextSelected);
    const dragIds = [...expanded];
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
    // Per-target metadata so we can also draw a guide line that spans
    // from min-y to max-y across all target cards sharing that x (and
    // same for the y axis).
    const targetXBounds = new Map(); // x → { y0, y1 }
    const targetYBounds = new Map();
    const extendBound = (m, key, lo, hi) => {
      const cur = m.get(key);
      if (!cur) m.set(key, { y0: lo, y1: hi });
      else { cur.y0 = Math.min(cur.y0, lo); cur.y1 = Math.max(cur.y1, hi); }
    };
    cards.forEach(card => {
      if (dragSet.has(card.id)) return;
      const xs = [card.x, card.x + card.w, card.x + card.w / 2];
      const ys = [card.y, card.y + card.h, card.y + card.h / 2];
      xs.forEach(x => {
        targetsX.push(x);
        extendBound(targetXBounds, x, card.y, card.y + card.h);
      });
      ys.forEach(y => {
        targetsY.push(y);
        extendBound(targetYBounds, y, card.x, card.x + card.w);
      });
    });

    // Equal-spacing snap targets — for any pair of non-dragged cards
    // that share a row (vertical overlap) or column (horizontal
    // overlap) with a positive gap between them, propose extending
    // the gap on either side. Drags that match an existing rhythm
    // ("each card 24px apart") snap cleanly. Works in both axes
    // independently so a + / cross arrangement falls into place.
    const otherCards = cards.filter(c => !dragSet.has(c.id));
    const SPACING_MIN = 4;
    const SPACING_MAX = 1500;
    const OVERLAP_MIN = 8;
    const xSpacingCands = []; // { targetX, edgeIs, gap, paired:{a,b,cross} }
    const ySpacingCands = [];
    for (let i = 0; i < otherCards.length; i++) {
      for (let j = i + 1; j < otherCards.length; j++) {
        const a = otherCards[i], b = otherCards[j];
        // Row neighbours on the X axis — vertical overlap, gap > 0
        const yOverlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (yOverlap > OVERLAP_MIN) {
          const left  = a.x + a.w < b.x ? a : (b.x + b.w < a.x ? b : null);
          const right = left === a ? b : (left === b ? a : null);
          if (left && right) {
            const gap = right.x - (left.x + left.w);
            if (gap >= SPACING_MIN && gap <= SPACING_MAX) {
              const cross = (Math.max(left.y, right.y) + Math.min(left.y + left.h, right.y + right.h)) / 2;
              // Extend the row to the right of `right`
              xSpacingCands.push({
                targetX: right.x + right.w + gap,
                edgeIs: 'left', gap,
                paired: { a: right.x + right.w, b: right.x + right.w + gap, cross },
              });
              // Extend the row to the left of `left`
              xSpacingCands.push({
                targetX: left.x - gap,
                edgeIs: 'right', gap,
                paired: { a: left.x - gap, b: left.x, cross },
              });
            }
          }
        }
        // Column neighbours on the Y axis — horizontal overlap
        const xOverlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        if (xOverlap > OVERLAP_MIN) {
          const top    = a.y + a.h < b.y ? a : (b.y + b.h < a.y ? b : null);
          const bottom = top === a ? b : (top === b ? a : null);
          if (top && bottom) {
            const gap = bottom.y - (top.y + top.h);
            if (gap >= SPACING_MIN && gap <= SPACING_MAX) {
              const cross = (Math.max(top.x, bottom.x) + Math.min(top.x + top.w, bottom.x + bottom.w)) / 2;
              ySpacingCands.push({
                targetY: bottom.y + bottom.h + gap,
                edgeIs: 'top', gap,
                paired: { a: bottom.y + bottom.h, b: bottom.y + bottom.h + gap, cross },
              });
              ySpacingCands.push({
                targetY: top.y - gap,
                edgeIs: 'bottom', gap,
                paired: { a: top.y - gap, b: top.y, cross },
              });
            }
          }
        }
      }
    }
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
      let bestX = null, bestXDist = thresh + 0.001, bestXTarget = null;
      let bestY = null, bestYDist = thresh + 0.001, bestYTarget = null;
      // X-axis: try to align left/right/center to any target X.
      for (const tx of targetsX) {
        for (const [edge, adjust] of [[left, tx - left], [right, tx - right], [cx, tx - cx]]) {
          const d = Math.abs(adjust);
          if (d < bestXDist) { bestXDist = d; bestX = adjust; bestXTarget = tx; }
        }
      }
      for (const ty of targetsY) {
        for (const [edge, adjust] of [[top, ty - top], [bottom, ty - bottom], [cy, ty - cy]]) {
          const d = Math.abs(adjust);
          if (d < bestYDist) { bestYDist = d; bestY = adjust; bestYTarget = ty; }
        }
      }
      // Equal-spacing candidates — try them after edge alignment. If a
      // spacing match is closer than the edge match (or no edge match
      // fired), use the spacing snap. Whether or not the snap delta
      // comes from spacing, we record matched gap markers so the user
      // sees "these cards are 24px apart, just like that pair over there."
      let bestSpaceX = null, bestSpaceXDist = thresh + 0.001, bestSpaceXMeta = null;
      for (const cand of xSpacingCands) {
        const adjust = cand.targetX - (cand.edgeIs === 'left' ? left : right);
        const d = Math.abs(adjust);
        if (d < bestSpaceXDist) { bestSpaceXDist = d; bestSpaceX = adjust; bestSpaceXMeta = cand; }
      }
      let bestSpaceY = null, bestSpaceYDist = thresh + 0.001, bestSpaceYMeta = null;
      for (const cand of ySpacingCands) {
        const adjust = cand.targetY - (cand.edgeIs === 'top' ? top : bottom);
        const d = Math.abs(adjust);
        if (d < bestSpaceYDist) { bestSpaceYDist = d; bestSpaceY = adjust; bestSpaceYMeta = cand; }
      }
      // Pick the tighter of edge vs spacing per axis.
      if (bestSpaceX !== null && bestSpaceXDist < bestXDist) {
        bestX = bestSpaceX; bestXTarget = null;          // suppress edge guide
      }
      if (bestSpaceY !== null && bestSpaceYDist < bestYDist) {
        bestY = bestSpaceY; bestYTarget = null;
      }
      // Compose visible guide hints out of the matched target lines plus
      // the dragged group's bbox along the same axis (so the line spans
      // both the source card and the aligned target).
      const newDragBBox = {
        x0: left + (bestX ?? 0), x1: right + (bestX ?? 0),
        y0: top  + (bestY ?? 0), y1: bottom + (bestY ?? 0),
      };
      const xs = [];
      const ys = [];
      const spacings = [];
      if (bestXTarget !== null) {
        const b = targetXBounds.get(bestXTarget) || { y0: newDragBBox.y0, y1: newDragBBox.y1 };
        xs.push({
          x: bestXTarget,
          y0: Math.min(b.y0, newDragBBox.y0),
          y1: Math.max(b.y1, newDragBBox.y1),
        });
      }
      if (bestYTarget !== null) {
        const b = targetYBounds.get(bestYTarget) || { y0: newDragBBox.x0, y1: newDragBBox.x1 };
        ys.push({
          y: bestYTarget,
          x0: Math.min(b.y0, newDragBBox.x0),
          x1: Math.max(b.y1, newDragBBox.x1),
        });
      }
      if (bestSpaceXMeta && bestSpaceXDist < thresh + 0.001) {
        spacings.push({
          axis: 'x',
          a: bestSpaceXMeta.paired.a,
          b: bestSpaceXMeta.paired.b,
          cross: bestSpaceXMeta.paired.cross,
          gap: Math.round(bestSpaceXMeta.gap),
        });
      }
      if (bestSpaceYMeta && bestSpaceYDist < thresh + 0.001) {
        spacings.push({
          axis: 'y',
          a: bestSpaceYMeta.paired.a,
          b: bestSpaceYMeta.paired.b,
          cross: bestSpaceYMeta.paired.cross,
          gap: Math.round(bestSpaceYMeta.gap),
        });
      }
      return {
        dx: rawDx + (bestX ?? 0),
        dy: rawDy + (bestY ?? 0),
        hints: (xs.length || ys.length || spacings.length) ? { xs, ys, spacings } : null,
      };
    };
    setDrag({ ids: dragIds, dx: 0, dy: 0, startPositions });

    const onMove = (ev) => {
      const rawDx = (ev.clientX - startClient.x) / zoom;
      const rawDy = (ev.clientY - startClient.y) / zoom;
      // Hold Alt/Option to bypass snap.
      const skip = ev.altKey;
      const snap = skip ? { dx: rawDx, dy: rawDy, hints: null } : computeSnap(rawDx, rawDy);
      const { dx, dy, hints } = snap;
      setDrag({ ids: dragIds, dx, dy, startPositions });
      setSnapHints(hints);
      // Same-canvas board-drop hover detection. If the cursor is over a
      // board card that's not in the dragged set, we'll commit the drop
      // by moving the dragged cards INTO that board.
      let nextDropTarget = null;
      if (Math.abs(dx) + Math.abs(dy) > 4) {
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const cardEl = el?.closest?.('[data-card-id]');
        const id = cardEl?.getAttribute?.('data-card-id');
        if (id && !dragIds.includes(id)) {
          const tc = cardById[id];
          if (tc?.kind === 'board') nextDropTarget = tc.id;
          else if (tc?.kind === 'boardlink' && tc.target) nextDropTarget = tc.target;
        }
      }
      setBoardDropTarget(nextDropTarget);
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
      const snapEnd = skip ? { dx: rawDx, dy: rawDy } : computeSnap(rawDx, rawDy);
      const { dx, dy } = snapEnd;
      setSnapHints(null);
      // Clear our live-drag awareness so peers see the card snap to its
      // committed position. (The Y.Doc updateCards call below propagates
      // the final position via Yjs sync.)
      try { getAwareness?.()?.setLocalStateField('liveDrag', null); } catch (_) {}
      // ── Same-canvas drop onto a board card (move INTO that board) ──
      // Capture the target before we clear hover state.
      const targetBoardId = boardDropTarget;
      setBoardDropTarget(null);
      if (targetBoardId && (Math.abs(dx) + Math.abs(dy) > 4)) {
        const movedCards = dragIds.map(id => cardById[id]).filter(Boolean);
        if (movedCards.length) {
          document.dispatchEvent(new CustomEvent('soleil-card-into-board-drop', {
            detail: {
              sourceBoardId: board.id,
              targetBoardId,
              cards: movedCards,
            },
          }));
          mutators.deleteCards?.(dragIds);
          setDrag(null);
          return;
        }
      }
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

  // Right-click on an arrow → small menu with edit-label + toggle
  // double-sided + delete. Uses bgCtx state so the existing
  // BackgroundContextMenu component can render it.
  const onArrowContextMenu = (e, idx) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedArrows(new Set([idx]));
    setSelected(new Set());
    const a = (arrows || [])[idx];
    if (!a) return;
    setBgCtx({
      open: true,
      x: e.clientX,
      y: e.clientY,
      canvasPos: null,
      arrowMenu: { idx, arrow: a },
    });
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
        const currentCover = target?.cover || 'neutral';
        items.push({ id: 'cover', label: 'Cover color', submenu: [
          ...Object.keys(COVER_TINTS).map(k => ({
            id: `cover-${k}`,
            swatch: COVER_TINTS[k],
            label: k.charAt(0).toUpperCase() + k.slice(1),
            checked: currentCover === k,
            run: () => mutators.setBoardCover?.(c.id, k === 'neutral' ? null : k),
          })),
        ]});
        if (target && personalWorkspaceId && target.workspace_id !== personalWorkspaceId) {
          items.push({ id: 'clone', label: 'Copy to my workspace', run: () => mutators.cloneBoardToPersonal?.(c.id) });
        }
      } else if (c.kind === 'boardlink') {
        items.push({ id: 'open', label: 'Open linked board', run: () => boards[c.target] && onOpenBoard(c.target) });
      } else if (c.kind === 'palette') {
        items.push({ id: 'pc-hide-hex',
          label: c.hideHex ? 'Show hex codes' : 'Hide hex codes',
          run: () => mutators.updateCard?.(c.id, { hideHex: !c.hideHex }) });
        items.push({ id: 'pc-hide-labels',
          label: c.hideLabels ? 'Show palette labels' : 'Hide palette labels',
          run: () => mutators.updateCard?.(c.id, { hideLabels: !c.hideLabels }) });
        items.push({ id: 'pc-eyedrop', label: 'Eyedrop color (anywhere on screen)…', run: async () => {
          // Browser EyeDropper API. Falls back to a friendly toast where
          // unsupported (Firefox, Safari < 17.4 currently).
          if (typeof window === 'undefined' || !window.EyeDropper) {
            feedback.toast({ type: 'error', message: 'Eyedropper not supported in this browser yet.' });
            return;
          }
          try {
            const ed = new window.EyeDropper();
            const result = await ed.open();
            const hex = (result?.sRGBHex || '').toUpperCase();
            if (!hex) return;
            const next = [...(c.swatches || []), { name: 'Color', hex }];
            mutators.updateCard?.(c.id, { swatches: next });
          } catch (_) { /* user cancelled */ }
        }});
        items.push({ id: 'pc-pick-image', label: 'Pick from board image…', run: () => {
          // Enter pick mode — the next click on an image card samples
          // a pixel and adds the swatch. The mode is canvas-scoped
          // (see eyedropFor state above + click handler below).
          setEyedropFor(c.id);
          feedback.toast({ type: 'info', message: 'Click an image to sample a color. Esc to cancel.' });
        }});
      } else if (c.kind === 'note') {
        items.push({ id: 'fit', label: 'Fit to content', run: () => {
          // Snap the note to the natural size of its rendered content so
          // there's no padding to the right of titles or short lines, and
          // no empty space below. We clone the live note-body into an
          // offscreen measurer with the same font/styles but width set to
          // max-content; that gives us the unwrapped longest-line width.
          // Then we set the note's width and re-measure height at that
          // width so multi-line content still wraps correctly.
          const wrap = document.querySelector(`[data-card-id="${c.id}"] .note-body`);
          if (!wrap) return;
          const NOTE_PAD_X = 16 * 2; // .note padding left + right
          const NOTE_PAD_Y = 16 * 2;
          const cs = window.getComputedStyle(wrap);
          const measurer = document.createElement('div');
          measurer.innerHTML = wrap.innerHTML;
          Object.assign(measurer.style, {
            position: 'absolute', left: '-99999px', top: '0',
            visibility: 'hidden',
            width: 'max-content', maxWidth: 'none',
            font: cs.font,
            lineHeight: cs.lineHeight,
            letterSpacing: cs.letterSpacing,
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
          });
          document.body.appendChild(measurer);
          const naturalW = Math.ceil(measurer.scrollWidth);
          // Cap width so a giant single line doesn't blow out the canvas.
          const newW = Math.min(560, Math.max(80, naturalW + NOTE_PAD_X));
          // Re-measure height at the new content width.
          measurer.style.width = (newW - NOTE_PAD_X) + 'px';
          const newH = Math.max(40, Math.ceil(measurer.scrollHeight) + NOTE_PAD_Y);
          measurer.remove();
          mutators.updateCard?.(c.id, { w: newW, h: newH, manuallyResized: false });
        }});
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

    if (!multi) {
      items.push({ id: 'comment', label: 'Add comment',
        run: () => promptComment({ kind: 'card', id: c.id }) });
      items.push({ id: 'tag', label: 'Tag…',
        run: () => {
          // Open the picker anchored near the right-click coord. The
          // ctx state holds the click position from onCardContextMenu.
          const anchorRect = { left: ctx.x, top: ctx.y, bottom: ctx.y + 4, right: ctx.x + 4 };
          openTagPicker(c.id, anchorRect);
        }});
      items.push({ id: 'info', label: 'Info', run: () => {
        // Anchor the info popover at the click point so it sits next
        // to the card the user invoked it on.
        setInfoFor({ cardId: c.id, x: ctx.x, y: ctx.y });
      }});
    }
    items.push({ id: 'cut', label: multi ? `Cut (${selected.size})` : 'Cut', shortcut: `${cmdKey}X`, run: doCut });
    items.push({ id: 'copy', label: multi ? `Copy (${selected.size})` : 'Copy', shortcut: `${cmdKey}C`, run: doCopy });
    items.push({ id: 'duplicate', label: multi ? `Duplicate (${selected.size})` : 'Duplicate', shortcut: `${cmdKey}D`, run: doDuplicate });
    items.push({ id: 'front', label: 'Bring to front', run: () => {
      const ids = multi ? [...selected] : [c.id];
      ids.forEach(id => mutators.bringToFront?.(id));
    }});

    // Grouping ──
    items.push({ divider: true });
    if (multi && selected.size >= 2) {
      // Selection of 2+ → "Group together"
      items.push({ id: 'group', label: `Group (${selected.size})`, run: async () => {
        const name = await feedback.prompt({
          title: 'Group these cards',
          label: 'Name',
          placeholder: 'e.g. Mood board',
          defaultValue: '',
          confirmLabel: 'Group',
        });
        if (name == null) return;
        mutators.createGroup?.({ name: name || 'Group', cardIds: [...selected] });
      }});
    }
    // Always offer "Add to group…" when at least one existing group is on
    // the board, regardless of selection size. Adds the right-clicked card
    // (or all selected cards) into the chosen group.
    if (!c.groupId && groups && groups.length > 0) {
      const targets = multi ? [...selected] : [c.id];
      items.push({ id: 'add-to-group', label: 'Add to group', submenu:
        groups.map(g => ({
          id: `atg-${g.id}`,
          label: g.name || 'Untitled group',
          run: () => mutators.addToGroup?.(g.id, targets),
        })),
      });
    }
    if (c.groupId && groupById[c.groupId]) {
      const g = groupById[c.groupId];
      items.push({ id: 'group-rename', label: `Rename group "${g.name || ''}"`, run: async () => {
        const name = await feedback.prompt({
          title: 'Rename group',
          label: 'Name',
          defaultValue: g.name || '',
          confirmLabel: 'Rename',
        });
        if (name == null) return;
        mutators.renameGroup?.(g.id, name);
      }});
      items.push({ id: 'group-outline', label: g.outline ? 'Hide group outline' : 'Show group outline',
        run: () => mutators.setGroupOutline?.(g.id, { outline: !g.outline }) });
      items.push({ id: 'group-hide-label',
        label: g.options?.hideLabel ? 'Show group label' : 'Hide group label',
        run: () => mutators.setGroupOutline?.(g.id, {
          options: { ...(g.options || {}), hideLabel: !g.options?.hideLabel },
        }) });
      items.push({ id: 'group-shape', label: 'Outline shape', submenu: [
        { id: 'gs-box', label: `Box${(g.shape || 'box') === 'box' ? '  ✓' : ''}`,
          run: () => mutators.setGroupOutline?.(g.id, { shape: 'box', outline: true }) },
        { id: 'gs-hug', label: `Hug${g.shape === 'hug' ? '  ✓' : ''}`,
          run: () => mutators.setGroupOutline?.(g.id, { shape: 'hug', outline: true }) },
      ]});
      items.push({ id: 'group-color', label: 'Group outline color…', run: () => {
        setPicker({
          value: g.color || 'var(--soleil)',
          onChange: (col) => mutators.setGroupOutline?.(g.id, { color: col, outline: true }),
          x: ctx.x, y: ctx.y, allowTransparent: false,
        });
      }});
      items.push({ id: 'group-remove', label: multi ? `Remove from group (${selected.size})` : 'Remove from group',
        run: () => mutators.removeFromGroup?.(multi ? [...selected] : [c.id]) });
      items.push({ id: 'ungroup', label: 'Ungroup', danger: true, run: () => mutators.ungroup?.(g.id) });
      // Group info — surfaces the same audit data we stamp on cards,
      // plus a quick member count.
      items.push({ id: 'group-info', label: 'Group info', run: () => {
        const memberCount = (cards || []).filter(cc => cc.groupId === g.id).length;
        const lines = [`${memberCount} member${memberCount === 1 ? '' : 's'}`];
        if (g.createdAt) lines.push(`created ${relativeTimeShort(g.createdAt)}`);
        if (g.createdBy) {
          const peer = (wsPeers || []).find(p => p?.user?.id === g.createdBy);
          const name = peer?.user?.name
                    || peer?.user?.email?.split('@')[0]
                    || (g.createdBy === userId ? 'you' : (g.createdBy || '').slice(0, 6));
          lines.push(`by ${name}`);
        }
        feedback.toast({ type: 'info', message: lines.join(' · ') });
      }});
    }

    // Audit info — who created this and when, last edit by whom and when.
    // Surfaces the audit metadata that was stamped on add/update; resolves
    // user ids against current wsPeers, falling back to "you" / a short id.
    if (!multi && (c.createdBy || c.createdAt || c.updatedBy || c.updatedAt)) {
      const resolveName = (uid) => {
        if (!uid) return 'unknown';
        if (uid === userId) return 'you';
        const peer = (wsPeers || []).find(p => p?.user?.id === uid);
        return peer?.user?.name
            || peer?.user?.email?.split('@')[0]
            || uid.slice(0, 6);
      };
      const lines = [];
      if (c.createdAt) {
        lines.push(`Created ${relativeTimeShort(c.createdAt)} by ${resolveName(c.createdBy)}`);
      }
      if (c.updatedAt && c.updatedAt !== c.createdAt) {
        lines.push(`Updated ${relativeTimeShort(c.updatedAt)} by ${resolveName(c.updatedBy)}`);
      }
      if (lines.length) {
        items.push({ divider: true });
        items.push({ id: 'info', label: 'Info', run: () => {
          feedback.toast({ type: 'info', message: lines.join(' · ') });
        }});
      }
    }

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
    // Group context menu — opened by right-clicking a group label.
    // First so it short-circuits before the arrow + bg branches.
    if (bgCtx.groupMenu) {
      const { id: gid, name: gname } = bgCtx.groupMenu;
      const g = groupById?.[gid];
      const items = [
        { id: 'group-comment', label: 'Add comment to group',
          run: () => promptComment({ kind: 'group', id: gid }) },
      ];
      if (g) {
        items.push({ id: 'group-tag', label: 'Tag group…',
          run: () => {
            const r = { left: bgCtx.x, top: bgCtx.y, bottom: bgCtx.y + 4, right: bgCtx.x + 4 };
            // Reuse the per-card tag picker — group tagging would need
            // a `board_tags` flow which is its own feature; for now we
            // surface this as a placeholder so users see it and the
            // archive popover entry still makes sense.
            feedback.toast({ type: 'info', message: 'Group tagging is coming — comment for now.' });
          }});
        items.push({ id: 'group-rename', label: 'Rename group', run: async () => {
          const name = await feedback.prompt({
            title: 'Rename group',
            label: 'Name',
            defaultValue: gname || g.name || '',
            confirmLabel: 'Rename',
          });
          if (name == null) return;
          mutators.renameGroup?.(gid, name);
        }});
        items.push({ id: 'group-outline', label: g.outline ? 'Hide outline' : 'Show outline',
          run: () => mutators.setGroupOutline?.(gid, { outline: !g.outline }) });
        items.push({ id: 'group-hide-label',
          label: g.options?.hideLabel ? 'Show group label' : 'Hide group label',
          run: () => mutators.setGroupOutline?.(gid, {
            options: { ...(g.options || {}), hideLabel: !g.options?.hideLabel },
          }) });
        items.push({ divider: true });
        items.push({ id: 'group-ungroup', label: 'Ungroup', danger: true,
          run: () => mutators.ungroup?.(gid) });
      }
      return items;
    }
    // Arrow context menu — opened by right-clicking an arrow path.
    if (bgCtx.arrowMenu) {
      const { idx, arrow } = bgCtx.arrowMenu;
      return [
        { id: 'arrow-label', label: arrow.label ? 'Edit label' : 'Add label', run: async () => {
          const v = await feedback.prompt({
            title: 'Arrow label',
            label: 'Label',
            defaultValue: arrow.label || '',
            placeholder: 'leads to, blocks, related…',
            confirmLabel: 'Save',
          });
          if (v == null) return;
          mutators.updateArrow?.(idx, { label: v.trim() || null });
        }},
        { id: 'arrow-bidir',
          label: arrow.bidir ? 'Single-sided arrow' : 'Double-sided arrow',
          run: () => mutators.updateArrow?.(idx, { bidir: !arrow.bidir }) },
        { id: 'arrow-straight',
          label: arrow.straight ? 'Curved arrow' : 'Straight arrow',
          run: () => mutators.updateArrow?.(idx, { straight: !arrow.straight }) },
        { id: 'arrow-dashed',
          label: arrow.dashed ? 'Solid line' : 'Dashed line',
          run: () => mutators.updateArrow?.(idx, { dashed: !arrow.dashed }) },
        { divider: true },
        { id: 'arrow-delete', label: 'Delete arrow', danger: true,
          run: () => mutators.deleteArrows?.([idx]) },
      ];
    }
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
      { id: 'comment', label: 'Add comment', run: () => promptComment({ kind: 'point', x: pos.x, y: pos.y }) },
      { id: 'addurl', label: 'Add link…', run: async () => {
        const v = await feedback.prompt({
          title: 'Add a link card',
          label: 'URL',
          placeholder: 'https://…',
          confirmLabel: 'Add',
        });
        if (!v) return;
        const url = v.trim();
        if (!url) return;
        const w = 280, h = 110;
        let title = url;
        try { title = new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, ''); } catch (_) {}
        mutators.addCard?.({
          id: `link-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
          kind: 'link', source: url, link: url, title,
          x: Math.max(8, Math.round(pos.x - w / 2)),
          y: Math.max(8, Math.round(pos.y - h / 2)),
          w, h,
        });
      }},
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
      { id: 'save-template', label: 'Save board as template…', run: async () => {
        if (!userId || !ydoc) return;
        const name = await feedback.prompt({
          title: 'Save as template',
          label: 'Template name',
          placeholder: board?.name ? `e.g. "${board.name} starter"` : 'Project starter',
          defaultValue: '',
          confirmLabel: 'Save',
        });
        if (!name?.trim()) return;
        try {
          await saveBoardTemplate({
            ydoc,
            name: name.trim(),
            workspaceId,
            scope: 'workspace',
            cover: board?.cover || null,
            createdBy: userId,
          });
          feedback.toast({ type: 'success', message: `Saved "${name.trim()}" as a template.` });
        } catch (err) {
          feedback.toast({ type: 'error', message: 'Save failed: ' + (err.message || err) });
        }
      }},
      { id: 'export', label: 'Export', submenu: [
        { id: 'export-png', label: 'PNG image', run: async () => {
          const svg = exportSvgRef.current?.querySelector?.('svg');
          if (!svg) { feedback.toast({ type: 'error', message: 'Nothing to export.' }); return; }
          try { await exportBoardAsPng(svg, board?.name || 'board'); }
          catch (err) { feedback.toast({ type: 'error', message: 'Export failed: ' + (err.message || err) }); }
        }},
        { id: 'export-pdf', label: 'PDF (Save from Print)', run: () => {
          const svg = exportSvgRef.current?.querySelector?.('svg');
          if (!svg) { feedback.toast({ type: 'error', message: 'Nothing to export.' }); return; }
          try { exportBoardAsPdf(svg, board?.name || 'board'); }
          catch (err) { feedback.toast({ type: 'error', message: 'Export failed: ' + (err.message || err) }); }
        }},
      ]},
      { id: 'clearstrokes', label: 'Clear all drawings', disabled: !(strokes && strokes.length > 0),
        danger: true, run: () => mutators.clearStrokes?.() },
    ];
  };

  // ── Tags ──────────────────────────────────────────────────────────────
  const { tags: wsTags, byCard: tagsByCard, byBoard: tagsByBoard, refresh: refreshTags } =
    useWorkspaceTags({ workspaceId, boardId: board?.id });
  // Stable fingerprint of the workspace's tag definitions — used as
  // a dep + as a per-card hash component so creating / renaming /
  // deleting a tag triggers a fresh round of scoring against every
  // visible card. Without this, a brand-new tag never re-scores
  // existing cards (the per-card hash dedupe would skip them).
  const wsTagsFingerprint = useMemo(
    () => (wsTags || []).map(t => `${t.id}:${t.slug || t.name || ''}`).sort().join('|'),
    [wsTags],
  );
  const [tagPicker, setTagPicker] = useState(null); // { cardId, anchorRect }
  const openTagPicker = (cardId, anchorRect) => setTagPicker({ cardId, anchorRect });
  const closeTagPicker = () => setTagPicker(null);
  // Right-click menu for an applied tag chip on a card. Lets users
  // confirm an auto-applied tag (promoting source='auto' → 'user'),
  // remove it, or dismiss it permanently for that target.
  const [tagChipMenu, setTagChipMenu] = useState(null); // { x, y, cardId, tag }
  const closeTagChipMenu = () => setTagChipMenu(null);
  useEffect(() => {
    if (!tagChipMenu) return;
    const onAway = () => setTagChipMenu(null);
    window.addEventListener('mousedown', onAway, { capture: true });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') setTagChipMenu(null); }, { once: true });
    return () => window.removeEventListener('mousedown', onAway, { capture: true });
  }, [tagChipMenu]);
  const toggleTagOnCard = async (cardId, tag) => {
    if (!workspaceId || !board?.id || !cardId || !tag) return;
    const applied = (tagsByCard.get(cardId) || []).some(t => t.id === tag.id);
    try {
      if (applied) await untagCard({ boardId: board.id, cardId, tagId: tag.id });
      else         await tagCard({ workspaceId, boardId: board.id, cardId, tagId: tag.id });
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Tag failed: ' + (err.message || err) });
    }
  };
  const createAndApplyTag = async (cardId, name) => {
    if (!workspaceId || !cardId) return;
    try {
      const t = await ensureTag({ workspaceId, name, kind: 'user', createdBy: userId });
      await tagCard({ workspaceId, boardId: board.id, cardId, tagId: t.id });
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Tag failed: ' + (err.message || err) });
    }
  };

  // Auto-tag cards + the board itself.
  //
  // Two halves: a per-render "wake" call that flags pending work,
  // and a stable debounced scoring loop that reads live state via
  // refs. We can't put a setTimeout inside a useEffect that depends
  // on `cards` — `cards` is a fresh array on every App render
  // (filter() in App.jsx), so the timer would reset before it ever
  // fires. The ref-based pattern below is immune to render churn.
  const autoTaggedHashRef = useRef(new Map()); // key -> last hash
  const autotagPendingRef = useRef(false);
  const autotagInFlightRef = useRef(false);
  const autotagTimerRef = useRef(0);
  const autotagStateRef = useRef({});
  // Mirror the latest props/state into a ref that the timer reads.
  autotagStateRef.current = {
    workspaceId, board, cards, groups, autotagSuggest, autotagReady,
    tagsByCard, tagsByBoard, groupById, wsTagsFingerprint,
  };

  const runAutotagScoring = useCallback(async () => {
    autotagPendingRef.current = false;
    if (autotagInFlightRef.current) return;
    autotagInFlightRef.current = true;
    try { await runAutotagScoringInner(); }
    finally { autotagInFlightRef.current = false; }
  }, []);

  const runAutotagScoringInner = useCallback(async () => {
    const s = autotagStateRef.current;
    if (!s.workspaceId || !s.board?.id || !s.autotagSuggest || !s.autotagReady) return;
    // Auto-apply threshold. Lower than the legacy 0.7 because:
    //   - exact-name (0.95) and alias (0.9) hits are unaffected
    //   - cold-start substring fallback (0.55) now auto-applies,
    //     giving the "everything obvious gets tagged" feel
    //   - users have a one-click "Don't suggest again" escape on
    //     every chip, so false positives are cheap
    const HIGH = 0.5;
    const boardName = s.board.name || s.board.title || '';
    // 1. Score the board itself.
    if (boardName.trim()) {
      const knownBoardIds = new Set((s.tagsByBoard?.get(s.board.id) || []).map(t => t.id));
      const boardKey = `board:${s.board.id}`;
      const boardHash = `${boardName}:${s.wsTagsFingerprint}:${knownBoardIds.size}`;
      if (autoTaggedHashRef.current.get(boardKey) !== boardHash) {
        autoTaggedHashRef.current.set(boardKey, boardHash);
        try {
          const suggestions = await s.autotagSuggest(boardName, { kind: 'board', id: s.board.id });
          for (const sg of suggestions) {
            if (sg.score < HIGH) continue;
            if (knownBoardIds.has(sg.tagId)) continue;
            await tagBoard({
              workspaceId: s.workspaceId, boardId: s.board.id,
              tagId: sg.tagId, source: 'auto',
            });
          }
        } catch {}
      }
    }
    // 1b. Score every named group on this board against the tag list.
    //     A group called "Personal Pricing" should obviously pick up
    //     the Pricing tag without any user prompt.
    for (const g of (s.groups || [])) {
      const gname = (g?.name || '').trim();
      if (!gname || !g.id) continue;
      const groupKey = `group:${g.id}`;
      const groupHash = `${gname}:${boardName}:${s.wsTagsFingerprint}`;
      if (autoTaggedHashRef.current.get(groupKey) === groupHash) continue;
      autoTaggedHashRef.current.set(groupKey, groupHash);
      // Enrich with the board name so a group called "Pricing"
      // on a "Studio" board still benefits from board context.
      const text = [boardName, gname].filter(Boolean).join(' ').trim();
      try {
        const suggestions = await s.autotagSuggest(text, { kind: 'group', id: g.id });
        for (const sg of suggestions) {
          if (sg.score < HIGH) continue;
          await tagGroup({
            workspaceId: s.workspaceId, boardId: s.board.id, groupId: g.id,
            tagId: sg.tagId, source: 'auto',
          });
        }
      } catch {}
    }
    // 2. Score every card. The card must say something on its own —
    //    inherited context (board/group name) only BOOSTS cards
    //    that already have content of their own. An empty note on
    //    a board called "Pricing" is just an empty note, not a
    //    pricing note. We never want to tag emptiness.
    for (const c of s.cards || []) {
      const title = (c.title || c.label || c.name || '').trim();
      // Notes carry their text in `html` (rich-text); simple cards
      // use `body`. We html-strip below before checking length so
      // empty <p></p> wrappers don't fool the gate.
      const rawBody = c.body || c.html || '';
      const ownText = (title + ' ' + String(rawBody).replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' '))
        .replace(/\s+/g, ' ').trim();
      if (ownText.length < 2) continue;
      const groupName = c.groupId ? (s.groupById[c.groupId]?.name || '') : '';
      // Build the scoring text now that we know the card has its own
      // content. Board + group name go in as TF-IDF boosters.
      const text = [boardName, groupName, title, rawBody].filter(Boolean).join(' ').trim();
      const knownIds = new Set((s.tagsByCard.get(c.id) || []).map(t => t.id));
      const cardKey = `card:${c.id}`;
      const hash = `${ownText.length}:${title.slice(0, 40)}:${groupName}:${s.wsTagsFingerprint}:${knownIds.size}`;
      if (autoTaggedHashRef.current.get(cardKey) === hash) continue;
      autoTaggedHashRef.current.set(cardKey, hash);
      try {
        const suggestions = await s.autotagSuggest(text, { kind: 'card', id: c.id });
        for (const sg of suggestions) {
          if (sg.score < HIGH) continue;
          if (knownIds.has(sg.tagId)) continue;
          await tagCard({
            workspaceId: s.workspaceId, boardId: s.board.id, cardId: c.id,
            tagId: sg.tagId, source: 'auto',
          });
        }
      } catch {}
    }
  }, []);

  // Wake on any meaningful state change. The flag-and-singleton-timer
  // pattern means rapid re-renders still produce exactly one scoring
  // run per quiet window — render churn doesn't reset the clock.
  useEffect(() => {
    if (!autotagReady || !workspaceId || !board?.id) return;
    if (autotagPendingRef.current) return; // already scheduled
    if (autotagInFlightRef.current) return; // currently scoring
    autotagPendingRef.current = true;
    autotagTimerRef.current = setTimeout(runAutotagScoring, 1500);
  });
  useEffect(() => () => clearTimeout(autotagTimerRef.current), []);

  // ── Comments ───────────────────────────────────────────────────────────
  // Live anywhere-comments. Bubbles render anchored to cards / groups /
  // empty-canvas points; a right-click menu item shows an inline draft
  // input (no popup) at the click position.
  const { comments, removeLocally: removeCommentLocally } = useCanvasComments(board?.id);
  // Inline-draft state. When the user picks "Add comment" from a
  // right-click menu, we set commentDraft to the anchor + viewport
  // position; CanvasCommentLayer renders an inline draft input there.
  const [commentDraft, setCommentDraft] = useState(null);
  // Master comments-visibility toggle. Default ON — when the user
  // turns it off, the entire comment layer disappears from the canvas.
  // Persists per-tab via sessionStorage. Right-clicking the toggle
  // opens an "archive" popover listing both resolved and hidden
  // comments with reopen/unhide actions, so users have a direct
  // surface to recover comments without leaving the board view.
  const [commentsVisible, setCommentsVisible] = useState(() => {
    try { return sessionStorage.getItem('soleil.boards.commentsVisible') !== '0'; }
    catch (_) { return true; }
  });
  const toggleCommentsVisible = () => {
    setCommentsVisible(v => {
      const next = !v;
      try { sessionStorage.setItem('soleil.boards.commentsVisible', next ? '1' : '0'); }
      catch (_) {}
      // Going OFF → ON is "show all" — also un-hide any comments
      // dismissed via the per-bubble Hide action so they actually
      // come back, not just the layer's visibility. Best-effort:
      // log but don't toast on failure (RLS may filter some rows).
      if (next && board?.id) {
        unhideAllOnBoard(board.id).catch(err => {
          console.warn('[comments] unhideAllOnBoard failed', err);
        });
      }
      return next;
    });
  };
  const [commentArchive, setCommentArchive] = useState(null); // { x, y } when open
  // Counts for the eye-button badge / popover header.
  const visibleCommentCount  = (comments || []).filter(c => !c.resolved && !c.hidden && !c.reply_to).length;
  const resolvedCommentCount = (comments || []).filter(c => c.resolved && !c.reply_to).length;
  const hiddenCommentCount   = (comments || []).filter(c => c.hidden && !c.resolved && !c.reply_to).length;
  // Open the inline draft. The viewport position is computed from the
  // anchor's canvas coords so the draft input sits exactly where the
  // resulting comment bubble will appear. No popup modal — type
  // directly on the canvas, Enter to post, Escape to cancel.
  const promptComment = (anchor) => {
    if (!workspaceId || !board?.id || !userId) return;
    let cx, cy;
    if (anchor.kind === 'card') {
      const b = resolveCardBBox?.(anchor.id);
      if (b) { cx = b.x + b.w + 8; cy = b.y - 8; }
      else   { cx = 100; cy = 100; }
    } else if (anchor.kind === 'group') {
      const b = resolveGroupBBox?.(anchor.id);
      if (b) { cx = b.x + b.w + 8; cy = b.y - 8; }
      else   { cx = 100; cy = 100; }
    } else if (anchor.kind === 'point') {
      cx = anchor.x; cy = anchor.y;
    } else {
      cx = 100; cy = 100;
    }
    setCommentDraft({ anchor, canvasPos: { x: cx, y: cy } });
  };
  const submitCommentDraft = async (body) => {
    if (!commentDraft) return;
    const trimmed = (body || '').trim();
    if (!trimmed) { setCommentDraft(null); return; }
    // For card / group anchors, find a perimeter spot that doesn't
    // collide with neighbouring cards or already-placed comments.
    let offset = { offsetX: 0, offsetY: 0 };
    try {
      const a = commentDraft.anchor;
      if (a.kind === 'card') {
        const target = resolveCardBBox(a.id);
        if (target) {
          const others = (cards || []).filter(c => c.id !== a.id)
            .map(c => ({ x: c.x, y: c.y, w: c.w, h: c.h }));
          const placed = (comments || [])
            .filter(c => !c.hidden && !c.reply_to)
            .map(c => commentRectFor(c, resolveCardBBox, resolveGroupBBox))
            .filter(Boolean);
          offset = pickCommentOffset({ target, others, placed });
        }
      } else if (a.kind === 'group') {
        const target = resolveGroupBBox(a.id);
        if (target) {
          const others = (cards || []).map(c => ({ x: c.x, y: c.y, w: c.w, h: c.h }));
          const placed = (comments || [])
            .filter(c => !c.hidden && !c.reply_to)
            .map(c => commentRectFor(c, resolveCardBBox, resolveGroupBBox))
            .filter(Boolean);
          offset = pickCommentOffsetForGroup({ groupBBox: target, others, placed });
        }
      }
    } catch (_) { /* fall through with zero offset */ }
    try {
      await addComment({
        workspaceId, boardId: board.id, author: userId,
        body: trimmed, anchor: commentDraft.anchor,
        offsetX: offset.offsetX, offsetY: offset.offsetY,
      });
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Comment failed: ' + (err.message || err) });
    } finally {
      setCommentDraft(null);
    }
  };
  // Helper: compute a comment's canvas-space rect for collision-avoidance.
  const commentRectFor = (c, resolveCard, resolveGroup) => {
    const W = 240, H = 76;
    if (c.anchor_kind === 'card') {
      const b = resolveCard?.(c.anchor_id);
      if (!b) return null;
      const x = b.x + b.w + 8 + (c.offset_x || 0);
      const y = b.y - 8 + (c.offset_y || 0);
      return { x, y, w: W, h: H };
    }
    if (c.anchor_kind === 'group') {
      const b = resolveGroup?.(c.anchor_id);
      if (!b) return null;
      const x = b.x + b.w + 8 + (c.offset_x || 0);
      const y = b.y - 8 + (c.offset_y || 0);
      return { x, y, w: W, h: H };
    }
    if (c.anchor_kind === 'point') {
      return { x: (c.anchor_x || 0) + (c.offset_x || 0),
               y: (c.anchor_y || 0) + (c.offset_y || 0),
               w: W, h: H };
    }
    return null;
  };
  const resolveCardBBox = useCallback((cardId) => {
    const c = (cards || []).find(c => c.id === cardId);
    if (!c) return null;
    return { x: c.x, y: c.y, w: c.w, h: c.h };
  }, [cards]);
  const resolveGroupBBox = useCallback((groupId) => {
    const g = groupById?.[groupId];
    if (!g) return null;
    const members = (cards || []).filter(c => c.groupId === groupId);
    if (members.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of members) {
      minX = Math.min(minX, c.x);
      minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x + c.w);
      maxY = Math.max(maxY, c.y + c.h);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }, [cards, groupById]);

  // ── Card double-click ─────────────────────────────────────────────────────
  // For images we let the card itself handle dbl-click (focus title editor).
  // For boards: only the cover area triggers open — title/meta dbl-click
  // does nothing (so accidental clicks near the title don't navigate).
  const onCardDoubleClick = (e, c) => {
    if (e.target.isContentEditable) return;
    if (e.target.closest && e.target.closest('.editable')) return;
    if (c.kind === 'board') {
      const t = e.target;
      const inCover = t.closest && t.closest('.bc-cover');
      // List-mode boards have no .bc-cover. Accept double-click anywhere
      // on the card EXCEPT individual list rows (which have their own
      // click semantics — open child / open link / open lightbox).
      const inListBody =
        t.closest && t.closest('.bc-list') && !t.closest('.bc-toc-row');
      if (inCover || inListBody) onOpenBoard(c.id);
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
    const kindCls = `card-kind-${c.kind || 'unknown'}`;
    const isTagDropHover = tagDropTarget?.cardId === c.id;
    const isLinkTarget = linkHoverIds.has(c.id);
    const isBoardDropTarget = boardDropTarget && (
      (c.kind === 'board' && c.id === boardDropTarget) ||
      (c.kind === 'boardlink' && c.target === boardDropTarget)
    );
    const wrapper = {
      style: isTagDropHover
        ? { ...wrapperStyle, '--tag-drop-color': tagDropTarget.color }
        : wrapperStyle,
      className: `card ${kindCls} ${isSelected ? 'is-selected' : ''} ${inDrag ? 'is-dragging' : ''} ${arrowFrom === c.id ? 'is-arrow-source' : ''}${isTagDropHover ? ' is-tag-drop' : ''}${isLinkTarget ? ' is-link-target' : ''}${isBoardDropTarget ? ' is-card-drop-target' : ''}`,
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
      if (!target && typeof window !== 'undefined') {
        if (!window._missingBoardLogged) window._missingBoardLogged = new Set();
        if (!window._missingBoardLogged.has(c.id)) {
          window._missingBoardLogged.add(c.id);
          console.log('[boards] canvas missing board card', {
            cardId: c.id,
            requestedBoardId: c.id,
            currentBoardId: board?.id,
            knownBoardCount: boards ? Object.keys(boards).length : 0,
            knownBoardIds: boards ? Object.keys(boards).slice(0, 12) : null,
          });
        }
      } else if (target && typeof window !== 'undefined' && window._missingBoardLogged?.has(c.id)) {
        // Recovered — boards map now includes it. Log + drop from set.
        window._missingBoardLogged.delete(c.id);
        console.log('[boards] canvas missing board RECOVERED', { cardId: c.id });
      }
      const peersHere  = peersHereByBoard?.get?.(c.id)  || [];
      const peersBelow = peersBelowByBoard?.get?.(c.id) || [];
      inner = target
        ? <BoardCard board={target} boards={boards} teammates={TEAMMATES}
                     peersHere={peersHere} peersBelow={peersBelow}
                     peersHereByBoard={peersHereByBoard}
                     peersBelowByBoard={peersBelowByBoard}
                     onJumpToPeer={onJumpToPeer}
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
        : <div className="bc bc-missing" title={`Missing board ${c.id}`}>Missing board</div>;
    } else if (c.kind === 'boardlink') {
      const target = boards[c.target];
      inner = <BoardLinkCard targetBoard={target} note={c.note} onOpen={() => target && onOpenBoard(c.target)} />;
    } else if (c.kind === 'image')   inner = <ImageCard src={c.src || localImagePreview[c.id] || null} tone={c.tone} label={c.label} title={c.title} link={c.link} aspect={`${c.w}/${c.h}`} caption={c.caption} onUpdate={onUpdate} autoFocus={af}
                                                     editTitleAt={editFieldSignal.id === c.id && editFieldSignal.field === 'title' ? editFieldSignal.n : 0}
                                                     editCaptionAt={editFieldSignal.id === c.id && editFieldSignal.field === 'caption' ? editFieldSignal.n : 0}
                                                     pending={!!c.pending}
                                                     uploadProgress={uploadProgressById[c.id] ?? null}
                                                     onAfterEdit={() => { setSelected(new Set()); clearAutoFocus?.(); }} />;
    else if (c.kind === 'note')      inner = <NoteCard body={c.body} html={c.html} bgColor={c.bgColor} textColor={c.textColor} onUpdate={onUpdate} autoFocus={af}
                                                manuallyResized={!!c.manuallyResized}
                                                awareness={getAwareness?.() || null}
                                                cardId={c.id} boardId={board.id}
                                                peerLiveHtml={peerNoteEdits[c.id] ?? null}
                                                onEditingChange={(editing) => setEditingNoteId(editing ? c.id : (prev => (prev === c.id ? null : prev)))} />;
    else if (c.kind === 'link')      inner = <LinkCard title={c.title} source={c.source} target={c.target} onUpdate={onUpdate} autoFocus={af}
                                                       editTitleAt={editFieldSignal.id === c.id && editFieldSignal.field === 'title' ? editFieldSignal.n : 0} />;
    else if (c.kind === 'palette')   inner = <PaletteCard title={c.title} swatches={c.swatches} hideHex={c.hideHex} hideLabels={c.hideLabels} onUpdate={onUpdate} autoFocus={af} />;
    else if (c.kind === 'video')     inner = <VideoCard src={c.src} title={c.title} onUpdate={onUpdate} autoFocus={af} />;
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
                     getAwareness={getAwareness}
                     currentUser={currentUser}
                     wsPeers={wsPeers}
                     onJumpToPeer={onJumpToPeer}
                     canEdit={canEdit}
                     autoFocus={af}
                     onUpdate={onUpdate} />
      ) : <DocCard title={c.title} lines={c.lines} author={c.author} date={c.date} onUpdate={onUpdate} autoFocus={af} />;
    }
    else if (c.kind === 'schedule')  inner = <ScheduleCard title={c.title} rows={c.rows} />;
    else if (c.kind === 'shape')     inner = <ShapeCard key={`shape-${c.shape}`} shape={c.shape} stroke={c.stroke} fill={c.fill} strokeWidth={c.strokeWidth} dash={c.dash} />;
    else inner = <div className="card-unknown">{c.kind}</div>;

    // Tag chips along the card's bottom edge so the user actually sees
    // their tagging — without this, "Tag…" silently writes to the DB
    // and the user has no feedback that anything happened.
    const cardTags = tagsByCard?.get?.(c.id) || [];
    return (
      <div key={c.id} {...wrapper}>
        {inner}
        {cardTags.length > 0 && (
          <div className="card-tags-strip" data-card-id={c.id}>
            {cardTags.slice(0, 4).map(t => (
              <span key={t.id}
                    className={`card-tag-chip is-${t.source || 'user'}`}
                    style={{ '--tag-c': t.color || '#4f8df8' }}
                    title={t.source && t.source !== 'user' ? `${t.name} (${t.source})` : t.name}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setTagChipMenu({ x: e.clientX, y: e.clientY, kind: 'card', targetId: c.id, tag: t });
                    }}>
                <span className="card-tag-chip-dot" />
                <span className="card-tag-chip-name">{t.name}</span>
              </span>
            ))}
            {cardTags.length > 4 && (
              <span className="card-tag-chip card-tag-chip-overflow"
                    title={cardTags.slice(4).map(t => t.name).join(', ')}>
                +{cardTags.length - 4}
              </span>
            )}
          </div>
        )}
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
  // Tag drop highlight: when a tag is being dragged over the canvas,
  // show the hovered card / board in the tag's color so the user can
  // see exactly where it'll land. window.__soleilTagDrag is set by
  // SidebarTags onDragStart since dataTransfer payload isn't readable
  // during dragOver (only types).
  const [tagDropTarget, setTagDropTarget] = useState(null); // { cardId, color }
  const handleDragOver = (e) => {
    const types = e.dataTransfer.types;
    if (!types.includes(INBOX_MIME) &&
        !types.includes(BOARD_REF_MIME) &&
        !types.includes(CARD_TRANSFER_MIME) &&
        !types.includes(ENTITY_REF_MIME) &&
        !types.includes(ENTITY_REF_LIST_MIME) &&
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
    // Tag-drag highlight: read the side-channel state and find which
    // card is under the cursor. Update only on change to avoid React
    // re-renders on every dragover tick.
    const tagDrag = (typeof window !== 'undefined' && window.__soleilTagDrag) || null;
    if (tagDrag && types.includes(ENTITY_REF_MIME)) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const cardEl = el?.closest?.('[data-card-id]');
      const cardId = cardEl?.getAttribute('data-card-id') || null;
      const next = cardId ? { cardId, color: tagDrag.color || '#4f8df8' } : null;
      if ((tagDropTarget?.cardId || null) !== (next?.cardId || null)
       || (tagDropTarget?.color || null) !== (next?.color || null)) {
        setTagDropTarget(next);
      }
    } else if (tagDropTarget) {
      setTagDropTarget(null);
    }
  };
  const handleDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDragOver(false);
    setTagDropTarget(null);
  };
  const handleDrop = async (e) => {
    setDragOver(false);
    setTagDropTarget(null);
    const types = e.dataTransfer.types;
    const { x: cx, y: cy } = clientToCanvas(e.clientX, e.clientY);

    // Universal entity-ref drop: any EntityLink chip / picker row /
    // canvas card dragged here materializes as a 'link' chip card
    // pointing at the entity. Click the chip to navigate.
    //
    // Tag refs are special: dropping a tag onto a card / board card
    // applies the tag (link_kind='applied'); dropping on empty space
    // is a no-op rather than a confusing "tag link card."
    if (types.includes(ENTITY_REF_MIME) || types.includes(ENTITY_REF_LIST_MIME)) {
      e.preventDefault();
      const raw = e.dataTransfer.getData(ENTITY_REF_MIME);
      if (raw) {
        let ref = null;
        try { ref = coerceRef(JSON.parse(raw)); } catch (_) {}
        if (ref) {
          if (ref.kind === 'tag') {
            // Find which canvas card is under the drop point.
            const el = document.elementFromPoint(e.clientX, e.clientY);
            const cardEl = el && el.closest && el.closest('[data-card-id]');
            const droppedCardId = cardEl?.getAttribute('data-card-id') || null;
            const droppedCard = droppedCardId
              ? (cards || []).find(c => c.id === droppedCardId)
              : null;
            if (droppedCard) {
              if (droppedCard.kind === 'board') {
                tagBoard({ workspaceId, boardId: droppedCard.id, tagId: ref.id, source: 'user' })
                  .catch(err => feedback.toast({ type: 'error', message: 'Tag failed: ' + (err.message || err) }));
              } else {
                tagCard({ workspaceId, boardId: board.id, cardId: droppedCard.id, tagId: ref.id, source: 'user' })
                  .catch(err => feedback.toast({ type: 'error', message: 'Tag failed: ' + (err.message || err) }));
              }
            } else {
              feedback.toast({ type: 'info', message: 'Drop a tag onto a card or board to apply it.' });
            }
            return;
          }
          const w = 240, h = 70;
          mutators.addCard?.({
            id: `link-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
            kind: 'link', target: ref,
            title: ref.title || ref.name || ref.kind,
            x: Math.max(8, Math.round(cx - w / 2)),
            y: Math.max(8, Math.round(cy - h / 2)),
            w, h,
          });
          return;
        }
      }
    }

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

    // Inbox item (chat attachment) — checked BEFORE plain URL drops
    // because dragging an image from a message also auto-attaches a
    // text/uri-list mime via the browser's default img drag behavior;
    // without this priority the canvas would create a link card with
    // the image's URL instead of an actual image card.
    const inboxRawEarly = e.dataTransfer.getData(INBOX_MIME);
    if (inboxRawEarly) {
      e.preventDefault();
      let item;
      try { item = JSON.parse(inboxRawEarly); } catch (_) { return; }
      const card = inboxItemToCard(item, 0, 0);
      if (!card) return;
      card.x = Math.round(cx - card.w / 2);
      card.y = Math.round(cy - card.h / 2);
      mutators.addCard?.(card);
      onDropInboxItem && onDropInboxItem(item.id, card);
      return;
    }

    // Plain URL drag (e.g. from a list-board link row, browser address bar).
    if (types.includes('text/uri-list')) {
      e.preventDefault();
      const url = e.dataTransfer.getData('text/uri-list').split('\n')[0]?.trim();
      if (!url) return;
      // If the URL looks like an image (file extension or content-type
      // hint via the dragged element), drop as an image card so the
      // browser image-drag flow lands as a real image rather than a
      // generic link tile. Same defensive idea as the inbox case above
      // but for cross-tab drags from outside the app.
      const isImage = /\.(png|jpe?g|gif|webp|svg|avif)(\?|#|$)/i.test(url);
      if (isImage) {
        const w = 320, h = 240;
        mutators.addCard?.({
          id: `image-${Date.now()}`,
          kind: 'image', src: url,
          x: Math.max(8, Math.round(cx - w / 2)),
          y: Math.max(8, Math.round(cy - h / 2)),
          w, h,
        });
        return;
      }
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

    // Files (images / videos dragged from Finder).
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      e.preventDefault();
      const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
      const videoFiles = Array.from(files).filter(f => f.type.startsWith('video/'));
      let offsetX = 0;
      for (const f of imageFiles) {
        // Optimistic — adds the card and uploads in the background so
        // multi-file drops aren't blocked one at a time.
        optimisticDropImage(f, cx + offsetX, cy);
        offsetX += 260;
      }
      for (const f of videoFiles) {
        try {
          await dropVideoFile(f, cx + offsetX, cy);
          offsetX += 320;
        } catch (err) {
          console.error(err);
          feedback.toast({ type: 'error', message: 'Video upload failed: ' + (err.message || err) });
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
    <div className={`canvas-wrap ${dragOver ? 'is-drop-target' : ''} tool-${selectedTool} ${isPanMode ? 'is-pan' : ''} ${eyedropFor ? 'is-eyedrop' : ''}`}
         data-eyedrop={eyedropFor ? '1' : undefined}
         ref={wrapRef}
         style={wrapStyle}
         onDragOver={handleDragOver}
         onDragLeave={handleDragLeave}
         onDrop={handleDrop}
         onPointerDown={onBackgroundPointerDown}
         onContextMenu={onBackgroundContextMenu}>
      {/* Grain texture — sits behind cards on the canvas surface
          only. Cards / popovers / modals all stack above it. */}
      <div className="grain-canvas" aria-hidden="true" />
      {(tagsByBoard?.get(board.id) || []).length > 0 && (
        <div className="board-tags-strip" data-board-id={board.id}>
          {(tagsByBoard.get(board.id) || []).slice(0, 6).map(t => (
            <span key={t.id}
                  className={`card-tag-chip is-${t.source || 'user'}`}
                  style={{ '--tag-c': t.color || '#4f8df8' }}
                  title={t.source && t.source !== 'user' ? `${t.name} (${t.source}) — right-click to confirm` : t.name}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setTagChipMenu({ x: e.clientX, y: e.clientY, kind: 'board', targetId: board.id, tag: t });
                  }}>
              <span className="card-tag-chip-dot" />
              <span className="card-tag-chip-name">{t.name}</span>
            </span>
          ))}
        </div>
      )}
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
        {/* Group outlines + name labels — drawn behind the cards.
            Two shapes:
              'box' (default) — one rounded rect around the bounding box.
              'hug'           — per-card rounded rects whose outlines
                                merge where cards overlap, so the
                                contour follows the cluster instead of
                                a giant rectangle. */}
        {groups.length > 0 && (
          <div className="groups-layer" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            {groups.map(g => {
              const members = cardsByGroup.get(g.id) || [];
              if (members.length < 2) return null;
              const stroke = g.color || 'var(--soleil)';
              const sw = g.width || 1;
              const PAD = 12;
              const adj = (c) => (drag && drag.ids?.includes?.(c.id))
                ? { x: c.x + (drag.dx || 0), y: c.y + (drag.dy || 0), w: c.w, h: c.h }
                : { x: c.x, y: c.y, w: c.w, h: c.h };
              const adjMembers = members.map(adj);

              // Bounding box (used by both modes for the label position
              // and by 'box' mode for the rect itself).
              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
              for (const a of adjMembers) {
                minX = Math.min(minX, a.x);
                minY = Math.min(minY, a.y);
                maxX = Math.max(maxX, a.x + (a.w || 0));
                maxY = Math.max(maxY, a.y + (a.h || 0));
              }
              if (!Number.isFinite(minX)) return null;

              // Label position in canvas-space — anchored to the
              // OUTLINE's top-left, sitting just above and slightly
              // inside. Rendered as a sibling of the outline (NOT a
              // child) so the same coords work for box + hug.
              const labelLeft = minX - PAD + 8;
              const labelTop  = minY - PAD - 22;
              // hideLabel — set via right-click → "Hide group label". The
              // group still exists and its outline still renders; we just
              // suppress the chip so the canvas reads cleaner when the
              // grouping is decorative rather than semantic.
              const labelEl = (g.name && !g.options?.hideLabel) ? (
                <div className="group-label"
                     key={`${g.id}-label`}
                     style={{
                       position: 'absolute',
                       left: labelLeft, top: labelTop,
                       padding: '2px 8px',
                       font: '700 10px/1.4 var(--font-sans)',
                       letterSpacing: '0.12em',
                       textTransform: 'uppercase',
                       color: g.outline ? stroke : 'var(--ink-3)',
                       background: 'var(--bg-1)',
                       borderRadius: 4,
                       border: g.outline ? `1px solid ${stroke}` : '1px solid var(--line-1)',
                       pointerEvents: 'auto',
                       cursor: 'context-menu',
                       whiteSpace: 'nowrap',
                     }}
                     title={`${g.name} — right-click for group actions`}
                     onContextMenu={(e) => {
                       e.preventDefault();
                       e.stopPropagation();
                       setBgCtx({
                         open: true,
                         x: e.clientX, y: e.clientY,
                         canvasPos: null,
                         groupMenu: { id: g.id, name: g.name },
                       });
                     }}>
                  {g.name}
                </div>
              ) : null;

              if ((g.shape || 'box') === 'hug' && g.outline) {
                // Render a contoured outline by overlaying two SVG layers:
                //  outer: rounded rects per card padded by PAD+SW filled
                //         with the stroke color.
                //  inner: rounded rects per card padded by PAD filled
                //         with the canvas background — punches out the
                //         interior so only the OUTSIDE of the union shows
                //         in stroke color. Adjacent cards merge naturally
                //         because both layers' rects overlap.
                const buf = sw + 2;
                const svgX = minX - PAD - buf;
                const svgY = minY - PAD - buf;
                const svgW = (maxX - minX) + 2 * (PAD + buf);
                const svgH = (maxY - minY) + 2 * (PAD + buf);
                return (
                  <Fragment key={g.id}>
                    <svg className="group-outline group-hug" width={svgW} height={svgH}
                         style={{
                           position: 'absolute',
                           left: svgX, top: svgY,
                           overflow: 'visible',
                           pointerEvents: 'none',
                         }}>
                      {/* Outer (stroke color) */}
                      {adjMembers.map((c, i) => (
                        <rect key={`o-${i}`}
                              x={c.x - PAD - sw - svgX}
                              y={c.y - PAD - sw - svgY}
                              width={c.w + 2 * (PAD + sw)}
                              height={c.h + 2 * (PAD + sw)}
                              rx={PAD + sw} ry={PAD + sw}
                              fill={stroke} />
                      ))}
                      {/* Inner punch-out (canvas bg). uses CSS variable
                          so it tracks the active board's background. */}
                      {adjMembers.map((c, i) => (
                        <rect key={`i-${i}`}
                              x={c.x - PAD - svgX}
                              y={c.y - PAD - svgY}
                              width={c.w + 2 * PAD}
                              height={c.h + 2 * PAD}
                              rx={PAD} ry={PAD}
                              style={{ fill: 'var(--canvas-bg, var(--bg-1))' }} />
                      ))}
                    </svg>
                    {labelEl}
                  </Fragment>
                );
              }

              // box mode (default)
              const x = minX - PAD, y = minY - PAD;
              const w = (maxX - minX) + PAD * 2;
              const h = (maxY - minY) + PAD * 2;
              return (
                <Fragment key={g.id}>
                  <div className={`group-outline ${g.outline ? 'is-on' : 'is-off'}`}
                       style={{
                         position: 'absolute',
                         left: x, top: y, width: w, height: h,
                         borderRadius: 14,
                         border: g.outline ? `${sw}px solid ${stroke}` : '1px dashed transparent',
                         pointerEvents: 'none',
                       }} />
                  {labelEl}
                </Fragment>
              );
            })}
          </div>
        )}
        <div className="cards-layer">{sortedCards.map(renderCard)}</div>

        {/* Snap-alignment guidelines — gold hairlines along the matched
            edge / center while a drag is snapping. Cleared on drag end. */}
        {snapHints && (snapHints.xs?.length || snapHints.ys?.length || snapHints.spacings?.length) && (
          <svg className="snap-guides"
               width={VIRTUAL_CANVAS_PX} height={VIRTUAL_CANVAS_PX}
               style={{ position: 'absolute', left: 0, top: 0,
                        pointerEvents: 'none', overflow: 'visible',
                        zIndex: 999997 }}>
            {/* Edge / center alignment lines — toned down so they
                read as a hint, not a full ruler. */}
            {(snapHints.xs || []).map((g, i) => (
              <line key={`gx-${i}`} x1={g.x} x2={g.x} y1={g.y0 - 12} y2={g.y1 + 12}
                    stroke="var(--soleil)"
                    strokeOpacity="0.42"
                    strokeWidth={1 / zoom}
                    vectorEffect="non-scaling-stroke" />
            ))}
            {(snapHints.ys || []).map((g, i) => (
              <line key={`gy-${i}`} y1={g.y} y2={g.y} x1={g.x0 - 12} x2={g.x1 + 12}
                    stroke="var(--soleil)"
                    strokeOpacity="0.42"
                    strokeWidth={1 / zoom}
                    vectorEffect="non-scaling-stroke" />
            ))}
            {/* Equal-spacing markers — drawn between paired neighbours
                with tiny end caps + a label so the user sees "I matched
                a 24px gap that already existed". */}
            {(snapHints.spacings || []).map((s, i) => {
              const isX = s.axis === 'x';
              const labelX = isX ? (s.a + s.b) / 2 : s.cross;
              const labelY = isX ? s.cross : (s.a + s.b) / 2;
              return (
                <Fragment key={`gs-${i}`}>
                  {isX ? (
                    <>
                      <line x1={s.a} x2={s.b} y1={s.cross} y2={s.cross}
                            stroke="var(--soleil)" strokeOpacity="0.6"
                            strokeWidth={1 / zoom}
                            strokeDasharray={`${4 / zoom} ${3 / zoom}`}
                            vectorEffect="non-scaling-stroke" />
                      <line x1={s.a} x2={s.a} y1={s.cross - 5 / zoom} y2={s.cross + 5 / zoom}
                            stroke="var(--soleil)" strokeOpacity="0.6"
                            strokeWidth={1 / zoom} vectorEffect="non-scaling-stroke" />
                      <line x1={s.b} x2={s.b} y1={s.cross - 5 / zoom} y2={s.cross + 5 / zoom}
                            stroke="var(--soleil)" strokeOpacity="0.6"
                            strokeWidth={1 / zoom} vectorEffect="non-scaling-stroke" />
                    </>
                  ) : (
                    <>
                      <line x1={s.cross} x2={s.cross} y1={s.a} y2={s.b}
                            stroke="var(--soleil)" strokeOpacity="0.6"
                            strokeWidth={1 / zoom}
                            strokeDasharray={`${4 / zoom} ${3 / zoom}`}
                            vectorEffect="non-scaling-stroke" />
                      <line x1={s.cross - 5 / zoom} x2={s.cross + 5 / zoom} y1={s.a} y2={s.a}
                            stroke="var(--soleil)" strokeOpacity="0.6"
                            strokeWidth={1 / zoom} vectorEffect="non-scaling-stroke" />
                      <line x1={s.cross - 5 / zoom} x2={s.cross + 5 / zoom} y1={s.b} y2={s.b}
                            stroke="var(--soleil)" strokeOpacity="0.6"
                            strokeWidth={1 / zoom} vectorEffect="non-scaling-stroke" />
                    </>
                  )}
                  <text x={labelX} y={labelY}
                        fill="var(--soleil)"
                        fontSize={10 / zoom}
                        fontFamily="ui-monospace, monospace"
                        textAnchor="middle"
                        dy={isX ? -6 / zoom : 0}
                        dx={isX ? 0 : 8 / zoom}
                        opacity="0.85"
                        style={{ paintOrder: 'stroke', stroke: 'var(--bg-0)', strokeWidth: 3 / zoom }}>
                    {s.gap}
                  </text>
                </Fragment>
              );
            })}
          </svg>
        )}

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
              // Optional reverse arrowhead at the start when a.bidir is on.
              // The tangent at the start is the negative of the start->end
              // direction (or, for curves, the start tangent towards the
              // control point). Reuse ux/uy by inverting them.
              const tail = a.bidir
                ? `${s.x},${s.y} ${s.x+ux*9-uy*4},${s.y+uy*9+ux*4} ${s.x+ux*9+uy*4},${s.y+uy*9-ux*4}`
                : null;
              // Label position — same offset logic for both styles
              const cx = (s.x+e.x)/2 + (a.straight ? 0 : (-dy/len) * Math.min(36, len*0.12));
              const cy = (s.y+e.y)/2 + (a.straight ? 0 : (dx/len)  * Math.min(36, len*0.12));
              const sel = selectedArrows.has(i);
              return (
                <g key={i} data-arrow-idx={i}>
                  {/* Hit target — only path with pointer-events; svg root is none. */}
                  <path d={path} fill="none" stroke="transparent" strokeWidth="14"
                        pointerEvents={strokesInteractive ? 'stroke' : 'none'}
                        style={{ cursor: strokesInteractive ? 'pointer' : 'default' }}
                        onPointerDown={strokesInteractive ? (ev) => onArrowClick(ev, i) : undefined}
                        onContextMenu={strokesInteractive ? (ev) => onArrowContextMenu(ev, i) : undefined} />
                  {sel && <path d={path} fill="none" stroke="rgba(245,158,11,.55)" strokeWidth="6" strokeLinecap="round" pointerEvents="none" />}
                  <path data-arrow-line d={path} fill="none" stroke="currentColor" strokeWidth="1.1" opacity=".5"
                        strokeDasharray={a.dashed ? '4 4' : '0'} strokeLinecap="round" pointerEvents="none" />
                  <polygon points={head} fill="currentColor" opacity=".5" pointerEvents="none" />
                  {tail && <polygon points={tail} fill="currentColor" opacity=".5" pointerEvents="none" />}
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
              <g key={i} data-stroke-idx={i}>
                <path d={path} fill="none" stroke="transparent" strokeWidth={hitW}
                      pointerEvents={strokesInteractive ? 'stroke' : 'none'}
                      style={{ cursor: strokesInteractive ? 'pointer' : 'default' }}
                      onPointerDown={strokesInteractive ? (ev) => onStrokeClick(ev, i) : undefined} />
                {sel && <path d={path} fill="none" stroke="rgba(245,158,11,.55)"
                              strokeWidth={w + 6} strokeLinecap="round" strokeLinejoin="round"
                              pointerEvents="none" />}
                <path data-stroke-line d={path} fill="none"
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

        {/* Anywhere-comment bubbles. Mounted INSIDE the canvas transform
            so they scale with zoom and feel like part of the board
            content; the connector line + anchor dot show users exactly
            which card / group / point each comment is attached to. */}
        <CanvasCommentLayer
          comments={comments}
          boardId={board?.id}
          workspaceId={workspaceId}
          userId={userId}
          wsPeers={wsPeers}
          currentUser={currentUser}
          zoom={zoom}
          resolveCardBBox={resolveCardBBox}
          resolveGroupBBox={resolveGroupBBox}
          draft={commentDraft}
          onSubmitDraft={submitCommentDraft}
          onCancelDraft={() => setCommentDraft(null)}
          onLocallyRemoved={removeCommentLocally}
          layerVisible={commentsVisible}
        />

      </div>

      {/* Off-screen BoardThumbnail used as the source SVG for PNG/PDF
          exports. Sized 0×0 + visibility:hidden so it stays in the DOM
          (so the export refs can read it) without affecting layout. */}
      <div ref={exportSvgRef}
           style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden',
                    visibility: 'hidden', pointerEvents: 'none' }}>
        <BoardThumbnail cards={cards} strokes={strokes} boards={boards} />
      </div>


      <div className={`cnv-tools ${canEdit ? '' : 'is-readonly'}`}>
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
        <div className="cnv-tool-sep" />
        <div className="cnv-tool"
             title="Sketch pad — fullscreen drawing"
             role="button"
             tabIndex={0}
             aria-label="Sketch pad"
             onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSketchpadOpen(true); } }}
             onPointerDown={(e) => { e.stopPropagation(); setSketchpadOpen(true); }}>
          <svg width="20" height="20" viewBox="0 0 20 20">
            <rect x="3" y="3" width="14" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.2" fill="none"/>
            <path d="M6 13 Q9 8 13 11 Q15 12 14 14" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
          </svg>
        </div>
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

      {/* Master comments-visibility toggle. Always rendered — left-click
          shows/hides every comment bubble on the canvas; right-click
          opens the archive popover with resolved + hidden comments and
          one-click reopen / unhide actions. The badge shows the count
          of currently-visible comments (or the archived count when
          comments are muted, so the user still feels there's
          something to bring back). */}
      <button className={`cnv-comments-eye ${commentsVisible ? '' : 'is-muted'}`}
              title={commentsVisible
                ? 'Hide all comments (right-click for archive)'
                : 'Show all comments (right-click for archive)'}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={toggleCommentsVisible}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const r = e.currentTarget.getBoundingClientRect();
                setCommentArchive({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
              }}>
        <Icon as={MessageCircle} size={13} />
        <Icon as={commentsVisible ? Eye : EyeOff} size={13} />
        {/* Badge counts only currently-visible (open, non-archived)
            comments — resolved and hidden don't count, since they're
            archived and live in the popover instead. */}
        {visibleCommentCount > 0 && (
          <span className="cnv-comments-eye-count">{visibleCommentCount}</span>
        )}
      </button>
      {commentArchive && (
        <CommentArchivePopover
          comments={comments}
          anchorRect={commentArchive}
          userId={userId}
          wsPeers={wsPeers}
          currentUser={currentUser}
          onLocallyRemoved={removeCommentLocally}
          onClose={() => setCommentArchive(null)}
        />
      )}

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

      {infoFor && (() => {
        const c = cardById[infoFor.cardId];
        if (!c) return null;
        return (
          <CardInfoPopover
            x={infoFor.x} y={infoFor.y}
            card={c}
            currentUserId={currentUser?.id}
            getAwareness={getAwareness}
            onClose={() => setInfoFor(null)}
          />
        );
      })()}

      <BackgroundContextMenu
        open={bgCtx.open}
        x={bgCtx.x}
        y={bgCtx.y}
        items={buildBgMenu()}
        onClose={closeBgMenu}
        workspaceId={workspaceId}
        boardId={board?.id}
        boardName={board?.name}
      />

      {/* Anchor the tool-options bar to the active selection when a
          single card is selected — easier to find ("hovers next to what
          you're editing"). Falls back to bottom-center default when
          nothing or multiple things are selected. */}
      <ToolOptionsBar
        selectedTool={selectedTool}
        drawOptions={drawOptions} setDrawOptions={setDrawOptions}
        shapeOptions={shapeOptions} setShapeOptions={setShapeOptions}
        arrowOptions={arrowOptions} setArrowOptions={setArrowOptions}
        editingNoteCard={editingNoteId ? cardById[editingNoteId] : null}
        onUpdateEditingNote={editingNoteId ? (patch) => mutators.updateCard?.(editingNoteId, patch) : null}
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
        anchorRect={(() => {
          if (selected.size !== 1) return null;
          const id = [...selected][0];
          const c = cardById[id];
          if (!c) return null;
          const tl = canvasToViewport(c.x, c.y);
          const br = canvasToViewport(c.x + c.w, c.y + c.h);
          return { left: tl.x, top: tl.y, right: br.x, bottom: br.y };
        })()}
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
      {tagPicker && (
        <TagPicker
          open={!!tagPicker}
          anchorRect={tagPicker.anchorRect}
          onClose={closeTagPicker}
          tags={wsTags}
          appliedIds={new Set((tagsByCard.get(tagPicker.cardId) || []).map(t => t.id))}
          onToggle={(t) => toggleTagOnCard(tagPicker.cardId, t)}
          onCreate={(name) => createAndApplyTag(tagPicker.cardId, name)}
        />
      )}
      {tagChipMenu && (
        <div className="sb-tag-menu" role="menu"
             style={{ position: 'fixed', left: tagChipMenu.x, top: tagChipMenu.y, zIndex: 60 }}
             onMouseDown={(e) => e.stopPropagation()}>
          {tagChipMenu.tag.source && tagChipMenu.tag.source !== 'user' && (
            <button className="sb-tag-menu-item" role="menuitem"
                    onClick={async () => {
                      const { kind, targetId, tag } = tagChipMenu;
                      closeTagChipMenu();
                      try {
                        await confirmAppliedTag({
                          sourceKind: kind, sourceId: targetId,
                          sourceBoardId: kind === 'card' ? board.id : null,
                          tagId: tag.id,
                        });
                        refreshTags?.();
                      } catch (err) {
                        feedback.toast({ type: 'error', message: 'Confirm failed: ' + (err.message || err) });
                      }
                    }}>
              Confirm tag
            </button>
          )}
          <button className="sb-tag-menu-item" role="menuitem"
                  title="Removes this tag and won't auto-apply it here again. Drag the tag back to undo."
                  onClick={async () => {
                    const { kind, targetId, tag } = tagChipMenu;
                    closeTagChipMenu();
                    try {
                      if (kind === 'card') {
                        await untagCard({ boardId: board.id, cardId: targetId, tagId: tag.id });
                      } else if (kind === 'board') {
                        await untagBoard({ boardId: targetId, tagId: tag.id });
                      }
                      // Always dismiss too. Without this, the autotag
                      // triggers re-apply on the next card_index UPDATE
                      // and "Remove tag" feels broken.
                      await dismissAutotagSuggestion({
                        workspaceId, targetKind: kind, targetId,
                        tagId: tag.id, userId,
                      });
                      refreshTags?.();
                    } catch (err) {
                      feedback.toast({ type: 'error', message: 'Remove failed: ' + (err.message || err) });
                    }
                  }}>
            Remove tag
          </button>
        </div>
      )}
      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)} role="dialog" aria-label="Image preview">
          <button className="lightbox-x" aria-label="Close" onClick={(e) => { e.stopPropagation(); setLightbox(null); }}>×</button>
          <R2Image className="lightbox-img"
                   src={lightbox.src}
                   alt={lightbox.title || ''}
                   onClick={(e) => e.stopPropagation()} />
          {lightbox.title && <div className="lightbox-cap">{lightbox.title}</div>}
        </div>
      )}
      <SketchPadOverlay
        open={sketchpadOpen}
        onClose={() => setSketchpadOpen(false)}
        onCommitStrokes={(strokes) => {
          if (!strokes?.length) return;
          // Convert pad-local pixels → canvas units AND center the bundle
          // on the user's current viewport so the strokes land where the
          // user is actually looking, not buried at the top-left.
          // 1) Compute the strokes' bounding box in pad coords.
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const s of strokes) for (const [x, y] of s.points) {
            if (x < minX) minX = x; if (y < minY) minY = y;
            if (x > maxX) maxX = x; if (y > maxY) maxY = y;
          }
          const padW = maxX - minX, padH = maxY - minY;
          // 2) Viewport center in canvas units.
          const wrap = wrapRef.current;
          const r = wrap?.getBoundingClientRect?.() || { width: 800, height: 600 };
          const vCx = (-pan.x + r.width  / 2) / zoom;
          const vCy = (-pan.y + r.height / 2) / zoom;
          // 3) Bundle center in canvas units = (padCenter / zoom) shifted to vCenter.
          const dx = vCx - (minX + padW / 2) / zoom;
          const dy = vCy - (minY + padH / 2) / zoom;
          for (const s of strokes) {
            const points = s.points.map(([x, y]) => [x / zoom + dx, y / zoom + dy]);
            mutators.addStroke?.({ color: s.color, width: s.width, points });
          }
        }} />
    </div>
  );
}

// ── CardInfoPopover ──────────────────────────────────────────────────────
// Tiny "Info" panel — shown on right-click → Info. Surfaces who created
// the card (via stampCreate's createdBy) and when (createdAt). Looks
// the creator up via Yjs awareness so an online peer's display name +
// color show up; falls back to "Someone else" for offline / unknown.
function CardInfoPopover({ x, y, card, currentUserId, getAwareness, onClose }) {
  // Click-away to close.
  const ref = useRef(null);
  useEffect(() => {
    const onDocDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose?.(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const creator = (() => {
    const id = card?.createdBy;
    if (!id) return { name: 'Unknown', color: '#5b574e' };
    if (id === currentUserId) return { name: 'You', color: 'var(--soleil)' };
    try {
      const aw = getAwareness?.();
      if (aw) {
        for (const state of aw.getStates().values()) {
          if (state?.user?.id === id) return { name: state.user.name || state.user.email || 'Teammate', color: state.user.color || '#4f8df8' };
        }
      }
    } catch (_) {}
    return { name: 'Someone else', color: '#5b574e' };
  })();

  const when = (() => {
    const t = card?.createdAt;
    if (!t) return null;
    const d = typeof t === 'string' ? new Date(t) : new Date(t);
    if (isNaN(d.getTime())) return null;
    const diff = Date.now() - d.getTime();
    const min = Math.floor(diff / 60000);
    let rel;
    if (min < 1) rel = 'just now';
    else if (min < 60) rel = `${min}m ago`;
    else if (min < 60 * 24) rel = `${Math.floor(min / 60)}h ago`;
    else if (min < 60 * 24 * 30) rel = `${Math.floor(min / (60 * 24))}d ago`;
    else rel = d.toLocaleDateString();
    return { rel, abs: d.toLocaleString() };
  })();

  // Anchor near the click but keep on-screen.
  const W = 240, H = 110;
  const left = Math.min(window.innerWidth - W - 8, Math.max(8, x));
  const top  = Math.min(window.innerHeight - H - 8, Math.max(8, y));

  return (
    <div ref={ref}
         className="card-info-popover"
         style={{ position: 'fixed', left, top, zIndex: 2147483647 }}
         onClick={(e) => e.stopPropagation()}>
      <div className="card-info-popover-row">
        <span className="card-info-popover-label">Created by</span>
        <span className="card-info-popover-value">
          <span className="card-info-popover-dot" style={{ background: creator.color }} />
          {creator.name}
        </span>
      </div>
      <div className="card-info-popover-row">
        <span className="card-info-popover-label">Created</span>
        <span className="card-info-popover-value" title={when?.abs || ''}>
          {when ? when.rel : 'Unknown'}
        </span>
      </div>
      <div className="card-info-popover-row">
        <span className="card-info-popover-label">Type</span>
        <span className="card-info-popover-value">{card?.kind || 'card'}</span>
      </div>
    </div>
  );
}
