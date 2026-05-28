import { memo, useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, Fragment } from 'react';
import * as perf from '../lib/perf.js';
import {
  BoardCard, BoardLinkCard, ImageCard, NoteCard, LinkCard,
  PaletteCard, DocCard, ScheduleCard, ShapeCard, VideoCard, AudioCard, ArtCanvasCard,
} from './cards.jsx';
import { RichDocCard } from './DocCard.jsx';

// Reuse ShapeCard as our drag-preview renderer.
const ShapePreview = ShapeCard;
import { LiveCursor, COVER_TINTS } from './primitives.jsx';
import { CanvasPresence } from './CanvasPresence.jsx';
import { CardContextMenu } from './CardContextMenu.jsx';
import { SketchPadOverlay } from './SketchPadOverlay.jsx';
import { BackgroundContextMenu } from './BackgroundContextMenu.jsx';
import { ReadOnlyBanner } from './ReadOnlyBanner.jsx';
import { ToolOptionsBar } from './ToolOptionsBar.jsx';
import { ColorPicker } from './ColorPicker.jsx';
import { useFeedback } from './AppFeedback.jsx';
import {
  Eye, EyeOff, MessageCircle,
  MousePointer2, Hand, NotePencil, Image as ImageIcon, Square, Scribble, ArrowRight, Plus,
} from '../lib/icons.js';
import { Icon } from './Icon.jsx';
import { TEAMMATES } from '../data.js';
import { INBOX_MIME, BOARD_REF_MIME, CARD_TRANSFER_MIME, ENTITY_REF_MIME, ENTITY_REF_LIST_MIME, inboxItemToCard } from '../lib/dragMimes.js';
import { coerceRef } from '../lib/entityRef.js';
import { uploadImage, uploadVideo, uploadAudio } from '../lib/uploads.js';
import { R2Image } from './R2Image.jsx';
import { ImageLightbox } from './ImageLightbox.jsx';
import { setClipboard, getClipboard, clipboardSize, hasRecentInternalCopy, matchesSentinel, looksLikeSentinel } from '../lib/clipboard.js';
import { useGesture } from '@use-gesture/react';
import { useLongPress } from '../hooks/useLongPress.js';
import { prefetchBoard } from '../lib/prefetchKinds.js';
import * as Y from 'yjs';
import { supabase } from '../lib/supabase.js';
import { addRecentColor } from '../lib/recentColors.js';
import { loadBoardView, saveBoardView } from '../lib/boardViewState.js';
import { fetchLinkPreview } from '../lib/linkPreview.js';
import { detectEmbed } from '../lib/oembed.js';
import { relativeTimeShort } from '../lib/relativeTime.js';
import { exportBoardAsPng, exportBoardAsPdf, svgToPngBlob } from '../lib/exportBoard.js';
import { BoardThumbnail } from './BoardThumbnail.jsx';
import { CanvasCommentLayer, CommentArchivePopover } from './CanvasComment.jsx';
import { useCanvasComments } from '../hooks/useCanvasComments.js';
import * as userProfiles from '../lib/userProfiles.js';
import { addComment, updateComment, unhideAllOnBoard } from '../lib/commentsApi.js';
import { pickCommentOffset, pickCommentOffsetForGroup } from '../lib/commentPlacement.js';
import { TagPicker } from './TagPicker.jsx';
import { useWorkspaceTags } from '../hooks/useWorkspaceTags.js';
import { useWorkspacePalettes } from '../hooks/useWorkspacePalettes.js';
import { ensureTag, tagCard, untagCard, tagBoard, untagBoard, tagGroup, untagGroup, confirmAppliedTag, dismissAutotagSuggestion } from '../lib/tagsApi.js';
import { syncCardIndex, saveBoardVersion, fetchPrevChange, fetchNextChange, loadBoardVersionDoc, restoreBoard, applyMetaChangeUndo, bulletproofRestore, decodeSnapshotBytes } from '../lib/boardsApi.js';
import {
  computeArrowAttachments, buildArrowPath, arrowHeadPolygon,
  arrowStrokeWidth, arrowHeadSize, arrowColor, arrowHeadStyle, arrowRefEquals,
} from '../lib/arrowGeometry.js';
import { boundsOfCards, oppositeCorner } from '../lib/canvasGeom.js';
import { ArrowPopover } from './ArrowPopover.jsx';

const RESIZE_HANDLE_PX = 14;
const MIN_W = 60, MIN_H = 40;
const ZOOM_MIN = 0.1, ZOOM_MAX = 5.0;
const DRAW_DEFAULT_COLOR = '#f5f5f6';
const DRAW_DEFAULT_WIDTH = 3;
const ERASER_DEFAULT_WIDTH = 16;
const VIRTUAL_CANVAS_PX = 100000;
const STROKE_HIT_PADDING = 12; // invisible hit region added around each stroke
// Module-level singleton — used as the "no peers on this card" default so
// BoardCard's memo doesn't bust from a fresh `|| []` allocation each render.
const EMPTY_PEERS_ARR = [];

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
const PRESENCE_COLORS = ['#ffa500', '#6b8090', '#9a6b88', '#c9a577', '#6b9088', '#b88958'];
function pickPresenceColor(id) {
  if (!id) return PRESENCE_COLORS[0];
  let h = 0; for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return PRESENCE_COLORS[Math.abs(h) % PRESENCE_COLORS.length];
}
const cmdKey = isMac ? '⌘' : 'Ctrl';

