import React, { useEffect, useMemo, useState } from 'react';
import { CanvasSurface } from '../components/CanvasSurface.jsx';
import { ListSurface } from '../components/ListSurface.jsx';
import { BoardPicker } from '../components/BoardPicker.jsx';
import { Avatar, SoleilMark } from '../components/primitives.jsx';
import { SoleilWordmark } from '../components/SoleilWordmark.jsx';
import { Icon } from '../components/Icon.jsx';
import { Plus, PanelLeftClose, PanelLeftOpen, Search, LayoutGrid, Inbox as InboxIcon, Sun, Moon, LogOut } from '../lib/icons.js';
import { TweaksPanel, TweakSection, TweakToggle, TweakRadio, useTweaks } from '../components/TweaksPanel.jsx';
import { BOARDS, INBOX_SEED } from '../data.js';

const TWEAK_DEFAULTS = {
  theme: 'dark',
  showArrows: true,
  showCursors: false,
  showInbox: true,
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
  const [initialSession] = useState(loadLocalSession);
  const [{ boards, boardState }, setLocalState] = useState(() => initialSession?.localState || createInitialState());
  const [tweak, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [stack, setStack] = useState(() => initialSession?.stack?.length ? initialSession.stack : [ROOT_ID]);
  const [viewOverride, setViewOverride] = useState(() => initialSession?.viewOverride || {});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedTool, setSelectedTool] = useState('select');
  const [autoFocusId, setAutoFocusId] = useState(null);
  const [inboxItems, setInboxItems] = useState(() => initialSession?.inboxItems || clone(INBOX_SEED));
  const [inboxQuery, setInboxQuery] = useState('');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', tweak.theme);
  }, [tweak.theme]);

  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify({
        localState: { boards, boardState },
        stack,
        viewOverride,
        inboxItems,
      }));
    } catch (_) {}
  }, [boards, boardState, stack, viewOverride, inboxItems]);

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

  const dropInboxItem = (inboxId, card) => {
    addCard(card);
    setInboxItems(items => items.filter(item => item.id !== inboxId));
  };

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
      <aside className="sidebar">
        <div className="sb-brand">
          {tweak.compactSidebar ? (
            <SoleilMark size={22} color="var(--soleil)" glow />
          ) : (
            <SoleilWordmark size="block" />
          )}
          <button
            className="sb-collapse"
            onClick={() => setTweak('compactSidebar', !tweak.compactSidebar)}
            title={tweak.compactSidebar ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <Icon as={tweak.compactSidebar ? PanelLeftOpen : PanelLeftClose} size={16} />
          </button>
        </div>

        {!tweak.compactSidebar && (
          <>
            <div className="sb-group">
              <div className="sb-group-label t-eyebrow">WORKSPACE</div>
            </div>
            <div className="sb-row active" title="Local in-memory workspace">
              <Icon as={LayoutGrid} size={14} />
              <span className="sb-row-label">Local Studio</span>
            </div>
            <div className={`sb-row ${tweak.showInbox ? 'active' : ''}`} onClick={() => setTweak('showInbox', !tweak.showInbox)}>
              <Icon as={InboxIcon} size={14} />
              <span className="sb-row-label">Inbox</span>
              <span className="sb-row-count t-meta">{inboxItems.length}</span>
            </div>
            <div className="sb-row" onClick={() => setPickerOpen(true)}>
              <Icon as={Search} size={14} />
              <span className="sb-row-label">Search boards</span>
            </div>

            <div className="sb-group">
              <div className="sb-group-label t-eyebrow">STACK</div>
            </div>
            {stack.map((id, index) => (
              <div
                key={`${id}-${index}`}
                className={`sb-row sb-row-tree ${index === stack.length - 1 ? 'active' : ''}`}
                style={{ paddingLeft: 16 + index * 12 }}
                onClick={() => goTo(index)}
              >
                <span className="sb-dot" style={{ background: 'var(--ink-3)' }} />
                <span className="sb-row-label">{boards[id]?.name || id}</span>
              </div>
            ))}
            {childBoards.map(board => (
              <div
                key={board.id}
                className="sb-row sb-row-tree"
                style={{ paddingLeft: 16 + stack.length * 12 }}
                onClick={() => openBoard(board.id)}
              >
                <span className="sb-dot" style={{ background: 'var(--ink-3)' }} />
                <span className="sb-row-label">{board.name}</span>
              </div>
            ))}
          </>
        )}

        <div className="sb-foot">
          <Avatar name={user.email || 'Local'} color="var(--soleil)" size={28} />
          {!tweak.compactSidebar && (
            <div className="sb-me">
              <div className="sb-me-name" title={user.email}>Local QA</div>
              <div className="sb-me-org t-meta">in-memory</div>
            </div>
          )}
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div className="tb-left">
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

        {view === 'canvas' ? (
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
            inbox={inboxItems}
            inboxQuery={inboxQuery}
            onInboxQuery={setInboxQuery}
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
            userId={user.id}
            personalWorkspaceId="local-workspace"
            selectedTool={selectedTool}
            setSelectedTool={setSelectedTool}
            mutators={mutators}
            autoFocusId={autoFocusId}
            clearAutoFocus={() => setAutoFocusId(null)}
            onCloseInbox={() => setTweak('showInbox', false)}
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
    </div>
  );
}

function LocalTopbarAddMenu({ onAddBoard, onLinkBoard }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
    const onDown = (event) => { if (!event.target.closest('.topbar-add')) setOpen(false); };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
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
        <TweakToggle label="Show inbox" value={tweak.showInbox} onChange={(value) => setTweak('showInbox', value)} />
      </TweakSection>
      <TweakSection label="Canvas">
        <TweakToggle label="Show arrows" value={tweak.showArrows} onChange={(value) => setTweak('showArrows', value)} />
        <TweakToggle label="Show cursors" value={tweak.showCursors} onChange={(value) => setTweak('showCursors', value)} />
      </TweakSection>
    </TweaksPanel>
  );
}
