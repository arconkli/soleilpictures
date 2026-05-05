// App.jsx — live data via Supabase + Yjs.
// Postgres is the source of truth for board metadata + hierarchy
// (parent_board_id). Each board's cards/arrows live in a Y.Doc whose
// snapshot is persisted to board_state.

import React, { useState, useEffect, useMemo } from 'react';
import { CanvasSurface } from './components/CanvasSurface.jsx';
import { ListSurface } from './components/ListSurface.jsx';
import { DocSurface } from './components/DocSurface.jsx';
import { BoardPicker } from './components/BoardPicker.jsx';
import { Avatar, SoleilMark } from './components/primitives.jsx';
import { SoleilWordmark } from './components/SoleilWordmark.jsx';
import { Icon } from './components/Icon.jsx';
import { Plus, PanelLeftClose, PanelLeftOpen, Search, LayoutGrid, Inbox as InboxIcon, Settings, Share2, Sun, Moon, History, Columns2, LogOut, Undo, Redo, Home } from './lib/icons.js';
import { PresenceStack } from './components/PresenceStack.jsx';
import { TweaksPanel, TweakSection, TweakToggle, TweakRadio, useTweaks } from './components/TweaksPanel.jsx';
import { useAuth } from './auth/AuthGate.jsx';
import { useWorkspace } from './hooks/useWorkspace.js';
import { useAllWorkspaces } from './hooks/useAllWorkspaces.js';
import { useBoardList } from './hooks/useBoardList.js';
import { useYBoard } from './hooks/useYBoard.js';
import { useInbox } from './hooks/useInbox.js';
import { LocalBoardsApp } from './local/LocalBoardsApp.jsx';
import { isLocalQaMode } from './lib/localMode.js';
import { isSupabaseConfigured, supabase } from './lib/supabase.js';
import { createBoard, deleteBoard, renameBoard, getRootBoard, createWorkspace, loadBoardSnapshot, saveBoardSnapshot, updateBoardMeta } from './lib/boardsApi.js';
import * as Y from 'yjs';
import { b64ToBytes } from './lib/yhelpers.js';
import { cardToYMap } from './lib/yhelpers.js';
import { BOARD_REF_MIME, cardToInboxItem } from './lib/inbox.js';
import { initCardDocStore } from './lib/docState.js';
import { uploadImage } from './lib/uploads.js';
import { HistoryModal } from './components/HistoryModal.jsx';
import { useFeedback } from './components/AppFeedback.jsx';

const TWEAK_DEFAULTS = {
  theme: 'dark',
  showArrows: true,
  showInbox: true,
  compactSidebar: false,
};

const SESSION_PREFIX = 'soleil.boards.session.';

function readSession(key) {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function writeSession(key, value) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
}

export function App() {
  const { user, signOut } = useAuth();
  if (isLocalQaMode() || !isSupabaseConfigured) return <LocalBoardsApp user={user} signOut={signOut} />;

  const { loading: wsLoading, workspace: personalWorkspace, rootBoard: personalRoot, error: wsError } = useWorkspace();
  const { workspaces, refresh: refreshWorkspaces } = useAllWorkspaces(user);

  const [tweak, setTweak] = useTweaks(TWEAK_DEFAULTS);
  useEffect(() => { document.documentElement.setAttribute('data-theme', tweak.theme); }, [tweak.theme]);

  // Active workspace state — defaults to the user's personal once bootstrap is loaded.
  const workspaceSessionKey = `${SESSION_PREFIX}${user.id}.workspace`;
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(() => readSession(workspaceSessionKey)?.activeWorkspaceId || null);
  useEffect(() => {
    if (!activeWorkspaceId && personalWorkspace) setActiveWorkspaceId(personalWorkspace.id);
  }, [personalWorkspace, activeWorkspaceId]);
  useEffect(() => {
    if (activeWorkspaceId) writeSession(workspaceSessionKey, { activeWorkspaceId });
  }, [workspaceSessionKey, activeWorkspaceId]);

  // Resolve active workspace + its root board.
  const activeWorkspace = activeWorkspaceId
    ? (workspaces.find(w => w.id === activeWorkspaceId) || personalWorkspace)
    : personalWorkspace;

  const [activeRoot, setActiveRoot] = useState(null);
  useEffect(() => {
    if (!activeWorkspace) { setActiveRoot(null); return; }
    if (personalWorkspace && activeWorkspace.id === personalWorkspace.id) {
      setActiveRoot(personalRoot);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await getRootBoard(activeWorkspace.id);
        if (!cancelled) setActiveRoot(r);
      } catch (e) { console.error('getRootBoard failed', e); }
    })();
    return () => { cancelled = true; };
  }, [activeWorkspace?.id, personalWorkspace?.id, personalRoot?.id]);

  if (wsError) return <FullScreenError error={wsError} signOut={signOut} />;
  if (wsLoading || !activeWorkspace || !activeRoot) return <LoadingShell />;

  return (
    <Workspace
      key={activeWorkspace.id}
      user={user}
      signOut={signOut}
      workspace={activeWorkspace}
      rootBoard={activeRoot}
      workspaces={workspaces}
      onSwitchWorkspace={setActiveWorkspaceId}
      onWorkspacesChanged={refreshWorkspaces}
      personalWorkspaceId={personalWorkspace?.id}
      tweak={tweak}
      setTweak={setTweak}
    />
  );
}

