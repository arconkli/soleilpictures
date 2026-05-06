// App.jsx — live data via Supabase + Yjs.
// Postgres is the source of truth for board metadata + hierarchy
// (parent_board_id). Each board's cards/arrows live in a Y.Doc whose
// snapshot is persisted to board_state.

import React, { useState, useEffect, useMemo } from 'react';
import { pickPresenceColor } from './lib/presenceColor.js';
import { useWorkspaceMembers } from './hooks/useWorkspaceMembers.js';
import { useSharedBoards } from './hooks/useSharedBoards.js';
import * as userProfiles from './lib/userProfiles.js';
import { useBoardPermission } from './hooks/useBoardPermission.js';
import { useShareNotifications } from './hooks/useShareNotifications.js';
import { SidebarBoardTree } from './components/SidebarBoardTree.jsx';
import { SidebarSharedBoards } from './components/SidebarSharedBoards.jsx';
import { WorkspaceMenu } from './components/WorkspaceMenu.jsx';
import { ShareModal } from './components/ShareModal.jsx';
import { CanvasSurface } from './components/CanvasSurface.jsx';
import { ListSurface } from './components/ListSurface.jsx';
import { BoardPicker } from './components/BoardPicker.jsx';
import { Avatar, SoleilMark } from './components/primitives.jsx';
import { SoleilWordmark } from './components/SoleilWordmark.jsx';
import { Icon } from './components/Icon.jsx';
import { Plus, PanelLeftClose, PanelLeftOpen, Search, LayoutGrid, Inbox as InboxIcon, Settings, Share2, Sun, Moon, History, Columns2, LogOut, Undo, Redo, Home, MessageSquare, UserPlus, Trash2, MoreHorizontal } from './lib/icons.js';
import { PresenceStack } from './components/PresenceStack.jsx';
import { TweaksPanel, TweakSection, TweakToggle, TweakRadio, useTweaks } from './components/TweaksPanel.jsx';
import { useAuth } from './auth/AuthGate.jsx';
import { useWorkspace } from './hooks/useWorkspace.js';
import { useAllWorkspaces } from './hooks/useAllWorkspaces.js';
import { useBoardList } from './hooks/useBoardList.js';
import { useYBoard } from './hooks/useYBoard.js';
import { useChannelList } from './hooks/useChannelList.js';
import { useUnreadTotal } from './hooks/useUnreadTotal.js';
import { useTitleBadge } from './hooks/useTitleBadge.js';
import { useRecents } from './hooks/useRecents.js';
import { useWorkspacePresence } from './hooks/useWorkspacePresence.js';
import { WorkspacePresenceStack } from './components/WorkspacePresenceStack.jsx';
import { MessagesPanel } from './components/MessagesPanel.jsx';
import { subscribeBoardChat } from './lib/messageRealtime.js';
import { LocalBoardsApp } from './local/LocalBoardsApp.jsx';
import { isLocalQaMode } from './lib/localMode.js';
import { isSupabaseConfigured, supabase, altSessionId } from './lib/supabase.js';
import { createBoard, deleteBoard, renameBoard, getRootBoard, createWorkspace, deleteWorkspace, leaveWorkspace, loadBoardSnapshot, saveBoardSnapshot, updateBoardMeta } from './lib/boardsApi.js';
import * as Y from 'yjs';
import { b64ToBytes } from './lib/yhelpers.js';
import { cardToYMap } from './lib/yhelpers.js';
import { BOARD_REF_MIME } from './lib/dragMimes.js';
import { initCardDocStore } from './lib/docState.js';
import { uploadImage } from './lib/uploads.js';
import { HistoryModal } from './components/HistoryModal.jsx';
import { useFeedback } from './components/AppFeedback.jsx';
import { HomeGraph } from './components/HomeGraph.jsx';

