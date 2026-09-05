import { memo, useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, Fragment, Suspense } from 'react';
import * as perf from '../lib/perf.js';
import { setPerfContext, clearPerfContext, markGestureActiveUntil, bumpPerf } from '../lib/perfReport.js';
import { setCanvasScale, emitCanvasSettle } from '../lib/canvasScale.js';
import { spatialOrder } from '../lib/gridSequence.js';
import { isItemKey as isSchedItemKey, slotOfItem as schedSlotOfItem, mintItemKey as mintSchedItemKey, newUid as schedUid, parseSlotKey as schedParseSlotKey } from '../lib/schedLayout.js';
import { todayISO as schedTodayISO } from '../lib/schedDates.js';
import { scheduleCreationAllowed } from '../lib/appHost.js';

// Live expand map for a schedule card — Yjs gridMeta when present, else the
// local shell's plain card.gridMeta.
function schedExpandOf(card, ydoc) {
  const mm = ydoc?.getMap?.('cards')?.get?.(card.id)?.get?.('gridMeta');
  if (mm && typeof mm.get === 'function') return mm.get('expand') || {};
  return card?.gridMeta?.expand || {};
}
import { isEditableTarget, isEditablePointerTarget } from '../lib/isEditableTarget.js';
import { setActivePane, getActivePane } from '../lib/activePane.js';
import { anyModalOpen } from '../lib/modalGuard.js';
import { getDocUndoTarget } from '../lib/overlayRouting.js';
import { undoToast } from '../lib/undoToast.js';
import { tapIsDouble } from '../lib/doubleTap.js';
import {
  BoardCard, BoardLinkCard, ImageCard, NoteCard, LinkCard,
  PaletteCard, DocCard, ScheduleCard as ScheduleTableCard, ShapeCard, VideoCard, AudioCard, ArtCanvasCard, PdfCard, FileCard, GridCard,
} from './cards.jsx';
import { ScheduleCard } from './cards/ScheduleCard.jsx';
import { RichDocCard } from './DocCard.jsx';
import { Spinner } from './Spinner.jsx';
import { lazyWithReload } from '../lib/lazyWithReload.js';

// Fullscreen PDF viewer — lazy so pdfjs-dist never enters the main bundle.
const PdfViewer = lazyWithReload(() => import('./PdfViewer.jsx'));

// Reuse ShapeCard as our drag-preview renderer.
const ShapePreview = ShapeCard;
import { LiveCursor, COVER_TINTS } from './primitives.jsx';
import { CanvasPresence } from './CanvasPresence.jsx';
import { PresenceStack } from './PresenceStack.jsx';
import { CardContextMenu } from './CardContextMenu.jsx';
import { EditableText } from './EditableText.jsx';
import { SketchPadOverlay } from './SketchPadOverlay.jsx';
import { BackgroundContextMenu } from './BackgroundContextMenu.jsx';
import { ToolOptionsBar } from './ToolOptionsBar.jsx';
import { ColorPicker } from './ColorPicker.jsx';
import { useFeedback } from './AppFeedback.jsx';
import {
  Eye, EyeOff, MessageCircle,
  MousePointer2, Hand, NotePencil, Image as ImageIcon, Scribble, ArrowRight, Plus, Question,
  Paperclip, FileText, Square, Palette, Link, ListChecks, Upload, Clapperboard, GridFour, GridNine, Browsers, ArrowSquareOut,
  Calendar as CalendarPh, X,
} from '../lib/icons.js';
import { Icon } from './Icon.jsx';
import { useDismissOnOutside } from '../hooks/useDismissOnOutside.js';
import { Sheet } from './shell/Sheet.jsx';
import { sanitizeLayout } from '../lib/gridLayout.js';
import { GridTemplatePanel } from './GridTemplatePanel.jsx';
import { SaveTemplateDialog } from './SaveTemplateDialog.jsx';
import { mergeSections, rowsFromRecords, bodyFromGrid, sanitizeHints, sanitizeSize, SOURCES } from '../lib/gridLayoutLibrary.js';
import { layoutById } from '../lib/templateLayouts.js';
import { TemplateAddedPrompt } from './TemplateAddedPrompt.jsx';
// The shipped store catalogue, so the panel sells the same fifteen templates
// /templates does. A light index — names, preset ids and labels, never prose.
import { TEMPLATE_CARDS } from '../lib/templateCards.js';
import { useGridLayouts } from '../hooks/useGridLayouts.js';
import {
  saveGridLayout, renameGridLayout, setGridLayoutScope,
  deleteGridLayout, restoreGridLayout, createGridLayoutLink,
  publishGridLayout, unpublishGridLayout,
} from '../lib/gridLayoutsApi.js';
import { useBreakpoint } from '../hooks/useBreakpoint.js';
import { TEAMMATES } from '../data.js';
import { INBOX_MIME, BOARD_REF_MIME, BOARD_REF_LIST_MIME, CARD_TRANSFER_MIME, ENTITY_REF_MIME, ENTITY_REF_LIST_MIME, readBoardRefIds, inboxItemToCard } from '../lib/dragMimes.js';
import { wouldCreateCycle } from '../lib/boardTree.js';
import { coerceRef } from '../lib/entityRef.js';
import { uploadImage, uploadVideo, uploadAudio, uploadPdf, uploadFile, readVideoMeta, readAudioMeta, makeBoundedPreview, captureAndUploadPoster } from '../lib/uploads.js';
import { makeLimiter } from '../lib/asyncPool.js';
import { lowMemoryDevice } from '../lib/device.js';
import { trackStroke, coalescedOf } from '../lib/pointerStroke.js';
import { eraseStrokes, eraseOnCard, appendStrokeToCard, readCardStrokes, strokeInPolygon } from '../lib/strokeModel.js';
import { notePointerType, pointerCanDraw } from '../lib/pointerPolicy.js';
import { toPathD, polylinePathD, isFilledPath, strokeOpacity, strokeLineCap } from '../lib/strokeRender.js';
import { DEFAULT_BRUSH } from '../lib/strokeModel.js';
import { findTouchScrollable, driveTouchScroll, startTouchScrollGesture } from '../lib/touchScroll.js';
import { resolveSrc } from '../lib/r2.js';
import { scheduleBoardPreviewBackfill, drainVariantQueue } from '../lib/previewBackfill.js';
import { loadCorsCleanImage } from '../lib/corsImage.js';
import { R2Image } from './R2Image.jsx';
import { downloadImage } from '../lib/imageExport.js';
import { ImageAdjustFilters } from './ImageAdjustFilters.jsx';
import { ImageEditPopover } from './ImageEditPopover.jsx';
import { ImageEditModal } from './ImageEditModal.jsx';
import { ImageLightbox } from './ImageLightbox.jsx';
import { ThumbnailCropModal } from './ThumbnailCropModal.jsx';
import { composeMenuSections, SECTION } from '../lib/contextMenuSections.js';
import { setClipboard, getClipboard, clipboardSize, clipboardOrigin, clipboardWasCut, hasRecentInternalCopy, matchesSentinel, looksLikeSentinel } from '../lib/clipboard.js';
import { logEvent, logEventOnce } from '../lib/analytics.js';
import { EV, JOURNEY_PHASE } from '../lib/analyticsEvents.js';
import { getWheelMode, resolveWheelIntent } from '../lib/wheelMode.js';
import { wheelHintSeen, markWheelHintSeen, trackWheelFrustration, freshWheelState } from '../lib/wheelHint.js';
import { genuineCards, hasGenuineCard } from '../lib/firstValueTrigger.js';
import { shouldShowDepthDock } from '../lib/depthDock.js';
import { shouldPromptMix } from '../lib/mixPrompt.js';
import { claimUpsellSlot, UPSELL_STACK_WINDOW_MS } from '../lib/upsellSlot.js';
import { momentumHintSeen, markMomentumHintSeen } from '../lib/momentumHint.js';
import { setJourneyState } from '../lib/journey.js';
import { ShowcaseBanner } from './ShowcaseBanner.jsx';
import { isShowcaseCard } from '../lib/onboardingStarter.js';
import { recordIntent } from '../lib/frictionSignal.js';
import { useGesture } from '@use-gesture/react';
import { useLongPress } from '../hooks/useLongPress.js';
import { prefetchBoard } from '../lib/prefetchKinds.js';
import * as Y from 'yjs';
import { supabase } from '../lib/supabase.js';
import { addRecentColor } from '../lib/recentColors.js';
import { loadBoardView, saveBoardView, clearBoardView,
         markViewRestoreInFlight, viewRestoreCrashed, clearViewRestoreInFlight } from '../lib/boardViewState.js';
import { fetchLinkPreview } from '../lib/linkPreview.js';
import { detectEmbed } from '../lib/oembed.js';
import { relativeTimeShort } from '../lib/relativeTime.js';
import { exportBoardAsPng, exportBoardAsPdf, svgToPngBlob } from '../lib/exportBoard.js';
import { BoardThumbnail } from './BoardThumbnail.jsx';
import { CanvasCommentLayer, CommentArchivePopover } from './CanvasComment.jsx';
import { useCanvasComments } from '../hooks/useCanvasComments.js';
import { CanvasVoteLayer } from './CanvasVoteCard.jsx';
import { useVoteCards } from '../hooks/useVoteCards.js';
import { addVoteCard } from '../lib/voteCardsApi.js';
import * as userProfiles from '../lib/userProfiles.js';
import { addComment, updateComment, unhideAllOnBoard } from '../lib/commentsApi.js';
import { pickCommentOffset, pickCommentOffsetForGroup } from '../lib/commentPlacement.js';
import { TagPicker } from './TagPicker.jsx';
import { useWorkspaceTags } from '../hooks/useWorkspaceTags.js';
import { useWorkspacePalettes } from '../hooks/useWorkspacePalettes.js';
import { ensureTag, tagCard, untagCard, tagBoard, untagBoard, tagGroup, untagGroup, confirmAppliedTag, dismissAutotagSuggestion, undismissAutotagSuggestion } from '../lib/tagsApi.js';
import { syncCardIndex, saveBoardVersion, loadBoardVersionDoc, bulletproofRestore } from '../lib/boardsApi.js';
import {
  computeArrowAttachments, buildArrowPath, arrowHeadPolygon,
  arrowStrokeWidth, arrowHeadSize, arrowColor, arrowHeadStyle, arrowRefEquals, uprightLabelAngle,
} from '../lib/arrowGeometry.js';
import {
  SNAP_TUNING, worldViewportRect, buildSnapTargets, buildResizeTargets,
  computeSnap as computeSnapPure, computeResizeSnap as computeResizeSnapPure,
} from '../lib/snapGuides.js';
import { boundsOfCards, oppositeCorner, clampDropRect } from '../lib/canvasGeom.js';
import { classifyDropFile, sizeBucket, fitImageDims } from '../lib/fileIngest.js';
import { layoutDrop, rearrange, alignCards, distributeCards } from '../lib/layoutEngine.js';
import { cursorIntervalForPeerCount, shouldBroadcastOwnCursor } from '../lib/presenceTuning.js';
import { createNoteMeasurer, NOTE_INNER_PAD } from '../lib/noteMeasure.js';
import { ArrowPopover } from './ArrowPopover.jsx';

// Empty-board headline rotator — cycles a few accurate, breadth-signaling nouns
// ("Start your moodboard / script / shot list…") to hint the app's full range
// without a wall of options. Honors prefers-reduced-motion (→ static first word).
// Each swap is keyed so the CSS fade (cnvRotatingWordIn) re-triggers.
const BREADTH_WORDS = ['moodboard', 'script', 'shot list', 'lookbook', 'asset board'];

// The empty-board tile row, beneath the Image hero. Hoisted out of the JSX so
// empty_board_shown reports a count that cannot drift from what's rendered.
const EMPTY_TILES = [
  { id: 'grid',   label: 'Grid',     icon: GridFour },
  { id: 'script', label: 'Script',   icon: Clapperboard },
  { id: 'board',  label: 'Cluster',  icon: Browsers },
  { id: 'note',   label: 'Note',     icon: NotePencil },
  { id: 'doc',    label: 'Doc',      icon: FileText },
  { id: 'file',   label: 'Any file', icon: Upload },
];
function RotatingWord({ words = BREADTH_WORDS, intervalMs = 2000 }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    let reduce = false;
    try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) {}
    if (reduce || words.length < 2) return undefined;
    const t = setInterval(() => setI((n) => (n + 1) % words.length), intervalMs);
    return () => clearInterval(t);
  }, [words, intervalMs]);
  return <span key={words[i]} className="cnv-rotating-word">{words[i]}</span>;
}

const RESIZE_HANDLE_PX = 14;
const MIN_W = 60, MIN_H = 40;
const ZOOM_MIN = 0.1, ZOOM_MAX = 5.0;
// Mobile press-and-hold to pick up a card. On touch a one-finger drag PANS
// the board (looking around); a card only becomes movable after holding it
// still this long. Mirrors the existing useLongPress timing (480ms / 10px).
const TOUCH_LIFT_MS = 480;
const TOUCH_LIFT_TOLERANCE = 10;
// First-run discoverability for press-and-hold-to-lift: the first time a touch
// user's drag-from-a-card resolves to a pan (so the card DIDN'T move), we show
// a one-time toast explaining the hold. Device-local (localStorage) is the
// right scope for a touch hint and sidesteps any onboarding-settings write — a
// default of "seen" on any read failure means we err toward NOT nagging.
const LIFT_HINT_KEY = 'soleil.liftHintSeen';
function liftHintSeen() {
  try { return localStorage.getItem(LIFT_HINT_KEY) === '1'; } catch (_) { return true; }
}
function markLiftHintSeen() {
  try { localStorage.setItem(LIFT_HINT_KEY, '1'); } catch (_) {}
}
// GPU-promotion of the .canvas layer is GREAT for smooth pan/zoom — but it
// FORCES every overlapping descendant (all mounted cards + the virtual-canvas
// SVG layers) to be composited into its own GPU layer ("Overlap" compositing).
// At normal zoom the viewport cull keeps only a handful of cards mounted, so
// that cascade is small. But at fit-all (~0.11 on a wide board) ALL cards mount
// at once → dozens of native-size card layers + a 100000²-px stroke layer → a
// multi-hundred-MB backing store that a memory-constrained GPU can't hold, so
// it evicts sibling layers (toolbars vanish), tears tiles (background) and
// thrashes textures (images flicker). So we DE-promote the canvas below a zoom
// threshold (no will-change, plain 2D translate) — the whole board collapses
// back to ~one root layer, painted at the small displayed scale. Hysteresis
// (off below LO, on above HI) so a zoom that lingers at the boundary can't flap
// the layerization.
const CANVAS_PROMOTE_OFF_BELOW = 0.30;
const CANVAS_PROMOTE_ON_ABOVE = 0.42;
// Viewport-px margin used when fitting content into the viewport. Full 80 on
// >640px screens; smaller on phones so a desktop-sized margin (160px of a ~390px
// screen) doesn't shrink the content to a tiny zoom. Keeps desktop/tablet framing
// unchanged.
const fitMargin = (r) => (r.width > 640 ? 80 : Math.max(16, Math.round(r.width * 0.05)));
// Below this canvas width a fit-everything open is a phone, not a desktop.
const NARROW_FIT_MAX_W = 640;
// How many cards a public board should span on a phone when fitting everything
// would open it too small to read. Expressed in CARDS, not zoom: a fixed zoom
// floor is meaningless because card sizes differ by an order of magnitude
// between boards — 0.5 shows two notes side by side (240pt) but a single
// cropped photo (800pt). Targeting a card count adapts to whatever this board
// is made of. ~2.4 leaves the focused card whole with its neighbours visible,
// so the opening view reads as a composition rather than a crop.
const NARROW_CARDS_ACROSS = 2.4;
// Never magnify past 1:1 — a board of small cards should not open zoomed in.
const NARROW_MAX_ZOOM = 1;
// …and only step in when fitting everything would render the median card
// narrower than this many screen pixels — i.e. when it is genuinely too small
// to make out. A board that already fits legibly keeps the centred
// see-everything view, which is the better opening shot when it's available.
const NARROW_MIN_CARD_PX = 90;
const DRAW_DEFAULT_COLOR = '#f5f5f6';
const DRAW_DEFAULT_WIDTH = 3;
const ERASER_DEFAULT_WIDTH = 16;
// The stroke/arrow/snap/shape SVGs are positioned at (0,0) in canvas space with
// NO viewBox and `overflow: visible`, so their child paths render at raw board
// coordinates regardless of the SVG element's own width/height. The element box
// used to be 100000×100000 — but an SVG that big forces its composited layer
// (when the canvas is GPU-promoted, every overlapping element is) to a 100000²
// backing store, ~40,000MP, which blows the GPU budget at fit-all. Since
// overflow is visible, the box only needs to be a 1px anchor: the layer bounds
// then collapse to the actual painted stroke/arrow extent. Rendering is
// byte-identical (paths still draw at their board coords).
const SVG_ANCHOR_PX = 1;
const STROKE_HIT_PADDING = 12; // invisible hit region added around each stroke

// Stroke path building, eraser splitting and the point/polyline distance math
// all live in lib/strokeModel.js + lib/strokeRender.js now — the board layer,
// the per-card overlay, the SketchPad and the thumbnail renderer all draw from
// that one implementation so they can never disagree about what a stroke looks
// like. `toPathD` is still memoized per stroke below (strokeGeom): it
// string-builds from every point and used to re-run for EVERY stroke on EVERY
// render.

// Module-level singleton — used as the "no peers on this card" default so
// BoardCard's memo doesn't bust from a fresh `|| []` allocation each render.
const EMPTY_PEERS_ARR = [];

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

// Bound how many optimistic image previews decode at once. Each decode holds a
// full-resolution bitmap transiently; a multi-file drop of 12MP/HEIC photos
// decoding all at once froze iOS Safari. 2 on memory-constrained clients, 4
// elsewhere — mirrors the backfillGate cap for the same reason.
const imageDecodeLimiter = makeLimiter(lowMemoryDevice() ? 2 : 4);

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || '');

// Per-user presence color, drawn from a muted cover palette. Stable per
// user id so the same person always shows up in the same color across
// sessions. Brand gold (#ffa500) is intentionally excluded — it's reserved
// for YOUR OWN selection ring so a peer's selection never reads as yours.
// Keep in lockstep with lib/presenceColor.js.
const PRESENCE_COLORS = ['#5b8def', '#6b8090', '#9a6b88', '#c9a577', '#6b9088', '#b88958'];
function pickPresenceColor(id) {
  if (!id) return PRESENCE_COLORS[0];
  let h = 0; for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return PRESENCE_COLORS[Math.abs(h) % PRESENCE_COLORS.length];
}
const cmdKey = isMac ? '⌘' : 'Ctrl';

// Shared canonical "is the user typing in an editor?" guard (see
// lib/isEditableTarget.js). Aliased to the historical name used throughout
// this file's keyboard / paste guards.
const isEditorTarget = isEditableTarget;
// The POINTER form. Clicks and double-clicks carry a real target, so they ask
// "did this land in an editor" — never "is the caret somewhere in an editor".
// Using the focus-aware guard here froze the canvas whenever a docked document
// held the caret: every click returned early and nothing opened.
const isEditorPointerTarget = isEditablePointerTarget;

// A snap-guide measurement readout (gap / equal-size) rendered as a small rounded
// "pill" inside the guide SVG layer — gold mono numerals on a dark chip with a
// soft gold border — so the readout matches the app's chip vocabulary instead of
// looking like bare ruler text. Sized from the monospace string length; every
// dimension is /zoom so it stays screen-constant. `guide-mark` opts it into the
// one-shot pop-in (see styles.css .snap-guides .guide-mark).
function GuideLabel({ cx, cy, text, zoom }) {
  const fs = 10 / zoom;
  const charW = 6.0 / zoom;            // monospace advance ≈ 0.6em
  const padX = 6 / zoom, padY = 3.5 / zoom;
  const w = String(text).length * charW + padX * 2;
  const h = fs + padY * 2;
  return (
    <g className="guide-mark">
      <rect x={cx - w / 2} y={cy - h / 2} width={w} height={h} rx={4 / zoom}
            fill="var(--bg-1)"
            stroke="color-mix(in srgb, var(--soleil) 42%, transparent)"
            strokeWidth={1 / zoom} vectorEffect="non-scaling-stroke" />
      <text x={cx} y={cy} fill="var(--soleil)"
            fontSize={fs} fontFamily="var(--font-mono, ui-monospace, monospace)"
            fontWeight="600" textAnchor="middle" dominantBaseline="central"
            style={{ fontVariantNumeric: 'tabular-nums' }}>
        {text}
      </text>
    </g>
  );
}

// Card kinds that can become grid-cell content when dragged onto a cell (see
// routeCardIntoCell). Anything else keeps dragging/repositioning normally.
const CELL_DROP_KINDS = new Set(['image', 'note', 'textlink', 'link', 'board', 'boardlink', 'video', 'file', 'pdf', 'grid', 'schedule']);

// Inline "make a grid" control shown below a selected Grid: type cols × rows and
// it replicates the Grid into a flush, connected matrix (the effortless path to a
// massive grid). Module-level so its input state survives canvas re-renders.
function GridMatrixControl({ onGenerate }) {
  const [cols, setCols] = useState('5');
  const [rows, setRows] = useState('5');
  const submit = () => {
    const c = Math.max(1, Math.min(50, parseInt(cols, 10) || 1));
    const r = Math.max(1, Math.min(50, parseInt(rows, 10) || 1));
    if (c * r <= 1) return;
    onGenerate(c, r);
  };
  const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } };
  return (
    <div className="grid-matrix-ctl" onPointerDown={(e) => e.stopPropagation()}>
      <input type="number" min="1" max="50" value={cols} aria-label="Columns"
        onChange={(e) => setCols(e.target.value)} onKeyDown={onKey} />
      <span className="gm-x">×</span>
      <input type="number" min="1" max="50" value={rows} aria-label="Rows"
        onChange={(e) => setRows(e.target.value)} onKeyDown={onKey} />
      <button type="button" onClick={submit}>Make grid</button>
    </div>
  );
}

export function CanvasSurface({
  board, boards, boardsReady = true, cards, arrows, strokes, groups = [],
  gridTemplates = {},      // id → { id, name, layout }  — shared Grid layouts
  gridSequences = {},      // id → { id, name, pattern, format } — sequence config
  ydoc, // raw Y.Doc — needed by doc cards to access their per-card YMap
  getAwareness,            // () => Awareness | null  — for live presence
  currentUser,             // { id, name, color }     — for awareness localState
  onOpenBoard, tweak, depth, onOpenPicker,
  // Doc-card dock handoff — passed straight through to RichDocCard. See its
  // `onDock` prop: the workspace hosts the docked doc so it survives
  // navigating to another cluster.
  onDockDoc = null, dockedDocCardId = null,
  // A template that just landed in the library (from /templates, a share link or
  // the public gallery) plus the way to let it go. The canvas owns the prompt
  // because placing is a canvas verb and pickTemplate already does exactly the
  // right thing with a row.
  justAddedTemplate = null, onDismissJustAdded = null,
  // Shoot days are dated CLUSTERS, so these write Postgres (set_board_schedule)
  // rather than the Y.Doc — they can't ride gridActions with the cell mutators.
  onSetSchedule = null, onAddShootDay = null,
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
  boardPermission = null,  // { role, canEdit, source } from useBoardPermission
  onRequestUpgrade = null, // () => void — opens App's UpgradeModal (fallback for storage upsell)
  onRequestStorageUpgrade = null, // () => void — opens the storage/files upgrade prompt
  isPaidPlan = false,      // current user on a paid/admin plan (best-effort client gate)
  ownsWorkspace = false,   // current user owns the active workspace (created_by)
  autotagSuggest,          // (content, target) => Promise<[{tagId,score,reason}]>
  autotagReady = false,    // worker hydration finished
  sessionId = null,        // per-tab session id for board_versions grouping
  defaults,                // useResolvedDefaults() output — drives initial
                           // tool options so a workspace's shape stroke/fill
                           // settings actually shape what gets drawn.
  isPublic = false,        // true → read-only public /share view: always
                           // fit-to-content on open, never persist view
                           // state, skip card-index sync, and suppress the
                           // heavy doc editor (the closed doc preview is fine).
  frictionStuck = false,   // true → a new user tripped the stuck signal
                           // (frictionSignal.js); brightens the empty-board
                           // hint as the passive escalation.
  firstCardPrompt = false, // onboarding_v2 arm B: surface the "Start your cluster"
                           // tiles even on a SEEDED (non-empty) root until the user
                           // places their own genuine card (the guided first-card flow).
  paneId = 'main',         // which pane this surface is ('main' | 'split') —
                           // arbitrates the window-level keyboard/paste
                           // listeners so a split view doesn't double-fire
                           // Cmd+Z (and C/X/V/D/A) on both boards at once.
  hasSplit = false,        // true while a split pane is open; the pane gate
                           // only applies then, so single-pane never depends
                           // on pointer history.
  autoFrame = true,        // false (LocalBoardsApp ?blank=1, tests) → don't auto-fit
                           // the viewport to content; keep zoom 1 so placement specs
                           // aren't thrown off by the empty→first-card fit (~3x).
  initialFrame = null,     // public only: {x,y,w,h} board-space rect to frame on
                           // mount instead of the all-cards bbox (PublicBoardView
                           // passes the top band at fit-to-width so tall boards
                           // open readable).
  showcaseArm = 'A',       // welcome_showcase experiment arm: 'B' → root was
                           // seeded with the brand demo; show the "Clear & try it
                           // yourself" banner while its cards are present.
  focusRequest = null,     // { boardId, ids:[], token } — after a list-view file
                           // drop, select + frame the newly-arranged cards once
                           // the user switches to canvas ("where did my files go?").
  clearFocusRequest = null,// () => void — consume the request after framing.
}) {
  perf.bump('cs.renderCount');
  const wrapRef = useRef(null);

  // Claim the global shortcut listeners for this pane. Follows the pointer
  // (enter or press) so in a split view Cmd+Z targets the board the cursor
  // is over — matching how every split-pane canvas tool behaves. The window
  // keydown/paste handlers below check getActivePane() while hasSplit.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const claim = () => setActivePane(paneId);
    el.addEventListener('pointerdown', claim, { capture: true });
    el.addEventListener('pointerenter', claim, { capture: true });
    return () => {
      el.removeEventListener('pointerdown', claim, { capture: true });
      el.removeEventListener('pointerenter', claim, { capture: true });
    };
  }, [paneId]);
  // Closing the split hands the shortcuts back to the main pane — otherwise
  // a split that closed while active would leave 'split' claimed forever and
  // dead-key the whole app.
  useEffect(() => {
    if (!hasSplit) setActivePane('main');
  }, [hasSplit]);

  // Force one syncCardIndex run when the board opens. card_index
  // only refreshes on yjs edits or tab-close, so a user who just
  // refreshes the page may sit on a stale snapshot indefinitely.
  // syncCardIndex is throttled + idempotent — calling it here is
  // free if it already ran recently, and ensures rich-note text
  // (c.html) gets html-stripped into card_index.body so the tag
  // detail view + suggestion engine see real content.
  useEffect(() => {
    if (isPublic) return; // public viewer is signed out — no Supabase writes
    if (!board?.id || !ydoc) return;
    syncCardIndex({ boardId: board.id, ydoc }).catch(() => {});
  }, [board?.id, ydoc, isPublic]);

  // Whole-board preview self-heal (writers only): any image card still
  // missing its Tier-1 preview gets variants generated a few seconds after
  // open (see lib/previewBackfill.js). The cleanup cancels the pending sweep
  // whenever cards change, so it effectively debounces until the board has
  // been quiet for the scheduler's delay — it never competes with first
  // paint or an active edit burst.
  useEffect(() => {
    if (!canEdit || isPublic || useLocalImages) return undefined;
    // Resume any uploads whose variant generation was interrupted (tab closed
    // mid-batch) — once per session, independent of which board this is.
    drainVariantQueue();
    const keys = cards
      .filter(c => c.kind === 'image' && typeof c.src === 'string' && c.src.startsWith('r2:'))
      .map(c => c.src.slice(3));
    return scheduleBoardPreviewBackfill({ boardId: board.id, keys });
  }, [board.id, cards, canEdit, isPublic, useLocalImages]);

  // Field jank telemetry context (lib/perfReport.js — always on, unlike the
  // perf.js HUD). Board identity + content scale, refreshed when they change;
  // zoom is refreshed at gesture-settle commits below. Cheap object merges.
  useEffect(() => {
    setPerfContext({
      boardId: board?.id || null,
      workspaceId: workspaceId || null,
      isPublic: !!isPublic,
      cardsTotal: cards.length,
      strokesCount: (strokes || []).length,
      arrowsCount: (arrows || []).length,
    });
    return () => clearPerfContext();
  }, [board?.id, workspaceId, isPublic, cards.length, strokes, arrows]);

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
  // Publish the canvas scale DURING render (idempotent module write), before
  // any image card renders, so first-paint tier selection (R2Image
  // pickInitialTier) sees the real zoom instead of the default 1.0. The
  // pan/zoom layout effect below also writes it — but that runs AFTER children
  // render, so a fit-all open used to decode the 1280px preview for every tiny
  // card. StrictMode double-invokes this harmlessly (same value).
  setCanvasScale(zoom);
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
  // Whether the canvas layer is currently GPU-promoted. Hysteresis-gated by
  // zoom (see CANVAS_PROMOTE_* above) so it doesn't flap at the boundary.
  const canvasPromotedRef = useRef(true);
  const applyCanvasTransform = () => {
    const el = canvasRef.current;
    if (!el) return;
    const z = zoomRef.current;
    let promoted = canvasPromotedRef.current;
    if (promoted && z <= CANVAS_PROMOTE_OFF_BELOW) promoted = false;
    else if (!promoted && z >= CANVAS_PROMOTE_ON_ABOVE) promoted = true;
    canvasPromotedRef.current = promoted;
    if (promoted) {
      // GPU-promoted: translateZ(0) keeps the layer promoted across transform
      // changes (Round 9's CSS `will-change` can be silently dropped when the
      // layer would exceed the max raster size; this imperative hint survives).
      // will-change is also set here because this assignment overwrites the
      // CSS-side declaration.
      el.style.transform = `translate3d(${panRef.current.x}px, ${panRef.current.y}px, 0) scale(${z})`;
      if (el.style.willChange !== 'transform') el.style.willChange = 'transform';
    } else {
      // De-promoted at fit-all: a plain 2D transform with NO will-change so the
      // canvas is NOT a compositing layer → its descendants stop being
      // overlap-composited → the 100000² SVG + dozens of card layers collapse
      // into the root layer, rastered at the small displayed scale. Pan
      // re-paints on the CPU, but at ~0.1 scale that region is cheap.
      el.style.transform = `translate(${panRef.current.x}px, ${panRef.current.y}px) scale(${z})`;
      if (el.style.willChange !== 'auto') el.style.willChange = 'auto';
    }
  };
  // ── Viewport culling state (D1) ──────────────────────────────────────────
  // visibleIds = Set of mounted card ids: everything inside the ADD band
  // (viewport ± 1 screen) plus previously-mounted cards still inside the
  // larger KEEP band (hysteresis — see the recompute below).
  // null sentinel means "render all" — used before the first measurement so
  // we don't ever show an empty board.
  // sortedCardsRef + wrapWHRef + visibleRafRef are read by the RAF-throttled
  // recompute below; refs keep the recompute function stable and let us
  // invoke it from gesture handlers without re-binding.
  const [visibleIds, setVisibleIds] = useState(null);
  const sortedCardsRef = useRef(null);
  const wrapWHRef = useRef({ w: 0, h: 0 });
  const visibleRafRef = useRef(0);
  // Active wheel/pinch/pan gesture deadline (performance.now() + ~200ms,
  // refreshed per event; 0 = settled). While a gesture is live the cull is
  // ADD-ONLY: the bands are world-space (vw = wrapW/z), so fast zoom-IN
  // shrinks them and would mass-unmount off-center cards each rAF — and the
  // matching zoom-OUT then REMOUNTS them, resetting R2ImageProgressive to
  // its blur tier (visible re-blur churn). The gesture-settle commits
  // (scheduleCommit / scheduleTouchPanCommit / startPan onUp) zero this and
  // run one strict recompute to prune. A timestamp (not a boolean) so a
  // cancel-terminated gesture self-heals on the next recompute.
  const gestureUntilRef = useRef(0);
  // Set by the visibleIds updater when it deferred prunes past REMOVE_CHUNK;
  // the drain effect below schedules follow-up passes until it stays false.
  const drainPendingRef = useRef(false);
  const _perfVisRef = useRef(-1);   // last cardsVisible pushed to perfReport
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
      // Canvas-space viewport bboxes, with hysteresis. ADD band: viewport
      // ± 1 viewport — cards entering it get mounted (no pop-in on pan).
      // KEEP band: viewport ± 1.5 viewports — already-mounted cards stay
      // until they leave it. Without the asymmetry, edge cards oscillate
      // across a single band and every modest pan/zoom unmounts
      // recently-visible cards — and an image card remount resets all of
      // R2ImageProgressive's state, replaying the blur-up from scratch.
      // KEEP is deliberately modest (was 2.5): everything mounted paints
      // into the single promoted .canvas layer, and at zoom-in those tiles
      // rasterize at device resolution — an oversized band blows Chrome's
      // tile budget and tiles get DROPPED (black background patches,
      // glitching backdrop-filter toolbars) until a scroll re-rasters.
      const vx = -px / z, vy = -py / z;
      const vw = wrapW / z, vh = wrapH / z;
      const minX = vx - vw, maxX = vx + 2 * vw;
      const minY = vy - vh, maxY = vy + 2 * vh;
      const KEEP = 1.5;
      const kMinX = vx - KEEP * vw, kMaxX = vx + (1 + KEEP) * vw;
      const kMinY = vy - KEEP * vh, kMaxY = vy + (1 + KEEP) * vh;
      const next = new Set();
      const keep = new Set();
      for (let i = 0; i < arr.length; i++) {
        const c = arr[i];
        if (c.x + c.w < kMinX || c.x > kMaxX) continue;
        if (c.y + c.h < kMinY || c.y > kMaxY) continue;
        keep.add(c.id);
        if (c.x + c.w < minX || c.x > maxX) continue;
        if (c.y + c.h < minY || c.y > maxY) continue;
        next.add(c.id);
      }
      // Skip the setState if the id set didn't change (common on pan
      // micro-movements that don't bring/take any card across the band).
      const gestureActive = performance.now() < gestureUntilRef.current;
      setVisibleIds(prev => {
        // Hysteresis: previously-mounted cards still inside KEEP stay
        // mounted, but never retain past MOUNT_CAP — on dense boards the
        // raster/texture cost of the extra mounts is exactly what drops
        // GPU tiles. The cap bounds only the hysteresis EXTRAS; the ADD
        // band (and the zoomed-out everything-in-view case) is unaffected.
        // During an ACTIVE gesture the keep-band requirement is waived
        // entirely (still capped): nothing unmounts mid-zoom/pan, so
        // visibleIds keeps its identity (zero re-renders) and zoom-out
        // never remounts what zoom-in would have dropped. The settle
        // commit runs one strict recompute to prune.
        // (Set.add is idempotent, so mutating `next` here is safe under
        // StrictMode's double-invoked updater.)
        const MOUNT_CAP = 300;
        // Settle prunes are CHUNKED: a deep zoom-in settle would otherwise
        // unmount nearly all of a dense board's cards in ONE React commit
        // (every card tears down image/observer state) — a 300-600ms burst
        // landing exactly when the gesture ends. At most REMOVE_CHUNK cards
        // actually unmount per pass; the rest stay mounted and the drain
        // effect schedules another pass after this one commits. MOUNT_CAP
        // still binds first — cap-driven drops stay immediate (bounding the
        // raster/texture cost is the cap's whole job).
        const REMOVE_CHUNK = 12;
        let removed = 0;
        if (prev) {
          for (const id of prev) {
            if (next.has(id)) continue;
            if (next.size >= MOUNT_CAP) break;
            if (gestureActive || keep.has(id)) { next.add(id); continue; }
            if (removed < REMOVE_CHUNK) { removed += 1; continue; }
            // Defer this prune: stays mounted for this pass. (Idempotent
            // writes — safe under StrictMode's double-invoked updater.)
            next.add(id);
            drainPendingRef.current = true;
          }
        }
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
    // Settled zoom only (mid-gesture zoom lives in the refs) — R2Image uses
    // this to translate a card's zoom-invariant layout width into on-screen
    // device pixels for image tier selection.
    setCanvasScale(zoom);
    applyCanvasTransform();
    scheduleVisibleRecompute();
  }, [pan.x, pan.y, zoom, scheduleVisibleRecompute]);
  // A deep zoom must not leak into the next surface's first image mounts.
  useEffect(() => () => setCanvasScale(1), []);
  // Drain deferred prunes: one follow-up recompute per commit until the
  // updater stops deferring. A deferring pass always changed the set (it
  // removed a full chunk first), so keying on visibleIds can't stall; a new
  // gesture flips the recompute to ADD-only (nothing removed, nothing
  // deferred), so drains cancel naturally mid-interaction.
  useEffect(() => {
    if (!drainPendingRef.current) return;
    drainPendingRef.current = false;
    bumpPerf('cull.drainPass');
    scheduleVisibleRecompute();
  }, [visibleIds, scheduleVisibleRecompute]);
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
  // True while the arrow bend (midpoint curve) dot is being dragged — used to
  // hide the ArrowPopover so it doesn't chase the cursor / cover the dot.
  const [bendDragging, setBendDragging] = useState(false);
  // Hidden BoardThumbnail used for PNG/PDF export. Same render path as
  // the canvas card preview, just scaled up at export time. Only mounted
  // while an export handler is running — otherwise rendering one SVG node
  // per card on every CanvasSurface render dominates idle/pan cost.
  const exportSvgRef = useRef(null);
  const [exportSvgMounted, setExportSvgMounted] = useState(false);
  const [drag, setDrag] = useState(null);
  // Touch only: the card currently "lifted" by a press-and-hold (picked up,
  // ready to drag). Drives the .is-lifted visual cue. Cleared on drop/cancel.
  const [liftedCardId, setLiftedCardId] = useState(null);
  // The card a finger is currently resting on, waiting out the press-and-hold.
  // Until this existed the hold was completely invisible: nothing happened for
  // TOUCH_LIFT_MS, so a touch user had no way to discover that waiting was the
  // thing to do, and the only teaching moment was a toast AFTER their drag had
  // already panned the board — once per device, ever. A quarter of mobile users
  // hit that failure. Showing the hold as it fills makes waiting legible.
  const [pressingCardId, setPressingCardId] = useState(null);
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
      }, SNAP_TUNING.LINGER_MS);
    }
    return () => {
      if (snapHintsTimerRef.current) {
        clearTimeout(snapHintsTimerRef.current);
        snapHintsTimerRef.current = null;
      }
    };
  }, [snapHints]);
  // Clear the alignment guides IMMEDIATELY (skip the ~90ms linger + fade) —
  // used at gesture end / cancel / abort so the gold lines don't hang behind
  // for a beat after the user drops. The linger effect above still handles the
  // graceful fade for mid-drag fast↔slow transitions.
  const clearSnapGuidesNow = useCallback(() => {
    if (snapHintsTimerRef.current) { clearTimeout(snapHintsTimerRef.current); snapHintsTimerRef.current = null; }
    setSnapHints(null);
    setDisplayedHints(null);
  }, []);
  const [resize, setResize] = useState(null);
  // Multi-selection / group resize. When active, drives a live overlay
  // of new bounds on every affected card so the user sees the scale
  // before pointer-up commits a single Yjs batch.
  //   { handle, anchor:{x,y,axisX,axisY}, startBounds, startById:Map<id, {x,y,w,h}>,
  //     live:Map<id, {x,y,w,h}> | null }
  const [multiResize, setMultiResize] = useState(null);
  const [rotateState, setRotateState] = useState(null); // { id, rot }
  const [marquee, setMarquee] = useState(null);

  // Tracks the in-flight pointer gesture (drag / resize / multi-resize /
  // rotate / marquee) so Escape can abort it. Each gesture registers a
  // cleanup fn on pointerdown (remove its window listeners, cancel rAFs,
  // reset its transient state to the pre-gesture value) and clears it on
  // pointerup. Without this, the window pointermove/pointerup listeners stay
  // armed after Escape and still commit the gesture on release.
  const pointerOpAbortRef = useRef(null);
  const [arrowFrom, setArrowFrom] = useState(null);
  // While the arrow tool has a source picked, the card the cursor is over
  // (highlighted as the connect target) and the live cursor position (for the
  // rubber-band preview). Cleared whenever the tool/source resets.
  const [arrowHoverCardId, setArrowHoverCardId] = useState(null);
  const [arrowCursor, setArrowCursor] = useState(null); // canvas-space {x,y}
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
  // Drop an existing canvas card INTO a grid cell. Tracks the {gridId, cellId}
  // under the cursor during a card drag (ref for the live drop, state for the
  // .is-cell-drop highlight).
  const [cellDropTarget, setCellDropTarget] = useState(null);
  const cellDropTargetRef = useRef(null);
  const updateCellDropTarget = useCallback((next) => {
    const a = cellDropTargetRef.current, b = next;
    const same = (!a && !b) || (a && b && a.gridId === b.gridId && a.cellId === b.cellId);
    cellDropTargetRef.current = next;
    if (!same) setCellDropTarget(next);
  }, []);
  // Convert a dragged canvas card into the content of a grid cell OR a
  // schedule slot. Content cards (image/note/link/file/video) MOVE (consumed);
  // a board → a board cell (preview, reference kept); a grid → grafted inline
  // (graftGridIntoCell consumes it). Schedule slots hold MULTIPLE items, so a
  // drop APPENDS (mints a fresh `<slot>/i:<uid>` key; a drop landing on a chip
  // normalizes to its slot — replacing would silently destroy an item).
  // Returns true if the drop was consumed into the cell (so the caller skips
  // the normal move-commit); false for kinds with no cell representation
  // (doc/shape/palette/…) OR kind/target mismatches (grid over a schedule,
  // schedule over a grid) so those keep dragging/repositioning normally —
  // returning true on a write that no-ops would swallow the drag (snap-back).
  const routeCardIntoCell = useCallback((card, gridId, cellId) => {
    if (!card || !gridId || !cellId) return false;
    const k = card.kind;
    // cardById is the stable in-place singleton (declared below; initialized by
    // the time any drop fires) — intentionally NOT in deps.
    const target = cardById[gridId];
    const targetIsSched = target?.kind === 'schedule' && !!target.schedView;
    if (target && target.kind !== 'grid' && !targetIsSched) return false;
    if (k === 'grid') {
      if (targetIsSched) return false;               // a grid can't graft into a slot
      mutators.graftGridIntoCell?.(gridId, cellId, card.id);
      return true;
    }
    if (k === 'schedule') {
      // Day card → day slot breaks the day into inline hour rows; hour card →
      // hour slot breaks it into minute rows (source consumed). Legacy source,
      // non-schedule target, a granularity mismatch, or off-prefix content in
      // the source all return false → the drag stays a normal move.
      if (!targetIsSched || !card.schedView) return false;
      return mutators.graftScheduleIntoSlot?.(gridId, schedSlotOfItem(cellId), card.id) === true;
    }
    let patch = null, consume = true;
    if (k === 'image') patch = { type: 'image', src: card.src, fit: 'cover', ...(card.adjust ? { adjust: card.adjust } : {}), ...(card.pos ? { pos: card.pos } : {}) };
    else if (k === 'note' || k === 'textlink') {
      // Keep the note's look (bg / text color / font) as a pinned cell style —
      // a painted note dropped into a grid used to arrive stripped to bare html.
      const style = {};
      if (card.bgColor) style.bg = card.bgColor;            // 'transparent' renders as unset
      if (card.textColor) style.color = card.textColor;
      if (card.fontFamily) style.fontFamily = card.fontFamily;
      if (card.fontSize) style.fontSize = card.fontSize;
      patch = { type: 'text', html: card.html || '', ...(Object.keys(style).length ? { style } : {}) };
    }
    else if (k === 'link') patch = { type: 'link', source: card.source || card.link, link: card.link || card.source, title: card.title, image: card.image, favicon: card.favicon, ...(card.embed ? { embed: card.embed } : {}) };
    else if (k === 'board') { patch = { type: 'board', boardId: card.id, name: boards?.[card.id]?.name || null }; consume = false; }
    else if (k === 'boardlink' && card.target) { patch = { type: 'board', boardId: card.target, name: boards?.[card.target]?.name || null }; consume = false; }
    else if (k === 'video') patch = { type: 'video', src: card.src };
    else if (k === 'file' || k === 'pdf') patch = { type: 'file', fileSrc: card.fileSrc || card.src, fileName: card.fileName || card.name, mime: card.mime, sizeBytes: card.sizeBytes, ext: card.ext };
    if (!patch) return false;
    const writeKey = targetIsSched ? mintSchedItemKey(schedSlotOfItem(cellId), schedUid()) : cellId;
    mutators.setGridCellContent?.(gridId, writeKey, patch);
    // boundary:false — the source-card consume must merge with the cell write
    // above so one Cmd+Z reverses the whole "card dropped into cell" gesture.
    if (consume) mutators.deleteCards?.([card.id], { boundary: false });
    return true;
  }, [mutators, boards]);
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
  // Custom-thumbnail flow for a board card: a hidden file input (opened from the
  // card's right-click menu) then a crop/reposition modal on the picked file.
  const thumbInputRef = useRef(null);
  const pendingThumbBoardId = useRef(null);
  const [thumbCropFor, setThumbCropFor] = useState(null);   // { boardId, file } | null
  const [thumbSaving, setThumbSaving] = useState(false);
  const triggerThumbPick = (boardId) => {
    pendingThumbBoardId.current = boardId;
    const input = thumbInputRef.current;
    if (input) { input.value = ''; input.click(); }
  };
  const onThumbFileChange = (e) => {
    const file = e.target.files?.[0];
    const boardId = pendingThumbBoardId.current;
    pendingThumbBoardId.current = null;
    if (file && boardId) setThumbCropFor({ boardId, file });
  };
  const saveThumbCrop = async (blob) => {
    const boardId = thumbCropFor?.boardId;
    if (!boardId) { setThumbCropFor(null); return; }
    setThumbSaving(true);
    try { await mutators.setBoardCustomThumb?.(boardId, blob); }
    finally { setThumbSaving(false); setThumbCropFor(null); }
  };
  // Annotation placement mode armed from the rail "+" menu: 'comment' | 'vote'
  // | null. While set, the next canvas click drops a point annotation and the
  // next card click attaches one to that card (mirrors the card right-click).
  const [annotPlacing, setAnnotPlacing] = useState(null);
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

  // Cursor broadcast — write to awareness on a throttled interval rather than
  // every pointermove/rAF. The interval SCALES with the live peer count
  // (cursorIntervalForPeerCount): exactly the historical 16ms (one write per
  // frame) in a small room, widening toward ~120ms as the room fills. Cursor
  // fan-out is O(N^2) — every person's every move reaches everyone — so a
  // fixed cadence is the cliff at scale; widening it keeps a crowded board
  // smooth while staying live-enough below the small-room threshold.
  useEffect(() => {
    const aw = getAwareness?.();
    const wrap = wrapRef.current;
    if (!aw || !wrap) return;
    let pending = null;
    let last = { x: null, y: null };
    let timer = null;
    // getStates() returns the live awareness Map (incl. self) — peers = size-1.
    const peerCount = () => Math.max(0, aw.getStates().size - 1);
    // Spectator-mode hysteresis state: in a very crowded room we stop
    // broadcasting our OWN cursor (we still SEE everyone), which removes one
    // sender from the O(N^2) cursor traffic per person who goes quiet.
    let broadcasting = true;
    const flush = () => {
      timer = null;
      if (!pending) return;
      const wasBroadcasting = broadcasting;
      broadcasting = shouldBroadcastOwnCursor(peerCount(), broadcasting);
      if (!broadcasting) {
        pending = null;
        // On the transition INTO spectator mode, clear our cursor once so peers
        // don't see it frozen in place; staying silent thereafter.
        if (wasBroadcasting) {
          last = { x: null, y: null };
          try { aw.setLocalStateField('canvasCursor', null); } catch (_) {}
        }
        return;
      }
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
      if (!timer) timer = setTimeout(flush, cursorIntervalForPeerCount(peerCount()));
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
  // Open an image card fullscreen. Shared by the corner Expand button, the
  // double-click/double-tap-the-image gesture, and focus-view single-tap, so
  // all three reach the same lightbox.
  const openImageLightbox = useCallback((c) => {
    if (!c?.src) return;
    setLightbox({ src: c.src, title: c.title || c.label || '', alt: c.title || c.label || '', adjust: c.adjust, cardId: c.id });
  }, []);
  // Photo editing: compact popover { cardId, anchorRect } and the full-screen
  // editor { cardId }. Both read the live card from `cards` each render so
  // collaborator edits + undo reflect instantly.
  const [imageEdit, setImageEdit] = useState(null);
  const [imageEditFull, setImageEditFull] = useState(null);
  // Transient (NOT Yjs) "hold to compare original" — while set, the named card
  // renders without its adjustments so the user can compare against the source.
  const [compareCardId, setCompareCardId] = useState(null);
  const [pdfViewer, setPdfViewer] = useState(null); // { src: 'r2:<pdfKey>', name }
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
  // Cursor add-card menu opened by double-clicking bare canvas (replaces the
  // old reflexive note-on-double-click). { open, x, y (client px), pos (canvas) }.
  const [quickAdd, setQuickAdd] = useState({ open: false, x: 0, y: 0, pos: null });
  const quickAddRef = useRef(null);
  const closeQuickAdd = useCallback(() => setQuickAdd(q => ({ ...q, open: false })), []);
  useDismissOnOutside(quickAddRef, quickAdd.open, closeQuickAdd);
  const [picker, setPicker] = useState(null); // { value, onChange, x, y, allowTransparent } | null
  const { palettes: workspacePalettes, ensureLoaded: ensureWorkspacePalettes } =
    useWorkspacePalettes(workspaceId);
  useEffect(() => { if (picker) ensureWorkspacePalettes(); }, [picker, ensureWorkspacePalettes]);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  // Templates panel (the grid tool's flyout) + the shape it armed. A pending
  // layout rides along with the 'grid' place-tool: the panel picks the shape,
  // the next canvas click decides where. Cleared whenever the tool disarms, so a
  // later bare G never silently reuses the last template someone chose.
  const [tplPanelOpen, setTplPanelOpen] = useState(false);
  // The rail's grid button, so the portaled panel can measure where to open.
  const tplAnchorRef = useRef(null);
  const [pendingGridLayout, setPendingGridLayout] = useState(null);
  // Phone bottom-nav "+" → full add sheet. { pos } = canvas-space drop point
  // captured when the sheet opens (viewport centre); null = closed.
  const [mobileAdd, setMobileAdd] = useState(null);
  const { isPhone, isTablet, isTouch } = useBreakpoint();
  // The whole touch shell that shows the bottom-nav "+" puck (App/LocalBoardsApp
  // gate the nav on this) — phones plus touch tablets and landscape phones. The
  // add sheet must render for all of them or the puck dead-ends there.
  const mobileShell = isPhone || (isTablet && isTouch);
  const [spaceDown, setSpaceDown] = useState(false);
  const lastMouseCanvasRef = useRef({ x: 200, y: 200 });
  const feedback = useFeedback();
  // The wheel effect binds once with [] deps on purpose (re-binding it fired
  // the cleanup mid-pan and nulled the peer cursor — see that effect), so it
  // cannot capture `feedback` or hold gesture state in a closure. Both go
  // through refs, synced on render like boardIdRef below.
  const feedbackRef = useRef(feedback);
  feedbackRef.current = feedback;
  const wheelFrustrationRef = useRef(freshWheelState());

  // Edit attempts on read-only boards silently no-op (viewer shares always
  // did). The demo-tier "Subscribe to edit shared clusters" toast died with
  // 0188 — editor collaboration is free, so 'tier-demoted' no longer exists.
  const showEditBlockedToast = () => {};

  // ── First-card friction instrumentation ─────────────────────────────────
  // noteCreateIntent fires at every "make a card" gesture (the missing half of
  // the funnel) AND feeds the stuck signal (recordIntent is a no-op unless App
  // started a session for this onboarding/demo user). noteCreateBlocked records
  // a create attempt that produced nothing — the silent canvas dead-ends, now
  // visible. See analyticsEvents.js for the pinned method/reason enums.
  // `tool` names WHICH creator the gesture reached for — the armed rail tool for
  // 'tool_place', the tile id for every menu path. It went unrecorded for as
  // long as this event has existed, so tool_place — the most-used deliberate
  // creation path there is — was a single unlabelled bucket, and "which tools do
  // people actually use" could only be answered backwards from the cards that
  // survived. null when the gesture genuinely doesn't know yet (paste, dblclick).
  const noteCreateIntent = (method, tool = null) => {
    try { logEvent(EV.CARD_CREATE_INTENT, { method, tool, board_id: board?.id }); } catch (_) {}
    try { setJourneyState({ phase: JOURNEY_PHASE.FIRST_INTENT }); } catch (_) {}
    try { recordIntent(method); } catch (_) {}
  };
  const noteCreateBlocked = (reason, method) => {
    try { logEvent(EV.CARD_CREATE_BLOCKED, { reason, method, board_id: board?.id }); } catch (_) {}
    try { setJourneyState({ phase: JOURNEY_PHASE.BLOCKED }); } catch (_) {}
  };

  // The empty-board tile panel became visible. This is the denominator every
  // first-card number was missing: of the people who reach the app and never
  // place a card, almost none fire even one card_create_intent — they don't
  // fail at creating, they never attempt it. Whether that's because the panel
  // never appeared or because it appeared and didn't read as clickable is the
  // whole question, and until now both looked identical (an absence of rows).
  //
  // Deliberately NOT gated on selectedTool: the panel hides while a tool is
  // armed, and that's a transient render detail, not "they stopped seeing it".
  // The question is whether this board ever showed them the way in.
  const emptyPanelVisible = canEdit && !isPublic
    && (firstCardPrompt || (cards.length === 0 && !(strokes?.length) && !(arrows?.length)));
  useEffect(() => {
    if (!emptyPanelVisible || !board?.id) return;
    logEventOnce(`empty_board_shown:${board.id}`, EV.EMPTY_BOARD_SHOWN, {
      board_id: board.id,
      tiles_n: EMPTY_TILES.length + 1,      // the six-tile row plus the image hero
      is_prompt: !!firstCardPrompt,          // shown over a seeded board, not a bare one
      escalated: !!frictionStuck,            // they'd already tripped the stuck signal
    });
  }, [emptyPanelVisible, board?.id, firstCardPrompt, frictionStuck]);

  // ── Depth dock ──
  // The panel above is the only place the product says "pick several at once",
  // and it unmounts as soon as any card exists — including a card that is an
  // empty container. So the one gesture that reliably fills a board is pitched
  // once, before the user has done anything, and never again. This keeps a much
  // quieter version of the offer alive until the board is deep enough to be
  // worth coming back to. Dismissal is per board and sticky.
  const depthDockKey = board?.id ? `soleil.depthdock.dismissed.${board.id}` : null;
  const [depthDockDismissed, setDepthDockDismissed] = useState(false);
  useEffect(() => {
    if (!depthDockKey) { setDepthDockDismissed(false); return; }
    let stored = false;
    try { stored = localStorage.getItem(depthDockKey) === '1'; } catch (_) {}
    setDepthDockDismissed(stored);
  }, [depthDockKey]);

  const depthGenuine = genuineCards(cards);
  const depthGenuineCount = depthGenuine.length;

  // ── Mix prompt ──
  // The dock's second message. "Add images" is the right offer while a board is
  // thin; once it is a pile of pictures with nothing written on it, the offer
  // that correlates with the user ever coming back is "say what this is" — see
  // mixPrompt.js for the day-one return table. Same dock, two asks, chosen by
  // what is actually on the board.
  //
  // `text` counts every card written INTO, not just notes: a doc already is the
  // behaviour being asked for, so prompting its author would be a false
  // positive. Seeds and showcase cards are already excluded by genuineCards.
  const mixImageCount = depthGenuine.filter((c) => c?.kind === 'image').length;
  const mixTextCount = depthGenuine.filter(
    (c) => c?.kind === 'note' || c?.kind === 'doc' || c?.kind === 'script',
  ).length;

  const mixPromptKey = board?.id ? `soleil.mixprompt.dismissed.${board.id}` : null;
  const [mixPromptDismissed, setMixPromptDismissed] = useState(false);
  useEffect(() => {
    if (!mixPromptKey) { setMixPromptDismissed(false); return; }
    let stored = false;
    try { stored = localStorage.getItem(mixPromptKey) === '1'; } catch (_) {}
    setMixPromptDismissed(stored);
  }, [mixPromptKey]);

  // Dismissal is tracked separately from the depth dock's on purpose. Waving
  // away "add a few more" at one card must not also retire the ask that is
  // actually load-bearing for return — they are different questions asked at
  // different times, and sharing a key would let the cheap one silence the
  // valuable one before it was ever eligible.
  const mixPromptEligible = shouldPromptMix({
    images: mixImageCount,
    text: mixTextCount,
    dismissed: mixPromptDismissed,
    canEdit,
    isPublic,
  });

  // The eligibility condition — a board going image-heavy with no writing — is
  // satisfied by a bulk import in ONE tick, the same tick that trips the cap and
  // crosses investedFrac. Claim the shared slot so this cannot join that
  // pile-up. A refusal is a deferral, never a decline: retry when the window
  // closes rather than losing the ask for the rest of the session.
  // Whether we already hold the slot lives in a REF, not in state, and the
  // per-board reset happens inside the same effect rather than a separate one.
  // Both are load-bearing: claiming CONSUMES the slot, so any path that forgets
  // a successful claim leaves the surface locked out for the full window while
  // its own claim is the thing blocking it. A sibling reset effect plus React's
  // double-invoked effects in development is exactly that path — claim, reset,
  // re-claim against a slot we are already holding, and land on false. This is
  // the same hazard upsellSlot's header describes as "a gate that burned a
  // one-shot just by asking"; a ref survives the double-invoke, state does not.
  const mixClaimRef = useRef({ boardId: null, held: false });
  const [mixSlotHeld, setMixSlotHeld] = useState(false);
  const [mixSlotRetry, setMixSlotRetry] = useState(0);
  useEffect(() => {
    if (!board?.id) return undefined;
    if (mixClaimRef.current.boardId !== board.id) {
      mixClaimRef.current = { boardId: board.id, held: false };
      setMixSlotHeld(false);
    }
    if (!mixPromptEligible || mixClaimRef.current.held) return undefined;
    if (claimUpsellSlot('mix-prompt')) {
      mixClaimRef.current = { boardId: board.id, held: true };
      setMixSlotHeld(true);
      return undefined;
    }
    // Deferred, not declined: something louder owns this moment. Come back when
    // its window closes rather than losing the ask for the rest of the session.
    const t = setTimeout(() => setMixSlotRetry((n) => n + 1), UPSELL_STACK_WINDOW_MS);
    return () => clearTimeout(t);
  }, [mixPromptEligible, board?.id, mixSlotRetry]);

  const mixPromptVisible = mixPromptEligible && mixSlotHeld;

  // Mix wins the dock outright where the two bands overlap: at 3-5 images with
  // no writing both are true, and "add more of the thing that doesn't predict
  // return" is the offer being corrected.
  const depthDockVisible = !mixPromptVisible && shouldShowDepthDock({
    genuine: depthGenuineCount,
    dismissed: depthDockDismissed,
    canEdit,
    isPublic,
  });
  useEffect(() => {
    if (!depthDockVisible || !board?.id) return;
    logEventOnce(`depth_dock_shown:${board.id}`, EV.DEPTH_DOCK_SHOWN, {
      board_id: board.id,
      cards: depthGenuineCount,
    });
  }, [depthDockVisible, board?.id, depthGenuineCount]);

  useEffect(() => {
    if (!mixPromptVisible || !board?.id) return;
    logEventOnce(`mix_prompt_shown:${board.id}`, EV.MIX_PROMPT_SHOWN, {
      board_id: board.id,
      images: mixImageCount,
      text: mixTextCount,
    });
  }, [mixPromptVisible, board?.id, mixImageCount, mixTextCount]);

  const dismissDepthDock = () => {
    setDepthDockDismissed(true);
    try { if (depthDockKey) localStorage.setItem(depthDockKey, '1'); } catch (_) {}
    try {
      logEvent(EV.DEPTH_DOCK_DISMISSED, { board_id: board?.id || null, cards: depthGenuineCount });
    } catch (_) {}
  };

  const dismissMixPrompt = () => {
    setMixPromptDismissed(true);
    try { if (mixPromptKey) localStorage.setItem(mixPromptKey, '1'); } catch (_) {}
    try {
      logEvent(EV.MIX_PROMPT_DISMISSED, { board_id: board?.id || null, images: mixImageCount });
    } catch (_) {}
  };

  // Resolve a sane paste position. lastMouseCanvasRef tracks the cursor over the
  // canvas, but after a pan/zoom with no mousemove since it can point far
  // off-screen — a paste would then land where the user can't see it (the silent
  // stale-paste dead-end). Clamp to the visible viewport center in that case and
  // report that we recovered.
  const resolvePastePos = () => {
    const raw = lastMouseCanvasRef.current;
    const wrap = wrapRef.current;
    if (!wrap) return { pos: raw, clamped: false };
    const rect = wrap.getBoundingClientRect();
    const tl = clientToCanvas(rect.left, rect.top);
    const br = clientToCanvas(rect.right, rect.bottom);
    const inView = raw && raw.x >= tl.x && raw.x <= br.x && raw.y >= tl.y && raw.y <= br.y;
    if (inView) return { pos: raw, clamped: false };
    return { pos: clientToCanvas(rect.left + rect.width / 2, rect.top + rect.height / 2), clamped: true };
  };
  const notePasteCreate = (clamped) => {
    noteCreateIntent('paste');
    if (clamped) {
      noteCreateBlocked('stale_paste', 'paste');
      feedback.toast({ type: 'info', message: 'Pasted into view.', ttl: 2500 });
    }
  };
  // Place tools (click empty canvas to drop a card); 'draw'/'arrow' are not.
  const PLACE_TOOLS = ['text', 'image', 'doc', 'board', 'grid', 'shape', 'palette'];

  // Placing a cluster is the most common opening move in the product, and the
  // one that most often ends a couple of cards later. It leaves the user on a
  // canvas holding a single closed box — and because the board is no longer
  // empty, the empty-board panel unmounts, taking the only offer of a
  // multi-select image import with it. So when the cluster IS the board's first
  // genuine card, step inside it, where that panel is showing on a fresh canvas.
  //
  // Fires at most once per board: the cluster it just made is itself a genuine
  // card, so a second one finds hasGenuineCard already true. That is also what
  // stops a user who likes clusters being walked down a chain of them.
  const addClusterCard = async (pos, method) => {
    const wasFirst = !hasGenuineCard(cards);
    // The HOST navigates, not us. Whether a freshly-created board is safe to
    // open depends on when that host's board list settles — App.jsx awaits a
    // refresh, the local harness sets React state — and a caller that opened it
    // itself would silently no-op against a stale map. Asking for it by option
    // lets each host do the part it actually knows about.
    const newId = await mutators.addNewBoard?.(pos, { openAfter: wasFirst });
    if (!wasFirst || !newId || !onOpenBoard) return;
    const parentId = board?.id || null;
    try { logEvent(EV.CLUSTER_AUTO_OPEN, { board_id: parentId, new_board_id: newId, method }); } catch (_) {}
    // Moving someone without asking is a liberty; name it and offer the way
    // back in the same breath, and measure how often they take it.
    feedback.toast({
      message: 'Opened your new cluster — add images inside it.',
      ttl: 7000,
      action: parentId ? {
        label: 'Back',
        onClick: () => {
          try { logEvent(EV.CLUSTER_AUTO_OPEN_BACK, { board_id: parentId }); } catch (_) {}
          onOpenBoard(parentId);
        },
      } : undefined,
    });
  };

  // Drop the armed place-tool's card at `pos` — wherever the click landed,
  // empty canvas OR on top of an existing card. Shared by the background placer
  // and the card placer so a mis-click on a card no longer dead-ends (the data
  // showed armed-tool clicks that hit a card just silently no-op'd, which reads
  // as "the app is broken"). Returns true if it handled the tool.
  const placeToolAt = (pos) => {
    if (!PLACE_TOOLS.includes(selectedTool)) return false;
    markViewSettled(); // keep the placed card where clicked (no first-card auto-fit)
    noteCreateIntent('tool_place', selectedTool);
    switch (selectedTool) {
      case 'board':   addClusterCard(pos, 'tool_place'); break;
      // A layout armed by the Templates panel wins; a bare G (or the right-click
      // Add ▸ Grid, which never opens the panel) still gets the default shape.
      // The size rides along because a layout is proportions, and a set of
      // proportions is only the shape it means at one aspect ratio — the
      // six-panel storyboard placed at the default 360×300 has square panels.
      // Spread so a template without one keeps addGrid's own default.
      case 'grid':    mutators.addGrid?.(pos, pendingGridLayout
                        ? {
                          layout: pendingGridLayout.tree,
                          hints: pendingGridLayout.hints,
                          textStyle: pendingGridLayout.textStyle,
                          ...(pendingGridLayout.size || {}),
                        }
                        : { preset: 'storyboard-1-2' });
                      // The grid is down, so the "you just added this" prompt has
                      // done its job. Cleared on ANY grid placement rather than
                      // only the armed one: once there is a grid on the canvas,
                      // an offer to place one is noise.
                      onDismissJustAdded?.();
                      break;
      // Multi-select, like every other image entry point — see the 'image'
      // add-action for why singular was costing day-one depth.
      case 'image':   pickPhotosAtRef.current?.(pos, 'tool_place'); break;
      case 'doc':     mutators.addDocCard?.(pos);  break;
      case 'text':    mutators.addNote?.(pos);     break;
      case 'palette': mutators.addPalette?.(pos);  break;
      case 'shape':   mutators.addShape?.(pos, shapeOptions); break;
      default: return false;
    }
    setSelectedTool('select');
    return true;
  };

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
  // Mark the camera "settled" for this board so the empty→first-card auto-fit
  // below won't zoom-frame (and recenter) a card the user just placed. Called
  // synchronously from every user create entry point BEFORE the card is added,
  // so the fit useLayoutEffect early-returns. Initial-load sync-retry is
  // unaffected (it runs before any user placement).
  const markViewSettled = useCallback(() => { fitOnceForRef.current = board.id; }, [board.id]);
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
    // Test mode (autoFrame=false, LocalBoardsApp ?blank=1): never auto-fit — keep
    // zoom 1 and lock immediately so placement specs run at a stable zoom. The
    // empty→first-card fit would otherwise zoom-to-frame that single card to ~3x.
    if (!autoFrame) {
      fitOnceForRef.current = board.id;
      setZoom(1);
      setPan({ x: 40, y: 60 });
      return;
    }
    const r = wrapRef.current.getBoundingClientRect();
    if (r.width < 50 || r.height < 50) return;
    if (!ydoc && cards.length === 0) return; // not ready yet
    // 1) Saved view wins — instant restore, then we're done. Skipped in
    //    public mode so a /share visitor always opens framed-to-content,
    //    regardless of any view this device saved while signed in.
    const saved = isPublic ? null : loadBoardView(board.id);
    if (saved && !viewRestoreCrashed(board.id)) {
      fitOnceForRef.current = board.id;
      // Breadcrumb: if restoring this (possibly heavy) view OOM-crashes the tab,
      // the sentinel survives Safari's auto-reload and the next open takes the
      // fall-through branch below instead of re-entering the crash.
      markViewRestoreInFlight(board.id);
      setZoom(saved.zoom);
      setPan(saved.pan);
      return;
    }
    if (saved) {
      // The last restore of this saved view didn't survive (likely an OOM crash
      // → reload). Don't walk back into it: drop the saved view and fall through
      // to fit-to-content so the board opens at a safe zoom.
      clearBoardView(board.id);
      clearViewRestoreInFlight(board.id);
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
    // Public pages may supply an initial frame (a sub-rect — e.g. the board's
    // top band at fit-to-width) so tall boards open readable instead of as a
    // tiny fit-everything strip. Same margin/clamp/center math either way.
    if (isPublic && initialFrame && Number.isFinite(initialFrame.w) && initialFrame.w > 0) {
      minX = initialFrame.x;
      minY = initialFrame.y;
      maxX = initialFrame.x + initialFrame.w;
      maxY = initialFrame.y + Math.max(1, initialFrame.h);
    }
    let contentW = Math.max(1, maxX - minX);
    let contentH = Math.max(1, maxY - minY);
    const margin = fitMargin(r);
    let z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.min(
      (r.width - margin * 2) / contentW,
      (r.height - margin * 2) / contentH,
    )));
    // Phone rescue: fit-everything is the wrong opening view on a narrow
    // screen. Measured across every board behind a live share link, the median
    // opening zoom on a 390px phone is 0.108 — a 14px label renders at 1.5px —
    // and every one of them is wider than a portrait viewport, so the board
    // also letterboxes into a band with dead space above and below. Half of
    // all share traffic is mobile and it leaves in ~13 seconds; there is
    // nothing legible for it to stay for.
    //
    // So open framed to the board's top-left at a zoom that shows a readable
    // handful of cards, filling the viewport. The whole board stays one pinch
    // away — this changes where the canvas STARTS, never what it can show.
    // Desktop is untouched: it fits at ~3x the zoom and dwells ~7x longer, so
    // seeing everything at once still wins there.
    //
    // The target is derived from the MEDIAN CARD WIDTH on this board, not a
    // fixed zoom. Card sizes differ by an order of magnitude between boards
    // (a 240pt note vs an 800pt photo), so any constant zoom that frames notes
    // sensibly opens an image board on a single cropped picture. Median rather
    // than mean so one outsized banner card can't drag the whole view in.
    if (isPublic && !initialFrame && r.width <= NARROW_FIT_MAX_W) {
      const widths = cards.map(c => c.w).filter(w => Number.isFinite(w) && w > 0).sort((a, b) => a - b);
      const medianW = widths.length ? widths[widths.length >> 1] : 0;
      // The trigger is physical: how big is a card actually going to be on
      // this screen? A board that already fits at a legible size keeps the
      // centred see-everything view — that is the better opening shot whenever
      // it's on offer, and reframing it to a corner for a few percent of extra
      // zoom would be a straight downgrade.
      if (medianW > 0 && medianW * z < NARROW_MIN_CARD_PX) {
        const target = Math.min(
          NARROW_MAX_ZOOM,
          (r.width - margin * 2) / (medianW * NARROW_CARDS_ACROSS),
        );
        if (target > z) {
          z = target;
          // A frame of exactly the visible area at this zoom, anchored at the
          // content's top-left: the centering math below then places the
          // board's first corner at the margin instead of centring a
          // shrunken whole.
          contentW = (r.width  - margin * 2) / z;
          contentH = (r.height - margin * 2) / z;
        }
      }
    }
    setZoom(z);
    setPan({
      x: (r.width  - contentW * z) / 2 - minX * z,
      y: (r.height - contentH * z) / 2 - minY * z,
    });
  }, [cards, board.id, ydoc, isPublic, initialFrame]);

  // Persist zoom+pan changes per board so reopening the board resumes
  // where the user left off. Debounced so rapid wheel/pan gestures
  // produce one write at rest, not one per frame.
  useEffect(() => {
    if (isPublic) return; // public viewer: don't persist anon view state
    if (!board?.id) return;
    // Don't save until the load effect has run for THIS board (avoids
    // overwriting saved state with the mount-time defaults).
    if (fitOnceForRef.current !== board.id) return;
    const tid = setTimeout(() => saveBoardView(board.id, { zoom, pan }), 400);
    return () => clearTimeout(tid);
  }, [zoom, pan.x, pan.y, board.id, isPublic]);

  // Clear the restore breadcrumb once this board has stayed alive long enough to
  // prove a restored view didn't crash the tab. If an OOM kills the renderer
  // first, this timer never fires, the sentinel survives Safari's auto-reload,
  // and the restore effect above opens framed-to-content instead of looping.
  useEffect(() => {
    if (isPublic || !board?.id) return undefined;
    const tid = setTimeout(() => clearViewRestoreInFlight(board.id), 4000);
    return () => clearTimeout(tid);
  }, [board?.id, isPublic]);

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
    const margin = fitMargin(r);
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

  // Keyboard zoom that keeps the viewport CENTER fixed (mirrors the wheel
  // handler's cursor-anchored math), so Cmd +/- feels like wheel zoom instead
  // of zooming toward the canvas origin.
  const zoomAroundCenter = useCallback((factor) => {
    const curZoom = zoomRef.current;
    const curPan = panRef.current;
    const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, curZoom * factor));
    enableSmoothTransform();
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) { setZoom(newZoom); return; }
    const sx = r.width / 2, sy = r.height / 2;
    const cx = (sx - curPan.x) / curZoom;
    const cy = (sy - curPan.y) / curZoom;
    setZoom(newZoom);
    setPan({ x: sx - cx * newZoom, y: sy - cy * newZoom });
  }, [enableSmoothTransform]);

  // Zoom + center on the current selection (mirrors fitToContent but bounded
  // to selected cards). No-op with an empty selection.
  const zoomToSelection = useCallback(() => {
    if (!wrapRef.current || selected.size === 0) return;
    const sel = (cards || []).filter(c => selected.has(c.id));
    if (sel.length === 0) return;
    const r = wrapRef.current.getBoundingClientRect();
    if (r.width < 50 || r.height < 50) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of sel) {
      minX = Math.min(minX, c.x); minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x + c.w); maxY = Math.max(maxY, c.y + c.h);
    }
    const contentW = Math.max(1, maxX - minX);
    const contentH = Math.max(1, maxY - minY);
    const margin = 120;
    const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.min(
      (r.width - margin * 2) / contentW,
      (r.height - margin * 2) / contentH,
    )));
    enableSmoothTransform();
    setZoom(z);
    setPan({
      x: (r.width  - contentW * z) / 2 - minX * z,
      y: (r.height - contentH * z) / 2 - minY * z,
    });
  }, [cards, selected, enableSmoothTransform]);

  // Fit-frame an EXPLICIT set of card ids (not the `selected` state, which
  // updates async). Same math as zoomToSelection. Returns false if the ids
  // aren't on the board yet or the wrap has no real size — the caller retries.
  const frameCards = useCallback((ids) => {
    if (!wrapRef.current || !ids?.length) return false;
    const idSet = new Set(ids);
    const sel = (cards || []).filter(c => idSet.has(c.id));
    if (!sel.length) return false;
    const r = wrapRef.current.getBoundingClientRect();
    if (r.width < 50 || r.height < 50) return false;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of sel) {
      minX = Math.min(minX, c.x); minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x + c.w); maxY = Math.max(maxY, c.y + c.h);
    }
    const contentW = Math.max(1, maxX - minX);
    const contentH = Math.max(1, maxY - minY);
    const margin = 120;
    const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.min(
      (r.width - margin * 2) / contentW,
      (r.height - margin * 2) / contentH,
    )));
    enableSmoothTransform();
    setZoom(z);
    setPan({
      x: (r.width  - contentW * z) / 2 - minX * z,
      y: (r.height - contentH * z) / 2 - minY * z,
    });
    return true;
  }, [cards, enableSmoothTransform]);

  // After a list-view file drop, when the user switches to canvas: select the
  // freshly-arranged cards and frame them so the batch is impossible to miss.
  // Fires once per request token; retries via rAF until the cards have synced
  // in and the wrap has a real size.
  const focusTokenRef = useRef(null);
  useEffect(() => {
    const req = focusRequest;
    if (!req || !req.ids?.length) return;
    if (focusTokenRef.current === req.token) return;
    let tries = 0, raf = 0;
    const attempt = () => {
      const idSet = new Set(req.ids);
      const present = (cards || []).some(c => idSet.has(c.id));
      if (present && frameCards(req.ids)) {
        focusTokenRef.current = req.token;
        setSelected(new Set(req.ids));
        clearFocusRequest?.();
        return;
      }
      if (tries++ < 40) raf = requestAnimationFrame(attempt);
    };
    raf = requestAnimationFrame(attempt);
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [focusRequest, cards, frameCards, clearFocusRequest]);

  // Arrange the current selection in z-order (keyboard [ / ] shortcuts). Mirrors
  // the context-menu arrangeRun for the 'forward'/'backward' ops.
  const arrangeSelected = useCallback((op) => {
    const ids = [...selected];
    if (ids.length === 0) return;
    // Read the live card map via the ref (cardByIdRef is declared further
    // down; the closure only accesses it at call time, so no TDZ).
    const zOf = (id) => (cardByIdRef.current[id]?.z || 0);
    const order = op === 'forward'
      ? ids.slice().sort((a, b) => zOf(b) - zOf(a))
      : ids.slice().sort((a, b) => zOf(a) - zOf(b));
    const fn = op === 'forward' ? mutators.bringForward : mutators.sendBackward;
    order.forEach(id => fn?.(id));
  }, [selected, mutators]);

  // Group the current selection (Cmd+G). Uses a default name — the context
  // menu still offers the named-group prompt.
  const groupSelected = useCallback(() => {
    if (selected.size < 2) return;
    mutators.createGroup?.({ name: 'Group', cardIds: [...selected] });
  }, [selected, mutators]);

  useEffect(() => { setArrowFrom(null); setArrowHoverCardId(null); setArrowCursor(null); setActiveStroke(null); setActiveFreeArrow(null); setAnnotPlacing(null); }, [selectedTool, board.id]);
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
  // Mirror the mounted count into the always-on jank reporter (perf.js
  // gauges are dead when the HUD is off). Changed-guarded — runs per render
  // but writes only when the number moves.
  {
    const visNow = visibleIds ? visibleIds.size : sortedCards.length;
    if (_perfVisRef.current !== visNow) {
      _perfVisRef.current = visNow;
      setPerfContext({ cardsVisible: visNow });
    }
  }
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

  // ── Templates panel ────────────────────────────────────────────────────────
  // Built-ins are a module constant, so the panel always has something to show:
  // offline, signed out, and under ?local=1 (which has no supabase client at
  // all). Saved rows are fetched lazily the first time the panel opens — see
  // useGridLayouts for why this is not a realtime subscription.
  //
  // ?local=1 passes the literal 'local-workspace' rather than a uuid, so the
  // truthiness check alone is not enough to keep the harness off the network.
  const templatesEnabled = !!userId && !!workspaceId && workspaceId !== 'local-workspace';
  const { rows: savedLayouts, community: publishedLayouts,
    ensureLoaded: ensureGridLayouts, reload: reloadGridLayouts } =
    useGridLayouts(templatesEnabled ? userId : null);
  useEffect(() => { if (tplPanelOpen) ensureGridLayouts(); }, [tplPanelOpen, ensureGridLayouts]);

  // One RLS query returns everything the caller may see, so the split into
  // sections happens here rather than as two round-trips. "Workspace" shows only
  // the ACTIVE workspace — a member of three workspaces shouldn't see all three
  // libraries stacked in one panel.
  const templateSections = useMemo(() => {
    const personal = savedLayouts.filter((r) => r.created_by === userId && r.scope !== 'workspace');
    // origin (0270) is what separates a template you built from a copy you took
    // off a share link or the gallery — both are scope:'user' rows you own, so
    // without it they pile into one indistinguishable list.
    const mine = rowsFromRecords(personal.filter((r) => (r.origin || 'own') === 'own'), SOURCES.USER);
    const downloaded = rowsFromRecords(personal.filter((r) => (r.origin || 'own') !== 'own'), SOURCES.DOWNLOADED);
    const workspace = rowsFromRecords(
      savedLayouts.filter((r) => r.scope === 'workspace' && r.workspace_id === workspaceId),
      SOURCES.WORKSPACE,
    );
    // The STORE, in the panel. Shopping the catalogue used to mean leaving the
    // app for /templates, adding to your library, coming back and finding it
    // under Yours — four steps to place a grid. Here it is one click, and
    // pickTemplate already does the right thing with it.
    const store = TEMPLATE_CARDS.map((t) => {
      const layout = layoutById(t.preset);
      return layout && {
        key: `store:${t.slug}`, id: t.slug, name: t.h1,
        tree: layout.tree, source: SOURCES.STORE, hints: t.hints || null,
        // The proportions the layout means: a storyboard's panels are only 16:9
        // at the size it was drawn for.
        size: t.size || null,
      };
    }).filter(Boolean);
    // Published by other people. Sanitized on the way out as well as in — these
    // trees were authored by strangers and computeCellRects recurses without a
    // depth guard.
    const community = (publishedLayouts || []).map((r) => {
      const tree = sanitizeLayout(r.body?.layout);
      return tree && {
        key: `community:${r.slug}`, id: r.slug, name: r.title,
        tree, source: SOURCES.COMMUNITY, hints: sanitizeHints(r.body?.hints),
        textStyle: r.body?.textStyle || null,
        size: sanitizeSize(r.body?.size),
      };
    }).filter(Boolean);
    return mergeSections({ mine, workspace, downloaded, store, community });
  }, [savedLayouts, publishedLayouts, userId, workspaceId]);

  // The grid a template would re-cut: exactly one card selected and it IS a grid.
  // Anything else — nothing selected, a multi-select, a note — means "place a new
  // one", which is what the panel's header hint says. Deliberately not memoized:
  // cardById is a mutable ref object, so a memo keyed on it would never notice a
  // card changing kind underneath it.
  const templateTargetId = (() => {
    if (selected.size !== 1) return null;
    const id = [...selected][0];
    return cardById[id]?.kind === 'grid' ? id : null;
  })();
  // Mirrored into a ref so pickTemplate keeps stable deps — it is handed to a
  // child and would otherwise re-identify on every selection change.
  const templateTargetIdRef = useRef(null);
  templateTargetIdRef.current = templateTargetId;

  const pickTemplate = useCallback((row) => {
    if (!row?.tree) return;
    if (!templateTargetIdRef.current) {
      // Nothing to re-cut → arm the placer and let the next canvas click say where.
      setPendingGridLayout({
        tree: row.tree, hints: row.hints || null, textStyle: row.textStyle || null,
        size: row.size || null,
      });
      setSelectedTool('grid');
      return;
    }
    const res = mutators.applyGridLayout?.(templateTargetIdRef.current, row.tree, row.hints || null);
    if (!res) {
      feedback.toast({ type: 'error', message: 'Could not apply that template.' });
      return;
    }
    const um = mutators.undoManager;
    const item = um?.undoStack?.length ? um.undoStack[um.undoStack.length - 1] : null;
    mutators.breakUndo?.();
    // Only speak up when the apply cost something or reached past the one grid
    // they had selected. A clean re-cut of a single grid needs no announcement —
    // they can see what happened.
    const parts = [];
    if (res.affected > 1) parts.push(`Re-cut ${res.affected} linked grids`);
    if (res.dropped) parts.push(`${res.dropped} filled ${res.dropped === 1 ? 'cell' : 'cells'} removed`);
    if (parts.length) {
      undoToast(feedback, {
        message: parts.join(' · '),
        undoManager: um,
        stackItem: item,
        onUndo: () => mutators.undo?.(),
      });
    }
  }, [mutators, feedback, setSelectedTool]);

  // Disarming the tool — Escape, picking another tool, or placing the card —
  // drops the armed shape, so a later bare G never silently reuses whatever
  // template was chosen minutes ago.
  useEffect(() => { if (selectedTool !== 'grid') setPendingGridLayout(null); }, [selectedTool]);

  // Save the selected grid's SHAPE. Link-aware: a grid in a linked family reads
  // its layout from the shared record, so reaching for card.layout would save
  // null for exactly the grids most worth saving. Same resolution the text-style
  // path uses further down.
  // Opening the dialog needs the shape; saving needs the shape AND the labels,
  // so the grid's layout is captured when the dialog opens rather than read
  // again on submit — the selection can change while a modal is up.
  const [saveTplLayout, setSaveTplLayout] = useState(null);
  const openSaveTemplate = useCallback((gridId = null) => {
    // An explicit id for the card context menu, which knows exactly which grid
    // was right-clicked. The panel footer passes nothing and falls back to the
    // selection — reading the ref there is correct because it was already
    // rendered from it.
    const id = gridId || templateTargetIdRef.current;
    const card = id ? cardById[id] : null;
    if (!card) return;
    const layout = card.templateId ? gridTemplates?.[card.templateId]?.layout : card.layout;
    const textStyle = card.templateId ? gridTemplates?.[card.templateId]?.textStyle : card.textStyle;
    const clean = sanitizeLayout(layout);
    if (!clean) { feedback.toast({ type: 'error', message: 'That grid has no layout to save.' }); return; }
    // The card's own proportions ride along, so a grid you built as a storyboard
    // comes back as one. Read here rather than at submit for the same reason the
    // layout is: the selection can change while the dialog is up.
    setSaveTplLayout({ layout: clean, textStyle: textStyle || null, size: { w: card.w, h: card.h } });
  }, [cardById, gridTemplates, feedback]);

  const commitSaveTemplate = async ({ name, hints, publish, description }) => {
    const pending = saveTplLayout;
    setSaveTplLayout(null);
    if (!pending || !userId) return;
    const body = bodyFromGrid(pending.layout, pending.textStyle, hints, pending.size);
    if (!body) { feedback.toast({ type: 'error', message: 'Could not read that grid.' }); return; }
    try {
      const row = await saveGridLayout({ name: name.slice(0, 80), body, scope: 'user', userId });
      const labelled = (hints || []).filter((h) => h.trim()).length;
      // Publishing is a SECOND step that can fail on its own — most usefully on
      // the two-cell store gate. Saving already succeeded by then, so the
      // failure toast has to say that rather than implying the whole thing was
      // lost. The raw Postgres message is surfaced because it is the one that
      // explains the gate.
      if (publish && row?.id) {
        try {
          await publishGridLayout(row.id, name.slice(0, 80), description || null);
          await reloadGridLayouts();
          feedback.toast({
            message: 'Saved and shared in the store.',
            actionLabel: 'View',
            onAction: () => window.open('/templates', '_blank', 'noopener'),
          });
          return;
        } catch (e) {
          await reloadGridLayouts();
          feedback.toast({ type: 'info', message: `Saved, but not shared — ${e?.message || 'try again from its ··· menu.'}` });
          return;
        }
      }
      await reloadGridLayouts();
      feedback.toast({
        message: labelled
          ? `Saved “${name}” with ${labelled} ${labelled === 1 ? 'label' : 'labels'}.`
          : `Saved “${name}” to your templates.`,
      });
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Could not save that template.' });
    }
  };

  const templateRowActions = useCallback((row) => {
    const isMine = row.ownerId === userId;
    const acts = [];
    acts.push({
      id: 'rename',
      label: 'Rename…',
      run: async () => {
        const next = await feedback.prompt({
          title: 'Rename template', label: 'Name', defaultValue: row.name, confirmLabel: 'Rename',
        });
        if (!next || !next.trim() || next.trim() === row.name) return;
        try { await renameGridLayout(row.id, next.trim().slice(0, 80)); await reloadGridLayouts(); }
        catch (e) { feedback.toast({ type: 'error', message: 'Could not rename: ' + (e.message || e) }); }
      },
    });
    if (isMine) {
      const toWorkspace = row.source !== SOURCES.WORKSPACE;
      acts.push({
        id: 'scope',
        label: toWorkspace ? 'Share with workspace' : 'Make private',
        run: async () => {
          try {
            await setGridLayoutScope(row.id, toWorkspace ? 'workspace' : 'user', workspaceId);
            await reloadGridLayouts();
            feedback.toast({ message: toWorkspace ? 'Shared with your workspace.' : 'Now private to you.' });
          } catch (e) { feedback.toast({ type: 'error', message: 'Could not change sharing: ' + (e.message || e) }); }
        },
      });
      acts.push({
        id: 'link',
        label: 'Copy share link',
        run: async () => {
          try {
            const token = await createGridLayoutLink(row.id);
            const url = `${window.location.origin}/t/${token}`;
            // Clipboard can be denied; showing the URL is a worse-but-real
            // fallback rather than a silent failure.
            try { await navigator.clipboard.writeText(url); feedback.toast({ message: 'Share link copied.' }); }
            catch (_) { feedback.toast({ message: url, ttl: 12000 }); }
          } catch (e) { feedback.toast({ type: 'error', message: 'Could not create a link: ' + (e.message || e) }); }
        },
      });
    }
    if (isMine) {
      // Publishing is immediate — there is no review queue — so the copy says
      // "everyone", not "submit". Offering only the action that applies keeps
      // the row from asking the user to guess its own state.
      acts.push(row.publishedSlug ? {
        id: 'unpublish',
        label: 'Remove from the store',
        run: async () => {
          try {
            await unpublishGridLayout(row.id);
            await reloadGridLayouts();
            feedback.toast({ message: 'Removed from the store.' });
          } catch (e) { feedback.toast({ type: 'error', message: 'Could not remove: ' + (e.message || e) }); }
        },
      } : {
        id: 'publish',
        label: 'Share in the store…',
        run: async () => {
          // A prompt rather than a confirm, because the description IS the tile
          // line in the store. Publishing used to pass null here, so every
          // community template arrived with no line under its name — the one
          // field a shopper actually reads.
          const desc = await feedback.prompt({
            title: 'Share in the template store?',
            message: `“${row.name}” will appear at /templates for anyone to add. It shares the shape and the labels only — no images, no text, nothing from the board it came from. You can remove it at any time.`,
            label: 'One line about it (optional)',
            placeholder: 'Three locations, three frames each — wide, detail, light.',
            confirmLabel: 'Share it',
          });
          // prompt resolves '' for an empty field and null only on cancel, so
          // this distinguishes "no description" from "changed my mind".
          if (desc === null || desc === undefined) return;
          try {
            const res = await publishGridLayout(row.id, row.name, String(desc).trim() || null);
            await reloadGridLayouts();
            feedback.toast({
              message: 'Shared in the store.',
              action: res?.slug ? { label: 'View', onClick: () => window.open('/templates', '_blank', 'noopener') } : undefined,
            });
          } catch (e) {
            // The 2-cell quality gate raises 22023 with a human-readable
            // message; surfacing it verbatim beats inventing a vaguer one.
            feedback.toast({ type: 'error', message: e.message || 'Could not publish.' });
          }
        },
      });
    }
    acts.push({
      id: 'delete',
      label: 'Delete',
      danger: true,
      run: async () => {
        try {
          await deleteGridLayout(row.id);
          await reloadGridLayouts();
          // Soft delete, so Undo is a closure that clears deleted_at — no
          // UndoManager stack item is involved, which is the shape undoToast
          // documents for server-side operations.
          undoToast(feedback, {
            message: `“${row.name}” deleted`,
            onUndo: async () => {
              try { await restoreGridLayout(row.id); await reloadGridLayouts(); }
              catch (e) { feedback.toast({ type: 'error', message: 'Could not restore: ' + (e.message || e) }); }
            },
          });
        } catch (e) { feedback.toast({ type: 'error', message: 'Could not delete: ' + (e.message || e) }); }
      },
    });
    return acts;
  }, [userId, workspaceId, feedback, reloadGridLayouts]);

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

  // Undo/redo is the in-session Yjs UndoManager (see mutators.undo/redo and
  // the Cmd+Z handler below). No time-travel fallback: it was fragile
  // (network round-trips, PartyKit room resets, a cards.length proxy that
  // missed same-count edits) and undo must work every time. Deleted-board
  // recovery now lives in the Trash modal; catastrophic rewind in Settings.

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
  //
  // `liveRect` returns a card's IN-GESTURE rect (mid-drag / mid-resize /
  // mid-multi-resize), mirroring renderCard's (x,y,w,h) math (6465+), so an
  // arrow anchors to exactly where the card is DRAWN rather than its committed
  // position. Without this the endpoint stays at the old edge until pointer-up
  // — the "ghost line left behind" the user reported. Adding drag/resize/
  // multiResize to the deps makes this ctx (and the attachments/geom memos that
  // depend on it) recompute each gesture frame; on release the Yjs commit
  // updates `cards → cardById` and the endpoint settles onto the final spot.
  const arrowCtx = useMemo(() => {
    const dIds = drag?.ids || null;
    const dDx = drag?.dx || 0, dDy = drag?.dy || 0;
    const mr = multiResize?.live || null;
    const rz = resize || null;
    const liveRect = (id) => {
      const c = cardById[id];
      if (!c) return null;
      if (mr && mr.has(id)) { const lv = mr.get(id); return { x: lv.x, y: lv.y, w: lv.w, h: lv.h }; }
      let x = c.x, y = c.y, w = c.w, h = c.h;
      if (dIds && dIds.includes(id)) { x += dDx; y += dDy; }
      if (rz && rz.id === id) { w = Math.max(MIN_W, w + (rz.dw || 0)); h = Math.max(MIN_H, h + (rz.dh || 0)); }
      return { x, y, w, h };
    };
    const resolveGroupBBox = (gid) => {
      const members = cardsByGroup.get(gid);
      if (!members || !members.length) return null;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const m of members) {
        const r = liveRect(m.id) || m;
        if (r.x < minX) minX = r.x;
        if (r.y < minY) minY = r.y;
        if (r.x + r.w > maxX) maxX = r.x + r.w;
        if (r.y + r.h > maxY) maxY = r.y + r.h;
      }
      if (!Number.isFinite(minX)) return null;
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    };
    return { cardById, liveRect, resolveGroupBBox };
  }, [cardById, cardsByGroup, drag, resize, multiResize]);

  // Per-arrow attachment points (handles fan-out when multiple arrows
  // share an anchor side). Keyed by array index; falsy entries mean the
  // arrow has missing endpoints and shouldn't render. Depends on `cards`
  // (in addition to arrows + arrowCtx) so endpoint moves re-fire the
  // computation — cardById has stable identity now and won't trigger by
  // itself.
  // Remembers each arrow's resolved attachment side (keyed by stable arrow key)
  // across renders so a small card nudge can't flip the side / reshuffle fan-out
  // every frame — see the hysteresis in computeArrowAttachments.
  const arrowSidesRef = useRef(null);
  const arrowAttachments = useMemo(
    () => {
      const _t0 = perf.isEnabled() ? performance.now() : 0;
      const out = computeArrowAttachments(arrows || [], arrowCtx, arrowSidesRef.current);
      // Feed the resolved sides back next render. Idempotent (stable keys), so
      // assigning the ref from inside the memo is safe under double-invoke.
      if (out && out.sides) arrowSidesRef.current = out.sides;
      perf.bump('arrows.runs');
      if (_t0) perf.mark('arrows.ms', performance.now() - _t0);
      return out;
    },
    [arrows, arrowCtx, cards]
  );

  // The source endpoint's rect (card or group bbox) while drawing an arrow —
  // used as the rubber-band's start so the preview leaves the card edge.
  const arrowFromRect = useMemo(() => {
    const ref = arrowFrom;
    if (!ref) return null;
    if (typeof ref === 'string') { const c = cardById[ref]; return c ? { x: c.x, y: c.y, w: c.w, h: c.h } : null; }
    if (ref.type === 'card' && ref.id) { const c = cardById[ref.id]; return c ? { x: c.x, y: c.y, w: c.w, h: c.h } : null; }
    if (ref.type === 'group' && ref.id) { const g = groupBoundsById[ref.id]; return g ? { x: g.x, y: g.y, w: g.w, h: g.h } : null; }
    return null;
  }, [arrowFrom, cardById, groupBoundsById]);

  // Rect list used as obstacles when shaping each arrow's bezier. Includes
  // every card; per-arrow we then drop its own endpoints (and any group
  // members for a group-anchored end) before handing the list to the
  // geometry helper.
  const arrowObstacleRects = useMemo(() => {
    return (cards || []).map(c => ({ id: c.id, x: c.x, y: c.y, w: c.w, h: c.h }));
  }, [cards]);

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
    // Read live pan/zoom refs (not debounced state) so the conversion always
    // matches the currently-rendered transform. State lags refs by up to 140ms
    // after any wheel/trackpad pan or pinch (scheduleCommit), which otherwise
    // offsets every placement (e.g. right-click → Add) made in that window.
    const px = panRef.current.x, py = panRef.current.y, z = zoomRef.current;
    return {
      x: (clientX - rect.left - px) / z,
      y: (clientY - rect.top  - py) / z,
    };
  }, []);

  // Track the cursor (in canvas space) while an arrow source is chosen so we can
  // draw a live rubber-band from the source to the pointer until the second
  // click lands. Only armed in arrow-tool + source-picked state. Defined after
  // clientToCanvas so its dependency isn't referenced in the TDZ.
  useEffect(() => {
    if (selectedTool !== 'arrow' || !arrowFrom) { setArrowCursor(null); return; }
    const onMove = (ev) => setArrowCursor(clientToCanvas(ev.clientX, ev.clientY));
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [selectedTool, arrowFrom, clientToCanvas]);

  // Mobile create: the phone bottom-nav "+" dispatches this document event
  // (it can't reach the canvas mutators directly). We open the full add sheet
  // anchored at the viewport centre; each picked action creates its card there
  // and stamps noteCreateIntent('mobile_nav') so first-card activation still
  // counts for whatever type the user chooses.
  // BOTH gates are load-bearing: the nav hides the "+" on read-only boards,
  // but the add mutators have NO internal permission check, and a CustomEvent
  // can be dispatched by anything, so the canEdit guard here is the actual
  // enforcement. The boardId match keeps a split-pane dispatch from opening
  // the sheet on the wrong pane.
  // pickPhotosAt is declared further down (it needs ingestFiles); the ref keeps
  // these early listeners on the CURRENT closure without TDZ'd deps arrays.
  const pickPhotosAtRef = useRef(null);
  useEffect(() => {
    const onAdd = (e) => {
      if (e.detail?.boardId !== board.id) return;
      if (!canEdit) return;
      if (document.body.dataset.tourActive === '1') return;   // guided tour owns input
      const rect = wrapRef.current?.getBoundingClientRect();
      const pos = rect
        ? clientToCanvas(rect.left + rect.width / 2, rect.top + rect.height / 2)
        : { x: 200, y: 200 };
      // First-card moment (empty board): skip the type-picker sheet and open the
      // photo picker immediately — one obvious tap, not a second decision. This
      // used to drop a text note, but ZERO note-only users have ever activated;
      // images are the activation signal and the camera roll is the phone's
      // superpower. (cardsRef stays fresh without re-binding this listener.)
      // Non-empty boards keep the full add sheet so power users get the picker.
      if ((cardsRef.current || []).length === 0) {
        noteCreateIntent('mobile_nav');
        pickPhotosAtRef.current?.(pos, 'plus_empty');
        return;
      }
      setMobileAdd({ pos });
    };
    document.addEventListener('soleil-mobile-add-card', onAdd);
    return () => document.removeEventListener('soleil-mobile-add-card', onAdd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.id, canEdit]);

  // Guided-tour "Add photos" (the content step's touch action): App dispatches
  // this when the pill button is tapped. Deliberately NOT gated on the tour
  // lock — unlike soleil-mobile-add-card, the tour itself is the sender here.
  useEffect(() => {
    const onPick = (e) => {
      if (e.detail?.boardId !== board.id) return;
      if (!canEdit) return;
      const rect = wrapRef.current?.getBoundingClientRect();
      const pos = rect
        ? clientToCanvas(rect.left + rect.width / 2, rect.top + rect.height / 2)
        : { x: 200, y: 200 };
      pickPhotosAtRef.current?.(pos, 'tour');
    };
    document.addEventListener('soleil-pick-photos', onPick);
    return () => document.removeEventListener('soleil-pick-photos', onPick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.id, canEdit]);

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
  // Live current-board id so an in-flight upload can tell if the user switched
  // boards before it finished (and avoid patching the wrong board's card).
  const boardIdRef = useRef(board?.id);
  boardIdRef.current = board?.id;

  // Roll back an optimistic card on upload failure. 402 (over quota) / 403 (not
  // a paid owner) open the upgrade prompt; anything else is a plain error toast.
  // Defined above the optimistic drop handlers so all of them can list it as a
  // dependency — every upload path must funnel through here, or a rejection
  // silently loses both the upgrade prompt and the upload_blocked event.
  const handleUploadReject = useCallback((err, id, dropBoardId) => {
    // Silent (off-stack) rollback: the failed upload is not a user action,
    // so Cmd+Z must not resurrect the dead card.
    if (boardIdRef.current === dropBoardId) mutators.deleteCardsSilent?.([id]);
    const upsell = onRequestStorageUpgrade || onRequestUpgrade;
    if (err?.code === 402 || err?.code === 403) {
      try {
        logEvent(EV.UPLOAD_BLOCKED, {
          reason: err.code === 402 ? 'server_quota' : 'server_403',
          surface: 'canvas', n: 1, ext: null, size_bucket: null,
        });
      } catch (_) {}
    }
    // Owner-pays: the server gate (authorize_upload / quota) keyed on the
    // OWNER's plan. Pitch the upgrade only when the actor IS the owner —
    // a collaborator's own plan is irrelevant and upgrading it cannot
    // unblock the board (the client-side pre-block one branch up already
    // makes this distinction; the server-rejection path must match).
    if (err?.code === 402) {
      if (ownsWorkspace) upsell?.();
      feedback.toast({
        type: 'warning',
        message: ownsWorkspace
          ? "You're out of storage. Upgrade for more space."
          : "This cluster's owner is out of storage — they'll need to upgrade for more space.",
      });
    } else if (err?.code === 403) {
      if (ownsWorkspace) upsell?.();
      feedback.toast({
        type: 'warning',
        message: ownsWorkspace
          ? 'Uploading files needs a paid plan — upgrade to add any file type.'
          : "Uploading that file needs the cluster's owner to be on a paid plan.",
      });
    } else if (String(err?.message) !== 'aborted') {
      feedback.toast({ type: 'error', message: 'Upload failed: ' + (err?.message || err) });
    }
  }, [mutators, onRequestUpgrade, onRequestStorageUpgrade, feedback, ownsWorkspace]);

  // Place the drop rect (w×h) centered on (cx, cy), clamped to the viewport.
  //
  // `rect` is an already-computed placement, and it WINS. A multi-file drop is
  // laid out as one block before any card is created; clamping each card to the
  // viewport individually afterwards is precisely what used to pile a dozen
  // photographs on top of each other at the right-hand edge.
  const placeDropRect = useCallback((cx, cy, w, h, rect = null) => {
    if (rect && Number.isFinite(rect.x) && Number.isFinite(rect.y)) {
      return { x: Math.round(rect.x), y: Math.round(rect.y), w: rect.w || w, h: rect.h || h };
    }
    let bounds = null;
    const wrap = wrapRef.current;
    if (wrap) {
      const r = wrap.getBoundingClientRect();
      const tl = clientToCanvas(r.left, r.top);
      const br = clientToCanvas(r.right, r.bottom);
      bounds = { minX: tl.x + 8, minY: tl.y + 8, maxX: br.x - 8, maxY: br.y - 8 };
    }
    return clampDropRect({ x: cx - w / 2, y: cy - h / 2, w, h }, bounds);
  }, [clientToCanvas]);

  const optimisticDropImage = useCallback(async (file, cx, cy, rect = null) => {
    if (!file) return;
    const dropBoardId = board?.id;
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
    // Decode ONCE, bounded + gated: a single downscaled preview blob (the
    // full-res decode is released immediately) instead of painting the raw
    // multi-MB original AND a second decode for dims. Concurrency-capped so a
    // multi-file drop doesn't decode every photo at once and freeze the tab.
    let blobUrl = null;
    let dims = { width: 0, height: 0 };
    try {
      const prev = await imageDecodeLimiter(() => makeBoundedPreview(file));
      if (prev) {
        dims = { width: prev.width, height: prev.height };
        try { blobUrl = URL.createObjectURL(prev.blob); } catch (_) {}
      }
    } catch (_) {}
    // Last-resort fallback if the bounded decode failed entirely — keep the
    // original optimistic preview rather than showing a blank card.
    if (!blobUrl) { try { blobUrl = URL.createObjectURL(file); } catch (_) {} }
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
    // Keep the whole card on-screen even when dropped near the right/bottom edge.
    const placed = placeDropRect(cx, cy, w, h, rect);
    // src omitted here — blob URLs aren't useful to peers, so we keep the
    // doc clean and let localImagePreview drive the local view.
    mutators.addCard?.({
      id, kind: 'image',
      x: placed.x, y: placed.y,
      w, h,
      pending: true,
    });
    try {
      const onProgress = (frac) => {
        setUploadProgressById(prev => ({ ...prev, [id]: frac }));
      };
      const up = await uploadImage({ file, workspaceId, boardId: board?.id, cardId: id, userId, onProgress });
      // If the user navigated to a different board mid-upload, the active
      // mutators no longer target the board this card lives on — skip the
      // patch (the abandoned-pending sweep cleans the card on next open).
      if (boardIdRef.current === dropBoardId) {
        // Silent (origin 'upload'): the async src patch must not be its own
        // undo step, or Cmd+Z first "peels" the image back to pending
        // before a second Cmd+Z removes the card (the list-drop path has
        // always done this — the canvas path had drifted).
        mutators.updateCardSilent?.(id, { src: up.src, pending: false });
      }
    } catch (err) {
      console.error('image upload failed', err);
      // Shared handler: rolls the optimistic card back AND, for 402/403, opens
      // the upgrade prompt and logs upload_blocked. This used to be a bespoke
      // error toast, so an over-quota image drop — the one upload failure that
      // is actually a sales moment — showed a red "failed" message with no
      // upgrade path and no telemetry.
      handleUploadReject(err, id, dropBoardId);
    } finally {
      setUploadProgressById(prev => { const { [id]: _drop, ...rest } = prev; return rest; });
      setLocalImagePreview(prev => { const { [id]: _drop, ...rest } = prev; return rest; });
      if (blobUrl) { try { URL.revokeObjectURL(blobUrl); } catch (_) {} }
    }
  }, [useLocalImages, workspaceId, board?.id, userId, feedback, mutators, onDropFileImage, handleUploadReject]);

  // Drop a PDF: add a pending card immediately, then upload + render the
  // page-1 thumbnail in the background (same optimistic pattern as images).
  // Distinct `pdf-` id prefix so card_index's `img-` src-recovery heuristics
  // don't mistake it for an image.
  const optimisticDropPdf = useCallback(async (file, cx, cy, rect = null) => {
    if (!file) return;
    const dropBoardId = board?.id;
    const id = `pdf-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    let w = 300, h = 388; // portrait fallback; corrected from real page-1 dims
    const placed = placeDropRect(cx, cy, w, h, rect);

    if (useLocalImages) {
      // Local QA — no backend. Point the viewer straight at a blob URL
      // (resolveSrc passes non-r2: through unchanged; pdf.js loads blob URLs).
      let blobUrl = null;
      try { blobUrl = URL.createObjectURL(file); } catch (_) {}
      mutators.addCard?.({ id, kind: 'pdf', pdfSrc: blobUrl, src: null, name: file.name || 'PDF',
                           x: placed.x, y: placed.y, w, h });
      return;
    }

    mutators.addCard?.({ id, kind: 'pdf', name: file.name || 'PDF',
                         x: placed.x, y: placed.y, w, h, pending: true });
    try {
      const onProgress = (frac) => setUploadProgressById(prev => ({ ...prev, [id]: frac }));
      const up = await uploadPdf({ file, workspaceId, boardId: board?.id, cardId: id, userId, onProgress });
      if (boardIdRef.current === dropBoardId) {
        mutators.updateCardSilent?.(id, {
          src: up.src, pdfSrc: up.pdfSrc, pageCount: up.pageCount,
          name: up.name, w: up.w, h: up.h, pending: false,
        });
      }
    } catch (err) {
      console.error('pdf upload failed', err);
      // Same shared handler as the image path — PDFs presign through the same
      // route, so they hit the same over-quota rejection and need the same
      // upgrade prompt rather than a dead-end error toast.
      handleUploadReject(err, id, dropBoardId);
    } finally {
      setUploadProgressById(prev => { const { [id]: _drop, ...rest } = prev; return rest; });
    }
  }, [useLocalImages, workspaceId, board?.id, userId, feedback, mutators, clientToCanvas, handleUploadReject]);

  // Any file type → a generic, downloadable file card. Uploads via multipart
  // (boards/src/lib/uploads.js uploadFile), which gates on paid-owner + storage
  // quota server-side. Mirrors optimisticDropPdf's optimistic add → update → roll
  // back on failure.
  const optimisticDropFile = useCallback(async (file, cx, cy, rect = null) => {
    if (!file) return;
    const dropBoardId = board?.id;
    const id = `file-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const w = 240, h = 150;
    const placed = placeDropRect(cx, cy, w, h, rect);
    const ext = (file.name?.split('.').pop() || '').toLowerCase();

    if (useLocalImages) {
      // Local QA — no backend. resolveSrc passes a non-r2: blob URL through.
      let blobUrl = null; try { blobUrl = URL.createObjectURL(file); } catch (_) {}
      mutators.addCard?.({ id, kind: 'file', fileSrc: blobUrl, fileName: file.name,
                           mime: file.type, sizeBytes: file.size, ext, x: placed.x, y: placed.y, w, h });
      return;
    }

    mutators.addCard?.({ id, kind: 'file', fileName: file.name, mime: file.type,
                         sizeBytes: file.size, ext, x: placed.x, y: placed.y, w, h, pending: true });
    try {
      const onProgress = (frac) => setUploadProgressById(prev => ({ ...prev, [id]: frac }));
      const up = await uploadFile({ file, workspaceId, boardId: board?.id, cardId: id, userId, onProgress });
      if (boardIdRef.current === dropBoardId) {
        mutators.updateCardSilent?.(id, {
          fileSrc: up.src, fileName: up.fileName, mime: up.mime, sizeBytes: up.sizeBytes, ext: up.ext, pending: false,
        });
      }
    } catch (err) {
      console.error('file upload failed', err);
      handleUploadReject(err, id, dropBoardId);
    } finally {
      setUploadProgressById(prev => { const { [id]: _drop, ...rest } = prev; return rest; });
    }
  }, [useLocalImages, workspaceId, board?.id, userId, mutators, placeDropRect, handleUploadReject]);

  // Over-cap video/audio (paid only) → still an inline media card, but uploaded
  // via multipart so big files upload reliably + count against the quota.
  const dropLargeMedia = useCallback(async (file, kind, cx, cy, rect = null) => {
    if (!file) return;
    const dropBoardId = board?.id;
    let w, h, extra = {};
    if (kind === 'video') {
      const meta = await readVideoMeta(file);
      w = Math.max(240, Math.min(560, meta.w || 360));
      const aspect = meta.h && meta.w ? (meta.h / meta.w) : 9 / 16;
      h = Math.max(160, Math.round(w * aspect));
    } else {
      const meta = await readAudioMeta(file);
      w = 380; h = 130; extra = { title: file.name || 'Audio', duration: meta.duration || null };
    }
    const id = `${kind === 'video' ? 'vid' : 'aud'}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const placed = placeDropRect(cx, cy, w, h, rect);
    mutators.addCard?.({ id, kind, x: placed.x, y: placed.y, w, h, pending: true, ...extra });
    try {
      const onProgress = (frac) => setUploadProgressById(prev => ({ ...prev, [id]: frac }));
      const up = await uploadFile({ file, workspaceId, boardId: board?.id, cardId: id, userId, onProgress });
      if (boardIdRef.current === dropBoardId) mutators.updateCardSilent?.(id, { src: up.src, pending: false });
      // Poster from the local File, not from a re-download. Without this the
      // card is posterless until useVideoPosterBackfill rescues it by fetching
      // the whole clip back — and this route exists precisely for the clips too
      // big to want that. After the src patch so playback is never gated on it.
      if (kind === 'video') {
        const poster = await captureAndUploadPoster({ file, workspaceId, boardId: dropBoardId, userId });
        if (poster && boardIdRef.current === dropBoardId) mutators.updateCardSilent?.(id, { poster });
      }
    } catch (err) {
      console.error('large media upload failed', err);
      handleUploadReject(err, id, dropBoardId);
    } finally {
      setUploadProgressById(prev => { const { [id]: _drop, ...rest } = prev; return rest; });
    }
  }, [workspaceId, board?.id, userId, mutators, placeDropRect, handleUploadReject]);

  // Upload a video file and place a video card centered on (cx, cy).
  // Validates duration via uploadVideo (default cap 60s, 30 MB). Toast
  // surfaces upload errors.
  const dropVideoFile = useCallback(async (file, cx, cy, allowLong = false, rect = null) => {
    if (!workspaceId) throw new Error('workspaceId required');
    // Paid uploads (allowLong) drop the free-tier 60s clip cap; the byte cap is
    // moot here (this path only handles ≤ the free byte cap — larger goes
    // through dropLargeMedia/multipart).
    const up = await uploadVideo({ file, workspaceId, boardId: board?.id, userId,
                                   ...(allowLong ? { maxDurationSec: Number.POSITIVE_INFINITY } : {}) });
    const w = Math.max(240, Math.min(560, up.width || 360));
    const aspect = up.height && up.width ? (up.height / up.width) : 9 / 16;
    const h = Math.max(160, Math.round(w * aspect));
    mutators.addCard?.({
      id: `vid-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      kind: 'video',
      src: up.src,
      ...(up.poster ? { poster: up.poster } : {}),
      x: rect && Number.isFinite(rect.x) ? Math.round(rect.x) : Math.round(cx - w / 2),
      y: rect && Number.isFinite(rect.y) ? Math.round(rect.y) : Math.round(cy - h / 2),
      w, h,
    });
  }, [workspaceId, board?.id, userId, mutators]);

  // Audio file → audio card centered on (cx, cy). Default size matches
  // a compact waveform; the card carries the duration for instant later
  // renders. 50 MB cap enforced inside uploadAudio.
  const dropAudioFile = useCallback(async (file, cx, cy, rect = null) => {
    if (!workspaceId) throw new Error('workspaceId required');
    const up = await uploadAudio({ file, workspaceId, boardId: board?.id, userId });
    const w = 380, h = 130;
    mutators.addCard?.({
      id: `aud-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      kind: 'audio',
      src: up.src,
      title: file.name || 'Audio',
      duration: up.duration || null,
      x: rect && Number.isFinite(rect.x) ? Math.round(rect.x) : Math.round(cx - w / 2),
      y: rect && Number.isFinite(rect.y) ? Math.round(rect.y) : Math.round(cy - h / 2),
      w, h,
    });
  }, [workspaceId, board?.id, userId, mutators]);

  // Route a FileList onto the canvas, centered at (cx, cy). Shared by drag-drop,
  // the right-click "Add → File" entry, and the toolbar "+" menu so all three
  // dispatch identically: images / within-cap media use the free single-PUT
  // path; over-cap media + any other file type are the paid "upload anything"
  // feature (multipart, server-gated on paid-owner + storage quota). The client
  // pre-check only hard-blocks the unambiguous case (you own this workspace and
  // you're not paid); shared workspaces attempt optimistically and let the
  // server's 402/403 decide.
  const ingestFiles = useCallback(async (fileList, cx, cy, source = 'drop') => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const canAttemptFiles = !(ownsWorkspace && !isPaidPlan);
    const blockedForUpgrade = [];

    // Classify everything FIRST, then lay the whole drop out as one block.
    //
    // This used to be an unbounded horizontal stagger — `cx + offsetX` with
    // offsetX growing 260px per file — so twenty photographs marched 5,200px
    // to the right, and everything past the viewport edge was clamped into a
    // pile on top of itself. The list-view drop has always used a real packer;
    // the canvas simply never did.
    const accepted = [];
    for (const f of files) {
      // Shared routing/caps (lib/fileIngest.js) so canvas + list agree.
      const c = classifyDropFile(f, { canAttemptFiles });
      if (c.route === 'blocked') { blockedForUpgrade.push(f); continue; }
      accepted.push({ file: f, ...c });
    }

    const kinds = {};
    for (const it of accepted) kinds[it.kind] = (kinds[it.kind] || 0) + 1;
    const classified = accepted.length;

    // Cap preflight, BEFORE anything is measured, uploaded or placed.
    //
    // This path had no cap check whatsoever — the list path always sliced, the
    // canvas simply never did — so an over-cap folder rendered in full,
    // uploaded in full, and was withdrawn by the server trigger seconds later.
    // The live traces all end the same way: a folder of a hundred-odd photos
    // dropped minutes after signup, and a user left holding a fraction of it —
    // a count BELOW their own cap, because the batch had not merely overflowed,
    // it had failed whole. None of them came back.
    //
    // `take` is authoritative. The mutator resolves the cap (rather than
    // reading an unloaded tier as "uncapped", which is what let those batches
    // through), asks the user when the folder only partly fits, and answers
    // with how many may be placed. 0 means it has already surfaced the wall or
    // the user declined — there is nothing left to do but the blocked-file
    // toast below.
    let over = 0;
    if (classified && mutators.preflightImport) {
      const { take } = await mutators.preflightImport({ n: classified, kinds, source }) || {};
      const keep = Math.max(0, Math.min(classified, Number(take) || 0));
      over = classified - keep;
      if (keep < classified) accepted.splice(keep);
    }

    // One row for the whole gesture. Every other signal here is per-card, and
    // per-card rows cannot answer "was this one drop of ten or ten drops of
    // one" — the image route adds each file separately, so a ten-file selection
    // is ten identical card_placed{n:1} rows. That distinction is the point of
    // the measurement.
    //
    // Logged AFTER the preflight so `n_over` is a real number rather than a
    // guess. That costs nothing: if the user abandons the dialog this row never
    // lands, but import_preflight{action:'view'} already fired, so the gesture
    // is never invisible. `n_files` still means what the user chose and
    // `n_accepted` still means what passed classification — the pair that
    // reported a whole folder accepted for a user who ended up holding a
    // fraction of it. `n_over` is the cap's share of that gap.
    try {
      logEvent(EV.IMPORT_BATCH, {
        n_files: files.length,
        n_accepted: classified,
        n_over: over,
        n_blocked: blockedForUpgrade.length,
        source,
        kinds,
        board_id: board?.id || null,
      });
    } catch (_) {}

    if (accepted.length) {
      // Real dimensions before layout, not after: laying out at the fallback
      // size and then letting each card resize itself is what makes a drop
      // visibly jump. Same measurement the list path uses, so the two agree.
      await Promise.all(accepted.map(async (it) => {
        try {
          if (it.route === 'image') {
            const d = await readImageDims(it.file);
            if (d.width && d.height) { const f = fitImageDims(d.width, d.height); it.w = f.w; it.h = f.h; }
          } else if (it.kind === 'video') {
            const meta = await readVideoMeta(it.file);
            if (meta?.w) {
              const w = Math.max(240, Math.min(560, meta.w || 360));
              it.w = w;
              it.h = Math.max(160, Math.round(w * (meta.h && meta.w ? meta.h / meta.w : 9 / 16)));
            }
          }
        } catch (_) { /* keep the fallback dims from classifyDropFile */ }
      }));

      // A mixed drop keeps the uniform grid — an image beside a PDF beside an
      // audio clip reads as a matrix. All photographs get justified rows.
      const allImages = accepted.every((it) => it.route === 'image');
      const rects = layoutDrop(accepted, {
        at: { x: cx, y: cy },
        layout: allImages ? 'justified' : 'grid',
      });

      for (let i = 0; i < accepted.length; i++) {
        const { file: f, route, kind } = accepted[i];
        const rect = rects[i];
        const rcx = rect.x + rect.w / 2;
        const rcy = rect.y + rect.h / 2;
        try {
          if (route === 'image') {
            // Optimistic — adds the card and uploads in the background so
            // multi-file drops aren't blocked one at a time.
            optimisticDropImage(f, rcx, rcy, rect);
          } else if (route === 'video') {
            await dropVideoFile(f, rcx, rcy, canAttemptFiles, rect);
          } else if (route === 'audio') {
            await dropAudioFile(f, rcx, rcy, rect);
          } else if (route === 'pdf') {
            optimisticDropPdf(f, rcx, rcy, rect);
          } else if (route === 'largeMedia') {
            // Over-cap clip — still an inline media card, uploaded via multipart.
            dropLargeMedia(f, kind, rcx, rcy, rect);
          } else {
            // PDFs over the inline cap + every other type → downloadable file card.
            optimisticDropFile(f, rcx, rcy, rect);
          }
        } catch (err) {
          console.error(err);
          feedback.toast({ type: 'error', message: 'Upload failed: ' + (err.message || err) });
        }
      }
    }

    if (blockedForUpgrade.length) {
      (onRequestStorageUpgrade || onRequestUpgrade)?.();
      try {
        const biggest = blockedForUpgrade.reduce((m, f) => Math.max(m, f?.size || 0), 0);
        logEvent(EV.UPLOAD_BLOCKED, {
          reason: 'owner_not_paid', surface: 'canvas', n: blockedForUpgrade.length,
          ext: (blockedForUpgrade[0]?.name || '').split('.').pop()?.toLowerCase()?.slice(0, 12) || null,
          size_bucket: sizeBucket(biggest),
        });
      } catch (_) {}
      feedback.toast({
        type: 'warning',
        message: `Uploading ${blockedForUpgrade.length === 1 ? 'that file' : 'large or non-standard files'} needs a paid plan — upgrade to add any file type, up to 100GB.`,
        ttl: 6000,
      });
    }
  }, [ownsWorkspace, isPaidPlan, optimisticDropImage, dropVideoFile, dropAudioFile,
      optimisticDropPdf, dropLargeMedia, optimisticDropFile, onRequestStorageUpgrade,
      onRequestUpgrade, feedback, board?.id, mutators]);

  // Unified "Add → File" picker: opens a native file chooser with NO accept
  // filter (any type) and routes the chosen file(s) through ingestFiles — the
  // same dispatch as drag-drop, so a picked PDF still becomes a PDF card, an
  // image an image card, a clip a media card, anything else a generic file
  // card. `pos` is a canvas coordinate (from the click point / viewport center).
  const openFilePicker = useCallback((pos) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = () => {
      if (input.files && input.files.length) {
        ingestFiles(input.files, pos?.x ?? 200, pos?.y ?? 200, 'picker');
      }
    };
    input.click();
  }, [ingestFiles]);

  // Camera-roll-first photo picker: accept="image/*" keeps the OS chooser on
  // the photo library (camera roll on iOS/Android), multi-select routes through
  // the same batch ingest as drag-drop (per-image offsets, caps, optimistic
  // cards). Images are THE activation signal — this is the mobile primary path.
  // `source` tags where the pick started so we can measure adoption + the
  // multi-select depth (n_selected) that turns one photo into a populated board.
  const pickPhotosAt = useCallback((pos, source = 'unknown') => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    try { logEvent(EV.PHOTO_PICK_OPEN, { source, board_id: board?.id }); } catch (_) {}
    input.onchange = async () => {
      const n = input.files ? input.files.length : 0;
      if (!n) return;
      try { logEvent(EV.PHOTO_PICK_COMMIT, { n_selected: n, source, board_id: board?.id }); } catch (_) {}
      // Genuine cards on the board BEFORE this batch (cardsRef hasn't re-synced
      // the optimistic adds yet, so add `n` to project the post-batch count).
      const before = genuineCards(cardsRef.current || []).length;
      await ingestFiles(input.files, pos?.x ?? 200, pos?.y ?? 200, 'photo_picker');
      // Momentum beat: on a phone, right after the first photo(s) land while
      // still short of a populated board (<3), nudge to add a few more —
      // tapping re-opens the multi-select. Once per device; never during a tour
      // (the tour owns its own beat) and never for the momentum re-pick itself.
      const after = before + n;
      const tourPill = document.body.dataset.tourActive === '1' || !!document.body.dataset.tourVariant;
      if (isPhone && canEdit && source !== 'momentum' && !tourPill && !momentumHintSeen() && after < 3) {
        markMomentumHintSeen();
        try { logEvent(EV.MOMENTUM_NUDGE_SHOWN, { board_id: board?.id, after }); } catch (_) {}
        feedback.toast({
          message: 'Nice start — boards get good at 3+. Add a few more?',
          ttl: 6000,
          action: { label: 'Add more', onClick: () => pickPhotosAtRef.current?.(pos, 'momentum') },
        });
      }
    };
    input.click();
  }, [ingestFiles, board?.id, isPhone, canEdit, feedback]);
  pickPhotosAtRef.current = pickPhotosAt;

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

  // Wheel: what a plain wheel does depends on Settings → Display → Scroll
  // wheel. Default 'pan' (cmd-wheel zooms) is what always shipped; 'zoom'
  // swaps them. The whole modifier matrix lives in resolveWheelIntent — see
  // lib/wheelMode.js, and note that ctrl+wheel means zoom in BOTH modes
  // because that is how a trackpad pinch reaches the page.
  //
  // getWheelMode() is a synchronous module read on purpose: this effect has an
  // empty dependency array (see below) and must keep it, so the preference can
  // never be a captured closure value.
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
        // Gesture settled: end ADD-only cull mode and run one strict
        // recompute to prune. Explicit call — the pan/zoom layout effect
        // only re-runs when the VALUES change, so a clamped or
        // returned-to-origin gesture would otherwise never prune.
        gestureUntilRef.current = 0;
        markGestureActiveUntil(0);
        setPerfContext({ zoom: zoomRef.current });
        setPan({ x: panRef.current.x, y: panRef.current.y });
        setZoom(zoomRef.current);
        scheduleVisibleRecompute();
        emitCanvasSettle();
      }, 140);
    };
    const onWheel = (e) => {
      if (e.target.closest && e.target.closest('.inbox, .ctx-menu, .modal-bg, .modal, .twk-panel, .tob, .cnv-tpl-panel')) return;
      // Public pages are pinned to pan semantics whatever the reader's own
      // preference says. They are scrollable documents — a canvas hero with an
      // article under it — so a plain wheel has to scroll the PAGE, and a
      // visitor carrying wheelMode:'zoom' in localStorage from the app would
      // otherwise find the article unreachable.
      const wheelMode = isPublic ? 'pan' : getWheelMode();
      const intent = resolveWheelIntent({
        mode: wheelMode,
        ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey,
        deltaX: e.deltaX, deltaY: e.deltaY,
      });
      // Someone fighting the canvas — scrolling down expecting zoom, watching it
      // pan, scrolling back, repeating — gets told once that the gesture is
      // configurable. Only in pan mode, only for plain wheels, only ever once.
      // See lib/wheelHint.js for why reversals rather than volume.
      if (wheelMode === 'pan' && !isPublic && !wheelHintSeen()) {
        const out = trackWheelFrustration(wheelFrustrationRef.current, {
          t: performance.now(),
          deltaX: e.deltaX, deltaY: e.deltaY,
          ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey,
        });
        wheelFrustrationRef.current = out.state;
        if (out.fire) {
          markWheelHintSeen();
          feedbackRef.current?.toast({
            type: 'info',
            message: `Scrolling pans the canvas. ${isMac ? '⌘' : 'Ctrl'}-scroll zooms — or switch the wheel to zoom in Settings → Display.`,
            ttl: 7000,
          });
          try { logEvent(EV.WHEEL_HINT_SHOWN, { board_id: boardIdRef.current }); } catch (_) {}
        }
      }
      // Wheel over a SELECTED or EDITING note whose text overflows scrolls
      // the note's text instead of panning the canvas (you could otherwise
      // never wheel-scroll a clipped note — the canvas panned and flung the
      // note off-screen mid-edit). Early-return → no preventDefault → the
      // browser performs its native overflow scroll on .note-body
      // (overflow:auto in both edit and display modes). There are no other
      // scrollable ancestors between the body and the wrap, so nothing
      // chain-scrolls into a page scroll; at the note's scroll end the
      // wheel simply does nothing — predictable editor feel. Ctrl/Cmd+wheel
      // still ZOOMS even over a note: zoom is a canvas-level gesture and
      // the browser's own ctrl+wheel page-zoom must stay preventDefault'ed.
      // The |deltaY| >= |deltaX| clause keeps horizontal trackpad pans
      // working over notes (note text can't overflow horizontally).
      //
      // The note only takes an UNMODIFIED wheel — a modified one is addressed
      // to the canvas. Which modifiers count is mode-dependent: cmd/ctrl are
      // the canvas's in pan mode, and zoom mode adds alt and shift because
      // those are its pan gestures.
      //
      // In ZOOM mode the note-scroll narrows to a note actually being EDITED.
      // The caret is in that text and zooming the board out from under it is
      // never right. But a clipped note you merely SELECTED should zoom like
      // the rest of the board — otherwise the gesture you just switched on
      // stops working over every note you happen to have clicked.
      const wheelModified = wheelMode === 'zoom'
        ? (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey)
        : (e.ctrlKey || e.metaKey);
      if (!wheelModified && e.target.closest) {
        const body = e.target.closest('.note-body');
        if (body && body.scrollHeight > body.clientHeight + 1 &&
            Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
          const isEditing = !!body.closest('.note')?.classList.contains('is-editing');
          const isSelected = !!body.closest('.card')?.classList.contains('is-selected');
          if (isEditing || (isSelected && wheelMode === 'pan')) return;
        }
      }
      // Public pages are scrollable documents (canvas hero + article below):
      // a plain wheel scrolls the PAGE — standard embedded-canvas behavior —
      // while zoom stays on ctrl/cmd+wheel and panning on drag/pinch. Early
      // return → no preventDefault → the browser scrolls. isPublic is constant
      // for a mount, so the [] closure capture is safe.
      if (isPublic && !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      perf.bump('wheel.events');
      // Round 17: time the JS-side cost of zoom handling. A 'first-zoom
      // hitch' may be JS (this number high) or browser compositor (this
      // number low, but DevTools trace still shows a long task).
      const _isZoom = intent === 'zoom';
      const _tZ = (_isZoom && perf.isEnabled()) ? performance.now() : 0;
      const rect = el.getBoundingClientRect();
      const curPan = panRef.current;
      const curZoom = zoomRef.current;
      if (intent === 'zoom') {
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
      gestureUntilRef.current = performance.now() + 200; // ADD-only cull while zoom/scroll is live
      markGestureActiveUntil(gestureUntilRef.current);
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
      // Gesture settled — see scheduleCommit for the prune contract.
      gestureUntilRef.current = 0;
      markGestureActiveUntil(0);
      setPerfContext({ zoom: zoomRef.current });
      setPan({ x: panRef.current.x, y: panRef.current.y });
      setZoom(zoomRef.current);
      scheduleVisibleRecompute();
      emitCanvasSettle();
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
        gestureUntilRef.current = performance.now() + 200; // ADD-only cull while pinching
        markGestureActiveUntil(gestureUntilRef.current);
        markCanvasInteracting();  // immersive look-around (auto-hide chrome)
        markZooming();            // reveal the zoom widget while pinching
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
        gestureUntilRef.current = performance.now() + 200; // ADD-only cull while two-finger panning
        markGestureActiveUntil(gestureUntilRef.current);
        markCanvasInteracting();  // immersive look-around (auto-hide chrome)
        applyCanvasTransform();
        scheduleVisibleRecompute();
        scheduleTouchPanCommit();
      },
    },
    {
      target: wrapRef,
      eventOptions: { passive: false },
      pinch: { scaleBounds: { min: ZOOM_MIN / 4, max: ZOOM_MAX * 4 }, rubberband: true },
      // `touch: true` only switches the drag engine to TouchEvents on
      // devices where use-gesture's SUPPORT.touch ('ontouchstart') is true.
      // On a touchless desktop it silently falls back to PointerEvents,
      // whose default `capture: true` called setPointerCapture on EVERY
      // left-button pointerdown inside the wrap. Capturing retargets all
      // subsequent pointer events to the pressed element, which freezes
      // the browser's native text-selection drag — selecting multiple note
      // lines by mouse stopped dead at the first line boundary (backward
      // drags ~always; forward drags raced). capture:false costs nothing:
      // onDrag above ignores non-touch pointers entirely, and on real touch
      // devices the TouchEvent path never captured to begin with. NOTE:
      // card click handling must stay correct without capture — see the
      // dragArmed comment in onCardPointerDown.
      drag: { pointer: { touch: true, capture: false }, threshold: 0 },
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
        // On editable boards with the select tool, a long-press on a card now
        // LIFTS it for dragging (handled per-gesture in onCardPointerDown) —
        // the card's "⋯" button opens the menu instead. View-only boards (no
        // lift, no ⋯ button) keep the long-press context menu.
        if (canEdit && selectedTool === 'select') return;
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
    // Plain cards don't need a confirm — the delete is one undo step and
    // the toast below offers a one-click Undo. Boards keep the dialog
    // (they can contain a whole subtree).
    return null;
  }, [cardById, boards]);

  const doDeleteIds = useCallback(async (ids, { boundary = true } = {}) => {
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
    const deleted = await mutators.deleteCards?.(ids, { boundary });
    setSelected(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.delete(id));
      return next;
    });
    // Undo toast, guarded on the delete's own stack item: if the user did
    // anything else during the toast window, the click explains instead of
    // undoing that newer action (lib/undoToast.js). Undoing also restores
    // the selection via the UndoManager's stack-item meta.
    undoToast(feedback, {
      message: ids.length === 1 ? 'Card deleted' : `${ids.length} cards deleted`,
      undoManager: mutators.undoManager,
      stackItem: deleted?.stackItem || null,
      onUndo: () => mutators.undo?.(),
    });
  }, [buildDeleteMessage, feedback, mutators, ydoc, board?.id, sessionId, userId]);

  // Delete-selected handles cards, strokes, AND arrows.
  const doDeleteSelected = useCallback(async () => {
    // One undo-step boundary for the whole delete: strokes + arrows + cards
    // are separate mutator calls but should collapse into a single Cmd+Z.
    // breakUndo() ends the prior action's merge window so the delete is its
    // own step; the leaf delete mutators deliberately DON'T call breakUndo
    // (that would fragment a mixed delete into several steps) — hence
    // boundary:false on the card leg below.
    mutators.breakUndo?.();
    const strokeArrowCount = selectedStrokes.size + selectedArrows.size;
    if (selectedStrokes.size > 0) {
      mutators.deleteStrokes?.([...selectedStrokes]);
      setSelectedStrokes(new Set());
    }
    if (selectedArrows.size > 0) {
      mutators.deleteArrows?.([...selectedArrows]);
      setSelectedArrows(new Set());
    }
    if (selected.size > 0) {
      await doDeleteIds([...selected], { boundary: false });
    } else if (strokeArrowCount > 0) {
      // Stroke/arrow-only deletes used to vanish with NO toast (doDeleteIds
      // owns the card toast and never ran) — same affordance now.
      const um = mutators.undoManager;
      const item = um?.undoStack?.length ? um.undoStack[um.undoStack.length - 1] : null;
      mutators.breakUndo?.();
      undoToast(feedback, {
        message: strokeArrowCount === 1 ? 'Deleted' : `${strokeArrowCount} deleted`,
        undoManager: um,
        stackItem: item,
        onUndo: () => mutators.undo?.(),
      });
    }
  }, [doDeleteIds, selected, selectedStrokes, selectedArrows, mutators, feedback]);

  // Single-arrow delete (context menu / arrow popover) — same one-step +
  // Undo-toast affordance as every other delete path (these used to vanish
  // silently even though Cmd+Z worked).
  const deleteSingleArrow = useCallback((idx) => {
    mutators.breakUndo?.();
    mutators.deleteArrows?.([idx]);
    const um = mutators.undoManager;
    const item = um?.undoStack?.length ? um.undoStack[um.undoStack.length - 1] : null;
    mutators.breakUndo?.();
    undoToast(feedback, {
      message: 'Arrow deleted',
      undoManager: um,
      stackItem: item,
      onUndo: () => mutators.undo?.(),
    });
  }, [mutators, feedback]);

  // ── Internal clipboard ───────────────────────────────────────────────────
  const doCopy = useCallback(() => {
    const items = [...selected].map(id => cardById[id]).filter(Boolean);
    if (items.length === 0) return;
    setClipboard(items, board.id);
  }, [selected, cardById, board.id]);

  const doCut = useCallback(async () => {
    const items = [...selected].map(id => cardById[id]).filter(Boolean);
    if (items.length === 0) return;
    setClipboard(items, board.id, { cut: true });
    mutators.breakUndo?.();
    await doDeleteIds([...selected]);
  }, [selected, cardById, board.id, doDeleteIds, mutators]);

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

    // Cross-cluster CUT-paste keeps standard clipboard semantics — the cut
    // stays undoable on the source board, this paste on this one — so say
    // where the originals went instead of leaving the two-stack behavior
    // implicit (undoing the cut over there while keeping these copies
    // duplicates, exactly like every other canvas tool).
    if (clipboardWasCut() && clipboardOrigin() && clipboardOrigin() !== board.id) {
      const srcName = boards?.[clipboardOrigin()]?.name;
      feedback.toast({
        type: 'info',
        message: `Pasted ${newCards.length === 1 ? 'a card' : `${newCards.length} cards`} cut from ${srcName ? `“${srcName}”` : 'another cluster'} — the originals stay deleted there (⌘Z there restores them).`,
      });
    }

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
          // Silent: the async preview backfill must not add an undo step
          // between the card-create and whatever the user does next.
          if (Object.keys(patch).length) mutators.updateCardSilent?.(newId, patch);
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
      // Dialog open → the board must not receive a paste (an image pasted
      // "into" the sketch pad used to land on the canvas behind it).
      if (anyModalOpen()) return;
      // Same pane arbitration as the keydown listener — a split view must not
      // paste the clipboard onto both boards.
      if (hasSplit && getActivePane() !== paneId) return;
      // 0) A grid cell is focused → paste anything INTO that cell (auto-formatted:
      //    image/file → upload, URL → link, text → text). This runs BEFORE the
      //    isEditorTarget guard on purpose: clicking a cell sets focus STATE but not
      //    DOM focus, so a stale contenteditable (a note you were just editing —
      //    clicking a non-focusable cell div doesn't blur it) would otherwise trip
      //    the guard and the image would land on the canvas. Only defer to the editor
      //    when the caret is genuinely inside THIS cell's own text editor (so native
      //    text paste into a text cell still works).
      const fc = focusedCellRef.current;
      if (fc && canEdit) {
        const ae = document.activeElement;
        let typingInThisCell = false;
        if (ae && ae.isContentEditable) {
          const cellEl = ae.closest?.('[data-cell-id]');
          typingInThisCell = cellEl?.getAttribute('data-cell-id') === fc.cellId;
        }
        if (!typingInThisCell) {
          e.preventDefault();
          await pasteIntoCell(fc.gridId, fc.cellId, e.clipboardData);
          return;
        }
      }

      if (isEditorTarget(e)) return;

      // 1) Image in OS clipboard wins outright.
      const items = e.clipboardData?.items;
      if (items) {
        for (const item of items) {
          if (item.type === 'application/pdf') {
            e.preventDefault();
            const file = item.getAsFile();
            if (file) {
              const { pos, clamped } = resolvePastePos();
              notePasteCreate(clamped);
              optimisticDropPdf(file, pos.x, pos.y);
            }
            return;
          }
          if (item.type.startsWith('image/')) {
            e.preventDefault();
            const file = item.getAsFile();
            if (file) {
              const { pos, clamped } = resolvePastePos();
              notePasteCreate(clamped);
              optimisticDropImage(file, pos.x, pos.y);
            }
            return;
          }
          // Any other file type pasted from the OS clipboard (zip, etc.) → file card.
          if (item.kind === 'file') {
            const file = item.getAsFile();
            if (file) {
              e.preventDefault();
              if (ownsWorkspace && !isPaidPlan) {
                (onRequestStorageUpgrade || onRequestUpgrade)?.();
                feedback.toast({ type: 'warning', message: 'Uploading files needs a paid plan — upgrade to add any file type.' });
              } else {
                const { pos, clamped } = resolvePastePos();
                notePasteCreate(clamped);
                optimisticDropFile(file, pos.x, pos.y);
              }
              return;
            }
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

      const { pos, clamped } = resolvePastePos();
      const urlMatch = text.match(/^\s*(https?:\/\/\S+)\s*$/i);

      // 4) Bare URL → link / embed card.
      if (urlMatch) {
        e.preventDefault();
        notePasteCreate(clamped);
        createLinkCardFromUrl(urlMatch[1], pos);
        return;
      }

      // 5) Any other non-empty text → note card.
      if (text.trim().length > 0) {
        e.preventDefault();
        notePasteCreate(clamped);
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
  }, [feedback, optimisticDropImage, optimisticDropPdf, optimisticDropFile, doPaste, mutators,
      ownsWorkspace, isPaidPlan, onRequestUpgrade, onRequestStorageUpgrade, hasSplit, paneId]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      // A dialog is open (Trash, Version history, Settings, a confirm, the
      // sketch pad): every canvas shortcut stands down. A focused button in
      // a dialog is not an "editable target", so without this Backspace in
      // a confirm deleted the selected cards behind it (lib/modalGuard).
      if (anyModalOpen()) return;
      // Split view: both panes register this window listener — only the
      // pane the pointer last touched may act, or one Cmd+Z would undo on
      // BOTH boards (see lib/activePane.js).
      if (hasSplit && getActivePane() !== paneId) return;
      if (isEditorTarget(e)) return;
      const cmd = e.metaKey || e.ctrlKey;

      if (cmd && e.key === 'z' && !e.shiftKey) {
        // While a doc overlay is open its STRUCTURAL UndoManager owns Cmd+Z
        // (DocSurface registers itself + its own listener) — undoing hidden
        // canvas ops behind the overlay would be silent data mangling.
        if (getDocUndoTarget()) return;
        // In-session UndoManager only — synchronous and CRDT-correct, so it
        // can't network-fail. preventDefault unconditionally so a stray
        // focused input can't trigger native browser undo; an empty stack is
        // a silent no-op (mutators.undo already guards). Undo does not survive
        // a full reload by design — auto-save protects the data.
        e.preventDefault();
        mutators.undo?.();
        return;
      }
      if ((cmd && e.key === 'z' && e.shiftKey) || (cmd && e.key === 'y')) {
        if (getDocUndoTarget()) return;
        e.preventDefault();
        mutators.redo?.();
        return;
      }
      if (cmd && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); selectAll(); return; }
      if (cmd && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); doDuplicate(); return; }
      if (cmd && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); doCopy(); return; }
      if (cmd && (e.key === 'x' || e.key === 'X')) { e.preventDefault(); doCut(); return; }
      if (cmd && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        if (selected.size >= 2) { if (!canEdit) { showEditBlockedToast(); return; } groupSelected(); }
        return;
      }

      if (cmd && e.key === '0') { e.preventDefault(); enableSmoothTransform(); setZoom(1); setPan({ x: 40, y: 60 }); return; }
      if (cmd && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomAroundCenter(1.25); return; }
      if (cmd && (e.key === '-')) { e.preventDefault(); zoomAroundCenter(1 / 1.25); return; }

      // Shift+1 = zoom to fit all, Shift+2 = zoom to selection (Figma parity).
      // e.code is layout-independent (Shift+1 reports e.key '!').
      if (e.shiftKey && !cmd && !e.altKey && e.code === 'Digit1') { e.preventDefault(); fitToContent(); return; }
      if (e.shiftKey && !cmd && !e.altKey && e.code === 'Digit2') { e.preventDefault(); zoomToSelection(); return; }

      // Bare-key tool + arrange shortcuts (no Cmd/Ctrl/Alt). The isEditorTarget
      // guard above already suppresses these while typing.
      if (!cmd && !e.altKey) {
        if (e.key === 'v' || e.key === 'V') { e.preventDefault(); setSelectedTool('select'); return; }
        if (e.key === 'h' || e.key === 'H') { e.preventDefault(); setSelectedTool('pan'); return; }
        if (e.key === 'n' || e.key === 'N') { e.preventDefault(); setSelectedTool('text'); return; }
        if (e.key === 'g' || e.key === 'G') { e.preventDefault(); setSelectedTool('grid'); return; }
        if (e.key === 'd' || e.key === 'D') { e.preventDefault(); setSelectedTool('draw'); return; }
        if (e.key === 'a' || e.key === 'A') { e.preventDefault(); setSelectedTool('arrow'); return; }
        if (e.key === '[') { e.preventDefault(); if (!canEdit) { showEditBlockedToast(); return; } arrangeSelected('backward'); return; }
        if (e.key === ']') { e.preventDefault(); if (!canEdit) { showEditBlockedToast(); return; } arrangeSelected('forward'); return; }
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selected.size > 0 || selectedStrokes.size > 0 || selectedArrows.size > 0) {
          e.preventDefault();
          if (!canEdit) { showEditBlockedToast(); return; }
          doDeleteSelected();
        }
        return;
      }
      if (e.key === 'Escape') {
        // Abort any in-progress pointer gesture first so Escape cancels the
        // drag/resize/marquee instead of letting it commit on pointerup.
        if (pointerOpAbortRef.current) {
          const abort = pointerOpAbortRef.current;
          pointerOpAbortRef.current = null;
          e.preventDefault();
          try { abort(); } catch (_) {}
          return;
        }
        // Stacked dismissal: close the topmost transient layer per press,
        // instead of nuking menus + selection + tool all at once.
        e.preventDefault();
        if (ctx.open || bgCtx.open) { setCtx(c => ({ ...c, open: false })); setBgCtx(c => ({ ...c, open: false })); return; }
        if (addMenuOpen) { setAddMenuOpen(false); return; }
        if (tplPanelOpen) { setTplPanelOpen(false); return; }
        if (annotPlacing) { setAnnotPlacing(null); return; }
        if (arrowFrom || activeStroke || activeFreeArrow) { setArrowFrom(null); setActiveStroke(null); setActiveFreeArrow(null); return; }
        if (selectedTool !== 'select') { setSelectedTool('select'); return; }
        if (selected.size || selectedStrokes.size || selectedArrows.size) {
          setSelected(new Set()); setSelectedStrokes(new Set()); setSelectedArrows(new Set());
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mutators, selectAll, doDuplicate, doCopy, doCut, doDeleteSelected, selected.size, selectedStrokes.size, selectedArrows.size, setSelectedTool, enableSmoothTransform,
      zoomAroundCenter, zoomToSelection, fitToContent, arrangeSelected, groupSelected, canEdit,
      ctx.open, bgCtx.open, addMenuOpen, tplPanelOpen, arrowFrom, activeStroke, activeFreeArrow, selectedTool, annotPlacing,
      hasSplit, paneId]);

  // ── Preserve card selection across undo/redo ──────────────────────────────
  // On each undoable action the UndoManager fires 'stack-item-added'; we stash
  // the current card selection onto that stack item's meta. When the item is
  // popped (undo OR redo) we restore the stashed selection — so undoing a
  // delete brings the cards back already selected, and undoing a move re-selects
  // the moved cards. Guards against ids that no longer exist. Only card ids are
  // preserved: stroke/arrow selection is index-based and unstable across undo.
  useEffect(() => {
    const um = mutators.undoManager;
    if (!um) return;
    const SEL_KEY = 'soleil-selection';
    const stamp = (item) => {
      try { item.meta.set(SEL_KEY, { cards: [...selectedRef.current] }); } catch (_) {}
    };
    const onAdded = (e) => {
      // Skip items minted BY undo()/redo() (their transactions carry the
      // UndoManager as origin): stamping those with the mid-undo selection
      // would clobber the stamp onPopped copies across the stacks.
      if (e.origin === um) return;
      stamp(e.stackItem);
    };
    // A follow-up merged into the step within captureTimeout — refresh the
    // stamp so the coalesced gesture restores its LATEST selection.
    const onUpdated = (e) => { if (e.origin !== um) stamp(e.stackItem); };
    const onPopped = (e) => {
      try {
        const saved = e.stackItem.meta.get(SEL_KEY);
        if (!saved) return;
        // Carry the stamp onto the opposite stack's fresh top so redo after
        // undo (and vice versa) restores the same selection.
        const opposite = e.type === 'undo' ? um.redoStack : um.undoStack;
        const top = opposite[opposite.length - 1];
        try { top?.meta.set(SEL_KEY, saved); } catch (_) {}
        // Read the Y.Doc directly — it is already updated when this event
        // fires. The old RAF-deferred cardsRef read lost the race with
        // useYBoard's own RAF refresh (React commits as a task, after both
        // RAFs), so undoing a delete CLEARED the selection instead of
        // restoring it: the just-revived ids weren't in cardsRef yet.
        const live = ydoc?.getMap ? ydoc.getMap('cards') : null;
        const ids = (saved.cards || []).filter(id => !!live && live.has(id));
        setSelected(new Set(ids));
      } catch (_) {}
    };
    um.on('stack-item-added', onAdded);
    um.on('stack-item-updated', onUpdated);
    um.on('stack-item-popped', onPopped);
    return () => {
      um.off('stack-item-added', onAdded);
      um.off('stack-item-updated', onUpdated);
      um.off('stack-item-popped', onPopped);
    };
  }, [mutators.undoManager, ydoc]);

  // ── Pan helpers ───────────────────────────────────────────────────────────
  // Same ref-driven, direct-DOM-mutation pattern as the wheel handler so a
  // space-drag pan doesn't re-render every card per pointermove.
  // Auto-hide chrome while looking around (touch): flag a live pan/pinch on the
  // <body> so CSS can fade the bottom nav + floating canvas controls out, then
  // clear it ~0.7s after the gesture settles so they slide back. The CSS is
  // scoped to the mobile shell, so desktop panning never hides anything.
  const interactingClearRef = useRef(0);
  const markCanvasInteracting = useCallback(() => {
    if (typeof document === 'undefined') return;
    document.body.setAttribute('data-canvas-interacting', '1');
    if (interactingClearRef.current) clearTimeout(interactingClearRef.current);
    interactingClearRef.current = setTimeout(() => {
      document.body.removeAttribute('data-canvas-interacting');
      interactingClearRef.current = 0;
    }, 700);
  }, []);
  useEffect(() => () => {
    if (interactingClearRef.current) clearTimeout(interactingClearRef.current);
    if (typeof document !== 'undefined') document.body.removeAttribute('data-canvas-interacting');
  }, []);

  // Reveal the zoom widget only while the user is actively zooming. On touch the
  // widget is hidden by default (CSS) — pinch is the obvious gesture, so the
  // always-on −/slider/+ just ate space. Sets body[data-zooming='1'] and clears
  // it a beat after the last zoom change, so the widget fades in on pinch (and
  // stays up while the revealed controls are tapped), then fades back out.
  // Desktop ignores the flag (CSS keeps the widget always-visible there).
  const zoomingClearRef = useRef(0);
  const markZooming = useCallback(() => {
    if (typeof document === 'undefined') return;
    document.body.setAttribute('data-zooming', '1');
    if (zoomingClearRef.current) clearTimeout(zoomingClearRef.current);
    zoomingClearRef.current = setTimeout(() => {
      document.body.removeAttribute('data-zooming');
      zoomingClearRef.current = 0;
    }, 1100);
  }, []);
  useEffect(() => () => {
    if (zoomingClearRef.current) clearTimeout(zoomingClearRef.current);
    if (typeof document !== 'undefined') document.body.removeAttribute('data-zooming');
  }, []);

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
      gestureUntilRef.current = performance.now() + 200; // ADD-only cull while panning
      markGestureActiveUntil(gestureUntilRef.current);
      if (startedFromTouch) markCanvasInteracting();  // immersive look-around
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
      // Gesture settled — end ADD-only cull mode and prune (see
      // scheduleCommit). The aborted path doesn't clear: the pinch that
      // caused the abort owns the gesture and its commit clears it.
      gestureUntilRef.current = 0;
      // Commit once at gesture end so persistence + downstream consumers
      // catch up to the gesture-time ref values.
      setPan({ x: panRef.current.x, y: panRef.current.y });
      scheduleVisibleRecompute();
      emitCanvasSettle();
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
        // Clean reload via cache-bypassing fetch → blob (loadCorsCleanImage)
        // so the canvas isn't tainted. NOT an <img crossOrigin> load — the
        // on-page img cached this URL's response without CORS headers, which
        // poisons any CORS-mode load of the same signed URL (lib/corsImage.js).
        const fresh = await loadCorsCleanImage(imgEl.src);
        if (!fresh) throw new Error('cors-clean load failed');
        hex = sample(fresh);
      } catch (_) {
        // The fresh load failed. The on-page image was loaded WITHOUT
        // crossOrigin, so its canvas would also taint — but try anyway in
        // case the source is same-origin or a data: URI. If it throws,
        // surface a clear instruction.
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
    // Selecting any card that isn't a grid cell drops grid-cell focus so a
    // following paste isn't misrouted into a stale cell. (A grid cell's own
    // onPointerDownCapture sets focus first; its target IS a [data-cell-id], so
    // this leaves it intact.)
    if (focusedCellRef.current && !e.target.closest?.('[data-cell-id]')) focusCell(null, null);
    // Focus view = "just looking": tap an image to open it fullscreen, drag to
    // pan (never move or select the card). Works in any tier — browsing intent
    // overrides edit affordances — and mirrors the read-only clean-tap pattern
    // below (released within 4px = a tap; anything more is a pan).
    if (c.kind === 'image' && c.src && document.body.hasAttribute('data-focus-mode')) {
      e.stopPropagation();
      const pid = e.pointerId, sx = e.clientX, sy = e.clientY;
      const cleanup = () => {
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
      };
      const onUp = (ev) => {
        if (ev.pointerId !== pid) return;
        cleanup();
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) <= 4) openImageLightbox(c);
      };
      const onCancel = (ev) => { if (ev.pointerId === pid) cleanup(); };
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      startPan(e);
      return;
    }
    // View-only board: kill the drag before it starts so the card doesn't
    // visually follow the cursor only to snap back when the mutator no-ops.
    // The one-shot toast covers any first edit attempt (drag, Delete key,
    // etc.); subsequent attempts on this board are silent.
    if (!canEdit) {
      e.stopPropagation();
      // Board / board-link covers still navigate for read-only viewers —
      // same single-click affordance editors get via openOnClick below
      // (released within 4px = click; a drag attempt is not a click).
      // Without this, public /share visitors had to discover double-click.
      //
      // Images open fullscreen on that same clean tap. They used to fall
      // straight through to the pan branch below, which made a photo the one
      // thing on a shared board you could not actually look at: .ic-actions is
      // hover-only on a mouse, and read-only cards have no other click target.
      // The field traces were unambiguous — dead- and rage-clicks on
      // div.r2p.ic-img were the top in-board interaction on /share.
      const openTap =
        (c.kind === 'board' && e.target.closest?.('.bc-cover')) ? () => onOpenBoard(c.id)
        : (c.kind === 'boardlink' && boards[c.target]) ? () => onOpenBoard(c.target)
        : (c.kind === 'image' && c.src) ? () => openImageLightbox(c)
        : null;
      if (openTap) {
        const pid = e.pointerId, sx = e.clientX, sy = e.clientY;
        const onUp = (ev) => {
          if (ev.pointerId !== pid) return; // another finger/pen — not this gesture
          cleanup();
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) <= 4) openTap();
        };
        const onCancel = (ev) => { if (ev.pointerId === pid) cleanup(); };
        const cleanup = () => {
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onCancel);
        };
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onCancel);
        // Public viewer: a drag that starts on a cover should still pan —
        // the ≤4px click check above keeps clean clicks opening the board.
        if (isPublic) startPan(e);
        return;
      }
      if (isPublic) {
        // Public viewer is navigation-only: drag anywhere — including over
        // images and notes — pans the canvas. (Authenticated view-only
        // members keep the subscribe-to-edit toast on drag attempts.)
        startPan(e);
        return;
      }
      e.preventDefault();
      showEditBlockedToast();
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
    // Annotation placement (armed from the + menu) — clicking any card attaches
    // the comment/vote to it, mirroring the card right-click "Add comment/vote".
    if (annotPlacing) {
      e.stopPropagation();
      e.preventDefault();
      const anchor = { kind: 'card', id: c.id };
      if (annotPlacing === 'vote') addVoteCardAt(anchor); else promptComment(anchor);
      setAnnotPlacing(null);
      return;
    }
    if (spaceDown || selectedTool === 'pan') { startPan(e); return; }
    // A place tool is armed and the click landed ON a card, not empty canvas.
    // Drop the new card at the click point anyway (forgiving placement) — same
    // as clicking empty canvas — instead of silently no-op'ing. The new card
    // lands at the cursor (it can overlap; the user drags it off).
    if (PLACE_TOOLS.includes(selectedTool)) {
      e.stopPropagation();
      placeToolAt(clientToCanvas(e.clientX, e.clientY));
      return;
    }
    if (isEditorPointerTarget(e)) return;
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
    if (e.target.closest?.('.card-menu-btn')) return;

    e.stopPropagation();
    // NOTE: deliberately NOT calling setPointerCapture. Capturing the pointer
    // on the wrapper interferes with native dblclick on inner content
    // (notes, link cards, etc.) — pointerup gets routed to the capturer
    // instead of the original target, breaking the click/dblclick chain in
    // some browsers. Window-level pointermove/pointerup listeners below give
    // us full drag tracking without needing capture.
    const openOnClick = (c.kind === 'board' && e.target.closest?.('.bc-cover')) ||
      (c.kind === 'boardlink' && boards[c.target]);

    // Mobile press-and-hold: on touch, a one-finger drag PANS the board (the
    // user is looking around) and only LIFTS a card after a deliberate hold —
    // so selection must NOT change until the gesture commits to being a tap or
    // a lift. `touchHold` gates every mobile-specific branch below; for mouse /
    // pen it stays false and the original synchronous path runs verbatim.
    const touchHold = e.pointerType === 'touch' && e.isPrimary;

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
    // Apply the selection (+ clear stroke/arrow selection on a fresh, non-
    // additive press). Shift+Click builds a mixed selection so it leaves
    // stroke/arrow intact — matching onStrokeClick / onArrowClick. Deferred on
    // touch until onLift / the tap branch of onUp (see touchHold above).
    const applyCardSelection = () => {
      setSelected(nextSelected);
      if (!e.shiftKey) {
        setSelectedStrokes(new Set());
        setSelectedArrows(new Set());
      }
    };
    if (!touchHold) applyCardSelection();
    if (e.shiftKey) return;

    // Expand the drag set to cover every groupmate of every selected
    // card so groups always move as a unit.
    const expanded = expandWithGroupmates(nextSelected);
    const dragIds = [...expanded];
    const dragSet = new Set(dragIds);
    // Deferred on touch: a pan or tap that starts on a card must not register
    // as a "recent drag". onLift calls this once the press becomes a real move.
    if (!touchHold) markRecentDrag(dragIds);
    // For touch-friendly drop detection: the grabbed card (primary) + every
    // board/boardlink we could nest into, captured once (cards don't change
    // mid-drag). Used by the overlap fallback in flushMove when the finger
    // itself isn't over a board.
    const primaryId = c.id;
    const dropCandidateIds = Object.keys(cardById).filter((id) => {
      if (dragSet.has(id)) return false;
      const k = cardById[id];
      return k && (k.kind === 'board' || (k.kind === 'boardlink' && k.target));
    });
    const startPositions = {};
    dragIds.forEach(id => {
      const dc = cardById[id];
      if (dc) startPositions[id] = { x: dc.x, y: dc.y };
    });
    const startClient = { x: e.clientX, y: e.clientY };

    // Snap targets, captured once at drag start (see lib/snapGuides.js). The
    // viewport gate keeps far-off-board cards out of the candidate pool — the
    // core fix for the "swarm of guides when dragging across the board". Live
    // pan/zoom refs (not lagged state) so the world rect matches what's drawn.
    const _wrapRect = wrapRef.current?.getBoundingClientRect();
    const _snapViewport = worldViewportRect(
      { width: _wrapRect?.width || 0, height: _wrapRect?.height || 0 },
      panRef.current, zoomRef.current, SNAP_TUNING.VIEWPORT_MARGIN_PX);
    const snapTargets = buildSnapTargets({
      cards, dragSet, viewport: _snapViewport, zoom: zoomRef.current, tuning: SNAP_TUNING,
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
    const computeSnap = (rawDx, rawDy) => computeSnapPure(rawDx, rawDy, {
      targets: snapTargets, dragBBoxStart, zoom: zoomRef.current, tuning: SNAP_TUNING,
    });
    // Drag state is NOT armed here on pointerdown — only once movement
    // crosses the 4px click threshold (in flushMove below). Arming on
    // pointerdown put the card in .is-dragging for the duration of a plain
    // click, and that class strips pointer-events (so drag-into-board's
    // elementsFromPoint can see the board beneath). With no pointer capture
    // in play, the pointerup of a click then hit-tested THROUGH the card to
    // the canvas, so the click event resolved to .cards-layer and every
    // in-card click handler (note link-preview remove "x", links, …)
    // silently never fired. use-gesture's accidental mouse pointer-capture
    // used to retarget pointerup back to the pressed element and mask all
    // of this — see the drag config note near useGesture.
    // ── Mobile press-and-hold to pick up ─────────────────────────────────
    // Until a card is "lifted" (held still ~480ms), a touch drag mirrors
    // startPan's single-finger pan; the lift then hands off to the normal
    // card-drag arm below. Mouse/pen: lifted starts true → these are no-ops.
    const initialPointerId = e.pointerId;
    const startPanXY = { x: panRef.current.x, y: panRef.current.y };
    let lifted = !touchHold;
    let panned = false;
    let aborted = false;
    // Touch analogue of the wheel carve-out (see onWheel): when the finger
    // lands inside a clipped, armed scroll container (a selected/editing note
    // body, a grid cell), a drag scrolls THAT container instead of panning the
    // board. `.canvas-wrap { touch-action: none }` means the browser will never
    // do this for us. Resolved once, at pointerdown; null → normal pan/lift.
    // The lift timer keeps running until the scroll actually engages, so a
    // press-and-hold can still pick the card up off a scrollable note.
    const touchScrollEl = touchHold ? findTouchScrollable(e.target) : null;
    let touchScrolling = false;
    let lastScrollClientY = e.clientY;
    // Re-baselined to the arm point on a touch lift so the card doesn't jump
    // by the finger's pre-lift drift. Null on mouse → deltas use startClient.
    let dragOriginClient = null;
    let liftTimer = null;
    let liftStartedAt = 0;
    const cancelLift = () => {
      if (liftTimer) { clearTimeout(liftTimer); liftTimer = null; }
      setPressingCardId((prev) => (prev === c.id ? null : prev));
    };
    const onSecondTouch = (ev) => {
      // A second finger → use-gesture owns the pinch; abort our pan/lift so we
      // never fight its panRef writes or commit a stray move (cf. startPan).
      if (ev.pointerType !== 'touch' || ev.pointerId === initialPointerId) return;
      aborted = true;
      cleanupTouchHold();
    };
    function cleanupTouchHold() {
      cancelLift();
      window.removeEventListener('pointerdown', onSecondTouch, true);
      setLiftedCardId(null);
    }
    const onLift = () => {
      liftTimer = null;
      if (panned || aborted) return;
      lifted = true;
      applyCardSelection();
      markRecentDrag(dragIds);
      setPressingCardId(null);            // the filling cue hands off to .is-lifted
      setLiftedCardId(c.id);
      try { navigator.vibrate?.(8); } catch (_) {}
    };
    if (touchHold) {
      liftStartedAt = performance.now();
      liftTimer = setTimeout(onLift, TOUCH_LIFT_MS);
      // Only while the board is editable — on a read-only board the hold leads
      // nowhere, so promising it would be a lie.
      if (canEdit) setPressingCardId(c.id);
      window.addEventListener('pointerdown', onSecondTouch, true);
    }

    let dragArmed = false;

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
    // Settle gate: guides + snapping engage only when the user SLOWS DOWN to
    // place the card. While moving the card around quickly it glides freely with
    // no guides, so a busy board isn't flooded with flashing lines. `emaSpeed`
    // is a smoothed pointer screen-speed (px/ms); below MOVE_SPEED_PX_MS the
    // user is "placing" → snap + guides. A settle timer covers an abrupt stop
    // (no more pointermove events) by resolving the snap a beat after motion ends.
    let lastSample = null;                                   // { x, y, t }
    let emaSpeed = SNAP_TUNING.MOVE_SPEED_PX_MS * 2;         // start "moving" (no flash at grab)
    let lastRaw = { dx: 0, dy: 0 };
    let movedSettled = false;                               // last frame's settled state (for onUp)
    let settleTimer = 0;
    // Drop-target hover hit-test throttle. elementsFromPoint forces a
    // synchronous layout; a hover highlight doesn't need it every frame.
    let lastHitTestT = 0;
    const DROP_HITTEST_MS = 50;                             // ~20Hz
    const onSettle = () => {
      settleTimer = 0;
      if (!dragArmed || aborted) return;
      const snap = computeSnap(lastRaw.dx, lastRaw.dy);
      setDrag({ ids: dragIds, dx: snap.dx, dy: snap.dy, startPositions });
      setSnapHints(snap.hints);
      movedSettled = true;
    };
    const flushMove = () => {
      moveRafId = 0;
      const ev = pendingMoveEv;
      pendingMoveEv = null;
      if (!ev) return;
      // Touch, not yet lifted: this gesture is a PAN (looking around), not a
      // card move. Mirror startPan.onMove. Movement past the tolerance cancels
      // the pending lift (it's a pan, not a hold). Never arms the card-drag.
      if (touchHold && !lifted) {
        if (aborted || ev.pointerId !== initialPointerId) return;
        const moved = Math.hypot(ev.clientX - startClient.x, ev.clientY - startClient.y);
        // Scroll branch — takes precedence over pan for the whole gesture once
        // the finger commits to moving. Below the tolerance we do nothing at
        // all (no pan, no scroll) so the gesture can still resolve as a tap or
        // a press-and-hold lift.
        if (touchScrollEl && !panned) {
          if (!touchScrolling && moved > TOUCH_LIFT_TOLERANCE) {
            touchScrolling = true;
            cancelLift();
          }
          if (touchScrolling) driveTouchScroll(touchScrollEl, ev.clientY - lastScrollClientY);
          lastScrollClientY = ev.clientY;
          return;
        }
        if (!panned && moved > TOUCH_LIFT_TOLERANCE) {
          panned = true; cancelLift();
          // The user dragged from a card and it panned instead of moving — the
          // moment they learn the hold. Show the hint once (set the flag first,
          // synchronously, so a fast repeat can't double-toast).
          if (canEdit) {
            // Logged on EVERY cancel, not just the first, and carrying how long
            // the finger had been down and how far it travelled. That's the
            // distribution that says whether these are people deliberately
            // panning or people trying to hold and losing it to finger drift —
            // the hint event alone can't tell those apart, and the answer
            // decides whether TOUCH_LIFT_TOLERANCE is set right.
            try {
              logEvent(EV.MOBILE_LIFT_CANCELLED, {
                board_id: board?.id,
                held_ms: liftStartedAt ? Math.round(performance.now() - liftStartedAt) : null,
                travel_px: Math.round(moved),
                hint_seen: liftHintSeen(),
              });
            } catch (_) {}
            if (!liftHintSeen()) {
              markLiftHintSeen();
              feedback.toast({ type: 'info', message: 'Press and hold a card to pick it up and move it.', ttl: 5000 });
              try { logEvent(EV.MOBILE_LIFT_HINT_SHOWN, { board_id: board?.id }); } catch (_) {}
            }
          }
        }
        if (panned) {
          panRef.current = {
            x: startPanXY.x + (ev.clientX - startClient.x),
            y: startPanXY.y + (ev.clientY - startClient.y),
          };
          gestureUntilRef.current = performance.now() + 200;
          markGestureActiveUntil(gestureUntilRef.current);
          applyCanvasTransform();
          scheduleVisibleRecompute();
        }
        return;
      }
      // Click-vs-drag: same 4px screen-space distance onUp's wasClick check
      // uses, so a gesture can never commit a move without having armed.
      // Until the threshold is crossed the gesture stays a potential click
      // and the card must NOT enter .is-dragging (see dragArmed above).
      if (!dragArmed &&
          Math.hypot(ev.clientX - startClient.x, ev.clientY - startClient.y) <= 4) return;
      // A touch lift re-baselines the drag origin to the arm point so the card
      // doesn't jump by the finger's pre-lift drift. Mouse keeps startClient.
      if (!dragArmed && touchHold) dragOriginClient = { x: ev.clientX, y: ev.clientY };
      dragArmed = true;
      perf.bump('drag.flush');
      const _t0 = perf.isEnabled() ? performance.now() : 0;
      const _origin = dragOriginClient || startClient;
      const rawDx = (ev.clientX - _origin.x) / zoom;
      const rawDy = (ev.clientY - _origin.y) / zoom;
      // Hold Alt/Option to bypass snap.
      const skip = ev.altKey;
      // Smooth the pointer speed and decide whether the user is placing (slow)
      // or just moving (fast). Only when placing do snapping + guides engage.
      const nowT = ev.timeStamp || performance.now();
      if (lastSample) {
        const dist = Math.hypot(ev.clientX - lastSample.x, ev.clientY - lastSample.y);
        const dt = Math.max(1, nowT - lastSample.t);
        emaSpeed = emaSpeed * 0.6 + (dist / dt) * 0.4;
      }
      lastSample = { x: ev.clientX, y: ev.clientY, t: nowT };
      const settled = !skip && emaSpeed < SNAP_TUNING.MOVE_SPEED_PX_MS;
      const snap = settled ? computeSnap(rawDx, rawDy) : { dx: rawDx, dy: rawDy, hints: null };
      const { dx, dy, hints } = snap;
      setDrag({ ids: dragIds, dx, dy, startPositions });
      // Moving: drop any lingering guide immediately (no fading trail). Placing:
      // show the matched guides. Either way (re)arm the settle timer so an abrupt
      // stop still resolves the snap a beat later.
      if (!settled) setDisplayedHints(null);
      setSnapHints(hints);
      lastRaw = { dx: rawDx, dy: rawDy };
      movedSettled = settled;
      if (settleTimer) clearTimeout(settleTimer);
      if (!skip) settleTimer = setTimeout(onSettle, SNAP_TUNING.SETTLE_MS);
      // Drop-target hover detection (board nesting + grid-cell drop). Both use
      // document.elementsFromPoint — a forced synchronous layout — so we (a)
      // SKIP it entirely when this board has nothing to drop into, and (b)
      // throttle it to ~20Hz and share ONE stack read. A hover highlight
      // doesn't need 60/120Hz, and pointer-up resolves the real target
      // independently (onUp), so drop accuracy is unchanged. On throttled-out
      // frames the current highlight is left as-is (no flicker).
      const soloKind = dragIds.length === 1 ? cardById[dragIds[0]]?.kind : null;
      const wantHitTest = (dropCandidateIds.length > 0 || CELL_DROP_KINDS.has(soloKind))
        && (Math.abs(dx) + Math.abs(dy) > 4);
      if (wantHitTest && (nowT - lastHitTestT) > DROP_HITTEST_MS) {
        lastHitTestT = nowT;
        // The dragged cards sit under the cursor, so use elementsFromPoint and
        // walk the stack for the first id that ISN'T in the dragged set.
        const stack = document.elementsFromPoint(ev.clientX, ev.clientY) || [];
        let nextDropTarget = null;
        if (dropCandidateIds.length) {
          for (const el of stack) {
            const cardEl = el?.closest?.('[data-card-id]');
            const id = cardEl?.getAttribute?.('data-card-id');
            if (!id) continue;
            if (dragIds.includes(id)) continue;
            const tc = cardById[id];
            if (tc?.kind === 'board') { nextDropTarget = tc.id; break; }
            if (tc?.kind === 'boardlink' && tc.target) { nextDropTarget = tc.target; break; }
            // Keep walking — non-board cards aren't targets but don't stop us.
          }
          // Touch-friendly fallback: on a phone the finger is offset from the
          // card and occludes small boards, so the point hit-test above often
          // misses the board you're clearly dragging ONTO. Pick the candidate
          // board the dragged card visually overlaps the most.
          if (!nextDropTarget) {
            const dragEl = document.querySelector(`[data-card-id="${(window.CSS && CSS.escape) ? CSS.escape(primaryId) : primaryId}"]`);
            const dr = dragEl?.getBoundingClientRect();
            if (dr && dr.width && dr.height) {
              let best = 0;
              for (const bid of dropCandidateIds) {
                const bEl = document.querySelector(`[data-card-id="${(window.CSS && CSS.escape) ? CSS.escape(bid) : bid}"]`);
                const br = bEl?.getBoundingClientRect();
                if (!br || !br.width || !br.height) continue;
                const ox = Math.max(0, Math.min(dr.right, br.right) - Math.max(dr.left, br.left));
                const oy = Math.max(0, Math.min(dr.bottom, br.bottom) - Math.max(dr.top, br.top));
                const overlap = ox * oy;
                if (overlap <= 0) continue;
                const minArea = Math.min(dr.width * dr.height, br.width * br.height);
                if (overlap > best && overlap > 0.18 * minArea) {
                  best = overlap;
                  const tc = cardById[bid];
                  nextDropTarget = tc?.kind === 'boardlink' ? tc.target : bid;
                }
              }
            }
          }
        }
        updateBoardDropTarget(nextDropTarget, nextDropTarget ? { x: ev.clientX, y: ev.clientY } : null);
        // Grid-cell drop target: reuse the same stack for a [data-cell-id] in a
        // grid that ISN'T part of the dragged set. A board drop wins over a cell
        // drop. Only a SINGLE card of a cell-fillable kind highlights a cell, so
        // a multi-select drag never shows a misleading affordance.
        let nextCell = null;
        if (!nextDropTarget && CELL_DROP_KINDS.has(soloKind)) {
          for (const el of stack) {
            const cellEl = el?.closest?.('[data-cell-id]');
            if (!cellEl) continue;
            const gridEl = cellEl.closest('[data-grid-id]');
            const gid = gridEl?.getAttribute?.('data-grid-id');
            if (!gid || dragIds.includes(gid)) continue; // not into the dragged grid itself
            nextCell = { gridId: gid, cellId: cellEl.getAttribute('data-cell-id') };
            break;
          }
        }
        updateCellDropTarget(nextCell);
      }
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
      window.removeEventListener('pointercancel', onCancel);
      pointerOpAbortRef.current = null;
      // Cancel any queued mid-drag pointermove that's about to flush —
      // we're about to commit final positions, so a trailing flush would
      // re-render the dragged cards once at a stale delta before settling.
      if (moveRafId) { cancelAnimationFrame(moveRafId); moveRafId = 0; }
      if (settleTimer) { clearTimeout(settleTimer); settleTimer = 0; }
      pendingMoveEv = null;
      cleanupTouchHold();
      // Touch gesture that never lifted → it was a PAN or a TAP, not a card
      // move. Finalize like startPan / a click and skip all the drag-commit
      // machinery below (drop-into-board, cross-pane, snap commit).
      if (touchHold && !lifted) {
        if (panned && !aborted) {
          gestureUntilRef.current = 0;
          setPan({ x: panRef.current.x, y: panRef.current.y });
          scheduleVisibleRecompute();
          emitCanvasSettle();
        } else if (!panned && !touchScrolling && !aborted) {
          // Tap: boards still open on tap (as before); other cards select.
          if (openOnClick) {
            if (c.kind === 'board') onOpenBoard(c.id);
            else if (c.kind === 'boardlink') onOpenBoard(c.target);
          } else {
            applyCardSelection();
          }
        }
        setDrag(null);
        return;
      }
      // Same origin flushMove used (lift point on touch, else startClient) so
      // the committed position matches the live drag — no jump on release.
      const _origin = dragOriginClient || startClient;
      const rawDx = (ev.clientX - _origin.x) / zoom;
      const rawDy = (ev.clientY - _origin.y) / zoom;
      const skip = ev.altKey;
      // Snap on commit only if released while placing (slowed); a release mid-fling
      // (fast, guides were hidden) lands free so a toss isn't yanked into alignment.
      const snapEnd = (skip || !movedSettled) ? { dx: rawDx, dy: rawDy } : computeSnap(rawDx, rawDy);
      const { dx, dy } = snapEnd;
      clearSnapGuidesNow();
      // Cancel any queued mid-drag broadcast so a stale rAF can't fire
      // AFTER we clear liveDrag and momentarily flash the card back to
      // the previous position.
      if (liveDragRafId) { cancelAnimationFrame(liveDragRafId); liveDragRafId = 0; }
      pendingLiveDrag = null;
      // Clear our live-drag awareness so peers see the card snap to its
      // committed position. (The Y.Doc updateCards call below propagates
      // the final position via Yjs sync.)
      try { getAwareness?.()?.setLocalStateField('liveDrag', null); } catch (_) {}
      // ── Drop a single card INTO a grid cell (auto-formats by kind) ──
      const cellTarget = cellDropTargetRef.current;
      updateCellDropTarget(null);
      if (cellTarget && (Math.abs(dx) + Math.abs(dy) > 4)) {
        const moved = dragIds.map(id => cardById[id]).filter(Boolean);
        // Only short-circuit the normal move if the card actually became cell
        // content; an unsupported kind (doc/shape/palette/…) falls through and
        // repositions normally instead of silently snapping back.
        if (moved.length === 1 && routeCardIntoCell(moved[0], cellTarget.gridId, cellTarget.cellId)) {
          setDrag(null);
          return;
        }
      }
      // ── Same-canvas drop onto a board card (move INTO that board) ──
      // Read from the ref — the state captured in this closure is stale
      // across re-renders during the drag.
      const targetBoardId = boardDropTargetRef.current;
      updateBoardDropTarget(null);
      if (targetBoardId && (Math.abs(dx) + Math.abs(dy) > 4)) {
        const movedCards = dragIds.map(id => cardById[id]).filter(Boolean);
        // If the dragged selection is ENTIRELY board references, NEST them under
        // the target board (reparent) instead of moving them as cards. The
        // shared handler validates cycle/self; the post-reparent reconcile
        // removes the dragged board card(s) from this canvas.
        const draggedBoardIds = movedCards
          .map(c => c.kind === 'board' ? c.id : (c.kind === 'boardlink' ? c.target : null))
          .filter(Boolean);
        if (movedCards.length > 0 && draggedBoardIds.length === movedCards.length) {
          document.dispatchEvent(new CustomEvent('soleil-board-reparent-drop', {
            detail: { childIds: draggedBoardIds, targetId: targetBoardId, sourceSurface: 'canvas' },
          }));
          setDrag(null);
          return;
        }
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
                ttl: 8000,
              });
              return;
            }
            // Now safe to clear local comments + delete source.
            removeCommentsByAnchorIds([...dragIds, ...movedGroupIds]);

            // Source-side delete — the MOVE variant (untracked origin), so a
            // later Cmd+Z can't restore the source half while the copies
            // stay on the target (silent duplication). The move's undo is
            // the toast App shows, which reverses both sides.
            mutators.deleteCardsForMove?.(dragIds);

            const afterKeys = cardsMap ? [...cardsMap.keys()] : [];
            const afterCount = afterKeys.length;
            const actualDelta = beforeCount - afterCount;
            const afterKeySet = new Set(afterKeys);
            const dragIdSet = new Set(dragIds);
            // Per-id invariant (robust to concurrent edits): every dragged
            // card must be gone, and NOTHING else may have been removed. We
            // intentionally ignore keys that were ADDED during the async
            // window — a peer creating a card mid-drop is harmless and must
            // not trip a false rollback (the old beforeCount-afterCount delta
            // check rolled back on any concurrent add or unrelated delete).
            const dragIdsStillPresent = dragIds.filter(k => afterKeySet.has(k));
            const unexpectedlyRemoved = beforeKeys.filter(k => !dragIdSet.has(k) && !afterKeySet.has(k));
            const invariantOk = dragIdsStillPresent.length === 0 && unexpectedlyRemoved.length === 0;
            console.log('[drag-into-board] post-delete', {
              afterCount,
              actualDelta,
              expectedDelta,
              dragIdsStillPresent,
              unexpectedlyRemoved,
              keysAdded: afterKeys.filter(k => !beforeKeys.includes(k)),
            });

            // CRITICAL INVARIANT: source must lose exactly the dragged cards —
            // no more, no fewer. If a dragged card survived or an unrelated
            // card vanished, something is silently mutating the cards map and
            // we roll back hard.
            if (!invariantOk) {
              console.error('[drag-into-board] INVARIANT VIOLATED — auto-rolling back', {
                beforeCount, afterCount, expectedDelta, actualDelta,
                dragIds, beforeKeys, afterKeys,
                dragIdsStillPresent,
                unexpectedlyRemoved,
              });
              try {
                if (preDropSnapshotId) {
                  const b64 = await loadBoardVersionDoc(preDropSnapshotId);
                  if (b64) {
                    await bulletproofRestore(board.id, b64);
                    feedback.toast({
                      type: 'error',
                      message: `Drag aborted — source cluster lost ${actualDelta} cards instead of ${expectedDelta}. Restored automatically.`,
                      ttl: 12000,
                    });
                  } else {
                    // (The removed time-travel tool used to be named here; a
                    // pre-drag board_versions snapshot exists server-side.)
                    feedback.toast({ type: 'error', message: 'Drag caused unexpected state loss. A safety snapshot was saved — contact support to restore it.' });
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
        // startPositions is populated only for ids that were in cardById when
        // the drag armed, but dragIds comes from the selection — a collaborator
        // deleting a card mid-drag leaves an id with no start entry. Skip those
        // rather than reading .x off undefined; the liveDrag broadcast above
        // and the bbox pass already guard the same divergence.
        const updates = dragIds.map(id => {
          const start = startPositions[id];
          return start ? {
            id, patch: {
              x: Math.round(start.x + dx),
              y: Math.round(start.y + dy),
            }
          } : null;
        }).filter(Boolean);
        if (updates.length) mutators.updateCards?.(updates);
      } else if (openOnClick && !touchHold) {
        // Touch board-open happens on tap (onUp tap branch) / double-tap, not
        // here — a deliberate lift released in place must not open the board.
        if (c.kind === 'board') onOpenBoard(c.id);
        if (c.kind === 'boardlink') onOpenBoard(c.target);
      }
      setDrag(null);
    };
    // Escape-abort: tear down listeners + queued frames, drop the live-drag
    // broadcast, clear drop hints, and revert cards to their committed
    // positions (setDrag(null)) WITHOUT committing the move.
    pointerOpAbortRef.current = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      cleanupTouchHold();
      if (moveRafId) { cancelAnimationFrame(moveRafId); moveRafId = 0; }
      if (settleTimer) { clearTimeout(settleTimer); settleTimer = 0; }
      if (liveDragRafId) { cancelAnimationFrame(liveDragRafId); liveDragRafId = 0; }
      pendingMoveEv = null;
      pendingLiveDrag = null;
      try { getAwareness?.()?.setLocalStateField('liveDrag', null); } catch (_) {}
      updateBoardDropTarget(null);
      updateCellDropTarget(null);
      document.dispatchEvent(new CustomEvent('soleil-cross-pane-end'));
      clearSnapGuidesNow();
      setDrag(null);
    };
    // pointercancel fires (not pointerup) when the OS steals the touch — palm
    // rejection, a system gesture, or use-gesture converting to a pinch. Tear
    // down WITHOUT committing a move or opening a board, and clear the lift
    // timer / .is-lifted visual so they can't leak after the finger is gone.
    const onCancel = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      pointerOpAbortRef.current = null;
      if (moveRafId) { cancelAnimationFrame(moveRafId); moveRafId = 0; }
      if (settleTimer) { clearTimeout(settleTimer); settleTimer = 0; }
      if (liveDragRafId) { cancelAnimationFrame(liveDragRafId); liveDragRafId = 0; }
      pendingMoveEv = null;
      pendingLiveDrag = null;
      try { getAwareness?.()?.setLocalStateField('liveDrag', null); } catch (_) {}
      cleanupTouchHold();
      updateBoardDropTarget(null);
      updateCellDropTarget(null);
      clearSnapGuidesNow();
      setDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  };

  const onResizePointerDown = (e, c) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setSelected(new Set([c.id]));
    // Resizing a single card is a fresh selection — clear any stroke/arrow
    // selection too so the selection state is consistent (matches the card
    // pointerdown path).
    setSelectedStrokes(new Set());
    setSelectedArrows(new Set());
    const startClient = { x: e.clientX, y: e.clientY };
    setResize({ id: c.id, dw: 0, dh: 0 });

    // Snap targets, captured once at drag start (see lib/snapGuides.js). Two
    // flavours per axis: a numeric match (dragged w/h equals another card's w/h
    // — the "same size as that card" case) and an edge landing for the
    // bottom-right corner. Viewport-gated so far-off cards never match.
    const _rsWrapRect = wrapRef.current?.getBoundingClientRect();
    const _rsViewport = worldViewportRect(
      { width: _rsWrapRect?.width || 0, height: _rsWrapRect?.height || 0 },
      panRef.current, zoomRef.current, SNAP_TUNING.VIEWPORT_MARGIN_PX);
    const resizeTargets = buildResizeTargets({
      cards, selfId: c.id, viewport: _rsViewport, zoom: zoomRef.current, tuning: SNAP_TUNING,
    });
    const computeResizeSnap = (rawDw, rawDh, skip, skipH) => computeResizeSnapPure(rawDw, rawDh, {
      card: c, targets: resizeTargets, skip, skipH, zoom: zoomRef.current, tuning: SNAP_TUNING,
    });

    // Image and video cards lock their aspect ratio on resize so the
    // user always sees the whole image without letterboxing or
    // unintended cropping. Hold Cmd/Ctrl during the drag to bypass and
    // resize freely (which then makes object-fit:cover crop the image).
    const aspectLockKinds = new Set(['image', 'video', 'pdf']);
    // Embeds (kind 'link' carrying an embed payload) lock to their PROVIDER
    // ratio, not their current possibly-distorted w/h, so resize always yields
    // a clean scaled player with no letterbox bands.
    const embedLock = c.kind === 'link' && c.embed && c.embed.embedUrl
      && c.embed.defaultW > 0 && c.embed.defaultH > 0;
    const lockAspect = (aspectLockKinds.has(c.kind) || embedLock) && c.w > 0 && c.h > 0;
    const startAspect = embedLock
      ? (c.embed.defaultW / c.embed.defaultH)   // provider ratio (w/h)
      : (lockAspect ? c.w / c.h : null);

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

    // Note cards reflow on resize: while the drag is mostly horizontal the
    // height auto-follows the text at the new width, so resizing never
    // hides text behind an invisible scroll. A deliberate vertical pull
    // (>16px screen-space) latches "height mode" and hands height back to
    // the pointer, with an extra snap target at the content height so
    // dragging back to "exactly fits" is easy. Empty notes (no text to
    // reflow) keep the legacy free-resize behavior.
    const noteBody = c.kind === 'note'
      ? document.querySelector(`[data-card-id="${c.id}"] .note-body`)
      : null;
    let noteMeasurer = noteBody ? createNoteMeasurer(noteBody) : null;
    if (noteMeasurer?.isEmpty) { noteMeasurer.destroy(); noteMeasurer = null; }
    let noteHeightMode = false;
    const updateNoteLatch = (ev) => {
      if (noteMeasurer && !noteHeightMode && Math.abs(ev.clientY - startClient.y) > 16) {
        noteHeightMode = true;
      }
    };
    const applyNoteReflow = (dw, dh, hints) => {
      if (!noteMeasurer) return { dh, hints };
      const newW = Math.max(MIN_W, Math.round(c.w + dw));
      const fitH = noteMeasurer.cardHeightAt(newW);
      if (!noteHeightMode) return { dh: fitH - c.h, hints };
      // Height mode: snap to "fits exactly" when the pointer is close.
      if (Math.abs((c.h + dh) - fitH) <= 12 / zoom) {
        const merged = hints || { xs: [], ys: [], spacings: [] };
        merged.ys = [...(merged.ys || []), { y: c.y + fitH, x0: c.x, x1: c.x + newW, label: 'fit' }];
        return { dh: fitH - c.h, hints: merged };
      }
      return { dh, hints };
    };

    let prevResizeRaw = null; // last frame's raw (world) delta, for the fast clear
    const onMove = (ev) => {
      const rawDwRaw = (ev.clientX - startClient.x) / zoom;
      const rawDhRaw = (ev.clientY - startClient.y) / zoom;
      const bypass = ev.metaKey || ev.ctrlKey;
      const { dw: rawDw, dh: rawDh } = applyAspectLock(rawDwRaw, rawDhRaw, bypass);
      updateNoteLatch(ev);
      // Aspect-locked resize skips edge/numeric snapping (would break the
      // lock); Alt continues to also disable snap for the free-resize case.
      const snap = computeResizeSnap(rawDw, rawDh, lockAspect && !bypass ? true : ev.altKey, !!noteMeasurer && !noteHeightMode);
      const { dh, hints } = applyNoteReflow(snap.dw, snap.dh, snap.hints);
      setResize({ id: c.id, dw: snap.dw, dh });
      // Fast resize jump: drop a lingering size/edge guide immediately rather
      // than leaving a fading trail (mirrors the move path).
      if (!hints && prevResizeRaw && Math.hypot(rawDw - prevResizeRaw.dw, rawDh - prevResizeRaw.dh) * zoom > SNAP_TUNING.FAST_MOVE_PX) {
        setDisplayedHints(null);
      }
      prevResizeRaw = { dw: rawDw, dh: rawDh };
      setSnapHints(hints);
    };
    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      pointerOpAbortRef.current = null;
      const rawDwRaw = (ev.clientX - startClient.x) / zoom;
      const rawDhRaw = (ev.clientY - startClient.y) / zoom;
      const bypass = ev.metaKey || ev.ctrlKey;
      const { dw: rawDw, dh: rawDh } = applyAspectLock(rawDwRaw, rawDhRaw, bypass);
      updateNoteLatch(ev);
      const snap = computeResizeSnap(rawDw, rawDh, lockAspect && !bypass ? true : ev.altKey, !!noteMeasurer && !noteHeightMode);
      const { dh } = applyNoteReflow(snap.dw, snap.dh, snap.hints);
      const newW = Math.max(MIN_W, Math.round(c.w + snap.dw));
      const newH = Math.max(MIN_H, Math.round(c.h + dh));
      if (newW !== c.w || newH !== c.h) {
        const patch = { w: newW, h: newH };
        if (c.kind === 'note') {
          // A note counts as manually sized only when the user deliberately
          // pinned a height that differs from its content height. Width-only
          // resizes keep the note auto-fitting — and explicitly writing
          // `false` un-freezes notes frozen by the old always-stick behavior.
          patch.manuallyResized = noteMeasurer
            ? (noteHeightMode && newH !== noteMeasurer.cardHeightAt(newW))
            : true;
        }
        // Grids: resize the whole LINKED family + re-tile so a connected matrix
        // scales as one unit (unlinked Grids just resize themselves).
        if (c.kind === 'grid' && mutators.resizeLinkedGrids) mutators.resizeLinkedGrids(c.id, newW, newH);
        else mutators.updateCard?.(c.id, patch);
      }
      noteMeasurer?.destroy();
      noteMeasurer = null;
      setResize(null);
      clearSnapGuidesNow();
    };
    // Escape-abort: revert to the committed size (setResize(null)).
    pointerOpAbortRef.current = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      noteMeasurer?.destroy();
      noteMeasurer = null;
      clearSnapGuidesNow();
      setResize(null);
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
    // Coerce dimensions to positive finite numbers up front. A card with a
    // missing/zero w or h would otherwise make `start.w * sx` produce NaN
    // (or a divide that clamps wrong), corrupting every item's new size.
    items.forEach(c => startById.set(c.id, {
      x: Number.isFinite(c.x) ? c.x : 0,
      y: Number.isFinite(c.y) ? c.y : 0,
      w: (Number.isFinite(c.w) && c.w > 0) ? c.w : MIN_W,
      h: (Number.isFinite(c.h) && c.h > 0) ? c.h : MIN_H,
      kind: c.kind,
      manuallyResized: !!c.manuallyResized,
    }));
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
      pointerOpAbortRef.current = null;
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
    // Escape-abort: revert to committed bounds (setMultiResize(null)).
    pointerOpAbortRef.current = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
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
      pointerOpAbortRef.current = null;
      const rot = compute(ev);
      mutators.updateCard?.(c.id, { rotation: Math.round(rot) || null });
      setRotateState(null);
    };
    // Escape-abort: revert to the committed rotation (setRotateState(null)).
    pointerOpAbortRef.current = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
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
    // Public viewer: no card context menu (it would still expose Info /
    // "Linked from" / navigation). Suppress the native menu too for a
    // clean, app-like preview.
    if (isPublic) { e.preventDefault(); return; }
    // Right-clicking INSIDE a note you're editing is a text gesture, not a card
    // one. This used to preventDefault unconditionally, so mid-sentence you got
    // "Duplicate / Delete / Bring to front" — and no Paste, Copy, Look Up or
    // Emoji & Symbols, which is the whole reason anyone right-clicks in text.
    // Defer to the browser. stopPropagation still fires so the background menu
    // doesn't take a turn instead.
    //
    // (Not a spellcheck fix: notes run spellcheck OFF on purpose — Chromium
    // paints its squiggles at untransformed coordinates, which the canvas
    // transform misaligns. See RichNoteEditor's editor props.)
    //
    // A note is only contenteditable WHILE editing (RichNoteEditor's
    // contentEditable={editing}; the Tiptap surface mounts only in the editing
    // branch), so a right-click on a resting note still gets the card menu.
    // isEditorPointerTarget, not isEditorTarget: decided from the event's own
    // path, never from where the caret happens to be parked.
    if (isEditorPointerTarget(e)) { e.stopPropagation(); return; }
    e.preventDefault();
    e.stopPropagation();
    setBgCtx(b => ({ ...b, open: false }));
    if (!selected.has(c.id)) setSelected(new Set([c.id]));
    setCtx({ open: true, x: e.clientX, y: e.clientY, cardId: c.id });
  };
  const closeCardMenu = () => setCtx(c => ({ ...c, open: false }));

  const buildMenu = (c) => {
    // Buckets → composeMenuSections keeps every card's menu grouped + ordered
    // the same: primary (open) · EDIT · ANNOTATE · ARRANGE · CLIPBOARD · meta
    // (info / backlinks / delete). Empty buckets drop out (no stray headers).
    // `items` is the EDIT bucket — the big per-kind block below fills it.
    const items = [];
    const openItems = [], annotateItems = [], arrangeItems = [], clipboardItems = [], metaItems = [];
    const multi = selected.size > 1 && selected.has(c.id);

    // View-only board: strip every mutating action (Edit/Replace/Cover/
    // Shape/Stroke/Fit/Tag — all RLS-blocked). Keep navigation, Info, and the
    // "Linked from N places" backlink. (The demo-tier upgrade CTA died with
    // 0188 — editor collaboration is free, 'tier-demoted' no longer exists.)
    if (!canEdit) {
      if (!multi) {
        if (c.kind === 'board') {
          openItems.push({ id: 'open', label: 'Open cluster', run: () => onOpenBoard(c.id) });
        } else if (c.kind === 'boardlink') {
          openItems.push({ id: 'open', label: 'Open linked cluster',
            run: () => boards[c.target] && onOpenBoard(c.target) });
        } else if (c.kind === 'link' && (c.source || c.link)) {
          openItems.push({ id: 'open', label: 'Open link', run: () => {
            const url = c.link || c.source;
            window.open(url.startsWith('http') ? url : `https://${url}`, '_blank', 'noopener');
          }});
        }
        metaItems.push({ id: 'info', label: 'Info',
          run: () => setInfoFor({ cardId: c.id, x: ctx.x, y: ctx.y }) });
        metaItems.push({ backlinks: true });
      }
      return composeMenuSections([
        { items: openItems },
        { items: metaItems },
      ]);
    }

    // "Move to board…" non-drag fallback for board references (works for a
    // single board card or a multi-select of board cards). Routes to the same
    // shared reparent handler the drag surfaces use.
    {
      const actingCards = (multi ? [...selected] : [c.id])
        .map(id => (cards || []).find(x => x.id === id))
        .filter(Boolean);
      const actingBoardIds = actingCards
        .map(cc => cc.kind === 'board' ? cc.id : (cc.kind === 'boardlink' ? cc.target : null))
        .filter(Boolean);
      const allBoards = actingCards.length > 0 && actingBoardIds.length === actingCards.length;
      if (allBoards) {
        const targets = Object.values(boards)
          .filter(b => b && b.workspace_id === workspaceId
            && !actingBoardIds.includes(b.id)
            && !actingBoardIds.some(cid => wouldCreateCycle(boards, cid, b.id)))
          .sort((a, b2) => (a.name || '').localeCompare(b2.name || ''))
          .slice(0, 50);
        const dispatchMove = (targetId) => document.dispatchEvent(new CustomEvent('soleil-board-reparent-drop', {
          detail: { childIds: actingBoardIds, targetId, sourceSurface: 'menu' },
        }));
        const submenu = [
          { id: 'mtb-root', label: 'Top level', run: () => dispatchMove(null) },
          ...(targets.length ? [{ divider: true }] : []),
          ...targets.map(b => ({ id: 'mtb-' + b.id, label: b.name || 'Untitled', run: () => dispatchMove(b.id) })),
        ];
        arrangeItems.push({
          id: 'move-to-board',
          label: actingBoardIds.length > 1 ? `Move ${actingBoardIds.length} clusters to…` : 'Move to cluster…',
          submenu,
        });
      }
    }

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
                // Clear any prior adjustments — they belonged to the old image.
                mutators.updateCard?.(c.id, { src: payload.publicUrl, adjust: null });
              } catch (err) {
                feedback.toast({ type: 'error', message: 'Upload failed: ' + (err.message || err) });
              }
            };
            input.click();
          }},
        ]});
        if (canEdit && c.src) {
          items.push({ id: 'image-edit-photo', label: 'Edit photo…',
            run: () => setImageEditFull({ cardId: c.id }) });
        }
        if (c.src) {
          items.push({ id: 'image-download', label: 'Download',
            run: () => downloadImage({ src: c.src, title: c.title || c.label || '', adjust: c.adjust }) });
        }
      } else if (c.kind === 'pdf') {
        openItems.push({ id: 'pdf-open', label: 'Open',
          run: () => { if (c.pdfSrc) setPdfViewer({ src: c.pdfSrc, name: c.name || c.title || 'PDF' }); } });
        items.push({ id: 'pdf-title', label: c.title ? 'Edit title' : 'Add title',
          run: () => triggerInlineEdit(c.id, 'title') });
        items.push({ id: 'pdf-download', label: 'Download', run: async () => {
          if (!c.pdfSrc) return;
          try {
            const url = await resolveSrc(c.pdfSrc);
            if (!url) return;
            const res = await fetch(url);
            const blob = await res.blob();
            const objUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            let fn = (c.name || c.title || 'document').toString().replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
            if (!/\.pdf$/i.test(fn)) fn += '.pdf';
            a.href = objUrl; a.download = fn;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
          } catch (_) {
            const url = await resolveSrc(c.pdfSrc).catch(() => null);
            if (url) window.open(url, '_blank', 'noopener,noreferrer');
          }
        }});
      } else if (c.kind === 'file') {
        items.push({ id: 'file-title', label: c.title ? 'Edit title' : 'Add title',
          run: () => triggerInlineEdit(c.id, 'title') });
        items.push({ id: 'file-download', label: 'Download', run: async () => {
          if (!c.fileSrc) return;
          let url = null;
          try {
            url = await resolveSrc(c.fileSrc);
            if (!url) return;
            const res = await fetch(url);
            const blob = await res.blob();
            const objUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = objUrl;
            a.download = c.fileName || (c.title || 'file').toString().replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(objUrl), 10000);
          } catch (_) {
            if (url) window.open(url, '_blank', 'noopener,noreferrer');
          }
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
      } else if (c.kind === 'grid') {
        const linked = !!c.templateId;
        // Opens the Templates panel with this grid as the target. Selecting it
        // first is what makes the panel apply rather than place — the same rule
        // the panel's header states, reached from the card instead of the rail.
        if (templatesEnabled) {
          items.push({
            id: 'grid-save-template',
            label: 'Save as template…',
            run: () => openSaveTemplate(c.id),
          });
        }
        items.push({
          id: 'grid-apply-template',
          label: 'Apply template…',
          run: () => { setSelected(new Set([c.id])); setTplPanelOpen(true); },
        });
        items.push({
          id: 'grid-link',
          // "Share layout" is the LINKED-FAMILY feature (edit one, all reflow),
          // not the Templates library above it. Different things, adjacent menu.
          label: linked ? 'Unlink layout' : 'Share layout',
          run: () => { if (linked) mutators.unlinkGrid?.(c.id); else mutators.promoteGridToTemplate?.(c.id); },
        });
        items.push({ id: 'grid-matrix', label: 'Generate matrix…', run: async () => {
          const v = await feedback.prompt({ title: 'Generate a matrix', label: 'Columns × Rows', placeholder: '6 x 3', defaultValue: '3 x 2', confirmLabel: 'Generate' });
          if (!v) return;
          const mt = String(v).match(/(\d+)\s*[x×,]\s*(\d+)/i);
          if (!mt) { feedback.toast({ type: 'error', message: 'Enter dimensions like 6 x 3.' }); return; }
          mutators.bulkGenerateGrids?.(c.id, parseInt(mt[1], 10), parseInt(mt[2], 10));
        }});
        if (c.seqId) {
          const seq = gridSequences[c.seqId];
          const pat = seq?.pattern || 'z';
          items.push({ id: 'grid-order', label: 'Reading order', submenu: [
            { id: 'ord-z', label: `Z — rows, left→right${pat === 'z' ? ' ✓' : ''}`, run: () => mutators.setGridSequencePattern?.(c.seqId, 'z') },
            { id: 'ord-n', label: `N — columns, top→bottom${pat === 'n' ? ' ✓' : ''}`, run: () => mutators.setGridSequencePattern?.(c.seqId, 'n') },
            { id: 'ord-snake', label: `Snake — alternating rows${pat === 'snake' ? ' ✓' : ''}`, run: () => mutators.setGridSequencePattern?.(c.seqId, 'snake') },
          ]});
        }
      } else if (c.kind === 'schedule' && c.schedView) {
        const setView = (v) => mutators.updateCard?.(c.id, { schedView: v });
        items.push({ id: 'sched-view', label: 'View', submenu: [
          { id: 'sv-month', label: `Month${c.schedView === 'month' ? ' ✓' : ''}`, run: () => setView('month') },
          { id: 'sv-week', label: `Week${c.schedView === 'week' ? ' ✓' : ''}`, run: () => setView('week') },
          // 'hour' rows exist in stored data and readSchedModel folds them into
          // 'day', so the Day entry ticks for both — a card that came from the
          // removed view must not show every option unchecked.
          { id: 'sv-day', label: `Day${c.schedView === 'day' || c.schedView === 'hour' ? ' ✓' : ''}`, run: () => setView('day') },
        ]});
        items.push({ id: 'sched-today', label: 'Go to today', run: () => mutators.updateCard?.(c.id, { anchor: schedTodayISO() }) });
        // "Break into hours/minutes" is gone with the hour buckets it made. A
        // day's resolution is its running order now, and that lives in Day
        // view rather than as a mode a month cell can be put into.
      } else if (c.kind === 'board') {
        openItems.push({ id: 'open', label: 'Open cluster', run: () => onOpenBoard(c.id) });
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
        items.push({ id: 'custom-thumb', label: 'Upload custom thumbnail…',
          run: () => triggerThumbPick(c.id) });
        if (target?.thumb_custom) {
          items.push({ id: 'reset-thumb', label: 'Reset to auto thumbnail',
            run: () => mutators.resetBoardThumb?.(c.id) });
        }
        if (target && personalWorkspaceId && target.workspace_id !== personalWorkspaceId) {
          items.push({ id: 'clone', label: 'Copy to my workspace', run: () => mutators.cloneBoardToPersonal?.(c.id) });
        }
      } else if (c.kind === 'boardlink') {
        openItems.push({ id: 'open', label: 'Open linked cluster', run: () => boards[c.target] && onOpenBoard(c.target) });
      } else if (c.kind === 'palette') {
        items.push({ id: 'palette-edit', label: 'Edit', submenu: [
          { id: 'pc-pure',
            label: c.chipsOnly ? 'Show labels' : 'Hide labels (pure color)',
            run: () => mutators.updateCard?.(c.id, { chipsOnly: !c.chipsOnly }) },
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
          { id: 'pc-pick-image', label: 'Pick from cluster image…', run: () => {
            setEyedropFor(c.id);
            feedback.toast({ type: 'info', message: 'Click an image to sample a color. Esc to cancel.' });
          }},
        ]});
      } else if (c.kind === 'note') {
        items.push({ id: 'fit', label: 'Fit to content', run: () => {
          // Snap the note to the natural size of its rendered content so
          // there's no padding to the right of titles or short lines, and
          // no empty space below. The shared measurer gives the unwrapped
          // longest-line width; we then re-measure height at that width so
          // multi-line content still wraps correctly.
          const wrap = document.querySelector(`[data-card-id="${c.id}"] .note-body`);
          const measurer = createNoteMeasurer(wrap);
          if (!measurer) return;
          // Cap width so a giant single line doesn't blow out the canvas.
          const newW = Math.min(560, Math.max(80, measurer.naturalWidth() + NOTE_INNER_PAD));
          const newH = measurer.cardHeightAt(newW);
          measurer.destroy();
          mutators.updateCard?.(c.id, { w: newW, h: newH, manuallyResized: false });
        }});
      } else if (c.kind === 'link') {
        items.push({ id: 'edit-title', label: c.title ? 'Edit title' : 'Add title', run: () => {
          triggerInlineEdit(c.id, 'title');
        }});
        if (c.source || c.link) {
          openItems.push({ id: 'open', label: 'Open link', run: () => {
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
      } else if (c.kind === 'video') {
        items.push({ id: 'video-title', label: c.title ? 'Edit title' : 'Add title',
                     run: () => triggerInlineEdit(c.id, 'title') });
        // Labels state the action, matching the group outline/label pair — there
        // is no checkmark affordance in these menus. "(muted)" is on the label
        // because an unmuted autoplay is blocked by every browser, and a silent
        // clip nobody was warned about reads as broken audio.
        items.push({ id: 'video-autoplay', label: c.autoplay ? 'Turn off autoplay' : 'Autoplay (muted)',
                     run: () => mutators.updateCard?.(c.id, { autoplay: c.autoplay ? null : true }) });
        items.push({ id: 'video-loop', label: c.loop ? 'Turn off looping' : 'Loop',
                     run: () => mutators.updateCard?.(c.id, { loop: c.loop ? null : true }) });
      } else if (c.kind === 'schedule') {
        items.push({ id: 'schedule-title', label: c.title ? 'Edit title' : 'Add title',
                     run: () => triggerInlineEdit(c.id, 'title') });
      } else if (c.kind === 'palette') {
        items.push({ id: 'palette-title', label: c.title ? 'Edit title' : 'Add title',
                     run: () => triggerInlineEdit(c.id, 'title') });
      } else if (c.kind === 'shape' && c.shape !== 'line' && c.shape !== 'arrow') {
        items.push({ id: 'shape-label', label: c.label ? 'Edit label' : 'Add label',
                     run: () => triggerInlineEdit(c.id, 'shapeLabel') });
      }
    }

    if (!multi) {
      annotateItems.push({ id: 'comment', label: 'Add comment',
        run: () => promptComment({ kind: 'card', id: c.id }) });
      annotateItems.push({ id: 'vote', label: 'Add vote to card',
        run: () => addVoteCardAt({ kind: 'card', id: c.id }) });
      annotateItems.push({ id: 'tag', label: 'Tag…',
        run: () => {
          // Open the picker anchored near the right-click coord. The
          // ctx state holds the click position from onCardContextMenu.
          const anchorRect = { left: ctx.x, top: ctx.y, bottom: ctx.y + 4, right: ctx.x + 4 };
          openTagPicker(c.id, anchorRect);
        }});
      // Info lives in the bottom meta group (added here so it's the first meta
      // row, above the backlinks + delete pushed at the very end).
      metaItems.push({ id: 'info', label: 'Info', run: () => {
        // Anchor the info popover at the click point so it sits next
        // to the card the user invoked it on.
        setInfoFor({ cardId: c.id, x: ctx.x, y: ctx.y });
      }});
    }
    clipboardItems.push({ id: 'cut', label: multi ? `Cut (${selected.size})` : 'Cut', shortcut: `${cmdKey}X`, run: doCut });
    clipboardItems.push({ id: 'copy', label: multi ? `Copy (${selected.size})` : 'Copy', shortcut: `${cmdKey}C`, run: doCopy });
    clipboardItems.push({ id: 'duplicate', label: multi ? `Duplicate (${selected.size})` : 'Duplicate', shortcut: `${cmdKey}D`, run: doDuplicate });
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
    arrangeItems.push({ id: 'arrange', label: 'Arrange', submenu: [
      { id: 'front',    label: 'Bring to front', run: () => arrangeRun('front') },
      { id: 'forward',  label: 'Bring forward',  run: () => arrangeRun('forward') },
      { id: 'backward', label: 'Send backward',  run: () => arrangeRun('backward') },
      { id: 'back',     label: 'Send to back',   run: () => arrangeRun('back') },
    ]});

    // Spatial arrangement. Until now this menu was z-order ONLY — there was no
    // way to line four cards up by hand short of dragging each and trusting the
    // snap guides, and no way to tidy a board that had become a mess.
    //
    // Every one of these goes through mutators.updateCards, so a whole
    // rearrangement is a single undo step rather than forty.
    const geometryOf = (id) => cardByIdRef.current[id];
    const applyMoves = (moved, withSize) => {
      if (!moved.length) return;
      mutators.updateCards?.(moved.map((c) => ({
        id: c.id,
        patch: withSize ? { x: c.x, y: c.y, w: c.w, h: c.h } : { x: c.x, y: c.y },
      })));
    };
    // Nothing selected means the whole board — "tidy this up" is the request,
    // and making someone select everything first to express it is friction.
    const tidyRun = (name) => {
      const all = Object.values(cardByIdRef.current || {});
      const ids = selected.size >= 2 ? [...selected] : all.map((c) => String(c.id));
      // justified is the only layout that resizes, so it is the only one whose
      // patch may carry w/h.
      applyMoves(rearrange(all, ids, { layout: name }), name === 'justified');
    };
    const alignRun = (edge) =>
      applyMoves(alignCards([...selected].map(geometryOf).filter(Boolean), edge), false);
    const distributeRun = (axis) =>
      applyMoves(distributeCards([...selected].map(geometryOf).filter(Boolean), axis), false);

    arrangeItems.push({
      id: 'tidy',
      label: selected.size >= 2 ? `Tidy up (${selected.size})` : 'Tidy up board',
      submenu: [
        { id: 'justified', label: 'Justified rows',  run: () => tidyRun('justified') },
        { id: 'masonry',   label: 'Masonry columns', run: () => tidyRun('masonry') },
        { id: 'grid',      label: 'Grid',            run: () => tidyRun('grid') },
        { id: 'row',       label: 'Single row',      run: () => tidyRun('row') },
        { id: 'column',    label: 'Single column',   run: () => tidyRun('column') },
      ],
    });

    if (multi && selected.size >= 2) {
      arrangeItems.push({ id: 'align', label: 'Align', submenu: [
        { id: 'left',     label: 'Left',   run: () => alignRun('left') },
        { id: 'center-x', label: 'Center', run: () => alignRun('center-x') },
        { id: 'right',    label: 'Right',  run: () => alignRun('right') },
        { id: 'top',      label: 'Top',    run: () => alignRun('top') },
        { id: 'middle',   label: 'Middle', run: () => alignRun('middle') },
        { id: 'bottom',   label: 'Bottom', run: () => alignRun('bottom') },
      ]});
    }
    if (multi && selected.size >= 3) {
      // Three is the minimum that HAS a gap to even out.
      arrangeItems.push({ id: 'distribute', label: 'Distribute', submenu: [
        { id: 'horizontal', label: 'Horizontally', run: () => distributeRun('horizontal') },
        { id: 'vertical',   label: 'Vertically',   run: () => distributeRun('vertical') },
      ]});
    }

    // Grouping (stays in the ARRANGE group) ──
    if (multi && selected.size >= 2) {
      // Selection of 2+ → "Group together"
      arrangeItems.push({ id: 'group', label: `Group (${selected.size})`, run: async () => {
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
      arrangeItems.push({ id: 'add-to-group', label: 'Add to group', submenu:
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
      arrangeItems.push({ id: 'group-remove', label: multi ? `Remove from group (${selected.size})` : 'Remove from group',
        run: () => mutators.removeFromGroup?.(multi ? [...selected] : [c.id]) });
      // Everything else — rename / outline / shape / color / info / ungroup —
      // tucked into a single Group submenu so the top level stays scannable.
      arrangeItems.push({ id: 'group', label: `Group "${g.name || 'Untitled'}"`, submenu: [
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

    // Info (created-by/when) is the CardInfoPopover row already in metaItems for
    // single-select; the old audit-toast duplicate "Info" was removed here so the
    // menu never shows two "Info" rows.

    metaItems.push({ backlinks: true });
    metaItems.push({ id: 'delete', label: multi ? `Delete (${selected.size})` : 'Delete',
      shortcut: '⌫', danger: true,
      run: () => doDeleteIds(multi ? [...selected] : [c.id]) });

    return composeMenuSections([
      { items: openItems },
      { header: SECTION.EDIT,      items },
      { header: SECTION.ANNOTATE,  items: annotateItems },
      { header: SECTION.ARRANGE,   items: arrangeItems },
      { header: SECTION.CLIPBOARD, items: clipboardItems },
      { items: metaItems },
    ]);
  };

  // ── Background pointer + context ──────────────────────────────────────────
  // New-card pop-in: ids appearing after the first render get .is-new for
  // ~280ms (scale+fade keyframes; disabled under prefers-reduced-motion).
  // Seeded from the first cards array and reset per board so board loads
  // and switches never wave; bulk arrivals (paste, board switch races)
  // skip the animation too.
  const knownCardIdsRef = useRef(null);
  const [newCardIds, setNewCardIds] = useState(() => new Set());
  useEffect(() => { knownCardIdsRef.current = null; setNewCardIds(new Set()); }, [board.id]);
  useEffect(() => {
    const ids = new Set(cards.map(c => c.id));
    if (knownCardIdsRef.current === null) { knownCardIdsRef.current = ids; return; }
    const fresh = [...ids].filter(id => !knownCardIdsRef.current.has(id));
    knownCardIdsRef.current = ids;
    if (fresh.length === 0 || fresh.length > 8) return;
    setNewCardIds(prev => new Set([...prev, ...fresh]));
    const t = setTimeout(() => {
      setNewCardIds(prev => {
        const next = new Set(prev);
        fresh.forEach(id => next.delete(id));
        return next;
      });
    }, 280);
    return () => clearTimeout(t);
  }, [cards, board.id]);

  // Double-click on empty canvas drops a note right there — the fastest
  // "just start typing" path (FigJam/Miro muscle memory; also what the
  // empty-board hint advertises). Cards, chrome, strokes and arrows keep
  // their own double-click behaviors.
  const onBackgroundDoubleClick = (e) => {
    // Any tour (locked desktop OR the unlocked mobile_lite variant) owns input —
    // a double-tap must not open the quick-add menu over the pill or drop a stray
    // cluster/note that steers away from the guided path.
    if (document.body.dataset.tourActive === '1' || document.body.dataset.tourVariant) return;
    if (selectedTool !== 'select') return;   // a place tool handles its own click
    // Clicks on UI chrome / cards are not a "make a card here" gesture.
    if (e.target.closest('.card, .cnv-tool, .cnv-tools, .cnv-tpl-panel, .cnv-zoom, .inbox, .ctx-menu, .cnv-hint, .cnv-empty-tiles, .cnv-quick-add, .modal-bg, .tob, .canvas-comment, .comment-archive-pop, .cnv-comments-eye, .board-tags-strip, .readonly-banner')) return;
    // A read-only viewer's double-click to create dies here — surface it (the
    // toast self-silences for public/share viewers) and record the block.
    if (!canEdit) { showEditBlockedToast(); noteCreateBlocked('read_only', 'dblclick'); return; }
    // Strokes / arrows / snap guides are SVG children; the bare canvas is not.
    // A double-click the user means for empty canvas but that an SVG overlay
    // intercepts is the silent dead-end — record the intent AND the no-op.
    if (e.target instanceof SVGElement && e.target.tagName !== 'svg') {
      noteCreateIntent('dblclick');
      noteCreateBlocked('noop_svg', 'dblclick');
      return;
    }
    // Double-click no longer reflexively drops a note — it opens a small
    // add-card menu at the cursor so you choose what to place (consistent with
    // the empty-state tiles). Opening the menu IS a "make a card" intent: record
    // it for the funnel so a user who opens the menu and closes it without
    // picking still counts as first_intent (previously they registered NOTHING,
    // under-reporting the activation funnel and hiding the seed→first-action
    // cliff). We log + advance the journey here but SKIP recordIntent's friction
    // tick — each type's run() in buildAddActions fires the full
    // noteCreateIntent('dblclick') on pick, so ticking the stuck signal here too
    // would double-count the menu-open+pick into a false rage-escalation.
    try { logEvent(EV.CARD_CREATE_INTENT, { method: 'dblclick_menu', board_id: board?.id }); } catch (_) {}
    try { setJourneyState({ phase: JOURNEY_PHASE.FIRST_INTENT }); } catch (_) {}
    setQuickAdd({ open: true, x: e.clientX, y: e.clientY, pos: clientToCanvas(e.clientX, e.clientY) });
  };

  const onBackgroundPointerDown = (e) => {
    if (e.button === 1) { startPan(e); return; }
    if (e.button !== 0) return;
    if (e.target.closest('.cnv-tool, .cnv-tools, .cnv-tpl-panel, .cnv-zoom, .inbox, .ctx-menu, .cnv-hint, .modal-bg, .tob')) return;

    if (focusedCellRef.current) focusCell(null, null); // clicking the canvas drops cell focus
    setAddMenuOpen(false);
    setTplPanelOpen(false);
    closeCardMenu();
    setBgCtx(b => ({ ...b, open: false }));

    if (spaceDown || selectedTool === 'pan') { startPan(e); return; }

    // A pointerdown that ORIGINATES inside an editable text field (inline
    // title <input>s, any contenteditable that doesn't already stop
    // propagation) is the browser starting a native text-selection drag —
    // never a tool gesture. Without this guard the select-tool marquee
    // armed at 4px of drift and its overlay + selection-state churn fought
    // the native selection. Deliberately NOT isEditorTarget(): that helper
    // also checks document.activeElement / the live selection, which still
    // point inside a note when the user clicks OUTSIDE it — and that click
    // must keep reaching the marquee/deselect logic so blur-commit works.
    if (e.target.isContentEditable ||
        e.target.closest?.('[contenteditable="true"], input, textarea, select')) return;

    // Drawing
    if (selectedTool === 'draw') {
      // Only the FIRST finger draws. A second finger's pointerdown reaches this
      // handler too, and without this it started a stroke of its own — so the
      // second-touch abort below would correctly discard stroke #1 and then
      // stroke #2 would sample its way through the pinch and commit the smear
      // anyway. Returning BEFORE preventDefault also matters: preventing the
      // second touch stops useGesture from ever recognising the pinch (the same
      // reasoning as the touch branch of the select tool further down).
      if (e.pointerType === 'touch' && e.isPrimary === false) return;
      // A stylus anywhere on this device switches the finger from a drawing
      // implement to a navigation one — see lib/pointerPolicy.js for why palm
      // rejection can't be solved by pointerId filtering alone. Announce the
      // switch the first time so it doesn't read as the app breaking.
      if (notePointerType(e.pointerType)) {
        feedbackRef.current?.toast({
          type: 'info',
          message: 'Stylus detected — your finger now pans instead of drawing. Change this under Brush in the draw options.',
          ttl: 7000,
        });
      }
      if (!pointerCanDraw(e.pointerType)) { startPan(e); return; }
      e.preventDefault();
      markCanvasInteracting(); // fade the rail / bottom nav out of the way
      const start = clientToCanvas(e.clientX, e.clientY);
      const points = [[start.x, start.y]];
      // Sample threshold in SCREEN pixels, not board units. A fixed board-space
      // gate means the filter changes meaning with zoom: at 0.2x it was a third
      // of a screen pixel (so nothing was filtered and the point arrays ran
      // huge), and at 4x it was six screen pixels, which is visibly faceted.
      const minStep = 1.2 / (zoomRef.current || 1);
      // Two fingers means pinch-zoom, not drawing. The first finger has already
      // started this stroke by the time the second lands, and the pinch handler
      // mutates zoomRef/panRef underneath us — so every subsequent sample maps
      // through a moving transform and the committed line is a smear. Discard
      // it. startPan solves the same race the same way.
      let aborted = false;
      let disposeStroke = null;
      const endGesture = () => {
        window.removeEventListener('pointerdown', onSecondTouch, true);
        if (pointerOpAbortRef.current === abortStroke) pointerOpAbortRef.current = null;
      };
      const abortStroke = () => {
        aborted = true;
        // dispose() tears the window listeners down WITHOUT running onEnd, so
        // nothing commits. Escape used to null activeStroke and leave the
        // listeners live.
        disposeStroke?.();
        endGesture();
        setActiveStroke(null);
      };
      const onSecondTouch = (ev) => {
        if (ev.pointerType !== 'touch' || ev.pointerId === e.pointerId) return;
        abortStroke();
      };
      if (e.pointerType === 'touch') {
        window.addEventListener('pointerdown', onSecondTouch, true);
      }
      // Escape aborts the stroke through the same path.
      pointerOpAbortRef.current = abortStroke;
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
          // Only ART canvases accept routed strokes. Any other selected kind
          // used to swallow the whole stroke into its card-local `strokes`
          // prop, where .card{overflow:hidden} clipped everything outside the
          // card's box — drawing on bare canvas with e.g. a note selected
          // looked completely dead (and the tool auto-flipped to select).
          // Non-art selections fall through to the bbox-majority scorer
          // below, which is already art-only. The SketchPad-commit flow this
          // shortcut exists for is unaffected: pendingCardRef is always
          // created with kind:'art'.
          if (sel && sel.kind === 'art') return sel;
        }
        // Score every art canvas by how many stroke points fall inside
        // its bbox; the one with the most overlap wins. Ties pick the
        // top-most z (last wins). A stroke routes INTO a card only when
        // the majority of its points land inside — a board stroke that
        // merely clips a corner used to be swallowed whole by the card
        // (its outside portion silently vanished off the card's edge).
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
        return bestScore > pts.length / 2 ? best : null;
      };
      // Lasso — circle strokes to select them.
      //
      // This is the ONLY way a finger can select strokes at all: one-finger
      // touch on the select tool is routed to panning (see the touch branch
      // further down), so the marquee has always been mouse- and stylus-only.
      if (drawOptions.mode === 'lasso') {
        const addPoint = (cx, cy) => {
          const p = clientToCanvas(cx, cy);
          const last = points[points.length - 1];
          if (Math.hypot(p.x - last[0], p.y - last[1]) < minStep) return;
          points.push([Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]);
        };
        setActiveStroke({ lasso: true, points: [...points] });
        disposeStroke = trackStroke({
          pointerId: e.pointerId,
          onSample: (ev) => {
            for (const s of coalescedOf(ev)) addPoint(s.clientX, s.clientY);
            setActiveStroke({ lasso: true, points: [...points] });
          },
          onEnd: () => {
            endGesture();
            // A polygon needs three points; a tap is a deselect.
            if (!aborted) {
              const picked = new Set();
              if (points.length > 2) {
                (strokes || []).forEach((s, i) => { if (strokeInPolygon(s, points)) picked.add(i); });
              }
              setSelected(new Set());
              setSelectedArrows(new Set());
              setSelectedStrokes(picked);
              // Hand straight over to the select tool: that is what makes the
              // transform handles live (strokes are only interactive under
              // select), so a lasso that left you in draw mode would select
              // things you then couldn't touch.
              if (picked.size) setSelectedTool('select');
            }
            setActiveStroke(null);
          },
        });
        return;
      }
      if (drawOptions.mode === 'eraser') {
        // Screen-constant, like the pen's width at the moment it is drawn. The
        // radius used to be fixed in BOARD units, so the eraser grew on screen
        // as you zoomed: at 4x a "16px" eraser rubbed out a 64px swathe, which
        // makes zooming in to erase detail actively counterproductive — and at
        // 0.25x it was a 4px sliver while the cursor drew a 10px circle.
        const radius = Math.max(4, (drawOptions.eraserWidth || ERASER_DEFAULT_WIDTH) / 2)
          / (zoomRef.current || 1);
        setActiveStroke({ color: 'rgba(239,68,68,.75)', width: radius * 2, points: [...points], eraser: true });
        const addPoint = (cx, cy) => {
          const p = clientToCanvas(cx, cy);
          const last = points[points.length - 1];
          if (Math.hypot(p.x - last[0], p.y - last[1]) < minStep) return;
          points.push([Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]);
        };
        // Hardened tracking (pointerId filter + rAF coalesce + pointercancel) —
        // see lib/pointerStroke.js. Commit on cancel too so an iOS palm-reject
        // mid-erase doesn't strand the gesture.
        disposeStroke = trackStroke({
          pointerId: e.pointerId,
          onSample: (ev) => {
            for (const s of coalescedOf(ev)) addPoint(s.clientX, s.clientY);
            setActiveStroke({ color: 'rgba(239,68,68,.75)', width: radius * 2, points: [...points], eraser: true });
          },
          onEnd: () => {
            endGesture();
            if (!aborted && points.length > 1) {
              const targetCard = pickStrokeTarget(points);
              // eraseStrokes reports whether the swipe actually cut anything, so
              // a pass over empty canvas writes nothing to the Y.Doc and leaves
              // no undo step behind — it used to rewrite the whole strokes array
              // with resampled copies of itself on every miss.
              const eraser = targetCard
                ? points.map(([x, y]) => [x - targetCard.x, y - targetCard.y])
                : points;
              // eraseOnCard walks every visible layer and returns the right
              // patch shape for the card it was given; a layered card must not
              // be written through `strokes`, which readers ignore.
              const result = targetCard
                ? eraseOnCard(targetCard, eraser, radius)
                : (() => {
                    const r = eraseStrokes(strokes || [], eraser, radius);
                    return { changed: r.changed, patch: r.next };
                  })();
              const { changed } = result;
              if (changed) {
                // One erase gesture = its own undo step. updateCard/
                // replaceStrokes deliberately don't break (gesture coalescing),
                // so without this the erase merges into whatever happened in
                // the previous 500ms — including the card-create step.
                mutators.breakUndo?.();
                if (targetCard) {
                  mutators.updateCard?.(targetCard.id, result.patch);
                } else {
                  mutators.replaceStrokes?.(result.patch);
                  setSelectedStrokes(new Set());
                }
              }
              // Auto-switch only when finishing on an art canvas — board
              // free-erasing is iterative like board free-drawing.
              if (targetCard) setSelectedTool('select');
            }
            setActiveStroke(null);
          },
        });
        return;
      }
      // Width is stored in BOARD units but chosen in screen pixels, so scale it
      // by the live zoom at creation. Without this the picker lies: a "3px" line
      // drawn at 0.25x came out a quarter as thick as the swatch showed, and at
      // 4x it came out four times as thick. Every infinite-canvas tool commits
      // what you actually see under the cursor.
      const { color } = drawOptions;
      const brush = drawOptions.brush || DEFAULT_BRUSH;
      const width = drawOptions.width / (zoomRef.current || 1);
      // Only record pressure from a device that actually reports it. A mouse and
      // a finger both report a constant 0.5, which is not pressure — it's the
      // spec's placeholder for "this device has none" — and storing it would
      // send every mouse stroke down the expensive outline path for nothing.
      const wantPressure = e.pointerType === 'pen';
      const stamp = (p, pressure) => (wantPressure
        ? [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(pressure * 100) / 100]
        : [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]);
      points[0] = stamp(start, e.pressure || 0.5);
      // `brush` is omitted for the default pen so an ordinary stroke stays the
      // exact 3-field object every board already stores — no field churn in the
      // Y.Doc, and no diff for boards that never touch the brush picker.
      const newStroke = (pts) => (brush === DEFAULT_BRUSH
        ? { color, width, points: pts }
        : { color, width, brush, points: pts });
      setActiveStroke({ color, width, brush, points: [...points] });
      const addPoint = (cx, cy, pressure) => {
        const p = clientToCanvas(cx, cy);
        const last = points[points.length - 1];
        if (Math.hypot(p.x - last[0], p.y - last[1]) < minStep) return;
        points.push(stamp(p, pressure));
      };
      // Hardened tracking — the un-coalesced setActiveStroke-per-event loop here
      // is what froze a 240Hz Apple Pencil. pointerId filtering rejects a resting
      // palm; rAF coalescing collapses the stream to one render per frame;
      // getCoalescedEvents keeps the line smooth; pointercancel guarantees
      // cleanup (and commits the stroke) on an iOS palm-reject. See
      // lib/pointerStroke.js.
      disposeStroke = trackStroke({
        pointerId: e.pointerId,
        onSample: (ev) => {
          for (const s of coalescedOf(ev)) addPoint(s.clientX, s.clientY, s.pressure);
          // Re-arm every frame. The flag clears ~700ms after the last call, so
          // arming only on pointerdown let the rail fade back IN part-way
          // through a long stroke — exactly the thing it was hidden for.
          markCanvasInteracting();
          setActiveStroke({ color, width, brush, points: [...points] });
        },
        onEnd: () => {
          endGesture();
          if (!aborted && points.length > 1) {
            const targetCard = pickStrokeTarget(points);
            if (targetCard) {
              // Translate to card-local coords so the stroke stays bounded
              // to the card and moves/scales with it.
              // breakUndo: each pen line routed onto an art canvas must be
              // its OWN ⌘Z step. updateCard never breaks (gesture
              // coalescing), so without this a line drawn within 500ms of
              // the previous action MERGED into it — worst case the
              // card-create step, where ⌘Z removed the whole drawing
              // instead of the line. (Board-level addStroke below already
              // breaks internally.)
              mutators.breakUndo?.();
              const localPoints = points.map(p => (p.length > 2
                ? [p[0] - targetCard.x, p[1] - targetCard.y, p[2]]
                : [p[0] - targetCard.x, p[1] - targetCard.y]));
              // Lands on the topmost visible layer when the card has them.
              mutators.updateCard?.(targetCard.id, appendStrokeToCard(targetCard, newStroke(localPoints)));
            } else {
              mutators.addStroke?.(newStroke(points));
            }
            // Surface the just-used color in recents so the swatch
            // strip in the draw tool options updates as the user works.
            addRecentColor(color);
            // Auto-switch only when finishing on an art canvas. Drawing
            // on the main board is iterative — that's how people draw.
            if (targetCard) setSelectedTool('select');
          }
          setActiveStroke(null);
        },
      });
      return;
    }

    // Free-arrow drag (arrow tool, click+drag on empty canvas)
    if (selectedTool === 'arrow' && !arrowFrom) {
      const startC = clientToCanvas(e.clientX, e.clientY);
      let moved = false;
      let lastTo = startC;
      const startClient = { x: e.clientX, y: e.clientY };
      trackStroke({
        pointerId: e.pointerId,
        onSample: (ev) => {
          if (!moved && Math.abs(ev.clientX - startClient.x) < 4 && Math.abs(ev.clientY - startClient.y) < 4) return;
          moved = true;
          lastTo = clientToCanvas(ev.clientX, ev.clientY);
          setActiveFreeArrow({ from: startC, to: lastTo });
        },
        onEnd: (ev, { canceled }) => {
          if (moved && !canceled) {
            const end = ev ? clientToCanvas(ev.clientX, ev.clientY) : lastTo;
            mutators.addFreeArrow?.({ x: startC.x, y: startC.y }, { x: end.x, y: end.y }, arrowOptions);
            setSelectedTool('select');
          }
          setActiveFreeArrow(null);
        },
      });
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
      const onSample = (ev) => {
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
      const onEnd = (ev, { canceled }) => {
        // iOS palm-reject / system gesture mid-shape: drop the preview without
        // committing a stray shape.
        if (canceled) { setActiveShape(null); return; }
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
      trackStroke({ pointerId: e.pointerId, onSample, onEnd });
      return;
    }

    // Annotation placement (armed from the + menu) — clicking empty canvas
    // drops a point comment/vote here. Clicking a card is handled in
    // onCardPointerDown (attaches to that card); this is the empty-space path.
    // preventDefault suppresses the trailing compatibility mousedown — without
    // it, the comment draft we just opened would be instantly cancelled by its
    // own outside-pointerdown/mousedown listener firing on the same press.
    if (annotPlacing) {
      e.preventDefault();
      e.stopPropagation();
      const pos = clientToCanvas(e.clientX, e.clientY);
      const anchor = { kind: 'point', x: pos.x, y: pos.y };
      if (annotPlacing === 'vote') addVoteCardAt(anchor); else promptComment(anchor);
      setAnnotPlacing(null);
      return;
    }

    if (selectedTool !== 'select') {
      // board/image/text/palette drop at the click via the shared placer;
      // shape (drag-to-draw) and draw/arrow were already handled above.
      placeToolAt(clientToCanvas(e.clientX, e.clientY));
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

    // Select tool: marquee. Snapshot the pre-marquee selection so we can
    // restore it if Escape aborts, and treat Shift as additive. We do NOT
    // clear the current selection on pointerdown — doing so used to drop a
    // multi-selection the instant a click twitched a pixel. Clearing happens
    // only once the gesture is confirmed as a drag (first move past the
    // threshold) or resolves as a plain click on empty canvas (pointerup).
    const startClient = { x: e.clientX, y: e.clientY };
    const startCanvas = clientToCanvas(e.clientX, e.clientY);
    setMarquee({ x0: startCanvas.x, y0: startCanvas.y, x1: startCanvas.x, y1: startCanvas.y });
    const wasShift = e.shiftKey;
    const preSelected = new Set(selected);
    const preStrokes = new Set(selectedStrokes);
    const preArrows = new Set(selectedArrows);

    let moved = false;
    let cleared = false;
    // Fresh (non-shift) marquee: clear the existing selection the first time
    // movement is confirmed, so the live preview reflects only the box.
    const clearForFreshMarquee = () => {
      if (cleared || wasShift) return;
      cleared = true;
      setSelected(new Set());
      setSelectedStrokes(new Set());
      setSelectedArrows(new Set());
    };
    const onSample = (ev) => {
      const dxClient = ev.clientX - startClient.x;
      const dyClient = ev.clientY - startClient.y;
      // 4px matches the card-drag click threshold — the old 3px meant a
      // tiny drift could start a lasso where the same drift on a card
      // still counted as a click.
      if (!moved && Math.abs(dxClient) < 4 && Math.abs(dyClient) < 4) return;
      moved = true;
      clearForFreshMarquee();
      const cur = clientToCanvas(ev.clientX, ev.clientY);
      setMarquee(prev => prev ? { ...prev, x1: cur.x, y1: cur.y } : null);
    };
    // Restore the pre-marquee selection + drop the box (Escape or iOS cancel).
    const abortMarquee = () => {
      setSelected(preSelected);
      setSelectedStrokes(preStrokes);
      setSelectedArrows(preArrows);
      setMarquee(null);
    };
    const onEnd = (ev, { canceled }) => {
      pointerOpAbortRef.current = null;
      if (canceled) { abortMarquee(); return; }
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
        // Shift = additive (union with the pre-marquee selection); a plain
        // marquee replaces it. Applied uniformly to cards, strokes, arrows.
        const next = new Set(wasShift ? preSelected : []);
        hits.forEach(id => next.add(id));
        const nextStrokes = new Set(wasShift ? preStrokes : []);
        strokeHits.forEach(i => nextStrokes.add(i));
        const nextArrows = new Set(wasShift ? preArrows : []);
        arrowHits.forEach(i => nextArrows.add(i));
        setSelected(next);
        setSelectedStrokes(nextStrokes);
        setSelectedArrows(nextArrows);
      } else if (!wasShift) {
        // Plain click on empty canvas → deselect everything.
        setSelected(new Set());
        setSelectedStrokes(new Set());
        setSelectedArrows(new Set());
      }
      setMarquee(null);
    };
    const dispose = trackStroke({ pointerId: e.pointerId, onSample, onEnd });
    // Escape-abort: tear down listeners (no commit) + restore selection.
    pointerOpAbortRef.current = () => { dispose(); abortMarquee(); };
  };

  const onBackgroundContextMenu = (e) => {
    if (isPublic) { e.preventDefault(); return; } // no canvas menu in public preview
    if (e.target.closest('.card, .cnv-tool, .cnv-zoom, .inbox')) return;
    e.preventDefault();
    closeCardMenu();
    const pos = clientToCanvas(e.clientX, e.clientY);
    setBgCtx({ open: true, x: e.clientX, y: e.clientY, canvasPos: pos });
  };
  const closeBgMenu = () => setBgCtx(b => ({ ...b, open: false }));

  // Single source of truth for the "add to board" actions, shared by the
  // desktop right-click menu (buildBgMenu) and the phone bottom-nav "+" sheet.
  // pos = canvas-space drop point; method = analytics label passed to
  // noteCreateIntent ('context_menu' | 'mobile_nav'). `group` lets callers
  // partition card-creating actions from annotations; `icon` is consumed by
  // the mobile sheet and ignored by the context-menu renderer.
  const buildAddActions = (pos, method) => [
    { id: 'board',   group: 'card', label: 'Cluster', icon: Browsers,      run: () => { noteCreateIntent(method, 'board'); addClusterCard(pos, method); } },
    { id: 'linkedcluster', group: 'card', label: 'Linked cluster', icon: ArrowSquareOut, run: () => onOpenPicker?.(pos) },
    { id: 'grid',    group: 'card', label: 'Grid',    icon: GridFour,      run: () => { noteCreateIntent(method, 'grid'); mutators.addGrid?.(pos, { preset: 'storyboard-1-2' }); } },
    // Multi-select, via the same batch ingest drag-drop uses. This used to call
    // mutators.addImageAt, which opens a picker with no `multiple` and reads
    // files[0] — so the single most prominent affordance in the shipped
    // image-first onboarding ("Add an image" on the empty board) could only ever
    // produce ONE card. It shows in the data: day-1 users average a largest
    // single gesture of ~2.8 cards and almost none has ever placed 5+ at once,
    // while returning at all is sharply gated on reaching ~6 on day one
    // (50-73% at 6+, ~13% at zero). Selecting one file behaves exactly as before.
    { id: 'image',   group: 'card', label: 'Image',   icon: ImageIcon,     run: () => { noteCreateIntent(method, 'image'); pickPhotosAtRef.current?.(pos, method); } },
    { id: 'file',    group: 'card', label: 'File',    icon: Paperclip,     run: () => { noteCreateIntent(method, 'file'); openFilePicker(pos); } },
    { id: 'note',    group: 'card', label: 'Text note', icon: NotePencil,  run: () => { noteCreateIntent(method, 'note'); mutators.addNote?.(pos); } },
    { id: 'doc',     group: 'card', label: 'Doc',     icon: FileText,      run: () => { noteCreateIntent(method, 'doc'); mutators.addDocCard?.(pos); } },
    { id: 'script',  group: 'card', label: 'Script',  icon: Clapperboard,  run: () => { noteCreateIntent(method, 'script'); mutators.addScriptCard?.(pos); } },
    { id: 'shape',   group: 'card', label: 'Shape',   icon: Square,        run: () => { noteCreateIntent(method, 'shape'); mutators.addShape?.(pos, shapeOptions); } },
    // Switches tools rather than creating a card, so no create-intent is logged
    // — nothing exists yet to have intended. It lives in the registry so the
    // mobile "+" sheet can reach it at all: that sheet renders every action in
    // this list, and Draw's absence meant the puck simply dead-ended for it.
    { id: 'draw',    group: 'tool', label: 'Draw',    icon: Scribble,      run: () => setSelectedTool('draw') },
    { id: 'palette', group: 'card', label: 'Color palette', icon: Palette, run: () => { noteCreateIntent(method, 'palette'); mutators.addPalette?.(pos); } },
    // Held while the calendar is rebuilt (lib/appHost.js). sub() and
    // addFromRegistry both resolve through this list, so dropping the entry
    // here closes the right-click Add submenu and the mobile "+" sheet at once
    // — sub() returns null for an unknown id and the array is filter(Boolean)'d.
    // Rendering the card is NOT gated: existing schedule cards keep working.
    ...(scheduleCreationAllowed() ? [
      { id: 'schedule', group: 'card', label: 'Schedule', icon: CalendarPh, run: () => { noteCreateIntent(method, 'schedule'); mutators.addSchedule?.(pos); } },
    ] : []),
    { id: 'addurl',  group: 'card', label: 'Link', icon: Link, run: async () => {
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
          // Silent: the async preview backfill must not add an undo step
          // between the card-create and whatever the user does next.
          if (Object.keys(patch).length) mutators.updateCardSilent?.(newId, patch);
        });
      }
    }},
    { id: 'comment', group: 'note', label: 'Comment', icon: MessageCircle, run: () => promptComment({ kind: 'point', x: pos.x, y: pos.y }) },
    { id: 'vote',    group: 'note', label: 'Vote',    icon: ListChecks,    run: () => addVoteCardAt({ kind: 'point', x: pos.x, y: pos.y }) },
  ];

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
        ...(arrow.bend ? [{ id: 'arrow-reset-curve', label: 'Reset curve',
          run: () => mutators.updateArrow?.(idx, { bend: null }) }] : []),
        { id: 'arrow-dashed',
          label: arrow.dashed ? 'Solid line' : 'Dashed line',
          run: () => mutators.updateArrow?.(idx, { dashed: !arrow.dashed }) },
        { divider: true },
        { id: 'arrow-delete', label: 'Delete arrow', danger: true,
          run: () => deleteSingleArrow(idx) },
      ];
    }
    // View-only states (viewer share, no access) — just expose the safe
    // read-only actions. (The demo-tier upgrade CTA died with 0188.)
    if (!canEdit) {
      return [
        { id: 'selectall', label: 'Select all', shortcut: `${cmdKey}A`, run: selectAll },
      ];
    }
    // Resolve the placement point. Prefer recomputing from the stored SCREEN
    // coords (bgCtx.x/y = the raw clientX/clientY of the right-click) against
    // the LIVE transform at the moment the menu item runs — so if the camera
    // settled between right-click and pick (e.g. the 220ms is-smooth zoom
    // transition, or a peer/auto-fit nudge), the item still lands under the
    // cursor. Falls back to the snapshot taken at open, then the last mouse
    // position. Identical to bgCtx.canvasPos when nothing moved.
    const pos = (bgCtx.open && Number.isFinite(bgCtx.x) && Number.isFinite(bgCtx.y))
      ? clientToCanvas(bgCtx.x, bgCtx.y)
      : (bgCtx.canvasPos || lastMouseCanvasRef.current);
    // Shared add actions (see buildAddActions). The right-click "Add" is the
    // COMPLETE catalog — every card type + linked cluster + link + the two
    // annotations + the Draw/Arrow tool-modes — grouped under section headers
    // so it stays scannable. Script is intentionally omitted (write scripts
    // inside a doc). Comment/Vote/Link no longer sit loose at the top level.
    const addActions = buildAddActions(pos, 'context_menu');
    const byId = (id) => addActions.find(a => a.id === id);
    // Settle the camera only when a create actually RUNS (not on menu open), so a
    // right-click during a slow content load doesn't defeat the late-content auto-fit.
    const settled = (fn) => () => { markViewSettled(); return fn?.(); };
    const sub = (id, labelOverride) => {
      const a = byId(id);
      return a ? { id: a.id, label: labelOverride || a.label, run: settled(a.run) } : null;
    };
    const addSubmenu = [
      { header: 'Cards' },
      sub('note', 'Note'), sub('image'), sub('board'), sub('linkedcluster'), sub('grid'), sub('schedule'), sub('doc'), sub('file'),
      { divider: true },
      { header: 'Visual' },
      sub('shape'), sub('palette', 'Palette'), sub('draw'),
      { divider: true },
      { header: 'Web' },
      sub('addurl', 'Link'),
      { divider: true },
      { header: 'Annotate' },
      sub('comment'), sub('vote'),
      { id: 'arrow', label: 'Arrow', run: settled(() => setSelectedTool('arrow')) },
    ].filter(Boolean);
    return [
      { id: 'add', label: 'Add', submenu: addSubmenu },
      { header: SECTION.CLIPBOARD },
      { id: 'paste', label: clipboardSize() ? `Paste (${clipboardSize()})` : 'Paste',
        shortcut: `${cmdKey}V`, disabled: clipboardSize() === 0,
        run: () => doPaste(pos) },
      { id: 'selectall', label: 'Select all', shortcut: `${cmdKey}A`, run: selectAll },
      { header: 'BOARD' },
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
      { divider: true },
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
    // Capture phase so an inner stopPropagation can't swallow Escape, and a
    // named handler (not {once:true}) so it (a) keeps working across repeated
    // opens and (b) is actually removed on cleanup instead of leaking until
    // some unrelated Escape fires.
    const onKey = (e) => { if (e.key === 'Escape') setTagChipMenu(null); };
    // pointerdown too so a tap-away closes it on touch (mousedown may not fire).
    window.addEventListener('pointerdown', onAway, { capture: true });
    window.addEventListener('mousedown', onAway, { capture: true });
    window.addEventListener('keydown', onKey, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', onAway, { capture: true });
      window.removeEventListener('mousedown', onAway, { capture: true });
      window.removeEventListener('keydown', onKey, { capture: true });
    };
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
  // Live vote cards — a separate annotation type sharing the comment
  // anchoring/drag/hide machinery. They hide with the comments eye toggle
  // (CanvasVoteLayer gets layerVisible={commentsVisible}).
  const { voteCards, removeLocally: removeVoteLocally } = useVoteCards(board?.id);
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
  // Drop a vote card immediately at the given anchor (no draft — a vote's
  // question label is optional and editable on the card afterward). Same
  // anchor descriptor shape as promptComment.
  const addVoteCardAt = async (anchor) => {
    if (!workspaceId || !board?.id || !userId) return;
    try {
      await addVoteCard({ workspaceId, boardId: board.id, author: userId, anchor, label: null });
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Add vote failed: ' + (err.message || err) });
    }
  };
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
    if (isEditorPointerTarget(e)) return;
    if (e.target.closest && e.target.closest('.editable')) return;
    if (c.kind === 'board') {
      // Read-only viewers already navigate on single click (the !canEdit
      // branch of onCardPointerDown) — suppress the double-click path so a
      // double-tap doesn't fire onOpenBoard twice for the same gesture.
      if (!canEdit) return;
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
    if (c.kind === 'boardlink') { if (canEdit) { boards[c.target] && onOpenBoard(c.target); } return; }
    // Double-click an art canvas → re-open it in the fullscreen
    // SketchPad with its existing strokes loaded for editing.
    if (c.kind === 'art') {
      e.stopPropagation();
      setSketchpadEditId(c.id);
      setSketchpadOpen(true);
      return;
    }
    if (c.kind === 'pdf') {
      if (!c.pdfSrc) return;
      e.stopPropagation();
      setPdfViewer({ src: c.pdfSrc, name: c.name || c.title || 'PDF' });
      return;
    }
    // image / note / link / etc — defer to inner editors so dbl-click
    // re-enters edit mode reliably. (Images: ImageCard's own .ic-imgwrap
    // dbl-click handles title edit; fullscreen view is the corner Expand button
    // + single-tap in focus view. Open a link via the link-card icon or
    // right-click → Open.)
  };

  // Touch: synthesize the double-tap that native dblclick fumbles on mobile so
  // board/boardlink tiles still OPEN (and art still re-opens) on a phone.
  // Reuses onCardDoubleClick, which already encodes the per-kind action, bails
  // on `.editable`, and no-ops for notes/images. Notes & inline titles detect
  // their OWN double-tap and stopPropagation on the 2nd tap, so this never
  // double-fires for them.
  const lastCardTapRef = useRef({});
  const onCardPointerUp = (e, c) => {
    if (e.pointerType !== 'touch') return;
    if (tapIsDouble(lastCardTapRef, e, { key: c.id })) onCardDoubleClick(e, c);
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

  // Spatial sequence numbering: for each named sequence, read its member Grids
  // in the chosen pattern and map gridId → 0-based index. Keyed on card positions
  // + sequence config, so inserting/moving a Grid auto-renumbers with no writes.
  // The [#]/[A] tags inside cells resolve against this index (see GridCard).
  const gridSeqIndex = useMemo(() => {
    const m = new Map();
    const bySeq = new Map();
    for (const c of (cards || [])) {
      if (c.kind === 'grid' && c.seqId) {
        if (!bySeq.has(c.seqId)) bySeq.set(c.seqId, []);
        bySeq.get(c.seqId).push(c);
      }
    }
    for (const [seqId, gs] of bySeq) {
      const pattern = gridSequences[seqId]?.pattern || 'z';
      spatialOrder(gs.map((g) => ({ id: g.id, x: g.x, y: g.y, w: g.w, h: g.h })), pattern)
        .forEach((id, i) => m.set(id, i));
    }
    return m;
  }, [cards, gridSequences]);
  const gridSeqFormatFor = (c) => (c?.seqId && gridSequences[c.seqId]?.format) || null;

  // Bulk-generate from the inline control, confirming for very large matrices.
  const makeGridMatrix = async (gridId, cols, rows) => {
    const n = cols * rows;
    if (n > 200) {
      const ok = await feedback.confirm?.({ title: 'Make a big grid', message: `This creates ${n} grids — it may take a moment. Continue?`, confirmLabel: 'Make grid' });
      if (!ok) return;
    }
    mutators.bulkGenerateGrids?.(gridId, cols, rows);
  };

  // Editing actions GridCard calls — thin forwards to the grid mutators plus the
  // canvas-context bits (image/file upload, link prompt) that a cell needs.
  // ── Universal cell content (paste / drop anything into a grid cell) ─────────
  // Focused grid cell — the paste/drop target set by clicking a specific cell.
  const [focusedCell, setFocusedCell] = useState(null); // { gridId, cellId } | null
  const focusedCellRef = useRef(null);
  const focusCell = useCallback((gridId, cellId) => {
    const v = (gridId && cellId) ? { gridId, cellId } : null;
    // Same-cell dedupe: focusCell fires on EVERY pointerdown inside a cell
    // (capture phase), and an unconditional setState here re-renders GridCard
    // mid-click — which used to remount the cell tools between pointerdown and
    // pointerup, eating the click. Skip when focus isn't actually changing.
    const cur = focusedCellRef.current;
    if ((!v && !cur) || (v && cur && cur.gridId === v.gridId && cur.cellId === v.cellId)) return;
    focusedCellRef.current = v;
    setFocusedCell(v);
  }, []);
  // Per-cell upload progress (paste / drop / Image-picker into a cell), keyed
  // `${gridId}:${cellId}` → fraction 0..1. Drives the in-cell spinner overlay so
  // the user sees that an upload is happening (mirrors the canvas ImageCard pattern).
  const [cellUploads, setCellUploads] = useState({});
  // A grid text cell currently being edited → surfaces the note formatting toolbar
  // (font / size / style) scoped to that cell's editor. { gridId, cellId } | null.
  const [editingCell, setEditingCell] = useState(null);
  // Whether the cell being edited is "pinned" (has its own frozen text style, i.e.
  // "only this box"). Tracked as state (a cell's nested `style` change does NOT bust
  // the top-level cards snapshot) and updated optimistically on toggle.
  const [editingCellPinned, setEditingCellPinned] = useState(false);
  // Sticky "All boxes / This box" scope preference, remembered per grid for this
  // session. Once you style a single box in a grid, the next box you select there
  // pre-selects the same scope so repeat per-box edits are one click. Cleared
  // implicitly on reload (a ref, not persisted). gridId -> 'all' | 'box'.
  const cellScopePrefRef = useRef(new Map());
  // Live-read a grid cell record across both shells (Yjs gridCells / local card.cells).
  const gridCellRecord = useCallback((gridId, cellId) => {
    if (!gridId || !cellId) return null;
    const ym = ydoc?.getMap?.('cards')?.get?.(gridId);
    const cm = ym && ym.get && ym.get('gridCells');
    if (cm && cm.get) { const v = cm.get(cellId); return (v && v.toJSON) ? v.toJSON() : v; }
    const c = cards.find((cc) => cc.id === gridId);
    return c?.cells?.[cellId] || null;
  }, [ydoc, cards]);
  const recIsPinned = (r) => !!(r && r.style && Object.keys(r.style).length);
  // Filling an EMPTY grid cell with weighted content (image / link / file) counts
  // toward the demo card cap (a grid of 25 images ≈ 25 cards). Block + open the
  // upgrade modal at the cap. No-op where there's no guard (local QA / paid tier).
  // Dragging an EXISTING card into a cell is a move (source consumed) → net-neutral,
  // so those paths (routeCardIntoCell) intentionally don't call this.
  const guardCellFill = useCallback((gridId, cellId) => {
    const rec = gridCellRecord(gridId, cellId);
    const wasEmpty = !rec || rec.type === 'empty' || (rec.type === 'image' && !rec.src);
    if (!wasEmpty) return true;   // replacing existing content — no new weight
    return mutators.guardWeightedAdd ? mutators.guardWeightedAdd() : true;
  }, [gridCellRecord, mutators]);
  // The cell the bottom style bar targets. Either a text cell mid-edit (editingCell)
  // OR — when a single grid is selected — the box you've clicked (focusedCell), so
  // you can restyle ANY box (image / link / empty), not just a text box you've
  // double-clicked into. `editing` distinguishes the two (emphasis controls need a
  // live editor). See ToolOptionsBar's cellStyleMode.
  const styleCell = useMemo(() => {
    if (editingCell) return { gridId: editingCell.gridId, cellId: editingCell.cellId, editing: true };
    // The selected-not-editing box bar is a Select-tool affordance. With a place /
    // draw / shape / arrow tool active, fall through so the toolbar shows THAT tool's
    // options — a merely-selected box has no DOM focus to blur, so it would otherwise
    // survive a tool switch and keep hijacking the bar.
    if (selectedTool !== 'select') return null;
    const fc = focusedCell;
    if (!canEdit || !fc || selected.size !== 1) return null;
    const gid = [...selected][0];
    if (gid !== fc.gridId) return null;
    const gc = cardById[gid];
    if (!gc || gc.kind !== 'grid') return null;
    return { gridId: fc.gridId, cellId: fc.cellId, editing: false };
  }, [editingCell, focusedCell, selected, cardById, canEdit, selectedTool]);
  // Content type of the targeted box → the style bar tailors its controls
  // (typography for text/empty/link; just Box background for image/video/file).
  const styleCellKind = useMemo(() => {
    if (!styleCell) return null;
    const rec = gridCellRecord(styleCell.gridId, styleCell.cellId);
    return (rec && rec.type) || 'empty';
  }, [styleCell, gridCellRecord]);
  // Re-derive pinned state when the targeted cell changes / board switches. A cell
  // that already has its own style is pinned; otherwise fall back to the grid's
  // remembered scope preference (the sticky "This box" default).
  useEffect(() => {
    if (!styleCell) { setEditingCellPinned(false); return; }
    if (recIsPinned(gridCellRecord(styleCell.gridId, styleCell.cellId))) { setEditingCellPinned(true); return; }
    setEditingCellPinned(cellScopePrefRef.current.get(styleCell.gridId) === 'box');
  }, [styleCell, gridCellRecord]);
  // Drop cell focus when its grid disappears — deleted, or board-switched (the
  // surface doesn't remount on board change). Prevents a stale paste being
  // silently swallowed into a vanished cell.
  useEffect(() => {
    const fc = focusedCellRef.current;
    if (fc && !cards.some((c) => c.id === fc.gridId)) focusCell(null, null);
    setEditingCell((ec) => (ec && !cards.some((c) => c.id === ec.gridId) ? null : ec));
  }, [cards, focusCell]);
  // The key a WRITE should land on. Grid cells write in place. A schedule
  // SLOT key (day/hour/minute path) mints a fresh `<slot>/i:<uid>` so writes
  // APPEND (multi-item slots); a schedule ITEM key writes in place (replace
  // that item — an explicit act like paste-with-a-chip-focused). Resolved
  // ONCE at operation entry and threaded through the whole operation — the
  // async link-preview backfill reuses the SAME key, so it can never mint a
  // second item.
  const resolveCellWriteKey = useCallback((gridId, cellId) => {
    if (!gridId || !cellId) return cellId;
    const t = cardById[gridId];   // stable singleton — intentionally not in deps
    if (!t || t.kind !== 'schedule' || !t.schedView) return cellId;
    return isSchedItemKey(cellId) ? cellId : mintSchedItemKey(cellId, schedUid());
  }, []);
  // Decode a file list into the right cell content (image / video / file).
  const fillCellFromFiles = useCallback(async (gridId, cellId, files) => {
    const f = files && files[0]; if (!f) return;
    cellId = resolveCellWriteKey(gridId, cellId);
    if (!guardCellFill(gridId, cellId)) return;   // demo cap: filling counts as a card
    const mime = f.type || '';
    const key = `${gridId}:${cellId}`;
    const onProgress = (frac) => setCellUploads((p) => ({ ...p, [key]: frac }));
    setCellUploads((p) => ({ ...p, [key]: 0 }));   // show the spinner the moment upload starts
    try {
      if (mime.startsWith('image/')) {
        const up = await uploadImage({ file: f, workspaceId, boardId: board?.id, cardId: gridId, userId, onProgress });
        mutators.setGridCellContent?.(gridId, cellId, { type: 'image', src: up.src, fit: 'cover' });
      } else if (mime.startsWith('video/')) {
        const up = await uploadVideo({ file: f, workspaceId, boardId: board?.id, userId, onProgress });
        mutators.setGridCellContent?.(gridId, cellId, { type: 'video', src: up.src });
      } else {
        const up = await uploadFile({ file: f, workspaceId, boardId: board?.id, cardId: gridId, userId, onProgress });
        mutators.setGridCellContent?.(gridId, cellId, { type: 'file', fileSrc: up.src, fileName: up.fileName, mime: up.mime, sizeBytes: up.sizeBytes, ext: up.ext });
      }
    } catch (e) { feedback.toast({ type: 'error', message: 'Upload failed: ' + (e.message || e) }); }
    finally { setCellUploads((p) => { const n = { ...p }; delete n[key]; return n; }); }
  }, [mutators, workspaceId, board?.id, userId, feedback, guardCellFill, resolveCellWriteKey]);
  // Decode a clipboard/drag payload INTO a cell: files/images → upload; a bare URL
  // → link (with async preview); any other text → a text cell. Shared by paste +
  // external drop so a cell auto-formats whatever you give it.
  const pasteIntoCell = useCallback(async (gridId, cellId, dt) => {
    if (!dt) return false;
    cellId = resolveCellWriteKey(gridId, cellId);
    if (dt.files && dt.files.length) { await fillCellFromFiles(gridId, cellId, dt.files); return true; }
    if (dt.items) {
      for (const it of dt.items) {
        if (it.kind === 'file' && (it.type || '').startsWith('image/')) {
          const f = it.getAsFile(); if (f) { await fillCellFromFiles(gridId, cellId, [f]); return true; }
        }
      }
    }
    const text = (dt.getData && dt.getData('text/plain')) || '';
    const urlMatch = text.match(/^\s*(https?:\/\/\S+)\s*$/i);
    if (urlMatch) {
      if (!guardCellFill(gridId, cellId)) return true;   // demo cap: a link counts as a card
      const url = urlMatch[1];
      const embed = detectEmbed(url);
      let title = url; try { title = new URL(url).hostname.replace(/^www\./, ''); } catch (_) {}
      const patch = { type: 'link', source: url, link: url, title };
      if (embed) patch.embed = embed;
      mutators.setGridCellContent?.(gridId, cellId, patch);
      if (!embed) fetchLinkPreview(url).then((p) => { if (!p) return; const np = {}; if (p.title) np.title = p.title; if (p.image) np.image = p.image; if (p.favicon) np.favicon = p.favicon; if (Object.keys(np).length) mutators.setGridCellContent?.(gridId, cellId, np); });
      return true;
    }
    if (text.trim().length) {
      const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const html = text.split(/\r?\n/).map((l) => `<div>${esc(l) || '<br>'}</div>`).join('');
      mutators.setGridCellContent?.(gridId, cellId, { type: 'text', html });
      return true;
    }
    return false;
  }, [fillCellFromFiles, mutators, guardCellFill, resolveCellWriteKey]);

  const gridActions = useMemo(() => ({
    focusCell,
    pasteIntoCell,
    // GridCard tells us when a text cell enters/leaves edit mode so the bottom
    // toolbar can show the note formatting controls scoped to that cell.
    setCellEditing: (gridId, cellId) => setEditingCell((gridId && cellId) ? { gridId, cellId } : null),
    setTextStyle: (gridId, cellId, patch, opts) => mutators.setGridTextStyle?.(gridId, cellId, patch, opts),
    pinCell: (gridId, cellId) => mutators.pinCellStyle?.(gridId, cellId),
    unpinCell: (gridId, cellId) => mutators.unpinCellStyle?.(gridId, cellId),
    resizeDivider: (gridId, path, ci, df) => mutators.resizeGridDivider?.(gridId, path, ci, df),
    splitCell: (gridId, cellId, orientation) => mutators.splitGridCell?.(gridId, cellId, orientation),
    mergeCell: (gridId, cellId) => mutators.mergeGridCell?.(gridId, cellId),
    removeDivider: (gridId, path, childIndex) => mutators.removeGridDivider?.(gridId, path, childIndex),
    setCellContent: (gridId, cellId, patch) => mutators.setGridCellContent?.(gridId, cellId, patch),
    clearCellContent: (gridId, cellId) => mutators.clearGridCellContent?.(gridId, cellId),
    // True key delete — schedule item chips remove entirely (a {type:'empty'}
    // tombstone would linger as a ghost entry in a multi-item slot).
    removeCellRecord: (gridId, cellId) => mutators.removeGridCellRecord?.(gridId, cellId),
    // Schedule breakdown: 'hours' on a day slot / 'minutes' on an hour slot /
    // null to collapse (meta-only, non-destructive).
    setSlotExpand: (cardId, slotPath, mode) => mutators.setSchedSlotExpand?.(cardId, slotPath, mode),
    // Re-date schedule content. The date lives IN the key, so both of these are
    // re-keys rather than field writes (lib/schedLayout.js).
    moveItem: (cardId, fromKey, toSlotPath) => mutators.moveSchedItem?.(cardId, fromKey, toSlotPath),
    moveSlot: (cardId, fromSlot, toSlot) => mutators.moveSchedSlot?.(cardId, fromSlot, toSlot),
    // One transaction for the rundown's convert-legacy-on-first-edit rewrite.
    applyRundownPlan: (cardId, plan) => mutators.applyRundownPlan?.(cardId, plan),
    unlinkGrid: (gridId) => mutators.unlinkGrid?.(gridId),
    promoteToTemplate: (gridId) => mutators.promoteGridToTemplate?.(gridId),
    stampNeighbor: (gridId, dir) => mutators.stampGridNeighbor?.(gridId, dir),
    bulkGenerate: (gridId, cols, rows) => mutators.bulkGenerateGrids?.(gridId, cols, rows),
    pickImageForCell: (gridId, cellId) => {
      // Resolve the write key BEFORE the picker opens so the async onchange
      // lands on the same (possibly freshly-minted schedule item) key.
      cellId = resolveCellWriteKey(gridId, cellId);
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*';
      // Route through fillCellFromFiles so the Image-picker gets the same in-cell
      // spinner + progress as paste/drop.
      input.onchange = () => { if (input.files?.[0]) fillCellFromFiles(gridId, cellId, input.files); };
      input.click();
    },
    fillCellFromFiles,
    addLinkToCell: async (gridId, cellId) => {
      cellId = resolveCellWriteKey(gridId, cellId);
      if (!guardCellFill(gridId, cellId)) return;   // demo cap: a link counts as a card
      const v = await feedback.prompt({ title: 'Add a link', label: 'URL', placeholder: 'https://…', confirmLabel: 'Add' });
      if (!v) return;
      const url = v.trim(); if (!url) return;
      const embed = detectEmbed(url);
      let title = url;
      try { title = new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, ''); } catch (_) {}
      const patch = { type: 'link', source: url, link: url, title };
      if (embed) patch.embed = embed;
      mutators.setGridCellContent?.(gridId, cellId, patch);
      if (!embed) fetchLinkPreview(url).then((p) => {
        if (!p) return;
        const np = {};
        if (p.title) np.title = p.title;
        if (p.image) np.image = p.image;
        if (p.favicon) np.favicon = p.favicon;
        if (Object.keys(np).length) mutators.setGridCellContent?.(gridId, cellId, np);
      });
    },
  }), [mutators, workspaceId, board?.id, userId, feedback, focusCell, pasteIntoCell, fillCellFromFiles, guardCellFill, resolveCellWriteKey]);

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
    // Candidate connect target: arrow tool, a source already chosen, cursor over
    // this (different) card. Highlights what the next click will connect to.
    const isArrowTarget = selectedTool === 'arrow' && !!arrowFrom
      && arrowHoverCardId === c.id && !isArrowSource;
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
    const onCardMouseEnter = (e) => {
      if (selectedTool === 'arrow') setArrowHoverCardId(c.id);
      if (hoverPrefetchTarget) scheduleHoverPrefetch(hoverPrefetchTarget);
    };
    const onCardMouseLeave = (e) => {
      if (selectedTool === 'arrow') setArrowHoverCardId(prev => (prev === c.id ? null : prev));
      if (hoverPrefetchTarget) cancelHoverPrefetch();
    };
    const wrapper = {
      style: isTagDropHover
        ? { ...wrapperStyle, '--tag-drop-color': tagDropTarget.color }
        : wrapperStyle,
      className: `card ${kindCls} ${isSelected ? 'is-selected' : ''} ${inDrag ? 'is-dragging' : ''} ${isArrowSource ? 'is-arrow-source' : ''}${isArrowTarget ? ' is-arrow-target' : ''}${isTagDropHover ? ' is-tag-drop' : ''}${isLinkTarget ? ' is-link-target' : ''}${isBoardDropTarget ? ' is-card-drop-target' : ''}${isFadingForBoardDrop ? ' is-fading-for-drop' : ''}${newCardIds.has(c.id) ? ' is-new' : ''}${liftedCardId === c.id ? ' is-lifted' : ''}${pressingCardId === c.id ? ' is-lifting' : ''}`,
      'data-card-id': c.id,
      onPointerDown: (e) => onCardPointerDown(e, c),
      onPointerUp: (e) => onCardPointerUp(e, c),
      onContextMenu: (e) => onCardContextMenu(e, c),
      onDoubleClick: (e) => onCardDoubleClick(e, c),
      onMouseEnter: onCardMouseEnter,
      onMouseLeave: onCardMouseLeave,
    };

    // View-only boards: nulling onUpdate flips every card kind into the
    // read-only branch its component already implements (PaletteCard's
    // `isEditable = !!onUpdate` is the canonical pattern; ImageCard /
    // NoteCard / LinkCard / VideoCard / AudioCard / DocCard all gate
    // their editor mount on onUpdate presence too). Without this, demo
    // users could type into notes / rename titles / etc. and watch each
    // keystroke flash locally and snap back when RLS rejects the save.
    const onUpdate = canEdit ? (patch) => mutators.updateCard?.(c.id, patch) : null;
    const af = (autoFocusId === c.id);

    let inner = null;
    if (c.kind === 'board') {
      const target = boards[c.id];
      if (!target && boardsReady && typeof window !== 'undefined') {
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
                     onRename={canEdit ? (name) => mutators.renameBoardById?.(c.id, name) : null}
                     autoFocus={af} />
        : boardsReady
          ? <div className="bc bc-missing" title={`Missing cluster ${c.id}`}>Missing cluster</div>
          : <div className="bc bc-loading" aria-hidden="true" />;
    } else if (c.kind === 'boardlink') {
      const target = boards[c.target];
      inner = (!target && !boardsReady)
        ? <div className="blc blc-loading" aria-hidden="true" />
        : <BoardLinkCard targetBoard={target} note={c.note} onOpen={() => target && onOpenBoard(c.target)} />;
    } else if (c.kind === 'image')   inner = <ImageCard src={c.src || localImagePreview[c.id] || null} tone={c.tone} label={c.label} title={c.title} link={c.link} aspect={`${c.w}/${c.h}`} w={Math.round(c.w)} h={Math.round(c.h)} caption={c.caption} onUpdate={onUpdate} autoFocus={af}
                                                     cardId={c.id}
                                                     adjust={compareCardId === c.id ? null : c.adjust}
                                                     editing={imageEdit?.cardId === c.id}
                                                     backfillEnabled={canEdit} boardId={board.id}
                                                     editTitleAt={editFieldSignal.id === c.id && editFieldSignal.field === 'title' ? editFieldSignal.n : 0}
                                                     editCaptionAt={editFieldSignal.id === c.id && editFieldSignal.field === 'caption' ? editFieldSignal.n : 0}
                                                     pending={!!c.pending}
                                                     uploadProgress={uploadProgressById[c.id] ?? null}
                                                     onExpand={() => openImageLightbox(c)}
                                                     onEdit={onUpdate && c.src ? (rect) => setImageEdit({ cardId: c.id, anchorRect: rect }) : null}
                                                     onDownload={c.src ? () => downloadImage({ src: c.src, title: c.title || c.label || '', adjust: c.adjust }) : null}
                                                     onAfterEdit={() => { setSelected(new Set()); clearAutoFocus?.(); }} />;
    else if (c.kind === 'note')      inner = <NoteCard body={c.body} html={c.html} bgColor={c.bgColor} textColor={c.textColor} fontFamily={c.fontFamily} fontSize={c.fontSize} vAlign={c.vAlign} onUpdate={onUpdate} autoFocus={af}
                                                manuallyResized={!!c.manuallyResized}
                                                awareness={getAwareness?.() || null}
                                                cardId={c.id} boardId={board.id}
                                                ydoc={ydoc} cardYMap={ydoc?.getMap('cards')?.get(c.id) || null}
                                                currentUser={currentUser} isPublic={isPublic}
                                                peerLiveHtml={peerNoteEdits[c.id] ?? null}
                                                onEditingChange={(editing) => setEditingNoteId(editing ? c.id : (prev => (prev === c.id ? null : prev)))} />;
    else if (c.kind === 'link')      inner = <LinkCard title={c.title} source={c.source} target={c.target}
                                                       image={c.image} description={c.description} favicon={c.favicon}
                                                       embed={c.embed}
                                                       isSelected={isSelected}
                                                       onUpdate={onUpdate} autoFocus={af}
                                                       editTitleAt={editFieldSignal.id === c.id && editFieldSignal.field === 'title' ? editFieldSignal.n : 0} />;
    else if (c.kind === 'palette')   inner = <PaletteCard title={c.title} swatches={c.swatches} hideHex={c.hideHex} hideLabels={c.hideLabels} chipsOnly={c.chipsOnly} w={Math.round(w)} h={Math.round(h)} onUpdate={onUpdate} autoFocus={af}
                                                          editTitleAt={editFieldSignal.id === c.id && editFieldSignal.field === 'title' ? editFieldSignal.n : 0} />;
    else if (c.kind === 'video')     inner = <VideoCard src={c.src} poster={c.poster} title={c.title}
                                                        autoplay={!!c.autoplay} loop={!!c.loop} onUpdate={onUpdate} autoFocus={af}
                                                        editTitleAt={editFieldSignal.id === c.id && editFieldSignal.field === 'title' ? editFieldSignal.n : 0} />;
    else if (c.kind === 'audio')     inner = <AudioCard src={c.src} title={c.title} duration={c.duration} cover={c.cover}
                                                        onUpdate={onUpdate} autoFocus={af}
                                                        coverPickAt={editFieldSignal.id === c.id && editFieldSignal.field === 'audioCover' ? editFieldSignal.n : 0}
                                                        editTitleAt={editFieldSignal.id === c.id && editFieldSignal.field === 'title' ? editFieldSignal.n : 0}
                                                        onPickCover={(file) => pickAudioCover(c.id, file)} />;
    else if (c.kind === 'pdf')       inner = <PdfCard src={c.src || null} pdfSrc={c.pdfSrc} name={c.name} pageCount={c.pageCount}
                                                      title={c.title} w={Math.round(c.w)} h={Math.round(c.h)}
                                                      onUpdate={onUpdate} autoFocus={af}
                                                      cardId={c.id} backfillEnabled={canEdit} boardId={board.id}
                                                      editTitleAt={editFieldSignal.id === c.id && editFieldSignal.field === 'title' ? editFieldSignal.n : 0}
                                                      pending={!!c.pending}
                                                      uploadProgress={uploadProgressById[c.id] ?? null}
                                                      onExpand={() => c.pdfSrc && setPdfViewer({ src: c.pdfSrc, name: c.name || c.title || 'PDF' })}
                                                      onAfterEdit={() => { setSelected(new Set()); clearAutoFocus?.(); }} />;
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
                     isPublic={isPublic}
                     onDock={onDockDoc}
                     isDocked={dockedDocCardId === c.id}
                     autoFocus={af}
                     onUpdate={onUpdate} />
      ) : <DocCard title={c.title} lines={c.lines} author={c.author} date={c.date} onUpdate={onUpdate} autoFocus={af} />;
    }
    else if (c.kind === 'schedule' && !c.schedView)
      // LEGACY schedule (static rows table) — generator-seeded cards keep
      // rendering; new-model cards (schedView) take the container branch below.
      inner = <ScheduleTableCard title={c.title} rows={c.rows} onUpdate={onUpdate}
                                 editTitleAt={editFieldSignal.id === c.id && editFieldSignal.field === 'title' ? editFieldSignal.n : 0} />;
    else if (c.kind === 'schedule') {
      // Schedule card — the real-date calendar container. Same cell plumbing as
      // the grid branch below: cardYMap exposes the nested gridCells/gridMeta,
      // and the per-card upload slice keys by the item path.
      const cardYMap = ydoc?.getMap?.('cards')?.get?.(c.id) || null;
      const schedUploads = {};
      for (const k in cellUploads) { if (k.startsWith(`${c.id}:`)) schedUploads[k.slice(c.id.length + 1)] = cellUploads[k]; }
      inner = <ScheduleCard card={c} w={Math.round(w)} h={Math.round(h)} ydoc={ydoc} cardYMap={cardYMap}
                            canEdit={canEdit} onUpdate={onUpdate}
                            focusedCellId={focusedCell?.gridId === c.id ? focusedCell.cellId : null}
                            dropCellId={cellDropTarget?.gridId === c.id ? cellDropTarget.cellId : null}
                            cellUploads={schedUploads}
                            boards={boards} onOpenBoard={onOpenBoard}
                            onSetSchedule={onSetSchedule} onAddShootDay={onAddShootDay}
                            gridActions={gridActions} getAwareness={getAwareness} boardId={board.id} />;
    }
    else if (c.kind === 'shape')     inner = <ShapeCard key={`shape-${c.shape}`} shape={c.shape} stroke={c.stroke} fill={c.fill} strokeWidth={c.strokeWidth} dash={c.dash}
                                                        label={c.label} onUpdate={onUpdate}
                                                        editLabelAt={editFieldSignal.id === c.id && editFieldSignal.field === 'shapeLabel' ? editFieldSignal.n : 0} />;
    else if (c.kind === 'art')       inner = <ArtCanvasCard bg={c.bg || '#ffffff'} />;
    else if (c.kind === 'grid') {
      // Grid card. cardYMap gives GridCard access to its nested gridCells Y.Map
      // (cell content). Layout comes from the shared template when linked, else
      // from c.layout. seqIndex/seqFormat (label tags) + interactive dividers land
      // in later phases; P1 renders the static cell layout read-only.
      const cardYMap = ydoc?.getMap?.('cards')?.get?.(c.id) || null;
      // Per-cell upload progress slice for this grid: { cellId: frac }.
      const gridUploads = {};
      for (const k in cellUploads) { if (k.startsWith(`${c.id}:`)) gridUploads[k.slice(c.id.length + 1)] = cellUploads[k]; }
      inner = <GridCard card={c} w={Math.round(w)} h={Math.round(h)} ydoc={ydoc} cardYMap={cardYMap}
                        templates={gridTemplates} seqIndex={gridSeqIndex.get(c.id)} seqFormat={gridSeqFormatFor(c)}
                        isSelected={isSelected} canEdit={canEdit} onUpdate={onUpdate}
                        annotationsVisible={commentsVisible}
                        focusedCellId={focusedCell?.gridId === c.id ? focusedCell.cellId : null}
                        dropCellId={cellDropTarget?.gridId === c.id ? cellDropTarget.cellId : null}
                        cellUploads={gridUploads}
                        boards={boards} onOpenBoard={onOpenBoard}
                        gridActions={gridActions} getAwareness={getAwareness} boardId={board.id} />;
    }
    else if (c.kind === 'file')      inner = <FileCard fileSrc={c.fileSrc} fileName={c.fileName} mime={c.mime}
                                                       sizeBytes={c.sizeBytes} ext={c.ext} title={c.title}
                                                       onUpdate={onUpdate} autoFocus={af}
                                                       cardId={c.id}
                                                       editTitleAt={editFieldSignal.id === c.id && editFieldSignal.field === 'title' ? editFieldSignal.n : 0}
                                                       pending={!!c.pending}
                                                       uploadProgress={uploadProgressById[c.id] ?? null}
                                                       onAfterEdit={() => { setSelected(new Set()); clearAutoFocus?.(); }} />;
    else inner = <div className="card-unknown">{c.kind}</div>;

    // Tag chips along the card's bottom edge so the user actually sees
    // their tagging — without this, "Tag…" silently writes to the DB
    // and the user has no feedback that anything happened.
    const cardTags = tagsByCard?.get?.(c.id) || [];
    return (
      <div key={c.id} {...wrapper} data-tour={c.kind === 'board' ? 'cluster-card' : undefined}>
        {inner}
        <CardStrokesOverlay card={c} w={w} h={h} />
        {cardTags.length > 0 && (
          <div className="card-tags-strip" data-card-id={c.id}>
            {cardTags.slice(0, 4).map(t => (
              <span key={t.id}
                    role="button"
                    className={`card-tag-chip is-clickable is-${t.source || 'user'}`}
                    style={{ '--tag-c': t.color || '#4f8df8', cursor: 'pointer' }}
                    title={`${t.name}${t.source && t.source !== 'user' ? ` (${t.source})` : ''} — click to see everywhere it's used`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      // Click-through to the tag's cross-board collection — the
                      // payoff. Was a dead-end (right-click only) before.
                      e.preventDefault();
                      e.stopPropagation();
                      try { logEvent(EV.TAG_COLLECTION_OPEN, { tag_id: t.id, via: 'card_chip' }); } catch (_) {}
                      document.dispatchEvent(new CustomEvent('soleil-open-tag', { detail: { tagId: t.id } }));
                    }}
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
        {canEdit && selectedTool === 'select' && !(effectiveSelectedIds.size > 1 && effectiveSelectedIds.has(c.id)) && (
          <div className="card-resize" onPointerDown={(e) => onResizePointerDown(e, c)}
               title={(c.kind === 'image' || c.kind === 'video' || c.kind === 'pdf')
                 ? `Drag to resize — hold ${cmdKey} to break the aspect ratio`
                 : undefined}
               style={{ width: RESIZE_HANDLE_PX, height: RESIZE_HANDLE_PX }} />
        )}
        {canEdit && selectedTool === 'select' && isSelected && canRotate && (
          <div className="card-rotate" onPointerDown={(e) => onRotatePointerDown(e, c)} title="Drag to rotate (shift = 15° steps)" />
        )}
        {/* Touch-only "⋯" — the card context menu's new home now that a
            long-press lifts the card for dragging instead of opening it.
            CSS hides it except on coarse pointers (desktop keeps right-click). */}
        {canEdit && selectedTool === 'select' && isSelected
          && !(effectiveSelectedIds.size > 1 && effectiveSelectedIds.has(c.id)) && (
          <button type="button" className="card-menu-btn" aria-label="Card options"
            onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
            onClick={(e) => {
              e.stopPropagation();
              const r = e.currentTarget.getBoundingClientRect();
              setBgCtx(b => ({ ...b, open: false }));
              if (!selected.has(c.id)) setSelected(new Set([c.id]));
              setCtx({ open: true, x: r.left, y: r.bottom, cardId: c.id });
            }}>⋯</button>
        )}
        {canEdit && selectedTool === 'select' && isSelected && c.kind === 'grid'
          && !(effectiveSelectedIds.size > 1 && effectiveSelectedIds.has(c.id)) && (
          <GridMatrixControl onGenerate={(cols, rows) => makeGridMatrix(c.id, cols, rows)} />
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
        !types.includes(BOARD_REF_LIST_MIME) &&
        !types.includes(CARD_TRANSFER_MIME) &&
        !types.includes(ENTITY_REF_MIME) &&
        !types.includes(ENTITY_REF_LIST_MIME) &&
        !types.includes('application/x-soleil-doc-page') &&
        !types.includes('text/uri-list') &&
        !types.includes('text/plain') &&
        !types.includes('text/html') &&
        !types.includes('Files')) return;
    // Always preventDefault for a recognized-intent drag so (a) the drop
    // event fires here and (b) the window-level safety net doesn't have to.
    e.preventDefault();
    // View-only board: accept the event (no browser navigation) but show a
    // no-drop cursor and don't highlight — the drop handler will reject it.
    if (!canEdit) { e.dataTransfer.dropEffect = 'none'; return; }
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
    // View-only board: swallow the drop (so the browser never navigates) and
    // tell the user, rather than silently no-op'ing the mutators.
    if (!canEdit) {
      e.preventDefault();
      feedback?.toast?.({ type: 'info', message: 'This cluster is view-only — drops are disabled.' });
      return;
    }
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
              feedback.toast({ type: 'info', message: 'Drop a tag onto a card or cluster to apply it.' });
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
        id: `xlink-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
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
        if (Object.keys(patch).length) mutators.updateCardSilent?.(newId, patch);
      });
      return;
    }

    // Sidebar / list board(s) dropped onto this canvas → NEST them (reparent).
    // Default target is the board this canvas shows; if the drop landed on a
    // board card, nest under THAT board instead. The shared handler validates
    // cycles/self and the reconcile-drift effect materializes the card.
    if (types.includes(BOARD_REF_MIME) || types.includes(BOARD_REF_LIST_MIME)) {
      e.preventDefault();
      const childIds = readBoardRefIds(e.dataTransfer);
      if (!childIds.length) return;
      let targetId = board.id;
      const cardEl = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-card-id]');
      const overId = cardEl?.getAttribute('data-card-id');
      const overCard = overId ? (cards || []).find(c => c.id === overId) : null;
      if (overCard?.kind === 'board') targetId = overCard.id;
      else if (overCard?.kind === 'boardlink' && overCard.target) targetId = overCard.target;
      document.dispatchEvent(new CustomEvent('soleil-board-reparent-drop', {
        detail: { childIds, targetId, sourceSurface: 'canvas' },
      }));
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
          id: `xlink-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
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

    // Plain / rich text dragged from another app or browser tab → note card.
    // (URLs are handled by the text/uri-list branch above; this is reached
    // only for selections that aren't a URI.) We deliberately extract PLAIN
    // text from any text/html payload rather than embedding markup — a note
    // dropped from an arbitrary page must never inject HTML.
    if (types.includes('text/plain') || types.includes('text/html')) {
      e.preventDefault();
      let text = '';
      try { text = e.dataTransfer.getData('text/plain') || ''; } catch (_) {}
      if (!text && types.includes('text/html')) {
        try {
          const html = e.dataTransfer.getData('text/html') || '';
          const doc = new DOMParser().parseFromString(html, 'text/html');
          text = (doc.body?.textContent || '');
        } catch (_) {}
      }
      text = text.trim();
      if (!text) return;
      const card = inboxItemToCard({ kind: 'note', body: text }, 0, 0);
      if (!card) return;
      card.x = Math.max(8, Math.round(cx - card.w / 2));
      card.y = Math.max(8, Math.round(cy - card.h / 2));
      mutators.addCard?.(card);
      return;
    }

    // Files (images / videos / audio / anything dragged from Finder). Shares
    // the same routing as the "Add → File" menu picker.
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      e.preventDefault();
      await ingestFiles(files, cx, cy);
      return;
    }

    // Catch-all: a recognized-intent drag (it passed the dragover allow-list)
    // that matched no branch above. Swallow it so the browser never navigates
    // away from the board.
    e.preventDefault();
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
      // MOVE variant (untracked origin): Cmd+Z on this pane must not
      // resurrect cards that now live on the other pane's board.
      mutators.deleteCardsForMove?.(idList);
    };
    document.addEventListener('soleil-card-transferred', onTransferred);
    return () => document.removeEventListener('soleil-card-transferred', onTransferred);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.id, mutators, ydoc, sessionId, userId]);

  // Select + center a card when navigated to from elsewhere (e.g. clicking a
  // card inside a tag/entity collection). App dispatches soleil-flash-card
  // after the board mounts; retry briefly while the board's cards stream in,
  // then select that one card and pan it to the viewport center (current zoom).
  useEffect(() => {
    const onFlash = (e) => {
      const { boardId, cardId } = e.detail || {};
      if (boardId !== board.id || !cardId) return;
      let tries = 0;
      const tick = () => {
        const card = (cardByIdRef.current || {})[cardId];
        if (card) {
          setSelected(new Set([cardId]));
          const r = wrapRef.current?.getBoundingClientRect();
          if (r && r.width > 50) {
            const z = zoomRef.current;
            enableSmoothTransform();
            setPan({
              x: r.width / 2 - (card.x + card.w / 2) * z,
              y: r.height / 2 - (card.y + card.h / 2) * z,
            });
          }
          return;
        }
        if (tries++ < 40) setTimeout(tick, 50); // wait up to ~2s for cards to load
      };
      tick();
    };
    document.addEventListener('soleil-flash-card', onFlash);
    return () => document.removeEventListener('soleil-flash-card', onFlash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.id, enableSmoothTransform]);

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
      // Mirror the mouse sidebar→canvas path: NEST the board under this canvas's
      // board (or under a board card the touch landed on). The shared handler
      // validates cycles/self; the reconcile-drift effect adds the card.
      let targetId = board.id;
      const cardEl = document.elementFromPoint(clientX, clientY)?.closest?.('[data-card-id]');
      const overId = cardEl?.getAttribute('data-card-id');
      const overCard = overId ? (cards || []).find(c => c.id === overId) : null;
      if (overCard?.kind === 'board') targetId = overCard.id;
      else if (overCard?.kind === 'boardlink' && overCard.target) targetId = overCard.target;
      document.dispatchEvent(new CustomEvent('soleil-board-reparent-drop', {
        detail: { childIds: [boardId], targetId, sourceSurface: 'canvas-touch' },
      }));
    };
    document.addEventListener('soleil-touch-board-drop', onTouchBoardDrop);
    return () => document.removeEventListener('soleil-touch-board-drop', onTouchBoardDrop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.id, mutators, cards]);

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
    { id: 'image',  title: 'Add image', label: 'Add image tool', icon: ImageIcon },
    { id: 'text',   title: 'Add note (N)', label: 'Add note tool', icon: NotePencil },
    { id: 'doc',    title: 'Add doc', label: 'Add doc tool', icon: FileText },
    { id: 'board',  title: 'Add cluster', label: 'Add cluster tool', icon: Browsers },
    { id: 'grid',   title: 'Add grid (G)', label: 'Add grid tool', icon: GridNine },
    { id: 'arrow',  title: 'Arrow (A) — click 2 cards, or drag on empty canvas', label: 'Arrow tool', icon: ArrowRight },
    // Draw was moved off the rail deliberately — on a desktop D reaches it
    // instantly and the rail stays uncluttered. A touch device has no keyboard
    // and no right-click, which left the rail "+" submenu as the only way in,
    // for the tool people most want on a tablet. Put it back, on touch only.
    ...(isTouch ? [{ id: 'draw', title: 'Draw (D)', label: 'Free-draw tool', icon: Scribble }] : []),
  ];

  // The rail "+" holds only the SECONDARY creators — anything already on the
  // rail (Note, Image, Doc, Cluster, Grid) is intentionally absent so the two
  // never duplicate. Grouped into Tools / Create / Annotate with icons +
  // hover tips. The Tools group switches into a canvas tool; Create/Annotate
  // reuse the shared buildAddActions runs so behaviour + analytics match the
  // right-click menu exactly. (Script lives only in the empty-state hero.)
  const addFromRegistry = (id) => {
    const pos = resolvePastePos().pos;
    return buildAddActions(pos, 'add_menu').find(a => a.id === id)?.run();
  };
  const addGroups = [
    { title: 'Tools', items: [
      // On touch Draw sits on the rail itself, so listing it here too would put
      // the same tool two taps apart in the same strip.
      ...(isTouch ? [] : [{ id: 'draw', label: 'Draw', icon: Scribble, tip: 'Free-draw (D)', action: () => setSelectedTool('draw') }]),
      { id: 'shape',   label: 'Shape',   icon: Square,   tip: 'Draw a shape',    action: () => setSelectedTool('shape') },
      { id: 'palette', label: 'Palette', icon: Palette,  tip: 'Color palette',   action: () => setSelectedTool('palette') },
    ]},
    { title: 'Create', items: [
      { id: 'file',          label: 'File',           icon: Paperclip,      tip: 'Upload any file',         action: () => addFromRegistry('file') },
      { id: 'addurl',        label: 'Link',           icon: Link,           tip: 'Add a web link',          action: () => addFromRegistry('addurl') },
      ...(scheduleCreationAllowed() ? [
        { id: 'schedule',      label: 'Schedule',       icon: CalendarPh,     tip: 'A calendar you can drop anything into', action: () => addFromRegistry('schedule') },
      ] : []),
      { id: 'linkedcluster', label: 'Linked cluster', icon: ArrowSquareOut, tip: 'Link an existing cluster',action: () => onOpenPicker?.(resolvePastePos().pos) },
    ]},
    { title: 'Annotate', items: [
      { id: 'comment', label: 'Comment', icon: MessageCircle, tip: 'Place a comment — click a card or the canvas', action: () => setAnnotPlacing('comment') },
      { id: 'vote',    label: 'Vote',    icon: ListChecks,    tip: 'Place a vote — click a card or the canvas',    action: () => setAnnotPlacing('vote') },
    ]},
  ];

  const marqueeRect = marquee && {
    left: Math.min(marquee.x0, marquee.x1),
    top: Math.min(marquee.y0, marquee.y1),
    width: Math.abs(marquee.x1 - marquee.x0),
    height: Math.abs(marquee.y1 - marquee.y0),
  };

  const isPanMode = spaceDown || selectedTool === 'pan';
  const strokesInteractive = selectedTool === 'select';

  // Stroke geometry memo: SVG path string + padded bbox per stroke. The
  // strokes array identity changes only on Y.Doc edits (useYBoard snapshot /
  // the public bundle decode), so this survives every pan/zoom/selection
  // render — previously the path string was rebuilt per stroke per render.
  const strokeGeom = useMemo(() => (strokes || []).map((s) => {
    const pts = s.points || [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const x = pts[i][0], y = pts[i][1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const pad = (s.width || DRAW_DEFAULT_WIDTH) / 2 + STROKE_HIT_PADDING;
    // `d` is what gets PAINTED — an open polyline for a constant-width stroke,
    // a closed outline for a pressure/brush one. `hit` is always the plain
    // centreline: a fat transparent stroke along it is both cheaper and a more
    // accurate hit target than the outline polygon would be.
    return {
      minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad,
      d: toPathD(s),
      hit: polylinePathD(pts),
      filled: isFilledPath(s),
    };
  }), [strokes]);

  // World-space cull band for the stroke/arrow SVG layers — same KEEP math
  // as the card cull, but derived from committed pan/zoom STATE (updates at
  // gesture settle; the imperative mid-gesture transform visually masks the
  // ≤140ms lag, same class as card pop-in). Null until the wrap is measured
  // → render everything.
  const svgCullBand = useMemo(() => {
    const { w, h } = wrapWHRef.current;
    if (!w || !h || !zoom) return null;
    const vx = -pan.x / zoom, vy = -pan.y / zoom;
    const vw = w / zoom, vh = h / zoom;
    const KEEP = 1.5;
    return {
      minX: vx - KEEP * vw, maxX: vx + (1 + KEEP) * vw,
      minY: vy - KEEP * vh, maxY: vy + (1 + KEEP) * vh,
    };
  }, [pan.x, pan.y, zoom]);

  // Arrow geometry memo: the obstacle-avoidance bezier (buildArrowPath) plus
  // a padded segment bbox per arrow. Recomputes only when arrows/cards
  // change — previously rebuilt for EVERY arrow on EVERY render.
  const arrowGeom = useMemo(() => {
    // Fold the live drag/resize delta into the obstacle rects too, so a
    // dragged NON-endpoint card deflects the bezier at its live spot rather
    // than its stale committed one (mirrors arrowCtx.liveRect above).
    const dIds = drag?.ids ? new Set(drag.ids) : null;
    const dDx = drag?.dx || 0, dDy = drag?.dy || 0;
    const mr = multiResize?.live || null;
    const rz = resize || null;
    const liveObstacle = (r) => {
      if (mr && mr.has(r.id)) { const lv = mr.get(r.id); return { ...r, x: lv.x, y: lv.y, w: lv.w, h: lv.h }; }
      if (dIds && dIds.has(r.id)) return { ...r, x: r.x + dDx, y: r.y + dDy };
      if (rz && rz.id === r.id) return { ...r, w: Math.max(MIN_W, r.w + (rz.dw || 0)), h: Math.max(MIN_H, r.h + (rz.dh || 0)) };
      return r;
    };
    return (arrows || []).map((a, i) => {
    const att = arrowAttachments[i];
    if (!att?.from || !att?.to) return null;
    // Anchor cards (or group members) stay in the obstacle set with a 1px
    // pad so the bezier can attach at the edge while the body still can't
    // sweep back across its own card.
    const anchorIds = new Set();
    const ef = excludedCardIdsForRef(a.from);
    const et = excludedCardIdsForRef(a.to);
    if (ef) ef.forEach(id => anchorIds.add(id));
    if (et) et.forEach(id => anchorIds.add(id));
    // A manually-bent arrow (a.bend) skips obstacle avoidance entirely — the
    // user's shape wins — so don't pay for the obstacle set either.
    const obstacles = (a.straight || a.bend) ? null
      : arrowObstacleRects.map(r => {
          const rr = liveObstacle(r);
          return anchorIds.has(rr.id) ? { ...rr, pad: 1 } : rr;
        });
    const built = buildArrowPath({ from: att.from, to: att.to, style: { straight: !!a.straight, bend: a.bend }, obstacles });
    if (!built) return null;
    // Cull box = endpoint-segment bbox padded generously for the bezier's
    // obstacle detours, arrowheads, and labels. An arrow crossing the
    // viewport with both endpoints out-of-band still intersects this box.
    // Fold in the bend apex/control too so a hard-bent arrow whose bulge swings
    // far off the chord isn't culled when both endpoints drift off-screen.
    const PAD = 300;
    const xs = [att.from.point.x, att.to.point.x];
    const ys = [att.from.point.y, att.to.point.y];
    if (built.control) { xs.push(built.control.x); ys.push(built.control.y); }
    return {
      ...built,
      minX: Math.min(...xs) - PAD,
      maxX: Math.max(...xs) + PAD,
      minY: Math.min(...ys) - PAD,
      maxY: Math.max(...ys) + PAD,
    };
    });
  }, [arrows, arrowAttachments, arrowObstacleRects, excludedCardIdsForRef, drag, resize, multiResize]);

  // Group outlines + name labels, memoized: the body does O(members) bbox
  // work per group (plus per-member SVG rects in hug mode) and used to
  // re-run on EVERY render (every gesture-settle commit included). Deps are
  // the audited free variables of the body — KEEP IN SYNC with any future
  // edit inside this memo. (The state setters it calls — setArrowFrom /
  // setSelectedTool / setBgCtx — are stable and deliberately omitted;
  // canEdit gates the inline label rename.)
  const groupOutlineEls = useMemo(() => (
    groups.map(g => {
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
                  {(canEdit && selectedTool !== 'arrow') ? (
                    // Double-click renames inline (Enter/blur commit, Escape
                    // cancels — EditableText). Gated off in arrow mode so the
                    // wrapper's arrow-connect pointerdown owns the gesture;
                    // right-click still reaches the wrapper's group menu.
                    <EditableText
                      tag="span"
                      className="group-label-name"
                      value={g.name}
                      onChange={(v) => {
                        const t = (v || '').trim();
                        if (t) mutators.renameGroup?.(g.id, t);
                      }}
                    />
                  ) : g.name}
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
            })
  ), [groups, cardsByGroup, drag, arrowFrom, selectedTool, mutators, arrowOptions, canEdit]);


  // An empty board has nothing to zoom into, so freeze the dotted grid
  // (constant tile size AND position) instead of letting it pulse/slide against
  // the fixed-size empty-state panel — that mismatch read as "broken". Normal
  // `× zoom` scaling + pan-follow resumes the moment the first card lands.
  const boardIsEmpty = cards.length === 0 && !(strokes?.length) && !(arrows?.length);
  const gz = Math.max(8, 80 * (boardIsEmpty ? 1 : zoom));
  const dz = Math.max(2, 20 * (boardIsEmpty ? 1 : zoom));
  // Size-accurate eraser cursor — the red stroke preview only showed the
  // radius after you'd already erased something.
  const eraserCursor = useMemo(() => {
    if (selectedTool !== 'draw' || drawOptions.mode !== 'eraser') return null;
    // The eraser is screen-constant, so the cursor is too — no `* zoom`.
    const d = Math.max(10, Math.min(96, Math.round(drawOptions.eraserWidth || ERASER_DEFAULT_WIDTH)));
    const r = d / 2;
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${d}' height='${d}'><circle cx='${r}' cy='${r}' r='${r - 1}' fill='none' stroke='%23ef4444' stroke-opacity='0.85' stroke-width='1.5'/></svg>`;
    return `url("data:image/svg+xml;utf8,${svg}") ${r} ${r}, crosshair`;
  }, [selectedTool, drawOptions.mode, drawOptions.eraserWidth]);

  const wrapStyle = {
    '--canvas-bg': board.bg_color || undefined,
    // The .is-lifting ring closes over exactly the hold it is describing, so the
    // duration comes from the constant that actually governs the lift rather
    // than a hand-copied number in the stylesheet that could quietly drift.
    '--lift-ms': `${TOUCH_LIFT_MS}ms`,
    ...(eraserCursor ? { cursor: eraserCursor } : null),
    backgroundColor: board.bg_color || undefined,
    backgroundImage: `linear-gradient(to right, var(--grid-line) 1px, transparent 1px), linear-gradient(to bottom, var(--grid-line) 1px, transparent 1px), radial-gradient(circle at center, var(--grid-dot) 1px, transparent 1.5px)`,
    backgroundSize: `${gz}px ${gz}px, ${gz}px ${gz}px, ${dz}px ${dz}px`,
    backgroundPosition: boardIsEmpty
      ? '0 0, 0 0, 0 0'
      : `${pan.x}px ${pan.y}px, ${pan.x}px ${pan.y}px, ${pan.x}px ${pan.y}px`,
  };

  // Viewport-centre canvas point — where the empty-state tiles drop their card
  // (same calc the old single CTA used inline).
  const emptyCenterPos = () => {
    const rect = wrapRef.current?.getBoundingClientRect();
    return rect
      ? clientToCanvas(rect.left + rect.width / 2, rect.top + rect.height / 2)
      : { x: 200, y: 200 };
  };

  return (
    <div className={`canvas-wrap ${dragOver ? 'is-drop-target' : ''} tool-${selectedTool} ${isPanMode ? 'is-pan' : ''} ${eyedropFor ? 'is-eyedrop' : ''} ${annotPlacing ? 'is-annot-place' : ''} ${multiSelectionBounds ? 'is-multi-sel' : ''} ${canEdit ? '' : 'is-readonly'}`}
         data-eyedrop={eyedropFor ? '1' : undefined}
         ref={wrapRef}
         style={wrapStyle}
         onDragOver={handleDragOver}
         onDragLeave={handleDragLeave}
         onDrop={handleDrop}
         onDragStart={(e) => e.preventDefault()}
         onPointerDown={onBackgroundPointerDown}
         onDoubleClick={onBackgroundDoubleClick}
         onContextMenu={onBackgroundContextMenu}>
      {/* Grain texture — sits behind cards on the canvas surface
          only. Cards / popovers / modals all stack above it. */}
      <div className="grain-canvas" aria-hidden="true" />
      {(tagsByBoard?.get(board.id) || []).length > 0 && (
        <div className="board-tags-strip" data-board-id={board.id}>
          {(tagsByBoard.get(board.id) || []).slice(0, 6).map(t => (
            <span key={t.id}
                  role="button"
                  className={`card-tag-chip is-clickable is-${t.source || 'user'}`}
                  style={{ '--tag-c': t.color || '#4f8df8', cursor: 'pointer' }}
                  title={`${t.name}${t.source && t.source !== 'user' ? ` (${t.source}) — right-click to confirm` : ''} — click to see everywhere it's used`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    try { logEvent(EV.TAG_COLLECTION_OPEN, { tag_id: t.id, via: 'board_chip' }); } catch (_) {}
                    document.dispatchEvent(new CustomEvent('soleil-open-tag', { detail: { tagId: t.id } }));
                  }}
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
        getCardById={(id) => cardByIdRef.current[id]}
      />
      {/* Who's-here facepile + hover roster. The authoritative presence list at
          scale (canvas cursors are culled/capped); floats top-right. */}
      <div className="canvas-presence-roster">
        <PresenceStack getAwareness={getAwareness} />
      </div>
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
            {groupOutlineEls}
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

        {/* Multi-selection chrome — a unifying bounding box around every
            selected card so the group reads as ONE selection, plus a single
            bottom-right corner handle to uniformly scale it (Shift to free-
            stretch). Both derive from the same live bounds so they track an
            in-progress resize together. */}
        {canEdit && selectedTool === 'select' && multiSelectionBounds && (() => {
          // While dragging, derive bounds from multiResize.live so the
          // box + handle track the live (in-progress) rect.
          let bounds = multiSelectionBounds;
          if (multiResize?.live) {
            const liveItems = [];
            for (const [, lv] of multiResize.live) liveItems.push(lv);
            const b = boundsOfCards(liveItems);
            if (b) bounds = b;
          } else if (drag?.ids?.length && (drag.dx || drag.dy)) {
            // Dragging the whole selection: shift the frame with the cards so
            // it doesn't stay behind as a ghost at the old spot. Only offset
            // when the drag actually covers every selected card (a plain flat
            // offset is exact because a multi-select drag moves them together).
            let coversAll = true;
            for (const id of effectiveSelectedIds) { if (!drag.ids.includes(id)) { coversAll = false; break; } }
            if (coversAll) bounds = { ...bounds, x: bounds.x + drag.dx, y: bounds.y + drag.dy };
          }
          const items = (cards || []).filter(c => effectiveSelectedIds.has(c.id));
          const startBounds = multiResize?.startBounds || multiSelectionBounds;
          // A little breathing room so the frame sits just outside the cards.
          const PAD = 6;
          return (
            <>
              <div className="sel-bbox"
                   style={{
                     left: bounds.x - PAD,
                     top:  bounds.y - PAD,
                     width:  bounds.w + PAD * 2,
                     height: bounds.h + PAD * 2,
                   }} />
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
            </>
          );
        })()}

        {/* Snap-alignment guidelines — gold hairlines along the matched
            edge / center / dimension while a drag is snapping.
            Rendered off `displayedHints` (a delayed-unmount mirror of
            `snapHints`) so the SVG can fade out for ~140ms after the
            drag releases instead of vanishing instantly. The
            `is-visible` class is keyed off live `snapHints`. */}
        {displayedHints && (displayedHints.xs?.length || displayedHints.ys?.length || displayedHints.spacings?.length || displayedHints.sizes?.length) && (
          <svg className={`snap-guides ${snapHints ? 'is-visible' : ''}`}
               width={SVG_ANCHOR_PX} height={SVG_ANCHOR_PX}
               style={{ position: 'absolute', left: 0, top: 0,
                        pointerEvents: 'none', overflow: 'visible',
                        zIndex: 999997 }}>
            {/* Edge / center alignment + numeric-match guides. Each
                line is anchored by tiny dots at the card-edge endpoints
                so the line reads as a relationship, not a ruler. The
                stroke extends a soft 4px past the dots for breathing
                room. Optional `label` floats just outside the cap. */}
            {(displayedHints.xs || []).slice(0, 1).map((g, i) => {
              const overshoot = 4 / zoom;
              const dotR = 1.5 / zoom;
              return (
                <Fragment key={`gx-${i}`}>
                  <line className="guide-line" x1={g.x} x2={g.x} y1={g.y0 - overshoot} y2={g.y1 + overshoot}
                        stroke="var(--soleil)"
                        strokeOpacity="0.7"
                        strokeWidth={1 / zoom}
                        strokeLinecap="round"
                        vectorEffect="non-scaling-stroke" />
                  <circle className="guide-mark" cx={g.x} cy={g.y0} r={dotR} fill="var(--soleil)" fillOpacity="0.6" />
                  <circle className="guide-mark" cx={g.x} cy={g.y1} r={dotR} fill="var(--soleil)" fillOpacity="0.6" />
                  {g.label && <GuideLabel cx={g.x + 14 / zoom} cy={(g.y0 + g.y1) / 2} text={g.label} zoom={zoom} />}
                </Fragment>
              );
            })}
            {(displayedHints.ys || []).slice(0, 1).map((g, i) => {
              const overshoot = 4 / zoom;
              const dotR = 1.5 / zoom;
              return (
                <Fragment key={`gy-${i}`}>
                  <line className="guide-line" y1={g.y} y2={g.y} x1={g.x0 - overshoot} x2={g.x1 + overshoot}
                        stroke="var(--soleil)"
                        strokeOpacity="0.7"
                        strokeWidth={1 / zoom}
                        strokeLinecap="round"
                        vectorEffect="non-scaling-stroke" />
                  <circle className="guide-mark" cx={g.x0} cy={g.y} r={dotR} fill="var(--soleil)" fillOpacity="0.6" />
                  <circle className="guide-mark" cx={g.x1} cy={g.y} r={dotR} fill="var(--soleil)" fillOpacity="0.6" />
                  {g.label && <GuideLabel cx={(g.x0 + g.x1) / 2} cy={g.y + 13 / zoom} text={g.label} zoom={zoom} />}
                </Fragment>
              );
            })}
            {/* Equal-spacing markers — drawn between paired neighbours
                with tiny end caps + a label so the user sees "I matched
                a 24px gap that already existed". */}
            {(displayedHints.spacings || []).slice(0, 2).map((s, i) => {
              const isX = s.axis === 'x';
              const lcx = isX ? (s.a + s.b) / 2 : s.cross + 13 / zoom;
              const lcy = isX ? s.cross - 9 / zoom : (s.a + s.b) / 2;
              return (
                <Fragment key={`gs-${i}`}>
                  {isX ? (
                    <>
                      <line className="guide-line" x1={s.a} x2={s.b} y1={s.cross} y2={s.cross}
                            stroke="var(--soleil)" strokeOpacity="0.65"
                            strokeWidth={1 / zoom} strokeLinecap="round"
                            strokeDasharray={`${4 / zoom} ${3 / zoom}`}
                            vectorEffect="non-scaling-stroke" />
                      <line className="guide-line" x1={s.a} x2={s.a} y1={s.cross - 5 / zoom} y2={s.cross + 5 / zoom}
                            stroke="var(--soleil)" strokeOpacity="0.65"
                            strokeWidth={1 / zoom} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                      <line className="guide-line" x1={s.b} x2={s.b} y1={s.cross - 5 / zoom} y2={s.cross + 5 / zoom}
                            stroke="var(--soleil)" strokeOpacity="0.65"
                            strokeWidth={1 / zoom} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                    </>
                  ) : (
                    <>
                      <line className="guide-line" x1={s.cross} x2={s.cross} y1={s.a} y2={s.b}
                            stroke="var(--soleil)" strokeOpacity="0.65"
                            strokeWidth={1 / zoom} strokeLinecap="round"
                            strokeDasharray={`${4 / zoom} ${3 / zoom}`}
                            vectorEffect="non-scaling-stroke" />
                      <line className="guide-line" x1={s.cross - 5 / zoom} x2={s.cross + 5 / zoom} y1={s.a} y2={s.a}
                            stroke="var(--soleil)" strokeOpacity="0.65"
                            strokeWidth={1 / zoom} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                      <line className="guide-line" x1={s.cross - 5 / zoom} x2={s.cross + 5 / zoom} y1={s.b} y2={s.b}
                            stroke="var(--soleil)" strokeOpacity="0.65"
                            strokeWidth={1 / zoom} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                    </>
                  )}
                  <GuideLabel cx={lcx} cy={lcy} text={s.gap} zoom={zoom} />
                </Fragment>
              );
            })}
            {/* Equal-SIZE markers (resize) — a matching caliper bar drawn on BOTH
                the resized card and the card it matches, with end ticks + an
                "= N" label, so "these two are the same size" reads at a glance. */}
            {(displayedHints.sizes || []).slice(0, 2).map((sz, i) => {
              const isW = sz.axis === 'w';
              const tick = 4 / zoom;
              return (
                <Fragment key={`gz-${i}`}>
                  {(sz.bars || []).map((bar, bi) => (
                    <Fragment key={`gz-${i}-${bi}`}>
                      {isW ? (
                        <>
                          <line className="guide-line" x1={bar.a} x2={bar.b} y1={bar.cross} y2={bar.cross}
                                stroke="var(--soleil)" strokeOpacity="0.75"
                                strokeWidth={1 / zoom} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                          <line className="guide-line" x1={bar.a} x2={bar.a} y1={bar.cross - tick} y2={bar.cross + tick}
                                stroke="var(--soleil)" strokeOpacity="0.75"
                                strokeWidth={1 / zoom} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                          <line className="guide-line" x1={bar.b} x2={bar.b} y1={bar.cross - tick} y2={bar.cross + tick}
                                stroke="var(--soleil)" strokeOpacity="0.75"
                                strokeWidth={1 / zoom} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                          <GuideLabel cx={(bar.a + bar.b) / 2} cy={bar.cross + 13 / zoom} text={`= ${sz.value}`} zoom={zoom} />
                        </>
                      ) : (
                        <>
                          <line className="guide-line" x1={bar.cross} x2={bar.cross} y1={bar.a} y2={bar.b}
                                stroke="var(--soleil)" strokeOpacity="0.75"
                                strokeWidth={1 / zoom} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                          <line className="guide-line" x1={bar.cross - tick} x2={bar.cross + tick} y1={bar.a} y2={bar.a}
                                stroke="var(--soleil)" strokeOpacity="0.75"
                                strokeWidth={1 / zoom} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                          <line className="guide-line" x1={bar.cross - tick} x2={bar.cross + tick} y1={bar.b} y2={bar.b}
                                stroke="var(--soleil)" strokeOpacity="0.75"
                                strokeWidth={1 / zoom} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                          <GuideLabel cx={bar.cross + 16 / zoom} cy={(bar.a + bar.b) / 2} text={`= ${sz.value}`} zoom={zoom} />
                        </>
                      )}
                    </Fragment>
                  ))}
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
          <svg className="shape-preview" width={SVG_ANCHOR_PX} height={SVG_ANCHOR_PX}
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
        {tweak.showArrows && (arrows?.length || activeFreeArrow || arrowFrom) && (
          <svg className="arrows-layer" width={SVG_ANCHOR_PX} height={SVG_ANCHOR_PX}
               style={{ position: 'absolute', left: 0, top: 0,
                        pointerEvents: 'none',
                        overflow: 'visible' }}>
            {(arrows || []).map((a, i) => {
              // Geometry (incl. the obstacle-avoidance bezier) comes from
              // the arrowGeom memo — recomputed only on data changes.
              const g = arrowGeom[i];
              if (!g) return null;
              const sel = selectedArrows.has(i);
              // Viewport cull on the padded segment bbox; `null` keeps the
              // index coupling. Selected arrows always render (handles).
              if (svgCullBand && !sel &&
                  (g.maxX < svgCullBand.minX || g.minX > svgCullBand.maxX ||
                   g.maxY < svgCullBand.minY || g.minY > svgCullBand.maxY)) return null;
              const att = arrowAttachments[i];
              const { path, fromTangentIn, toTangentIn } = g;
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
              if (a.customDash === 'dashed') dashArray = `${sw * 5} ${sw * 3.5}`;
              else if (a.customDash === 'dotted') dashArray = `${sw * 1} ${sw * 2}`;
              else if (a.dashed) dashArray = `${sw * 5} ${sw * 3.5}`;
              // Bend (curve) dot — sits at the current curve apex. Revealed on
              // hover (CSS `.arrow-g:hover`) and solid when selected, so users
              // discover it without first hunting-and-clicking the thin line.
              // Grab + drag to shape the arc; dragging left/right moves WHERE the
              // bend sits along the arrow (chord-local `u`), perpendicular sets
              // HOW MUCH it bends (`v`). Right-click straightens; dbl-click resets.
              const bendMid = canEdit && strokesInteractive && att?.from?.point && att?.to?.point
                ? g.midPoint : null;
              const BEND_R = 5 / zoom;
              const BEND_HIT_R = 11 / zoom;
              const onBendDown = (ev) => {
                // Left button only. For right/middle, stop the event bubbling to
                // the canvas (which would clear selection) but DON'T preventDefault
                // — so the follow-up contextmenu still fires the arc↔straight toggle.
                if (ev.button !== 0) { ev.stopPropagation(); return; }
                ev.preventDefault();
                ev.stopPropagation();
                // Grabbing a hovered (unselected) arrow's dot selects it too, so
                // the endpoint handles appear and the bend starts in one gesture.
                setSelectedArrows(new Set([i]));
                setSelected(new Set());
                setSelectedStrokes(new Set());
                const s = att.from.point, e = att.to.point;
                const bdx = e.x - s.x, bdy = e.y - s.y;
                const blen = Math.hypot(bdx, bdy) || 1;
                const ux = bdx / blen, uy = bdy / blen;      // chord unit
                const px = -uy, py = ux;                      // perpendicular
                const mx = (s.x + e.x) / 2, my = (s.y + e.y) / 2;
                const round = (n) => Math.round(n * 1e4) / 1e4;
                setBendDragging(true);
                const onMove = (mv) => {
                  const P = clientToCanvas(mv.clientX, mv.clientY);
                  const rx = P.x - mx, ry = P.y - my;
                  const u = Math.max(-0.4, Math.min(0.4, (rx * ux + ry * uy) / blen));
                  const v = (rx * px + ry * py) / blen;
                  mutators.updateArrow?.(i, { bend: { u: round(u), v: round(v) }, straight: false });
                };
                const onUp = () => {
                  setBendDragging(false);
                  window.removeEventListener('pointermove', onMove);
                  window.removeEventListener('pointerup', onUp);
                };
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
              };
              // Right-click the dot → toggle arc ↔ straight line.
              const onBendContext = (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                mutators.updateArrow?.(i, { straight: !a.straight });
              };
              // Double-click the dot → clear the manual bend (back to auto).
              const onBendReset = (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                mutators.updateArrow?.(i, { bend: null });
              };
              return (
                <g key={i} data-arrow-idx={i} className={`arrow-g${sel ? ' is-selected' : ''}`}>
                  {/* Hit target — only path with pointer-events; svg root is none. */}
                  <path d={path} fill="none" stroke="transparent" strokeWidth={Math.max(14, sw + 12)}
                        pointerEvents={strokesInteractive ? 'stroke' : 'none'}
                        style={{ cursor: strokesInteractive ? 'move' : 'default' }}
                        onPointerDown={strokesInteractive ? (ev) => onArrowBodyPointerDown(ev, i) : undefined}
                        onContextMenu={strokesInteractive ? (ev) => onArrowContextMenu(ev, i) : undefined} />
                  {sel && <path d={path} fill="none" stroke="rgba(245,158,11,.18)"
                                strokeWidth={sw + 8} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />}
                  {sel && <path d={path} fill="none" stroke="rgba(245,158,11,.55)"
                                strokeWidth={sw + 4} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />}
                  <path data-arrow-line d={path} fill="none" stroke={stroke} strokeWidth={sw}
                        strokeDasharray={dashArray}
                        strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />
                  {headForward && <polygon points={headForward} fill={stroke} pointerEvents="none" />}
                  {headReverse && <polygon points={headReverse} fill={stroke} pointerEvents="none" />}
                  {a.label && (() => {
                    // Orientation: follow the line, but never let the text end
                    // up upside-down. <textPath> (what this used to be) hands
                    // orientation to the browser's per-glyph tangent, so every
                    // right-to-left arrow read backwards and curved arrows
                    // arced their text. Rotate ONCE, by the tangent at the
                    // midpoint, clamped into (-90°, 90°].
                    const deg = uprightLabelAngle(g.midTangent);
                    // 1/zoom keeps the font, the halo and the off-line offset
                    // at constant SCREEN size — the label lives inside the
                    // canvas's scale(zoom) transform, so without this it was
                    // illegible zoomed out and enormous zoomed in. Same idiom
                    // as BEND_R / the bend dot's strokeWidth above.
                    const inv = 1 / zoom;
                    return (
                      <text className="arrow-label-text" pointerEvents="none"
                            textAnchor="middle" dominantBaseline="middle"
                            // dy AFTER the rotate → the offset stays
                            // perpendicular to the line, so the label sits
                            // beside the stroke rather than on top of it.
                            dy="-7"
                            transform={`translate(${g.midPoint.x} ${g.midPoint.y}) rotate(${deg}) scale(${inv})`}>
                        {a.label}
                      </text>
                    );
                  })()}
                  {bendMid && (
                    <Fragment>
                      {/* Transparent grab target — inert until the arrow is
                          hovered/selected (CSS gates pointer-events) so it
                          doesn't steal clicks meant for the line body. */}
                      <circle data-arrow-bend-dot className="arrow-bend-hit"
                              cx={bendMid.x} cy={bendMid.y} r={BEND_HIT_R}
                              fill="transparent" style={{ cursor: 'grab' }}
                              onPointerDown={onBendDown}
                              onContextMenu={onBendContext}
                              onDoubleClick={onBendReset}>
                        <title>Drag to bend · right-click to straighten · double-click to reset</title>
                      </circle>
                      {/* Visible dot — faded on hover, solid when selected (CSS). */}
                      <circle className="arrow-bend-vis" cx={bendMid.x} cy={bendMid.y} r={BEND_R}
                              fill="rgba(245,158,11,.95)" stroke="#fff" strokeWidth={1.5 / zoom}
                              pointerEvents="none" />
                    </Fragment>
                  )}
                </g>
              );
            })}
            {activeFreeArrow && (() => {
              const s = activeFreeArrow.from, e = activeFreeArrow.to;
              const path = `M${s.x},${s.y} L${e.x},${e.y}`;
              return <path d={path} stroke="rgba(245,158,11,.8)" strokeWidth="1.5" strokeDasharray="5 3.5" fill="none" strokeLinecap="round" pointerEvents="none" />;
            })()}
            {/* Live rubber-band from the chosen source card to the cursor, so the
                connection is visible before the second click lands. Starts at the
                source's edge facing the cursor; hidden while the cursor is over
                the source card itself. */}
            {arrowFrom && arrowCursor && arrowFromRect && (() => {
              const r = arrowFromRect;
              if (arrowCursor.x > r.x && arrowCursor.x < r.x + r.w &&
                  arrowCursor.y > r.y && arrowCursor.y < r.y + r.h) return null;
              const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
              const dx = arrowCursor.x - cx, dy = arrowCursor.y - cy;
              let sx = cx, sy = cy;
              if (dx || dy) {
                const k = Math.min(
                  dx !== 0 ? (r.w / 2) / Math.abs(dx) : Infinity,
                  dy !== 0 ? (r.h / 2) / Math.abs(dy) : Infinity);
                sx = cx + dx * k; sy = cy + dy * k;
              }
              const path = `M${sx},${sy} L${arrowCursor.x},${arrowCursor.y}`;
              return <path d={path} stroke="rgba(245,158,11,.7)" strokeWidth="1.5" strokeDasharray="5 3.5" fill="none" strokeLinecap="round" pointerEvents="none" />;
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
              // Note: the bend (curve) dot now lives in the per-arrow <g> above
              // so it can reveal on hover; only the endpoint handles are here.
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
        <svg className="strokes-layer" width={SVG_ANCHOR_PX} height={SVG_ANCHOR_PX}
             style={{ position: 'absolute', left: 0, top: 0,
                      pointerEvents: 'none',
                      overflow: 'visible' }}>
          {(strokes || []).map((s, i) => {
            const sel = selectedStrokes.has(i);
            const g = strokeGeom[i];
            // Viewport cull: off-band strokes render nothing. `null` keeps
            // the array-index coupling (key / data-stroke-idx /
            // selectedStrokes / onStrokeClick all use i). Selected strokes
            // always render so the selection ring survives panning away.
            // Erase + marquee operate on the strokes ARRAY, not the DOM.
            if (svgCullBand && g && !sel &&
                (g.maxX < svgCullBand.minX || g.minX > svgCullBand.maxX ||
                 g.maxY < svgCullBand.minY || g.minY > svgCullBand.maxY)) return null;
            const w = s.width || DRAW_DEFAULT_WIDTH;
            const path = g ? g.d : toPathD(s);
            const hitPath = g ? g.hit : polylinePathD(s.points);
            const hitW = Math.max(w + STROKE_HIT_PADDING, 14);
            return (
              <g key={i} data-stroke-idx={i}>
                <path d={hitPath} fill="none" stroke="transparent" strokeWidth={hitW}
                      pointerEvents={strokesInteractive ? 'stroke' : 'none'}
                      style={{ cursor: strokesInteractive ? 'pointer' : 'default' }}
                      onPointerDown={strokesInteractive ? (ev) => onStrokeClick(ev, i) : undefined} />
                {sel && <path d={hitPath} fill="none" stroke="rgba(245,158,11,.55)"
                              strokeWidth={w + 6} strokeLinecap="round" strokeLinejoin="round"
                              pointerEvents="none" />}
                <StrokePath data-stroke-line s={s} d={path} pointerEvents="none" />
              </g>
            );
          })}
          {/* The lasso is a closed dashed loop with a faint wash, not a stroke —
              it is a selection gesture and must not read as ink you just drew. */}
          {activeStroke?.lasso && activeStroke.points.length > 1 && (
            <path d={`${polylinePathD(activeStroke.points)} Z`}
                  fill="rgba(245,158,11,.10)"
                  stroke="rgba(245,158,11,.9)"
                  strokeWidth={1.5 / zoom}
                  strokeDasharray={`${6 / zoom} ${4 / zoom}`}
                  strokeLinejoin="round"
                  pointerEvents="none" />
          )}
          {activeStroke && !activeStroke.lasso && <StrokePath s={activeStroke} pointerEvents="none" />}
          {/* Live eraser ring at the contact point. The size-accurate eraser
              CURSOR above it is a CSS cursor, which does not exist on a touch
              screen — a finger erasing had no indication of its radius at all,
              so you found out what you'd hit only after lifting. Drawn in the
              canvas transform, so it tracks zoom for free. */}
          {activeStroke?.eraser && activeStroke.points.length > 0 && (() => {
            const [ex, ey] = activeStroke.points[activeStroke.points.length - 1];
            return (
              <circle cx={ex} cy={ey} r={Math.max(activeStroke.width / 2, 1)}
                      fill="none" stroke="#ef4444" strokeOpacity="0.9"
                      strokeWidth={1.5 / zoom} pointerEvents="none" />
            );
          })()}
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

        {/* Vote cards — same canvas-transform layer + the SAME visibility
            toggle as comments (layerVisible={commentsVisible}), so they
            hide when you hide comments. */}
        <CanvasVoteLayer
          voteCards={voteCards}
          userId={userId}
          currentUser={currentUser}
          zoom={zoom}
          resolveCardBBox={resolveCardBBox}
          resolveGroupBBox={resolveGroupBBox}
          onLocallyRemoved={removeVoteLocally}
          layerVisible={commentsVisible}
        />

      </div>

      {/* Inline arrow-editor popover — shown when exactly one arrow is
          selected. Lives in screen-space (position:fixed) so it doesn't
          scale with the canvas transform. Lines (arrows with
          head:'none' created via the Shape tool) use the bottom
          ToolOptionsBar instead; suppress this popover for them so
          the user doesn't see two editors with different controls. */}
      {canEdit && selectedArrows.size === 1 && !bendDragging && (() => {
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
        // Match the arrows-layer geometry: a manual bend skips obstacle
        // avoidance, so the popover anchors on the same curve the user sees.
        const obstacles = (a.straight || a.bend) ? null
          : arrowObstacleRects.filter(r => !excludeSet.has(r.id));
        const built = buildArrowPath({ from: att.from, to: att.to, style: { straight: !!a.straight, bend: a.bend }, obstacles });
        if (!built) return null;
        return (
          <ArrowPopover
            arrow={a}
            arrowIndex={idx}
            midPoint={built.midPoint}
            canvasToViewport={canvasToViewport}
            onChange={(patch) => mutators.updateArrow?.(idx, patch)}
            onDelete={() => {
              deleteSingleArrow(idx);
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


      {/* The rail is `overflow-y: auto` on a phone (styles.css .cnv-tools) but
          lives inside `.canvas-wrap { touch-action: none }`, so the browser
          will not finger-scroll it. Drive it ourselves. Tapping a tool still
          works — the gesture only engages past the movement threshold. */}
      <div className={`cnv-tools ${canEdit ? '' : 'is-readonly'}`} data-tour="rail"
           onPointerDown={(e) => { startTouchScrollGesture(e); }}>
        <div className="cnv-add-wrap">
          <div
            className={`cnv-tool ${addMenuOpen ? 'active' : ''}`}
            data-tip="Add"
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
              {addGroups.map(group => (
                <Fragment key={group.title}>
                  <div className="cnv-add-group-head" aria-hidden="true">{group.title}</div>
                  {group.items.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      role="menuitem"
                      // Explicit label so the accessible name stays exactly the
                      // item label. Without it, Chromium folds the data-tip
                      // ::after tooltip content into the name ("Shape Draw a
                      // shape"), which also breaks getByRole('menuitem') lookups.
                      aria-label={item.label}
                      data-tip={item.tip}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => {
                        setAddMenuOpen(false);
                        item.action();
                      }}
                    >
                      <span className="cnv-add-ico" aria-hidden="true"><Icon as={item.icon} size={16} /></span>
                      <span className="cnv-add-lbl">{item.label}</span>
                    </button>
                  ))}
                </Fragment>
              ))}
            </div>
          )}
        </div>
        <div className="cnv-tool-sep" />
        {tools.map(t => {
          // The grid tool opens the Templates panel rather than arming the
          // placer straight away: choosing a shape IS the act of making a grid,
          // so the picker is the tool. This keeps the rail at eight buttons —
          // it already overflows on landscape phones and scrolls by a pointer
          // gesture. G still places the default instantly for anyone who knows
          // it, and the right-click Add ▸ Grid is untouched.
          const isTpl = t.id === 'grid';
          const active = isTpl ? (tplPanelOpen || selectedTool === 'grid') : selectedTool === t.id;
          // The grid tool ARMS the placer and opens the picker at the same
          // time. Opening a panel used to swallow the click that follows it,
          // which broke the oldest muscle memory in the app: pick the tool, tap
          // the canvas, get a grid. The panel is a refinement — choose a shape
          // before you click and that shape is what lands — not a gate.
          const activate = isTpl
            ? () => { const next = !tplPanelOpen; setTplPanelOpen(next); setSelectedTool(next ? 'grid' : 'select'); }
            : () => setSelectedTool(t.id);
          const btn = (
            <div className={`cnv-tool ${active ? 'active' : ''}`}
                 data-tip={t.title}
                 data-tour={t.id === 'board' ? 'cluster-tool' : t.id === 'image' ? 'image-tool' : undefined}
                 role="button"
                 tabIndex={0}
                 aria-label={t.label}
                 aria-pressed={active}
                 aria-expanded={isTpl ? tplPanelOpen : undefined}
                 onKeyDown={(e) => {
                   // Escape is deliberately NOT handled here. The window-level
                   // ladder owns it, and a local handler double-steps: keydown
                   // is a discrete event, so React flushes this setState
                   // synchronously, the ladder's effect re-registers with the
                   // new state, and the same press then falls through to the
                   // next rung — closing the panel AND disarming the tool.
                   if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
                 }}
                 onPointerDown={(e) => { e.stopPropagation(); activate(); }}>
              <Icon as={t.icon} size={20} />
            </div>
          );
          if (!isTpl) return <Fragment key={t.id}>{btn}</Fragment>;
          return (
            <div className="cnv-tpl-wrap" key={t.id} ref={tplAnchorRef}>
              {btn}
              <GridTemplatePanel
                open={tplPanelOpen}
                onClose={() => setTplPanelOpen(false)}
                sections={templateSections}
                onPick={pickTemplate}
                applyTargetId={templateTargetId}
                mobileShell={mobileShell}
                anchorRef={tplAnchorRef}
                // Saving and row actions need a backend. Under ?local=1 (and
                // signed out) they are simply absent rather than present and
                // broken — the panel keeps working as the built-in picker.
                rowActions={templatesEnabled ? templateRowActions : null}
                onSaveCurrent={templatesEnabled ? openSaveTemplate : null}
              />
            </div>
          );
        })}
        <div className="cnv-tool-sep" />
        <div className="cnv-tool"
             data-tip="Keyboard shortcuts (?)"
             role="button"
             tabIndex={0}
             aria-label="Keyboard shortcuts"
             onKeyDown={(e) => {
               if (e.key === 'Enter' || e.key === ' ') {
                 e.preventDefault();
                 document.dispatchEvent(new CustomEvent('soleil-open-help'));
               }
             }}
             onPointerDown={(e) => {
               e.stopPropagation();
               document.dispatchEvent(new CustomEvent('soleil-open-help'));
             }}>
          <Icon as={Question} size={20} />
        </div>
      </div>

      <SaveTemplateDialog
        open={!!saveTplLayout}
        canPublish={templatesEnabled}
        layout={saveTplLayout?.layout || null}
        size={saveTplLayout?.size || null}
        onCancel={() => setSaveTplLayout(null)}
        onSave={commitSaveTemplate}
      />

      {/* "Grid template added" → put it down. pickTemplate is reused verbatim, so
          this button behaves exactly like picking the same row out of the panel:
          with a grid selected it re-cuts that grid (done — clear the prompt), and
          with nothing selected it arms the placer and the prompt switches to
          "click anywhere". One code path, so the shortcut can never drift from
          the long way round. */}
      {justAddedTemplate && (
        <TemplateAddedPrompt
          template={justAddedTemplate}
          armed={selectedTool === 'grid' && !!pendingGridLayout}
          onPlace={() => {
            const reCut = !!templateTargetIdRef.current;
            pickTemplate(justAddedTemplate);
            if (reCut) onDismissJustAdded?.();
          }}
          onDismiss={() => {
            // Disarm too, or dismissing the prompt leaves the canvas silently
            // holding a template the next click would place.
            if (selectedTool === 'grid') setSelectedTool('select');
            onDismissJustAdded?.();
          }}
        />
      )}

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
      {(selectedTool === 'board' || selectedTool === 'grid' || selectedTool === 'image' || selectedTool === 'text' || selectedTool === 'doc' || selectedTool === 'shape' || selectedTool === 'palette') && (
        <div className="cnv-hint">
          Click on the canvas to place a {selectedTool === 'text' ? 'note' : selectedTool === 'board' ? 'cluster' : selectedTool}
          <button className="cnv-hint-x" onClick={() => setSelectedTool('select')}>esc</button>
        </div>
      )}
      {annotPlacing && (
        <div className="cnv-hint">
          Click a card to attach, or empty space to drop a {annotPlacing}
          <button className="cnv-hint-x" onClick={() => setAnnotPlacing(null)}>esc</button>
        </div>
      )}
      {(selected.size + selectedStrokes.size + selectedArrows.size) > 1 && (
        <div className="cnv-selcount">{selected.size + selectedStrokes.size + selectedArrows.size} selected</div>
      )}
      {/* Empty-board starter: a contained, frosted panel of card-type tiles so
          the first "add a card" gesture lets you CHOOSE what to drop (image /
          note / upload / doc) instead of force-dropping a note. Each tile routes
          through buildAddActions(pos,'empty_cta') so it keeps the real handler
          AND the noteCreateIntent('empty_cta') activation analytics. The panel
          reading as floating chrome is also what lets the now-static empty grid
          behind it look intentional. CSS fade-in is delayed ~500ms so board
          switches / first-run seeding never flash it. The friction-stuck signal
          adds a soft emphasis ring (is-escalated) + a screen-reader announce. */}
      {canEdit && selectedTool === 'select' && (boardIsEmpty || firstCardPrompt) && (() => {
        // IMAGE-FIRST, but show the RANGE: adding an image drives activation (14/14
        // of activated users used an image), so Image stays the hero — while the
        // rotating headline + the breadth line + the Script/Board/Note/Doc/Any-file
        // row signal that this is also where you write scripts, organize, and drop
        // any asset. ("Any file" is a deliberate upsell tease: an image uploads free,
        // a generic file hits the existing paid-upgrade prompt in ingestFiles.)
        const runTile = (id) => { markViewSettled(); return buildAddActions(emptyCenterPos(), 'empty_cta').find((a) => a.id === id)?.run(); };
        return (
        <div className={`cnv-empty-tiles${frictionStuck ? ' is-escalated' : ''}${firstCardPrompt ? ' is-prompt' : ''}`}
             aria-label="Add your first images"
             role={frictionStuck ? 'status' : 'group'}>
          <div className="cnv-empty-tiles-head">Start your <RotatingWord /></div>
          <div className="cnv-empty-tiles-breadth">Moodboards, scripts, shot lists — every asset, one canvas.</div>
          <button type="button" className="cnv-empty-tile cnv-empty-tile-hero"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => runTile('image')}>
            <span className="cnv-empty-tile-ico"><Icon as={ImageIcon} size={30} weight="regular" /></span>
            <span className="cnv-empty-tile-hero-copy">
              {/* Plural, because the picker is multi-select and saying so is the
                  point: a board is worth returning to at roughly six cards, and
                  one gesture that selects ten gets there where ten gestures
                  mostly don't happen. */}
              <span className="cnv-empty-tile-lbl">Add images</span>
              <span className="cnv-empty-tile-hero-hint">Pick several at once, drag them in, or paste</span>
            </span>
          </button>
          <div className="cnv-empty-tiles-grid">
            {EMPTY_TILES.map((t) => (
              <button key={t.id} type="button" className="cnv-empty-tile"
                      data-tour={t.id === 'board' ? 'empty-cluster-tile' : undefined}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => runTile(t.id)}>
                <span className="cnv-empty-tile-ico"><Icon as={t.icon} size={24} weight="regular" /></span>
                <span className="cnv-empty-tile-lbl">{t.label}</span>
              </button>
            ))}
          </div>
          <span className="cnv-empty-tiles-sub cnv-empty-tiles-sub-fine">drag an image straight in&ensp;·&ensp;paste&ensp;·&ensp;or double-click to add</span>
          <span className="cnv-empty-tiles-sub cnv-empty-tiles-sub-coarse">drag an image in&ensp;·&ensp;or long-press the canvas to add</span>
        </div>
        );
      })()}

      {/* Depth dock — the empty panel's offer, carried past the first card.
          Deliberately a dock and not a second panel: the centred box would sit
          on top of the cards the user has just made. Tagged `depth_dock` rather
          than `empty_cta` so the two surfaces stay separable in the funnel. */}
      {depthDockVisible && selectedTool === 'select' && (
        <div className="cnv-depth-dock" role="group" aria-label="Add more images">
          <button type="button" className="cnv-depth-dock-add"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    markViewSettled();
                    buildAddActions(emptyCenterPos(), 'depth_dock').find((a) => a.id === 'image')?.run();
                  }}>
            <Icon as={ImageIcon} size={18} weight="regular" />
            <span className="cnv-depth-dock-lbl">Add images</span>
            <span className="cnv-depth-dock-hint">pick several at once</span>
          </button>
          <button type="button" className="cnv-depth-dock-x"
                  aria-label="Dismiss"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={dismissDepthDock}>
            <Icon as={X} size={14} weight="regular" />
          </button>
        </div>
      )}

      {/* Mix prompt — the same dock, asking a board of pictures for words.
          Shares the dock's chrome deliberately: it is the same quiet corner
          affordance making the next ask, not a new surface competing with it.
          Resting control, so neutral ink — gold is reserved for active,
          selection and focus states. */}
      {mixPromptVisible && selectedTool === 'select' && (
        <div className="cnv-depth-dock" role="group" aria-label="Add a note">
          <button type="button" className="cnv-depth-dock-add"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    markViewSettled();
                    try {
                      logEvent(EV.MIX_PROMPT_ENGAGED, {
                        board_id: board?.id || null,
                        images: mixImageCount,
                      });
                    } catch (_) {}
                    buildAddActions(emptyCenterPos(), 'mix_prompt').find((a) => a.id === 'note')?.run();
                  }}>
            <Icon as={NotePencil} size={18} weight="regular" />
            <span className="cnv-depth-dock-lbl">Add a note</span>
            <span className="cnv-depth-dock-hint">say what this is</span>
          </button>
          <button type="button" className="cnv-depth-dock-x"
                  aria-label="Dismiss"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={dismissMixPrompt}>
            <Icon as={X} size={14} weight="regular" />
          </button>
        </div>
      )}

      {/* Cursor add-card menu — opened by double-clicking bare canvas. A small,
          icon-led chooser (Image / Note / Upload / Doc) so double-click means
          "add something here" instead of always dropping a note. Reuses
          buildAddActions (handlers + analytics); dismissed via useDismissOnOutside. */}
      {quickAdd.open && (() => {
        const W = 196;
        // Same order + labels as the empty-state tiles; pull icon + run from
        // buildAddActions so behavior + analytics stay identical.
        const byId = Object.fromEntries(buildAddActions(quickAdd.pos, 'dblclick').map((a) => [a.id, a]));
        const items = [
          { id: 'image', label: 'Image', icon: ImageIcon },
          { id: 'note', label: 'Note', icon: NotePencil },
          { id: 'file', label: 'Upload', icon: Upload },
          { id: 'doc', label: 'Doc', icon: FileText },
        ].map((t) => ({ ...byId[t.id], ...t })).filter((t) => t.run);
        const hEst = items.length * 40 + 12;
        const left = Math.min(quickAdd.x, window.innerWidth - W - 8);
        const top = Math.min(quickAdd.y, window.innerHeight - hEst - 8);
        return (
          <div ref={quickAddRef} className="cnv-quick-add" role="menu"
               style={{ left: Math.max(8, left), top: Math.max(8, top), width: W }}>
            {items.map((t) => (
              <button key={t.id} type="button" className="cnv-quick-add-item" role="menuitem"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => { markViewSettled(); closeQuickAdd(); t.run(); }}>
                <span className="cnv-quick-add-ico"><Icon as={t.icon} size={18} weight="regular" /></span>
                <span className="cnv-quick-add-lbl">{t.label}</span>
              </button>
            ))}
          </div>
        );
      })()}

      {/* welcome_showcase arm B: while the seeded brand demo is still present,
          show the "try it yourself" banner. One click clears exactly the
          showcase cards (one undoable step + Undo toast) so the user takes over
          the canvas; the onb-drag note + Ideas board survive for a clean handoff,
          and the cards vanishing self-hides the banner (no extra flag). */}
      {showcaseArm === 'B' && canEdit && cards.some(isShowcaseCard) && (
        <ShowcaseBanner boardId={board?.id} onClear={async () => {
          const ids = cards.filter(isShowcaseCard).map((c) => c.id);
          if (!ids.length) return;
          const deleted = await mutators.deleteCards?.(ids); // one undo step (boundary default)
          undoToast(feedback, {
            message: 'Demo cleared — your canvas is yours',
            undoManager: mutators.undoManager,
            stackItem: deleted?.stackItem || null,
            onUndo: () => mutators.undo?.(),
          });
          try { logEvent(EV.ONBOARDING_SHOWCASE_CLEARED, { n: ids.length, board_id: board?.id }); } catch (_) {}
        }} />
      )}

      <div className="cnv-zoom">
        <button onClick={() => { enableSmoothTransform(); markZooming(); setZoom(z => Math.max(ZOOM_MIN, z / 1.25)); }}>−</button>
        <input
          className="cnv-zoom-slider"
          type="range"
          min="0" max="1000" step="1"
          // log scale: 0..1000 → ZOOM_MIN..ZOOM_MAX
          value={Math.round(1000 * Math.log(zoom / ZOOM_MIN) / Math.log(ZOOM_MAX / ZOOM_MIN))}
          onInput={(e) => {
            markZooming();
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
              title="Click: 100% · Double-click: Full Cluster"
              onClick={() => { enableSmoothTransform(); markZooming(); setZoom(1); setPan({ x: 40, y: 60 }); }}
              onDoubleClick={() => { enableSmoothTransform(); markZooming(); fitToContent(); }}>
          {Math.round(zoom * 100)}%
        </span>
        <button onClick={() => { enableSmoothTransform(); markZooming(); setZoom(z => Math.min(ZOOM_MAX, z * 1.25)); }}>+</button>
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

      {/* Custom thumbnail for a board card: hidden picker + crop/reposition modal
          (opened from the card's right-click "Upload custom thumbnail…"). */}
      <input ref={thumbInputRef} type="file" accept="image/*"
             style={{ display: 'none' }} onChange={onThumbFileChange} />
      {thumbCropFor && (
        <ThumbnailCropModal
          file={thumbCropFor.file}
          saving={thumbSaving}
          onCancel={() => { if (!thumbSaving) setThumbCropFor(null); }}
          onSave={saveThumbCrop}
        />
      )}

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

      {/* Mobile-shell bottom-nav "+" → full add sheet. The action set mirrors the
          desktop right-click Add menu (shared via buildAddActions). Close the
          sheet before running so card auto-focus/editors aren't fighting the
          sheet teardown. Gated on the whole shell (phone + touch tablet /
          landscape phone) so the puck never dead-ends. */}
      {mobileShell && mobileAdd && (
        <Sheet open onClose={() => setMobileAdd(null)} title="Add to cluster" snap="half">
          <div className="mobile-add-grid">
            {/* Photos leads on the phone sheet — camera-roll multi-select is the
                mobile superpower and images are the activation signal. */}
            <button
              type="button"
              className="mobile-add-tile"
              onClick={() => { setMobileAdd(null); noteCreateIntent('mobile_nav'); pickPhotosAt(mobileAdd.pos, 'add_sheet'); }}
            >
              <span className="mobile-add-ico" aria-hidden="true"><Icon as={ImageIcon} size={24} /></span>
              <span className="mobile-add-lbl">Photos</span>
            </button>
            {buildAddActions(mobileAdd.pos, 'mobile_nav').filter(a => a.id !== 'script').map(a => (
              <button
                key={a.id}
                type="button"
                className="mobile-add-tile"
                onClick={() => { setMobileAdd(null); a.run(); }}
              >
                <span className="mobile-add-ico" aria-hidden="true"><Icon as={a.icon} size={24} /></span>
                <span className="mobile-add-lbl">{a.label}</span>
              </button>
            ))}
          </div>
        </Sheet>
      )}

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
        editingCellText={!!styleCell?.editing}
        selectedCellStyle={!!styleCell && !styleCell.editing}
        cellKind={styleCellKind}
        cellPinned={editingCellPinned}
        onCellStyle={styleCell ? (patch) => {
          // Scope is "This box" (from an explicit click OR the grid's sticky pref) but
          // the box isn't actually pinned yet → freeze the FULL effective style first,
          // so "This box" means the same thing on both paths: fully isolated from later
          // shared changes, not just the one property you happened to edit.
          if (editingCellPinned && !recIsPinned(gridCellRecord(styleCell.gridId, styleCell.cellId))) {
            mutators.pinCellStyle?.(styleCell.gridId, styleCell.cellId);
          }
          mutators.setGridTextStyle?.(styleCell.gridId, styleCell.cellId, patch, { pinned: editingCellPinned });
        } : null}
        onCellScope={styleCell ? (mode) => {
          // Explicit segment click. Remember the choice for this grid, and pin/unpin
          // the box to match: "This box" freezes the current look so later shared
          // changes skip it; "All boxes" rejoins the grid's shared style.
          cellScopePrefRef.current.set(styleCell.gridId, mode);
          const pinned = recIsPinned(gridCellRecord(styleCell.gridId, styleCell.cellId));
          if (mode === 'box') { if (!pinned) mutators.pinCellStyle?.(styleCell.gridId, styleCell.cellId); setEditingCellPinned(true); }
          else { if (pinned) mutators.unpinCellStyle?.(styleCell.gridId, styleCell.cellId); setEditingCellPinned(false); }
        } : null}
        editingCellStyle={(() => {
          // Effective style of the targeted cell (family + pinned override) — seeds
          // the Box-background picker AND, when the box is only selected (not being
          // edited), the Font/Size/Align display state. Seed-only: a pinned nested
          // write doesn't bust the cards snapshot, so this may lag one pick; harmless.
          if (!styleCell) return null;
          const gcard = cardById[styleCell.gridId];
          if (!gcard) return null;
          const fam = (gcard.templateId ? gridTemplates?.[gcard.templateId]?.textStyle : gcard.textStyle) || {};
          const rec = gridCellRecord(styleCell.gridId, styleCell.cellId);
          return { ...fam, ...((rec && rec.style) || {}) };
        })()}
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
          onToggle={(t) => {
            // TAG_MANUAL_APPLY has been in the event catalog since the tags
            // rework with no emission site anywhere, so hand-tagging — the whole
            // point of this picker — recorded nothing. This is its home.
            try { logEvent(EV.TAG_MANUAL_APPLY, { target_kind: 'card', via: 'picker', tag_id: t?.id }); } catch (_) {}
            toggleTagOnCard(tagPicker.cardId, t);
          }}
          onCreate={(name) => {
            try { logEvent(EV.TAG_MANUAL_APPLY, { target_kind: 'card', via: 'picker_create' }); } catch (_) {}
            createAndApplyTag(tagPicker.cardId, name);
          }}
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
                  title="Removes this tag and won't auto-apply it here again."
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
                      // This was the app's most casual irreversible click:
                      // no confirm, hard delete, PLUS a permanent "never
                      // suggest again" row. The undo re-applies AND lifts
                      // the suppression.
                      undoToast(feedback, {
                        message: `Removed “${tag.name || 'tag'}”`,
                        onUndo: async () => {
                          try {
                            if (kind === 'card') {
                              await tagCard({ workspaceId, boardId: board.id, cardId: targetId, tagId: tag.id });
                            } else if (kind === 'board') {
                              await tagBoard({ workspaceId, boardId: targetId, tagId: tag.id });
                            }
                            await undismissAutotagSuggestion({ workspaceId, targetKind: kind, targetId, tagId: tag.id });
                            refreshTags?.();
                          } catch (err) {
                            feedback.toast({ type: 'error', message: 'Restore failed: ' + (err.message || err) });
                          }
                        },
                      });
                    } catch (err) {
                      feedback.toast({ type: 'error', message: 'Remove failed: ' + (err.message || err) });
                    }
                  }}>
            Remove tag
          </button>
        </div>
      )}
      {lightbox && (
        <ImageLightbox src={lightbox.src} title={lightbox.title} alt={lightbox.alt} adjust={lightbox.adjust} cardId={lightbox.cardId}
                       onClose={() => setLightbox(null)} />
      )}
      {/* Per-card photo-adjustment SVG filter defs, referenced by id. Keyed off
          adjusted cards so the modal/lightbox resolve even when a card is culled. */}
      <ImageAdjustFilters cards={cards} />
      {imageEdit && (() => {
        const card = cards.find(x => x.id === imageEdit.cardId);
        if (!card || card.kind !== 'image') return null;
        return (
          <ImageEditPopover
            anchorRect={imageEdit.anchorRect}
            adjust={card.adjust}
            onChange={(next) => mutators.updateCard?.(card.id, { adjust: next })}
            onReset={() => mutators.updateCard?.(card.id, { adjust: null })}
            onExpand={() => { setImageEditFull({ cardId: card.id }); setImageEdit(null); }}
            onCompareStart={() => setCompareCardId(card.id)}
            onCompareEnd={() => setCompareCardId(null)}
            onClose={() => { setCompareCardId(null); setImageEdit(null); }} />
        );
      })()}
      {imageEditFull && (() => {
        const card = cards.find(x => x.id === imageEditFull.cardId);
        if (!card || card.kind !== 'image') return null;
        return (
          <ImageEditModal
            src={card.src} title={card.title || card.label || ''} adjust={card.adjust} cardId={card.id}
            onChange={(next) => mutators.updateCard?.(card.id, { adjust: next })}
            onReset={() => mutators.updateCard?.(card.id, { adjust: null })}
            onDownload={() => downloadImage({ src: card.src, title: card.title || card.label || '', adjust: card.adjust })}
            onClose={() => setImageEditFull(null)} />
        );
      })()}
      {pdfViewer && (
        <Suspense fallback={<div className="pdfv pdfv-loading"><Spinner size={28} tone="on-dark" label="Loading PDF" /></div>}>
          <PdfViewer src={pdfViewer.src} name={pdfViewer.name} onClose={() => setPdfViewer(null)} />
        </Suspense>
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
          // Layers only ride along when the sketch actually used more than one.
          // A single-layer sketch writes the same card shape it always did, and
          // readCardStrokes() presents either form identically to every reader.
          const layers = Array.isArray(payload) ? null : (payload?.layers || null);
          const bg = Array.isArray(payload) ? '#ffffff' : (payload?.bg || '#ffffff');
          const editingId = Array.isArray(payload) ? null : (payload?.editingId || null);
          const canvasW = (Array.isArray(payload) ? null : payload?.canvasW) || 480;
          const canvasH = (Array.isArray(payload) ? null : payload?.canvasH) || 360;
          // Editing an existing canvas — write strokes (already in
          // card-local coords because that's how SketchPad loaded them)
          // and the bg back, then leave the card selected so the user
          // can keep drawing on it inline.
          if (editingId) {
            // The whole sketch-edit session saves as ONE undo step — and
            // never merges into whatever preceded opening the pad.
            mutators.breakUndo?.();
            // Exactly one of the two carries the drawing. `layers: null` on a
            // sketch edited back down to one layer must CLEAR the old stack, or
            // the card keeps rendering it and ignores `strokes`; and a layered
            // card stores an EMPTY `strokes`, because a flattened mirror is
            // derived data and derived data does not belong in a CRDT.
            mutators.updateCard?.(editingId, { strokes: layers ? [] : strokes, layers, bg });
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
            bg, strokes: layers ? [] : localStrokes, ...(layers ? { layers } : {}),
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

// ── StrokePath ──────────────────────────────────────────────────────────
// One painted stroke, on any of the SVG surfaces.
//
// A constant-width stroke is an OPEN polyline painted with stroke-width — what
// every stroke in every board still is. A pressure or brush stroke is a CLOSED
// outline that has to be FILLED instead, because its width varies along its
// length and `stroke-width` is a single number. Getting that backwards paints a
// hairline outline of the shape instead of the shape, so the choice lives here
// rather than being repeated at each call site.
function StrokePath({ s, d, ...rest }) {
  const filled = isFilledPath(s);
  const color = s.color || DRAW_DEFAULT_COLOR;
  const alpha = strokeOpacity(s);
  return (
    <path d={d ?? toPathD(s)}
          fill={filled ? color : 'none'}
          stroke={filled ? 'none' : color}
          strokeWidth={filled ? undefined : (s.width || DRAW_DEFAULT_WIDTH)}
          strokeLinecap={filled ? undefined : strokeLineCap(s)}
          strokeLinejoin={filled ? undefined : 'round'}
          opacity={alpha === 1 ? undefined : alpha}
          {...rest} />
  );
}

// ── CardStrokesOverlay ──────────────────────────────────────────────────
// Renders a card's `strokes` array as an SVG layer bounded to the card's
// box. The draw tool only routes strokes here for ART canvases (selected or
// majority-overlapped), but the overlay stays mounted on every card kind:
// a routing bug used to write strokes onto whatever single card was
// selected, and boards that carry those legacy annotations must keep
// rendering them.
// Takes the CARD, not its strokes, so the layer flattening in readCardStrokes
// happens behind the memo. Passing readCardStrokes(c) from the parent would
// allocate a fresh array on every parent render and bust the memo outright.
// Memoized: props are all primitive / stable-by-card-identity, so default
// shallow compare lets unchanged cards skip the path-string concat.
const CardStrokesOverlay = memo(function CardStrokesOverlay({ card, w, h }) {
  const strokes = readCardStrokes(card);
  if (!Array.isArray(strokes) || strokes.length === 0) return null;
  const vw = Math.max(1, w || 1);
  const vh = Math.max(1, h || 1);
  return (
    <svg className="card-strokes-overlay"
         viewBox={`0 0 ${vw} ${vh}`} width="100%" height="100%"
         preserveAspectRatio="none"
         style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
      {strokes.map((s, i) => (s?.points?.length ? <StrokePath key={i} s={s} /> : null))}
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
    // Capture + pointerdown so a tap outside closes it on touch.
    document.addEventListener('pointerdown', onDocDown, true);
    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDocDown, true);
      document.removeEventListener('mousedown', onDocDown, true);
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