function Workspace({ user, signOut, workspace, rootBoard, workspaces, onSwitchWorkspace, onWorkspacesChanged, personalWorkspaceId, tweak, setTweak }) {
  const { boards, loading: boardsLoading, refresh: refreshBoards } = useBoardList(workspace.id);
  const inbox = useInbox(workspace.id, user.id);
  const feedback = useFeedback();
  const sessionKey = `${SESSION_PREFIX}${user.id}.${workspace.id}`;
  const [initialSession] = useState(() => readSession(sessionKey));

  const [stack, setStack] = useState(() => initialSession?.stack?.length ? initialSession.stack : [rootBoard.id]);
  const [viewOverride, setViewOverride] = useState(() => initialSession?.viewOverride || {});
  const [pickerOpen, setPickerOpen] = useState(false);

  const currentId = stack[stack.length - 1];
  const currentBoard = boards[currentId] || rootBoard;
  const view = viewOverride[currentId] || currentBoard.view || 'canvas';

  // Pop the stack if the current board has been deleted from under us.
  useEffect(() => {
    if (boardsLoading) return;
    if (!boards[currentId]) {
      setStack(s => s.length > 1 ? s.slice(0, -1) : [rootBoard.id]);
    }
  }, [boards, boardsLoading, currentId, rootBoard.id]);

  const userInfo = {
    id: user.id,
    name: user.user_metadata?.full_name || user.email?.split('@')[0],
    email: user.email,
  };
  const yb = useYBoard(currentBoard.id, user.id, userInfo);
  const currentYDoc = yb.ready && yb.boardId === currentBoard.id ? yb.ydoc : null;

  // Side-by-side: when set, the workspace splits 50/50 with a draggable
  // divider. The split pane runs its own Y.Doc / surface independently.
  const [splitId, setSplitIdState] = useState(() => initialSession?.splitId || null);
  const setSplitId = (id) => setSplitIdState(id);
  const splitBoard = splitId ? (boards[splitId] || null) : null;
  const splitView = splitBoard ? (viewOverride[splitId] || splitBoard.view || 'canvas') : null;
  const splitYb = useYBoard(splitId, user.id, userInfo);
  const splitYDoc = splitYb.ready && splitYb.boardId === splitId ? splitYb.ydoc : null;
  const [splitPickerOpen, setSplitPickerOpen] = useState(false);
  const [splitRatio, setSplitRatio] = useState(() => initialSession?.splitRatio || 0.5);
  // Persist split state.
  useEffect(() => {
    writeSession(sessionKey, { stack, viewOverride, splitId, splitRatio });
  }, [sessionKey, stack, viewOverride, splitId, splitRatio]);
  // If the split target gets deleted out from under us, drop the split.
  useEffect(() => {
    if (splitId && !boardsLoading && !boards[splitId]) setSplitIdState(null);
  }, [splitId, boards, boardsLoading]);
  const currentUndoManager = yb.ready && yb.boardId === currentBoard.id ? yb.undoManager : null;
  const [historyOpen, setHistoryOpen] = useState(false);

  const openBoard = (id) => setStack(s => [...s, id]);
  const goTo = (i) => setStack(s => s.slice(0, i + 1));
  // Toggling the view in the topbar persists to the boards table so the
  // change survives reloads AND propagates to anywhere this board appears
  // as a card on a parent canvas (where we render list-mode boards as an
  // inline clickable item list instead of a thumbnail).
  const setView = (v) => {
    setViewOverride(o => ({ ...o, [currentId]: v }));
    updateBoardMeta(currentId, { view: v })
      .then(() => refreshBoards())
      .catch((e) => console.warn('persist board view failed', e));
  };

  // Children of the current board (used by sidebar + ListSurface).
  const childBoards = useMemo(
    () => Object.values(boards).filter(b => b.parent_board_id === currentId),
    [boards, currentId]
  );

  // ── Per-pane mutators ─────────────────────────────────────────────────────
  // `buildMutators` returns the full mutator surface for a single board's
  // Y.Doc. We call it twice — once for the main pane, once for the split —
  // so canvas edits on either side are fully wired (instead of the split
  // being read-only). Every Y.Doc write is wrapped in `ydoc.transact(fn,
  // 'local')` so the per-pane UndoManager (which only tracks origin='local')
  // captures user actions.
  const buildMutators = ({ ydoc, boardId, undoManager }) => {
    if (!ydoc) return {};
    const cardsMap = () => ydoc.getMap('cards');
    const arrowsArr = () => ydoc.getArray('arrows');
    const strokesArr = () => ydoc.getArray('strokes');

    const nextZ = () => {
      const m = cardsMap(); if (!m) return 1;
      let max = 0; m.forEach(ym => { const z = ym.get('z') || 0; if (z > max) max = z; });
      return max + 1;
    };

    const addCard = (card) => {
      const m = cardsMap(); if (!m) return;
      ydoc.transact(() => {
        const c = { z: nextZ(), ...card };
        m.set(c.id, cardToYMap(c));
      }, 'local');
    };

    const addCards = (cardsToAdd) => {
      const m = cardsMap(); if (!m || !cardsToAdd?.length) return;
      ydoc.transact(() => {
        let z = nextZ();
        for (const card of cardsToAdd) {
          const c = { z: z++, ...card };
          m.set(c.id, cardToYMap(c));
        }
      }, 'local');
    };

    const updateCard = (cardId, patch) => {
      const m = cardsMap(); if (!m) return;
      const ym = m.get(cardId); if (!ym) return;
      ydoc.transact(() => {
        for (const [k, v] of Object.entries(patch)) ym.set(k, v);
      }, 'local');
    };

    const updateCards = (updates) => {
      const m = cardsMap(); if (!m || !updates?.length) return;
      ydoc.transact(() => {
        for (const { id, patch } of updates) {
          const ym = m.get(id); if (!ym) continue;
          for (const [k, v] of Object.entries(patch)) ym.set(k, v);
        }
      }, 'local');
    };

    const deleteCards = async (ids) => {
      if (!ids?.length) return;
      const m = cardsMap(); if (!m) return;
      const idSet = new Set(ids);
      const boardIdsToCascade = [];
      ids.forEach(id => {
        const ym = m.get(id);
        if (ym && ym.get('kind') === 'board') boardIdsToCascade.push(id);
      });
      for (const bid of boardIdsToCascade) {
        try { await deleteBoard(bid); }
        catch (e) { console.error('deleteBoard failed', e); }
      }
      if (boardIdsToCascade.length) await refreshBoards();
      const a = arrowsArr();
      ydoc.transact(() => {
        idSet.forEach(id => m.delete(id));
        if (a) {
          for (let i = a.length - 1; i >= 0; i--) {
            const ar = a.get(i);
            const fromId = ar?.from ?? ar?.get?.('from');
            const toId   = ar?.to   ?? ar?.get?.('to');
            if (idSet.has(fromId) || idSet.has(toId)) a.delete(i, 1);
          }
        }
      }, 'local');
    };
    const deleteCard = (cardId) => deleteCards([cardId]);

    const duplicateCards = (ids) => {
      const m = cardsMap(); if (!m || !ids?.length) return [];
      const newIds = [];
      ydoc.transact(() => {
        let z = nextZ();
        for (const id of ids) {
          const ym = m.get(id); if (!ym) continue;
          const obj = {};
          ym.forEach((v, k) => { obj[k] = v; });
          if (obj.kind === 'board') continue;
          obj.id = `${obj.kind || 'card'}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
          obj.x = (obj.x || 0) + 24;
          obj.y = (obj.y || 0) + 24;
          obj.z = z++;
          m.set(obj.id, cardToYMap(obj));
          newIds.push(obj.id);
        }
      }, 'local');
      return newIds;
    };
    const duplicateCard = (cardId) => duplicateCards([cardId]);

    const bringToFront = (cardId) => updateCard(cardId, { z: nextZ() });

    const addArrow = (fromId, toId, opts = {}) => {
      if (!fromId || !toId || fromId === toId) return;
      const a = arrowsArr(); if (!a) return;
      ydoc.transact(() => { a.push([{ from: fromId, to: toId, ...opts }]); }, 'local');
    };

    const addStroke = (stroke) => {
      const s = strokesArr(); if (!s) return;
      ydoc.transact(() => { s.push([stroke]); }, 'local');
    };
    const clearStrokes = () => {
      const s = strokesArr(); if (!s || s.length === 0) return;
      ydoc.transact(() => { s.delete(0, s.length); }, 'local');
    };
    const replaceStrokes = (nextStrokes) => {
      const s = strokesArr(); if (!s) return;
      ydoc.transact(() => {
        if (s.length) s.delete(0, s.length);
        if (nextStrokes?.length) s.push(nextStrokes);
      }, 'local');
    };
    const deleteStrokes = (indices) => {
      const s = strokesArr(); if (!s || !indices?.length) return;
      const sorted = [...indices].sort((a, b) => b - a);
      ydoc.transact(() => {
        for (const i of sorted) if (i >= 0 && i < s.length) s.delete(i, 1);
      }, 'local');
    };
    const deleteStroke = (i) => deleteStrokes([i]);

    const addFreeArrow = (from, to, opts = {}) => {
      const a = arrowsArr(); if (!a) return;
      ydoc.transact(() => { a.push([{ from, to, ...opts }]); }, 'local');
    };
    const deleteArrows = (indices) => {
      const a = arrowsArr(); if (!a || !indices?.length) return;
      const sorted = [...indices].sort((x, y) => y - x);
      ydoc.transact(() => {
        for (const i of sorted) if (i >= 0 && i < a.length) a.delete(i, 1);
      }, 'local');
    };

    const addShape = (clickPos = null, opts = {}) => {
      const w = opts.w || 160, h = opts.h || 100;
      const x = clickPos ? Math.round(clickPos.x - w/2) : 60;
      const y = clickPos ? Math.round(clickPos.y - h/2) : 60;
      addCard({
        id: `shape-${Date.now()}`, kind: 'shape',
        shape: opts.shape || 'rect',
        stroke: opts.stroke || '#f5f5f6',
        fill: opts.fill || 'transparent',
        strokeWidth: opts.strokeWidth || 2,
        dash: opts.dash || 'solid',
        x: Math.max(8, x), y: Math.max(8, y), w, h,
      });
    };

    const addPalette = (clickPos = null) => {
      const w = 280, h = 130;
      const x = clickPos ? Math.round(clickPos.x - w/2) : 60;
      const y = clickPos ? Math.round(clickPos.y - h/2) : 60;
      const id = `pal-${Date.now()}`;
      addCard({
        id, kind: 'palette', title: 'Palette',
        swatches: [
          { name: 'Color', hex: '#3b82f6' },
          { name: 'Color', hex: '#10b981' },
        ],
        x: Math.max(8, x), y: Math.max(8, y), w, h,
      });
      setAutoFocusId(id);
    };

    const addDocCard = (clickPos = null) => {
      const w = 320, h = 240;
      const x = clickPos ? Math.round(clickPos.x - w/2) : 60;
      const y = clickPos ? Math.round(clickPos.y - h/2) : 60;
      const id = `doc-${Date.now()}`;
      addCard({ id, kind: 'doc', title: 'Untitled doc',
                x: Math.max(8, x), y: Math.max(8, y), w, h });
      // Initialize the per-card doc store (pages, content, bookmarks, comments).
      const m = cardsMap();
      const cardYM = m?.get(id);
      if (cardYM) initCardDocStore(ydoc, cardYM);
      setAutoFocusId(id); // signals "open the doc editor immediately"
    };

    const setBoardBgColor = async (color) => {
      try {
        await updateBoardMeta(boardId, { bg_color: color || null });
        await refreshBoards();
      } catch (e) {
        console.error('setBoardBgColor failed', e);
        feedback.toast({ type: 'error', message: 'Could not set background: ' + (e.message || e) });
      }
    };

    const addNote = (clickPos = null) => {
      // Sticky-note feel: warm yellow, square-ish, dark text. Color picker
      // in the rich-text bar still lets users repaint or go transparent.
      const w = 200, h = 200;
      const x = clickPos ? Math.round(clickPos.x - w/2) : 60;
      const y = clickPos ? Math.round(clickPos.y - h/2) : 60;
      const id = `note-${Date.now()}`;
      addCard({
        id, kind: 'note', html: '',
        bgColor: '#fde68a',
        textColor: '#1a1300',
        x: Math.max(8, x), y: Math.max(8, y), w, h,
      });
      setAutoFocusId(id);
    };
    const addTextLink = addNote; // identical for now
    const dropImageBlob = ({ publicUrl, width, height, x, y }) => {
      let w = 240, h = 200;
      if (width && height) {
        const ar = width / height;
        if (ar >= 1) { w = 280; h = Math.round(280 / ar); }
        else { h = 240; w = Math.round(240 * ar); }
        h = Math.max(80, Math.min(360, h));
        w = Math.max(80, Math.min(420, w));
      }
      addCard({
        id: `img-${Date.now()}`, kind: 'image', src: publicUrl,
        x: Math.max(8, Math.round((x ?? 200) - w / 2)),
        y: Math.max(8, Math.round((y ?? 200) - h / 2)),
        w, h,
      });
    };
    const addImageAt = (clickPos) => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*';
      input.onchange = async () => {
        const f = input.files?.[0]; if (!f) return;
        try {
          const up = await uploadImage({ file: f, workspaceId: workspace.id, userId: user.id });
          dropImageBlob({ ...up, x: clickPos?.x, y: clickPos?.y });
        } catch (e) {
          console.error(e);
          feedback.toast({ type: 'error', message: 'Image upload failed: ' + (e.message || e) });
        }
      };
      input.click();
    };

    const addNewBoard = async (clickPos = null, opts = {}) => {
      const view = opts.view || 'canvas';
      const defaultName = view === 'doc' ? 'Untitled doc'
                        : view === 'list' ? 'Untitled list'
                        : 'Untitled board';
      try {
        const b = await createBoard({
          workspaceId: workspace.id,
          parentBoardId: boardId,
          name: defaultName, view, userId: user.id,
        });
        const w = 280, h = 220;
        const x = clickPos ? Math.round(clickPos.x - w/2) : 60 + Math.floor(Math.random() * 600);
        const y = clickPos ? Math.round(clickPos.y - h/2) : 60 + Math.floor(Math.random() * 200);
        addCard({ id: b.id, kind: 'board', x: Math.max(8, x), y: Math.max(8, y), w, h });
        await refreshBoards();
        setAutoFocusId(b.id);
      } catch (e) {
        console.error('createBoard failed', e);
        feedback.toast({ type: 'error', message: 'Could not create board: ' + (e.message || e) });
      }
    };
    const addNewDoc = (clickPos = null) => addNewBoard(clickPos, { view: 'doc' });

    const undo = () => undoManager?.undo();
    const redo = () => undoManager?.redo();

    return {
      updateCard, updateCards, deleteCard, deleteCards,
      duplicateCard, duplicateCards, addCard, addCards, bringToFront,
      addArrow, addFreeArrow, deleteArrows,
      addNote, addTextLink, addImageAt, addNewBoard, addNewDoc, addPalette,
      addDocCard,
      addShape, addStroke, replaceStrokes, deleteStroke, deleteStrokes, clearStrokes,
      setBoardBgColor,
      // Workspace-scoped mutators (rename, delete, clone) close over outer
      // scope and are filled in below since they don't need ydoc.
      undo, redo,
      // Internal helper exposed so addLink / dropInboxItem / dropFileImage
      // (which sit at parent scope and need to know which pane they target)
      // can drop a card directly without re-implementing addCard.
      _addCardRaw: addCard,
      _dropImageBlob: dropImageBlob,
    };
  };

  // Build mutator sets for both panes. useMemo so they stay stable across
  // re-renders unless their bound Y.Doc / boardId changes.
  const mainMutators = useMemo(
    () => buildMutators({ ydoc: currentYDoc, boardId: currentId, undoManager: yb.undoManager }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentYDoc, currentId, yb.undoManager]
  );
  const splitMutators = useMemo(
    () => buildMutators({ ydoc: splitYDoc, boardId: splitId, undoManager: splitYb.undoManager }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [splitYDoc, splitId, splitYb.undoManager]
  );

  // ── Postgres board rename ─────────────────────────────────────────────────
  const renameBoardById = async (boardId, name) => {
    if (!name || !name.trim()) return;
    try {
      await renameBoard(boardId, name.trim());
      await refreshBoards();
    } catch (e) {
      console.error('renameBoard failed', e);
      feedback.toast({ type: 'error', message: 'Could not rename: ' + (e.message || e) });
    }
  };

  // Direct postgres delete for boards by id (used by ListSurface where the
  // canvas card may not exist in the current Y.Doc).
  const deleteBoardsById = async (ids) => {
    if (!ids?.length) return;
    for (const id of ids) {
      try { await deleteBoard(id); } catch (e) { console.error(e); }
    }
    await refreshBoards();
    // Also strip any stale 'board' canvas cards in the current Y.Doc.
    if (currentYDoc) {
      const m = currentYDoc.getMap('cards');
      const idSet = new Set(ids);
      currentYDoc.transact(() => {
        idSet.forEach(id => { if (m.has(id)) m.delete(id); });
      }, 'local');
    }
  };

  // ── Reconcile drift: every child board must have a canvas card on the
  // current board. Auto-add missing ones at default positions. Idempotent.
  useEffect(() => {
    if (!currentYDoc || boardsLoading) return;
    const placed = new Set();
    yb.cards.forEach(c => { if (c.kind === 'board') placed.add(c.id); });
    const missing = Object.values(boards).filter(b =>
      b.parent_board_id === currentId && !placed.has(b.id)
    );
    if (missing.length === 0) return;
    const w = 280, h = 200;
    // Find a clean spot — append to the right of existing board cards.
    const boardCards = yb.cards.filter(c => c.kind === 'board');
    const maxRight = boardCards.reduce((m, c) => Math.max(m, c.x + c.w), 60);
    const baseY = 60;
    const newCards = missing.map((b, i) => ({
      id: b.id, kind: 'board',
      x: maxRight + 20 + i * (w + 20),
      y: baseY,
      w, h,
    }));
    mainMutators.addCards?.(newCards);
  }, [currentYDoc, yb.cards, boards, currentId, boardsLoading, mainMutators]);

  // ── New workspace ────────────────────────────────────────────────────────
  const addNewWorkspace = async () => {
    const name = await feedback.prompt({
      title: 'New workspace',
      label: 'Workspace name',
      placeholder: 'Soleil',
      confirmLabel: 'Create workspace',
    });
    if (!name?.trim()) return;
    try {
      const ws = await createWorkspace({ name: name.trim(), userId: user.id });
      // Create a Studio root board for it.
      await createBoard({
        workspaceId: ws.id, parentBoardId: null,
        name: 'Studio', view: 'canvas', userId: user.id,
      });
      await onWorkspacesChanged?.();
      onSwitchWorkspace?.(ws.id);
    } catch (e) {
      console.error('addNewWorkspace failed', e);
      feedback.toast({ type: 'error', message: 'Could not create workspace: ' + (e.message || e) });
    }
  };

  // ── Clone a board (and its Y.Doc state) into my personal workspace ───────
  const cloneBoardToPersonal = async (sourceBoardId) => {
    if (!personalWorkspaceId) {
      feedback.toast({ type: 'error', message: 'No personal workspace.' });
      return;
    }
    const sourceBoard = boards[sourceBoardId];
    if (!sourceBoard) return;
    if (sourceBoard.workspace_id === personalWorkspaceId) {
      feedback.toast({ type: 'info', message: 'This board is already in your workspace.' });
      return;
    }
    const ok = await feedback.confirm({
      title: 'Copy board',
      message: `Copy "${sourceBoard.name}" to your personal workspace?`,
      confirmLabel: 'Copy board',
    });
    if (!ok) return;
    try {
      // Create the new board under personal root
      const personalRootBoard = await getRootBoard(personalWorkspaceId);
      const newBoard = await createBoard({
        workspaceId: personalWorkspaceId,
        parentBoardId: personalRootBoard?.id || null,
        name: sourceBoard.name + ' (copy)',
        view: sourceBoard.view, cover: sourceBoard.cover, meta: sourceBoard.meta,
        userId: user.id,
      });
      // Clone the Y.Doc snapshot
      const snap = await loadBoardSnapshot(sourceBoardId);
      if (snap) {
        const tmp = new Y.Doc();
        Y.applyUpdate(tmp, b64ToBytes(snap));
        await saveBoardSnapshot(newBoard.id, tmp);
        tmp.destroy();
      }
      await onWorkspacesChanged?.();
      feedback.toast({ type: 'success', message: 'Copied to your personal workspace.' });
    } catch (e) {
      console.error('cloneBoardToPersonal failed', e);
      feedback.toast({ type: 'error', message: 'Copy failed: ' + (e.message || e) });
    }
  };

  // ── Workspace sharing ─────────────────────────────────────────────────────
  const inviteToWorkspace = async () => {
    const email = await feedback.prompt({
      title: 'Invite to workspace',
      message: 'They need to sign up first, then you can invite them here.',
      label: 'Email address',
      placeholder: 'teammate@soleilpictures.com',
      confirmLabel: 'Send invite',
    });
    if (!email || !email.trim()) return;
    try {
      const { data: uid, error } = await supabase.rpc('user_id_by_email', { p_email: email.trim() });
      if (error) throw error;
      if (!uid) {
        feedback.toast({ type: 'error', message: `No user with email "${email.trim()}". They need to sign up first.` });
        return;
      }
      if (uid === user.id) { feedback.toast({ type: 'info', message: "That's you." }); return; }
      const { error: insErr } = await supabase
        .from('workspace_members')
        .insert({ workspace_id: workspace.id, user_id: uid, role: 'editor' });
      if (insErr) {
        if (insErr.code === '23505') feedback.toast({ type: 'info', message: `${email} is already a member of this workspace.` });
        else throw insErr;
        return;
      }
      feedback.toast({ type: 'success', message: `Invited ${email} to "${workspace.name}".` });
    } catch (e) {
      console.error('invite failed', e);
      feedback.toast({ type: 'error', message: 'Invite failed: ' + (e.message || e) });
    }
  };

  const addLink = (targetBoard) => {
    mainMutators._addCardRaw?.({
      id: `xlink-${Date.now()}`,
      kind: 'boardlink',
      target: targetBoard.id,
      x: 1080, y: 80 + Math.floor(Math.random() * 200), w: 220, h: 160,
    });
  };

  // Pane-aware inbox & file-drop handlers — so dragging into the split pane
  // creates the card on the SPLIT board, not the main one.
  const dropInboxItemFor = (muts) => (inboxId, card) => {
    muts._addCardRaw?.(card);
    inbox.remove(inboxId);
  };
  const dropFileImageFor = (muts) => (info) => muts._dropImageBlob?.(info);
  const dropInboxItem = dropInboxItemFor(mainMutators); // back-compat alias
  const dropFileImage = dropFileImageFor(mainMutators);

  // ── Auto-focus on new card creation ───────────────────────────────────────
  const [autoFocusId, setAutoFocusId] = useState(null);
  const clearAutoFocus = () => setAutoFocusId(null);

  // Compose final mutator sets that include the workspace-scoped helpers
  // (renameBoardById / deleteBoardsById / cloneBoardToPersonal). They live
  // outside the factory because they don't need a Y.Doc.
  const mainMutatorsFull = useMemo(
    () => ({ ...mainMutators, renameBoardById, deleteBoardsById, cloneBoardToPersonal }),
    [mainMutators]
  );
  const splitMutatorsFull = useMemo(
    () => ({ ...splitMutators, renameBoardById, deleteBoardsById, cloneBoardToPersonal }),
    [splitMutators]
  );
  // Back-compat alias — older code still refers to `mutators`.
  const mutators = mainMutatorsFull;

  const [currentSurface, setCurrentSurface] = useState('board');
  //   'board' = existing canvas/doc surface; 'home' = HomeGraph

  const [selectedTool, setSelectedTool] = useState('select');
  // Reset to the select tool every time the active board changes — otherwise
  // a leftover draw/shape/arrow tool from the previous board carries over and
  // makes the canvas feel "stuck" in a draw mode the user didn't reselect.
  useEffect(() => { setSelectedTool('select'); }, [currentId]);

  // Doc embeds dispatch a global "soleil-open-embed" event when clicked.
  // Translate that into a board-open here.
  useEffect(() => {
    const onOpen = (e) => {
      const { boardId } = e.detail || {};
      if (boardId) openBoard(boardId);
    };
    document.addEventListener('soleil-open-embed', onOpen);
    return () => document.removeEventListener('soleil-open-embed', onOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drop-card-onto-inbox: convert each dragged card into an inbox item +
  // tell the source pane to delete the original (move semantics).
  useEffect(() => {
    const onCardToInbox = async (e) => {
      const { sourceBoardId, cards } = e.detail || {};
      if (!cards?.length) return;
      const items = cards.map(cardToInboxItem).filter(Boolean);
      const accepted = [];
      for (let i = 0; i < items.length; i++) {
        try {
          await inbox.add(items[i]);
          accepted.push(cards[i].id);
        } catch (err) { console.warn('inbox add failed', err); }
      }
      if (accepted.length) {
        document.dispatchEvent(new CustomEvent('soleil-card-transferred', {
          detail: { sourceBoardId, cardIds: accepted },
        }));
        feedback.toast({ type: 'success', message: `${accepted.length} sent to inbox.` });
      }
    };
    document.addEventListener('soleil-card-to-inbox', onCardToInbox);
    return () => document.removeEventListener('soleil-card-to-inbox', onCardToInbox);
  }, [inbox, feedback]);

  // Bookmark cross-links — `soleil://bookmark/{boardId}/{bookmarkId}`. Open
  // the target board (forces view='doc') and stash the bookmark id so the
  // DocSurface can scroll to it once its editor mounts.
  const [pendingBookmark, setPendingBookmark] = useState(null);
  useEffect(() => {
    const onOpen = (e) => {
      const { boardId, bookmarkId } = e.detail || {};
      if (!boardId) return;
      setPendingBookmark({ boardId, bookmarkId });
      setViewOverride(o => ({ ...o, [boardId]: 'doc' }));
      openBoard(boardId);
    };
    document.addEventListener('soleil-open-bookmark', onOpen);
    return () => document.removeEventListener('soleil-open-bookmark', onOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  const crumbs = stack.map(id => ({ id, name: boards[id]?.name || (id === rootBoard.id ? rootBoard.name : id) }));
  const ybReadyForCurrent = Boolean(currentYDoc);
  const currentCards = ybReadyForCurrent ? yb.cards : [];
  const currentArrows = ybReadyForCurrent ? yb.arrows : [];
  const currentStrokes = ybReadyForCurrent ? yb.strokes : [];

  // Surface renderer used for both the main pane and the split pane. Reads
  // cards/arrows/strokes off whichever board's `yb` was passed in. Mutators
  // (canvas-only) are still wired against the *main* board's Y.Doc — the
  // split pane is read-mostly for now (canvas drag still works because cards
  // mutators look at the live ydoc); next pass will give the split its own
  // mutator set so canvas edits there persist correctly.
  const renderSurface = ({ board, view, yb: yh, isMain, onClose }) => {
    if (!board) return <div className="surface-missing">Board not found.</div>;
    const ready = yh.ready && yh.boardId === board.id;
    const yd = ready ? yh.ydoc : null;
    const cards = ready ? yh.cards : [];
    const arrows = ready ? yh.arrows : [];
    const strokes = ready ? yh.strokes : [];
    const muts = isMain ? mainMutatorsFull : splitMutatorsFull;
    const surfaceJsx = (() => {
      if (view === 'doc') {
        const pending = (pendingBookmark && pendingBookmark.boardId === board.id) ? pendingBookmark : null;
        return (
          <DocSurface board={board} ydoc={yd} ready={ready}
                      workspaceId={workspace.id} userId={user.id}
                      boards={boards} getAwareness={yh.getAwareness}
                      pendingBookmark={pending}
                      onPendingBookmarkConsumed={() => setPendingBookmark(null)}
                      currentUser={{
                        id: user.id, email: user.email,
                        name: user.user_metadata?.full_name || user.email?.split('@')[0],
                        color: '#4f8df8',
                      }} />
        );
      }
      if (view === 'list') return (
        <ListSurface board={board} boards={boards} cards={cards}
                     childBoards={Object.values(boards).filter(b => b.parent_board_id === board.id)}
                     onOpenBoard={openBoard}
                     onOpenPicker={() => setPickerOpen(true)}
                     onDropInboxItem={dropInboxItem}
                     mutators={muts} />
      );
      return (
        <CanvasSurface board={board} boards={boards} cards={cards} arrows={arrows} strokes={strokes}
                       ydoc={yd}
                       onOpenBoard={openBoard} tweak={tweak} depth={stack.length - 1}
                       onOpenPicker={() => setPickerOpen(true)}
                       inbox={inbox.items} inboxQuery={''} onInboxQuery={() => {}}
                       onDropInboxItem={dropInboxItemFor(muts)}
                       onDropFileImage={dropFileImageFor(muts)}
                       workspaceId={workspace.id} userId={user.id}
                       personalWorkspaceId={personalWorkspaceId}
                       selectedTool={selectedTool} setSelectedTool={setSelectedTool}
                       mutators={muts} autoFocusId={autoFocusId} clearAutoFocus={clearAutoFocus}
                       onCloseInbox={() => setTweak('showInbox', false)} />
      );
    })();
    return (
      <div className={`surface-wrap ${isMain ? '' : 'is-split'}`}>
        {!isMain && (
          <div className="split-bar">
            <span className="split-bar-name">{board.name}</span>
            <button className="split-bar-x" title="Close split" onClick={onClose}>×</button>
          </div>
        )}
        {surfaceJsx}
      </div>
    );
  };

  return (
    <div className={`app ${tweak.compactSidebar ? 'sb-collapsed' : ''}`}
         data-screen-label={`Board · ${currentBoard.name}`}>
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
            <div className={`sb-row ${currentSurface === 'home' ? 'active' : ''}`} onClick={() => setCurrentSurface('home')}>
              <span className="sb-dot" style={{ background: 'var(--soleil)', boxShadow: '0 0 8px rgba(212,160,74,.6)' }} />
              <span className="sb-row-label">Home</span>
            </div>

            <div className="sb-group">
              <div className="sb-group-label t-eyebrow">WORKSPACES</div>
              <button className="sb-group-add" onClick={addNewWorkspace} title="New workspace">
                <Icon as={Plus} size={14} />
              </button>
            </div>
            {(workspaces || []).map(w => {
              const isMine = w.id === personalWorkspaceId;
              const isActive = w.id === workspace.id;
              return (
                <div key={w.id}
                     className={`sb-row ${isActive && currentSurface === 'board' ? 'active' : ''}`}
                     onClick={() => { onSwitchWorkspace(w.id); setCurrentSurface('board'); }}
                     title={isMine ? 'Personal workspace' : 'Shared with me'}>
                  <span className="sb-dot" style={{ background: isMine ? 'var(--soleil)' : 'var(--ink-3)' }} />
                  <span className="sb-row-label">{w.name}</span>
                  {!isMine && <span className="sb-shared-tag t-meta">SHARED</span>}
                </div>
              );
            })}

            <div className="sb-group">
              <div className="sb-group-label t-eyebrow">CURRENT</div>
            </div>
            <div className={`sb-row ${currentId === rootBoard.id && currentSurface === 'board' ? 'active' : ''}`}
                 onClick={() => { setStack([rootBoard.id]); setCurrentSurface('board'); }}>
              <Icon as={LayoutGrid} size={14} />
              <span className="sb-row-label">{rootBoard.name}</span>
            </div>
            <div className={`sb-row ${tweak.showInbox ? 'active' : ''}`}
                 onClick={() => setTweak('showInbox', !tweak.showInbox)}
                 title={tweak.showInbox ? 'Hide inbox' : 'Show inbox'}>
              <Icon as={InboxIcon} size={14} />
              <span className="sb-row-label">Inbox</span>
              <span className="sb-row-count t-meta">{inbox.items.length}</span>
            </div>
            <div className="sb-row" onClick={() => setPickerOpen(true)}>
              <Icon as={Search} size={14} />
              <span className="sb-row-label">Search boards</span>
            </div>

            <div className="sb-group">
              <div className="sb-group-label t-eyebrow">STACK</div>
            </div>
            {stack.map((id, i) => {
              const c = crumbs[i];
              return (
                <div key={`${id}-${i}`}
                     className={`sb-row sb-row-tree ${i === stack.length - 1 && currentSurface === 'board' ? 'active' : ''}`}
                     style={{ paddingLeft: 16 + i * 12 }}
                     onClick={() => { goTo(i); setCurrentSurface('board'); }}>
                  <span className="sb-dot" style={{ background: 'var(--ink-3)' }} />
                  <span className="sb-row-label">{c.name}</span>
                </div>
              );
            })}
            {childBoards.map(b => (
              <div key={b.id}
                   className="sb-row sb-row-tree"
                   style={{ paddingLeft: 16 + stack.length * 12 }}
                   draggable
                   onDragStart={(e) => {
                     e.dataTransfer.setData(BOARD_REF_MIME, JSON.stringify({ boardId: b.id, name: b.name }));
                     e.dataTransfer.effectAllowed = 'copy';
                   }}
                   onClick={() => { openBoard(b.id); setCurrentSurface('board'); }}
                   title="Click to open · drag onto a canvas to embed">
                <span className="sb-dot" style={{ background: 'var(--ink-3)' }} />
                <span className="sb-row-label">{b.name}</span>
              </div>
            ))}
          </>
        )}

        <div className="sb-foot">
          <Avatar name={user.email || 'You'} color="var(--soleil)" size={28} />
          {!tweak.compactSidebar && (
            <div className="sb-me">
              <div className="sb-me-name" title={user.email}>{user.email?.split('@')[0] || 'You'}</div>
              <div className="sb-me-org t-meta">{workspace.name}</div>
            </div>
          )}
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div className="tb-left">
            <div className="crumbs">
              {crumbs.map((c, i) => (
                <React.Fragment key={`${c.id}-${i}`}>
                  {i > 0 && <span className="crumb-sep" aria-hidden="true">›</span>}
                  <span className={`crumb ${i === crumbs.length - 1 ? 'here' : 'clk'}`} onClick={() => goTo(i)}>{c.name}</span>
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
            <button className="tb-icon" title="Undo (⌘Z)" disabled={!yb.canUndo} onClick={() => mainMutators.undo?.()}>
              <Icon as={Undo} size={16} />
            </button>
            <button className="tb-icon" title="Redo (⌘⇧Z)" disabled={!yb.canRedo} onClick={() => mainMutators.redo?.()}>
              <Icon as={Redo} size={16} />
            </button>
            <button className="tb-icon" title="Version history" onClick={() => setHistoryOpen(true)}>
              <Icon as={History} size={16} />
            </button>
            <span className="tb-divider" aria-hidden="true" />
            <PresenceStack getAwareness={yb.getAwareness} />
            <span className="tb-divider" aria-hidden="true" />
            <TopbarAddMenu onAddBoard={() => addNewBoard()} onAddDoc={() => addNewDoc()} onLinkBoard={() => setPickerOpen(true)} />
            <button className="tb-btn" onClick={inviteToWorkspace} title="Invite someone to this workspace">
              <Icon as={Share2} size={14} /> <span className="tb-btn-label">Share</span>
            </button>
            <button className="tb-icon" title="Toggle theme"
                    onClick={() => setTweak('theme', tweak.theme === 'dark' ? 'light' : 'dark')}>
              <Icon as={tweak.theme === 'dark' ? Sun : Moon} size={16} />
            </button>
            <button className="tb-icon"
                    onClick={() => splitId ? setSplitId(null) : setSplitPickerOpen(true)}
                    title={splitId ? 'Close split view' : 'Pin alongside…'}>
              <Icon as={Columns2} size={16} />
            </button>
            <button className="tb-icon" onClick={signOut} title="Sign out">
              <Icon as={LogOut} size={16} />
            </button>
          </div>
        </div>

        {currentSurface === 'home' ? (
          <div className="home-placeholder" style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: 'var(--bg-2)', color: 'var(--ink-2)' }}>
            Home graph coming in Task 5.3…
          </div>
        ) : (
          /* Always render the same outer container so toggling split doesn't
             re-mount the main pane (and any open doc-card modals inside).
             The right pane is only added/removed; the left pane stays put. */
          <SplitContainer
            ratio={splitId ? splitRatio : 1}
            onRatio={setSplitRatio}
            showSplit={!!splitId}
            left={renderSurface({ board: currentBoard, view, yb, isMain: true })}
            right={splitId ? renderSurface({
              board: splitBoard, view: splitView, yb: splitYb,
              onClose: () => setSplitId(null), isMain: false,
            }) : null}
          />
        )}
      </main>

      <BoardPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        excludeIds={[currentId]}
        boards={boards}
        rootId={rootBoard.id}
        onPick={(b) => addLink(b)}
      />

      <BoardPicker
        open={splitPickerOpen}
        onClose={() => setSplitPickerOpen(false)}
        excludeIds={[currentId]}
        boards={boards}
        rootId={rootBoard.id}
        onPick={(b) => { setSplitId(b.id); setSplitPickerOpen(false); }}
      />

      <HistoryModal
        open={historyOpen}
        boardId={currentBoard.id}
        ydoc={currentYDoc}
        userId={user.id}
        onClose={() => setHistoryOpen(false)}
      />

    </div>
  );
}

// Two-pane container with a draggable vertical divider. Persists the ratio
// in the parent (via `onRatio`). When `showSplit` is false, the right pane
// is hidden entirely and the left pane occupies the full width — but the
// container structure stays identical, so the left pane's React subtree
// doesn't unmount when split is toggled (critical for keeping doc-card
// modals open across split toggles).
function SplitContainer({ left, right, ratio = 0.5, onRatio, showSplit = true }) {
  const wrapRef = React.useRef(null);
  const onPointerDown = (e) => {
    e.preventDefault();
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const onMove = (ev) => {
      const next = Math.max(0.18, Math.min(0.82, (ev.clientX - rect.left) / rect.width));
      onRatio?.(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  return (
    <div className="split-wrap" ref={wrapRef}>
      <div className="split-pane" style={{ flex: showSplit ? ratio : 1 }}>{left}</div>
      {showSplit && <div className="split-divider" onPointerDown={onPointerDown} />}
      {showSplit && (
        <div className="split-pane" style={{ flex: 1 - ratio }}>{right}</div>
      )}
    </div>
  );
}

function TopbarAddMenu({ onAddBoard, onAddDoc, onLinkBoard }) {
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
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 2 V11 M2 6.5 H11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
        Add
      </button>
      {open && (
        <div className="topbar-add-menu" role="menu" aria-label="Add">
          <button role="menuitem" onClick={() => { setOpen(false); onAddBoard(); }}>Board</button>
          <button role="menuitem" onClick={() => { setOpen(false); onLinkBoard(); }}>Linked board</button>
          {/* Docs are added as canvas cards now — use Add → Doc inside a board. */}
        </div>
      )}
    </div>
  );
}

function BoardsSettingsPanel({ tweak, setTweak }) {
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
      </TweakSection>
    </TweaksPanel>
  );
}

function LoadingShell() {
  return (
    <div className="auth-screen">
      <div className="auth-loading"><SoleilMark size={28} color="var(--ink-0)" /></div>
    </div>
  );
}

function FullScreenError({ error, signOut }) {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-title">Something went wrong</div>
        <div className="auth-sub" style={{ marginBottom: 14 }}>workspace setup</div>
        <pre style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-2)', whiteSpace: 'pre-wrap', marginBottom: 14 }}>
          {String(error.message || error)}
        </pre>
        <button className="auth-btn" onClick={signOut}>Sign out</button>
      </div>
    </div>
  );
}
