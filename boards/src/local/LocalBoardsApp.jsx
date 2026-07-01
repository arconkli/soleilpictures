import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CanvasSurface } from '../components/CanvasSurface.jsx';
import { ListSurface } from '../components/ListSurface.jsx';
import { CommandPalette } from '../components/CommandPalette.jsx';
import { Avatar, SoleilMark } from '../components/primitives.jsx';
import { SoleilWordmark } from '../components/SoleilWordmark.jsx';
import { Icon } from '../components/Icon.jsx';
import { Plus, PanelLeftClose, PanelLeftOpen, Search, LayoutGrid, Inbox as InboxIcon, Sun, Moon, LogOut, Home, MessageSquare, Settings, MoreHorizontal, StickyNote } from '../lib/icons.js';
import { useRecents } from '../hooks/useRecents.js';
import { isEditableTarget } from '../lib/isEditableTarget.js';
import { presetTree, resizeDivider, splitCell, mergeCell, removeDivider, tileLinkedGrids, graftSubtree } from '../lib/gridLayout.js';
import { hasLabelTag } from '../lib/gridSequence.js';
import { TweaksPanel, TweakSection, TweakToggle, TweakRadio, useTweaks } from '../components/TweaksPanel.jsx';
import { BOARDS } from '../data.js';
import { HomeGraph } from '../components/HomeGraph.jsx';
import { useBreakpoint } from '../hooks/useBreakpoint.js';
import { MobileBottomNav } from '../components/shell/MobileBottomNav.jsx';
import { OnboardingCoachmark } from '../components/OnboardingCoachmark.jsx';
import { OnboardingTour } from '../components/OnboardingTour.jsx';
import { useOnboardingTour } from '../hooks/useOnboardingTour.js';
import { supabase } from '../lib/supabase.js';
import { decodeShowcaseCards } from '../lib/showcaseClone.js';
import { ShortcutsHost } from '../components/ShortcutsOverlay.jsx';

const TWEAK_DEFAULTS = {
  theme: 'dark',
  showArrows: true,
  showMessages: false,
  compactSidebar: false,
};

