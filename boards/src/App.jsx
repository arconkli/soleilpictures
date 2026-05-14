// App.jsx — live data via Supabase + Yjs.
// Postgres is the source of truth for board metadata + hierarchy
// (parent_board_id). Each board's cards/arrows live in a Y.Doc whose
// snapshot is persisted to board_state.

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { pickPresenceColor } from './lib/presenceColor.js';
import { useWorkspaceMembers } from './hooks/useWorkspaceMembers.js';
import { useSharedBoards } from './hooks/useSharedBoards.js';
import * as userProfiles from './lib/userProfiles.js';
import { useBoardPermission } from './hooks/useBoardPermission.js';
import { useShareNotifications } from './hooks/useShareNotifications.js';
import { useResolvedDefaults } from './hooks/useResolvedDefaults.js';
import { useMentionNotifications } from './hooks/useMentionNotifications.js';
import { fetchMessageById } from './lib/messages.js';
import { EntityNavigateContext } from './hooks/useEntityNavigate.js';
import { useEntityNameTrie, EntityTrieContext } from './hooks/useEntityNameTrie.js';
import { refFromCurrentUrl, stripLinkParamsFromUrl } from './lib/entityUrl.js';
// Side-effect import: registers the v1 entity kinds so any surface
// that resolves a kind sees the same registry.
import './lib/entityKinds.js';
import { SidebarBoardTree } from './components/SidebarBoardTree.jsx';
import { SidebarSharedBoards } from './components/SidebarSharedBoards.jsx';
import { SidebarTags } from './components/SidebarTags.jsx';
import { TagDetailView } from './components/TagDetailView.jsx';
import { useWorkspaceTags } from './hooks/useWorkspaceTags.js';
import { useAutotagWorker } from './hooks/useAutotagWorker.js';
import { useAiTagger } from './hooks/useAiTagger.js';
import { isAiTaggerEnabled } from './lib/aiTaggerFlag.js';
import { WorkspaceMenu } from './components/WorkspaceMenu.jsx';
import { SettingsPanel } from './components/SettingsPanel.jsx';
import { ShareModal } from './components/ShareModal.jsx';
import { CanvasSurface } from './components/CanvasSurface.jsx';
import { ListSurface } from './components/ListSurface.jsx';
import { BoardPicker } from './components/BoardPicker.jsx';
import { Avatar, SoleilMark } from './components/primitives.jsx';
import { SoleilWordmark, ClustersMark } from './components/SoleilWordmark.jsx';
import { Icon } from './components/Icon.jsx';
import { Plus, PanelLeftClose, PanelLeftOpen, Search, LayoutGrid, Inbox as InboxIcon, Settings, Share2, Sun, Moon, History, Columns2, LogOut, Undo, Redo, Home, MessageSquare, Trash2, MoreHorizontal, Link as LinkIcon } from './lib/icons.js';
import { EntityBacklinksPanel } from './components/EntityBacklinksPanel.jsx';
import { PresenceStack } from './components/PresenceStack.jsx';
import { TweaksPanel, TweakSection, TweakToggle, TweakRadio, useTweaks } from './components/TweaksPanel.jsx';
import { useAuth } from './auth/AuthGate.jsx';
import { useWorkspace } from './hooks/useWorkspace.js';
import { useAllWorkspaces } from './hooks/useAllWorkspaces.js';
import { useBoardList } from './hooks/useBoardList.js';
import { useIdlePrefetch } from './hooks/useIdlePrefetch.js';
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
import { createBoard, deleteBoard, restoreBoard, renameBoard, getRootBoard, createWorkspace, deleteWorkspace, leaveWorkspace, renameWorkspace, getOwnProfile, loadBoardSnapshot, saveBoardSnapshot, updateBoardMeta, updateOwnSettings, saveBoardVersion, listBoardVersions, loadBoardVersionDoc, fetchPrevVersion, fetchNextVersion } from './lib/boardsApi.js';
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
  // Idle prefetch: warm the top 8 most-recently-updated boards in
  // the background so first-click navigation is instant. Stops on
  // first user interaction.
  const idlePrefetchList = useMemo(() => {
    const arr = Object.values(boards || {});
    arr.sort((a, b) =>
      String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')));
    return arr;
  }, [boards]);
  useIdlePrefetch(idlePrefetchList);
  const feedback = useFeedback();
  const sessionKey = `${SESSION_PREFIX}${user.id}.${workspace.id}`;
  const [initialSession] = useState(() => readSession(sessionKey));

  // On cold start, always open at the root board (the "first layer"). Don't
  // restore a deep nav stack — users find it disorienting to land 4 boards
  // deep on reload, especially when the in-between context (which sub-board
  // they were comparing) has decayed from memory. Session-storage still
  // restores splitId / viewOverride / splitRatio below.
  const [stack, setStack] = useState(() => [rootBoard.id]);
  const [viewOverride, setViewOverride] = useState(() => initialSession?.viewOverride || {});
  const [pickerOpen, setPickerOpen] = useState(false);
  // Workspace switcher popover (in the sidebar header). Click-outside +
  // Escape close it; selecting a workspace also closes.
  const [wsMenuOpen, setWsMenuOpen] = useState(false);
  // Two separate panels:
  //   accountOpen  — avatar (bottom-left, your initial) → identity only
  //                  (Profile tab + sign out)
  //   settingsOpen — cog (bottom-left, gear) → workspace defaults +
  //                  theme + templates + display
  const [accountOpen, setAccountOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  // Pull the user's saved profile so display name + color overrides the
  // email-derived defaults. Refetch when the AccountSettings modal closes
  // (user may have just saved). Falls back gracefully if the row is empty.
  const [ownProfile, setOwnProfile] = useState(null);
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    getOwnProfile()
      .then(p => { if (!cancelled) setOwnProfile(p || null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [user?.id, accountOpen]);

  const userInfo = useMemo(() => ({
    id: user.id,
    name: ownProfile?.display_name
       || user.user_metadata?.full_name
       || user.email?.split('@')[0],
    email: user.email,
    color: ownProfile?.color || undefined,
  }), [user.id, user.email, user.user_metadata?.full_name, ownProfile?.display_name, ownProfile?.color]);

  // Resolved defaults — workspace > user > hardcoded fallback. Drives every
  // addX mutator's initial values + the SettingsPanel UI. Stash in a ref
  // so mutators read the latest at call time without re-memo cascades.
  const { defaults, role: workspaceRole, refresh: refreshSettings,
          workspaceSettings, mySettings } = useResolvedDefaults({
    workspaceId: workspace?.id,
    userId: user?.id,
  });
  const defaultsRef = useRef(defaults);
  useEffect(() => { defaultsRef.current = defaults; }, [defaults]);

  // Apply per-user UI preferences on load + whenever they change.
  // Theme attribute, accent custom-property, body-font custom-property,
  // and the clean-mode body attribute all flow from mySettings.ui.
  // We also mirror to localStorage so the bootstrap script in index.html
  // can apply these before React mounts on the next page load (no flicker).
  useEffect(() => {
    const ui = mySettings?.ui || {};
    try { localStorage.setItem('soleil.ui', JSON.stringify(ui)); } catch (_) {}
    if (ui.theme) {
      document.documentElement.setAttribute('data-theme', ui.theme);
    }
    // We inject overrides into a single <style> element so changing
    // settings doesn't accumulate stale rules.
    let el = document.getElementById('user-theme-overrides');
    if (!el) {
      el = document.createElement('style');
      el.id = 'user-theme-overrides';
      document.head.appendChild(el);
    }
    const rules = [];
    if (ui.accent) {
      const hex = ui.accent;
      const r = parseInt(hex.slice(1,3), 16) || 212;
      const g = parseInt(hex.slice(3,5), 16) || 160;
      const b = parseInt(hex.slice(5,7), 16) || 74;
      rules.push(`:root, [data-theme='light'] {`
        + ` --soleil: ${hex};`
        + ` --soleil-soft: rgba(${r},${g},${b},.14);`
        + ` --soleil-glow: 0 0 24px rgba(${r},${g},${b},.18);`
        + ` --accent: ${hex};`
        + ` }`);
    }
    if (ui.fontSans) {
      rules.push(`:root, [data-theme='light'] { --font-sans: ${ui.fontSans}; }`);
    }
    el.textContent = rules.join('\n');

    // Clean mode body attribute
    if (ui.hideChrome) document.body.setAttribute('data-clean-mode', '1');
    else document.body.removeAttribute('data-clean-mode');
  }, [mySettings]);

  // ⌘. toggles clean mode quickly. Persists via merge_profile_settings.
  useEffect(() => {
    const onKey = (e) => {
      const isMac = navigator.platform?.toLowerCase().includes('mac');
      const cmd = isMac ? e.metaKey : e.ctrlKey;
      if (cmd && e.key === '.') {
        e.preventDefault();
        const cur = mySettings?.ui?.hideChrome;
        // Optimistic — toggle the body attribute now, persist async.
        if (!cur) document.body.setAttribute('data-clean-mode', '1');
        else document.body.removeAttribute('data-clean-mode');
        updateOwnSettings({ ui: { ...(mySettings.ui || {}), hideChrome: !cur } })
          .then(() => refreshSettings?.())
          .catch(() => {});
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mySettings, refreshSettings]);

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
    const groupsMap = () => ydoc.getMap('groups');

    const nextZ = () => {
      const m = cardsMap(); if (!m) return 1;
      let max = 0; m.forEach(ym => { const z = ym.get('z') || 0; if (z > max) max = z; });
      return max + 1;
    };

    // Audit-metadata helpers: stamp createdBy/createdAt at insert time and
    // updatedBy/updatedAt on every mutation, in ISO-8601 + uid form. Used
    // by the right-click "Info" panel; replicated by Yjs to all peers.
    const nowIso = () => new Date().toISOString();
    const stampCreate = (card) => ({
      createdBy: user?.id || null,
      createdAt: nowIso(),
      updatedBy: user?.id || null,
      updatedAt: nowIso(),
      ...card,
    });
    const writeUpdateStamp = (ym) => {
      ym.set('updatedBy', user?.id || null);
      ym.set('updatedAt', nowIso());
    };

    const addCard = (card) => {
      const m = cardsMap(); if (!m) return;
      ydoc.transact(() => {
        const c = stampCreate({ z: nextZ(), ...card });
        m.set(c.id, cardToYMap(c));
      }, 'local');
    };

    const addCards = (cardsToAdd) => {
      const m = cardsMap(); if (!m || !cardsToAdd?.length) return;
      ydoc.transact(() => {
        let z = nextZ();
        for (const card of cardsToAdd) {
          const c = stampCreate({ z: z++, ...card });
          m.set(c.id, cardToYMap(c));
        }
      }, 'local');
    };

    const updateCard = (cardId, patch) => {
      const m = cardsMap(); if (!m) return;
      const ym = m.get(cardId); if (!ym) return;
      ydoc.transact(() => {
        for (const [k, v] of Object.entries(patch)) ym.set(k, v);
        writeUpdateStamp(ym);
      }, 'local');
    };

    const updateCards = (updates) => {
      const m = cardsMap(); if (!m || !updates?.length) return;
      ydoc.transact(() => {
        for (const { id, patch } of updates) {
          const ym = m.get(id); if (!ym) continue;
          for (const [k, v] of Object.entries(patch)) ym.set(k, v);
          writeUpdateStamp(ym);
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
      console.log('[delete] deleteCards start', {
        ids,
        boardIdsToCascade,
        boardThisIsOn: boardId,
      });
      // Pre-delete-board snapshot for THIS board (the one the card lives
      // on) so the boardcard itself comes back via time-travel undo. The
      // underlying sub-board is now soft-deleted (boardsApi.deleteBoard)
      // so its content is preserved automatically for 30 days; restoring
      // the boardcard plus calling restoreBoard() brings everything back.
      if (boardIdsToCascade.length && ydoc && boardId) {
        try {
          await saveBoardVersion(boardId, ydoc, {
            triggerKind: 'pre-bulk-delete',
            userId,
            label: 'pre-board-delete',
            opSummary: {
              action: 'delete-board-cards',
              card_count: boardIdsToCascade.length,
              soft_deleted_board_ids: boardIdsToCascade,
            },
          });
        } catch (_) {}
      }
      for (const bid of boardIdsToCascade) {
        try { await deleteBoard(bid); }
        catch (e) {
          console.error('[delete] deleteBoard failed', { bid, e });
        }
      }
      if (boardIdsToCascade.length) {
        console.log('[delete] refreshBoards after cascade');
        await refreshBoards();
      }
      const a = arrowsArr();
      const cardsBefore = m.size;
      ydoc.transact(() => {
        idSet.forEach(id => m.delete(id));
        if (a) {
          // An arrow endpoint can be a bare card id (legacy), a tagged
          // ref {type, id}, or a free {x,y} point. Only card refs cascade.
          const cardIdOf = (r) => {
            if (typeof r === 'string') return r;
            if (r && typeof r === 'object' && r.type === 'card') return r.id;
            return null;
          };
          for (let i = a.length - 1; i >= 0; i--) {
            const ar = a.get(i);
            const fromCard = cardIdOf(ar?.from ?? ar?.get?.('from'));
            const toCard   = cardIdOf(ar?.to   ?? ar?.get?.('to'));
            if ((fromCard && idSet.has(fromCard)) || (toCard && idSet.has(toCard))) a.delete(i, 1);
          }
        }
      }, 'local');
      const cardsAfter = m.size;
      const stillPresent = ids.filter(id => m.has(id));
      console.log('[delete] deleteCards done', {
        ids, cardsBefore, cardsAfter, stillPresent,
      });
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

    // ── Card grouping ──────────────────────────────────────────────
    // Each group is a Y.Map keyed by groupId in `ydoc.getMap('groups')`
    // with { id, name, outline:bool, color, width }. Cards reference
    // a group by setting `groupId` on the card row.
    const createGroup = ({ name, cardIds, outline = false } = {}) => {
      if (!cardIds?.length) return null;
      const m = cardsMap(); const gm = groupsMap();
      if (!m || !gm) return null;
      const id = `g-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      ydoc.transact(() => {
        const g = new Y.Map();
        g.set('id', id);
        g.set('name', (name || 'Group').slice(0, 80));
        g.set('outline', !!outline);
        g.set('color', null);
        g.set('width', 1);
        g.set('createdAt', Date.now());
        g.set('createdBy', user?.id || null);
        gm.set(id, g);
        for (const cid of cardIds) {
          const ym = m.get(cid); if (!ym) continue;
          ym.set('groupId', id);
        }
      }, 'local');
      return id;
    };
    const ungroup = (groupId) => {
      if (!groupId) return;
      const m = cardsMap(); const gm = groupsMap();
      if (!m || !gm) return;
      const a = arrowsArr();
      ydoc.transact(() => {
        m.forEach((ym) => { if (ym.get('groupId') === groupId) ym.set('groupId', null); });
        gm.delete(groupId);
        // Cascade: drop any arrows that pointed at this group.
        if (a) {
          for (let i = a.length - 1; i >= 0; i--) {
            const ar = a.get(i);
            const ref = (r) => r && typeof r === 'object' && r.type === 'group' && r.id === groupId;
            if (ref(ar?.from) || ref(ar?.to)) a.delete(i, 1);
          }
        }
      }, 'local');
    };
    const renameGroup = (groupId, name) => {
      if (!groupId) return;
      const gm = groupsMap(); const g = gm?.get(groupId); if (!g) return;
      ydoc.transact(() => { g.set('name', String(name || '').slice(0, 80)); }, 'local');
    };
    const setGroupOutline = (groupId, patch) => {
      if (!groupId) return;
      const gm = groupsMap(); const g = gm?.get(groupId); if (!g) return;
      ydoc.transact(() => {
        if ('outline' in patch) g.set('outline', !!patch.outline);
        if ('color'   in patch) g.set('color', patch.color);
        if ('width'   in patch) g.set('width', patch.width);
        // 'box' = single rounded rect around the bounding box.
        // 'hug' = per-card rounded rects whose outlines merge where
        //         cards are close. Follows the contour of the cluster.
        if ('shape'   in patch) g.set('shape', patch.shape);
        // Misc per-group options (e.g. hideLabel). Stored as a plain
        // object — Yjs will serialize/replicate it shallowly.
        if ('options' in patch) g.set('options', patch.options);
      }, 'local');
    };
    const addToGroup = (groupId, cardIds) => {
      if (!groupId || !cardIds?.length) return;
      const m = cardsMap(); if (!m) return;
      ydoc.transact(() => {
        for (const cid of cardIds) {
          const ym = m.get(cid); if (!ym) continue;
          ym.set('groupId', groupId);
        }
      }, 'local');
    };
    const removeFromGroup = (cardIds) => {
      if (!cardIds?.length) return;
      const m = cardsMap(); if (!m) return;
      ydoc.transact(() => {
        for (const cid of cardIds) {
          const ym = m.get(cid); if (!ym) continue;
          ym.set('groupId', null);
        }
      }, 'local');
    };

    const addArrow = (fromId, toId, opts = {}) => {
      if (!fromId || !toId) return;
      // Compare by anchor identity, not object identity — refs may be
      // bare strings (card id) or tagged objects ({type, id}).
      const idOf  = (r) => typeof r === 'string' ? r : r?.id;
      const typeOf = (r) => typeof r === 'string' ? 'card' : (r?.type || 'card');
      if (typeOf(fromId) === typeOf(toId) && idOf(fromId) === idOf(toId)) return;
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
    // Replace an arrow at `index` with a merged copy. Used by the
    // arrow right-click menu (label, dashed, straight, double-sided).
    const updateArrow = (index, patch) => {
      const a = arrowsArr(); if (!a) return;
      if (index < 0 || index >= a.length) return;
      const cur = a.get(index) || {};
      ydoc.transact(() => {
        a.delete(index, 1);
        a.insert(index, [{ ...cur, ...patch }]);
      }, 'local');
    };

    const addShape = (clickPos = null, opts = {}) => {
      const d = defaultsRef.current?.shape || {};
      const w = opts.w || d.w || 160, h = opts.h || d.h || 100;
      const x = clickPos ? Math.round(clickPos.x - w/2) : 60;
      const y = clickPos ? Math.round(clickPos.y - h/2) : 60;
      addCard({
        id: `shape-${Date.now()}`, kind: 'shape',
        shape: opts.shape || d.shape || 'rect',
        stroke: opts.stroke || d.stroke || '#f5f5f6',
        fill: opts.fill || d.fill || 'transparent',
        strokeWidth: opts.strokeWidth || d.strokeWidth || 2,
        dash: opts.dash || d.dash || 'solid',
        x: Math.max(8, x), y: Math.max(8, y), w, h,
      });
    };

    const addPalette = (clickPos = null) => {
      const d = defaultsRef.current?.palette || {};
      const w = d.w || 280, h = d.h || 130;
      const x = clickPos ? Math.round(clickPos.x - w/2) : 60;
      const y = clickPos ? Math.round(clickPos.y - h/2) : 60;
      const id = `pal-${Date.now()}`;
      addCard({
        id, kind: 'palette', title: 'Palette',
        swatches: Array.isArray(d.swatches) && d.swatches.length
          ? d.swatches
          : [{ name: 'Color', hex: '#3b82f6' }, { name: 'Color', hex: '#10b981' }],
        x: Math.max(8, x), y: Math.max(8, y), w, h,
      });
      setAutoFocusId(id);
    };

    const addDocCard = (clickPos = null) => {
      const d = defaultsRef.current?.doc || {};
      const w = d.w || 320, h = d.h || 240;
      const x = clickPos ? Math.round(clickPos.x - w/2) : 60;
      const y = clickPos ? Math.round(clickPos.y - h/2) : 60;
      const id = `doc-${Date.now()}`;
      addCard({
        id, kind: 'doc', title: 'Untitled doc',
        ...(d.fontFamily ? { fontFamily: d.fontFamily } : null),
        x: Math.max(8, x), y: Math.max(8, y), w, h,
      });
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

    // Set the cover tint of any board (passed boardId) so the bar at the
    // bottom of its card + the sidebar dot adopt the chosen accent. Tint
    // value is the COVER_TINTS key (neutral/warm/cool/sun/dusk/sand/sea).
    const setBoardCover = async (targetBoardId, cover) => {
      try {
        await updateBoardMeta(targetBoardId, { cover: cover || null });
        await refreshBoards();
      } catch (e) {
        console.error('setBoardCover failed', e);
        feedback.toast({ type: 'error', message: 'Could not set cover: ' + (e.message || e) });
      }
    };

    const addNote = (clickPos = null) => {
      // Notes default to no background — they read as floating text on
      // the canvas instead of a sticky-note slab. The user can repaint
      // any note from the bottom toolbar's color picker, or set a
      // workspace-wide default in Settings → Defaults → Notes.
      const d = defaultsRef.current?.note || {};
      const w = d.w || 200, h = d.h || 200;
      const x = clickPos ? Math.round(clickPos.x - w/2) : 60;
      const y = clickPos ? Math.round(clickPos.y - h/2) : 60;
      const id = `note-${Date.now()}`;
      addCard({
        id, kind: 'note', html: '',
        ...(d.bgColor ? { bgColor: d.bgColor } : null),
        ...(d.textColor ? { textColor: d.textColor } : null),
        ...(d.fontFamily ? { fontFamily: d.fontFamily } : null),
        ...(d.fontSize ? { fontSize: d.fontSize } : null),
        x: Math.max(8, x), y: Math.max(8, y), w, h,
      });
      setAutoFocusId(id);
    };
    const addTextLink = addNote; // identical for now
    const dropImageBlob = ({ id, publicUrl, width, height, x, y }) => {
      let w = 240, h = 200;
      if (width && height) {
        const ar = width / height;
        if (ar >= 1) { w = 280; h = Math.round(280 / ar); }
        else { h = 240; w = Math.round(240 * ar); }
        h = Math.max(80, Math.min(360, h));
        w = Math.max(80, Math.min(420, w));
      }
      addCard({
        id: id || `img-${Date.now()}`, kind: 'image', src: publicUrl,
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
        // Pre-generate the card id so it can be stamped onto the
        // images row (lets card_index recover src later if needed)
        // and so dropImageBlob uses the same id, keeping the card
        // ↔ image link consistent end-to-end.
        const cardId = `img-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
        try {
          const up = await uploadImage({ file: f, workspaceId: workspace.id, boardId: boardId, cardId, userId: user.id });
          dropImageBlob({ ...up, id: cardId, x: clickPos?.x, y: clickPos?.y });
        } catch (e) {
          console.error(e);
          feedback.toast({ type: 'error', message: 'Image upload failed: ' + (e.message || e) });
        }
      };
      input.click();
    };

    const addNewBoard = async (clickPos = null, opts = {}) => {
      const d = defaultsRef.current?.board || {};
      const view = opts.view || d.view || 'canvas';
      const defaultName = view === 'list' ? 'Untitled list' : 'Untitled board';
      try {
        const b = await createBoard({
          workspaceId: workspace.id,
          parentBoardId: boardId,
          name: defaultName, view, userId: user.id,
          cover: d.cover && d.cover !== 'neutral' ? d.cover : undefined,
        });
        const w = d.w || 280, h = d.h || 220;
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
    const canUndo = () => !!(undoManager && undoManager.undoStack.length > 0);
    const canRedo = () => !!(undoManager && undoManager.redoStack.length > 0);

    return {
      updateCard, updateCards, deleteCard, deleteCards,
      duplicateCard, duplicateCards, addCard, addCards, bringToFront,
      createGroup, ungroup, renameGroup, setGroupOutline,
      addToGroup, removeFromGroup,
      addArrow, addFreeArrow, deleteArrows, updateArrow,
      addNote, addTextLink, addImageAt, addNewBoard, addPalette,
      addDocCard,
      addShape, addStroke, replaceStrokes, deleteStroke, deleteStrokes, clearStrokes,
      setBoardBgColor,
      setBoardCover,
      // Workspace-scoped mutators (rename, delete, clone) close over outer
      // scope and are filled in below since they don't need ydoc.
      undo, redo, canUndo, canRedo,
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

  // ── Reconcile drift the OTHER way: orphan board / boardlink cards on
  // the canvas that point at a board id no longer in the workspace's
  // boards table. These appear as "Missing board" tiles (or "No
  // access" lock for boardlinks) and the user can't delete them
  // because deleteBoard returns count:0. Sweep them out automatically.
  // Only fires once boards has fully loaded so we don't nuke cards
  // that just haven't synced yet.
  // Orphan cards (board / boardlink references whose target id isn't in
  // the workspace's boards table) are HIDDEN at the render layer rather
  // than deleted from the Y.Doc.
  //
  // History: we used to delete them via m.delete() on every sweep. That
  // worked reliably for cards we ourselves added on the same session,
  // but produced a render-loop in two real scenarios:
  //   1. A peer (or the user's other tab) holds the card in their state
  //      and the y-partykit sync re-adds it faster than we delete it.
  //   2. The Y.Map key drifts from value.id — m.delete(card.id) becomes
  //      a silent no-op, sweep finds the same orphan again, repeat.
  // Either way the visible symptom was a board card flashing on and off
  // forever. Hiding instead of deleting sidesteps both: the data stays,
  // sync doesn't fight us, and if access is later restored the card
  // simply reappears.
  //
  // Filtering happens in `currentCards` below — see useMemo there.

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
      // createWorkspace now atomically inserts workspace + member +
      // root board via the create_workspace_with_root RPC, so no
      // separate createBoard call is needed.
      const ws = await createWorkspace({ name: name.trim(), userId: user.id });
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

  const promptRenameWorkspace = async (ws) => {
    const next = await feedback.prompt({
      title: 'Rename workspace',
      label: 'Name',
      defaultValue: ws.name || '',
      placeholder: 'e.g. Soleil Studio',
      confirmLabel: 'Rename',
    });
    if (next == null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === ws.name) return;
    try {
      await renameWorkspace(ws.id, trimmed);
      await onWorkspacesChanged?.();
      feedback.toast({ type: 'success', message: `Renamed to "${trimmed}".` });
    } catch (e) {
      console.error('renameWorkspace failed', e);
      feedback.toast({ type: 'error', message: 'Rename failed: ' + (e.message || e) });
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
  //   'board' = existing canvas/doc surface; 'home' = HomeGraph;
  //   'tag'   = TagDetailView keyed by activeTag
  const [activeTag, setActiveTag] = useState(null); // tag row {id,name,color,...} or null
  const openTagSurface = (tag) => {
    setActiveTag(tag);
    setCurrentSurface('tag');
  };
  // Workspace tags drive the sidebar Tags section. We pass the same
  // list down so the count badges + sort ordering line up with the
  // canvas chip surfaces.
  const wsTagsForSidebar = useWorkspaceTags({ workspaceId: workspace.id, boardId: null });

  // Tag suggester. AI engine on by default; legacy TF-IDF stays available
  // as a fallback if anyone explicitly opts out (`localStorage.soleil.ai_tagger = '0'`).
  // Both hooks accept null workspaceId as a no-op so the inactive one
  // doesn't waste resources.
  const aiTaggerEnabled = isAiTaggerEnabled();
  const legacy = useAutotagWorker(aiTaggerEnabled ? null : workspace.id);
  const ai = useAiTagger(aiTaggerEnabled ? workspace.id : null);
  const { suggestTags: autotagSuggest, ready: autotagReady } = aiTaggerEnabled ? ai : legacy;

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
  // "Linked from" side drawer for the currently-viewed board (or any
  // entity surfaced by other components via setBacklinksRef).
  const [backlinksRef, setBacklinksRef] = useState(null);

  // Permalink target (drives MessagesPanel for ?to=m:<uuid> / legacy
  // ?m=<uuid>). Other ref kinds navigate via setStack + custom events.
  const [permalinkTarget, setPermalinkTarget] = useState(null);  // { messageId, openThread }

  // Open a message thread by id. Used by both the URL resolver and
  // the EntityNavigate provider for { kind:'message' } refs.
  const openMessageThread = React.useCallback(async (messageId) => {
    if (!messageId || !user?.id) return;
    try {
      const row = await fetchMessageById(messageId);
      if (!row) return;
      let openThread;
      if (row.board_id) {
        openThread = { kind: 'board', boardId: row.board_id, name: boards[row.board_id]?.name || 'Board' };
      } else if (row.dm_peer_id) {
        const peerId = row.sender_id === user.id ? row.dm_peer_id : row.sender_id;
        openThread = { kind: 'dm', peerId, name: 'Direct message' };
      } else { return; }
      setPermalinkTarget({ messageId, openThread });
      setTweak('showMessages', true);
    } catch (e) { console.warn('message permalink resolve failed', e); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, boards, setTweak]);

  // ?to=<token> / ?m=<id> — universal entity permalink resolver.
  // Resolves once on mount (after user is ready) and strips the param
  // so refresh doesn't re-trigger. Each kind dispatches via the
  // EntityNavigate provider below.
  useEffect(() => {
    const ref = refFromCurrentUrl();
    if (!ref || !user?.id) return;
    let cancelled = false;
    (async () => {
      // Defer one tick so the EntityNavigate provider is mounted.
      await new Promise(r => setTimeout(r, 0));
      if (cancelled) return;
      // Inline dispatch — we can't use the hook here (we're outside
      // the provider), so call the same handlers directly.
      switch (ref.kind) {
        case 'message': await openMessageThread(ref.id); break;
        case 'board':   if (boards[ref.id]) setStack([ref.id]); break;
        case 'card':    if (boards[ref.boardId]) setStack([ref.boardId]); break;
        case 'doc':
        case 'docPos': {
          let boardId = ref.boardId;
          if (!boardId) {
            try {
              const { data } = await supabase.from('card_index').select('board_id').eq('card_id', ref.docCardId).maybeSingle();
              boardId = data?.board_id;
            } catch (_) {}
          }
          if (boardId && boards[boardId]) setStack([boardId]);
          if (ref.pageId) {
            try { sessionStorage.setItem(`soleil.boards.docActivePage.${ref.docCardId}`, ref.pageId); } catch (_) {}
          }
          setTimeout(() => {
            document.dispatchEvent(new CustomEvent('soleil-open-doc-card', {
              detail: { cardId: ref.docCardId, pageId: ref.pageId || null, anchor: ref.anchor || null, scrollTop: 0 },
            }));
          }, 200);
          break;
        }
        case 'url': window.open(ref.href, '_blank', 'noopener,noreferrer'); break;
        default: break;
      }
      stripLinkParamsFromUrl();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Navigate handlers exposed to every linking surface via
  // EntityNavigateProvider. Mirror of the URL resolver above; this
  // version is what `<EntityLink onClick>` and other in-app callers
  // invoke. Keep both in sync.
  const navHandlers = useMemo(() => ({
    board:   (ref) => { if (boards[ref.id]) { setStack([ref.id]); recents.push(ref.id); } },
    card: async (ref) => {
      // Resolve missing boardId via card_index — the "appears in"
      // rows for canvas cards only carry cardId.
      let boardId = ref.boardId;
      if (!boardId && ref.cardId) {
        try {
          const { data } = await supabase.from('card_index').select('board_id').eq('card_id', ref.cardId).maybeSingle();
          boardId = data?.board_id;
        } catch (_) {}
      }
      if (!boardId || !boards[boardId]) return;
      setStack([boardId]);
      recents.push(boardId);
      if (ref.cardId) {
        // Tell the canvas to flash this card once the new board mounts.
        setTimeout(() => {
          document.dispatchEvent(new CustomEvent('soleil-flash-card', {
            detail: { boardId, cardId: ref.cardId },
          }));
        }, 200);
      }
    },
    doc: async (ref) => {
      let boardId = ref.boardId;
      if (!boardId) {
        try {
          const { data } = await supabase.from('card_index').select('board_id').eq('card_id', ref.docCardId).maybeSingle();
          boardId = data?.board_id;
        } catch (_) {}
      }
      if (boardId && boards[boardId]) { setStack([boardId]); recents.push(boardId); }
      setTimeout(() => {
        document.dispatchEvent(new CustomEvent('soleil-open-doc-card', {
          detail: { cardId: ref.docCardId, pageId: null, scrollTop: 0 },
        }));
      }, 200);
    },
    docPos: async (ref) => {
      let boardId = ref.boardId;
      if (!boardId) {
        try {
          const { data } = await supabase.from('card_index').select('board_id').eq('card_id', ref.docCardId).maybeSingle();
          boardId = data?.board_id;
        } catch (_) {}
      }
      if (boardId && boards[boardId]) { setStack([boardId]); recents.push(boardId); }
      if (ref.pageId) {
        try { sessionStorage.setItem(`soleil.boards.docActivePage.${ref.docCardId}`, ref.pageId); } catch (_) {}
      }
      setTimeout(() => {
        document.dispatchEvent(new CustomEvent('soleil-open-doc-card', {
          detail: { cardId: ref.docCardId, pageId: ref.pageId || null, anchor: ref.anchor || null, scrollTop: 0 },
        }));
      }, 200);
    },
    message: (ref) => openMessageThread(ref.id),
    user: (ref) => {
      // Phase 1 will open a user-card popover. For now, opening the
      // messages panel is the closest existing affordance.
      setTweak('showMessages', true);
    },
    url: (ref) => { window.open(ref.href, '_blank', 'noopener,noreferrer'); },
    group: async (ref) => {
      // Resolve boardId via group_index if not provided.
      let boardId = ref.boardId;
      if (!boardId && ref.id) {
        try {
          const { data } = await supabase.from('group_index').select('board_id').eq('group_id', ref.id).maybeSingle();
          boardId = data?.board_id;
        } catch (_) {}
      }
      if (!boardId || !boards[boardId]) return;
      setStack([boardId]); recents.push(boardId);
      // Flash every member card once the board mounts.
      setTimeout(() => {
        document.dispatchEvent(new CustomEvent('soleil-flash-group', {
          detail: { boardId, groupId: ref.id },
        }));
      }, 250);
    },
  }), [boards, recents, openMessageThread, setTweak]);

  // Surface "X shared a board with you" notifications as toasts on
  // first load. Each toast has a "View" action that opens the board
  // and dismisses; otherwise we batch-dismiss after the initial toast
  // pass so they don't re-fire forever.
  const { unread: shareNotifs, dismiss: dismissNotif, dismissAll: dismissAllNotifs } = useShareNotifications(user.id);
  // Mention notifications — fired by the messages_fire_mention_
  // notifications trigger (migration 0020). Same toast-on-mount UX
  // as share notifications.
  const { unread: mentionNotifs, dismissAll: dismissAllMentionNotifs } = useMentionNotifications(user.id);
  const surfacedMentionsRef = React.useRef(new Set());
  useEffect(() => {
    for (const n of (mentionNotifs || [])) {
      if (surfacedMentionsRef.current.has(n.id)) continue;
      surfacedMentionsRef.current.add(n.id);
      const where = n.board_id
        ? (boards[n.board_id]?.name || 'a board')
        : 'a direct message';
      feedback.toast({
        type: 'info',
        message: `You were mentioned in ${where}. Open Messages to see it.`,
      });
    }
    if (mentionNotifs && mentionNotifs.length > 0) {
      const t = setTimeout(() => dismissAllMentionNotifs(), 8000);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mentionNotifs]);
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
    // Broadcast the user's CHOSEN color (from Account settings). The
    // pickPresenceColor hash was a fallback when no custom color was
    // saved — using it here meant peers always saw the deterministic
    // color even after the user picked their own.
    user: { id: user.id, name: userInfo.name, email: user.email, color: userInfo.color || pickPresenceColor(user.id) },
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

  // "Linked from" affordances anywhere in the app dispatch
  // soleil-open-backlinks. Card right-click menus, message bubbles,
  // and any future surface can fire it; the side drawer mounts here
  // so any caller can open the panel without prop-drilling.
  useEffect(() => {
    const onOpen = (e) => {
      const { ref, name } = e.detail || {};
      if (ref) setBacklinksRef({ ...ref, _name: name || null });
    };
    document.addEventListener('soleil-open-backlinks', onOpen);
    return () => document.removeEventListener('soleil-open-backlinks', onOpen);
  }, []);

  // Right-click "open tag" chips and other prop-drill-less callers
  // dispatch soleil-open-tag { tagId }. Resolve to the tag row and
  // open the tag detail surface.
  useEffect(() => {
    const onOpen = (e) => {
      const { tagId } = e.detail || {};
      if (!tagId) return;
      const tag = (wsTagsForSidebar.tags || []).find(t => t.id === tagId);
      if (tag) openTagSurface(tag);
    };
    document.addEventListener('soleil-open-tag', onOpen);
    return () => document.removeEventListener('soleil-open-tag', onOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsTagsForSidebar.tags]);

  // Drag-onto-board: CanvasSurface fires this when a card drag releases
  // over a board card. We load the target board's snapshot, inject the
  // dragged cards (with relative positions preserved), and save back.
  // The source canvas already deletes the dragged cards on its end.
  // Plus we move:
  //  • Groups — any unique group id referenced by a moved card gets
  //    cloned into the target (fresh id, same name + options).
  //  • Arrows — only those whose BOTH endpoints are in the moved set
  //    (otherwise they'd dangle); endpoint card ids are remapped.
  //  • Comments — comments anchored to a moved card are repointed to
  //    the new card id and the new board_id via a single supabase
  //    update.
  useEffect(() => {
    const onDrop = async (e) => {
      const { sourceBoardId, targetBoardId, cards: movedCards } = e.detail || {};
      if (!sourceBoardId || !targetBoardId || !movedCards?.length) return;
      if (sourceBoardId === targetBoardId) return;
      try {
        // ── ID remapping ──
        const stamp = Date.now().toString(36);
        const movedIds = new Set(movedCards.map(c => c.id));
        const idMap = {};       // oldCardId → newCardId
        const groupMap = {};    // oldGroupId → newGroupId
        for (const c of movedCards) {
          idMap[c.id] = `${c.id}-${stamp}-${Math.floor(Math.random()*1e4).toString(36)}`;
        }
        // Source groups + arrows live on the active ydoc (the user is
        // dragging from THIS board). Snapshot them now so async work
        // below doesn't see partial mutations.
        const sourceGroups = (() => {
          const out = [];
          if (!currentYDoc || sourceBoardId !== currentBoard?.id) return out;
          try {
            const gm = currentYDoc.getMap('groups');
            const usedGroupIds = new Set();
            for (const c of movedCards) if (c.groupId) usedGroupIds.add(c.groupId);
            gm.forEach((g, gid) => {
              if (!usedGroupIds.has(gid)) return;
              const obj = {
                id:        gid,
                name:      g?.get?.('name')   ?? g?.name   ?? '',
                outline:   g?.get?.('outline') ?? g?.outline ?? false,
                color:     g?.get?.('color')   ?? g?.color   ?? null,
                width:     g?.get?.('width')   ?? g?.width   ?? 1,
                options:   g?.get?.('options') ?? g?.options ?? null,
              };
              out.push(obj);
            });
          } catch (_) {}
          return out;
        })();
        for (const g of sourceGroups) {
          groupMap[g.id] = `g-${stamp}-${Math.floor(Math.random()*1e4).toString(36)}`;
        }
        const sourceArrows = (() => {
          const out = [];
          if (!currentYDoc || sourceBoardId !== currentBoard?.id) return out;
          try {
            const ar = currentYDoc.getArray('arrows');
            ar.forEach((a) => {
              const fromId = typeof a?.from === 'string' ? a.from : a?.from?.cardId;
              const toId   = typeof a?.to   === 'string' ? a.to   : a?.to?.cardId;
              if (movedIds.has(fromId) && movedIds.has(toId)) {
                out.push({ ...a });
              }
            });
          } catch (_) {}
          return out;
        })();

        // ── Bbox + relative-layout offset ──
        let minX = Infinity, minY = Infinity;
        for (const c of movedCards) {
          if ((c.x ?? 0) < minX) minX = c.x ?? 0;
          if ((c.y ?? 0) < minY) minY = c.y ?? 0;
        }
        if (!isFinite(minX)) minX = 0;
        if (!isFinite(minY)) minY = 0;
        // Land the bundle at (60,60) in the target — close enough that
        // the user opening the board sees it without it feeling pinned.
        const dx = 60 - minX;
        const dy = 60 - minY;

        const snap = await loadBoardSnapshot(targetBoardId);
        // CRITICAL: if loadBoardSnapshot returns null/empty for a board
        // that already exists, we'd start with an empty tmp Y.Doc and
        // overwrite the live state with only the moved cards — wiping
        // every existing card on the target. Refuse the move and surface
        // a clear error so the user can retry rather than lose data.
        if (!snap) {
          console.error('[cross-board-move] aborting: target board_state is empty', { targetBoardId, sourceBoardId });
          feedback.toast({
            type: 'error',
            message: 'Could not load the destination board’s state. Drag cancelled to prevent data loss. Try again in a moment.',
            duration: 8000,
          });
          return;
        }
        const tmp = new Y.Doc();
        Y.applyUpdate(tmp, b64ToBytes(snap));
        const targetCardCountBefore = tmp.getMap('cards').size;
        // Pre-drop snapshot for the TARGET board — ALWAYS, regardless of
        // whether snap was non-empty (always is now thanks to the abort
        // above, but be defensive). Captures target state right before
        // we mutate it.
        try {
          await saveBoardVersion(targetBoardId, tmp, {
            triggerKind: 'pre-drop',
            sessionId: yb?.sessionId || null,
            userId: user?.id || null,
            label: 'pre-drop-target',
            opSummary: {
              action: 'receive-cross-board-drop',
              from_board: sourceBoardId,
              card_count: movedCards.length,
              target_card_count_before: targetCardCountBefore,
            },
          });
        } catch (_) {}

        tmp.transact(() => {
          // Groups first so cards can reference their new ids.
          if (sourceGroups.length) {
            const tgm = tmp.getMap('groups');
            for (const g of sourceGroups) {
              const newId = groupMap[g.id];
              const ym = new Y.Map();
              ym.set('id', newId);
              ym.set('name', g.name);
              ym.set('outline', !!g.outline);
              ym.set('color', g.color);
              ym.set('width', g.width || 1);
              if (g.options) ym.set('options', g.options);
              ym.set('createdAt', Date.now());
              ym.set('createdBy', user?.id || null);
              tgm.set(newId, ym);
            }
          }
          // Cards — remap groupId, preserve relative layout.
          const tcm = tmp.getMap('cards');
          for (const c of movedCards) {
            const newId = idMap[c.id];
            const fresh = {
              ...c,
              id: newId,
              x: Math.round((c.x ?? 0) + dx),
              y: Math.round((c.y ?? 0) + dy),
              groupId: c.groupId && groupMap[c.groupId] ? groupMap[c.groupId] : null,
              createdAt: new Date().toISOString(),
            };
            tcm.set(newId, cardToYMap(fresh));
          }
          // Arrows — only those connecting moved cards.
          if (sourceArrows.length) {
            const tar = tmp.getArray('arrows');
            for (const a of sourceArrows) {
              const fromId = typeof a.from === 'string' ? a.from : a.from?.cardId;
              const toId   = typeof a.to   === 'string' ? a.to   : a.to?.cardId;
              if (!idMap[fromId] || !idMap[toId]) continue;
              const next = { ...a };
              if (typeof a.from === 'string') next.from = idMap[fromId];
              else next.from = { ...a.from, cardId: idMap[fromId] };
              if (typeof a.to === 'string') next.to = idMap[toId];
              else next.to = { ...a.to, cardId: idMap[toId] };
              tar.push([next]);
            }
          }
        }, 'cross-board-move');
        // Final invariant check: tmp.cards must contain AT LEAST the
        // original target cards + the moved cards. If somehow it's
        // fewer (shouldn't happen — we only add to the map — but if
        // anything goes weird, abort instead of writing a wiped state).
        const tmpCardCount = tmp.getMap('cards').size;
        const expectedMin = targetCardCountBefore + movedCards.length;
        if (tmpCardCount < expectedMin) {
          console.error('[cross-board-move] aborting: tmp card count below expected', {
            tmpCardCount, expectedMin, targetCardCountBefore, moved: movedCards.length,
          });
          tmp.destroy();
          feedback.toast({
            type: 'error',
            message: 'Drag aborted — target board state looked unsafe to overwrite.',
            duration: 8000,
          });
          return;
        }
        await saveBoardSnapshot(targetBoardId, tmp);
        tmp.destroy();

        // ── Repoint attached comments ──
        // Track the exact comment-id → original-anchor mapping so the
        // Undo path can reverse it.
        const commentRedirects = []; // [{ id, oldAnchorId }]
        try {
          const oldCardIds = movedCards.map(c => c.id);
          // Pull the matching rows so we can update one at a time
          // (anchor_id needs to change per-row; supabase update doesn't
          // support a CASE-style remap in a single call).
          const { data: cmts, error: cErr } = await supabase
            .from('comments')
            .select('id, anchor_id')
            .eq('board_id', sourceBoardId)
            .is('deleted_at', null)
            .in('anchor_kind', ['card', 'group'])
            .in('anchor_id', [...oldCardIds, ...Object.keys(groupMap)]);
          if (cErr) throw cErr;
          for (const row of (cmts || [])) {
            const newAnchor = idMap[row.anchor_id] || groupMap[row.anchor_id];
            if (!newAnchor) continue;
            await supabase.from('comments').update({
              board_id: targetBoardId,
              anchor_id: newAnchor,
            }).eq('id', row.id);
            commentRedirects.push({ id: row.id, oldAnchorId: row.anchor_id });
          }
        } catch (cmtErr) {
          // Don't fail the whole drop if comments couldn't move —
          // log and let the user know.
          console.warn('comment move failed', cmtErr);
        }

        const targetName = boards[targetBoardId]?.name || 'board';
        const extras = [];
        if (sourceArrows.length) extras.push(`${sourceArrows.length} arrow${sourceArrows.length === 1 ? '' : 's'}`);
        if (sourceGroups.length) extras.push(`${sourceGroups.length} group${sourceGroups.length === 1 ? '' : 's'}`);
        const tail = extras.length ? ` (+${extras.join(', ')})` : '';

        // ── Undo handler: reverses everything (target snapshot mutates,
        //    source card restoration via current ydoc if user is still
        //    on the source board, and comment re-anchoring).
        const undoMove = async () => {
          try {
            // Reverse target: load snapshot, delete the cards/groups/
            // arrows we added, save back.
            const snap2 = await loadBoardSnapshot(targetBoardId);
            const tmp2 = new Y.Doc();
            if (snap2) Y.applyUpdate(tmp2, b64ToBytes(snap2));
            tmp2.transact(() => {
              const tcm2 = tmp2.getMap('cards');
              for (const newCardId of Object.values(idMap)) tcm2.delete(newCardId);
              const tgm2 = tmp2.getMap('groups');
              for (const newGroupId of Object.values(groupMap)) tgm2.delete(newGroupId);
              // Drop the cloned arrows. We push them at the END so we
              // can safely delete the last N entries — find where the
              // original arrows ended by counting from total length.
              const tar2 = tmp2.getArray('arrows');
              for (let i = 0; i < sourceArrows.length && tar2.length > 0; i++) {
                tar2.delete(tar2.length - 1, 1);
              }
            }, 'cross-board-undo');
            await saveBoardSnapshot(targetBoardId, tmp2);
            tmp2.destroy();

            // Reverse source: re-add the deleted cards if we're still
            // on the source board (currentYDoc points at it). If the
            // user has navigated away, load + patch its snapshot.
            if (sourceBoardId === currentBoard?.id && currentYDoc) {
              const tcm = currentYDoc.getMap('cards');
              currentYDoc.transact(() => {
                for (const c of movedCards) {
                  tcm.set(c.id, cardToYMap({ ...c }));
                }
              }, 'cross-board-undo');
            } else {
              const ssnap = await loadBoardSnapshot(sourceBoardId);
              const stmp = new Y.Doc();
              if (ssnap) Y.applyUpdate(stmp, b64ToBytes(ssnap));
              stmp.transact(() => {
                const scm = stmp.getMap('cards');
                for (const c of movedCards) scm.set(c.id, cardToYMap({ ...c }));
              }, 'cross-board-undo');
              await saveBoardSnapshot(sourceBoardId, stmp);
              stmp.destroy();
            }

            // Reverse comments: send each redirected row back to its
            // original anchor + source board.
            for (const r of commentRedirects) {
              await supabase.from('comments').update({
                board_id: sourceBoardId,
                anchor_id: r.oldAnchorId,
              }).eq('id', r.id);
            }

            feedback.toast({ type: 'success', message: 'Move undone.' });
          } catch (err) {
            console.error('cross-board undo failed', err);
            feedback.toast({ type: 'error', message: 'Undo failed: ' + (err.message || err) });
          }
        };

        feedback.toast({
          type: 'success',
          message: movedCards.length === 1
            ? `Moved into "${targetName}"${tail}.`
            : `Moved ${movedCards.length} cards into "${targetName}"${tail}.`,
          action: { label: 'Undo', onClick: undoMove },
          ttl: 8000,
        });
      } catch (err) {
        console.error('cross-board move failed', err);
        feedback.toast({ type: 'error', message: 'Move failed: ' + (err.message || err) });
      }
    };
    document.addEventListener('soleil-card-into-board-drop', onDrop);
    return () => document.removeEventListener('soleil-card-into-board-drop', onDrop);
  }, [boards, feedback, currentYDoc, currentBoard?.id, user?.id]);

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
  // Hide orphan board / boardlink cards at the render layer. See the
  // long comment in the orphan-sweep section above for why we filter
  // instead of deleting from the Y.Doc. Cheap O(n) filter — runs only
  // when cards or boards change.
  const isOrphanRef = (c) => {
    if (c.kind === 'board')     return !boards[c.id];
    if (c.kind === 'boardlink') return !boards[c.target];
    return false;
  };
  const currentCards = useMemo(() => {
    const all = ybReadyForCurrent ? yb.cards : [];
    if (boardsLoading) return all;             // don't hide before boards arrive
    if (!boards || Object.keys(boards).length === 0) return all;
    return all.filter(c => !isOrphanRef(c));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ybReadyForCurrent, yb.cards, boards, boardsLoading]);
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
    // Hide orphan board / boardlink references — see the comment above
    // currentCards. We filter at the render layer for both panes (main +
    // split) so a stale Y.Doc entry never produces a flashing card.
    const rawCards = ready ? yh.cards : [];
    const cards = (boardsLoading || !boards || Object.keys(boards).length === 0)
      ? rawCards
      : rawCards.filter(c => !isOrphanRef(c));
    const arrows = ready ? yh.arrows : [];
    const strokes = ready ? yh.strokes : [];
    const groups = ready ? (yh.groups || []) : [];
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
        <CanvasSurface board={board} boards={boards} cards={cards} arrows={arrows} strokes={strokes} groups={groups}
                       ydoc={yd}
                       getAwareness={yh.getAwareness}
                       peersHereByBoard={peersHereByBoard}
                       peersBelowByBoard={peersBelowByBoard}
                       wsPeers={wsPeers}
                       onJumpToPeer={jumpToPeer}
                       canEdit={isMain ? canEditCurrent : true}
                       currentUser={{
                         id: user.id, email: user.email,
                         // Always honor the saved profile when present —
                         // userInfo already merged display_name + custom
                         // color over the email-prefix and deterministic
                         // fallbacks. This way, if the user picked a
                         // color in Account settings, it's their color
                         // EVERYWHERE (presence avatars, comment author
                         // tints, peer-icon resolution, etc.) rather
                         // than reverting to a hash of their user id
                         // when they appear locally.
                         name: userInfo.name,
                         color: userInfo.color || pickPresenceColor(user.id),
                       }}
                       onOpenBoard={openBoard} tweak={tweak} depth={stack.length - 1}
                       onOpenPicker={() => setPickerOpen(true)}
                       onDropInboxItem={dropInboxItemFor(muts)}
                       onDropFileImage={dropFileImageFor(muts)}
                       workspaceId={workspace.id} userId={user.id}
                       personalWorkspaceId={personalWorkspaceId}
                       selectedTool={selectedTool} setSelectedTool={setSelectedTool}
                       mutators={muts} autoFocusId={autoFocusId} clearAutoFocus={clearAutoFocus}
                       autotagSuggest={autotagSuggest}
                       autotagReady={autotagReady}
                       sessionId={yh?.sessionId || null} />
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
    <EntityNavigateContext.Provider value={navHandlers}>
    <AppTrieProvider workspaceId={workspace.id}>
    <div className={`app ${tweak.compactSidebar ? 'sb-collapsed' : ''}`}
         data-screen-label={`Board · ${currentBoard.name}`}>
      {/* Clean-mode exit button — only renders while body[data-clean-mode='1'].
          CSS hides it otherwise. Click or press ⌘. to leave. */}
      <button className="clean-mode-exit"
              onClick={() => {
                document.body.removeAttribute('data-clean-mode');
                updateOwnSettings({ ui: { ...(mySettings.ui || {}), hideChrome: false } })
                  .then(() => refreshSettings?.())
                  .catch(() => {});
              }}
              title="Exit clean mode (⌘.)">
        Exit clean mode
      </button>
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
                onRemove={(ws, action) => removeWorkspace(ws, action)}
                onRename={(ws) => promptRenameWorkspace(ws)}
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
            onRenameBoard={renameBoardById}
            peersHereByBoard={peersHereByBoard}
            peersBelowByBoard={peersBelowByBoard}
            onJumpToPeer={jumpToPeer}
          />
          <div className="sb-row sb-row-all" onClick={() => setPickerOpen(true)}>
            <Icon as={MoreHorizontal} size={14} />
            <span className="sb-row-label">All boards</span>
          </div>

          <SidebarTags
            workspaceId={workspace.id}
            userId={user.id}
            tags={wsTagsForSidebar.tags}
            activeTagId={currentSurface === 'tag' ? activeTag?.id : null}
            onOpenTag={openTagSurface}
            onWorkspaceTagsChanged={wsTagsForSidebar.refresh}
          />

          {/* Footer — settings cog + avatar. Cog opens workspace
              settings (defaults, theme, templates, display). Avatar
              opens identity (name, presence color, sign out). */}
          <div className="sb-foot">
            <button className="sb-foot-icon" title="Workspace settings" aria-label="Workspace settings"
                    onClick={() => setSettingsOpen(true)}>
              <Icon as={Settings} size={14} />
            </button>
            <button className="sb-foot-avatar" title="Account"
                    onClick={() => setAccountOpen(true)}>
              {(user.email?.[0] || 'Y').toUpperCase()}
            </button>
          </div>
        </div>
      </aside>
      {/* Avatar → identity-only modal (Profile tab). */}
      <SettingsPanel
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        mode="account"
        user={user}
        onSignOut={signOut}
        workspaceId={workspace?.id}
        onWorkspacesChanged={onWorkspacesChanged}
        onSaved={() => onWorkspacesChanged?.()}
        defaults={defaults}
        role={workspaceRole}
        refresh={refreshSettings}
        workspaceSettings={workspaceSettings}
        mySettings={mySettings} />
      {/* Cog → workspace + UI settings (everything else). */}
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        mode="workspace"
        user={user}
        onSignOut={signOut}
        workspaceId={workspace?.id}
        onWorkspacesChanged={onWorkspacesChanged}
        onSaved={() => onWorkspacesChanged?.()}
        defaults={defaults}
        role={workspaceRole}
        refresh={refreshSettings}
        workspaceSettings={workspaceSettings}
        mySettings={mySettings} />

      <main className="main">
        <div className="topbar">
          <div className="tb-left">
            {tweak.compactSidebar && (
              <button className="tb-icon" title="Open sidebar (⌘B)" aria-label="Open sidebar"
                      onClick={() => setTweak('compactSidebar', false)}>
                <Icon as={PanelLeftOpen} size={16} />
              </button>
            )}
            <button className="tb-brand" title="Home" aria-label="Clusters home"
                    onClick={() => setCurrentSurface('home')}>
              <ClustersMark size={22} />
              <span className="tb-brand-text">Clusters</span>
            </button>
            <span className="tb-brand-sep" aria-hidden="true" />
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
            <WorkspacePresenceStack peers={wsPeers} status={wsStatus} selfId={user.id}
                                    workspaceId={workspace.id}
                                    onJumpTo={jumpToPeer} />
            <span className="tb-divider" aria-hidden="true" />
            {!canEditCurrent && (
              <span className="tb-viewonly" title="You have view-only access to this board">VIEW ONLY</span>
            )}
            <button className="tb-icon"
                    onClick={() => setBacklinksRef({ kind: 'board', id: currentBoard.id })}
                    title="Linked from — every doc, message, and card that mentions this board">
              <Icon as={LinkIcon} size={16} />
            </button>
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
        ) : currentSurface === 'tag' && activeTag ? (
          <TagDetailView
            tag={activeTag}
            workspaceId={workspace.id}
            userId={user.id}
            onClose={() => { setActiveTag(null); setCurrentSurface('board'); }}
            onOpenItem={(item) => {
              // Item is a row from get_things_tagged: { kind, board_id, card_id, ... }.
              // Resolve to the right surface and navigate.
              setActiveTag(null);
              setCurrentSurface('board');
              if (item.kind === 'board') {
                setStack([item.id]);
              } else if (item.board_id) {
                setStack([item.board_id]);
              }
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
        workspaceId={workspace.id}
        ydoc={currentYDoc}
        userId={user.id}
        wsPeers={wsPeers}
        onBoardRestored={() => refreshBoards()}
        onClose={() => setHistoryOpen(false)}
      />

      {tweak.showMessages && (
        <MessagesPanel
          workspaceId={workspace.id}
          currentUser={userInfo}
          currentBoard={currentBoard}
          refreshTick={msgRefreshTick}
          initialOpenThread={permalinkTarget?.openThread || null}
          jumpToMessageId={permalinkTarget?.messageId || null}
          onPermalinkConsumed={() => setPermalinkTarget(null)}
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
      {backlinksRef && (
        <EntityBacklinksPanel
          ref={backlinksRef}
          onClose={() => setBacklinksRef(null)}
        />
      )}

    </div>
    </AppTrieProvider>
    </EntityNavigateContext.Provider>
  );
}

// Workspace-scoped trie published into context so every linking
// surface (renderMessageBody, NoteCard rendering, card-title scanner)
// reads from one place.
function AppTrieProvider({ workspaceId, children }) {
  const { trie } = useEntityNameTrie(workspaceId);
  const value = useMemo(() => ({ trie, workspaceId }), [trie, workspaceId]);
  return (
    <EntityTrieContext.Provider value={value}>
      {children}
    </EntityTrieContext.Provider>
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