const TWEAK_DEFAULTS = {
  theme: 'dark',
  showArrows: true,
  // Messages defaults to closed — the unread badge guides you to open it.
  // (Replaces the old showInbox: true default; that drawer was demoware.)
  showMessages: false,
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
  // One-time: rename tweak.showInbox → tweak.showMessages so existing users
  // keep their drawer-open state across the rename.
  useEffect(() => {
    if (tweak.showInbox !== undefined && tweak.showMessages === undefined) {
      setTweak({ showMessages: !!tweak.showInbox, showInbox: undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const { boards: ownedBoards, loading: boardsLoading, refresh: refreshBoards } = useBoardList(workspace.id);
  // Boards shared with the user via per-board shares. Fetched here
  // (early) so we can merge them into the boards map below; the shared
  // section in the sidebar reads from the same source.
  const { shared: sharedBoards, refresh: refreshSharedBoards } = useSharedBoards(user.id);
  // Effective boards map = workspace boards + shared boards from other
  // workspaces (normalized to the boards table shape so the rest of
  // the app can look them up by id transparently).
  const boards = useMemo(() => {
    const merged = { ...ownedBoards };
    for (const s of (sharedBoards || [])) {
      if (!merged[s.board_id]) {
        merged[s.board_id] = {
          id: s.board_id,
          name: s.board_name,
          workspace_id: s.source_workspace_id,
          parent_board_id: s.parent_board_id,
          view: s.board_view,
          cover: s.board_cover,
          created_at: s.created_at,
          _shared: true,
        };
      }
    }
    return merged;
  }, [ownedBoards, sharedBoards]);
  const feedback = useFeedback();
  const sessionKey = `${SESSION_PREFIX}${user.id}.${workspace.id}`;
  const [initialSession] = useState(() => readSession(sessionKey));

  const [stack, setStack] = useState(() => initialSession?.stack?.length ? initialSession.stack : [rootBoard.id]);
  const [viewOverride, setViewOverride] = useState(() => initialSession?.viewOverride || {});
  const [pickerOpen, setPickerOpen] = useState(false);
  // Workspace switcher popover (in the sidebar header). Click-outside +
  // Escape close it; selecting a workspace also closes.
  const [wsMenuOpen, setWsMenuOpen] = useState(false);

  const currentId = stack[stack.length - 1];
  const currentBoard = boards[currentId] || rootBoard;
  const view = viewOverride[currentId] || currentBoard.view || 'canvas';

  // Filter the stack down to boards that still exist. Catches cascaded
  // deletes where multiple frames in the stack vanish at once (e.g. you
  // delete a parent board with descendants while you're inside one of
  // them). Falls back to the root if everything in the stack is gone.
  useEffect(() => {
    if (boardsLoading) return;
    setStack(prev => {
      const filtered = prev.filter(id => boards[id]);
      if (filtered.length === prev.length) return prev;
      return filtered.length ? filtered : [rootBoard.id];
    });
  }, [boards, boardsLoading, rootBoard.id]);

  const userInfo = {
    id: user.id,
    name: user.user_metadata?.full_name || user.email?.split('@')[0],
    email: user.email,
  };

  // Messages: list/unread/title-badge. msgRefreshTick lets realtime pings
  // bump the sidebar count without a full refetch loop.
  const [msgRefreshTick, setMsgRefreshTick] = useState(0);
  const channelList = useChannelList({ workspaceId: workspace.id, userId: user.id, refreshTick: msgRefreshTick });
  const { total: messagesUnread, mentions: messagesMentions } = useUnreadTotal({ unreadByKey: channelList.unreadByKey });
  useTitleBadge({ total: messagesUnread, mentions: messagesMentions });

  const yb = useYBoard(currentBoard.id, user.id, userInfo);

  // When a peer chats in the currently-open board, refresh the panel list
  // so the row + unread dot update without requiring you to open the panel.
  useEffect(() => {
    if (!currentBoard?.id) return;
    const unsub = subscribeBoardChat({
      boardId: currentBoard.id,
      onMessage: () => setMsgRefreshTick(t => t + 1),
      onTyping: () => {},
    });
    return () => unsub();
  }, [currentBoard?.id]);
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

  const recents = useRecents(workspace.id);
  const openBoard = (id) => { setStack(s => [...s, id]); recents.push(id); };
  const goTo = (i) => setStack(s => s.slice(0, i + 1));

  // Prune recents when boards are deleted so the sidebar list stays clean.
  useEffect(() => {
    if (boardsLoading) return;
    recents.prune(Object.keys(boards));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boards, boardsLoading]);

  // Track the currently-open root-board access too — top of stack is "active".
  useEffect(() => { if (currentId) recents.push(currentId); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [currentId]);
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
          const up = await uploadImage({ file: f, workspaceId: workspace.id, boardId: boardId, userId: user.id });
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
      const defaultName = view === 'list' ? 'Untitled list' : 'Untitled board';
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
    const undo = () => undoManager?.undo();
    const redo = () => undoManager?.redo();

    return {
      updateCard, updateCards, deleteCard, deleteCards,
      duplicateCard, duplicateCards, addCard, addCards, bringToFront,
      addArrow, addFreeArrow, deleteArrows,
      addNote, addTextLink, addImageAt, addNewBoard, addPalette,
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

  // Right-click on a workspace row → confirm + delete (own) or leave (shared).
  // If the user removes the currently-active workspace we switch to personal.
  const removeWorkspace = async (ws, kind /* 'delete' | 'leave' */) => {
    const isDelete = kind === 'delete';
    const ok = await feedback.confirm({
      title: isDelete ? 'Delete workspace' : 'Leave workspace',
      message: isDelete
        ? `Delete "${ws.name}" and all of its boards, cards, and messages? This cannot be undone.`
        : `Leave "${ws.name}"? You'll lose access until the owner re-invites you.`,
      confirmLabel: isDelete ? 'Delete workspace' : 'Leave',
      danger: true,
    });
    if (!ok) return;
    try {
      if (isDelete) await deleteWorkspace(ws.id);
      else          await leaveWorkspace(ws.id);
      // If we just removed the active workspace, fall back to personal so
      // the next render doesn't briefly try to load deleted boards.
      if (ws.id === workspace.id && personalWorkspaceId && personalWorkspaceId !== ws.id) {
        onSwitchWorkspace?.(personalWorkspaceId);
      } else if (ws.id === workspace.id) {
        // Removed the personal workspace itself — clear the override and let
        // useWorkspace bootstrap a fresh one on the next render.
        onSwitchWorkspace?.(null);
      }
      await onWorkspacesChanged?.();
      feedback.toast({ type: 'success', message: isDelete ? `Deleted "${ws.name}".` : `Left "${ws.name}".` });
    } catch (e) {
      console.error('removeWorkspace failed', e);
      feedback.toast({ type: 'error', message: (isDelete ? 'Delete' : 'Leave') + ' failed: ' + (e.message || e) });
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

  // Pane-aware drop handlers — so dragging into the split pane creates the
  // card on the SPLIT board, not the main one. Used by chat-attachment drops
  // (which piggy-back on the INBOX_MIME drag protocol) and file-image drops.
  const dropInboxItemFor = (muts) => (_inboxId, card) => { muts._addCardRaw?.(card); };
  const dropFileImageFor = (muts) => (info) => muts._dropImageBlob?.(info);
  const dropInboxItem = dropInboxItemFor(mainMutators);
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

  // Track which doc-card overlay (if any) is currently open + its active
  // page + scroll. Doc cards are docs nested inside canvas boards, so
  // currentBoard.view === 'canvas' but the user is actually editing a
  // doc inside one of its cards. DocCardOverlay dispatches lifecycle
  // events; we mirror them into state so workspace presence reflects
  // the exact location for click-to-jump.
  //   null OR { cardId, pageId, scrollTop }
  const [openDocCard, setOpenDocCard] = useState(null);
  useEffect(() => {
    const onMount = (e) => {
      const { cardId } = e.detail || {};
      if (!cardId) return;
      setOpenDocCard({ cardId, pageId: null, scrollTop: 0 });
    };
    const onUnmount = (e) => {
      const { cardId } = e.detail || {};
      setOpenDocCard(c => (c?.cardId === cardId ? null : c));
    };
    const onPage = (e) => {
      const { cardId, pageId } = e.detail || {};
      setOpenDocCard(c => (c?.cardId === cardId ? { ...c, pageId: pageId || null } : c));
    };
    const onScroll = (e) => {
      const { cardId, scrollTop } = e.detail || {};
      setOpenDocCard(c => (c?.cardId === cardId ? { ...c, scrollTop: scrollTop || 0 } : c));
    };
    document.addEventListener('soleil-doccard-mount', onMount);
    document.addEventListener('soleil-doccard-unmount', onUnmount);
    document.addEventListener('soleil-doccard-page', onPage);
    document.addEventListener('soleil-doccard-scroll', onScroll);
    return () => {
      document.removeEventListener('soleil-doccard-mount', onMount);
      document.removeEventListener('soleil-doccard-unmount', onUnmount);
      document.removeEventListener('soleil-doccard-page', onPage);
      document.removeEventListener('soleil-doccard-scroll', onScroll);
    };
  }, []);

  // Workspace-level presence — shows everyone in the workspace, regardless
  // of which board they're on. Click an avatar to teleport to their board.
  // Members of the active workspace — drives the sidebar header dot
  // stack and the "shared" badge on each rail workspace button.
  const { members: workspaceMembers, refresh: refreshWorkspaceMembers } = useWorkspaceMembers(workspace.id);
  // Hydrate userProfiles from workspace presence whenever the peer
  // list changes — every online peer brings its name+email along, so
  // we get free name resolution without an RPC roundtrip.
  // (See useEffect on wsPeers further down — this one's a no-op
  //  reference to keep the import linked even before the wsPeers
  //  hook resolves on first render.)
  // ShareModal lifecycle. Replaces the old "invite to workspace" prompt.
  const [shareOpen, setShareOpen] = useState(false);

  // Surface "X shared a board with you" notifications as toasts on
  // first load. Each toast has a "View" action that opens the board
  // and dismisses; otherwise we batch-dismiss after the initial toast
  // pass so they don't re-fire forever.
  const { unread: shareNotifs, dismiss: dismissNotif, dismissAll: dismissAllNotifs } = useShareNotifications(user.id);
  const surfacedNotifsRef = React.useRef(new Set());
  useEffect(() => {
    for (const n of (shareNotifs || [])) {
      if (surfacedNotifsRef.current.has(n.id)) continue;
      surfacedNotifsRef.current.add(n.id);
      const board = boards[n.board_id];
      const name = board?.name || 'a board';
      feedback.toast({
        type: 'info',
        message: `${n.role === 'editor' ? 'Editor access' : 'View access'} to "${name}" was shared with you. Find it in "Shared with me".`,
      });
    }
    // After the user has seen the batch (small delay so the toast renders),
    // mark all as dismissed so they don't re-pop on next reload.
    if (shareNotifs && shareNotifs.length > 0) {
      const t = setTimeout(() => dismissAllNotifs(), 8000);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareNotifs]);
  // Permission for the currently-active board — drives VIEW ONLY pill
  // in the topbar + canvas/doc readonly states.
  const currentBoardPerm = useBoardPermission({
    board: currentBoard,
    boards,
    workspace,
    workspaceMembers,
    sharedBoards,
    userId: user.id,
  });
  const canEditCurrent = currentBoardPerm.canEdit;
  // Pre-compute a sync set of board ids the user can read — used by the
  // canvas to render the "🔒 No access" placeholder for boardlinks /
  // embedded boards that point outside the user's reach.
  const readableBoardIds = useMemo(() => {
    const set = new Set(Object.keys(boards || {}));
    // sharedBoards rows are already readable; their descendants (visible
    // via boards map traversal) inherit but we don't know them all here.
    // For v1 the boards map only includes workspace boards anyway, and
    // shared rows refer to OTHER-workspace boards explicitly listed.
    for (const s of sharedBoards || []) set.add(s.board_id);
    return set;
  }, [boards, sharedBoards]);
  // Per-workspace member counts — needed in the rail to show the "Nx"
  // shared badge on every workspace button (not just the active one).
  // Uses the role+joined data already loaded by useAllWorkspaces; if a
  // workspace doesn't appear here it's treated as solo.
  const memberCountByWorkspace = useMemo(() => {
    // We only have the active workspace's full member list. For all
    // OTHER workspaces, we infer "shared" from the fact that you weren't
    // the creator (created_by !== you) — those are guaranteed to have
    // at least 2 members (you + the creator). For workspaces you own,
    // we honestly only know the count for the active one.
    const m = new Map();
    if (workspace?.id) m.set(workspace.id, workspaceMembers.length);
    return m;
  }, [workspace?.id, workspaceMembers]);

  // Pre-seed the userProfiles cache with the current user so every
  // message bubble (including own messages) has an immediate name.
  useEffect(() => {
    if (!user?.id) return;
    userProfiles.populateFromUser({
      id: user.id,
      email: user.email,
      name: user.user_metadata?.full_name || null,
    });
  }, [user?.id, user?.email]);

  const { peers: wsPeers, status: wsStatus } = useWorkspacePresence({
    workspaceId: workspace.id,
    user: { id: user.id, name: userInfo.name, email: user.email, color: pickPresenceColor(user.id) },
    location: {
      boardId: currentBoard?.id,
      boardName: currentBoard?.name,
      surface: currentSurface,
      // pageId/scrollTop come from the open doc-card overlay if any —
      // canvas boards themselves don't have pages.
      docCardId: openDocCard?.cardId ?? null,
      pageId:    openDocCard?.pageId ?? null,
      scrollTop: openDocCard?.scrollTop ?? 0,
    },
  });
  // Hydrate the userProfiles cache from workspace presence — every
  // online peer brings name+email along, so messages from / mentions
  // of online users get resolved without an RPC roundtrip.
  useEffect(() => {
    userProfiles.populateFromPeers(wsPeers);
  }, [wsPeers]);

  const jumpToPeer = (loc) => {
    if (loc?.surface === 'home') { setCurrentSurface('home'); return; }
    if (!loc?.boardId || !boards[loc.boardId]) return;
    // Navigate to the host board first.
    setStack([loc.boardId]);
    setCurrentSurface('board');
    // If peer is editing a doc card on that board, fire an event the
    // matching RichDocCard listens for so it self-opens and consumes
    // the peer's pageId + scrollTop. Allow a short settle window for
    // cards to mount on the new canvas before firing.
    if (loc.docCardId) {
      if (loc.pageId) {
        try { sessionStorage.setItem(`soleil.boards.docActivePage.${loc.docCardId}`, loc.pageId); } catch (_) {}
      }
      setTimeout(() => {
        document.dispatchEvent(new CustomEvent('soleil-open-doc-card', {
          detail: { cardId: loc.docCardId, pageId: loc.pageId || null, scrollTop: loc.scrollTop || 0 },
        }));
      }, 200);
    }
  };

  // Build a map of boardId → peers exactly there, plus boardId → peers in a
  // descendant. Walks each peer's exact board up the parent_board_id chain
  // so an ancestor card shows a nested-presence dot — that's the "follow
  // the trail 3 boards deep" behavior.
  const { peersHereByBoard, peersBelowByBoard } = useMemo(() => {
    const here = new Map();
    const below = new Map();
    for (const p of (wsPeers || [])) {
      const bid = p?.location?.boardId;
      if (!bid) continue;
      if (!here.has(bid)) here.set(bid, []);
      here.get(bid).push(p);
      // Walk up ancestors and tag each as "below"
      let cur = boards[bid]?.parent_board_id;
      const seen = new Set([bid]);
      while (cur && !seen.has(cur)) {
        seen.add(cur);
        if (!below.has(cur)) below.set(cur, []);
        below.get(cur).push(p);
        cur = boards[cur]?.parent_board_id;
      }
    }
    return { peersHereByBoard: here, peersBelowByBoard: below };
  }, [wsPeers, boards]);

  const [selectedTool, setSelectedTool] = useState('select');
  // Reset to the select tool every time the active board changes — otherwise
  // a leftover draw/shape/arrow tool from the previous board carries over and
  // makes the canvas feel "stuck" in a draw mode the user didn't reselect.
  useEffect(() => { setSelectedTool('select'); }, [currentId]);
  // Force-select on view-only boards: prevent any draw/shape/note tool
  // from being active when the user has read-only access.
  useEffect(() => {
    if (!canEditCurrent && selectedTool !== 'select') setSelectedTool('select');
  }, [canEditCurrent, selectedTool]);

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

  // ⌘B / Ctrl-B — toggle compact sidebar.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'b' || e.key === 'B')) {
        const tag = (e.target?.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
        e.preventDefault();
        setTweak('compactSidebar', !tweak.compactSidebar);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tweak.compactSidebar, setTweak]);


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
    // Board id resolved to nothing — usually means it was just deleted and
    // the cleanup useEffects haven't popped the stack / cleared splitId yet.
    // Render an empty pane silently; the next tick will route to a real
    // board so the user never sees a scary "not found" message.
    if (!board) return <div className="surface-wrap" />;
    const ready = yh.ready && yh.boardId === board.id;
    const yd = ready ? yh.ydoc : null;
    const cards = ready ? yh.cards : [];
    const arrows = ready ? yh.arrows : [];
    const strokes = ready ? yh.strokes : [];
    const muts = isMain ? mainMutatorsFull : splitMutatorsFull;
    const surfaceJsx = (() => {
      if (view === 'list') return (
        <ListSurface board={board} boards={boards} cards={cards}
                     childBoards={Object.values(boards).filter(b => b.parent_board_id === board.id)}
                     onOpenBoard={openBoard}
                     onOpenPicker={() => setPickerOpen(true)}
                     onDropInboxItem={dropInboxItem}
                     peersHereByBoard={peersHereByBoard}
                     peersBelowByBoard={peersBelowByBoard}
                     onJumpToPeer={jumpToPeer}
                     mutators={muts} />
      );
      return (
        <CanvasSurface board={board} boards={boards} cards={cards} arrows={arrows} strokes={strokes}
                       ydoc={yd}
                       getAwareness={yh.getAwareness}
                       peersHereByBoard={peersHereByBoard}
                       peersBelowByBoard={peersBelowByBoard}
                       wsPeers={wsPeers}
                       onJumpToPeer={jumpToPeer}
                       canEdit={isMain ? canEditCurrent : true}
                       currentUser={{
                         id: user.id, email: user.email,
                         name: user.user_metadata?.full_name || user.email?.split('@')[0],
                         color: pickPresenceColor(user.id),
                       }}
                       onOpenBoard={openBoard} tweak={tweak} depth={stack.length - 1}
                       onOpenPicker={() => setPickerOpen(true)}
                       onDropInboxItem={dropInboxItemFor(muts)}
                       onDropFileImage={dropFileImageFor(muts)}
                       workspaceId={workspace.id} userId={user.id}
                       personalWorkspaceId={personalWorkspaceId}
                       selectedTool={selectedTool} setSelectedTool={setSelectedTool}
                       mutators={muts} autoFocusId={autoFocusId} clearAutoFocus={clearAutoFocus} />
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
        {/* Single-column sidebar. Workspace switcher is now a popover
            triggered from the header (Notion-style) instead of the
            old icon rail. Settings + avatar live at the bottom. */}
        <div className="sb-mid">
          <div className="sb-mid-head">
            <button className="sb-ws-trigger"
                    onClick={() => setWsMenuOpen(o => !o)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      const action = workspace.created_by === user.id ? 'delete' : 'leave';
                      removeWorkspace(workspace, action);
                    }}
                    title={`${workspace.name} · click to switch`}
                    aria-haspopup="menu" aria-expanded={wsMenuOpen}>
              <span className="sb-ws-avatar" style={{ background: pickPresenceColor(workspace.id) }}>
                {(workspace.name || '?').trim().charAt(0).toUpperCase()}
              </span>
              <span className="sb-ws-name">{workspace.name}</span>
              <svg className="sb-ws-chev" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <path d="M2 4 L5 7 L8 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button className="sb-mid-collapse"
                    onClick={() => setTweak('compactSidebar', !tweak.compactSidebar)}
                    title="Collapse sidebar (⌘B)" aria-label="Collapse sidebar">
              <Icon as={PanelLeftClose} size={14} />
            </button>
            {wsMenuOpen && (
              <WorkspaceMenu
                workspaces={workspaces || []}
                activeWorkspaceId={workspace.id}
                personalWorkspaceId={personalWorkspaceId}
                selfUserId={user.id}
                wsPeers={wsPeers}
                onSelect={(id) => { onSwitchWorkspace(id); setCurrentSurface('board'); }}
                onAddNew={addNewWorkspace}
                onClose={() => setWsMenuOpen(false)}
              />
            )}
          </div>
          {(() => {
            // Subtitle + member dots for the ACTIVE workspace.
            const isOwner = workspace.created_by === user.id;
            const isPersonal = workspace.id === personalWorkspaceId;
            const onlineIds = new Set((wsPeers || []).map(p => p?.user?.id).filter(Boolean));
            const peerById = new Map((wsPeers || []).map(p => [p?.user?.id, p]));
            const ownerPeer = peerById.get(workspace.created_by);
            const subtitle = isPersonal
              ? 'Personal'
              : isOwner
                ? 'Yours'
                : `Shared by ${ownerPeer?.user?.email || ownerPeer?.user?.name || 'someone'}`;
            const visibleMembers = workspaceMembers.slice(0, 6);
            const overflow = workspaceMembers.length - visibleMembers.length;
            return (
              <>
                <div className="sb-mid-subtitle">{subtitle}</div>
                {workspaceMembers.length > 0 && (
                  <div className="sb-members" title={`${workspaceMembers.length} member${workspaceMembers.length === 1 ? '' : 's'}`}>
                    {visibleMembers.map(m => {
                      const online = onlineIds.has(m.user_id);
                      const peer = peerById.get(m.user_id);
                      const tip = peer?.user?.name || peer?.user?.email
                        || (m.user_id === user.id ? 'You' : 'Member');
                      return (
                        <span key={m.user_id}
                              className={`sb-member ${online ? 'is-online' : ''}`}
                              style={{ background: pickPresenceColor(m.user_id) }}
                              title={tip + (online ? ' · online' : '')} />
                      );
                    })}
                    {overflow > 0 && <span className="sb-member sb-member-overflow">+{overflow}</span>}
                  </div>
                )}
              </>
            );
          })()}

          <button className="sb-search" onClick={() => setPickerOpen(true)} title="Search boards (⌘K)">
            <Icon as={Search} size={13} />
            <span>Search boards…</span>
            <span className="sb-search-kbd">⌘K</span>
          </button>

          <div className={`sb-row ${currentSurface === 'home' ? 'active' : ''}`}
               onClick={() => setCurrentSurface('home')}>
            <Icon as={Home} size={14} />
            <span className="sb-row-label">Home</span>
          </div>
          <div className={`sb-row ${tweak.showMessages ? 'active' : ''}`}
               onClick={() => setTweak('showMessages', !tweak.showMessages)}
               title={tweak.showMessages ? 'Hide messages' : 'Show messages'}>
            <Icon as={MessageSquare} size={14} />
            <span className="sb-row-label">Messages</span>
            {messagesUnread > 0 && (
              <span className="sb-row-count t-meta has-unread">{messagesUnread}</span>
            )}
          </div>

          <SidebarSharedBoards
            shared={sharedBoards}
            activeBoardId={currentSurface === 'board' ? currentId : null}
            onOpenBoard={(id) => { setStack([id]); setCurrentSurface('board'); }}
          />

          <div className="sb-eyebrow">BOARDS</div>
          <SidebarBoardTree
            boards={boards}
            workspaceId={workspace.id}
            activeBoardId={currentSurface === 'board' ? currentId : null}
            onOpenBoard={(id) => { setStack([id]); setCurrentSurface('board'); }}
            peersHereByBoard={peersHereByBoard}
            peersBelowByBoard={peersBelowByBoard}
            onJumpToPeer={jumpToPeer}
          />
          <div className="sb-row sb-row-all" onClick={() => setPickerOpen(true)}>
            <Icon as={MoreHorizontal} size={14} />
            <span className="sb-row-label">All boards</span>
          </div>

          {/* Footer — settings + avatar (sign-out). Pushed to the bottom
              of the column with margin-top:auto. */}
          <div className="sb-foot">
            <button className="sb-foot-icon" title="Settings (⌘.)" aria-label="Settings"
                    onClick={() => document.querySelector('.twk-gear')?.click()}>
              <Icon as={Settings} size={14} />
            </button>
            <button className="sb-foot-avatar" title={user.email}
                    onClick={async () => {
                      const ok = await feedback.confirm({
                        title: 'Sign out',
                        message: `Sign out of ${user.email}?`,
                        confirmLabel: 'Sign out',
                      });
                      if (ok) signOut?.();
                    }}>
              {(user.email?.[0] || 'Y').toUpperCase()}
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div className="tb-left">
            {tweak.compactSidebar && (
              <button className="tb-icon" title="Open sidebar (⌘B)" aria-label="Open sidebar"
                      onClick={() => setTweak('compactSidebar', false)}>
                <Icon as={PanelLeftOpen} size={16} />
              </button>
            )}
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
            <WorkspacePresenceStack peers={wsPeers} status={wsStatus} selfId={user.id} onJumpTo={jumpToPeer} />
            <span className="tb-divider" aria-hidden="true" />
            {!canEditCurrent && (
              <span className="tb-viewonly" title="You have view-only access to this board">VIEW ONLY</span>
            )}
            <button className="tb-btn" onClick={() => setShareOpen(true)} title="Share this board">
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
            {!altSessionId && (
              <button className="tb-icon" title="Open in second window as another user (for solo collab testing)"
                      onClick={() => {
                        const url = new URL(window.location.href);
                        url.searchParams.set('as', 'alt');
                        window.open(url.toString(), '_blank',
                          'noopener,noreferrer,width=1280,height=900');
                      }}>
                <Icon as={UserPlus} size={16} />
              </button>
            )}
          </div>
        </div>
        {altSessionId && (
          <div className="alt-session-banner">
            Test session ({altSessionId}) — sign in as a different account here, then collab with the main window.
          </div>
        )}

        {currentSurface === 'home' ? (
          <HomeGraph
            workspaceId={workspace.id}
            onNavigate={(target) => {
              setCurrentSurface('board');
              if (target?.kind === 'url') {
                window.open(target.href, '_blank', 'noopener,noreferrer');
                return;
              }
              if (target?.kind === 'board') setStack([target.id]);
              if (target?.kind === 'card')  setStack([target.boardId]);
              if (target?.kind === 'doc')   { /* doc cards open inside their board canvas; future wiring */ }
            }}
          />
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

      {tweak.showMessages && (
        <MessagesPanel
          workspaceId={workspace.id}
          currentUser={userInfo}
          currentBoard={currentBoard}
          refreshTick={msgRefreshTick}
          onClose={() => setTweak('showMessages', false)}
        />
      )}

      {shareOpen && (
        <ShareModal
          board={currentBoard}
          workspace={workspace}
          workspaceMembers={workspaceMembers}
          wsPeers={wsPeers}
          selfUserId={user.id}
          onClose={() => setShareOpen(false)}
          onMembersChanged={() => { refreshWorkspaceMembers?.(); }}
          onSharesChanged={() => { refreshSharedBoards?.(); }}
        />
      )}

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
        <TweakToggle label="Show messages" value={tweak.showMessages} onChange={(value) => setTweak('showMessages', value)} />
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