const ROOT_ID = 'root';
const LOCAL_SESSION_KEY = 'soleil.boards.local.session.v1';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadLocalSession() {
  if (typeof window === 'undefined') return null;
  if (new URLSearchParams(window.location.search).get('reset') === '1') {
    localStorage.removeItem(LOCAL_SESSION_KEY);
    return null;
  }
  try {
    const raw = localStorage.getItem(LOCAL_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function createInitialState() {
  // Blank test surface (see BLANK_SEED): a clean empty Studio root so bare-canvas
  // placement clicks aren't swallowed by seeded demo cards. Same shape as
  // createOnboardingState's return.
  if (BLANK_SEED) {
    return {
      boards: {
        [ROOT_ID]: {
          id: ROOT_ID, name: 'Studio', view: 'canvas',
          workspace_id: 'local-workspace', parent_board_id: null,
          created_at: new Date(0).toISOString(),
        },
      },
      boardState: { [ROOT_ID]: { cards: [], arrows: [], strokes: [] } },
    };
  }
  const boards = {};
  const boardState = {};

  for (const [id, board] of Object.entries(BOARDS)) {
    const { cards = [], arrows = [], links: _links, ...meta } = board;
    boards[id] = {
      ...meta,
      id,
      workspace_id: 'local-workspace',
      parent_board_id: id === ROOT_ID ? null : undefined,
      created_at: new Date(0).toISOString(),
    };
    boardState[id] = { cards: clone(cards), arrows: clone(arrows || []), strokes: [] };
  }

  for (const [parentId, state] of Object.entries(boardState)) {
    for (const card of state.cards) {
      if (card.kind === 'board' && boards[card.id] && boards[card.id].parent_board_id === undefined) {
        boards[card.id].parent_board_id = parentId;
      }
    }
  }

  for (const board of Object.values(boards)) {
    if (board.parent_board_id === undefined) board.parent_board_id = null;
  }

  return { boards, boardState };
}

// Dev-only first-run preview: ?local=1&onboard=1 boots an empty "Studio" with
// the real STARTER_CARDS + coachmark, so the brand-new-user board can be seen
// locally (the real seed lives in App.jsx's Workspace, which needs a live
// session). Mirrors the existing ?adoffer / ?reset dev affordances.
const ONBOARD_PREVIEW = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('onboard') === '1';

// Dev/test-only: ?local=1&reset=1&blank=1 boots an EMPTY "Studio" root (no demo
// cards). Placement specs that click bare canvas to add a card need a clear
// surface — the normal seed packs the canvas, so a hardcoded click lands on a
// demo card and places nothing. See createInitialState() below.
const BLANK_SEED = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('blank') === '1';

// Dev-only: add &tour=1 (best alongside &blank=1) to walk the REAL first-run
// guided tour on a live local canvas — no Supabase / arm enrollment needed.
// e.g. /?local=1&reset=1&blank=1&tour=1
const TOUR_DEMO = typeof window !== 'undefined' && import.meta.env.DEV
  && new URLSearchParams(window.location.search).get('tour') === '1';

// Dev-only: ?local=1&showcase=1 renders welcome_showcase arm B exactly as a new
// user gets it — calls the real prepare_showcase RPC (grants this session's images
// read + returns the Clusters Logo snapshot), decodes it the same way production
// does (showcaseClone), and shows it on the root with the "Clear & try it yourself"
// banner. Works for ANY signed-in account (member or demo). You must be signed in
// ON THIS ORIGIN (the dev server you're viewing) for the images to presign.
const SHOWCASE_PREVIEW = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('showcase') === '1';

function createShowcasePreviewState() {
  // A clean Studio root; the snapshot loads into it asynchronously (effect below).
  return {
    boards: {
      [ROOT_ID]: {
        id: ROOT_ID, name: 'Studio', view: 'canvas',
        workspace_id: 'local-workspace', parent_board_id: null,
        created_at: new Date(0).toISOString(),
      },
    },
    boardState: { [ROOT_ID]: { cards: [], arrows: [], strokes: [] } },
  };
}

function createOnboardingState() {
  // Mirror the SHIPPED default (onboarding_v2 arm B, image-first): a clean EMPTY
  // Studio root — no seed cards — so CanvasSurface renders the image-first "Start
  // your moodboard" tiles, exactly what a brand-new user now sees. (The prior arm-A
  // notes + "Ideas" tutorial is retired.) The "Add your first image" coachmark is
  // shown via the arm="B" prop at the render site below.
  return {
    boards: {
      [ROOT_ID]: {
        id: ROOT_ID, name: 'Studio', view: 'canvas',
        workspace_id: 'local-workspace', parent_board_id: null,
        created_at: new Date(0).toISOString(),
      },
    },
    boardState: {
      [ROOT_ID]: { cards: [], arrows: [], strokes: [] },
    },
  };
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function getNextZ(cards) {
  return cards.reduce((max, card) => Math.max(max, card.z || 0), 0) + 1;
}

function collectBoardTreeIds(boards, rootIds) {
  const ids = new Set(rootIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const board of Object.values(boards)) {
      if (ids.has(board.parent_board_id) && !ids.has(board.id)) {
        ids.add(board.id);
        changed = true;
      }
    }
  }
  return ids;
}

export function LocalBoardsApp({ user, signOut }) {
  const [initialSession] = useState(() => ((ONBOARD_PREVIEW || SHOWCASE_PREVIEW) ? null : loadLocalSession()));
  const [{ boards, boardState }, setLocalState] = useState(() => (
    SHOWCASE_PREVIEW ? createShowcasePreviewState()
      : ONBOARD_PREVIEW ? createOnboardingState()
      : (initialSession?.localState || createInitialState())
  ));
  const [tweak, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [stack, setStack] = useState(() => initialSession?.stack?.length ? initialSession.stack : [ROOT_ID]);
  const [viewOverride, setViewOverride] = useState(() => initialSession?.viewOverride || {});
  // Shared Grid layout templates (global sync), keyed by boardId → { tplId: {id,name,layout} }.
  // Kept separate from boardState (whose updater only threads cards/arrows/strokes).
  const [gridTplState, setGridTplState] = useState({});
  // Grid sequences, keyed by boardId → { seqId: {id,name,pattern,format} }.
  const [gridSeqState, setGridSeqState] = useState({});
  const [pickerOpen, setPickerOpen] = useState(false);
  // Global search + ⌘K command palette (separate from the boards-only
  // BoardPicker, which stays the "link a board" surface).
  const [paletteOpen, setPaletteOpen] = useState(false);
  const recents = useRecents('local-workspace');
  // Mirror App.jsx: the mobile shell covers phones AND touch tablets (iPad
  // portrait, ≤1024). Must match the global shell CSS query in styles.css —
  // otherwise the sidebar styles as a hidden drawer on a tablet with no
  // hamburger to open it.
  const { isPhone, isTablet, isTouch } = useBreakpoint();
  const mobileShell = isPhone || (isTablet && isTouch);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  useEffect(() => { if (!mobileShell) setMobileNavOpen(false); }, [mobileShell]);
  const [selectedTool, setSelectedTool] = useState('select');
  const [autoFocusId, setAutoFocusId] = useState(null);
  const [currentSurface, setCurrentSurface] = useState('board');
  //   'board' = existing canvas/doc surface; 'home' = HomeGraph
  const [onboardCoachOpen, setOnboardCoachOpen] = useState(ONBOARD_PREVIEW);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', tweak.theme);
  }, [tweak.theme]);

  // Showcase preview: pull the real Clusters Logo board snapshot + decode it the
  // same way production arm B does, then drop it onto the root. Best-effort — if
  // you're not signed in / not a member, the source read fails and the board stays
  // empty (check the console). Throwaway; never persisted.
  useEffect(() => {
    if (!SHOWCASE_PREVIEW) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: au } = await supabase.auth.getUser();
        if (!au?.user?.id) { console.warn('[showcase preview] not signed in on this origin — sign in here first'); return; }
        // prepare_showcase needs a board you can write as the image-grant anchor;
        // any board in your workspace works (RLS only returns yours).
        const { data: mine } = await supabase.from('boards').select('id').is('deleted_at', null).limit(1);
        const anchor = mine?.[0]?.id;
        if (!anchor) { console.warn('[showcase preview] no board found to anchor the image grant'); return; }
        const tpl = (await supabase.rpc('prepare_showcase', { p_board_id: anchor })).data;
        const cards = decodeShowcaseCards(tpl?.snapshot);
        if (!cancelled && cards.length) {
          setLocalState((prev) => ({
            ...prev,
            boardState: { ...prev.boardState, [ROOT_ID]: { cards, arrows: [], strokes: [] } },
          }));
        } else {
          console.warn('[showcase preview] no cards returned (showcase disabled in config, or snapshot empty)');
        }
      } catch (e) {
        console.warn('[showcase preview] failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (ONBOARD_PREVIEW || SHOWCASE_PREVIEW) return;   // previews are throwaway — never pollute the saved local session (blank DOES persist, so the persistence spec can reload and find its note)
    try {
      localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify({
        localState: { boards, boardState },
        stack,
        viewOverride,
      }));
    } catch (_) {}
  }, [boards, boardState, stack, viewOverride]);

  const currentId = stack[stack.length - 1] || ROOT_ID;
  const currentBoard = boards[currentId] || boards[ROOT_ID];
  const currentState = boardState[currentId] || { cards: [], arrows: [], strokes: [] };
  const currentTemplates = gridTplState[currentId] || {};
  const currentSequences = gridSeqState[currentId] || {};
  const view = viewOverride[currentId] || currentBoard.view || 'canvas';

  // Dev-only guided-tour demo (?tour=1). The mutators below emit tour events via
  // tourFireRef; the overlay is mounted near the surface. No persistence/funnel
  // here — this is purely to preview the real component/engine on a live canvas.
  const tourFireRef = useRef(null);
  const tour = useOnboardingTour({ onboarding: {}, persist: () => {}, emit: () => {}, enabled: TOUR_DEMO });
  tourFireRef.current = TOUR_DEMO ? tour.fire : null;
  const prevTourBoardRef = useRef(currentId);
  useEffect(() => {
    const was = prevTourBoardRef.current;
    prevTourBoardRef.current = currentId;
    if (TOUR_DEMO && was !== currentId && currentId === ROOT_ID && was !== ROOT_ID) {
      tourFireRef.current?.({ type: 'nav_back' });
    }
  }, [currentId]);
  const childBoards = useMemo(
    () => Object.values(boards).filter(board => board.parent_board_id === currentId),
    [boards, currentId],
  );
  const crumbs = stack.map(id => ({ id, name: boards[id]?.name || id }));

  const updateBoardState = (updater) => {
    setLocalState(prev => {
      const current = prev.boardState[currentId] || { cards: [], arrows: [], strokes: [] };
      const nextCurrent = updater({
        cards: [...current.cards],
        arrows: [...current.arrows],
        strokes: [...current.strokes],
      });
      return {
        ...prev,
        boardState: {
          ...prev.boardState,
          [currentId]: nextCurrent,
        },
      };
    });
  };

  const addCard = (card) => {
    updateBoardState(state => ({
      ...state,
      cards: [...state.cards, { z: getNextZ(state.cards), ...card }],
    }));
    if (card?.kind !== 'board') tourFireRef.current?.({ type: 'content_added', boardId: currentId, kind: card?.kind || 'card' });
  };

  const addCards = (cardsToAdd) => {
    if (!cardsToAdd?.length) return;
    updateBoardState(state => {
      let z = getNextZ(state.cards);
      return {
        ...state,
        cards: [...state.cards, ...cardsToAdd.map(card => ({ z: z++, ...card }))],
      };
    });
  };

  const updateCard = (cardId, patch) => {
    updateBoardState(state => ({
      ...state,
      cards: state.cards.map(card => card.id === cardId ? { ...card, ...patch } : card),
    }));
  };

  const updateCards = (updates) => {
    const patches = new Map((updates || []).map(({ id, patch }) => [id, patch]));
    updateBoardState(state => ({
      ...state,
      cards: state.cards.map(card => patches.has(card.id) ? { ...card, ...patches.get(card.id) } : card),
    }));
  };

  const deleteCards = (ids) => {
    const idSet = new Set(ids || []);
    if (!idSet.size) return;
    setLocalState(prev => {
      const boardIds = [...idSet].filter(id => prev.boards[id] && id !== ROOT_ID);
      const cascadeIds = collectBoardTreeIds(prev.boards, boardIds);
      const removeIds = new Set([...idSet, ...cascadeIds]);
      const nextBoards = { ...prev.boards };
      const nextBoardState = {};

      cascadeIds.forEach(id => {
        delete nextBoards[id];
      });

      for (const [boardId, state] of Object.entries(prev.boardState)) {
        if (cascadeIds.has(boardId)) continue;
        nextBoardState[boardId] = {
          ...state,
          cards: state.cards.filter(card => !removeIds.has(card.id)),
          arrows: state.arrows.filter(arrow => !removeIds.has(arrow.from) && !removeIds.has(arrow.to)),
        };
      }

      return { boards: nextBoards, boardState: nextBoardState };
    });
  };

  const duplicateCards = (ids) => {
    const idSet = new Set(ids || []);
    const newIds = [];
    updateBoardState(state => {
      let z = getNextZ(state.cards);
      const copies = state.cards
        .filter(card => idSet.has(card.id) && card.kind !== 'board')
        .map(card => {
          const id = createId(card.kind || 'card');
          newIds.push(id);
          return { ...clone(card), id, x: (card.x || 0) + 24, y: (card.y || 0) + 24, z: z++ };
        });
      return { ...state, cards: [...state.cards, ...copies] };
    });
    return newIds;
  };

  const bringToFront = (cardId) => {
    updateBoardState(state => ({
      ...state,
      cards: state.cards.map(card => card.id === cardId ? { ...card, z: getNextZ(state.cards) } : card),
    }));
  };

  const addArrow = (fromId, toId, opts = {}) => {
    if (!fromId || !toId || fromId === toId) return;
    updateBoardState(state => ({ ...state, arrows: [...state.arrows, { from: fromId, to: toId, ...opts }] }));
  };

  const addFreeArrow = (from, to, opts = {}) => {
    updateBoardState(state => ({ ...state, arrows: [...state.arrows, { from, to, ...opts }] }));
  };

  const deleteArrows = (indices) => {
    const indexSet = new Set(indices || []);
    updateBoardState(state => ({ ...state, arrows: state.arrows.filter((_arrow, index) => !indexSet.has(index)) }));
  };

  const addStroke = (stroke) => {
    updateBoardState(state => ({ ...state, strokes: [...state.strokes, stroke] }));
  };

  const deleteStrokes = (indices) => {
    const indexSet = new Set(indices || []);
    updateBoardState(state => ({ ...state, strokes: state.strokes.filter((_stroke, index) => !indexSet.has(index)) }));
  };

  const replaceStrokes = (nextStrokes) => {
    updateBoardState(state => ({ ...state, strokes: nextStrokes || [] }));
  };

  const addNewBoard = (clickPos = null) => {
    const id = createId('board');
    const name = 'Untitled cluster';
    setLocalState(prev => ({
      boards: {
        ...prev.boards,
        [id]: {
          id,
          kind: 'board',
          name,
          view: 'canvas',
          workspace_id: 'local-workspace',
          parent_board_id: currentId,
          created_at: new Date().toISOString(),
        },
      },
      boardState: {
        ...prev.boardState,
        [id]: { cards: [], arrows: [], strokes: [] },
      },
    }));
    const w = 280;
    const h = 220;
    addCard({
      id,
      kind: 'board',
      x: Math.max(8, Math.round((clickPos?.x ?? 200) - w / 2)),
      y: Math.max(8, Math.round((clickPos?.y ?? 180) - h / 2)),
      w,
      h,
    });
    setAutoFocusId(id);
    tourFireRef.current?.({ type: 'cluster_created', boardId: id });
  };

  const renameBoardById = (boardId, name) => {
    if (!name?.trim()) return;
    setLocalState(prev => ({
      ...prev,
      boards: {
        ...prev.boards,
        [boardId]: { ...prev.boards[boardId], name: name.trim() },
      },
    }));
    tourFireRef.current?.({ type: 'cluster_renamed', boardId });
  };

  const deleteBoardsById = (ids) => {
    setLocalState(prev => {
      const idSet = collectBoardTreeIds(prev.boards, (ids || []).filter(id => id !== ROOT_ID));
      const nextBoards = { ...prev.boards };
      const nextBoardState = {};
      idSet.forEach(id => {
        delete nextBoards[id];
      });
      for (const [boardId, state] of Object.entries(prev.boardState)) {
        if (idSet.has(boardId)) continue;
        nextBoardState[boardId] = {
          ...state,
          cards: state.cards.filter(card => !idSet.has(card.id)),
          arrows: state.arrows.filter(arrow => !idSet.has(arrow.from) && !idSet.has(arrow.to)),
        };
      }
      return { boards: nextBoards, boardState: nextBoardState };
    });
  };

  const addNote = (clickPos = null) => {
    const id = createId('note');
    const w = 240;
    const h = 160;
    addCard({
      id,
      kind: 'note',
      html: '',
      // Horizontally centered on the click; TOP edge at the click (notes
      // auto-size their height down after creation, so centering on h would
      // leave them floating above the cursor). Mirrors App.jsx addNote.
      x: Math.max(8, Math.round((clickPos?.x ?? 200) - w / 2)),
      y: Math.max(8, Math.round(clickPos?.y ?? (180 - h / 2))),
      w,
      h,
    });
    setAutoFocusId(id);
  };

  const addTextLink = (clickPos = null) => {
    const w = 280;
    const h = 170;
    addCard({
      id: createId('note'),
      kind: 'note',
      html: '',
      x: Math.max(8, Math.round((clickPos?.x ?? 200) - w / 2)),
      y: Math.max(8, Math.round((clickPos?.y ?? 180) - h / 2)),
      w,
      h,
    });
  };

  const addPalette = (clickPos = null) => {
    const id = createId('pal');
    const w = 300;
    const h = 180;
    addCard({
      id,
      kind: 'palette',
      title: 'Palette',
      swatches: [
        { name: 'Color', hex: '#3b82f6' },
        { name: 'Color', hex: '#10b981' },
      ],
      x: Math.max(8, Math.round((clickPos?.x ?? 200) - w / 2)),
      y: Math.max(8, Math.round((clickPos?.y ?? 180) - h / 2)),
      w,
      h,
    });
    setAutoFocusId(id);
  };

  // Minimal doc card for the local QA harness — enough for the rail "Doc"
  // tool + the + / right-click Doc entries to place a card. There's no
  // ydoc-backed doc store here, so CanvasSurface renders the static
  // <DocCard> fallback (kind:'doc' without docPages). Not a full editor.
  const addDocCard = (clickPos = null) => {
    const id = createId('doc');
    const w = 320;
    const h = 240;
    addCard({
      id,
      kind: 'doc',
      title: 'Untitled doc',
      lines: [],
      x: Math.max(8, Math.round((clickPos?.x ?? 200) - w / 2)),
      y: Math.max(8, Math.round((clickPos?.y ?? 180) - h / 2)),
      w,
      h,
    });
    setAutoFocusId(id);
  };

  const addShape = (clickPos = null, opts = {}) => {
    const w = opts.w || 160;
    const h = opts.h || 100;
    addCard({
      id: createId('shape'),
      kind: 'shape',
      shape: opts.shape || 'rect',
      stroke: opts.stroke || '#f5f5f6',
      fill: opts.fill || 'transparent',
      strokeWidth: opts.strokeWidth || 2,
      dash: opts.dash || 'solid',
      x: Math.max(8, Math.round((clickPos?.x ?? 200) - w / 2)),
      y: Math.max(8, Math.round((clickPos?.y ?? 180) - h / 2)),
      w,
      h,
    });
  };

  const addImageAt = (clickPos = null) => {
    const w = 260;
    const h = 190;
    addCard({
      id: createId('img'),
      kind: 'image',
      tone: 'neutral',
      // Local QA — point at a static same-origin photo (resolveSrc passes plain
      // URLs through), so the image card renders a real picture and exercises
      // the photo-edit affordances + the canvas download bake with no backend.
      src: '/signin-losttime-still1.webp',
      label: 'LOCAL IMAGE',
      x: Math.max(8, Math.round((clickPos?.x ?? 200) - w / 2)),
      y: Math.max(8, Math.round((clickPos?.y ?? 180) - h / 2)),
      w,
      h,
    });
  };

  const addPdfAt = (clickPos = null) => {
    // Local QA — point at the static sample fixture so PdfCard + PdfViewer
    // can be exercised with no backend (resolveSrc passes plain URLs through).
    const w = 300, h = 388;
    addCard({
      id: createId('pdf'),
      kind: 'pdf',
      pdfSrc: '/sample.pdf',
      src: null,
      name: 'sample.pdf',
      pageCount: 3,
      x: Math.max(8, Math.round((clickPos?.x ?? 200) - w / 2)),
      y: Math.max(8, Math.round((clickPos?.y ?? 180) - h / 2)),
      w,
      h,
    });
  };

  const addLink = (targetBoard) => {
    addCard({
      id: createId('xlink'),
      kind: 'boardlink',
      target: targetBoard.id,
      note: 'Local link',
      x: 1080,
      y: 80 + Math.floor(Math.random() * 200),
      w: 220,
      h: 160,
    });
  };

  // Grid card. Local shell has no Yjs, so layout + cell content live as plain
  // fields on the card (readGridModel normalizes both paths). Always unlinked
  // here — shared templates need the per-board Y.Doc the local shell lacks.
  const addGrid = (clickPos = null, opts = {}) => {
    const preset = opts.preset || 'storyboard-1-2';
    const w = opts.w || 360, h = opts.h || 300;
    const x = clickPos ? Math.round(clickPos.x - w / 2) : 60;
    const y = clickPos ? Math.round(clickPos.y - h / 2) : 60;
    const mkCellId = () => 'gc_' + Math.random().toString(36).slice(2, 9);
    addCard({
      id: createId('grid'), kind: 'grid',
      layout: presetTree(preset, mkCellId),
      cells: {}, templateId: null, seqId: null,
      x: Math.max(8, x), y: Math.max(8, y), w, h,
    });
  };

  // Grid cell + divider mutators (local shell = plain layout/cells fields; shared
  // layouts live in gridTplState, mirroring the Yjs gridTemplates map).
  const mapGridCard = (gridId, fn) => updateBoardState(state => ({
    ...state,
    cards: state.cards.map(c => (c.id === gridId ? fn(c) : c)),
  }));
  const findLocalGrid = (gridId) => (boardState[currentId]?.cards || []).find(c => c.id === gridId) || null;
  // Template-aware layout edit: write to the shared template when linked, else the
  // card's own layout — so editing one linked Grid's divider reflows every Grid
  // sharing the template (same-board global sync).
  const localGridLayoutEdit = (gridId, transform) => {
    const card = findLocalGrid(gridId); if (!card) return;
    if (card.templateId) {
      setGridTplState(prev => {
        const board = prev[currentId] || {};
        const tpl = board[card.templateId];
        const cur = tpl?.layout || card.layout; if (!cur) return prev;
        return { ...prev, [currentId]: { ...board, [card.templateId]: { ...(tpl || { id: card.templateId }), layout: transform(cur) } } };
      });
    } else {
      mapGridCard(gridId, c => (c.layout ? { ...c, layout: transform(c.layout) } : c));
    }
  };
  const localGridLayout = (card) => card?.templateId
    ? ((gridTplState[currentId]?.[card.templateId]?.layout) || card?.layout || null)
    : (card?.layout || null);
  const resizeGridDivider = (gridId, path, childIndex, deltaFrac) =>
    localGridLayoutEdit(gridId, l => resizeDivider(l, path, childIndex, deltaFrac));
  const splitGridCell = (gridId, cellId, orientation) =>
    localGridLayoutEdit(gridId, l => splitCell(l, cellId, orientation));
  const mergeGridCell = (gridId, cellId) => {
    const card = findLocalGrid(gridId); const cur = localGridLayout(card); if (!cur) return;
    const { tree, removedIds } = mergeCell(cur, cellId);
    if (!removedIds.length) return;
    localGridLayoutEdit(gridId, () => tree);
    mapGridCard(gridId, c => { const cells = { ...(c.cells || {}) }; removedIds.forEach(id => delete cells[id]); return { ...c, cells }; });
  };
  const removeGridDivider = (gridId, path, childIndex) => {
    const card = findLocalGrid(gridId); const cur = localGridLayout(card); if (!cur) return;
    const { tree, removedIds } = removeDivider(cur, path, childIndex);
    if (!removedIds.length) return;
    localGridLayoutEdit(gridId, () => tree);
    mapGridCard(gridId, c => { const cells = { ...(c.cells || {}) }; removedIds.forEach(id => delete cells[id]); return { ...c, cells }; });
  };
  const setGridCellContent = (gridId, cellId, patch) =>
    mapGridCard(gridId, c => {
      const prev = c.cells?.[cellId] || {};
      // type-carrying patch = full content write → replace (no stale fields leak);
      // type-less patch = partial update → merge (mirrors gridState.setGridCell).
      // The `style` override (pinned text style) is display state → survives replace.
      const next = patch && patch.type
        ? { ...(prev.style ? { style: prev.style } : {}), ...patch }
        : { ...prev, ...patch };
      return { ...c, cells: { ...(c.cells || {}), [cellId]: next } };
    });
  // Graft a source Grid INTO a host cell (drop-a-grid-into-a-cell, editable inline).
  const graftGridIntoCell = (hostGridId, cellId, sourceGridId) => {
    const host = findLocalGrid(hostGridId); const src = findLocalGrid(sourceGridId);
    if (!host || !src || hostGridId === sourceGridId) return;
    const hostLayout = localGridLayout(host); const srcLayout = localGridLayout(src);
    if (!hostLayout || !srcLayout) return;
    const mkCellId = () => 'gc_' + Math.random().toString(36).slice(2, 9);
    const { tree, idMap } = graftSubtree(hostLayout, cellId, srcLayout, mkCellId);
    if (!Object.keys(idMap).length) return;
    const srcCells = src.cells || {};
    mapGridCard(hostGridId, c => {
      const { templateId, ...rest } = c; // unlink — graft is local to this Grid
      const cells = { ...(c.cells || {}) };
      delete cells[cellId];
      Object.entries(idMap).forEach(([srcId, newId]) => {
        const rec = srcCells[srcId];
        if (rec && rec.type && rec.type !== 'empty') cells[newId] = rec;
      });
      return { ...rest, layout: clone(tree), cells };
    });
    deleteCards([sourceGridId]); // consume the source (move semantics)
  };
  const clearGridCellContent = (gridId, cellId) =>
    mapGridCard(gridId, c => ({ ...c, cells: { ...(c.cells || {}), [cellId]: { type: 'empty' } } }));
  // ── shared / per-cell text style (local twin of App.jsx) ───────────────────
  const localFamilyStyle = (card) => {
    if (card?.templateId) return gridTplState[currentId]?.[card.templateId]?.textStyle || {};
    return card?.textStyle || {};
  };
  const setGridTextStyle = (gridId, cellId, patch, opts = {}) => {
    if (!patch) return;
    const card = findLocalGrid(gridId); if (!card) return;
    if (opts.pinned) {
      mapGridCard(gridId, c => {
        const prev = c.cells?.[cellId] || {};
        return { ...c, cells: { ...(c.cells || {}), [cellId]: { ...prev, style: { ...(prev.style || {}), ...patch } } } };
      });
    } else if (card.templateId) {
      const tplId = card.templateId;
      setGridTplState(prev => {
        const tpls = prev[currentId] || {};
        const tpl = tpls[tplId] || { id: tplId };
        return { ...prev, [currentId]: { ...tpls, [tplId]: { ...tpl, id: tplId, textStyle: { ...(tpl.textStyle || {}), ...patch } } } };
      });
    } else {
      mapGridCard(gridId, c => ({ ...c, textStyle: { ...(c.textStyle || {}), ...patch } }));
    }
  };
  const pinCellStyle = (gridId, cellId) => {
    const card = findLocalGrid(gridId); if (!card) return;
    const fam = localFamilyStyle(card);
    mapGridCard(gridId, c => {
      const prev = c.cells?.[cellId] || {};
      return { ...c, cells: { ...(c.cells || {}), [cellId]: { ...prev, style: { ...fam, ...(prev.style || {}) } } } };
    });
  };
  const unpinCellStyle = (gridId, cellId) =>
    mapGridCard(gridId, c => {
      const prev = c.cells?.[cellId]; if (!prev) return c;
      const { style, ...rest } = prev;
      return { ...c, cells: { ...(c.cells || {}), [cellId]: rest } };
    });
  const promoteGridToTemplate = (gridId, name = 'Grid layout') => {
    const card = findLocalGrid(gridId); if (!card || card.templateId || !card.layout) return null;
    const tplId = createId('gtpl');
    setGridTplState(prev => ({ ...prev, [currentId]: { ...(prev[currentId] || {}), [tplId]: { id: tplId, name, layout: card.layout } } }));
    mapGridCard(gridId, c => { const { layout, ...rest } = c; return { ...rest, templateId: tplId }; });
    return tplId;
  };
  const linkGridToTemplate = (gridId, tplId) =>
    mapGridCard(gridId, c => { const { layout, ...rest } = c; return { ...rest, templateId: tplId }; });
  const unlinkGrid = (gridId) => {
    const card = findLocalGrid(gridId); if (!card?.templateId) return;
    const layout = gridTplState[currentId]?.[card.templateId]?.layout || card.layout; if (!layout) return;
    mapGridCard(gridId, c => { const { templateId, ...rest } = c; return { ...rest, layout: clone(layout) }; });
  };
  // Sequences + stamping (local parity). Carries label-tag text cells to copies.
  const localLabelTagCells = (card) => {
    const out = {};
    for (const [k, cell] of Object.entries(card.cells || {})) {
      if (cell?.type === 'text' && hasLabelTag(cell.html)) out[k] = { type: 'text', html: cell.html };
    }
    return out;
  };
  const ensureLocalTemplate = (card) => {
    if (card.templateId) return card.templateId;
    const tplId = createId('gtpl');
    setGridTplState(prev => ({ ...prev, [currentId]: { ...(prev[currentId] || {}), [tplId]: { id: tplId, name: 'Grid layout', layout: card.layout } } }));
    mapGridCard(card.id, c => { const { layout, ...rest } = c; return { ...rest, templateId: tplId }; });
    return tplId;
  };
  const ensureLocalSequence = (card) => {
    if (card.seqId) return card.seqId;
    const seqId = createId('gseq');
    setGridSeqState(prev => ({ ...prev, [currentId]: { ...(prev[currentId] || {}), [seqId]: { id: seqId, name: 'Sequence', pattern: 'z', format: { startAt: 1 } } } }));
    mapGridCard(card.id, c => ({ ...c, seqId }));
    return seqId;
  };
  const stampGridNeighbor = (gridId, dir) => {
    const card = findLocalGrid(gridId); if (!card) return;
    const w = card.w || 360, h = card.h || 300, x = card.x, y = card.y, gap = 0; // flush — share the edge line
    let nx = x, ny = y;
    if (dir === 'right') nx = x + w + gap; else if (dir === 'left') nx = x - w - gap;
    else if (dir === 'bottom') ny = y + h + gap; else if (dir === 'top') ny = y - h - gap;
    const tplId = ensureLocalTemplate(card);
    const seqId = ensureLocalSequence(card);
    const carry = localLabelTagCells(card);
    addCard({ id: createId('grid'), kind: 'grid', templateId: tplId, seqId, cells: carry, x: Math.max(8, nx), y: Math.max(8, ny), w, h });
  };
  const bulkGenerateGrids = (gridId, cols, rows, opts = {}) => {
    const card = findLocalGrid(gridId); if (!card) return;
    const C = Math.max(1, Math.min(50, cols | 0)), R = Math.max(1, Math.min(50, rows | 0));
    if (C * R <= 1) return;
    const w = card.w || 360, h = card.h || 300, x0 = card.x, y0 = card.y, gx = opts.gapX ?? 0, gy = opts.gapY ?? 0;
    const tplId = ensureLocalTemplate(card);
    const seqId = ensureLocalSequence(card);
    const carry = localLabelTagCells(card);
    const newCards = [];
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      if (r === 0 && c === 0) continue;
      newCards.push({ id: createId('grid'), kind: 'grid', templateId: tplId, seqId, cells: { ...carry }, x: Math.max(8, x0 + c * (w + gx)), y: Math.max(8, y0 + r * (h + gy)), w, h });
    }
    addCards(newCards);
  };
  // Resize one Grid → linked family all become the same size + re-tile (flush);
  // unlinked just resizes itself. Mirrors App.resizeLinkedGrids.
  const resizeLinkedGrids = (gridId, newW, newH) => {
    const card = findLocalGrid(gridId); if (!card) return;
    if (!card.templateId) { updateCard(gridId, { w: newW, h: newH }); return; }
    const fam = (boardState[currentId]?.cards || []).filter(c => c.kind === 'grid' && c.templateId === card.templateId)
      .map(c => ({ id: c.id, x: c.x, y: c.y, w: c.w, h: c.h }));
    const tiled = tileLinkedGrids(fam, newW, newH, 0);
    const byId = Object.fromEntries(tiled.map(t => [t.id, t]));
    updateBoardState(state => ({
      ...state,
      cards: state.cards.map(c => byId[c.id] ? { ...c, x: byId[c.id].x, y: byId[c.id].y, w: byId[c.id].w, h: byId[c.id].h } : c),
    }));
  };
  const setGridSequencePattern = (seqId, pattern) => setGridSeqState(prev => {
    const board = prev[currentId] || {}; const seq = board[seqId]; if (!seq) return prev;
    return { ...prev, [currentId]: { ...board, [seqId]: { ...seq, pattern } } };
  });

  // Chat-attachment drops piggy-back on the INBOX_MIME drag protocol so
  // CanvasSurface still calls onDropInboxItem for them.
  const dropInboxItem = (_inboxId, card) => addCard(card);

  const setBoardBgColor = (color) => {
    setLocalState(prev => ({
      ...prev,
      boards: {
        ...prev.boards,
        [currentId]: { ...prev.boards[currentId], bg_color: color || null },
      },
    }));
  };

  const setView = (viewName) => {
    setViewOverride(prev => ({ ...prev, [currentId]: viewName }));
    // Persist on the board itself so embedded board cards on a parent
    // canvas pick up list-mode rendering when their target is a list.
    setLocalState(prev => prev.boards[currentId]
      ? { ...prev, boards: { ...prev.boards, [currentId]: { ...prev.boards[currentId], view: viewName, updated_at: new Date().toISOString() } } }
      : prev);
  };

  const openBoard = (id) => {
    if (boards[id]) { setStack(prev => [...prev, id]); recents.push(id); tourFireRef.current?.({ type: 'cluster_opened', boardId: id }); }
  };
  const goTo = (index) => setStack(prev => prev.slice(0, index + 1));

  const mutators = {
    addCard,
    addCards,
    updateCard,
    updateCards,
    deleteCard: (id) => deleteCards([id]),
    deleteCards,
    duplicateCard: (id) => duplicateCards([id]),
    duplicateCards,
    bringToFront,
    addArrow,
    addFreeArrow,
    deleteArrows,
    addNote,
    addTextLink,
    addImageAt,
    addPdfAt,
    addNewBoard,
    addPalette,
    addDocCard,
    addGrid,
    resizeGridDivider, splitGridCell, mergeGridCell, setGridCellContent, clearGridCellContent,
    setGridTextStyle, pinCellStyle, unpinCellStyle,
    promoteGridToTemplate, linkGridToTemplate, unlinkGrid,
    removeGridDivider, resizeLinkedGrids, graftGridIntoCell,
    stampGridNeighbor, bulkGenerateGrids, setGridSequencePattern,
    addShape,
    addStroke,
    replaceStrokes,
    deleteStroke: (index) => deleteStrokes([index]),
    deleteStrokes,
    clearStrokes: () => updateBoardState(state => ({ ...state, strokes: [] })),
    renameBoardById,
    deleteBoardsById,
    setBoardBgColor,
    undo: () => {},
    redo: () => {},
  };

  // ⌘K / Ctrl-K (and "/" when not typing) — open the global search palette.
  // App.jsx has its own; the local shell had no global keydown handler at all.
  useEffect(() => {
    const onKey = (e) => {
      if (isEditableTarget(e)) return;
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen(o => !o);
      } else if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Reduced command set — the local QA shell has no Settings/Share/Trash modals.
  const localCommands = useMemo(() => [
    { id: 'new-board', label: 'Create cluster', icon: LayoutGrid, keywords: ['new', 'add', 'create', 'cluster', 'board'],
      run: () => { setCurrentSurface('board'); addNewBoard(); } },
    { id: 'new-note', label: 'New note', icon: StickyNote, keywords: ['note', 'text', 'add', 'sticky'],
      available: view !== 'list' && currentSurface === 'board',
      run: () => { setCurrentSurface('board'); addNote(); } },
    { id: 'home', label: 'Go to Home', icon: Home, keywords: ['home', 'graph', 'overview'],
      run: () => setCurrentSurface('home') },
    { id: 'theme', label: 'Toggle theme', icon: tweak.theme === 'dark' ? Sun : Moon, keywords: ['theme', 'dark', 'light', 'mode'],
      run: () => setTweak('theme', tweak.theme === 'dark' ? 'light' : 'dark') },
    { id: 'settings', label: 'Open settings', icon: Settings, keywords: ['settings', 'tweaks', 'preferences'],
      run: () => document.querySelector('.twk-gear')?.click() },
    { id: 'sidebar', label: 'Toggle sidebar', icon: PanelLeftClose, keywords: ['sidebar', 'collapse', 'hide', 'panel'],
      run: () => setTweak('compactSidebar', !tweak.compactSidebar) },
    { id: 'signout', label: 'Exit local QA', icon: LogOut, keywords: ['exit', 'sign out', 'log out', 'logout', 'quit'],
      run: () => signOut?.() },
  ], [view, currentSurface, tweak.theme, tweak.compactSidebar, setTweak, signOut]);

  return (
    <div className={`app ${tweak.compactSidebar ? 'sb-collapsed' : ''}`} data-screen-label={`Local Board - ${currentBoard.name}`}>
      <ShortcutsHost />
      {mobileShell && mobileNavOpen && (
        <div className="sidebar-mobile-backdrop"
             onClick={() => setMobileNavOpen(false)}
             aria-hidden="true" />
      )}
      <aside className={`sidebar${mobileShell && mobileNavOpen ? ' is-mobile-open' : ''}`}>
        {/* Two-tier layout to match real-mode App.jsx — rail (workspaces +
            settings + you) on the left, middle column with nav + boards. */}
        <div className="rail">
          {tweak.compactSidebar ? (
            <button className="rail-toggle" title="Open sidebar (⌘B)"
                    aria-label="Open sidebar"
                    onClick={() => setTweak('compactSidebar', false)}>
              <Icon as={PanelLeftOpen} size={16} />
            </button>
          ) : (
            <div className="rail-brand" title="Soleil">
              <SoleilMark size={18} color="var(--soleil)" glow />
            </div>
          )}
          <div className="rail-ws-list">
            <button className="rail-ws active" title="Local in-memory workspace">L</button>
          </div>
          <div className="rail-foot">
            <button className="rail-icon" title="Settings (⌘.)" aria-label="Settings"
                    onClick={() => document.querySelector('.twk-gear')?.click()}>
              <Icon as={Settings} size={14} />
            </button>
            <button className="rail-avatar" title="Local QA · click to exit"
                    onClick={signOut}>
              L
            </button>
          </div>
        </div>

        <div className="sb-mid">
          <div className="sb-mid-head">
            <span className="sb-mid-title">Local Studio</span>
            <button className="sb-mid-collapse"
                    onClick={() => setTweak('compactSidebar', !tweak.compactSidebar)}
                    title="Collapse sidebar (⌘B)" aria-label="Collapse sidebar">
              <Icon as={PanelLeftClose} size={14} />
            </button>
          </div>

          <button className="sb-search" onClick={() => setPaletteOpen(true)} title="Search (⌘K)">
            <Icon as={Search} size={13} />
            <span>Search…</span>
            <span className="sb-search-kbd">⌘K</span>
          </button>

          <div className={`sb-row ${currentSurface === 'home' ? 'active' : ''}`}
               onClick={() => setCurrentSurface('home')}>
            <Icon as={Home} size={14} />
            <span className="sb-row-label">Home</span>
          </div>
          <div className={`sb-row ${tweak.showMessages ? 'active' : ''}`}
               onClick={() => setTweak('showMessages', !tweak.showMessages)}>
            <Icon as={MessageSquare} size={14} />
            <span className="sb-row-label">Messages</span>
          </div>

          <div className="sb-eyebrow">CLUSTERS</div>
          {stack.map((id, index) => {
            const isActive = index === stack.length - 1 && currentSurface === 'board';
            return (
              <div key={`${id}-${index}`}
                   className={`sb-row sb-row-board ${isActive ? 'active' : ''}`}
                   onClick={() => { goTo(index); setCurrentSurface('board'); }}>
                <span className="sb-dot" style={{ background: isActive ? 'var(--soleil)' : 'var(--ink-3)' }} />
                <span className="sb-row-label">{boards[id]?.name || id}</span>
              </div>
            );
          })}
          {childBoards.map(board => (
            <div key={board.id}
                 className="sb-row sb-row-board"
                 onClick={() => { openBoard(board.id); setCurrentSurface('board'); }}>
              <span className="sb-dot" style={{ background: 'var(--ink-3)' }} />
              <span className="sb-row-label">{board.name}</span>
            </div>
          ))}
          <div className="sb-row sb-row-all" onClick={() => setPickerOpen(true)}>
            <Icon as={MoreHorizontal} size={14} />
            <span className="sb-row-label">All clusters</span>
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div className="tb-left">
            {mobileShell && (
              <button className="tb-icon" title="Open menu" aria-label="Open menu"
                      onClick={() => setMobileNavOpen(true)}>
                <Icon as={PanelLeftOpen} size={16} />
              </button>
            )}
            <div className="crumbs" data-tour="nav">
              {crumbs.map((crumb, index) => (
                <React.Fragment key={`${crumb.id}-${index}`}>
                  {index > 0 && <span className="crumb-sep" aria-hidden="true">›</span>}
                  <span className={`crumb ${index === crumbs.length - 1 ? 'here' : 'clk'}`} onClick={() => goTo(index)}>{crumb.name}</span>
                </React.Fragment>
              ))}
            </div>
          </div>

          <div className="tb-center">
            <div className="view-pill">
              <button className={`view-pill-btn ${view !== 'list' ? 'on' : ''}`} onClick={() => setView('canvas')}>Canvas</button>
              <button className={`view-pill-btn ${view === 'list' ? 'on' : ''}`} onClick={() => setView('list')}>List</button>
            </div>
          </div>

          <div className="tb-right">
            <button className="tb-icon" title="Search (⌘K)" aria-label="Search"
                    onClick={() => setPaletteOpen(true)}>
              <Icon as={Search} size={16} />
            </button>
            <LocalTopbarAddMenu onAddBoard={() => addNewBoard()} onLinkBoard={() => setPickerOpen(true)} />
            <button
              className="tb-icon"
              title="Toggle theme"
              aria-label="Toggle theme"
              onClick={() => setTweak('theme', tweak.theme === 'dark' ? 'light' : 'dark')}
            >
              <Icon as={tweak.theme === 'dark' ? Sun : Moon} size={16} />
            </button>
            <button className="tb-icon" onClick={signOut} title="Exit local QA">
              <Icon as={LogOut} size={16} />
            </button>
          </div>
        </div>

        {currentSurface === 'home' ? (
          <HomeGraph
            workspaceId="local-workspace"
            onNavigate={(target) => {
              setCurrentSurface('board');
              if (target?.kind === 'url') { window.open(target.href, '_blank', 'noopener,noreferrer'); return; }
              if (target?.kind === 'board') setStack([target.id]);
              if (target?.kind === 'card')  setStack([target.boardId]);
            }}
          />
        ) : view === 'canvas' ? (
          <CanvasSurface
            board={currentBoard}
            boards={boards}
            cards={currentState.cards}
            arrows={currentState.arrows}
            strokes={currentState.strokes}
            gridTemplates={currentTemplates}
            gridSequences={currentSequences}
            onOpenBoard={openBoard}
            tweak={tweak}
            depth={stack.length - 1}
            onOpenPicker={() => setPickerOpen(true)}
            onDropInboxItem={dropInboxItem}
            onDropFileImage={({ publicUrl, width, height, x, y }) => addCard({
              id: createId('img'),
              kind: 'image',
              src: publicUrl,
              x,
              y,
              w: width || 240,
              h: height || 180,
            })}
            workspaceId="local-workspace"
            userId={user?.id ?? 'local-user'}
            personalWorkspaceId="local-workspace"
            selectedTool={selectedTool}
            setSelectedTool={setSelectedTool}
            mutators={mutators}
            autoFocusId={autoFocusId}
            clearAutoFocus={() => setAutoFocusId(null)}
            showcaseArm={SHOWCASE_PREVIEW && currentId === ROOT_ID ? 'B' : 'A'}
            autoFrame={!BLANK_SEED}
            useLocalImages
          />
        ) : (
          <ListSurface
            board={currentBoard}
            boards={boards}
            cards={currentState.cards}
            childBoards={childBoards}
            onOpenBoard={openBoard}
            onOpenPicker={() => setPickerOpen(true)}
            onDropInboxItem={dropInboxItem}
            mutators={mutators}
          />
        )}
      </main>

      {/* Boards-only "link a board" picker — command palette in pick mode. */}
      <CommandPalette
        mode="pick"
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        excludeIds={[currentId]}
        workspaceId={null}
        boards={boards}
        rootId={ROOT_ID}
        recents={recents.recents}
        mobileShell={mobileShell}
        placeholder="Search boards to link…"
        onPickBoard={addLink}
      />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        workspaceId={null}
        boards={boards}
        rootId={ROOT_ID}
        recents={recents.recents}
        commands={localCommands}
        mobileShell={mobileShell}
        onOpenBoard={(id) => { setStack([id]); recents.push(id); setCurrentSurface('board'); }}
        onNavigateRef={(ref) => {
          const bid = ref.kind === 'board' ? ref.id : ref.boardId;
          if (bid && boards[bid]) { setStack([bid]); recents.push(bid); setCurrentSurface('board'); }
        }}
      />

      {tweak.showMessages && (
        <div className="msg-panel">
          <div className="msg-panel-head"><span className="t-eyebrow">MESSAGES</span></div>
          <div className="msg-panel-body">
            <div className="msg-empty t-meta">Messaging requires Supabase. Sign in to use it.</div>
          </div>
        </div>
      )}

      <LocalSettingsPanel tweak={tweak} setTweak={setTweak} />

      {ONBOARD_PREVIEW && onboardCoachOpen && currentId === ROOT_ID && currentSurface === 'board' && (
        <OnboardingCoachmark boardId={ROOT_ID} onDismiss={() => setOnboardCoachOpen(false)} arm="B" />
      )}

      {TOUR_DEMO && tour.step && currentSurface === 'board' && (
        <OnboardingTour
          step={tour.step}
          onEvent={(e) => tour.fire(e)}
          onSkip={() => tour.skip()}
          onView={(id) => tour.markView(id)}
        />
      )}

      {mobileShell && (() => {
        const onBoard = currentSurface === 'board' && view === 'canvas'
          && !tweak.showMessages && !pickerOpen && !paletteOpen && !mobileNavOpen;
        return (
        <MobileBottomNav
          showCreate={onBoard}
          createIcon={<Icon as={Plus} size={26} />}
          onCreate={() => {
            setMobileNavOpen(false);
            document.dispatchEvent(new CustomEvent('soleil-mobile-add-card', {
              detail: { boardId: currentBoard?.id },
            }));
          }}
          active={
            onBoard ? null
            : currentSurface === 'home' ? 'home'
            : tweak.showMessages ? 'messages'
            : (paletteOpen || pickerOpen) ? 'search'
            : 'home'
          }
          tabs={[
            { key: 'home',     label: 'Home',     icon: <Icon as={Home} size={20} /> },
            { key: 'search',   label: 'Search',   icon: <Icon as={Search} size={20} /> },
            { key: 'messages', label: 'Messages', icon: <Icon as={MessageSquare} size={20} /> },
            { key: 'settings', label: 'Settings', icon: <Icon as={Settings} size={20} /> },
          ]}
          onChange={(k) => {
            setMobileNavOpen(false);
            if (k === 'home')     { setCurrentSurface('home'); setPaletteOpen(false); setTweak('showMessages', false); }
            if (k === 'search')   { setPaletteOpen(true); setTweak('showMessages', false); }
            if (k === 'messages') { setTweak('showMessages', true); setPaletteOpen(false); }
            if (k === 'settings') {
              setPaletteOpen(false);
              setTweak('showMessages', false);
              document.querySelector('.twk-gear')?.click();
            }
          }}
        />
        );
      })()}
    </div>
  );
}

function LocalTopbarAddMenu({ onAddBoard, onLinkBoard }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
    const onDown = (event) => { if (!event.target.closest?.('.topbar-add')) setOpen(false); };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('mousedown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('mousedown', onDown, true);
    };
  }, [open]);

  return (
    <div className="topbar-add">
      <button className="tb-btn ghost" title="Add" aria-label="Topbar add menu" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        Add
      </button>
      {open && (
        <div className="topbar-add-menu" role="menu" aria-label="Add">
          <button role="menuitem" onClick={() => { setOpen(false); onAddBoard(); }}>Cluster</button>
          <button role="menuitem" onClick={() => { setOpen(false); onLinkBoard(); }}>Linked cluster</button>
        </div>
      )}
    </div>
  );
}

function LocalSettingsPanel({ tweak, setTweak }) {
  return (
    <TweaksPanel title="Cluster settings">
      <TweakSection label="Interface">
        <TweakRadio
          label="Theme"
          value={tweak.theme}
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
          ]}
          onChange={(value) => setTweak('theme', value)}
        />
        <TweakToggle label="Compact sidebar" value={tweak.compactSidebar} onChange={(value) => setTweak('compactSidebar', value)} />
        <TweakToggle label="Show messages" value={tweak.showMessages} onChange={(value) => setTweak('showMessages', value)} />
      </TweakSection>
      <TweakSection label="Canvas">
        <TweakToggle label="Show arrows" value={tweak.showArrows} onChange={(value) => setTweak('showArrows', value)} />
      </TweakSection>
    </TweaksPanel>
  );
}
