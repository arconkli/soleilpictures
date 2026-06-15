import React, { useEffect, useMemo, useState } from 'react';
import { CanvasSurface } from '../components/CanvasSurface.jsx';
import { ListSurface } from '../components/ListSurface.jsx';
import { BoardPicker } from '../components/BoardPicker.jsx';
import { Avatar, SoleilMark } from '../components/primitives.jsx';
import { SoleilWordmark } from '../components/SoleilWordmark.jsx';
import { Icon } from '../components/Icon.jsx';
import { Plus, PanelLeftClose, PanelLeftOpen, Search, LayoutGrid, Inbox as InboxIcon, Sun, Moon, LogOut, Home, MessageSquare, Settings, MoreHorizontal } from '../lib/icons.js';
import { TweaksPanel, TweakSection, TweakToggle, TweakRadio, useTweaks } from '../components/TweaksPanel.jsx';
import { BOARDS } from '../data.js';
import { HomeGraph } from '../components/HomeGraph.jsx';
import { useBreakpoint } from '../hooks/useBreakpoint.js';
import { MobileBottomNav } from '../components/shell/MobileBottomNav.jsx';
import { OnboardingCoachmark } from '../components/OnboardingCoachmark.jsx';
import { getStarterCards, getStarterTutorialCard } from '../lib/onboardingStarter.js';
import { loadBoardSnapshot } from '../lib/boardsApi.js';
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

// Dev-only: ?local=1&showcase=1 renders welcome_showcase arm B locally — it loads
// the REAL "Clusters Logo" board snapshot (you must be signed in at localhost AND
// a member of its workspace, which the owner/admin is) via loadBoardSnapshot,
// decodes it the same way production does (showcaseClone), and shows it on the
// root with the "Clear & try it yourself" banner. Images presign via your session.
const SHOWCASE_PREVIEW = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('showcase') === '1';
const SHOWCASE_SOURCE_BOARD_ID = 'ebf42869-d19f-4b86-8659-763b082095c8';

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
  // Mirror the real seed (App.jsx): a tutorial "Ideas" child board + its mirror
  // card, so the preview shows the FULL first-run layout (notes + a real board to
  // drag into) and the drag-to-nest gesture can be exercised on a phone emulator.
  // A kind:'board' card needs a matching boards-map entry or it renders as an
  // orphan — hence both the board row and the card.
  const IDEAS_ID = 'local-ideas';
  // Apollo 11's Eagle touched down 1969-07-20 20:17 UTC. A deliberate, fun
  // placeholder date for the demo "Ideas" board — the board card formats anything
  // older than ~30 days as a calendar date, so the tile reads "Jul 20, 1969".
  const MOON_LANDING = '1969-07-20T20:17:00.000Z';
  return {
    boards: {
      [ROOT_ID]: {
        id: ROOT_ID, name: 'Studio', view: 'canvas',
        workspace_id: 'local-workspace', parent_board_id: null,
        created_at: new Date(0).toISOString(),
      },
      [IDEAS_ID]: {
        id: IDEAS_ID, name: 'Ideas', view: 'canvas',
        workspace_id: 'local-workspace', parent_board_id: ROOT_ID,
        created_at: MOON_LANDING,
      },
    },
    boardState: {
      [ROOT_ID]: {
        cards: [...clone(getStarterCards()), clone(getStarterTutorialCard(IDEAS_ID))],
        arrows: [], strokes: [],
      },
      [IDEAS_ID]: { cards: [], arrows: [], strokes: [] },
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const { isPhone } = useBreakpoint();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  useEffect(() => { if (!isPhone) setMobileNavOpen(false); }, [isPhone]);
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
        const snap = await loadBoardSnapshot(SHOWCASE_SOURCE_BOARD_ID);
        const cards = decodeShowcaseCards(snap);
        if (!cancelled && cards.length) {
          setLocalState((prev) => ({
            ...prev,
            boardState: { ...prev.boardState, [ROOT_ID]: { cards, arrows: [], strokes: [] } },
          }));
        } else if (!cards.length) {
          console.warn('[showcase preview] no cards — sign in at localhost as a workspace member first');
        }
      } catch (e) {
        console.warn('[showcase preview] could not load the Clusters Logo board', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (ONBOARD_PREVIEW || SHOWCASE_PREVIEW) return;   // preview is throwaway — never pollute the saved local session
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
  const view = viewOverride[currentId] || currentBoard.view || 'canvas';
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
    const name = 'Untitled board';
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
      x: Math.max(8, Math.round((clickPos?.x ?? 200) - w / 2)),
      y: Math.max(8, Math.round((clickPos?.y ?? 180) - h / 2)),
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
    const w = 280;
    const h = 130;
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
      label: 'LOCAL IMAGE PLACEHOLDER',
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
    if (boards[id]) setStack(prev => [...prev, id]);
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
    addNewBoard,
    addPalette,
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

  return (
    <div className={`app ${tweak.compactSidebar ? 'sb-collapsed' : ''}`} data-screen-label={`Local Board - ${currentBoard.name}`}>
      <ShortcutsHost />
      {isPhone && mobileNavOpen && (
        <div className="sidebar-mobile-backdrop"
             onClick={() => setMobileNavOpen(false)}
             aria-hidden="true" />
      )}
      <aside className={`sidebar${isPhone && mobileNavOpen ? ' is-mobile-open' : ''}`}>
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

          <button className="sb-search" onClick={() => setPickerOpen(true)} title="Search boards">
            <Icon as={Search} size={13} />
            <span>Search boards…</span>
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

          <div className="sb-eyebrow">BOARDS</div>
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
            <span className="sb-row-label">All boards</span>
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div className="tb-left">
            {isPhone && (
              <button className="tb-icon" title="Open menu" aria-label="Open menu"
                      onClick={() => setMobileNavOpen(true)}>
                <Icon as={PanelLeftOpen} size={16} />
              </button>
            )}
            <div className="crumbs">
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

      <BoardPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        excludeIds={[currentId]}
        boards={boards}
        rootId={ROOT_ID}
        onPick={addLink}
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
        <OnboardingCoachmark boardId={ROOT_ID} onDismiss={() => setOnboardCoachOpen(false)} />
      )}

      {isPhone && (
        <MobileBottomNav
          active={
            currentSurface === 'home' ? 'home'
            : tweak.showMessages ? 'messages'
            : pickerOpen ? 'search'
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
            if (k === 'home')     { setCurrentSurface('home'); setPickerOpen(false); setTweak('showMessages', false); }
            if (k === 'search')   { setPickerOpen(true); setTweak('showMessages', false); }
            if (k === 'messages') { setTweak('showMessages', true); setPickerOpen(false); }
            if (k === 'settings') {
              setPickerOpen(false);
              setTweak('showMessages', false);
              document.querySelector('.twk-gear')?.click();
            }
          }}
        />
      )}
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
          <button role="menuitem" onClick={() => { setOpen(false); onAddBoard(); }}>Board</button>
          <button role="menuitem" onClick={() => { setOpen(false); onLinkBoard(); }}>Linked board</button>
        </div>
      )}
    </div>
  );
}

function LocalSettingsPanel({ tweak, setTweak }) {
  return (
    <TweaksPanel title="Board settings">
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