// "Is the user actively typing in an editor?" predicate, used by the
// window-level paste / keyboard / pointer guards. The naive
// `e.target.isContentEditable` check used to be brittle: in Tiptap /
// ProseMirror the paste event target ends up being an element whose
// nearest ancestor is contenteditable but the target itself isn't, so
// the guard fell through and the canvas spawned a duplicate note from
// the clipboard text. Belt-and-suspenders covers four signals.
function isEditorTarget(e) {
  const t = e?.target;
  const tag = t?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  if (t?.isContentEditable) return true;
  if (t?.closest?.('[contenteditable="true"], [contenteditable=""]')) return true;
  const ae = (typeof document !== 'undefined') ? document.activeElement : null;
  if (ae && (ae.isContentEditable || ae.closest?.('[contenteditable="true"]'))) return true;
  // Live selection anchored inside a contenteditable (covers cases where
  // both `e.target` and `activeElement` are document.body but the caret
  // is parked inside an editor).
  if (typeof window !== 'undefined') {
    const sel = window.getSelection?.();
    const anchor = sel?.anchorNode;
    const anchorEl = anchor?.nodeType === 3 ? anchor.parentElement : anchor;
    if (anchorEl?.closest?.('[contenteditable="true"]')) return true;
  }
  return false;
}

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
  boardPermission = null,  // { role, canEdit, source } from useBoardPermission;
                           // drives the ReadOnlyBanner + upgrade-CTA copy
  onRequestUpgrade = null, // () => void — opens App's UpgradeModal
  autotagSuggest,          // (content, target) => Promise<[{tagId,score,reason}]>
  autotagReady = false,    // worker hydration finished
  sessionId = null,        // per-tab session id for board_versions grouping
  defaults,                // useResolvedDefaults() output — drives initial
                           // tool options so a workspace's shape stroke/fill
                           // settings actually shape what gets drawn.
}) {
  perf.bump('cs.renderCount');
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
  // The .canvas div whose CSS transform we mutate imperatively during pan/
  // zoom gestures. Gesture-time updates write to panRef/zoomRef AND to
  // this element's style.transform directly; React state is only committed
  // (setPan/setZoom) at gesture end so we don't re-render every card 120×/s
  // while panning. The useLayoutEffect below keeps ref + DOM in lockstep
  // with state when state changes from non-gesture paths (reset zoom,
  // fit-to-view, etc.).
  // Round 17 instrumentation: capture component mount time so the first
  // viewport-cull pass can emit `canvasSurface.mountToFirstCull.ms` (see
  // scheduleVisibleRecompute below). Surfaces as a named bar in DevTools
  // Performance "Timings" lane.
  const _mountRef = useRef(perf.isEnabled() ? performance.now() : 0);
  const _firstCullDoneRef = useRef(false);
  // Round 17: track zoom-handler count so we can emit `firstZoom.ms` vs
  // `zoom.ms` separately. Reset when board.id changes (see effect at
  // ~line 853 which already resets per-board state).
  const _zoomCountRef = useRef(0);

  const canvasRef = useRef(null);
  const applyCanvasTransform = () => {
    const el = canvasRef.current;
    if (!el) return;
    // translateZ(0) hint at the end keeps the GPU layer promoted across
    // transform changes. Round 9's CSS `will-change: transform` can be
    // silently ignored by Chrome when the resulting layer would exceed
    // the max raster size — translateZ(0) is the legacy promotion hint
    // that survives that fallback. We include it on every transform
    // update because the CSS-side declaration would otherwise be
    // overwritten by this imperative assignment.
    el.style.transform = `translate3d(${panRef.current.x}px, ${panRef.current.y}px, 0) scale(${zoomRef.current})`;
  };
  // ── Viewport culling state (D1) ──────────────────────────────────────────
  // visibleIds = Set of card ids currently within (viewport + 1-screen margin).
  // null sentinel means "render all" — used before the first measurement so
  // we don't ever show an empty board.
  // sortedCardsRef + wrapWHRef + visibleRafRef are read by the RAF-throttled
  // recompute below; refs keep the recompute function stable and let us
  // invoke it from gesture handlers without re-binding.
  const [visibleIds, setVisibleIds] = useState(null);
  const sortedCardsRef = useRef(null);
  const wrapWHRef = useRef({ w: 0, h: 0 });
  const visibleRafRef = useRef(0);
  const scheduleVisibleRecompute = useCallback(() => {
    if (visibleRafRef.current) return;
    visibleRafRef.current = requestAnimationFrame(() => {
      visibleRafRef.current = 0;
      const _t0 = perf.isEnabled() ? performance.now() : 0;
      const z = zoomRef.current;
      const px = panRef.current.x;
      const py = panRef.current.y;
      const { w: wrapW, h: wrapH } = wrapWHRef.current;
      const arr = sortedCardsRef.current;
      if (!z || !wrapW || !wrapH || !arr) return;
      // Canvas-space viewport bbox, expanded by one viewport in each
      // direction so cards just off-screen stay mounted (no pop-in on pan).
      const vx = -px / z, vy = -py / z;
      const vw = wrapW / z, vh = wrapH / z;
      const minX = vx - vw, maxX = vx + 2 * vw;
      const minY = vy - vh, maxY = vy + 2 * vh;
      const next = new Set();
      for (let i = 0; i < arr.length; i++) {
        const c = arr[i];
        if (c.x + c.w < minX || c.x > maxX) continue;
        if (c.y + c.h < minY || c.y > maxY) continue;
        next.add(c.id);
      }
      // Skip the setState if the id set didn't change (common on pan
      // micro-movements that don't bring/take any card across the band).
      setVisibleIds(prev => {
        if (prev && prev.size === next.size) {
          let same = true;
          for (const id of next) { if (!prev.has(id)) { same = false; break; } }
          if (same) return prev;
        }
        return next;
      });
      perf.bump('cull.runs');
      if (_t0) perf.mark('cull.ms', performance.now() - _t0);
      // Round 17: first viewport cull after CanvasSurface mount —
      // captures "mount to first-paint-with-culling" cost, the
      // bookend of the first-open hitch on the React side. (The
      // Y.Doc-side cost is captured separately as
      // `firstOpen.boardIdToReady.ms` in useYBoard.)
      if (!_firstCullDoneRef.current) {
        _firstCullDoneRef.current = true;
        if (_mountRef.current) {
          perf.mark('canvasSurface.mountToFirstCull.ms', performance.now() - _mountRef.current);
        }
      }
    });
  }, []);
  useLayoutEffect(() => {
    panRef.current = pan;
    zoomRef.current = zoom;
    applyCanvasTransform();
    scheduleVisibleRecompute();
  }, [pan.x, pan.y, zoom, scheduleVisibleRecompute]);
  // ResizeObserver on the wrap element so viewport recomputes when the
  // window or sidebar resizes (also seeds wrapWHRef with the initial size
  // synchronously after mount via the first observation callback).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const r = e.contentRect;
        wrapWHRef.current = { w: r.width, h: r.height };
      }
      scheduleVisibleRecompute();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [scheduleVisibleRecompute]);
  const [smoothXform, setSmoothXform] = useState(false); // true → CSS transition on canvas transform
  const [dragOver, setDragOver] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [selectedStrokes, setSelectedStrokes] = useState(() => new Set());
  const [selectedArrows, setSelectedArrows] = useState(() => new Set());
  // Hidden BoardThumbnail used for PNG/PDF export. Same render path as
  // the canvas card preview, just scaled up at export time. Only mounted
  // while an export handler is running — otherwise rendering one SVG node
  // per card on every CanvasSurface render dominates idle/pan cost.
  const exportSvgRef = useRef(null);
  const [exportSvgMounted, setExportSvgMounted] = useState(false);
  const [drag, setDrag] = useState(null);
  // While dragging, computeSnap fills this with the matched alignment lines
  // so the canvas can render thin gold guides at those coords.
  // { xs: [{ x, y0, y1 }], ys: [{ y, x0, x1 }] } — both in canvas-space.
  const [snapHints, setSnapHints] = useState(null);
  // Mirror of snapHints that lingers ~160ms after clearing so the SVG
  // layer can fade out instead of vanishing. The is-visible class is
  // keyed off snapHints (live), but the rendered <line>s come from
  // displayedHints (last-known) so there's still something to fade.
  const [displayedHints, setDisplayedHints] = useState(null);
  const snapHintsTimerRef = useRef(null);
  useEffect(() => {
    if (snapHints) {
      if (snapHintsTimerRef.current) {
        clearTimeout(snapHintsTimerRef.current);
        snapHintsTimerRef.current = null;
      }
      setDisplayedHints(snapHints);
    } else {
      snapHintsTimerRef.current = setTimeout(() => {
        setDisplayedHints(null);
        snapHintsTimerRef.current = null;
      }, 160);
    }
    return () => {
      if (snapHintsTimerRef.current) {
        clearTimeout(snapHintsTimerRef.current);
        snapHintsTimerRef.current = null;
      }
    };
  }, [snapHints]);
  const [resize, setResize] = useState(null);
  // Multi-selection / group resize. When active, drives a live overlay
  // of new bounds on every affected card so the user sees the scale
  // before pointer-up commits a single Yjs batch.
  //   { handle, anchor:{x,y,axisX,axisY}, startBounds, startById:Map<id, {x,y,w,h}>,
  //     live:Map<id, {x,y,w,h}> | null }
  const [multiResize, setMultiResize] = useState(null);
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
  // The state drives rendering; the ref mirrors it so the long-lived
  // pointermove/pointerup closures can read the LATEST value (state in
  // a captured closure goes stale across React re-renders).
  const [boardDropTarget, setBoardDropTarget] = useState(null);
  const boardDropTargetRef = useRef(null);
  // Tracks the last endpoint-handle click so a second click within
  // ~350ms on the same endpoint spawns a sibling line/arrow (see
  // onHandleDown's dblclick branch).
  const lastEndpointClickRef = useRef({ time: 0, idx: -1, which: null });
  // 80ms hover-prefetch debounce for board/boardlink cards. Mouse-sweep
  // across many cards won't trigger fetches; pausing on a single card
  // for >80ms warms its snapshot.
  const hoverPrefetchTimer = useRef(null);
  const scheduleHoverPrefetch = useCallback((boardId) => {
    if (!boardId) return;
    if (hoverPrefetchTimer.current) clearTimeout(hoverPrefetchTimer.current);
    hoverPrefetchTimer.current = setTimeout(() => {
      hoverPrefetchTimer.current = null;
      prefetchBoard(boardId);
    }, 80);
  }, []);
  const cancelHoverPrefetch = useCallback(() => {
    if (hoverPrefetchTimer.current) {
      clearTimeout(hoverPrefetchTimer.current);
      hoverPrefetchTimer.current = null;
    }
  }, []);
  useEffect(() => () => cancelHoverPrefetch(), [cancelHoverPrefetch]);
  // Cursor position while hovering a board drop target — drives the
  // floating "Drop into <board>" label so the user has clear feedback
  // before they release.
  const [boardDropHoverPos, setBoardDropHoverPos] = useState(null);
  const updateBoardDropTarget = useCallback((next, pos = null) => {
    boardDropTargetRef.current = next;
    setBoardDropTarget(next);
    setBoardDropHoverPos(next ? pos : null);
  }, []);
  // Eyedropper mode — when set to a palette card id, the next click on
  // an image card on this board samples a pixel and adds it as a swatch
  // to that palette. Escape exits the mode.
  const [eyedropFor, setEyedropFor] = useState(null);
  // Sketch pad — full-screen overlay drawing modal. When closed with
  // strokes, they're committed to the current board's strokes Y.Array.
  const [sketchpadOpen, setSketchpadOpen] = useState(false);
  // When set, SketchPad opens in "edit existing canvas" mode and its
  // commit updates the card in place instead of creating a new one.
  const [sketchpadEditId, setSketchpadEditId] = useState(null);
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
    // Debounce leave-null. Pointerleave fires whenever the cursor crosses
    // a sibling overlay (popover / floating toolbar / context menu) that
    // sits above the canvas — those are transient and shouldn't make the
    // cursor pop in and out for peers. Only commit a null after the
    // pointer has stayed away for ~400ms.
    let leaveTimer = null;
    const cancelLeave = () => { if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; } };
    const onMove = (e) => {
      cancelLeave();
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
      cancelLeave();
      leaveTimer = setTimeout(() => {
        leaveTimer = null;
        last = { x: null, y: null };
        try { aw.setLocalStateField('canvasCursor', null); } catch (_) {}
      }, 400);
    };
    wrap.addEventListener('pointermove', onMove);
    wrap.addEventListener('pointerleave', onLeave);
    return () => {
      wrap.removeEventListener('pointermove', onMove);
      wrap.removeEventListener('pointerleave', onLeave);
      if (timer) clearTimeout(timer);
      cancelLeave();
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
  //
  // We don't render straight off the awareness change events — those arrive
  // at the sender's broadcast cadence + network jitter, so the card visibly
  // hops between discrete positions. Instead we keep a target ref and lerp
  // a separate display ref toward it inside a rAF loop. ALPHA 0.35 means
  // ~5–7 frames to reach a stationary target after the sender stops moving,
  // which reads as smooth without floaty lag.
  const [peerDrags, setPeerDrags] = useState({});
  useEffect(() => {
    const aw = getAwareness?.();
    if (!aw) return;
    const ALPHA = 0.35;
    const SNAP_PX = 0.5;
    const targetsRef = { current: {} };
    const displayRef = { current: {} };
    let rafId = 0;

    const tick = () => {
      rafId = 0;
      const display = displayRef.current;
      const targets = targetsRef.current;
      let moved = false;
      for (const id in display) {
        const t = targets[id];
        if (!t) continue;
        const dx = t.x - display[id].x;
        const dy = t.y - display[id].y;
        if (Math.abs(dx) < SNAP_PX && Math.abs(dy) < SNAP_PX) {
          if (display[id].x !== t.x || display[id].y !== t.y) {
            display[id] = { x: t.x, y: t.y };
            moved = true;
          }
        } else {
          display[id] = { x: display[id].x + dx * ALPHA, y: display[id].y + dy * ALPHA };
          moved = true;
        }
      }
      if (moved) {
        setPeerDrags({ ...display });
        rafId = requestAnimationFrame(tick);
      }
    };

    const refresh = () => {
      const next = {};
      aw.getStates().forEach((state) => {
        if (!state?.user || state.user.id === currentUser?.id) return;
        const drag = state.liveDrag;
        if (!drag || drag.boardId !== board.id) return;
        for (const dc of (drag.cards || [])) {
          if (dc?.id) next[dc.id] = { x: dc.x, y: dc.y };
        }
      });
      targetsRef.current = next;
      // Snap newly-arrived cards to their first target (no lerp from 0,0).
      for (const id in next) {
        if (!(id in displayRef.current)) {
          displayRef.current[id] = { x: next[id].x, y: next[id].y };
        }
      }
      // Drop cards no longer being dragged. The card snaps back to its
      // Y.Doc-committed position via the regular render path immediately.
      let cleared = false;
      for (const id in displayRef.current) {
        if (!(id in next)) {
          delete displayRef.current[id];
          cleared = true;
        }
      }
      if (cleared) setPeerDrags({ ...displayRef.current });
      if (!rafId) rafId = requestAnimationFrame(tick);
    };
    refresh();
    aw.on('change', refresh);
    return () => {
      aw.off('change', refresh);
      if (rafId) cancelAnimationFrame(rafId);
    };
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
  // Lightbox: previewing an image inline (clicked from a list-board's child
  // row, or the expand button on a canvas image card). Null when closed.
  // Esc handling + close-on-backdrop-click live inside ImageLightbox.
  const [lightbox, setLightbox] = useState(null);
  const [drawOptions, setDrawOptions] = useState({
    mode: 'pen',
    color: DRAW_DEFAULT_COLOR,
    width: DRAW_DEFAULT_WIDTH,
    eraserWidth: ERASER_DEFAULT_WIDTH,
  });
  // Seed shape tool from the resolved workspace defaults. Without this,
  // workspace shape stroke/fill/width settings have no visible effect.
  // The user can still override per-shape via the toolbar; switching
  // workspaces or saving new defaults resyncs to those values.
  const [shapeOptions, setShapeOptions] = useState(() => ({
    shape: 'rect',
    stroke: defaults?.shape?.stroke ?? '#f5f5f6',
    fill: defaults?.shape?.fill ?? 'transparent',
    strokeWidth: defaults?.shape?.strokeWidth ?? 2,
    dash: defaults?.shape?.dash ?? 'solid',
  }));
  useEffect(() => {
    const s = defaults?.shape;
    if (!s) return;
    setShapeOptions(prev => ({
      ...prev,
      stroke: s.stroke ?? prev.stroke,
      fill: s.fill ?? prev.fill,
      strokeWidth: s.strokeWidth ?? prev.strokeWidth,
      dash: s.dash ?? prev.dash,
    }));
  }, [workspaceId, defaults?.shape?.stroke, defaults?.shape?.fill, defaults?.shape?.strokeWidth, defaults?.shape?.dash]);
  const [arrowOptions, setArrowOptions] = useState({ straight: false, dashed: false });
  const [activeShape, setActiveShape] = useState(null); // { x, y, w, h } during shape drag
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [ctx, setCtx] = useState({ open: false, x: 0, y: 0, cardId: null });
  const [bgCtx, setBgCtx] = useState({ open: false, x: 0, y: 0, canvasPos: null });
  const [picker, setPicker] = useState(null); // { value, onChange, x, y, allowTransparent } | null
  const { palettes: workspacePalettes, ensureLoaded: ensureWorkspacePalettes } =
    useWorkspacePalettes(workspaceId);
  useEffect(() => { if (picker) ensureWorkspacePalettes(); }, [picker, ensureWorkspacePalettes]);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [spaceDown, setSpaceDown] = useState(false);
  const lastMouseCanvasRef = useRef({ x: 200, y: 200 });
  const feedback = useFeedback();

  // Tracks whether we've shown the "subscribe to edit" toast for the
  // currently-open read-only board. Reset on board change so navigating
  // between two read-only boards yields one toast per board (not one
  // forever after the first attempt).
  const dragBlockedToastShownRef = useRef(false);
  useEffect(() => { dragBlockedToastShownRef.current = false; }, [board?.id]);

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
    // New board → arm fit. Don't reset pan/zoom here; the
    // useLayoutEffect below sets the correct viewport synchronously
    // with the first card render so there's never a frame painted at
    // the previous board's viewport.
    fitOnceForRef.current = null;
  }, [board.id]);
  // useLayoutEffect (not useEffect): runs after DOM mutations but
  // BEFORE the browser paints. setState inside a layout effect
  // triggers a sync re-render in the same commit phase, so the cards
  // render and the fit-to-content pan/zoom both land in a single
  // visible frame. Using a regular useEffect produced a one-frame
  // flash where cards painted at the previous board's pan/zoom.
  useLayoutEffect(() => {
    if (!wrapRef.current) return;
    if (!cards) return;
    if (fitOnceForRef.current === board.id) return;
    const r = wrapRef.current.getBoundingClientRect();
    if (r.width < 50 || r.height < 50) return;
    if (!ydoc && cards.length === 0) return; // not ready yet
    // 1) Saved view wins — instant restore, then we're done.
    const saved = loadBoardView(board.id);
    if (saved) {
      fitOnceForRef.current = board.id;
      setZoom(saved.zoom);
      setPan(saved.pan);
      return;
    }
    // 2) No saved view: fit everything into the viewport. But if the
    //    board hasn't surfaced any cards yet (Yjs sync still en route)
    //    don't commit the fit — leave fitOnceForRef unset so we retry
    //    once cards populate. Empty board → default zoom, also no lock.
    if (cards.length === 0) {
      setZoom(1);
      setPan({ x: 40, y: 60 });
      return;
    }
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
    const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.min(
      (r.width - margin * 2) / contentW,
      (r.height - margin * 2) / contentH,
    )));
    setZoom(z);
    setPan({
      x: (r.width  - contentW * z) / 2 - minX * z,
      y: (r.height - contentH * z) / 2 - minY * z,
    });
  }, [cards, board.id, ydoc]);

  // Persist zoom+pan changes per board so reopening the board resumes
  // where the user left off. Debounced so rapid wheel/pan gestures
  // produce one write at rest, not one per frame.
  useEffect(() => {
    if (!board?.id) return;
    // Don't save until the load effect has run for THIS board (avoids
    // overwriting saved state with the mount-time defaults).
    if (fitOnceForRef.current !== board.id) return;
    const tid = setTimeout(() => saveBoardView(board.id, { zoom, pan }), 400);
    return () => clearTimeout(tid);
  }, [zoom, pan.x, pan.y, board.id]);

  // Fit the entire board content into the viewport. Wired to a
  // double-tap on the zoom % control (replaces what used to happen
  // automatically on every open).
  const fitToContent = useCallback(() => {
    if (!wrapRef.current || !cards || cards.length === 0) return;
    const r = wrapRef.current.getBoundingClientRect();
    if (r.width < 50 || r.height < 50) return;
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
    const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.min(
      (r.width - margin * 2) / contentW,
      (r.height - margin * 2) / contentH,
    )));
    setZoom(z);
    setPan({
      x: (r.width  - contentW * z) / 2 - minX * z,
      y: (r.height - contentH * z) / 2 - minY * z,
    });
  }, [cards]);

  useEffect(() => { setArrowFrom(null); setActiveStroke(null); setActiveFreeArrow(null); }, [selectedTool, board.id]);
  useEffect(() => {
    setSelected(new Set());
    setSelectedStrokes(new Set());
    setSelectedArrows(new Set());
    setCtx(c => ({ ...c, open: false }));
    setBgCtx(c => ({ ...c, open: false }));
    // Round 17: reset per-board zoom-counter so the next zoom on a
    // freshly-opened board is correctly classified as `firstZoom`.
    _zoomCountRef.current = 0;
  }, [board.id]);

  const sortedCards = useMemo(() => {
    // Round 17: time the sort. Useful for first-open diagnosis when
    // there are many cards; subsequent re-sorts after edits are also
    // captured (so we can see if a single sort exceeds 20ms).
    const _t0 = perf.isEnabled() ? performance.now() : 0;
    const arr = (cards || []).slice();
    arr.sort((a, b) => ((a.z || 0) - (b.z || 0)) || (a.id < b.id ? -1 : 1));
    if (_t0) perf.mark('canvasSurface.sortedCards.ms', performance.now() - _t0);
    return arr;
  }, [cards]);
  // Keep the ref the viewport-culling RAF reads in sync with the latest
  // sorted array, and re-fire a recompute whenever the set of cards changes
  // (add/remove/edit may shift card positions).
  sortedCardsRef.current = sortedCards;
  perf.gauge('cards.total', sortedCards.length);
  perf.gauge('cards.visible', visibleIds ? visibleIds.size : sortedCards.length);
  useEffect(() => { scheduleVisibleRecompute(); }, [sortedCards, scheduleVisibleRecompute]);

  // cardById has STABLE object identity across snapshots — we mutate the
  // singleton in place when cards change. Lets downstream useMemo /
  // useCallback that capture cardById skip re-allocation when only card
  // *content* changed (id set unchanged). arrowAttachments still has
  // `cards` in its deps below, so arrow geometry recomputes on card moves.
  const cardByIdRef = useRef({});
  const cardById = cardByIdRef.current;
  // Sync the singleton each render so consumers always read the latest.
  // This runs in render (not an effect) because downstream useMemos read
  // cardById synchronously and need the up-to-date map.
  {
    const m = cardById;
    const seen = new Set();
    for (const c of (cards || [])) { m[c.id] = c; seen.add(c.id); }
    for (const k of Object.keys(m)) { if (!seen.has(k)) delete m[k]; }
  }

  // Refs that always mirror the latest cards / selection — used by
  // pointer-event closures (which capture state at pointer-down) so
  // that drawing decisions made at pointer-up read the live values.
  // Without this, a stroke that starts a few ms after a SketchPad
  // commit would route against a stale cards snapshot that doesn't
  // yet contain the brand-new art canvas.
  const cardsRef = useRef(cards);
  const selectedRef = useRef(selected);
  useEffect(() => { cardsRef.current = cards; }, [cards]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  // Tracks IDs that the user has explicitly dragged out of this canvas. The
  // deleteCards guard in App.jsx consults this (via a CustomEvent) so the
  // cross-pane `soleil-card-transferred` flow can only ever delete IDs that
  // were *actually* picked up — a defense against a runaway delete that
  // could nuke an entire board if `cardIds` is malformed.
  const recentDragRef = useRef(new Set());
  const recentDragTimerRef = useRef(null);
  const markRecentDrag = (ids) => {
    if (!Array.isArray(ids)) return;
    recentDragRef.current = new Set(ids);
    if (recentDragTimerRef.current) clearTimeout(recentDragTimerRef.current);
    recentDragTimerRef.current = setTimeout(() => {
      recentDragRef.current = new Set();
    }, 5000);
    // Make the allowlist available to listeners that didn't capture this
    // closure (e.g. App.jsx's deleteCards guard).
    try {
      document.dispatchEvent(new CustomEvent('soleil-card-drag-start', {
        detail: { boardId: board?.id, ids: [...ids] },
      }));
    } catch (_) {}
  };

  // Universal undo via time-travel restore. When the in-tab UndoManager is
  // exhausted (or wiped by a page reload), Cmd+Z walks back through the
  // board_versions snapshots one at a time. Cmd+Shift+Z walks forward.
  // ttPointerRef: snapshot_at of the version we're currently parked at,
  // or null = "live state" (the head). ttForwardRef: in-memory stack of
  // (snapshot_at) values we've stepped over, so Cmd+Shift+Z can replay.
  const ttPointerRef = useRef(null);
  const ttForwardRef = useRef([]);
  const ttBusyRef = useRef(false);
  const ttSnapshotTakenRef = useRef(false);

  // Restore the boards referenced as kind=board cards in a Y.Doc
  // produced from snapshot bytes — so an undone delete brings every
  // linked sub-board back from the soft-delete state. Called BEFORE
  // bulletproofRestore tears down the live Y.Doc.
  const restoreReferencedBoardsFromBytes = useCallback(async (b64) => {
    try {
      const tmp = decodeSnapshotBytes(b64);
      const cardsMap = tmp.getMap('cards');
      const ids = [];
      cardsMap.forEach((ym, id) => {
        if (ym?.get?.('kind') === 'board') ids.push(id);
      });
      tmp.destroy();
      for (const bid of ids) {
        try { await restoreBoard(bid); } catch (_) {}
      }
    } catch (_) {}
  }, []);

  const timeTravelUndo = useCallback(async () => {
    if (!ydoc || !board?.id) return;
    if (ttBusyRef.current) return;
    ttBusyRef.current = true;
    try {
      // First fall-through from live: pre-restore checkpoint so user can
      // come back to where they were no matter how far they walk.
      if (!ttSnapshotTakenRef.current && ttPointerRef.current === null) {
        await saveBoardVersion(board.id, ydoc, {
          triggerKind: 'pre-restore',
          sessionId,
          userId,
          label: 'pre-undo',
          opSummary: { action: 'time-travel-undo-from-live' },
        });
        ttSnapshotTakenRef.current = true;
      }
      const change = await fetchPrevChange(board.id, ttPointerRef.current);
      if (!change) {
        try { feedback.toast({ type: 'info', message: 'Nothing further to undo' }); } catch (_) {}
        return;
      }
      ttForwardRef.current.push(ttPointerRef.current);
      ttPointerRef.current = change.at;
      if (change.type === 'version') {
        const b64 = await loadBoardVersionDoc(change.row.id);
        if (!b64) {
          console.warn('[timeTravelUndo] version doc missing', change.row.id);
          return;
        }
        await restoreReferencedBoardsFromBytes(b64);
        // Bulletproof: writes board_state, kicks the PartyKit room, and
        // fires soleil-board-reset → useYBoard tears this CanvasSurface
        // down and re-cold-loads with the restored state.
        await bulletproofRestore(board.id, b64);
      } else {
        // Meta change: apply its before_value back to boards. No Y.Doc
        // mutation, no room reset needed.
        await applyMetaChangeUndo(change.row, { userId, sessionId });
      }
      try { feedback.toast({ type: 'success', message: `Rolled back to ${new Date(change.at).toLocaleString(undefined,{timeStyle:'short',dateStyle:'short'})}` }); } catch (_) {}
    } catch (e) {
      console.error('[timeTravelUndo]', e);
      try { feedback.toast({ type: 'error', message: 'Undo failed: ' + (e.message || e) }); } catch (_) {}
    } finally {
      ttBusyRef.current = false;
    }
  }, [ydoc, board?.id, sessionId, userId, feedback, restoreReferencedBoardsFromBytes]);

  const timeTravelRedo = useCallback(async () => {
    if (!ydoc || !board?.id) return;
    if (ttBusyRef.current) return;
    ttBusyRef.current = true;
    try {
      const change = await fetchNextChange(board.id, ttPointerRef.current);
      if (!change) {
        try { feedback.toast({ type: 'info', message: 'Nothing further to redo' }); } catch (_) {}
        return;
      }
      ttPointerRef.current = change.at;
      if (change.type === 'version') {
        const b64 = await loadBoardVersionDoc(change.row.id);
        if (b64) {
          await restoreReferencedBoardsFromBytes(b64);
          await bulletproofRestore(board.id, b64);
        }
      } else {
        await applyMetaChangeUndo(change.row, { userId, sessionId });
      }
      try { feedback.toast({ type: 'success', message: `Forward to ${new Date(change.at).toLocaleString(undefined,{timeStyle:'short',dateStyle:'short'})}` }); } catch (_) {}
    } catch (e) {
      console.error('[timeTravelRedo]', e);
      try { feedback.toast({ type: 'error', message: 'Redo failed: ' + (e.message || e) }); } catch (_) {}
    } finally {
      ttBusyRef.current = false;
    }
  }, [ydoc, board?.id, sessionId, userId, feedback, restoreReferencedBoardsFromBytes]);
  // Any local edit clears the forward stack (classic redo semantics) and
  // resets the "park" pointer to live. Watching the `cards` length is a
  // simple proxy — granular update events would also work but this avoids
  // wiring into the ydoc update listener directly.
  useEffect(() => {
    if (!ttBusyRef.current && ttPointerRef.current !== null) {
      // New edit happened while we were parked — assume the user is now
      // moving forward from the restored state. Clear forward stack and
      // reset pointer so the next Cmd+Z snapshots fresh.
      ttForwardRef.current = [];
      ttPointerRef.current = null;
      ttSnapshotTakenRef.current = false;
    }
  }, [cards.length]);

  // Holds the most-recently-created card whose Yjs write hasn't yet
  // surfaced through the useYBoard subscription back to `cards` here.
  // pickStrokeTarget falls back to this so a stroke drawn immediately
  // after a SketchPad commit still finds its target instead of leaking
  // to the board's free-strokes layer.
  const pendingCardRef = useRef(null);
  useEffect(() => {
    const p = pendingCardRef.current;
    if (p && (cards || []).some(c => c.id === p.id)) {
      pendingCardRef.current = null;
    }
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
    const boardId = board?.id;
    const local = (cards || [])
      .filter(c => c.kind === 'palette' && Array.isArray(c.swatches) && c.swatches.length > 0)
      .map((c, i) => ({
        id: `${boardId}:${c.id}`,
        name: c.title || `Palette ${i + 1}`,
        swatches: c.swatches.filter(s => s && s.hex),
      }));
    const localIds = new Set(local.map(p => p.id));
    const remote = (workspacePalettes || []).filter(p => !localIds.has(p.id));
    return [...local, ...remote];
  }, [cards, board?.id, workspacePalettes]);
  const paletteColors = useMemo(() => {
    const out = [];
    palettes.forEach(p => p.swatches.forEach(s => { if (s.hex) out.push(s.hex); }));
    return [...new Set(out)];
  }, [palettes]);

  // Effective multi-selection — current `selected` set expanded with
  // every groupmate of any card in a group of 2+ members. Drives the
  // SelectionBoundsOverlay (visible when size >= 2) and gates the
  // single-card resize handle so it doesn't compete with the multi-
  // resize handles for the same cards.
  const effectiveSelectedIds = useMemo(() => {
    if (!selected || selected.size === 0) return new Set();
    return expandWithGroupmates(selected);
    // expandWithGroupmates depends on cardsByGroup/cardById; both
    // already feed memo invalidation via `cards`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, cards, cardsByGroup]);

  // Union bounds of the effective multi-selection. Null when < 2 cards
  // are selected so the overlay stays hidden for single-card edits.
  const multiSelectionBounds = useMemo(() => {
    if (effectiveSelectedIds.size < 2) return null;
    const items = (cards || []).filter(c => effectiveSelectedIds.has(c.id));
    return boundsOfCards(items);
  }, [effectiveSelectedIds, cards]);

  // Group bounding box (computed from member cards) — used by arrow
  // anchoring so arrows can attach to groups, not just cards.
  const groupBoundsById = useMemo(() => {
    const out = {};
    cardsByGroup.forEach((members, gid) => {
      if (!members?.length) return;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const c of members) {
        if (c.x < minX) minX = c.x;
        if (c.y < minY) minY = c.y;
        if (c.x + c.w > maxX) maxX = c.x + c.w;
        if (c.y + c.h > maxY) maxY = c.y + c.h;
      }
      out[gid] = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    });
    return out;
  }, [cardsByGroup]);

  // Context object passed to arrowGeometry helpers. Memoized so the
  // attachments map below recomputes only when inputs change.
  const arrowCtx = useMemo(() => ({
    cardById,
    resolveGroupBBox: (gid) => groupBoundsById[gid] || null,
  }), [cardById, groupBoundsById]);

  // Per-arrow attachment points (handles fan-out when multiple arrows
  // share an anchor side). Keyed by array index; falsy entries mean the
  // arrow has missing endpoints and shouldn't render. Depends on `cards`
  // (in addition to arrows + arrowCtx) so endpoint moves re-fire the
  // computation — cardById has stable identity now and won't trigger by
  // itself.
  const arrowAttachments = useMemo(
    () => {
      const _t0 = perf.isEnabled() ? performance.now() : 0;
      const out = computeArrowAttachments(arrows || [], arrowCtx);
      perf.bump('arrows.runs');
      if (_t0) perf.mark('arrows.ms', performance.now() - _t0);
      return out;
    },
    [arrows, arrowCtx, cards]
  );

  // Rect list used as obstacles when shaping each arrow's bezier. Includes
  // every card; per-arrow we then drop its own endpoints (and any group
  // members for a group-anchored end) before handing the list to the
  // geometry helper.
  const arrowObstacleRects = useMemo(() => {
    return (cards || []).map(c => ({ id: c.id, x: c.x, y: c.y, w: c.w, h: c.h }));
  }, [cards]);

  // Stable SVG id prefix for arrow paths (textPath references). Scoped by
  // board so the editor's main + split panes don't collide on duplicate ids.
  const arrowPathIdPrefix = useMemo(
    () => `arr-${String(board?.id || 'b').replace(/[^a-zA-Z0-9_-]/g, '')}-`,
    [board?.id]
  );

  // Given an arrow ref (string card id | {type,id} | {x,y} | null), return
  // the set of card ids that should be excluded from obstacle avoidance —
  // the anchor itself for cards, the full member list for groups.
  const excludedCardIdsForRef = useCallback((ref) => {
    if (!ref) return null;
    if (typeof ref === 'string') return [ref];
    if (ref.type === 'card' && ref.id) return [ref.id];
    if (ref.type === 'group' && ref.id) {
      const members = cardsByGroup.get(ref.id) || [];
      return members.map(c => c.id);
    }
    return null;
  }, [cardsByGroup]);

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
    // Preserve natural dimensions AND aspect ratio. Scale down if the
    // source exceeds MAX along either axis; scale UP (proportionally) if
    // either axis is below MIN so very thin/wide images stay clickable
    // without distorting their aspect.
    const MAX_PASTE_DIM = 1200;
    const MIN_PASTE_DIM = 80;
    let w = 320, h = 240; // fallback for when readImageDims fails
    if (dims.width && dims.height) {
      w = dims.width;
      h = dims.height;
      if (w > MAX_PASTE_DIM || h > MAX_PASTE_DIM) {
        const k = MAX_PASTE_DIM / Math.max(w, h);
        w = Math.round(w * k);
        h = Math.round(h * k);
      }
      if (w < MIN_PASTE_DIM || h < MIN_PASTE_DIM) {
        const k = MIN_PASTE_DIM / Math.min(w, h);
        w = Math.round(w * k);
        h = Math.round(h * k);
      }
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
      const up = await uploadImage({ file, workspaceId, boardId: board?.id, cardId: id, userId, onProgress });
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

  // Audio file → audio card centered on (cx, cy). Default size matches
  // a compact waveform; the card carries the duration for instant later
  // renders. 50 MB cap enforced inside uploadAudio.
  const dropAudioFile = useCallback(async (file, cx, cy) => {
    if (!workspaceId) throw new Error('workspaceId required');
    const up = await uploadAudio({ file, workspaceId, boardId: board?.id, userId });
    const w = 380, h = 130;
    mutators.addCard?.({
      id: `aud-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      kind: 'audio',
      src: up.src,
      title: file.name || 'Audio',
      duration: up.duration || null,
      x: Math.round(cx - w / 2),
      y: Math.round(cy - h / 2),
      w, h,
    });
  }, [workspaceId, board?.id, userId, mutators]);

  // Right-click "Set cover image" → upload an image file and stamp it
  // onto the audio card's `cover` field. Also widens the card so the
  // split layout reads properly.
  const pickAudioCover = useCallback(async (cardId, file) => {
    try {
      const up = await uploadImage({ file, workspaceId, boardId: board?.id, cardId, userId });
      const target = (cards || []).find(c => c.id === cardId);
      const patch = { cover: up.src };
      if (target && target.w < 460) patch.w = 460;
      if (target && target.h < 150) patch.h = 150;
      mutators.updateCard?.(cardId, patch);
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Cover upload failed: ' + (err.message || err) });
    }
  }, [workspaceId, board?.id, userId, mutators, cards, feedback]);

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
      if (isEditorTarget(e)) return;
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
  //
  // Pan/zoom updates write directly to panRef/zoomRef + canvasRef.style.transform
  // — NOT through setState — so a 120Hz wheel burst doesn't trigger 120
  // CanvasSurface re-renders (each of which would reconcile every card).
  // State is committed in a debounced trailing tick so downstream consumers
  // (persistence, the smooth-transform class, viewport-derived memos) catch
  // up after the gesture ends. Empty deps array: closure reads via refs, so
  // we don't need to re-bind on every pan tick — re-binding caused the
  // effect's cleanup to fire repeatedly during a pan and nulled out our
  // peer cursor (see the panRef comment above).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let commitTimer = 0;
    const scheduleCommit = () => {
      if (commitTimer) clearTimeout(commitTimer);
      commitTimer = setTimeout(() => {
        commitTimer = 0;
        setPan({ x: panRef.current.x, y: panRef.current.y });
        setZoom(zoomRef.current);
      }, 140);
    };
    const onWheel = (e) => {
      if (e.target.closest && e.target.closest('.inbox, .ctx-menu, .modal-bg, .modal, .twk-panel, .tob')) return;
      e.preventDefault();
      perf.bump('wheel.events');
      // Round 17: time the JS-side cost of zoom handling. A 'first-zoom
      // hitch' may be JS (this number high) or browser compositor (this
      // number low, but DevTools trace still shows a long task).
      const _isZoom = e.ctrlKey || e.metaKey;
      const _tZ = (_isZoom && perf.isEnabled()) ? performance.now() : 0;
      const rect = el.getBoundingClientRect();
      const curPan = panRef.current;
      const curZoom = zoomRef.current;
      if (e.ctrlKey || e.metaKey) {
        // Trackpads send pixel-mode deltas; mouse wheels send line-mode.
        // Use a 2.8× faster pixel sensitivity but compensate when delta
        // looks chunky (line scroll) to avoid runaway zoom on mice.
        const isLine = e.deltaMode === 1; // WheelEvent.DOM_DELTA_LINE
        const sensitivity = isLine ? 0.05 : 0.0025;
        const factor = Math.exp(-e.deltaY * sensitivity);
        const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, curZoom * factor));
        if (newZoom === curZoom) return;
        const cx = (e.clientX - rect.left - curPan.x) / curZoom;
        const cy = (e.clientY - rect.top  - curPan.y) / curZoom;
        panRef.current = {
          x: e.clientX - rect.left - cx * newZoom,
          y: e.clientY - rect.top  - cy * newZoom,
        };
        zoomRef.current = newZoom;
      } else {
        panRef.current = { x: curPan.x - e.deltaX, y: curPan.y - e.deltaY };
      }
      applyCanvasTransform();
      scheduleVisibleRecompute();
      scheduleCommit();
      if (_tZ) {
        const ms = performance.now() - _tZ;
        const isFirst = _zoomCountRef.current === 0;
        perf.mark(isFirst ? 'firstZoom.ms' : 'zoom.ms', ms);
        _zoomCountRef.current++;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (commitTimer) clearTimeout(commitTimer);
    };
  }, []);

  // ── Touch gestures (P3.2): pinch-zoom + two-finger pan ─────────────────────
  // Desktop mouse path is untouched — these handlers only fire when the
  // pointerType is 'touch'. Single-finger drag stays driven by the existing
  // onBackgroundPointerDown (so cards / lasso / pan-mode keep working).
  // Both gestures route through panRef/zoomRef + direct DOM transform like
  // the wheel handler above — see that comment for rationale.
  const touchPanCommitTimer = useRef(0);
  const scheduleTouchPanCommit = () => {
    if (touchPanCommitTimer.current) clearTimeout(touchPanCommitTimer.current);
    touchPanCommitTimer.current = setTimeout(() => {
      touchPanCommitTimer.current = 0;
      setPan({ x: panRef.current.x, y: panRef.current.y });
      setZoom(zoomRef.current);
    }, 140);
  };
  useEffect(() => () => {
    if (touchPanCommitTimer.current) clearTimeout(touchPanCommitTimer.current);
  }, []);
  useGesture(
    {
      onPinch: ({ event, origin: [ox, oy], movement: [ms], memo }) => {
        if (event?.cancelable) event.preventDefault();
        const el = wrapRef.current;
        if (!el) return memo;
        // Round 17: time the JS-side cost of pinch-zoom handling.
        const _tZ = perf.isEnabled() ? performance.now() : 0;
        const rect = el.getBoundingClientRect();
        const start = memo || { zoom: zoomRef.current, panX: panRef.current.x, panY: panRef.current.y };
        const targetZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, start.zoom * ms));
        if (targetZoom === start.zoom) return start;
        // World-coord under the gesture origin should stay fixed.
        const cx = (ox - rect.left - start.panX) / start.zoom;
        const cy = (oy - rect.top  - start.panY) / start.zoom;
        zoomRef.current = targetZoom;
        panRef.current = {
          x: ox - rect.left - cx * targetZoom,
          y: oy - rect.top  - cy * targetZoom,
        };
        applyCanvasTransform();
        scheduleVisibleRecompute();
        scheduleTouchPanCommit();
        if (_tZ) {
          const dur = performance.now() - _tZ;
          const isFirst = _zoomCountRef.current === 0;
          perf.mark(isFirst ? 'firstZoom.ms' : 'zoom.ms', dur);
          _zoomCountRef.current++;
        }
        return start;
      },
      onDrag: ({ event, delta: [dx, dy], touches, pinching, pointerType }) => {
        // Two-finger drag pans the canvas regardless of selected tool.
        // Single-finger / mouse drags stay on the existing onPointerDown
        // path so card move, lasso, pan-mode, etc. keep their behavior.
        if (pinching) return;
        if (pointerType !== 'touch') return;
        if (touches < 2) return;
        if (event?.cancelable) event.preventDefault();
        const p = panRef.current;
        panRef.current = { x: p.x + dx, y: p.y + dy };
        applyCanvasTransform();
        scheduleVisibleRecompute();
        scheduleTouchPanCommit();
      },
    },
    {
      target: wrapRef,
      eventOptions: { passive: false },
      pinch: { scaleBounds: { min: ZOOM_MIN / 4, max: ZOOM_MAX * 4 }, rubberband: true },
      drag: { pointer: { touch: true }, threshold: 0 },
    },
  );

  // Touch long-press → context menu (background or per-card). Right-click
  // already handles desktop via onContextMenu on the wrap and on each
  // card; this hook adds the touch equivalent without touching the mouse
  // path. We dispatch by inspecting the held element: if a .card was held,
  // open the card menu; otherwise the background menu.
  useLongPress(
    wrapRef,
    (x, y, e) => {
      const cardEl = e.target.closest?.('.card');
      if (cardEl) {
        const id = cardEl.getAttribute('data-card-id');
        const c = id ? cardById[id] : null;
        if (!c) return;
        if (!selected.has(c.id)) setSelected(new Set([c.id]));
        setBgCtx(b => ({ ...b, open: false }));
        setCtx({ open: true, x, y, cardId: c.id });
        return;
      }
      if (e.target.closest?.('.cnv-tool, .cnv-zoom, .inbox')) return;
      const pos = clientToCanvas(x, y);
      setBgCtx({ open: true, x, y, canvasPos: pos });
    },
    { ms: 480, tolerance: 10, pointerType: 'touch' },
  );

  // ── Confirm + delete cards ────────────────────────────────────────────────
  const buildDeleteMessage = useCallback((ids) => {
    const sel = ids.map(id => cardById[id]).filter(Boolean);
    const boardCards = sel.filter(c => c.kind === 'board');
    const total = sel.length;
    const bn = boardCards.length;
    if (bn > 0 && total === bn) {
      if (bn === 1) {
        const name = boards[boardCards[0].id]?.name || 'this board';
        return `Delete board "${name}" and all its content?\n\nYou can undo this with Cmd+Z. The board is fully recoverable for 30 days.`;
      }
      return `Delete ${bn} boards and all their content?\n\nYou can undo this with Cmd+Z. The boards are fully recoverable for 30 days.`;
    }
    if (bn > 0) {
      return `Delete ${total} items, including ${bn} board${bn > 1 ? 's' : ''}?\n\nYou can undo this with Cmd+Z. Anything deleted is recoverable for 30 days.`;
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
    // Pre-bulk-delete safety snapshot — N >= 5 is the threshold for "risky."
    if (ids.length >= 5 && ydoc && board?.id) {
      saveBoardVersion(board.id, ydoc, {
        triggerKind: 'pre-bulk-delete',
        sessionId,
        userId,
        label: 'pre-bulk-delete',
        opSummary: { action: 'bulk-delete', card_count: ids.length },
      });
    }
    mutators.deleteCards?.(ids);
    setSelected(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.delete(id));
      return next;
    });
  }, [buildDeleteMessage, feedback, mutators, ydoc, board?.id, sessionId, userId]);

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

  const doPaste = useCallback(async (atCanvas) => {
    const items = getClipboard();
    if (!items.length) return;
    // Pre-paste safety snapshot. Anything pasting > 1 card is treated as
    // "risky" since paste can stamp many cards at once.
    if (ydoc && board?.id && items.length > 0) {
      saveBoardVersion(board.id, ydoc, {
        triggerKind: 'pre-paste',
        sessionId,
        userId,
        label: 'pre-paste',
        opSummary: { action: 'paste', card_count: items.length },
      });
    }
    const minX = Math.min(...items.map(c => c.x));
    const minY = Math.min(...items.map(c => c.y));
    const target = atCanvas || lastMouseCanvasRef.current;
    const dx = target.x - minX;
    const dy = target.y - minY;
    const stamp = Date.now().toString(36);
    const idMap = {};       // oldCardId → newCardId
    const groupMap = {};    // oldGroupId → newGroupId
    const newCards = items.map(c => {
      const copy = { ...c };
      if (copy.kind === 'board') return null;
      const newId = `${copy.kind || 'card'}-${stamp}-${Math.floor(Math.random() * 1e6)}`;
      idMap[copy.id] = newId;
      copy.id = newId;
      copy.x = Math.round((copy.x || 0) + dx);
      copy.y = Math.round((copy.y || 0) + dy);
      // Group remapping happens after the loop so we know which
      // groups were referenced. Stub for now; resolved below.
      return copy;
    }).filter(Boolean);
    if (!newCards.length) return;

    // ── Recreate groups so a copy-paste of a grouped selection
    //    "stays together" as its own group, not the original. Reads
    //    the source ydoc's groups map for metadata; the source is
    //    THIS canvas (clipboard items came from board.id).
    try {
      const sourceGroupIds = new Set();
      for (const c of items) if (c.groupId) sourceGroupIds.add(c.groupId);
      if (sourceGroupIds.size && ydoc) {
        const sgm = ydoc.getMap('groups');
        const tgm = ydoc.getMap('groups');
        ydoc.transact(() => {
          for (const gid of sourceGroupIds) {
            const g = sgm.get(gid);
            if (!g) continue;
            const newGid = `g-${stamp}-${Math.floor(Math.random() * 1e6).toString(36)}`;
            groupMap[gid] = newGid;
            const ny = new Y.Map();
            ny.set('id', newGid);
            ny.set('name', g?.get?.('name') ?? g?.name ?? 'Group');
            ny.set('outline', g?.get?.('outline') ?? g?.outline ?? false);
            ny.set('color', g?.get?.('color') ?? g?.color ?? null);
            ny.set('width', g?.get?.('width') ?? g?.width ?? 1);
            const opts = g?.get?.('options') ?? g?.options ?? null;
            if (opts) ny.set('options', opts);
            ny.set('createdAt', Date.now());
            ny.set('createdBy', currentUser?.id || null);
            tgm.set(newGid, ny);
          }
        }, 'local');
      }
    } catch (_) { /* groups copy is best-effort */ }
    // Apply group remap to new card rows.
    for (const c of newCards) {
      if (c.groupId && groupMap[c.groupId]) c.groupId = groupMap[c.groupId];
      else if (c.groupId && !groupMap[c.groupId]) c.groupId = null;
    }

    mutators.addCards?.(newCards);
    setSelected(new Set(newCards.map(c => c.id)));

    // ── Duplicate comments anchored to the source cards / groups so
    //    annotations come along with the paste. Card-anchored
    //    comments retarget to the new card ids; group-anchored ones
    //    retarget to the new group id.
    try {
      const oldCardIds = items.map(c => c.id);
      const oldGroupIds = Object.keys(groupMap);
      const anchorIds = [...oldCardIds, ...oldGroupIds];
      if (anchorIds.length && workspaceId && currentUser?.id) {
        const { data: srcComments } = await supabase
          .from('comments')
          .select('*')
          .eq('board_id', board.id)
          .is('deleted_at', null)
          .in('anchor_kind', ['card', 'group'])
          .in('anchor_id', anchorIds);
        if (srcComments?.length) {
          // Build new rows. Replies need a new reply_to that points
          // at the cloned parent — collect the parent map.
          const cmtIdMap = {};
          // First pass: insert top-level (non-reply) comments and
          // capture id mapping.
          const tops = srcComments.filter(c => !c.reply_to);
          const replies = srcComments.filter(c => c.reply_to);
          for (const c of tops) {
            const newAnchorId = idMap[c.anchor_id] || groupMap[c.anchor_id];
            if (!newAnchorId) continue;
            const { data: ins } = await supabase.from('comments').insert({
              workspace_id: c.workspace_id,
              board_id: board.id,
              author: currentUser.id,
              body: c.body,
              anchor_kind: c.anchor_kind,
              anchor_id: newAnchorId,
              anchor_x: c.anchor_x,
              anchor_y: c.anchor_y,
              offset_x: c.offset_x || 0,
              offset_y: c.offset_y || 0,
            }).select('id').single();
            if (ins?.id) cmtIdMap[c.id] = ins.id;
          }
          // Second pass: replies — only insert if their parent was
          // also cloned.
          for (const r of replies) {
            const newParentId = cmtIdMap[r.reply_to];
            if (!newParentId) continue;
            const newAnchorId = idMap[r.anchor_id] || groupMap[r.anchor_id];
            if (!newAnchorId) continue;
            await supabase.from('comments').insert({
              workspace_id: r.workspace_id,
              board_id: board.id,
              author: currentUser.id,
              body: r.body,
              reply_to: newParentId,
              anchor_kind: r.anchor_kind,
              anchor_id: newAnchorId,
              anchor_x: r.anchor_x,
              anchor_y: r.anchor_y,
              offset_x: r.offset_x || 0,
              offset_y: r.offset_y || 0,
            });
          }
        }
      }
    } catch (cmtErr) {
      console.warn('paste comments failed', cmtErr);
    }
  }, [mutators, ydoc, board.id, workspaceId, currentUser?.id]);

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
  // Priority order:
  //   1. Image in OS clipboard       → image card (unambiguous "paste this")
  //   2. OS text matches our sentinel → internal-card paste (`doPaste`)
  //   3. OS text is stale sentinel    → swallow (don't make junk note)
  //   4. OS text is a bare URL        → link/embed card
  //   5. OS text is anything else     → note card with the text
  //   6. OS clipboard empty + we have internal items (sentinel write failed)
  //                                    → fallback to `doPaste`
  useEffect(() => {
    const createLinkCardFromUrl = (url, pos) => {
      const embed = detectEmbed(url);
      const w = embed ? embed.defaultW : 280;
      const h = embed ? embed.defaultH : 110;
      // Non-embed links default to hostname so the preview card has
      // something to show; embeds stay title-less so the iframe renders
      // alone — user adds a title later if they want one.
      let title = '';
      if (!embed) {
        title = url;
        try { title = new URL(url).hostname.replace(/^www\./, ''); } catch (_) {}
      }
      const newId = `link-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      const card = {
        id: newId, kind: 'link',
        source: url, link: url, title,
        x: Math.max(8, Math.round(pos.x - w / 2)),
        y: Math.max(8, Math.round(pos.y - h / 2)),
        w, h,
      };
      if (embed) card.embed = embed;
      mutators.addCard?.(card);
      if (!embed) {
        fetchLinkPreview(url).then(p => {
          if (!p) return;
          const patch = {};
          if (p.title) patch.title = p.title;
          if (p.image) patch.image = p.image;
          if (p.description) patch.description = p.description;
          if (p.favicon) patch.favicon = p.favicon;
          if (p.image) { patch.w = 280; patch.h = 290; }
          if (Object.keys(patch).length) mutators.updateCard?.(newId, patch);
        });
      }
    };

    const createNoteCardFromText = (text, pos) => {
      const escape = (s) => s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
      const html = text
        .split(/\r?\n/)
        .map(line => `<div>${escape(line) || '<br>'}</div>`)
        .join('');
      const w = 240, h = 160;
      const newId = `note-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      mutators.addCard?.({
        id: newId, kind: 'note', html,
        x: Math.max(8, Math.round(pos.x - w / 2)),
        y: Math.max(8, Math.round(pos.y - h / 2)),
        w, h,
      });
    };

    const onPaste = async (e) => {
      if (isEditorTarget(e)) return;

      // 1) Image in OS clipboard wins outright.
      const items = e.clipboardData?.items;
      if (items) {
        for (const item of items) {
          if (item.type.startsWith('image/')) {
            e.preventDefault();
            const file = item.getAsFile();
            if (file) {
              const pos = lastMouseCanvasRef.current;
              optimisticDropImage(file, pos.x, pos.y);
            }
            return;
          }
        }
      }

      const text = e.clipboardData?.getData('text/plain') || '';

      // 2) Our sentinel → internal paste.
      if (matchesSentinel(text) && getClipboard().length > 0) {
        e.preventDefault();
        doPaste();
        return;
      }
      // 3) Stale/foreign sentinel → swallow so we don't make a junk note.
      if (looksLikeSentinel(text)) {
        e.preventDefault();
        return;
      }

      const pos = lastMouseCanvasRef.current;
      const urlMatch = text.match(/^\s*(https?:\/\/\S+)\s*$/i);

      // 4) Bare URL → link / embed card.
      if (urlMatch) {
        e.preventDefault();
        createLinkCardFromUrl(urlMatch[1], pos);
        return;
      }

      // 5) Any other non-empty text → note card.
      if (text.trim().length > 0) {
        e.preventDefault();
        createNoteCardFromText(text, pos);
        return;
      }

      // 6) OS clipboard had nothing usable — fall back to internal if present
      //    (covers the rare case where `navigator.clipboard.writeText` of the
      //    sentinel was silently blocked).
      if (hasRecentInternalCopy()) {
        e.preventDefault();
        doPaste();
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [feedback, optimisticDropImage, doPaste, mutators]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (isEditorTarget(e)) return;
      const cmd = e.metaKey || e.ctrlKey;

      if (cmd && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        // Universal undo: try the in-tab UndoManager first (fine-grained
        // local edits). If it's exhausted, fall through to a time-travel
        // restore that walks back through board_versions snapshots.
        if (mutators.canUndo && mutators.canUndo()) {
          mutators.undo?.();
        } else {
          timeTravelUndo();
        }
        return;
      }
      if ((cmd && e.key === 'z' && e.shiftKey) || (cmd && e.key === 'y')) {
        e.preventDefault();
        // Mirror logic: try UndoManager redo first, then time-travel redo.
        if (mutators.canRedo && mutators.canRedo()) {
          mutators.redo?.();
        } else {
          timeTravelRedo();
        }
        return;
      }
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
  }, [mutators, selectAll, doDuplicate, doCopy, doCut, doDeleteSelected, selected.size, selectedStrokes.size, selectedArrows.size, setSelectedTool, enableSmoothTransform, timeTravelUndo, timeTravelRedo]);

  // ── Pan helpers ───────────────────────────────────────────────────────────
  // Same ref-driven, direct-DOM-mutation pattern as the wheel handler so a
  // space-drag pan doesn't re-render every card per pointermove.
  const startPan = (e) => {
    e.preventDefault();
    const startClient = { x: e.clientX, y: e.clientY };
    const startPanXY = { x: panRef.current.x, y: panRef.current.y };
    const initialPointerId = e.pointerId;
    const startedFromTouch = e.pointerType === 'touch';
    document.body.style.cursor = 'grabbing';
    let aborted = false;
    const cleanup = () => {
      document.body.style.cursor = '';
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointerdown', onSecondTouch, true);
    };
    const onMove = (ev) => {
      if (aborted) return;
      // Filter by the pointer that started this pan. Without this, a
      // second finger's pointermove during a pinch would clobber
      // panRef with stale values computed from startPanXY + delta and
      // overwrite whatever useGesture's pinch handler just set.
      if (ev.pointerId !== initialPointerId) return;
      panRef.current = {
        x: startPanXY.x + (ev.clientX - startClient.x),
        y: startPanXY.y + (ev.clientY - startClient.y),
      };
      applyCanvasTransform();
      scheduleVisibleRecompute();
    };
    const onSecondTouch = (ev) => {
      if (ev.pointerType !== 'touch') return;
      if (ev.pointerId === initialPointerId) return;
      // A second finger means the user is pinching / two-finger panning.
      // Abort our single-finger pan so onUp doesn't commit a setPan that
      // would override the pinch's deferred commit (scheduleTouchPanCommit).
      aborted = true;
      cleanup();
    };
    const onUp = (ev) => {
      if (ev.pointerId !== initialPointerId) return;
      cleanup();
      if (aborted) return;
      // Commit once at gesture end so persistence + downstream consumers
      // catch up to the gesture-time ref values.
      setPan({ x: panRef.current.x, y: panRef.current.y });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    // Only watch for additional fingers when the pan was initiated by
    // touch — desktop mouse panning is single-pointer-only.
    if (startedFromTouch) {
      window.addEventListener('pointerdown', onSecondTouch, true);
    }
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
    // View-only board: kill the drag before it starts so the card doesn't
    // visually follow the cursor only to snap back when the mutator no-ops.
    // For tier-demoted users we surface a one-shot toast with an upgrade
    // CTA; subsequent attempts on this same board are silent (the banner
    // is the standing explanation).
    if (!canEdit) {
      e.stopPropagation();
      e.preventDefault();
      if (boardPermission?.source === 'tier-demoted' && !dragBlockedToastShownRef.current) {
        dragBlockedToastShownRef.current = true;
        feedback.toast({
          type: 'info',
          message: 'Subscribe to edit shared boards.',
          action: onRequestUpgrade ? { label: 'Upgrade', onClick: onRequestUpgrade } : null,
          ttl: 5000,
        });
      }
      return;
    }
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
    if (isEditorTarget(e)) return;
    if (e.target.closest?.('.editable.is-editing, .note-toolbar, .rb-swatch-pop, .ic-link, .ic-add-caption, .editable')) return;

    if (selectedTool === 'arrow') {
      e.stopPropagation();
      if (!arrowFrom) setArrowFrom(c.id);
      else {
        if (!arrowRefEquals(arrowFrom, c.id)) {
          mutators.addArrow?.(arrowFrom, c.id, arrowOptions);
          setSelectedTool('select');
        }
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
    if (e.shiftKey) return;

    // Expand the drag set to cover every groupmate of every selected
    // card so groups always move as a unit.
    const expanded = expandWithGroupmates(nextSelected);
    const dragIds = [...expanded];
    const dragSet = new Set(dragIds);
    markRecentDrag(dragIds);
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

    // rAF-coalesced liveDrag broadcast. pointermove can fire ~120/sec;
    // peers only need ~60/sec (display refresh). We hold the latest
    // payload in a closure and flush once per animation frame.
    let pendingLiveDrag = null;
    let liveDragRafId = 0;
    const flushLiveDrag = () => {
      liveDragRafId = 0;
      if (!pendingLiveDrag) return;
      const aw = getAwareness?.();
      if (aw) {
        try { aw.setLocalStateField('liveDrag', pendingLiveDrag); } catch (_) {}
      }
      pendingLiveDrag = null;
    };

    // Coalesce pointermove ticks into one update per animation frame.
    // Without this, a 120Hz trackpad fires 120 onMove invocations per
    // second; each runs computeSnap (O(N²) in dragged-vs-target cards)
    // and setDrag/setSnapHints, which re-renders the canvas. RAF capping
    // halves the work and still feels indistinguishable from per-event
    // updates on a 60Hz display.
    let pendingMoveEv = null;
    let moveRafId = 0;
    const flushMove = () => {
      moveRafId = 0;
      const ev = pendingMoveEv;
      pendingMoveEv = null;
      if (!ev) return;
      perf.bump('drag.flush');
      const _t0 = perf.isEnabled() ? performance.now() : 0;
      const rawDx = (ev.clientX - startClient.x) / zoom;
      const rawDy = (ev.clientY - startClient.y) / zoom;
      // Hold Alt/Option to bypass snap.
      const skip = ev.altKey;
      const snap = skip ? { dx: rawDx, dy: rawDy, hints: null } : computeSnap(rawDx, rawDy);
      const { dx, dy, hints } = snap;
      setDrag({ ids: dragIds, dx, dy, startPositions });
      setSnapHints(hints);
      // Same-canvas board-drop hover detection. The dragged cards
      // themselves sit under the cursor, so elementFromPoint would
      // return them; use elementsFromPoint and walk the stack to find
      // the FIRST card-id that's not in the dragged set.
      let nextDropTarget = null;
      if (Math.abs(dx) + Math.abs(dy) > 4) {
        const stack = document.elementsFromPoint(ev.clientX, ev.clientY) || [];
        for (const el of stack) {
          const cardEl = el?.closest?.('[data-card-id]');
          const id = cardEl?.getAttribute?.('data-card-id');
          if (!id) continue;
          if (dragIds.includes(id)) continue;
          const tc = cardById[id];
          if (tc?.kind === 'board') { nextDropTarget = tc.id; break; }
          if (tc?.kind === 'boardlink' && tc.target) { nextDropTarget = tc.target; break; }
          // Keep walking the stack — non-board cards aren't drop
          // targets but we don't want to stop on them either.
        }
      }
      updateBoardDropTarget(nextDropTarget, nextDropTarget ? { x: ev.clientX, y: ev.clientY } : null);
      // Live cross-pane / inbox hover signal — other panes use this to
      // highlight themselves as drop targets while the pointer is over them.
      document.dispatchEvent(new CustomEvent('soleil-cross-pane-hover', {
        detail: { sourceBoardId: board.id, clientX: ev.clientX, clientY: ev.clientY },
      }));
      // Queue liveDrag broadcast for the next animation frame (peers see
      // ~60Hz updates instead of ~120Hz, and the local main thread is
      // freed from JSON-encoding + WebSocket-sending on every pointermove).
      pendingLiveDrag = {
        boardId: board.id,
        cards: dragIds.map(id => {
          const start = startPositions[id];
          return start ? { id, x: Math.round(start.x + dx), y: Math.round(start.y + dy) } : null;
        }).filter(Boolean),
      };
      if (!liveDragRafId) liveDragRafId = requestAnimationFrame(flushLiveDrag);
      if (_t0) perf.mark('drag.flush.ms', performance.now() - _t0);
    };
    const onMove = (ev) => {
      pendingMoveEv = ev;
      if (!moveRafId) moveRafId = requestAnimationFrame(flushMove);
    };
    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      // Cancel any queued mid-drag pointermove that's about to flush —
      // we're about to commit final positions, so a trailing flush would
      // re-render the dragged cards once at a stale delta before settling.
      if (moveRafId) { cancelAnimationFrame(moveRafId); moveRafId = 0; }
      pendingMoveEv = null;
      const rawDx = (ev.clientX - startClient.x) / zoom;
      const rawDy = (ev.clientY - startClient.y) / zoom;
      const skip = ev.altKey;
      const snapEnd = skip ? { dx: rawDx, dy: rawDy } : computeSnap(rawDx, rawDy);
      const { dx, dy } = snapEnd;
      setSnapHints(null);
      // Cancel any queued mid-drag broadcast so a stale rAF can't fire
      // AFTER we clear liveDrag and momentarily flash the card back to
      // the previous position.
      if (liveDragRafId) { cancelAnimationFrame(liveDragRafId); liveDragRafId = 0; }
      pendingLiveDrag = null;
      // Clear our live-drag awareness so peers see the card snap to its
      // committed position. (The Y.Doc updateCards call below propagates
      // the final position via Yjs sync.)
      try { getAwareness?.()?.setLocalStateField('liveDrag', null); } catch (_) {}
      // ── Same-canvas drop onto a board card (move INTO that board) ──
      // Read from the ref — the state captured in this closure is stale
      // across re-renders during the drag.
      const targetBoardId = boardDropTargetRef.current;
      updateBoardDropTarget(null);
      if (targetBoardId && (Math.abs(dx) + Math.abs(dy) > 4)) {
        const movedCards = dragIds.map(id => cardById[id]).filter(Boolean);
        if (movedCards.length) {
          // Run the drop as an async transaction so we can capture
          // before/after state around mutators.deleteCards and roll
          // back via bulletproofRestore if the invariant fails.
          (async () => {
            const cardsMap = ydoc?.getMap?.('cards');
            const beforeKeys = cardsMap ? [...cardsMap.keys()] : [];
            const beforeCount = beforeKeys.length;
            const expectedDelta = dragIds.length;
            console.log('[drag-into-board] start', {
              sourceBoardId: board.id,
              targetBoardId,
              dragIds,
              movedCardKinds: movedCards.map(c => c.kind),
              beforeCount,
              expectedDelta,
            });

            // Pre-drop snapshot — awaited so we have the snapshot id BEFORE
            // the delete fires. If anything goes wrong we can roll back
            // from this exact snapshot via bulletproofRestore.
            let preDropSnapshotId = null;
            if (ydoc && board?.id) {
              try {
                preDropSnapshotId = await saveBoardVersion(board.id, ydoc, {
                  triggerKind: 'pre-drop',
                  sessionId,
                  userId,
                  label: 'pre-drop-into-board',
                  opSummary: {
                    action: 'drop-into-board',
                    target_board: targetBoardId,
                    card_count: movedCards.length,
                    drag_ids: dragIds,
                    moved_card_kinds: movedCards.map(c => c.kind),
                  },
                });
              } catch (e) {
                console.warn('[drag-into-board] pre-drop snapshot failed', e);
              }
            }

            // Clear local comment bubbles before the realtime push
            // catches up (the cards are leaving this canvas).
            const movedGroupIds = [...new Set(movedCards.map(c => c.groupId).filter(Boolean))];

            // Hand the cards off to the target via App.jsx onDrop.
            // App.jsx writes the target board_state then resolves
            // `onTargetSaved`. We only delete the source cards once
            // that resolves successfully — otherwise the cards live in
            // limbo (or worse, get deleted with no destination).
            let resolveTargetSaved, rejectTargetSaved;
            const targetSaved = new Promise((res, rej) => {
              resolveTargetSaved = res;
              rejectTargetSaved = rej;
            });
            document.dispatchEvent(new CustomEvent('soleil-card-into-board-drop', {
              detail: {
                sourceBoardId: board.id,
                targetBoardId,
                cards: movedCards,
                onTargetSaved: resolveTargetSaved,
                onTargetFailed: rejectTargetSaved,
              },
            }));
            try {
              await targetSaved;
            } catch (err) {
              console.error('[drag-into-board] target save failed; NOT deleting source', err);
              feedback.toast({
                type: 'error',
                message: 'Drop failed — source cards preserved. ' + (err?.message || err),
                duration: 8000,
              });
              return;
            }
            // Now safe to clear local comments + delete source.
            removeCommentsByAnchorIds([...dragIds, ...movedGroupIds]);

            // Source-side delete. Wrap with the invariant check.
            mutators.deleteCards?.(dragIds);

            const afterKeys = cardsMap ? [...cardsMap.keys()] : [];
            const afterCount = afterKeys.length;
            const actualDelta = beforeCount - afterCount;
            console.log('[drag-into-board] post-delete', {
              afterCount,
              actualDelta,
              expectedDelta,
              keysRemoved: beforeKeys.filter(k => !afterKeys.includes(k)),
              keysAdded:   afterKeys.filter(k => !beforeKeys.includes(k)),
            });

            // CRITICAL INVARIANT: source must lose exactly dragIds.length
            // cards. If we lost more (or fewer), something is silently
            // mutating the cards map and we need to roll back hard.
            if (actualDelta !== expectedDelta) {
              console.error('[drag-into-board] INVARIANT VIOLATED — auto-rolling back', {
                beforeCount, afterCount, expectedDelta, actualDelta,
                dragIds, beforeKeys, afterKeys,
                keysUnexpectedlyRemoved: beforeKeys.filter(k => !dragIds.includes(k) && !afterKeys.includes(k)),
              });
              try {
                if (preDropSnapshotId) {
                  const b64 = await loadBoardVersionDoc(preDropSnapshotId);
                  if (b64) {
                    await bulletproofRestore(board.id, b64);
                    feedback.toast({
                      type: 'error',
                      message: `Drag aborted — source board lost ${actualDelta} cards instead of ${expectedDelta}. Restored automatically.`,
                      ttl: 12000,
                    });
                  } else {
                    feedback.toast({ type: 'error', message: 'Drag caused unexpected state loss; manual recovery needed (History → Restore).' });
                  }
                } else {
                  feedback.toast({ type: 'error', message: 'Drag caused unexpected state loss; manual recovery needed.' });
                }
              } catch (rbErr) {
                console.error('[drag-into-board] rollback failed', rbErr);
                feedback.toast({ type: 'error', message: 'Rollback failed: ' + (rbErr.message || rbErr) });
              }
              return;
            }

            // Post-drop snapshot so every cross-board drag has a paired
            // before/after for diffing. Fire-and-forget.
            if (ydoc && board?.id) {
              saveBoardVersion(board.id, ydoc, {
                triggerKind: 'post-drop',
                sessionId,
                userId,
                label: 'post-drop-source',
                opSummary: {
                  action: 'drop-into-board-completed',
                  target_board: targetBoardId,
                  card_count_before: beforeCount,
                  card_count_after: afterCount,
                  expected_delta: expectedDelta,
                  actual_delta: actualDelta,
                },
              });
            }
          })();
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
      // Click-vs-drag decision: use raw SCREEN-space distance, not the snapped
      // canvas dx/dy. Snap absorbs small movements back to 0, which used to
      // mis-classify intent-to-drag gestures as clicks and open boards.
      const screenDx = ev.clientX - startClient.x;
      const screenDy = ev.clientY - startClient.y;
      const wasClick = Math.hypot(screenDx, screenDy) <= 4;
      if (!wasClick) {
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

    // Snap targets, captured once at drag start. Two flavours per axis:
    //   - numeric match: dragged width / height equals another card's
    //     width / height (the primary "match the size of that card" use case).
    //   - edge alignment: dragged card's right / bottom edge lands on
    //     another card's left / right / top / bottom edge — same idea
    //     position-drag uses, applied to the bottom-right resize corner.
    const SNAP_PX = 6;
    const wCands = []; // { value, owner }
    const hCands = [];
    const rightEdgeXs   = []; // { x, y0, y1 }  — where dragged right edge can land
    const bottomEdgeYs  = []; // { y, x0, x1 }
    cards.forEach(other => {
      if (other.id === c.id) return;
      wCands.push({ value: other.w, owner: other });
      hCands.push({ value: other.h, owner: other });
      rightEdgeXs.push({ x: other.x,             y0: other.y, y1: other.y + other.h });
      rightEdgeXs.push({ x: other.x + other.w,   y0: other.y, y1: other.y + other.h });
      bottomEdgeYs.push({ y: other.y,            x0: other.x, x1: other.x + other.w });
      bottomEdgeYs.push({ y: other.y + other.h,  x0: other.x, x1: other.x + other.w });
    });

    const computeResizeSnap = (rawDw, rawDh, skip) => {
      if (skip) return { dw: rawDw, dh: rawDh, hints: null };
      const thresh = SNAP_PX / zoom;
      const candW       = c.w + rawDw;
      const candH       = c.h + rawDh;
      const candRight   = c.x + c.w + rawDw;
      const candBottom  = c.y + c.h + rawDh;
      let bestDwAdj = null, bestDwDist = thresh + 0.001, bestWMatch = null;
      let bestDhAdj = null, bestDhDist = thresh + 0.001, bestHMatch = null;
      for (const wc of wCands) {
        const adjust = wc.value - candW;
        const d = Math.abs(adjust);
        if (d < bestDwDist) { bestDwDist = d; bestDwAdj = adjust; bestWMatch = { kind: 'numeric', owner: wc.owner }; }
      }
      for (const re of rightEdgeXs) {
        const adjust = re.x - candRight;
        const d = Math.abs(adjust);
        if (d < bestDwDist) { bestDwDist = d; bestDwAdj = adjust; bestWMatch = { kind: 'edge', target: re }; }
      }
      for (const hc of hCands) {
        const adjust = hc.value - candH;
        const d = Math.abs(adjust);
        if (d < bestDhDist) { bestDhDist = d; bestDhAdj = adjust; bestHMatch = { kind: 'numeric', owner: hc.owner }; }
      }
      for (const be of bottomEdgeYs) {
        const adjust = be.y - candBottom;
        const d = Math.abs(adjust);
        if (d < bestDhDist) { bestDhDist = d; bestDhAdj = adjust; bestHMatch = { kind: 'edge', target: be }; }
      }
      const dw = rawDw + (bestDwAdj ?? 0);
      const dh = rawDh + (bestDhAdj ?? 0);
      // Build guide hints using the same shape consumed by the existing
      // <svg className="snap-guides"> renderer further down in render.
      const xs = [];
      const ys = [];
      if (bestWMatch?.kind === 'edge') {
        const t = bestWMatch.target;
        xs.push({
          x: t.x,
          y0: Math.min(t.y0, c.y),
          y1: Math.max(t.y1, c.y + c.h + dh),
        });
      } else if (bestWMatch?.kind === 'numeric') {
        // Underline the matched card so the user can see WHO they're
        // matching, with the matched dimension floating just under it.
        const o = bestWMatch.owner;
        ys.push({ y: o.y + o.h + 6 / zoom, x0: o.x, x1: o.x + o.w, label: String(o.w) });
      }
      if (bestHMatch?.kind === 'edge') {
        const t = bestHMatch.target;
        ys.push({
          y: t.y,
          x0: Math.min(t.x0, c.x),
          x1: Math.max(t.x1, c.x + c.w + dw),
        });
      } else if (bestHMatch?.kind === 'numeric') {
        // Side-bar to the right of the matched card, labeled with its height.
        const o = bestHMatch.owner;
        xs.push({ x: o.x + o.w + 6 / zoom, y0: o.y, y1: o.y + o.h, label: String(o.h) });
      }
      const hints = (xs.length || ys.length) ? { xs, ys, spacings: [] } : null;
      return { dw, dh, hints };
    };

    // Image and video cards lock their aspect ratio on resize so the
    // user always sees the whole image without letterboxing or
    // unintended cropping. Hold Cmd/Ctrl during the drag to bypass and
    // resize freely (which then makes object-fit:cover crop the image).
    const aspectLockKinds = new Set(['image', 'video']);
    const lockAspect = aspectLockKinds.has(c.kind) && c.w > 0 && c.h > 0;
    const startAspect = lockAspect ? c.w / c.h : null;

    // Project a raw (dw, dh) onto the locked aspect, following the
    // axis the user is pushing more aggressively (proportionally).
    const applyAspectLock = (rawDw, rawDh, bypass) => {
      if (!lockAspect || bypass) return { dw: rawDw, dh: rawDh };
      const ratioW = (c.w + rawDw) / c.w;
      const ratioH = (c.h + rawDh) / c.h;
      // Use the dominant scale factor so dragging right OR down works
      // intuitively; preserve sign so dragging past the anchor mirrors.
      const useW = Math.abs(rawDw) * c.h >= Math.abs(rawDh) * c.w;
      const k = useW ? ratioW : ratioH;
      const newW = c.w * k;
      const newH = newW / startAspect;
      return { dw: newW - c.w, dh: newH - c.h };
    };

    const onMove = (ev) => {
      const rawDwRaw = (ev.clientX - startClient.x) / zoom;
      const rawDhRaw = (ev.clientY - startClient.y) / zoom;
      const bypass = ev.metaKey || ev.ctrlKey;
      const { dw: rawDw, dh: rawDh } = applyAspectLock(rawDwRaw, rawDhRaw, bypass);
      // Aspect-locked resize skips edge/numeric snapping (would break the
      // lock); Alt continues to also disable snap for the free-resize case.
      const { dw, dh, hints } = computeResizeSnap(rawDw, rawDh, lockAspect && !bypass ? true : ev.altKey);
      setResize({ id: c.id, dw, dh });
      setSnapHints(hints);
    };
    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const rawDwRaw = (ev.clientX - startClient.x) / zoom;
      const rawDhRaw = (ev.clientY - startClient.y) / zoom;
      const bypass = ev.metaKey || ev.ctrlKey;
      const { dw: rawDw, dh: rawDh } = applyAspectLock(rawDwRaw, rawDhRaw, bypass);
      const { dw, dh } = computeResizeSnap(rawDw, rawDh, lockAspect && !bypass ? true : ev.altKey);
      const newW = Math.max(MIN_W, Math.round(c.w + dw));
      const newH = Math.max(MIN_H, Math.round(c.h + dh));
      if (newW !== c.w || newH !== c.h) {
        // Manual resize sticks — note auto-sizing stops once the user has
        // committed a hand-set size. Only matters for note cards but the
        // flag is harmless on other kinds.
        const patch = { w: newW, h: newH };
        if (c.kind === 'note' && !c.manuallyResized) patch.manuallyResized = true;
        mutators.updateCard?.(c.id, patch);
      }
      setResize(null);
      setSnapHints(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Multi-selection / group resize. Activated by handles on the
  // SelectionBoundsOverlay. Default behaviour: uniform scale, preserve
  // each item's aspect, anchor at the opposite corner. Hold Shift to
  // free-stretch (independent sx, sy). Items below the per-card minimum
  // clamp the whole scale so the union doesn't deform.
  const onMultiResizePointerDown = (e, handle, items, startBounds) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const anchor = oppositeCorner(handle, startBounds);
    const startById = new Map();
    items.forEach(c => startById.set(c.id, { x: c.x, y: c.y, w: c.w, h: c.h, kind: c.kind, manuallyResized: !!c.manuallyResized }));
    const startClient = { x: e.clientX, y: e.clientY };
    // Pointer-down corresponds to a specific corner / edge of the union
    // bounds. We track where that corner *started* in canvas space so
    // we can convert pointer movement into a new corner position.
    const startCorner = {
      x: handle.includes('l') ? startBounds.x : (handle.includes('r') ? startBounds.right : (startBounds.x + startBounds.right) / 2),
      y: handle.includes('t') ? startBounds.y : (handle.includes('b') ? startBounds.bottom : (startBounds.y + startBounds.bottom) / 2),
    };
    setMultiResize({ handle, anchor, startBounds, startById, live: null });

    const computeUpdates = (ev) => {
      const dx = (ev.clientX - startClient.x) / zoom;
      const dy = (ev.clientY - startClient.y) / zoom;
      const newCornerX = startCorner.x + dx;
      const newCornerY = startCorner.y + dy;
      const denomX = (startCorner.x - anchor.x);
      const denomY = (startCorner.y - anchor.y);
      let sx = anchor.axisX && denomX !== 0 ? (newCornerX - anchor.x) / denomX : 1;
      let sy = anchor.axisY && denomY !== 0 ? (newCornerY - anchor.y) / denomY : 1;
      // Disallow mirroring across the anchor — clamp at a tiny positive
      // scale so cards never flip negative.
      if (sx < 0.05) sx = 0.05;
      if (sy < 0.05) sy = 0.05;
      // Uniform scale unless Shift is held. Take the average of the two
      // axis factors, applied to both axes the user can actually drag
      // (mid-edge handles only drive one axis).
      if (!ev.shiftKey) {
        if (anchor.axisX && anchor.axisY) {
          const s = (sx + sy) / 2;
          sx = s; sy = s;
        } else if (anchor.axisX) {
          sy = sx;
        } else if (anchor.axisY) {
          sx = sy;
        }
      }
      // Clamp so the smallest item won't fall below its min.
      let clamp = 1;
      for (const start of startById.values()) {
        const wClamp = MIN_W / Math.max(1, start.w * sx);
        const hClamp = MIN_H / Math.max(1, start.h * sy);
        if (wClamp > 1) clamp = Math.max(clamp, wClamp);
        if (hClamp > 1) clamp = Math.max(clamp, hClamp);
      }
      if (clamp > 1) { sx *= clamp; sy *= clamp; }
      const live = new Map();
      for (const [id, start] of startById) {
        const nx = anchor.x + (start.x - anchor.x) * sx;
        const ny = anchor.y + (start.y - anchor.y) * sy;
        const nw = Math.max(MIN_W, start.w * sx);
        const nh = Math.max(MIN_H, start.h * sy);
        live.set(id, { x: nx, y: ny, w: nw, h: nh });
      }
      return live;
    };

    const onMove = (ev) => {
      const live = computeUpdates(ev);
      setMultiResize(prev => prev ? { ...prev, live } : prev);
    };
    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const live = computeUpdates(ev);
      const updates = [];
      for (const [id, lv] of live) {
        const start = startById.get(id);
        const newX = Math.round(lv.x);
        const newY = Math.round(lv.y);
        const newW = Math.max(MIN_W, Math.round(lv.w));
        const newH = Math.max(MIN_H, Math.round(lv.h));
        if (newX === start.x && newY === start.y && newW === start.w && newH === start.h) continue;
        const patch = { x: newX, y: newY, w: newW, h: newH };
        if (start.kind === 'note' && !start.manuallyResized) patch.manuallyResized = true;
        updates.push({ id, patch });
      }
      if (updates.length) mutators.updateCards?.(updates);
      setMultiResize(null);
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

  // Pointer-down on an arrow's hit-path. Selects the arrow, then if
  // the user keeps dragging, translates the whole arrow (both
  // endpoints) — only valid when BOTH endpoints are free points,
  // not card-anchored (card anchors stay attached to their cards).
  const onArrowBodyPointerDown = (e, idx) => {
    if (e.button !== 0) return;
    if (selectedTool !== 'select') return;
    e.stopPropagation();
    // Select first (matches onArrowClick behavior).
    const sel = e.shiftKey ? new Set(selectedArrows) : new Set();
    if (sel.has(idx)) sel.delete(idx); else sel.add(idx);
    setSelectedArrows(sel);
    if (!e.shiftKey) { setSelected(new Set()); setSelectedStrokes(new Set()); }
    // Only support body-drag when both endpoints are free {x,y} points.
    const a = (arrows || [])[idx];
    if (!a) return;
    const fromIsFree = a.from && typeof a.from === 'object' && !a.from.cardId && !a.from.id;
    const toIsFree   = a.to   && typeof a.to   === 'object' && !a.to.cardId   && !a.to.id;
    if (!fromIsFree || !toIsFree) return;
    const startClient = { x: e.clientX, y: e.clientY };
    const startFrom = { x: a.from.x, y: a.from.y };
    const startTo   = { x: a.to.x,   y: a.to.y };
    // Snap targets captured at drag start: every OTHER arrow's
    // endpoints + every card's corners. While translating the body,
    // if either of this arrow's endpoints lands within SNAP_DIST of
    // a target, nudge the WHOLE arrow so the endpoint clicks onto
    // the target. The nearer of the two (from/to) wins.
    const SNAP_DIST = 12 / zoom;
    const snapTargets = [];
    (arrowAttachments || []).forEach((oAtt, j) => {
      if (j === idx) return;
      if (oAtt?.from?.point) snapTargets.push({ x: oAtt.from.point.x, y: oAtt.from.point.y });
      if (oAtt?.to?.point)   snapTargets.push({ x: oAtt.to.point.x,   y: oAtt.to.point.y });
    });
    (cards || []).forEach(c => {
      snapTargets.push({ x: c.x,         y: c.y });
      snapTargets.push({ x: c.x + c.w,   y: c.y });
      snapTargets.push({ x: c.x,         y: c.y + c.h });
      snapTargets.push({ x: c.x + c.w,   y: c.y + c.h });
    });
    let dragged = false;
    const onMove = (mv) => {
      const dxRaw = (mv.clientX - startClient.x) / zoom;
      const dyRaw = (mv.clientY - startClient.y) / zoom;
      if (!dragged && Math.hypot(dxRaw * zoom, dyRaw * zoom) < 3) return;
      dragged = true;
      // Candidate (un-snapped) endpoint positions.
      const candFromX = startFrom.x + dxRaw;
      const candFromY = startFrom.y + dyRaw;
      const candToX   = startTo.x + dxRaw;
      const candToY   = startTo.y + dyRaw;
      // For each of the two endpoints, find its nearest target. The
      // smaller of the two distances wins; apply the delta to BOTH
      // endpoints so the line translates as a unit onto the snap.
      let bestEnd = null; // 'from' | 'to'
      let bestD = SNAP_DIST;
      let bestAdjX = 0, bestAdjY = 0;
      for (const t of snapTargets) {
        const dFx = t.x - candFromX, dFy = t.y - candFromY;
        const dF  = Math.hypot(dFx, dFy);
        if (dF < bestD) { bestD = dF; bestEnd = 'from'; bestAdjX = dFx; bestAdjY = dFy; }
        const dTx = t.x - candToX,   dTy = t.y - candToY;
        const dT  = Math.hypot(dTx, dTy);
        if (dT < bestD) { bestD = dT; bestEnd = 'to';   bestAdjX = dTx; bestAdjY = dTy; }
      }
      const dx = dxRaw + (bestEnd ? bestAdjX : 0);
      const dy = dyRaw + (bestEnd ? bestAdjY : 0);
      mutators.updateArrow?.(idx, {
        from: { x: Math.round(startFrom.x + dx), y: Math.round(startFrom.y + dy) },
        to:   { x: Math.round(startTo.x + dx),   y: Math.round(startTo.y + dy) },
      });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
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
        items.push({ id: 'image-edit', label: 'Edit', submenu: [
          { id: 'title', label: c.title ? 'Edit title' : 'Add title', run: () => triggerInlineEdit(c.id, 'title') },
          { id: 'caption', label: c.caption ? 'Edit caption' : 'Add caption', run: () => triggerInlineEdit(c.id, 'caption') },
          { id: 'link', label: c.link ? 'Edit hyperlink' : 'Add hyperlink', run: async () => {
            const v = await feedback.prompt({
              title: c.link ? 'Edit image hyperlink' : 'Add image hyperlink',
              label: 'URL',
              placeholder: 'https://...',
              defaultValue: c.link || '',
              confirmLabel: 'Save link',
            });
            if (v == null) return;
            mutators.updateCard?.(c.id, { link: v.trim() || null });
          }},
          { id: 'replace', label: 'Replace image…', run: () => {
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
          }},
        ]});
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
        items.push({ id: 'shape-style', label: 'Stroke', submenu: [
          { id: 'shape-stroke-col', label: 'Stroke color…', run: () => {
            setPicker({
              value: c.stroke || '#f5f5f6',
              onChange: (col) => mutators.updateCard?.(c.id, { stroke: col }),
              x: ctx.x, y: ctx.y, allowTransparent: false,
            });
          }},
          { id: 'shape-fill', label: 'Fill color…', run: () => {
            setPicker({
              value: c.fill && c.fill !== 'transparent' ? c.fill : '#1c1c1f',
              onChange: (col) => mutators.updateCard?.(c.id, { fill: col }),
              x: ctx.x, y: ctx.y, allowTransparent: true,
            });
          }},
          { divider: true },
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
        items.push({ id: 'palette-edit', label: 'Edit', submenu: [
          { id: 'pc-hide-hex',
            label: c.hideHex ? 'Show hex codes' : 'Hide hex codes',
            run: () => mutators.updateCard?.(c.id, { hideHex: !c.hideHex }) },
          { id: 'pc-hide-labels',
            label: c.hideLabels ? 'Show palette labels' : 'Hide palette labels',
            run: () => mutators.updateCard?.(c.id, { hideLabels: !c.hideLabels }) },
          { divider: true },
          { id: 'pc-eyedrop', label: 'Eyedrop color (anywhere on screen)…', run: async () => {
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
          }},
          { id: 'pc-pick-image', label: 'Pick from board image…', run: () => {
            setEyedropFor(c.id);
            feedback.toast({ type: 'info', message: 'Click an image to sample a color. Esc to cancel.' });
          }},
        ]});
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
      } else if (c.kind === 'audio') {
        items.push({ id: 'audio-title', label: c.title ? 'Edit title' : 'Add title',
                     run: () => triggerInlineEdit(c.id, 'title') });
        if (c.cover) {
          items.push({ id: 'audio-cover-replace', label: 'Replace cover image…',
                       run: () => triggerInlineEdit(c.id, 'audioCover') });
          items.push({ id: 'audio-cover-remove', label: 'Remove cover image',
                       run: () => mutators.updateCard?.(c.id, { cover: null }) });
        } else {
          items.push({ id: 'audio-cover-set', label: 'Set cover image…',
                       run: () => triggerInlineEdit(c.id, 'audioCover') });
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
    // Arrange (z-order): mutators are singular, so for multi-select we
    // iterate in an order that preserves relative stacking:
    //   front:    low-z first  → top-most selected ends up top-most
    //   back:     high-z first → bottom-most selected stays bottom-most
    //   forward:  high-z first → no leap-frog among selected
    //   backward: low-z first  → same, mirrored
    const arrangeRun = (op) => {
      const ids = multi ? [...selected] : [c.id];
      const zOf = (id) => (cardById[id]?.z || 0);
      const order =
        op === 'front'    ? ids.slice().sort((a, b) => zOf(a) - zOf(b)) :
        op === 'back'     ? ids.slice().sort((a, b) => zOf(b) - zOf(a)) :
        op === 'forward'  ? ids.slice().sort((a, b) => zOf(b) - zOf(a)) :
        /* backward */      ids.slice().sort((a, b) => zOf(a) - zOf(b));
      const fn =
        op === 'front'    ? mutators.bringToFront :
        op === 'back'     ? mutators.sendToBack :
        op === 'forward'  ? mutators.bringForward :
        /* backward */      mutators.sendBackward;
      order.forEach(id => fn?.(id));
    };
    items.push({ id: 'arrange', label: 'Arrange', submenu: [
      { id: 'front',    label: 'Bring to front', run: () => arrangeRun('front') },
      { id: 'forward',  label: 'Bring forward',  run: () => arrangeRun('forward') },
      { id: 'backward', label: 'Send backward',  run: () => arrangeRun('backward') },
      { id: 'back',     label: 'Send to back',   run: () => arrangeRun('back') },
    ]});

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
      // Quick "Remove from group" stays at top — most common action.
      items.push({ id: 'group-remove', label: multi ? `Remove from group (${selected.size})` : 'Remove from group',
        run: () => mutators.removeFromGroup?.(multi ? [...selected] : [c.id]) });
      // Everything else — rename / outline / shape / color / info / ungroup —
      // tucked into a single Group submenu so the top level stays scannable.
      items.push({ id: 'group', label: `Group "${g.name || 'Untitled'}"`, submenu: [
        { id: 'group-rename', label: 'Rename group…', run: async () => {
          const name = await feedback.prompt({
            title: 'Rename group',
            label: 'Name',
            defaultValue: g.name || '',
            confirmLabel: 'Rename',
          });
          if (name == null) return;
          mutators.renameGroup?.(g.id, name);
        }},
        { id: 'group-outline', label: g.outline ? 'Hide outline' : 'Show outline',
          run: () => mutators.setGroupOutline?.(g.id, { outline: !g.outline }) },
        { id: 'group-hide-label',
          label: g.options?.hideLabel ? 'Show label' : 'Hide label',
          run: () => mutators.setGroupOutline?.(g.id, {
            options: { ...(g.options || {}), hideLabel: !g.options?.hideLabel },
          }) },
        { id: 'group-shape', label: 'Outline shape', submenu: [
          { id: 'gs-box', label: `Box${(g.shape || 'box') === 'box' ? '  ✓' : ''}`,
            run: () => mutators.setGroupOutline?.(g.id, { shape: 'box', outline: true }) },
          { id: 'gs-hug', label: `Hug${g.shape === 'hug' ? '  ✓' : ''}`,
            run: () => mutators.setGroupOutline?.(g.id, { shape: 'hug', outline: true }) },
        ]},
        { id: 'group-color', label: 'Outline color…', run: () => {
          setPicker({
            value: g.color || 'var(--soleil)',
            onChange: (col) => mutators.setGroupOutline?.(g.id, { color: col, outline: true }),
            x: ctx.x, y: ctx.y, allowTransparent: false,
          });
        }},
        { id: 'group-info', label: 'Group info', run: () => {
          const memberCount = (cards || []).filter(cc => cc.groupId === g.id).length;
          const lines = [`${memberCount} member${memberCount === 1 ? '' : 's'}`];
          if (g.createdAt) lines.push(`created ${relativeTimeShort(g.createdAt)}`);
          if (g.createdBy) {
            const cached = userProfiles.resolve(g.createdBy);
            const name = g.createdBy === userId
              ? 'you'
              : (cached?.name || (cached?.email ? cached.email.split('@')[0] : null) || 'someone');
            lines.push(`by ${name}`);
          }
          feedback.toast({ type: 'info', message: lines.join(' · ') });
        }},
        { divider: true },
        { id: 'ungroup', label: 'Ungroup', danger: true, run: () => mutators.ungroup?.(g.id) },
      ]});
    }

    // Audit info — who created this and when, last edit by whom and when.
    // Surfaces the audit metadata that was stamped on add/update; resolves
    // user ids against current wsPeers, falling back to "you" / a short id.
    if (!multi && (c.createdBy || c.createdAt || c.updatedBy || c.updatedAt)) {
      const resolveName = (uid) => {
        if (!uid) return 'unknown';
        if (uid === userId) return 'you';
        const cached = userProfiles.resolve(uid);
        return cached?.name
            || (cached?.email ? cached.email.split('@')[0] : null)
            || 'someone';
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
      // Routing is decided at COMMIT (in onUp) so the whole stroke is
      // considered, not just the start point — drawing into an art
      // canvas should land in that canvas even if the cursor began
      // just outside its edge. Reads from refs so a stroke right
      // after a SketchPad commit sees the freshly-added art canvas.
      const pickStrokeTarget = (pts) => {
        const liveCards = cardsRef.current || [];
        const liveSelected = selectedRef.current;
        if (liveSelected && liveSelected.size === 1) {
          const selId = [...liveSelected][0];
          const sel = liveCards.find(c => c.id === selId)
                   || (pendingCardRef.current?.id === selId ? pendingCardRef.current : null);
          if (sel) return sel;
        }
        // Score every art canvas by how many stroke points fall inside
        // its bbox; the one with the most overlap wins. Ties pick the
        // top-most z (last wins). If nothing scores > 0, return null
        // and the stroke falls through to the board's free-canvas.
        const arts = liveCards.filter(c => c.kind === 'art');
        if (!arts.length) return null;
        let best = null, bestScore = 0;
        for (const c of arts) {
          let n = 0;
          const cx = c.x, cy = c.y, cw = c.w || 0, ch = c.h || 0;
          for (const [px, py] of pts) {
            if (px >= cx && px <= cx + cw && py >= cy && py <= cy + ch) n++;
          }
          if (n > bestScore || (n > 0 && n === bestScore && (c.z || 0) >= (best?.z || 0))) {
            best = c; bestScore = n;
          }
        }
        return bestScore > 0 ? best : null;
      };
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
            const targetCard = pickStrokeTarget(points);
            if (targetCard) {
              const localEraser = points.map(([x, y]) => [x - targetCard.x, y - targetCard.y]);
              const next = [];
              (targetCard.strokes || []).forEach(stroke => {
                next.push(...splitStrokeByEraser(stroke, localEraser, radius));
              });
              mutators.updateCard?.(targetCard.id, { strokes: next });
            } else {
              const next = [];
              (strokes || []).forEach(stroke => {
                next.push(...splitStrokeByEraser(stroke, points, radius));
              });
              mutators.replaceStrokes?.(next);
              setSelectedStrokes(new Set());
            }
            // Auto-switch only when finishing on an art canvas — board
            // free-erasing is iterative like board free-drawing.
            if (targetCard) setSelectedTool('select');
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
        if (points.length > 1) {
          const targetCard = pickStrokeTarget(points);
          if (targetCard) {
            // Translate to card-local coords so the stroke stays bounded
            // to the card and moves/scales with it.
            const localPoints = points.map(([x, y]) => [x - targetCard.x, y - targetCard.y]);
            const existing = Array.isArray(targetCard.strokes) ? targetCard.strokes : [];
            mutators.updateCard?.(targetCard.id, {
              strokes: [...existing, { color, width, points: localPoints }],
            });
          } else {
            mutators.addStroke?.({ color, width, points });
          }
          // Surface the just-used color in recents so the swatch
          // strip in the draw tool options updates as the user works.
          addRecentColor(color);
          // Auto-switch only when finishing on an art canvas. Drawing
          // on the main board is iterative — that's how people draw.
          if (targetCard) setSelectedTool('select');
        }
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
          setSelectedTool('select');
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
      let lastCur = startC; // preserves actual pointer direction for line tool
      const onMove = (ev) => {
        if (!moved && Math.abs(ev.clientX - startClient.x) < 4 && Math.abs(ev.clientY - startClient.y) < 4) return;
        moved = true;
        const cur = clientToCanvas(ev.clientX, ev.clientY);
        let w = cur.x - startC.x, h = cur.y - startC.y;
        // Shift = constrain to square (for non-line shapes). For lines,
        // shift = constrain to 0/45/90 degree angles.
        if (ev.shiftKey) {
          if (shapeOptions.shape === 'line') {
            const ang = Math.atan2(h, w);
            const snapAng = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
            const len = Math.hypot(w, h);
            w = Math.cos(snapAng) * len;
            h = Math.sin(snapAng) * len;
          } else {
            const m = Math.max(Math.abs(w), Math.abs(h));
            w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m;
          }
        }
        lastCur = { x: startC.x + w, y: startC.y + h };
        lastBounds = {
          x: Math.min(startC.x, startC.x + w),
          y: Math.min(startC.y, startC.y + h),
          w: Math.abs(w), h: Math.abs(h),
        };
        // For line shapes, carry the actual drag direction in the
        // preview state so the on-screen preview draws from startC
        // to lastCur (matches what will be committed). Other shapes
        // use the bounding rect as today.
        if (shapeOptions.shape === 'line') {
          setActiveShape({ ...lastBounds, kind: 'line', from: startC, to: lastCur });
        } else {
          setActiveShape(lastBounds);
        }
      };
      const onUp = (ev) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        // For line/arrow shapes a flat horizontal or vertical drag is the
        // most natural input — accept any drag longer than 12px diagonal.
        // Other shapes need real area in both dimensions.
        const isLinear = shapeOptions.shape === 'line' || shapeOptions.shape === 'arrow';
        const dragOk = isLinear
          ? lastBounds && Math.hypot(lastBounds.w, lastBounds.h) > 12
          : lastBounds && lastBounds.w > 6 && lastBounds.h > 6;
        if (moved && dragOk && shapeOptions.shape === 'line') {
          // Lines route through the arrow infrastructure (no head) so
          // they get endpoint handles, snap-to-cards, and body-drag
          // for free. Shape-tool color/width/dash carry over via a
          // `customStroke` field that the arrow renderer honors.
          const from = { x: Math.round(startC.x), y: Math.round(startC.y) };
          const to   = { x: Math.round(lastCur.x), y: Math.round(lastCur.y) };
          mutators.addFreeArrow?.(from, to, {
            straight: true,
            head: 'none',
            customStroke: shapeOptions.stroke || null,
            customStrokeWidth: shapeOptions.strokeWidth ?? null,
            customDash: shapeOptions.dash === 'solid' ? null : (shapeOptions.dash || null),
          });
        } else if (moved && dragOk) {
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
            // Arrow shape cards still need a clickable bounding box for
            // flat drags. (Line shapes now use the arrow path above so
            // this branch only handles rect/ellipse/diamond/etc.)
            w: Math.max(isLinear ? 16 : 1, Math.round(lastBounds.w)),
            h: Math.max(isLinear ? 16 : 1, Math.round(lastBounds.h)),
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

    // On touch (finger), one-finger drag on empty canvas should pan, not
    // lasso-select. Tapping a card still selects it (cards have their own
    // handlers); long-press still opens the background context menu.
    // Pen / stylus keeps the desktop lasso behavior so Apple Pencil users
    // can still marquee-select.
    //
    // Only start pan for the PRIMARY pointer (first finger). When the
    // user adds a second finger for pinch-zoom, that pointerdown also
    // reaches this handler — if we called startPan(e) again, its
    // e.preventDefault() would block useGesture from recognising the
    // second touch and pinch would silently fail. isPrimary is true
    // only for the first active touch in a sequence; subsequent fingers
    // bail and useGesture's pinch / two-finger pan handler takes over.
    if (e.pointerType === 'touch') {
      if (e.isPrimary) startPan(e);
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
          .map((_, index) => {
            const att = arrowAttachments[index];
            if (!att?.from || !att?.to) return null;
            const s = att.from.point, e = att.to.point;
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
    // Demo-tier viewer on someone else's board: every Add/Paste/Background
    // mutator is RLS-blocked. Replace the menu with one honest CTA rather
    // than stranding the user on actions that silently no-op. Select all
    // is read-only-safe so we keep it for power users.
    if (boardPermission?.source === 'tier-demoted') {
      return [
        { id: 'upgrade-edit',
          label: 'Upgrade to edit shared boards →',
          run: () => onRequestUpgrade?.() },
        { divider: true },
        { id: 'selectall', label: 'Select all', shortcut: `${cmdKey}A`, run: selectAll },
      ];
    }
    // Other view-only states (legitimate viewer share, no access) — no
    // paid upgrade path; just expose the safe read-only actions.
    if (!canEdit) {
      return [
        { id: 'selectall', label: 'Select all', shortcut: `${cmdKey}A`, run: selectAll },
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
        const embed = detectEmbed(url);
        let title = url;
        try { title = new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, ''); } catch (_) {}
        const newId = `link-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
        const w = embed ? embed.defaultW : 280;
        const h = embed ? embed.defaultH : 110;
        const card = {
          id: newId,
          kind: 'link', source: url, link: url, title,
          x: Math.max(8, Math.round(pos.x - w / 2)),
          y: Math.max(8, Math.round(pos.y - h / 2)),
          w, h,
        };
        if (embed) card.embed = embed;
        mutators.addCard?.(card);
        // Fire-and-forget OG fetch — when it resolves, patch the card
        // with the preview fields and grow it to fit the image. Skip
        // OG enrichment for embeds since the iframe is the preview.
        if (!embed) {
          fetchLinkPreview(url).then(p => {
            if (!p) return;
            const patch = {};
            if (p.title) patch.title = p.title;
            if (p.image) patch.image = p.image;
            if (p.description) patch.description = p.description;
            if (p.favicon) patch.favicon = p.favicon;
            if (p.image) { patch.w = 280; patch.h = 290; }
            if (Object.keys(patch).length) mutators.updateCard?.(newId, patch);
          });
        }
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
      { id: 'export', label: 'Export', submenu: [
        { id: 'export-png', label: 'PNG image', run: async () => {
          setExportSvgMounted(true);
          try {
            // Two RAFs: first commits the mount, second guarantees the
            // <svg> is in the DOM before we read it.
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            const svg = exportSvgRef.current?.querySelector?.('svg');
            if (!svg) { feedback.toast({ type: 'error', message: 'Nothing to export.' }); return; }
            await exportBoardAsPng(svg, board?.name || 'board');
          }
          catch (err) { feedback.toast({ type: 'error', message: 'Export failed: ' + (err.message || err) }); }
          finally { setExportSvgMounted(false); }
        }},
        { id: 'export-pdf', label: 'PDF (Save from Print)', run: async () => {
          setExportSvgMounted(true);
          try {
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            const svg = exportSvgRef.current?.querySelector?.('svg');
            if (!svg) { feedback.toast({ type: 'error', message: 'Nothing to export.' }); return; }
            exportBoardAsPdf(svg, board?.name || 'board');
          }
          catch (err) { feedback.toast({ type: 'error', message: 'Export failed: ' + (err.message || err) }); }
          finally { setExportSvgMounted(false); }
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
  //
  // 3s settle (up from 1.5s) since the kill-the-bill rework: even
  // with the LLM removed from the hot path, we don't need to score
  // every 1.5s during a typing burst — the embed call is the
  // remaining cost (cached after first hit, but still a network
  // round-trip when content changes).
  useEffect(() => {
    if (!autotagReady || !workspaceId || !board?.id) return;
    if (autotagPendingRef.current) return; // already scheduled
    if (autotagInFlightRef.current) return; // currently scoring
    autotagPendingRef.current = true;
    autotagTimerRef.current = setTimeout(runAutotagScoring, 3000);
  });
  useEffect(() => () => clearTimeout(autotagTimerRef.current), []);

  // ── Comments ───────────────────────────────────────────────────────────
  // Live anywhere-comments. Bubbles render anchored to cards / groups /
  // empty-canvas points; a right-click menu item shows an inline draft
  // input (no popup) at the click position.
  const { comments, removeLocally: removeCommentLocally, removeByAnchorIds: removeCommentsByAnchorIds,
          viewsByRootId: commentViewsByRootId, markViewed: markCommentViewed } = useCanvasComments(board?.id);
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
    if (isEditorTarget(e)) return;
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
    // Double-click an art canvas → re-open it in the fullscreen
    // SketchPad with its existing strokes loaded for editing.
    if (c.kind === 'art') {
      e.stopPropagation();
      setSketchpadEditId(c.id);
      setSketchpadOpen(true);
      return;
    }
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
  // Memoized so the common (no-marquee) case returns a constant null and
  // doesn't allocate a Set per render of the canvas.
  const marqueePreviewIds = useMemo(() => {
    if (!marquee) return null;
    const _t0 = perf.isEnabled() ? performance.now() : 0;
    const minX = Math.min(marquee.x0, marquee.x1);
    const maxX = Math.max(marquee.x0, marquee.x1);
    const minY = Math.min(marquee.y0, marquee.y1);
    const maxY = Math.max(marquee.y0, marquee.y1);
    if (Math.abs(maxX - minX) < 3 && Math.abs(maxY - minY) < 3) return null;
    const out = new Set();
    for (const c of (cards || [])) {
      if (c.x < maxX && c.x + c.w > minX && c.y < maxY && c.y + c.h > minY) out.add(c.id);
    }
    if (_t0) perf.mark('marquee.ms', performance.now() - _t0);
    return out;
  }, [marquee, cards]);

  const renderCard = (c) => {
    const inDrag = drag && drag.ids.includes(c.id);
    const dragDelta = inDrag ? drag : null;
    const resizeDelta = (resize && resize.id === c.id) ? resize : null;
    // If a peer is currently dragging this card, override (x, y) with their
    // awareness-reported live position so we see the card move in realtime.
    // Local drag still wins (we never read peer position for our own drag).
    const peerDrag = !inDrag ? peerDrags[c.id] : null;
    // Multi-resize live override — while the user is dragging a handle
    // on the SelectionBoundsOverlay, every affected card gets a live
    // (x,y,w,h) from the active drag instead of its committed values.
    const multiLive = multiResize?.live?.get?.(c.id) || null;
    const x = multiLive ? multiLive.x : (peerDrag ? peerDrag.x : (c.x + (dragDelta?.dx || 0)));
    const y = multiLive ? multiLive.y : (peerDrag ? peerDrag.y : (c.y + (dragDelta?.dy || 0)));
    const w = multiLive ? Math.max(MIN_W, multiLive.w) : Math.max(MIN_W, c.w + (resizeDelta?.dw || 0));
    const h = multiLive ? Math.max(MIN_H, multiLive.h) : Math.max(MIN_H, c.h + (resizeDelta?.dh || 0));
    const isArrowSource = arrowRefEquals(arrowFrom, c.id);
    const isSelected = selected.has(c.id)
      || (marqueePreviewIds && marqueePreviewIds.has(c.id))
      || isArrowSource;
    const rotation = (rotateState && rotateState.id === c.id ? rotateState.rot : c.rotation) || 0;
    const canRotate = ROTATABLE.has(c.kind);

    // Stacking is driven entirely by DOM order — `sortedCards` is already
    // sorted by `c.z` (see useMemo above). Setting a CSS z-index here was
    // active harm: a negative `c.z` (after Send to Back) became `z-index: -1`,
    // pulling the card behind its stacking context and out of pointer reach.
    const wrapperStyle = {
      position: 'absolute', left: x, top: y, width: w, height: h,
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
    // While the user is dragging cards over a board target, fade the
    // dragged cards so they don't obscure the destination. The
    // is-dragging class is added by `inDrag` above.
    const isFadingForBoardDrop = inDrag && !!boardDropTarget;
    // For board-pointing cards, hover-warm the target snapshot so a
    // click opens against an already-fetched cache.
    const hoverPrefetchTarget = c.kind === 'board' ? c.id
      : (c.kind === 'boardlink' ? c.target : null);
    const onCardMouseEnter = hoverPrefetchTarget
      ? () => scheduleHoverPrefetch(hoverPrefetchTarget)
      : undefined;
    const wrapper = {
      style: isTagDropHover
        ? { ...wrapperStyle, '--tag-drop-color': tagDropTarget.color }
        : wrapperStyle,
      className: `card ${kindCls} ${isSelected ? 'is-selected' : ''} ${inDrag ? 'is-dragging' : ''} ${isArrowSource ? 'is-arrow-source' : ''}${isTagDropHover ? ' is-tag-drop' : ''}${isLinkTarget ? ' is-link-target' : ''}${isBoardDropTarget ? ' is-card-drop-target' : ''}${isFadingForBoardDrop ? ' is-fading-for-drop' : ''}`,
      'data-card-id': c.id,
      onPointerDown: (e) => onCardPointerDown(e, c),
      onContextMenu: (e) => onCardContextMenu(e, c),
      onDoubleClick: (e) => onCardDoubleClick(e, c),
      onMouseEnter: onCardMouseEnter,
      onMouseLeave: hoverPrefetchTarget ? cancelHoverPrefetch : undefined,
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
      // Reuse a singleton empty array so BoardCard's memo doesn't bust
      // every render for boards with no peers (the common case): a fresh
      // `|| []` would change reference identity and defeat the memo.
      const peersHere  = peersHereByBoard?.get?.(c.id)  || EMPTY_PEERS_ARR;
      const peersBelow = peersBelowByBoard?.get?.(c.id) || EMPTY_PEERS_ARR;
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
    } else if (c.kind === 'image')   inner = <ImageCard src={c.src || localImagePreview[c.id] || null} tone={c.tone} label={c.label} title={c.title} link={c.link} aspect={`${c.w}/${c.h}`} w={Math.round(c.w)} h={Math.round(c.h)} caption={c.caption} onUpdate={onUpdate} autoFocus={af}
                                                     editTitleAt={editFieldSignal.id === c.id && editFieldSignal.field === 'title' ? editFieldSignal.n : 0}
                                                     editCaptionAt={editFieldSignal.id === c.id && editFieldSignal.field === 'caption' ? editFieldSignal.n : 0}
                                                     pending={!!c.pending}
                                                     uploadProgress={uploadProgressById[c.id] ?? null}
                                                     onExpand={() => setLightbox({ src: c.src, title: c.title || c.label || '', alt: c.title || c.label || '' })}
                                                     onAfterEdit={() => { setSelected(new Set()); clearAutoFocus?.(); }} />;
    else if (c.kind === 'note')      inner = <NoteCard body={c.body} html={c.html} bgColor={c.bgColor} textColor={c.textColor} fontFamily={c.fontFamily} fontSize={c.fontSize} onUpdate={onUpdate} autoFocus={af}
                                                manuallyResized={!!c.manuallyResized}
                                                awareness={getAwareness?.() || null}
                                                cardId={c.id} boardId={board.id}
                                                peerLiveHtml={peerNoteEdits[c.id] ?? null}
                                                onEditingChange={(editing) => setEditingNoteId(editing ? c.id : (prev => (prev === c.id ? null : prev)))} />;
    else if (c.kind === 'link')      inner = <LinkCard title={c.title} source={c.source} target={c.target}
                                                       image={c.image} description={c.description} favicon={c.favicon}
                                                       embed={c.embed}
                                                       isSelected={isSelected}
                                                       onUpdate={onUpdate} autoFocus={af}
                                                       editTitleAt={editFieldSignal.id === c.id && editFieldSignal.field === 'title' ? editFieldSignal.n : 0} />;
    else if (c.kind === 'palette')   inner = <PaletteCard title={c.title} swatches={c.swatches} hideHex={c.hideHex} hideLabels={c.hideLabels} chipsOnly={c.chipsOnly} onUpdate={onUpdate} autoFocus={af} />;
    else if (c.kind === 'video')     inner = <VideoCard src={c.src} title={c.title} onUpdate={onUpdate} autoFocus={af} />;
    else if (c.kind === 'audio')     inner = <AudioCard src={c.src} title={c.title} duration={c.duration} cover={c.cover}
                                                        onUpdate={onUpdate} autoFocus={af}
                                                        coverPickAt={editFieldSignal.id === c.id && editFieldSignal.field === 'audioCover' ? editFieldSignal.n : 0}
                                                        onPickCover={(file) => pickAudioCover(c.id, file)} />;
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
    else if (c.kind === 'art')       inner = <ArtCanvasCard bg={c.bg || '#ffffff'} />;
    else inner = <div className="card-unknown">{c.kind}</div>;

    // Tag chips along the card's bottom edge so the user actually sees
    // their tagging — without this, "Tag…" silently writes to the DB
    // and the user has no feedback that anything happened.
    const cardTags = tagsByCard?.get?.(c.id) || [];
    return (
      <div key={c.id} {...wrapper}>
        {inner}
        <CardStrokesOverlay strokes={c.strokes} w={w} h={h} />
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
        {selectedTool === 'select' && !(effectiveSelectedIds.size > 1 && effectiveSelectedIds.has(c.id)) && (
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
        // Optimistic 320x240 placeholder; patch to natural dims once the
        // browser has loaded the image (cap at 1200 along longer axis).
        const id = `image-${Date.now()}`;
        const fallbackW = 320, fallbackH = 240;
        mutators.addCard?.({
          id,
          kind: 'image', src: url,
          x: Math.max(8, Math.round(cx - fallbackW / 2)),
          y: Math.max(8, Math.round(cy - fallbackH / 2)),
          w: fallbackW, h: fallbackH,
        });
        try {
          const probe = new Image();
          probe.onload = () => {
            let w = probe.naturalWidth, h = probe.naturalHeight;
            if (!w || !h) return;
            const MAX_DIM = 1200;
            const MIN_DIM = 80;
            if (w > MAX_DIM || h > MAX_DIM) {
              const k = MAX_DIM / Math.max(w, h);
              w = Math.round(w * k);
              h = Math.round(h * k);
            }
            if (w < MIN_DIM || h < MIN_DIM) {
              const k = MIN_DIM / Math.min(w, h);
              w = Math.round(w * k);
              h = Math.round(h * k);
            }
            mutators.updateCard?.(id, {
              w, h,
              x: Math.max(8, Math.round(cx - w / 2)),
              y: Math.max(8, Math.round(cy - h / 2)),
            });
          };
          probe.src = url;
        } catch (_) {}
        return;
      }
      const embed = detectEmbed(url);
      const w = embed ? embed.defaultW : 280;
      const h = embed ? embed.defaultH : 130;
      const newId = `link-${Date.now()}`;
      let initialTitle = url;
      try { initialTitle = new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, ''); } catch (_) {}
      const dropCard = {
        id: newId,
        kind: 'link', source: url, link: url, title: initialTitle,
        x: Math.max(8, Math.round(cx - w / 2)),
        y: Math.max(8, Math.round(cy - h / 2)),
        w, h,
      };
      if (embed) dropCard.embed = embed;
      mutators.addCard?.(dropCard);
      if (embed) return;
      fetchLinkPreview(url).then(p => {
        if (!p) return;
        const patch = {};
        if (p.title) patch.title = p.title;
        if (p.image) patch.image = p.image;
        if (p.description) patch.description = p.description;
        if (p.favicon) patch.favicon = p.favicon;
        if (p.image) { patch.w = 280; patch.h = 290; }
        if (Object.keys(patch).length) mutators.updateCard?.(newId, patch);
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
      // Pre-drop safety snapshot. Fire-and-forget; never block the actual drop.
      if (ydoc && board?.id) {
        saveBoardVersion(board.id, ydoc, {
          triggerKind: 'pre-drop',
          sessionId,
          userId,
          label: 'pre-drop',
          opSummary: {
            action: 'drag-in-single',
            from_board: payload.sourceBoardId || null,
            card_count: 1,
          },
        });
      }
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

    // Files (images / videos / audio dragged from Finder).
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      e.preventDefault();
      const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
      const videoFiles = Array.from(files).filter(f => f.type.startsWith('video/'));
      const audioFiles = Array.from(files).filter(f => f.type.startsWith('audio/'));
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
      for (const f of audioFiles) {
        try {
          await dropAudioFile(f, cx + offsetX, cy);
          offsetX += 380;
        } catch (err) {
          console.error(err);
          feedback.toast({ type: 'error', message: 'Audio upload failed: ' + (err.message || err) });
        }
      }
    }
  };

  // Listen for "card was moved out of this canvas" events so we can delete
  // the source after a successful cross-pane move.
  useEffect(() => {
    const onTransferred = (e) => {
      const { sourceBoardId, cardIds, cardId } = e.detail || {};
      if (sourceBoardId !== board.id) return;
      const idList = Array.isArray(cardIds)
        ? cardIds
        : (cardId ? [cardId] : []);
      if (idList.length === 0) return;
      // GUARD: refuse to delete IDs that aren't in our recent-drag allowlist.
      // This is the defense-in-depth against the catastrophic-drag bug where
      // a malformed cardIds payload could nuke the entire source board.
      const allowed = recentDragRef.current;
      const bogus = idList.filter((id) => !allowed.has(id));
      if (bogus.length > 0) {
        console.error('[soleil-card-transferred] refused: ids outside recent drag', {
          bogus, boardId: board.id, dragSize: allowed.size,
        });
        return;
      }
      // Pre-drop snapshot for the SOURCE board too (this side loses cards).
      if (ydoc && board?.id) {
        saveBoardVersion(board.id, ydoc, {
          triggerKind: 'pre-drop',
          sessionId,
          userId,
          label: 'pre-drop-source',
          opSummary: {
            action: 'drag-out',
            card_count: idList.length,
          },
        });
      }
      mutators.deleteCards?.(idList);
    };
    document.addEventListener('soleil-card-transferred', onTransferred);
    return () => document.removeEventListener('soleil-card-transferred', onTransferred);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.id, mutators, ydoc, sessionId, userId]);

  // Touch sibling of the HTML5 onDrop(BOARD_REF_MIME) flow. Fired from
  // SidebarBoardTree when the user touch-drags a board row over a
  // canvas-wrap and releases. We mirror the same addCard call the
  // mouse onDrop does — just sourced from a CustomEvent so the
  // sidebar's pointer-events DnD can reach us without HTML5 DnD
  // (which doesn't fire on touch).
  useEffect(() => {
    const onTouchBoardDrop = (e) => {
      const { boardId, clientX, clientY, targetBoardId } = e.detail || {};
      if (!boardId) return;
      if (targetBoardId && targetBoardId !== board.id) return; // not us
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return;
      const { x: cx, y: cy } = clientToCanvas(clientX, clientY);
      const w = 280, h = 220;
      mutators.addCard?.({
        id: boardId, kind: 'board',
        x: Math.max(8, Math.round(cx - w / 2)),
        y: Math.max(8, Math.round(cy - h / 2)),
        w, h,
      });
    };
    document.addEventListener('soleil-touch-board-drop', onTouchBoardDrop);
    return () => document.removeEventListener('soleil-touch-board-drop', onTouchBoardDrop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      // Pre-drop safety snapshot: capture the target board BEFORE we mutate it,
      // and the source board's state too (via its own canvas) before the
      // soleil-card-transferred event nukes the originals. Fire-and-forget.
      if (ydoc && board?.id) {
        saveBoardVersion(board.id, ydoc, {
          triggerKind: 'pre-drop',
          sessionId,
          userId,
          label: 'pre-drop',
          opSummary: {
            action: 'drag-in-multi',
            from_board: sourceBoardId || null,
            card_count: payload.length,
          },
        });
      }
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
    { id: 'select', title: 'Select / move (V)', label: 'Select tool', icon: MousePointer2 },
    { id: 'pan',    title: 'Pan canvas (H or Space)', label: 'Pan tool', icon: Hand },
    { id: 'text',   title: 'Add note', label: 'Add note tool', icon: NotePencil },
    { id: 'image',  title: 'Add image', label: 'Add image tool', icon: ImageIcon },
    { id: 'shape',  title: 'Add shape', label: 'Add shape tool', icon: Square },
    { id: 'draw',   title: 'Free-draw', label: 'Free-draw tool', icon: Scribble },
    { id: 'arrow',  title: 'Arrow - click 2 cards, or drag on empty canvas', label: 'Arrow tool', icon: ArrowRight },
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
         onDragStart={(e) => e.preventDefault()}
         onPointerDown={onBackgroundPointerDown}
         onContextMenu={onBackgroundContextMenu}>
      <ReadOnlyBanner boardPermission={boardPermission} onRequestUpgrade={onRequestUpgrade} />
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
      <div ref={canvasRef}
           className={`canvas ${smoothXform ? 'is-smooth' : ''}`}
           style={{
             // transform is set imperatively (see applyCanvasTransform +
             // the useLayoutEffect above) so 120Hz wheel/pinch updates
             // don't go through React reconciliation. Initial mount: the
             // layout effect fires sync before paint, so first frame has
             // the correct transform.
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
              const groupRef = { type: 'group', id: g.id };
              const isArrowGroupSource = arrowRefEquals(arrowFrom, groupRef);
              const labelEl = (g.name && !g.options?.hideLabel) ? (
                <div className={`group-label${isArrowGroupSource ? ' is-arrow-source' : ''}`}
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
                       cursor: selectedTool === 'arrow' ? 'crosshair' : 'context-menu',
                       whiteSpace: 'nowrap',
                     }}
                     title={selectedTool === 'arrow'
                       ? `${g.name} — click to ${arrowFrom ? 'connect to' : 'start an arrow from'} this group`
                       : `${g.name} — right-click for group actions`}
                     onPointerDown={selectedTool === 'arrow' ? (e) => {
                       if (e.button !== 0) return;
                       e.stopPropagation();
                       e.preventDefault();
                       if (!arrowFrom) setArrowFrom(groupRef);
                       else {
                         if (!arrowRefEquals(arrowFrom, groupRef)) {
                           mutators.addArrow?.(arrowFrom, groupRef, arrowOptions);
                           setSelectedTool('select');
                         }
                         setArrowFrom(null);
                       }
                     } : undefined}
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
        {/* Viewport culling: only render cards inside the visibleIds set,
            plus always-render exceptions for active interactions whose
            unmount would break behavior (drag in flight, note being
            edited would lose focus, active resize/multi-resize, the
            selection target, and the card whose context menu is open).
            When visibleIds is null (pre-measurement) we render everything. */}
        <div className="cards-layer">{(() => {
          if (visibleIds == null) return sortedCards.map(renderCard);
          const dragIds = drag?.ids;
          const mrLive = multiResize?.live;
          const resizeId = resize?.id;
          const ctxCardId = ctx.open ? ctx.cardId : null;
          return sortedCards.filter(c => {
            if (visibleIds.has(c.id)) return true;
            if (selected.has(c.id)) return true;
            if (dragIds && dragIds.includes(c.id)) return true;
            if (editingNoteId === c.id) return true;
            if (resizeId === c.id) return true;
            if (mrLive && mrLive.has && mrLive.has(c.id)) return true;
            if (ctxCardId === c.id) return true;
            return false;
          }).map(renderCard);
        })()}</div>

        {/* Multi-selection resize — a single bottom-right corner handle
            matching the per-card resize affordance, but operating on
            the bounding box of every selected card. Drag to uniformly
            scale the whole selection (Shift to free-stretch). */}
        {selectedTool === 'select' && multiSelectionBounds && (() => {
          // While dragging, derive bounds from multiResize.live so the
          // handle tracks the live (in-progress) rect.
          let bounds = multiSelectionBounds;
          if (multiResize?.live) {
            const liveItems = [];
            for (const [, lv] of multiResize.live) liveItems.push(lv);
            const b = boundsOfCards(liveItems);
            if (b) bounds = b;
          }
          const items = (cards || []).filter(c => effectiveSelectedIds.has(c.id));
          const startBounds = multiResize?.startBounds || multiSelectionBounds;
          return (
            <div className="card-resize multi-resize"
                 onPointerDown={(e) => onMultiResizePointerDown(e, 'br', items, startBounds)}
                 style={{
                   position: 'absolute',
                   left: bounds.x + bounds.w - RESIZE_HANDLE_PX / 2,
                   top:  bounds.y + bounds.h - RESIZE_HANDLE_PX / 2,
                   width: RESIZE_HANDLE_PX,
                   height: RESIZE_HANDLE_PX,
                   zIndex: 999996,
                   pointerEvents: 'auto',
                 }} />
          );
        })()}

        {/* Snap-alignment guidelines — gold hairlines along the matched
            edge / center / dimension while a drag is snapping.
            Rendered off `displayedHints` (a delayed-unmount mirror of
            `snapHints`) so the SVG can fade out for ~140ms after the
            drag releases instead of vanishing instantly. The
            `is-visible` class is keyed off live `snapHints`. */}
        {displayedHints && (displayedHints.xs?.length || displayedHints.ys?.length || displayedHints.spacings?.length) && (
          <svg className={`snap-guides ${snapHints ? 'is-visible' : ''}`}
               width={VIRTUAL_CANVAS_PX} height={VIRTUAL_CANVAS_PX}
               style={{ position: 'absolute', left: 0, top: 0,
                        pointerEvents: 'none', overflow: 'visible',
                        zIndex: 999997 }}>
            {/* Edge / center alignment + numeric-match guides. Each
                line is anchored by tiny dots at the card-edge endpoints
                so the line reads as a relationship, not a ruler. The
                stroke extends a soft 4px past the dots for breathing
                room. Optional `label` floats just outside the cap. */}
            {(displayedHints.xs || []).map((g, i) => {
              const overshoot = 4 / zoom;
              const dotR = 2 / zoom;
              return (
                <Fragment key={`gx-${i}`}>
                  <line x1={g.x} x2={g.x} y1={g.y0 - overshoot} y2={g.y1 + overshoot}
                        stroke="var(--soleil)"
                        strokeOpacity="0.55"
                        strokeWidth={1 / zoom}
                        vectorEffect="non-scaling-stroke" />
                  <circle cx={g.x} cy={g.y0} r={dotR} fill="var(--soleil)" fillOpacity="0.7" />
                  <circle cx={g.x} cy={g.y1} r={dotR} fill="var(--soleil)" fillOpacity="0.7" />
                  {g.label && (
                    <text x={g.x + 8 / zoom} y={(g.y0 + g.y1) / 2}
                          fill="var(--soleil)"
                          fontSize={10 / zoom}
                          fontFamily="ui-monospace, monospace"
                          textAnchor="start"
                          dominantBaseline="middle"
                          opacity="0.85"
                          style={{ paintOrder: 'stroke', stroke: 'var(--bg-0)', strokeWidth: 3 / zoom }}>
                      {g.label}
                    </text>
                  )}
                </Fragment>
              );
            })}
            {(displayedHints.ys || []).map((g, i) => {
              const overshoot = 4 / zoom;
              const dotR = 2 / zoom;
              return (
                <Fragment key={`gy-${i}`}>
                  <line y1={g.y} y2={g.y} x1={g.x0 - overshoot} x2={g.x1 + overshoot}
                        stroke="var(--soleil)"
                        strokeOpacity="0.55"
                        strokeWidth={1 / zoom}
                        vectorEffect="non-scaling-stroke" />
                  <circle cx={g.x0} cy={g.y} r={dotR} fill="var(--soleil)" fillOpacity="0.7" />
                  <circle cx={g.x1} cy={g.y} r={dotR} fill="var(--soleil)" fillOpacity="0.7" />
                  {g.label && (
                    <text x={(g.x0 + g.x1) / 2} y={g.y + 12 / zoom}
                          fill="var(--soleil)"
                          fontSize={10 / zoom}
                          fontFamily="ui-monospace, monospace"
                          textAnchor="middle"
                          dominantBaseline="hanging"
                          opacity="0.85"
                          style={{ paintOrder: 'stroke', stroke: 'var(--bg-0)', strokeWidth: 3 / zoom }}>
                      {g.label}
                    </text>
                  )}
                </Fragment>
              );
            })}
            {/* Equal-spacing markers — drawn between paired neighbours
                with tiny end caps + a label so the user sees "I matched
                a 24px gap that already existed". */}
            {(displayedHints.spacings || []).map((s, i) => {
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

        {activeShape && activeShape.kind === 'line' && (
          // Line preview drawn directly from drag-start to drag-current
          // so the on-screen preview matches the line that will be
          // committed (preserving the user's drag direction).
          <svg className="shape-preview" width={VIRTUAL_CANVAS_PX} height={VIRTUAL_CANVAS_PX}
               style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', overflow: 'visible' }}>
            <line x1={activeShape.from.x} y1={activeShape.from.y}
                  x2={activeShape.to.x}   y2={activeShape.to.y}
                  stroke={shapeOptions.stroke || '#f5f5f6'}
                  strokeWidth={Math.max(0.5, shapeOptions.strokeWidth || 2)}
                  strokeDasharray={shapeOptions.dash === 'dashed' ? '6,4'
                                  : shapeOptions.dash === 'dotted' ? '2,3'
                                  : undefined}
                  strokeLinecap="round" />
          </svg>
        )}
        {activeShape && activeShape.kind !== 'line' && (
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
              const att = arrowAttachments[i];
              if (!att?.from || !att?.to) return null;
              // Keep the arrow's anchor cards (or group members) in the
              // obstacle set but with a 1px pad so the bezier can attach
              // at the edge while the body still can't sweep back across
              // its own card. All other cards keep the geometry helper's
              // default OBSTACLE_PAD.
              const anchorIds = new Set();
              const ef = excludedCardIdsForRef(a.from);
              const et = excludedCardIdsForRef(a.to);
              if (ef) ef.forEach(id => anchorIds.add(id));
              if (et) et.forEach(id => anchorIds.add(id));
              const obstacles = a.straight ? null
                : arrowObstacleRects.map(r =>
                    anchorIds.has(r.id) ? { ...r, pad: 1 } : r);
              const built = buildArrowPath({ from: att.from, to: att.to, style: { straight: !!a.straight }, obstacles });
              if (!built) return null;
              const { path, fromTangentIn, toTangentIn } = built;
              // Lines created via the Shape tool override the arrow's
              // palette/thickness tokens with raw values so the user's
              // chosen color, stroke width, and dash style apply directly.
              const stroke = a.customStroke || arrowColor(a.color);
              const sw = (typeof a.customStrokeWidth === 'number' && a.customStrokeWidth >= 0)
                ? Math.max(0.5, a.customStrokeWidth)
                : arrowStrokeWidth(a.thickness);
              const hd = arrowHeadSize(a.thickness);
              const headStyle = arrowHeadStyle(a);
              const showForwardHead = headStyle !== 'none';
              const showReverseHead = headStyle === 'double';
              const headForward = showForwardHead ? arrowHeadPolygon(att.to.point, toTangentIn, hd) : null;
              const headReverse = showReverseHead ? arrowHeadPolygon(att.from.point, fromTangentIn, hd) : null;
              // Dash pattern: customDash from shape-line ('dashed' / 'dotted'),
              // legacy a.dashed boolean, or solid.
              let dashArray = '0';
              if (a.customDash === 'dashed') dashArray = `${sw * 4} ${sw * 3}`;
              else if (a.customDash === 'dotted') dashArray = `${sw * 1} ${sw * 2}`;
              else if (a.dashed) dashArray = `${sw * 4} ${sw * 3}`;
              const sel = selectedArrows.has(i);
              const pathId = `${arrowPathIdPrefix}${i}`;
              return (
                <g key={i} data-arrow-idx={i}>
                  {/* Hit target — only path with pointer-events; svg root is none. */}
                  <path d={path} fill="none" stroke="transparent" strokeWidth={Math.max(14, sw + 12)}
                        pointerEvents={strokesInteractive ? 'stroke' : 'none'}
                        style={{ cursor: strokesInteractive ? 'move' : 'default' }}
                        onPointerDown={strokesInteractive ? (ev) => onArrowBodyPointerDown(ev, i) : undefined}
                        onContextMenu={strokesInteractive ? (ev) => onArrowContextMenu(ev, i) : undefined} />
                  {sel && <path d={path} fill="none" stroke="rgba(245,158,11,.55)"
                                strokeWidth={sw + 5} strokeLinecap="round" pointerEvents="none" />}
                  <path id={pathId} data-arrow-line d={path} fill="none" stroke={stroke} strokeWidth={sw}
                        strokeDasharray={dashArray}
                        strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />
                  {headForward && <polygon points={headForward} fill={stroke} pointerEvents="none" />}
                  {headReverse && <polygon points={headReverse} fill={stroke} pointerEvents="none" />}
                  {a.label && (
                    <text className="arrow-label-text" fill={stroke} pointerEvents="none" dy="-4">
                      <textPath href={`#${pathId}`} startOffset="50%" textAnchor="middle" side="left">
                        {a.label}
                      </textPath>
                    </text>
                  )}
                </g>
              );
            })}
            {activeFreeArrow && (() => {
              const s = activeFreeArrow.from, e = activeFreeArrow.to;
              const path = `M${s.x},${s.y} L${e.x},${e.y}`;
              return <path d={path} stroke="rgba(245,158,11,.8)" strokeWidth="1.5" strokeDasharray="4 3" fill="none" pointerEvents="none" />;
            })()}
            {/* Endpoint handles for the selected arrow. Only render when
                exactly one arrow is selected so the handles aren't a mess
                across multi-select. Drag either end to retarget. */}
            {canEdit && selectedArrows.size === 1 && (() => {
              const idx = [...selectedArrows][0];
              const a = arrows?.[idx];
              const att = arrowAttachments[idx];
              if (!a || !att?.from || !att?.to) return null;
              const HANDLE_R = 6 / zoom;
              // Snap distance in canvas units (12px on screen at any zoom).
              const SNAP_DIST = 12 / zoom;
              // Collect snap targets: other arrows' endpoints + card corners.
              // Recomputed inside the handler so it's a fresh capture each drag.
              const collectSnapTargets = () => {
                const targets = [];
                // Other arrows' endpoints (both ends of every arrow except this one).
                (arrows || []).forEach((other, j) => {
                  if (j === idx) return;
                  const oAtt = arrowAttachments[j];
                  if (oAtt?.from?.point) targets.push({ x: oAtt.from.point.x, y: oAtt.from.point.y });
                  if (oAtt?.to?.point)   targets.push({ x: oAtt.to.point.x,   y: oAtt.to.point.y });
                });
                // Card corners.
                (cards || []).forEach(c => {
                  targets.push({ x: c.x,         y: c.y });
                  targets.push({ x: c.x + c.w,   y: c.y });
                  targets.push({ x: c.x,         y: c.y + c.h });
                  targets.push({ x: c.x + c.w,   y: c.y + c.h });
                });
                return targets;
              };
              const onHandleDown = (which) => (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                // Double-click detection: a second pointerdown on the
                // same endpoint within 350ms spawns a NEW line/arrow
                // from that endpoint with the source's exact style.
                // Lets the user "branch" / continue from an existing
                // line without redoing color/width/dash each time.
                const now = Date.now();
                const prev = lastEndpointClickRef.current;
                if (prev.time && now - prev.time < 350 && prev.idx === idx && prev.which === which) {
                  lastEndpointClickRef.current = { time: 0, idx: -1, which: null };
                  // Anchor at the existing endpoint's canvas-space position.
                  const anchorPt = which === 'from' ? att.from.point : att.to.point;
                  const offsetX = 80 / zoom;
                  const newFrom = { x: Math.round(anchorPt.x), y: Math.round(anchorPt.y) };
                  const newTo   = { x: Math.round(anchorPt.x + offsetX), y: Math.round(anchorPt.y) };
                  const opts = {
                    straight: !!a.straight,
                    head: a.head ?? 'single',
                  };
                  if (a.color != null) opts.color = a.color;
                  if (a.thickness != null) opts.thickness = a.thickness;
                  if (a.customStroke != null) opts.customStroke = a.customStroke;
                  if (a.customStrokeWidth != null) opts.customStrokeWidth = a.customStrokeWidth;
                  if (a.customDash != null) opts.customDash = a.customDash;
                  if (a.dashed) opts.dashed = a.dashed;
                  const newIdx = (arrows || []).length;
                  mutators.addFreeArrow?.(newFrom, newTo, opts);
                  setSelectedArrows(new Set([newIdx]));
                  setSelected(new Set());
                  setSelectedStrokes(new Set());
                  return;
                }
                lastEndpointClickRef.current = { time: now, idx, which };
                const snapTargets = collectSnapTargets();
                const onMove = (mv) => {
                  const canvas = clientToCanvas(mv.clientX, mv.clientY);
                  // 1) Card snap: pointer hovering a card → anchor the
                  //    endpoint to that card (the existing behavior).
                  const overEl = document.elementFromPoint(mv.clientX, mv.clientY);
                  const cardEl = overEl?.closest?.('[data-card-id]');
                  const cardId = cardEl?.getAttribute?.('data-card-id');
                  if (cardId) {
                    mutators.updateArrow?.(idx, which === 'from' ? { from: cardId } : { to: cardId });
                    return;
                  }
                  // 2) Point snap: nearest other endpoint or card corner
                  //    within SNAP_DIST takes priority over the raw
                  //    pointer position. Lets the user connect line
                  //    endpoints to other lines / shape corners.
                  let best = null;
                  let bestD = SNAP_DIST;
                  for (const t of snapTargets) {
                    const d = Math.hypot(t.x - canvas.x, t.y - canvas.y);
                    if (d < bestD) { bestD = d; best = t; }
                  }
                  const next = best
                    ? { x: Math.round(best.x), y: Math.round(best.y) }
                    : { x: Math.round(canvas.x), y: Math.round(canvas.y) };
                  mutators.updateArrow?.(idx, which === 'from' ? { from: next } : { to: next });
                };
                const onUp = () => {
                  window.removeEventListener('pointermove', onMove);
                  window.removeEventListener('pointerup', onUp);
                };
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
              };
              return (
                <Fragment>
                  <circle cx={att.from.point.x} cy={att.from.point.y} r={HANDLE_R}
                          fill="#fff" stroke="rgba(245,158,11,.95)" strokeWidth={1.5 / zoom}
                          pointerEvents="all"
                          style={{ cursor: 'grab' }}
                          onPointerDown={onHandleDown('from')} />
                  <circle cx={att.to.point.x} cy={att.to.point.y} r={HANDLE_R}
                          fill="#fff" stroke="rgba(245,158,11,.95)" strokeWidth={1.5 / zoom}
                          pointerEvents="all"
                          style={{ cursor: 'grab' }}
                          onPointerDown={onHandleDown('to')} />
                </Fragment>
              );
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
          {/* Selected-stroke transform overlay: bbox + corner handles for
              moving / uniform-scaling the selected strokes. Lives inside
              the strokes-layer SVG so it shares the canvas transform. */}
          {canEdit && selectedStrokes.size > 0 && (() => {
            const sel = [...selectedStrokes].map(i => (strokes || [])[i]).filter(Boolean);
            if (sel.length === 0) return null;
            // Union bbox of all selected strokes.
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const s of sel) {
              for (const [x, y] of (s.points || [])) {
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
              }
            }
            if (!isFinite(minX)) return null;
            const w = Math.max(2, maxX - minX);
            const h = Math.max(2, maxY - minY);
            const handleR = 6 / zoom;
            const strokeW = 1 / zoom;
            const onBodyDown = (ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              const startC = clientToCanvas(ev.clientX, ev.clientY);
              const startPoints = sel.map(s => s.points.map(p => [p[0], p[1]]));
              const selIndexes = [...selectedStrokes];
              let last = startC;
              const onMove = (mv) => {
                last = clientToCanvas(mv.clientX, mv.clientY);
                const dx = last.x - startC.x, dy = last.y - startC.y;
                const next = (strokes || []).slice();
                for (let k = 0; k < selIndexes.length; k++) {
                  const idx = selIndexes[k];
                  const orig = startPoints[k];
                  next[idx] = { ...next[idx], points: orig.map(p => [p[0] + dx, p[1] + dy]) };
                }
                mutators.replaceStrokes?.(next);
              };
              const onUp = () => {
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
              };
              window.addEventListener('pointermove', onMove);
              window.addEventListener('pointerup', onUp);
            };
            const onHandleDown = (which) => (ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              const startC = clientToCanvas(ev.clientX, ev.clientY);
              const startPoints = sel.map(s => s.points.map(p => [p[0], p[1]]));
              const selIndexes = [...selectedStrokes];
              // Anchor = the OPPOSITE corner of the dragged handle.
              const ax = (which === 'nw' || which === 'sw') ? (minX + w) : minX;
              const ay = (which === 'nw' || which === 'ne') ? (minY + h) : minY;
              const startD = { dx: startC.x - ax, dy: startC.y - ay };
              const onMove = (mv) => {
                const cur = clientToCanvas(mv.clientX, mv.clientY);
                const newDx = cur.x - ax, newDy = cur.y - ay;
                // Uniform scale: use the larger absolute ratio so the
                // selection stays in lockstep along both axes.
                const sx = startD.dx === 0 ? 1 : newDx / startD.dx;
                const sy = startD.dy === 0 ? 1 : newDy / startD.dy;
                const sNoSign = Math.max(0.05, Math.max(Math.abs(sx), Math.abs(sy)));
                // Keep sign so the user can flip the selection by dragging past the anchor.
                const sFinal = sNoSign * (Math.sign(sx) || 1) * (Math.sign(sy) || 1);
                const next = (strokes || []).slice();
                for (let k = 0; k < selIndexes.length; k++) {
                  const idx = selIndexes[k];
                  const orig = startPoints[k];
                  next[idx] = {
                    ...next[idx],
                    points: orig.map(p => [
                      ax + (p[0] - ax) * sFinal,
                      ay + (p[1] - ay) * sFinal,
                    ]),
                  };
                }
                mutators.replaceStrokes?.(next);
              };
              const onUp = () => {
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
              };
              window.addEventListener('pointermove', onMove);
              window.addEventListener('pointerup', onUp);
            };
            return (
              <Fragment>
                <rect x={minX} y={minY} width={w} height={h}
                      fill="rgba(245,158,11,0.04)"
                      stroke="rgba(245,158,11,.6)"
                      strokeWidth={strokeW}
                      strokeDasharray={`${4 / zoom} ${3 / zoom}`}
                      pointerEvents="all"
                      style={{ cursor: 'grab' }}
                      onPointerDown={onBodyDown} />
                {[
                  ['nw', minX,         minY],
                  ['ne', minX + w,     minY],
                  ['se', minX + w,     minY + h],
                  ['sw', minX,         minY + h],
                ].map(([k, x, y]) => (
                  <circle key={k} cx={x} cy={y} r={handleR}
                          fill="#fff"
                          stroke="rgba(245,158,11,.95)"
                          strokeWidth={1.5 / zoom}
                          pointerEvents="all"
                          style={{ cursor: 'nwse-resize' }}
                          onPointerDown={onHandleDown(k)} />
                ))}
              </Fragment>
            );
          })()}
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
          viewsByRootId={commentViewsByRootId}
          onMarkViewed={markCommentViewed}
        />

      </div>

      {/* Inline arrow-editor popover — shown when exactly one arrow is
          selected. Lives in screen-space (position:fixed) so it doesn't
          scale with the canvas transform. Lines (arrows with
          head:'none' created via the Shape tool) use the bottom
          ToolOptionsBar instead; suppress this popover for them so
          the user doesn't see two editors with different controls. */}
      {canEdit && selectedArrows.size === 1 && (() => {
        const idx = [...selectedArrows][0];
        const a = (arrows || [])[idx];
        const att = arrowAttachments[idx];
        if (!a || !att?.from || !att?.to) return null;
        if (a.head === 'none') return null;
        const excludeFrom = excludedCardIdsForRef(a.from);
        const excludeTo   = excludedCardIdsForRef(a.to);
        const excludeSet = new Set();
        if (excludeFrom) for (const id of excludeFrom) excludeSet.add(id);
        if (excludeTo)   for (const id of excludeTo)   excludeSet.add(id);
        const obstacles = a.straight ? null
          : arrowObstacleRects.filter(r => !excludeSet.has(r.id));
        const built = buildArrowPath({ from: att.from, to: att.to, style: { straight: !!a.straight }, obstacles });
        if (!built) return null;
        return (
          <ArrowPopover
            arrow={a}
            arrowIndex={idx}
            midPoint={built.midPoint}
            canvasToViewport={canvasToViewport}
            onChange={(patch) => mutators.updateArrow?.(idx, patch)}
            onDelete={() => {
              mutators.deleteArrows?.([idx]);
              setSelectedArrows(new Set());
            }}
            onClose={() => setSelectedArrows(new Set())}
            onOpenColorPicker={(currentColor) => {
              const rect = wrapRef.current?.getBoundingClientRect();
              setPicker({
                value: (typeof currentColor === 'string' && currentColor.startsWith('#'))
                  ? currentColor : '#3b82f6',
                onChange: (col) => mutators.updateArrow?.(idx, { color: col }),
                x: rect ? rect.right - 280 : 200,
                y: rect ? rect.top + 60 : 200,
                allowTransparent: false,
              });
            }}
          />
        );
      })()}

      {/* Off-screen BoardThumbnail used as the source SVG for PNG/PDF
          exports. Sized 0×0 + visibility:hidden so it stays in the DOM
          (so the export refs can read it) without affecting layout.
          Mounted on demand only — see exportSvgMounted above. */}
      <div ref={exportSvgRef}
           style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden',
                    visibility: 'hidden', pointerEvents: 'none' }}>
        {exportSvgMounted && (
          <BoardThumbnail cards={cards} strokes={strokes} boards={boards} />
        )}
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
            <Icon as={Plus} size={20} />
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
            <Icon as={t.icon} size={20} />
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
        <input
          className="cnv-zoom-slider"
          type="range"
          min="0" max="1000" step="1"
          // log scale: 0..1000 → ZOOM_MIN..ZOOM_MAX
          value={Math.round(1000 * Math.log(zoom / ZOOM_MIN) / Math.log(ZOOM_MAX / ZOOM_MIN))}
          onInput={(e) => {
            const v = Number(e.target.value) / 1000;
            const z = ZOOM_MIN * Math.pow(ZOOM_MAX / ZOOM_MIN, v);
            const el = wrapRef.current;
            if (!el) { setZoom(z); return; }
            // Keep the centre point of the viewport stable while sliding.
            const rect = el.getBoundingClientRect();
            const cx = (rect.width / 2 - pan.x) / zoom;
            const cy = (rect.height / 2 - pan.y) / zoom;
            const newPanX = rect.width / 2 - cx * z;
            const newPanY = rect.height / 2 - cy * z;
            setZoom(z);
            setPan({ x: newPanX, y: newPanY });
          }}
          title="Drag to zoom"
        />
        <span className="cnv-zoom-val"
              title="Click: 100% · Double-click: Full Board"
              onClick={() => { enableSmoothTransform(); setZoom(1); setPan({ x: 40, y: 60 }); }}
              onDoubleClick={() => { enableSmoothTransform(); fitToContent(); }}>
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
        onOpenSketchpad={() => setSketchpadOpen(true)}
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
        editingLineArrow={(() => {
          // One selected arrow with head:'none' is a "line" — surface
          // it to the toolbar so the user can adjust color/width/dash
          // AND type a precise angle.
          if (selectedArrows.size !== 1 || selected.size > 0) return null;
          const idx = [...selectedArrows][0];
          const a = (arrows || [])[idx];
          if (!a || a.head !== 'none') return null;
          const fromIsFree = a.from && typeof a.from === 'object' && !a.from.cardId && !a.from.id;
          const toIsFree   = a.to   && typeof a.to   === 'object' && !a.to.cardId   && !a.to.id;
          if (!fromIsFree || !toIsFree) return null;
          return { idx, arrow: a };
        })()}
        onUpdateEditingLineArrow={(patch) => {
          if (selectedArrows.size !== 1) return;
          const idx = [...selectedArrows][0];
          mutators.updateArrow?.(idx, patch);
        }}
        paletteColors={paletteColors}
        openColorPicker={(opts) => setPicker(opts)}
        onUndo={() => mutators.undo?.()}
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
        <ImageLightbox src={lightbox.src} title={lightbox.title} alt={lightbox.alt}
                       onClose={() => setLightbox(null)} />
      )}
      {boardDropTarget && boardDropHoverPos && (() => {
        const target = boards?.[boardDropTarget];
        const tname = target?.name || 'this board';
        const count = drag?.ids?.length || 0;
        const left = Math.min(window.innerWidth - 240, boardDropHoverPos.x + 18);
        const top  = Math.min(window.innerHeight - 60, boardDropHoverPos.y + 18);
        return (
          <div className="board-drop-label"
               style={{ position: 'fixed', left, top, zIndex: 2147483646, pointerEvents: 'none' }}>
            <span className="board-drop-label-arrow">↳</span>
            <span className="board-drop-label-text">
              Drop into <b>{tname}</b>
              {count > 1 && <span className="board-drop-label-count"> · {count} cards</span>}
            </span>
          </div>
        );
      })()}
      <SketchPadOverlay
        open={sketchpadOpen}
        onClose={() => { setSketchpadOpen(false); setSketchpadEditId(null); }}
        editingCard={sketchpadEditId ? cardById[sketchpadEditId] : null}
        onCommitStrokes={(payload) => {
          // Backwards-compat: older shape was a bare strokes array.
          const strokes = Array.isArray(payload) ? payload : (payload?.strokes || []);
          const bg = Array.isArray(payload) ? '#ffffff' : (payload?.bg || '#ffffff');
          const editingId = Array.isArray(payload) ? null : (payload?.editingId || null);
          const canvasW = (Array.isArray(payload) ? null : payload?.canvasW) || 480;
          const canvasH = (Array.isArray(payload) ? null : payload?.canvasH) || 360;
          // Editing an existing canvas — write strokes (already in
          // card-local coords because that's how SketchPad loaded them)
          // and the bg back, then leave the card selected so the user
          // can keep drawing on it inline.
          if (editingId) {
            mutators.updateCard?.(editingId, { strokes, bg });
            setSelected(new Set([editingId]));
            setSelectedStrokes(new Set());
            setSelectedArrows(new Set());
            setSelectedTool('select');
            return;
          }
          if (!strokes.length && bg === '#ffffff') return;
          // The pad and the card share one coordinate system: strokes
          // are already in canvasW × canvasH space, so the card just
          // takes those exact dimensions. Whatever the user drew at
          // (cx, cy) in the pad lives at (cx, cy) on the card —
          // including the bg, which fills the entire card surface.
          const cardW = canvasW;
          const cardH = canvasH;
          const wrap = wrapRef.current;
          const r = wrap?.getBoundingClientRect?.() || { width: 800, height: 600 };
          const vCx = (-pan.x + r.width  / 2) / zoom;
          const vCy = (-pan.y + r.height / 2) / zoom;
          const cardX = Math.round(vCx - cardW / 2);
          const cardY = Math.round(vCy - cardH / 2);
          const localStrokes = strokes;
          const newId = `art-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
          mutators.addCard?.({
            id: newId,
            kind: 'art',
            x: cardX, y: cardY, w: cardW, h: cardH,
            bg, strokes: localStrokes,
          });
          // Stash the freshly-created card so pickStrokeTarget can find
          // it during the few ms before the Yjs subscription updates
          // `cards` for this component. Cleared by the cards effect
          // once the card actually appears in the snapshot.
          pendingCardRef.current = {
            id: newId,
            kind: 'art',
            x: cardX, y: cardY, w: cardW, h: cardH,
            bg, strokes: localStrokes,
          };
          // Drop the user back on the board with the new canvas selected
          // and the select tool active so they can move/resize/inspect
          // the just-placed canvas. Selection markers (resize / rotate
          // handles, soleil outline) only render in select mode.
          setSelected(new Set([newId]));
          setSelectedStrokes(new Set());
          setSelectedArrows(new Set());
          setSelectedTool('select');
        }} />
    </div>
  );
}

// ── CardStrokesOverlay ──────────────────────────────────────────────────
// Renders a card's `strokes` array as an SVG layer bounded to the card's
// box. Mounted on every card so any card type can carry annotations —
// the draw tool routes strokes here when a single card is selected.
// Memoized: props are all primitive / stable-by-card-identity, so default
// shallow compare lets unchanged cards skip the path-string concat.
const CardStrokesOverlay = memo(function CardStrokesOverlay({ strokes, w, h }) {
  if (!Array.isArray(strokes) || strokes.length === 0) return null;
  const vw = Math.max(1, w || 1);
  const vh = Math.max(1, h || 1);
  return (
    <svg className="card-strokes-overlay"
         viewBox={`0 0 ${vw} ${vh}`} width="100%" height="100%"
         preserveAspectRatio="none"
         style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
      {strokes.map((s, i) => {
        const pts = s.points || [];
        if (pts.length === 0) return null;
        let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
        for (let k = 1; k < pts.length; k++) d += ` L${pts[k][0].toFixed(1)},${pts[k][1].toFixed(1)}`;
        return <path key={i} d={d} fill="none"
                     stroke={s.color || '#0a0a0c'}
                     strokeWidth={s.width || 3}
                     strokeLinecap="round" strokeLinejoin="round" />;
      })}
    </svg>
  );
});

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
