// App.jsx — live data via Supabase + Yjs.
// Postgres is the source of truth for board metadata + hierarchy
// (parent_board_id). Each board's cards/arrows live in a Y.Doc whose
// snapshot is persisted to board_state.

import React, { useState, useEffect, useMemo, useRef, Profiler, Suspense } from 'react';
import { pickPresenceColor } from './lib/presenceColor.js';
import * as perf from './lib/perf.js';
import { isEditableTarget } from './lib/isEditableTarget.js';
import { useWorkspaceMembers } from './hooks/useWorkspaceMembers.js';
import { useSharedBoards } from './hooks/useSharedBoards.js';
import * as userProfiles from './lib/userProfiles.js';
import { useBoardPermission } from './hooks/useBoardPermission.js';
import { useMyTier } from './hooks/useMyTier.js';
import { UpgradeModal } from './components/UpgradeModal.jsx';
import { SurfaceErrorBoundary } from './components/SurfaceErrorBoundary.jsx';
import { OnboardingCoachmark } from './components/OnboardingCoachmark.jsx';
import { getStarterCards, getStarterTutorialCard, isShowcaseCard } from './lib/onboardingStarter.js';
import { decodeShowcaseCards } from './lib/showcaseClone.js';
import { genuineCards, isSeedCard, hasGenuineCard } from './lib/firstValueTrigger.js';
import { start as startFriction, stop as stopFriction } from './lib/frictionSignal.js';
import { FeedbackButton } from './components/FeedbackButton.jsx';
import { logEvent, logEventNow, logEventOnce, setEnrolledExperiments, getEnrolledArm } from './lib/analytics.js';
import { EV } from './lib/analyticsEvents.js';
import { getActiveExperiments, assignArm, drawArm } from './lib/experiments.js';
import { applyThemeNow, resolveTheme, currentTheme } from './lib/theme.js';
import { R2Image } from './components/R2Image.jsx';
import { useShareNotifications } from './hooks/useShareNotifications.js';
import { useResolvedDefaults } from './hooks/useResolvedDefaults.js';
import { useMentionNotifications } from './hooks/useMentionNotifications.js';
import { fetchMessageById } from './lib/messages.js';
import { EntityNavigateContext } from './hooks/useEntityNavigate.js';
import { OpenDmContext } from './hooks/useOpenDm.js';
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
import { ReadOnlyBanner } from './components/ReadOnlyBanner.jsx';
import { BoardPicker } from './components/BoardPicker.jsx';
import { Avatar, SoleilMark } from './components/primitives.jsx';
import { SoleilWordmark, ClustersMark } from './components/SoleilWordmark.jsx';
import { Icon } from './components/Icon.jsx';
import { Plus, PanelLeftClose, PanelLeftOpen, Search, LayoutGrid, Inbox as InboxIcon, Settings, Share2, Sun, Moon, Columns2, LogOut, Undo, Redo, Home, MessageSquare, Trash2, MoreHorizontal, Link as LinkIcon, ChevronLeft, ChevronRight } from './lib/icons.js';
import { EntityBacklinksPanel } from './components/EntityBacklinksPanel.jsx';
import { PresenceStack } from './components/PresenceStack.jsx';
import { TweaksPanel, TweakSection, TweakToggle, TweakRadio, useTweaks } from './components/TweaksPanel.jsx';
import { useAuth } from './auth/AuthGate.jsx';
import { useWorkspace } from './hooks/useWorkspace.js';
import { useAllWorkspaces } from './hooks/useAllWorkspaces.js';
import { useBoardList } from './hooks/useBoardList.js';
import { useIdlePrefetch } from './hooks/useIdlePrefetch.js';
import { useYBoard } from './hooks/useYBoard.js';
import { RENDER_VERSION as THUMB_VERSION } from './lib/renderThumbnail.js';
import { useConversationList } from './hooks/useConversationList.js';
import { useUnreadTotal } from './hooks/useUnreadTotal.js';
import { useTitleBadge } from './hooks/useTitleBadge.js';
import { useInboxLive } from './hooks/useInboxLive.js';
import { useRecents } from './hooks/useRecents.js';
import { useWorkspacePresence } from './hooks/useWorkspacePresence.js';
import { WorkspacePresenceStack } from './components/WorkspacePresenceStack.jsx';
import { MessagesPanel } from './components/MessagesPanel.jsx';
// Lazy: the ?local=1 / no-Supabase QA harness (and its deps — demo data,
// TweaksPanel, HomeGraph) should never ship in the eager production bundle.
const LocalBoardsApp = lazyWithReload(() => import('./local/LocalBoardsApp.jsx').then(m => ({ default: m.LocalBoardsApp })));
import { isLocalQaMode } from './lib/localMode.js';
import { isSupabaseConfigured, supabase, altSessionId } from './lib/supabase.js';
import { trackRegistration } from './lib/metaPixel.js';
import { createBoard, deleteBoard, restoreBoard, renameBoard, getRootBoard, createWorkspace, deleteWorkspace, leaveWorkspace, renameWorkspace, getOwnProfile, loadBoardSnapshot, saveBoardSnapshot, forceResetBoardRoom, updateBoardMeta, moveBoardsUnder, updateOwnSettings, saveBoardVersion, listBoardVersions, loadBoardVersionDoc, fetchPrevVersion, fetchNextVersion } from './lib/boardsApi.js';
import { planReparent } from './lib/boardTree.js';
import * as Y from 'yjs';
import { b64ToBytes } from './lib/yhelpers.js';
import { cardToYMap } from './lib/yhelpers.js';
import { evaluateDemoCap } from './lib/demoCardCap.js';
import { BOARD_REF_MIME } from './lib/dragMimes.js';
import { initCardDocStore } from './lib/docState.js';
import { uploadImage } from './lib/uploads.js';
import { TrashModal } from './components/TrashModal.jsx';
import { ShortcutsHost } from './components/ShortcutsOverlay.jsx';
import { WorkspaceRecoveryModal } from './components/WorkspaceRecoveryModal.jsx';
import { WorkspaceAlertBanner } from './components/WorkspaceAlertBanner.jsx';
import { useFeedback } from './components/AppFeedback.jsx';
import { lazyWithReload } from './lib/lazyWithReload.js';
// Lazy: HomeGraph pulls in three.js + react-force-graph-3d (~365KB gz) but only
// renders on the Home view. Keeping it out of the eager App bundle means a board
// canvas no longer downloads the 3D-graph libs.
const HomeGraph = lazyWithReload(() => import('./components/HomeGraph.jsx').then(m => ({ default: m.HomeGraph })));
import { useBreakpoint } from './hooks/useBreakpoint.js';
import { MobileBottomNav } from './components/shell/MobileBottomNav.jsx';

const TWEAK_DEFAULTS = {
  // NOTE: theme is intentionally NOT a tweak. It lives in the per-user
  // server setting (profiles.settings.ui.theme) via lib/theme.js so it
  // syncs across devices and can't drift from the Settings panel. See the
  // theme unification in Workspace + SettingsPanel.
  showArrows: true,
  // Messages defaults to closed — the unread badge guides you to open it.
  // (Replaces the old showInbox: true default; that drawer was demoware.)
  showMessages: false,
  compactSidebar: false,
};

const SESSION_PREFIX = 'soleil.boards.session.';

// In-product engagement: card_edit fires at most once per card per page-session
// (the analytics.js batcher coalesces these) and ONLY for content edits — not
// drags / resizes / restacks — so it measures real editing depth, not movement.
const _editedCardsThisSession = new Set();
const CARD_CONTENT_KEYS = new Set(['html', 'title', 'body', 'text', 'caption', 'content', 'name']);
function isContentEdit(patch) {
  return !!patch && Object.keys(patch).some((k) => CARD_CONTENT_KEYS.has(k));
}
function logCardEdit(cardId, kind, boardId) {
  if (!cardId || _editedCardsThisSession.has(cardId)) return;
  _editedCardsThisSession.add(cardId);
  logEvent(EV.CARD_EDIT, { kind: kind || 'card', board_id: boardId });
}

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

// Module-level Profiler callback for the CanvasSurface tree. Cheap when
// perf is off (perf.bump/mark no-op on a single bool check). Defined
// outside the component tree so its identity is stable forever.
function onCanvasRender(id, phase, actualDuration) {
  perf.bump('cs.render');
  perf.mark('cs.render.ms', actualDuration);
  if (perf.isEnabled() && actualDuration > 50) {
    console.warn('[perf] slow canvas render', { id, phase, ms: +actualDuration.toFixed(1) });
  }
}

export function App() {
  perf.usePerfRenderTime('App');
  // Deep-link into Account → Billing when returning from the Stripe Customer
  // Portal (return_url = /?settings=billing) or hitting the legacy
  // /settings/billing path, then clean the URL back to /.
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      if (p.get('settings') === 'billing' || window.location.pathname === '/settings/billing') {
        setAccountInitialTab('billing');
        setAccountOpen(true);
        window.history.replaceState({}, '', '/');
      }
    } catch (_) {}
  }, []);
  // Perf toggle: ?perf=1 enables (one-shot at mount); Ctrl+Shift+P toggles
  // at runtime. Sticky via localStorage.perfHud (read inside perf.js). All
  // diagnostic output goes to the browser console; no UI is rendered.
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      if (p.get('perf') === '1') perf.enable();
    } catch (_) {}
    const onKey = (e) => {
      if (isEditableTarget(e)) return;
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault();
        perf.toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const { user, signOut } = useAuth();
  if (isLocalQaMode() || !isSupabaseConfigured) return <Suspense fallback={null}><LocalBoardsApp user={user} signOut={signOut} /></Suspense>;

  const { loading: wsLoading, workspace: personalWorkspace, rootBoard: personalRoot, error: wsError } = useWorkspace();
  const { workspaces, refresh: refreshWorkspaces } = useAllWorkspaces(user);

  // First-signup race: useAllWorkspaces fetches workspace_members for the
  // user in parallel with useWorkspace's bootstrap RPC. For brand-new
  // accounts the membership row doesn't exist yet when the first fetch
  // runs, so the picker shows empty even though the personal workspace
  // was just created. Refresh once the personal workspace id appears.
  useEffect(() => {
    if (personalWorkspace?.id) refreshWorkspaces();
  }, [personalWorkspace?.id, refreshWorkspaces]);

  const [tweak, setTweak] = useTweaks(TWEAK_DEFAULTS);
  // Theme is applied from the per-user server setting inside Workspace
  // (see the mySettings effect + setTheme), NOT from tweak — having two
  // independent stores write data-theme was the reset bug.

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
  // Gate on activeRoot.workspace_id matching the active workspace —
  // otherwise the render between an activeWorkspaceId change and the
  // async getRootBoard() finishing mounts <Workspace key={newWs.id}>
  // with rootBoard={oldRoot}, seeding stack=[oldRoot.id], which makes
  // useYBoard paint the previous workspace's root cards until the stack
  // filter effect corrects it. Better to show LoadingShell for that
  // tick than to flash the wrong canvas.
  if (wsLoading || !activeWorkspace || !activeRoot || activeRoot.workspace_id !== activeWorkspace.id) return <LoadingShell />;

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
  perf.usePerfRenderTime('Workspace');
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
  // True only once the workspace board list has actually arrived over the
  // network. The canvas snapshot (yb.cards) paints instantly from the
  // IndexedDB instant-reopen cache, so board-reference cards can render a
  // frame before `boards` is populated — gating on this lets the surfaces
  // show a neutral shimmer placeholder during that window instead of a
  // scary "Missing board" / "no access" tile. Once true, the isOrphanRef
  // filter below removes any genuinely-missing references entirely.
  const boardsReady = !boardsLoading && !!boards && Object.keys(boards).length > 0;
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
  // Mobile shell state. isPhone keys all phone-only UI; mobileNavOpen
  // controls the slide-out sidebar (which uses the existing .sidebar
  // markup repositioned as a drawer at phone width).
  const { isPhone } = useBreakpoint();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Close the drawer whenever the user navigates surfaces or boards —
  // otherwise you tap a board in the drawer, the board loads behind, and
  // the drawer stays open obscuring the content.
  useEffect(() => { if (!isPhone) setMobileNavOpen(false); }, [isPhone]);
  // Workspace switcher popover (in the sidebar header). Click-outside +
  // Escape close it; selecting a workspace also closes.
  const [wsMenuOpen, setWsMenuOpen] = useState(false);
  // Two separate panels:
  //   accountOpen  — avatar (bottom-left, your initial) → identity, billing,
  //                  notifications + sign out
  //   settingsOpen — cog (bottom-left, gear) → workspace defaults, theme,
  //                  display
  const [accountOpen, setAccountOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // When the account panel is deep-linked to a specific tab (e.g. Billing after
  // returning from the Stripe portal), this holds it; cleared on close (one-shot).
  const [accountInitialTab, setAccountInitialTab] = useState(null);

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

  // Stable currentUser identity for downstream <CanvasSurface currentUser={...}>.
  // Without this useMemo the inline object literal at the mount site churned
  // identity per App render, busting CanvasSurface's downstream memos for
  // unrelated state changes.
  const currentUser = useMemo(() => ({
    id: user.id,
    email: user.email,
    name: userInfo.name,
    color: userInfo.color || pickPresenceColor(user.id),
  }), [user.id, user.email, userInfo.name, userInfo.color]);

  // Resolved defaults — workspace > user > hardcoded fallback. Drives every
  // addX mutator's initial values + the SettingsPanel UI. Stash in a ref
  // so mutators read the latest at call time without re-memo cascades.
  const { defaults, role: workspaceRole, refresh: refreshSettings,
          workspaceSettings, mySettings, mySettingsLoaded } = useResolvedDefaults({
    workspaceId: workspace?.id,
    userId: user?.id,
  });
  const defaultsRef = useRef(defaults);
  useEffect(() => { defaultsRef.current = defaults; }, [defaults]);

  // ── Theme (single source of truth) ─────────────────────────────────────
  // The rendered theme reflects the per-user server setting; themeMode just
  // mirrors the live data-theme attribute so the topbar toggle's icon and
  // any "current" reads stay in sync. setTheme is the ONE write path shared
  // by the topbar quick toggle and Settings → Theme pills: it applies +
  // caches synchronously (so remounts/cold-loads are instant and correct)
  // then persists to Supabase.
  const [themeMode, setThemeMode] = useState(() => currentTheme());
  const setTheme = React.useCallback((next) => {
    const t = applyThemeNow(next);           // data-theme + soleil.ui cache, instant
    setThemeMode(t);
    updateOwnSettings({ ui: { ...(mySettings?.ui || {}), theme: t } })
      .then(() => refreshSettings?.())
      .catch(() => { /* offline: cache + attribute already updated */ });
  }, [mySettings, refreshSettings]);

  // Follow the OS theme live for users who have never made an explicit
  // choice. Once they pick one (mySettings.ui.theme set), this is a no-op.
  useEffect(() => {
    let mql;
    try { mql = window.matchMedia('(prefers-color-scheme: light)'); } catch (_) { return undefined; }
    const onChange = (e) => {
      if (mySettings?.ui?.theme) return;     // explicit choice wins
      const t = e.matches ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', t);
      setThemeMode(t);
    };
    if (mql.addEventListener) mql.addEventListener('change', onChange);
    else if (mql.addListener) mql.addListener(onChange);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', onChange);
      else if (mql.removeListener) mql.removeListener(onChange);
    };
  }, [mySettings?.ui?.theme]);

  // Apply per-user UI preferences on load + whenever they change.
  // Theme attribute, accent custom-property, body-font custom-property,
  // and the clean-mode body attribute all flow from mySettings.ui.
  // We also mirror to localStorage so the bootstrap script in index.html
  // can apply these before React mounts on the next page load (no flicker).
  useEffect(() => {
    // Wait for the real profile before touching anything — mySettings is {}
    // until getOwnProfile resolves, and writing that empty blob would poison
    // the soleil.ui bootstrap cache + clear accent/font for a frame. The
    // pre-React bootstrap already applied the cached/OS theme; leave it be
    // until we have the authoritative value.
    if (!mySettingsLoaded) return;
    const ui = mySettings?.ui || {};
    try { localStorage.setItem('soleil.ui', JSON.stringify(ui)); } catch (_) {}
    // Explicit choice wins; otherwise follow the OS (new users) — without
    // persisting, so a later toggle is what locks their preference in.
    const resolvedTheme = resolveTheme(ui.theme);
    document.documentElement.setAttribute('data-theme', resolvedTheme);
    setThemeMode(resolvedTheme);
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
  }, [mySettings, mySettingsLoaded]);

  // ⌘. toggles clean mode quickly. Persists via merge_profile_settings.
  useEffect(() => {
    const onKey = (e) => {
      if (isEditableTarget(e)) return;
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

  // Messages: list/unread/title-badge. msgRefreshTick lets markRead / send /
  // membership changes bump the panel without a full refetch loop. Realtime
  // refreshes are per-conversation; this tick is for cross-thread cache busting.
  const [msgRefreshTick, setMsgRefreshTick] = useState(0);
  // openConversationId is lifted from MessagesPanel so useInboxLive can
  // suppress toasts for the conversation the user is actively viewing.
  const [openConversationId, setOpenConversationId] = useState(null);
  const conversationList = useConversationList({ workspaceId: workspace.id, userId: user.id, refreshTick: msgRefreshTick });
  const { total: messagesUnread, mentions: messagesMentions } = useUnreadTotal({ unreadByConv: conversationList.unreadByConv });
  useTitleBadge({ total: messagesUnread, mentions: messagesMentions });

  // Live inbox: subscribes to user:{uid} broadcast, dispatches toasts +
  // OS notifications, publishes to inboxBus for optimistic list updates.
  const openConversationFromToast = React.useCallback((convId) => {
    if (!convId) return;
    setOpenConversationId(convId);
    setTweak('showMessages', true);
  }, [setTweak]);
  useInboxLive({
    userId: user.id,
    openConversationId,
    onOpenConversation: openConversationFromToast,
    feedback,
  });

  // "hasThumb" = has a CURRENT-version stored thumbnail. A stale version
  // (pre-rework render) counts as missing so the on-open backfill in
  // loadYBoard regenerates it with the new look.
  const yb = useYBoard(currentBoard.id, user.id, userInfo, workspace.id,
    !!currentBoard.thumb_key && currentBoard.thumb_version === THUMB_VERSION);

  // Avatar-click → open DM with a workspace member. Exposed via context.
  const [pendingDmPeerId, setPendingDmPeerId] = useState(null);
  const openDmWith = React.useCallback((peerId) => {
    if (!peerId || peerId === user.id) return;
    setPendingDmPeerId(peerId);
    setTweak('showMessages', true);
  }, [user?.id, setTweak]);
  const currentYDoc = yb.ready && yb.boardId === currentBoard.id ? yb.ydoc : null;

  // Side-by-side: when set, the workspace splits 50/50 with a draggable
  // divider. The split pane runs its own Y.Doc / surface independently.
  const [splitId, setSplitIdState] = useState(() => initialSession?.splitId || null);
  const setSplitId = (id) => setSplitIdState(id);
  const splitBoard = splitId ? (boards[splitId] || null) : null;
  const splitView = splitBoard ? (viewOverride[splitId] || splitBoard.view || 'canvas') : null;
  const splitYb = useYBoard(splitId, user.id, userInfo, workspace.id,
    !!(splitBoard && splitBoard.thumb_key && splitBoard.thumb_version === THUMB_VERSION));
  const splitYDoc = splitYb.ready && splitYb.boardId === splitId ? splitYb.ydoc : null;
  const [splitPickerOpen, setSplitPickerOpen] = useState(false);
  const [splitRatio, setSplitRatio] = useState(() => initialSession?.splitRatio || 0.5);
  // Board cards whose reparent is in flight — childBoardId → oldParentId. The
  // render filter (see renderSurface) hides each from its OLD parent's canvas
  // the instant the drop is dispatched, so the dragged card doesn't snap back
  // to its original spot for the duration of the async move before vanishing.
  // Cleared (un-hidden) when the move settles or fails. See the onReparent handler.
  const [pendingReparent, setPendingReparent] = useState(() => new Map());
  // Persist split state.
  useEffect(() => {
    writeSession(sessionKey, { stack, viewOverride, splitId, splitRatio });
  }, [sessionKey, stack, viewOverride, splitId, splitRatio]);
  // If the split target gets deleted out from under us, drop the split.
  useEffect(() => {
    if (splitId && !boardsLoading && !boards[splitId]) setSplitIdState(null);
  }, [splitId, boards, boardsLoading]);
  const currentUndoManager = yb.ready && yb.boardId === currentBoard.id ? yb.undoManager : null;
  const [trashOpen, setTrashOpen] = useState(false);
  const [workspaceRecoveryOpen, setWorkspaceRecoveryOpen] = useState(false);

  const recents = useRecents(workspace.id);
  const openBoard = (id) => {
    setStack(s => [...s, id]);
    recents.push(id);
    // Breadth signal: which boards get opened, and how deep (sub-board nesting).
    logEvent(EV.BOARD_OPEN, { board_id: id, depth: stack.length, is_subboard: !!rootBoard && id !== rootBoard.id });
  };
  const goTo = (i) => setStack(s => s.slice(0, i + 1));

  // Session navigation history — browser-style back/forward over board
  // navigation. Breadcrumbs only allow climbing the current path; this
  // recovers "I mis-clicked, take me back to where I was" across jumps
  // (sidebar, deep links, drill-downs). Entries are stack snapshots;
  // back/forward replay them without re-recording (silent flag).
  const navHistRef = useRef({ entries: [], index: -1, silent: false });
  const [navCaps, setNavCaps] = useState({ back: false, fwd: false });
  useEffect(() => {
    const h = navHistRef.current;
    const key = stack.join('/');
    if (h.silent) {
      h.silent = false;
    } else if (h.entries[h.index]?.key !== key) {
      h.entries = h.entries.slice(0, h.index + 1);
      h.entries.push({ key, stack: [...stack] });
      h.index = h.entries.length - 1;
      // Unbounded history would grow forever in long sessions.
      if (h.entries.length > 100) { h.entries.shift(); h.index -= 1; }
    }
    setNavCaps({ back: h.index > 0, fwd: h.index < h.entries.length - 1 });
  }, [stack]);
  const navHistGo = (dir) => {
    const h = navHistRef.current;
    const next = h.index + dir;
    if (next < 0 || next >= h.entries.length) return;
    h.index = next;
    h.silent = true;
    setStack(h.entries[next].stack);
    setCurrentSurface('board');
  };

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

    // End the current undo merge window so the next write starts a fresh
    // stack item. Called at the top of discrete "one click = one action"
    // mutators (add/delete/group/…) so two quick clicks within the 500ms
    // captureTimeout don't collapse into a single Cmd+Z. NOT called from
    // updateCard(s): those are gesture commits + per-keystroke note edits
    // where coalescing is desirable.
    const breakUndo = () => { try { undoManager?.stopCapturing(); } catch (_) {} };

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

    // Demo users can only write to boards in workspaces they CREATED.
    // RLS enforces this server-side; we mirror the check here so that
    // the local Y.Doc transact doesn't leave a phantom card the server
    // will then reject. The ReadOnlyBanner explains the situation in
    // the canvas; we silently no-op the mutator.
    const isDemoBlockedOnThisBoard = () => {
      if (myTier.tier !== 'demo') return false;
      const b = boards?.[boardId];
      if (!b) return false; // unknown — fall through, let RLS decide.
      const inActiveWs = b.workspace_id === workspace?.id;
      const ownsActiveWs = workspace?.created_by === user?.id;
      return !(inActiveWs && ownsActiveWs);
    };

    // Record a card-create that the mutator refused (the un-bypassable layer —
    // every add path routes through here). Seeds never count. Snake-case reasons
    // ONLY (see analyticsEvents.js); the user-facing 'cap-hit' string is not one.
    const noteBlocked = (reason) => { try { logEvent(EV.CARD_CREATE_BLOCKED, { reason, board_id: boardId }); } catch (_) {} };

    const addCard = (card) => {
      const m = cardsMap(); if (!m) { if (!isSeedCard(card)) noteBlocked('mutator_null'); return; }
      if (isDemoBlockedOnThisBoard()) { if (!isSeedCard(card)) noteBlocked('demo_blocked'); return; }
      // Demo-tier cap: hard-block at the limit (cards total across the user's
      // own boards). The trigger on card_index keeps demo_card_count in
      // sync server-side; the chip and this check read the cached value.
      if (myTier.tier === 'demo') {
        const { capHit } = evaluateDemoCap({ tier: myTier.tier, demoCardCount: myTier.demoCardCount, requested: 1 });
        if (capHit) {
          if (!isSeedCard(card)) noteBlocked('demo_cap');   // modal already opens below
          setUpgradeReason('cap-hit');
          return;
        }
        if (myTier.demoCardCount === 90) {
          feedback.toast({
            type: 'warning',
            message: "You're at 90/100 cards in your demo workspace. Upgrade for unlimited.",
            action: { label: 'Upgrade', onClick: () => setUpgradeReason('cap-hit') },
          });
        }
      }
      breakUndo();
      ydoc.transact(() => {
        const c = stampCreate({ z: nextZ(), ...card });
        m.set(c.id, cardToYMap(c));
      }, 'local');
      // Live activity signal → admin Command Center placement ticker. Prompt
      // (beacon) delivery so it shows up ~live, not at the next 5s batch flush.
      // Seeds (onb-*) are not real placements — exclude so card_placed only ever
      // means a genuine card (it was inflating the activation funnel).
      if (!isSeedCard(card)) {
        logEventNow(EV.CARD_PLACED, {
          n: 1, kind: card?.kind || 'card',
          board_id: boardId, workspace_id: workspace?.id, actor: user?.email || null,
        });
      }
    };

    const addCards = (cardsToAdd) => {
      const m = cardsMap(); if (!m || !cardsToAdd?.length) { if (!m && genuineCards(cardsToAdd || []).length) noteBlocked('mutator_null'); return; }
      if (isDemoBlockedOnThisBoard()) { if (genuineCards(cardsToAdd).length) noteBlocked('demo_blocked'); return; }
      if (myTier.tier === 'demo') {
        const { accepted, capHit } = evaluateDemoCap({ tier: myTier.tier, demoCardCount: myTier.demoCardCount, requested: cardsToAdd.length });
        if (capHit && accepted === 0) { if (genuineCards(cardsToAdd).length) noteBlocked('demo_cap'); setUpgradeReason('cap-hit'); return; }
        if (capHit) {
          cardsToAdd = cardsToAdd.slice(0, accepted);
          setUpgradeReason('cap-hit');
        } else if (myTier.demoCardCount + cardsToAdd.length >= 90 && myTier.demoCardCount < 90) {
          feedback.toast({
            type: 'warning',
            message: "You're approaching the 100-card demo limit. Upgrade for unlimited.",
            action: { label: 'Upgrade', onClick: () => setUpgradeReason('cap-hit') },
          });
        }
      }
      breakUndo();
      ydoc.transact(() => {
        let z = nextZ();
        for (const card of cardsToAdd) {
          const c = stampCreate({ z: z++, ...card });
          m.set(c.id, cardToYMap(c));
        }
      }, 'local');
      // One ticker entry per bulk action (collapsed) — "placed N cards".
      // Count only genuine cards so the onboarding seed batch (all onb-*) never
      // emits a card_placed — the seed was being counted as activation.
      const genuine = genuineCards(cardsToAdd);
      if (genuine.length) {
        const kinds = new Set(genuine.map((c) => c?.kind).filter(Boolean));
        logEventNow(EV.CARD_PLACED, {
          n: genuine.length, kind: kinds.size === 1 ? [...kinds][0] : 'mixed',
          board_id: boardId, workspace_id: workspace?.id, actor: user?.email || null,
        });
      }
    };

    const updateCard = (cardId, patch) => {
      const m = cardsMap(); if (!m) return;
      if (isDemoBlockedOnThisBoard()) return;
      const ym = m.get(cardId); if (!ym) return;
      ydoc.transact(() => {
        for (const [k, v] of Object.entries(patch)) ym.set(k, v);
        writeUpdateStamp(ym);
      }, 'local');
      if (isContentEdit(patch)) logCardEdit(cardId, ym.get('kind'), boardId);
    };

    const updateCards = (updates) => {
      const m = cardsMap(); if (!m || !updates?.length) return;
      if (isDemoBlockedOnThisBoard()) return;
      ydoc.transact(() => {
        for (const { id, patch } of updates) {
          const ym = m.get(id); if (!ym) continue;
          for (const [k, v] of Object.entries(patch)) ym.set(k, v);
          writeUpdateStamp(ym);
          if (isContentEdit(patch)) logCardEdit(id, ym.get('kind'), boardId);
        }
      }, 'local');
    };

    const deleteCards = async (ids) => {
      if (!ids?.length) return;
      const m = cardsMap(); if (!m) return;
      if (isDemoBlockedOnThisBoard()) return;
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
      const m = cardsMap(); if (!m || !ids?.length) { if (!m && ids?.length) noteBlocked('mutator_null'); return []; }
      if (isDemoBlockedOnThisBoard()) { noteBlocked('demo_blocked'); return []; }
      // Resolve the cards that would actually be duplicated (skip missing +
      // board cards) so the demo cap counts only real new cards.
      let sources = ids.map(id => m.get(id)).filter(ym => ym && ym.get('kind') !== 'board');
      // Demo-tier cap: same gate as addCard/addCards — block at the limit, slice
      // an over-cap batch to what fits, warn when crossing the 90 threshold.
      if (myTier.tier === 'demo') {
        const { accepted, capHit } = evaluateDemoCap({ tier: myTier.tier, demoCardCount: myTier.demoCardCount, requested: sources.length });
        if (capHit && accepted === 0) { if (sources.length) noteBlocked('demo_cap'); setUpgradeReason('cap-hit'); return []; }
        if (capHit) {
          sources = sources.slice(0, accepted);
          setUpgradeReason('cap-hit');
        } else if (myTier.demoCardCount + sources.length >= 90 && myTier.demoCardCount < 90) {
          feedback.toast({
            type: 'warning',
            message: "You're approaching the 100-card demo limit. Upgrade for unlimited.",
            action: { label: 'Upgrade', onClick: () => setUpgradeReason('cap-hit') },
          });
        }
      }
      const newIds = [];
      breakUndo();
      ydoc.transact(() => {
        let z = nextZ();
        for (const ym of sources) {
          const obj = {};
          ym.forEach((v, k) => { obj[k] = v; });
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

    const sendToBack = (cardId) => {
      const m = cardsMap(); if (!m) return;
      let min = 0;
      m.forEach((ym, id) => {
        if (id === cardId) return;
        const z = ym.get('z') || 0;
        if (z < min) min = z;
      });
      updateCard(cardId, { z: min - 1 });
    };

    // Move one step toward the front: slot between the next two cards above
    // me, or to (top + 1) if I'm already directly under the top card.
    // Fractional z values are fine — the render sort handles them.
    const bringForward = (cardId) => {
      const m = cardsMap(); if (!m) return;
      const me = m.get(cardId); if (!me) return;
      const myZ = me.get('z') || 0;
      const above = [];
      m.forEach((ym, id) => {
        if (id === cardId) return;
        const z = ym.get('z') || 0;
        if (z > myZ) above.push(z);
      });
      if (above.length === 0) return;
      above.sort((a, b) => a - b);
      const next = above[0];
      const nextNext = above[1];
      const newZ = nextNext !== undefined ? (next + nextNext) / 2 : next + 1;
      updateCard(cardId, { z: newZ });
    };

    const sendBackward = (cardId) => {
      const m = cardsMap(); if (!m) return;
      const me = m.get(cardId); if (!me) return;
      const myZ = me.get('z') || 0;
      const below = [];
      m.forEach((ym, id) => {
        if (id === cardId) return;
        const z = ym.get('z') || 0;
        if (z < myZ) below.push(z);
      });
      if (below.length === 0) return;
      below.sort((a, b) => b - a); // descending
      const next = below[0];
      const nextNext = below[1];
      const newZ = nextNext !== undefined ? (next + nextNext) / 2 : next - 1;
      updateCard(cardId, { z: newZ });
    };

    // ── Card grouping ──────────────────────────────────────────────
    // Each group is a Y.Map keyed by groupId in `ydoc.getMap('groups')`
    // with { id, name, outline:bool, color, width }. Cards reference
    // a group by setting `groupId` on the card row.
    const createGroup = ({ name, cardIds, outline = false } = {}) => {
      if (!cardIds?.length) return null;
      const m = cardsMap(); const gm = groupsMap();
      if (!m || !gm) return null;
      const id = `g-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      breakUndo();
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
      breakUndo();
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
      breakUndo();
      ydoc.transact(() => { a.push([{ from: fromId, to: toId, ...opts }]); }, 'local');
    };

    const addStroke = (stroke) => {
      const s = strokesArr(); if (!s) return;
      breakUndo();
      ydoc.transact(() => { s.push([stroke]); }, 'local');
    };
    const clearStrokes = () => {
      const s = strokesArr(); if (!s || s.length === 0) return;
      breakUndo();
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
      breakUndo();
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
      // Preserve natural dimensions and aspect ratio. Same sizing
      // approach as optimisticDropImage in CanvasSurface: scale DOWN
      // proportionally above MAX, scale UP proportionally below MIN,
      // never distort the aspect. Replaces an older width=280 /
      // height=240 cage that made every image come in at the same
      // size regardless of source dimensions.
      const MAX_IMAGE_DIM = 1200;
      const MIN_IMAGE_DIM = 80;
      let w = 320, h = 240;
      if (width && height) {
        w = width; h = height;
        if (w > MAX_IMAGE_DIM || h > MAX_IMAGE_DIM) {
          const k = MAX_IMAGE_DIM / Math.max(w, h);
          w = Math.round(w * k); h = Math.round(h * k);
        }
        if (w < MIN_IMAGE_DIM || h < MIN_IMAGE_DIM) {
          const k = MIN_IMAGE_DIM / Math.min(w, h);
          w = Math.round(w * k); h = Math.round(h * k);
        }
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
      duplicateCard, duplicateCards, addCard, addCards,
      bringToFront, sendToBack, bringForward, sendBackward,
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
      undo, redo, canUndo, canRedo, undoManager, breakUndo,
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
      placeholder: 'e.g. Marketing team',
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

  // Open the workspace 3-dots menu and pick an action → confirm + delete (own)
  // or leave (shared). Deletes require typing the workspace name to enable
  // the confirm button so accidental clicks can't nuke a workspace.
  // If the user removes the currently-active workspace we switch to personal.
  const removeWorkspace = async (ws, kind /* 'delete' | 'leave' */) => {
    const isDelete = kind === 'delete';
    const ok = await feedback.confirm({
      title: isDelete ? 'Delete workspace' : 'Leave workspace',
      message: isDelete
        ? `Deleting "${ws.name}" will permanently remove all of its boards, cards, and messages. This cannot be undone.`
        : `Leave "${ws.name}"? You'll lose access until the owner re-invites you.`,
      confirmLabel: isDelete ? 'Delete workspace' : 'Leave',
      danger: true,
      confirmText: isDelete ? (ws.name || '') : null,
      confirmTextLabel: isDelete ? `Type "${ws.name}" to confirm` : null,
      confirmTextPlaceholder: isDelete ? ws.name : null,
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
  // Phone: any navigation closes the drawer — tapping a board in the
  // drawer used to leave it open, hiding the very board it just opened.
  useEffect(() => {
    if (isPhone) setMobileNavOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stack, currentSurface, activeTag]);
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
  // Keep a live reference to the board flush fns so the (empty-dep) doc-card
  // listener below can persist pending edits the moment a card closes. A doc
  // card's content lives in its host board's Y.Doc, so flushing the open
  // board(s) commits the last ~250ms of typing before the snapshot debounce
  // would have. flushNow is a no-op when nothing is pending.
  const flushBoardsRef = useRef(() => {});
  useEffect(() => {
    flushBoardsRef.current = () => {
      try { yb.flushNow?.(); } catch (_) {}
      try { splitYb.flushNow?.(); } catch (_) {}
    };
  }, [yb.flushNow, splitYb.flushNow]);
  useEffect(() => {
    const onMount = (e) => {
      const { cardId } = e.detail || {};
      if (!cardId) return;
      setOpenDocCard({ cardId, pageId: null, scrollTop: 0 });
    };
    const onUnmount = (e) => {
      const { cardId } = e.detail || {};
      try { flushBoardsRef.current?.(); } catch (_) {}
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
  // Collaboration-loop signal: fire when the share surface opens (any path).
  useEffect(() => { if (shareOpen) logEvent(EV.SHARE_OPEN, { board_id: currentId }); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [shareOpen]);
  // "Linked from" side drawer for the currently-viewed board (or any
  // entity surfaced by other components via setBacklinksRef).
  const [backlinksRef, setBacklinksRef] = useState(null);

  // Permalink target (drives MessagesPanel for ?to=m:<uuid> / legacy
  // ?m=<uuid>). Other ref kinds navigate via setStack + custom events.
  const [permalinkTarget, setPermalinkTarget] = useState(null);  // { messageId, conversationId }

  // Open a message thread by id. Used by both the URL resolver and
  // the EntityNavigate provider for { kind:'message' } refs.
  const openMessageThread = React.useCallback(async (messageId) => {
    if (!messageId || !user?.id) return;
    try {
      const row = await fetchMessageById(messageId);
      if (!row || !row.conversation_id) return;
      setPermalinkTarget({ messageId, conversationId: row.conversation_id });
      setTweak('showMessages', true);
    } catch (e) { console.warn('message permalink resolve failed', e); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, setTweak]);

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
      // Clicking a user entity opens a DM with them.
      if (ref?.id) openDmWith(ref.id);
      else setTweak('showMessages', true);
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
  }), [boards, recents, openMessageThread, openDmWith, setTweak]);

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
  // Tier (admin / paid / demo / waitlist) drives the upgrade chip,
  // the demo-cap on addCard, and the tier-aware viewer fallback in
  // useBoardPermission for non-owned boards.
  const myTier = useMyTier({ userId: user.id });
  const [upgradeReason, setUpgradeReason] = useState(null); // 'cap-hit' | 'shared-edit' | 'manual' | null

  // Funnel: app_open fires once per mount with the caller's tier so we
  // can correlate retention (app opens / unique user / week).
  useEffect(() => {
    if (!myTier.tier) return;
    logEvent(EV.APP_OPEN, { tier: myTier.tier });
    // Return-session: app_open on a later calendar day than we last saw this
    // browser — the literal re-engagement signal (complements server-side
    // user_active_day, and survives even if the heartbeat misses).
    try {
      const key = `soleil_last_seen_day_${user?.id || 'anon'}`;
      const today = new Date().toISOString().slice(0, 10);
      const last = localStorage.getItem(key);
      if (last && last !== today) {
        const days = Math.max(1, Math.round((Date.parse(today) - Date.parse(last)) / 86400000));
        logEvent(EV.RETURN_SESSION, { days_since_last_seen: days, tier: myTier.tier });
      }
      localStorage.setItem(key, today);
    } catch { /* localStorage unavailable */ }
  }, [myTier.tier]);

  // ── First-run onboarding ──────────────────────────────────────────────────
  // New users were landing on a blank Studio canvas and bouncing (~44s median;
  // only a fraction ever placed a card). On first run we seed a few starter
  // cards and show a one-time first-card coachmark. State persists in
  // profiles.settings.onboarding {seeded,done} via merge_profile_settings, and
  // is read back through get_my_tier()/useMyTier.
  const seedAttemptedRef = useRef(false);
  const [onboardingUiActive, setOnboardingUiActive] = useState(false);
  // Passive escalation: true once a brand-new user trips the stuck signal
  // (frictionSignal.js) — brightens the empty-board hint + coachmark. Cleared the
  // instant their first genuine card lands.
  const [frictionStuck, setFrictionStuck] = useState(false);

  const dismissOnboarding = (reason) => {
    setOnboardingUiActive(false);
    logEvent(EV.ONBOARDING_DISMISS, { reason: reason || 'dismissed' });
    updateOwnSettings({ onboarding: { ...(myTier.onboarding || {}), seeded: true, done: true } })
      .then(() => myTier.refetch?.())
      .catch((e) => { try { logEvent(EV.ONBOARDING_SETTINGS_PERSIST_FAILED, { op: 'dismiss', reason: String(e?.message || e || 'error').slice(0, 120) }); } catch (_) {} });
  };

  // Returning first-run user (seeded a prior session but never finished) →
  // re-show the coachmark. Brand-new users get it switched on by the seed effect.
  useEffect(() => {
    if (myTier.onboarding?.seeded === true && myTier.onboarding?.done !== true) {
      setOnboardingUiActive(true);
    }
  }, [myTier.onboarding?.seeded, myTier.onboarding?.done]);

  // Seed once, into the empty Studio root, for a genuinely new user. Triple-
  // gated so an existing user is never seeded: durable `seeded` flag, on the
  // personal root, and only when the canvas is truly empty. Idempotent via the
  // stable onb- ids + the ref guard. We also create a real nested "Ideas" board
  // and drop a "drag me in" note next to it, so the user can immediately learn
  // the organize-by-dragging AHA (see the nest-detection in the onDrop handler).
  useEffect(() => {
    if (seedAttemptedRef.current) return;
    if (myTier.loading) return;                                     // wait for tier/onboarding
    if (myTier.onboarding?.seeded === true || myTier.onboarding?.done === true) return;
    if (!currentYDoc || !yb.ready) return;                         // doc hydrated
    if (currentId !== rootBoard.id) return;                        // personal root only
    if (yb.cards.length !== 0) return;                             // empty canvas only
    // Set the guard SYNCHRONOUSLY, before any await, so a StrictMode double-mount
    // (dev) or a re-render mid-await can never enter again and create TWO "Ideas"
    // boards. The ref covers this mount's lifetime; the durable `seeded` flag +
    // the empty-canvas gate cover reloads / second tabs.
    seedAttemptedRef.current = true;
    (async () => {
      // Bandit enrollment FIRST — we draw the welcome_showcase arm BEFORE
      // composing the seed so arm B can clone the brand board. Genuinely-new users
      // only (this triple-gated effect), so existing/dormant users are never
      // retroactively bucketed. Draw each arm from the LIVE weights (recomputed
      // nightly by experiment_optimize); fall back to the registry-weighted
      // deterministic pick if the config fetch fails. Stamp once (set_experiment_arm
      // is absent-only → first-touch wins even though drawArm is random) + prime
      // the event-merge cache.
      let expCfg = null;
      try { expCfg = (await supabase.rpc('get_experiment_config')).data; } catch (_) {}
      const enrolled = {};
      for (const key of getActiveExperiments()) {
        const c = expCfg?.[key];
        if (expCfg && c && c.enabled === false) continue;     // operator paused it at runtime
        const arm = c?.weights ? drawArm(key, c.weights) : assignArm(key, user.id);
        if (!arm) continue;
        enrolled[`exp_${key}`] = arm;
        supabase.rpc('set_experiment_arm', { p_key: key, p_arm: arm }).catch(() => {});
        logEvent(EV.EXPERIMENT_ENROLLED, { key, arm });
      }
      if (Object.keys(enrolled).length) setEnrolledExperiments(enrolled);

      // welcome_showcase arm B: CLONE the real "Clusters Logo" brand board onto the
      // root — the cloned board IS the first canvas; the user clears it in one click
      // ("try it yourself") to start their own. prepare_showcase hands us the source
      // snapshot AND grants this root board cross-workspace read on the source images
      // (referenced_in_board_ids) BEFORE we render, so the images load with no broken
      // flash. Any failure → no cards → we fall back to standard onboarding below.
      let showcaseCards = null;
      if (enrolled['exp_welcome_showcase'] === 'B') {
        try {
          const tpl = (await supabase.rpc('prepare_showcase', { p_board_id: rootBoard.id })).data;
          if (tpl?.snapshot) {
            const cards = decodeShowcaseCards(tpl.snapshot);
            if (cards.length) showcaseCards = cards;
          }
        } catch (e) {
          try { logEvent(EV.ONBOARDING_SEED_FAILED, { stage: 'showcase_clone', reason: String(e?.message || e || 'error').slice(0, 120) }); } catch (_) {}
        }
      }
      const showcase = !!showcaseCards;

      let tutorialBoardId = null;
      let cardsToSeed;
      if (showcase) {
        // The cloned brand board is the whole first canvas — no Ideas board / starter
        // notes. Clearing it leaves an empty canvas the coachmark then guides.
        cardsToSeed = showcaseCards;
      } else {
        // Standard onboarding: a nested "Ideas" tutorial board + starter notes (the
        // nest-the-note AHA). The board card id MUST equal the real DB UUID
        // (kind:'board' renders via boards[id]); seed:true keeps it out of
        // card_placed / activation / card_index. Add it BEFORE refreshBoards() so the
        // reconcile-drift effect sees the board already "placed" and never adds a
        // duplicate (non-seed) mirror.
        try {
          const b = await createBoard({
            workspaceId: workspace.id,
            parentBoardId: rootBoard.id,
            name: 'Ideas',
            view: 'canvas',
            userId: user.id,
          });
          tutorialBoardId = b?.id || null;
        } catch (e) {
          console.error('[onboarding] createBoard(Ideas) failed; seeding notes only', e);
          try { logEvent(EV.ONBOARDING_SEED_FAILED, { stage: 'create_board', reason: String(e?.message || e || 'error').slice(0, 120) }); } catch (_) {}
          tutorialBoardId = null;
        }
        cardsToSeed = tutorialBoardId
          ? [...getStarterCards(), getStarterTutorialCard(tutorialBoardId)]
          : [...getStarterCards()];
      }
      try {
        mainMutators.addCards?.(cardsToSeed);
      } catch (e) {
        try { logEvent(EV.ONBOARDING_SEED_FAILED, { stage: 'add_cards', reason: String(e?.message || e || 'error').slice(0, 120) }); } catch (_) {}
      }
      logEvent(EV.ONBOARDING_SEED, { n: cardsToSeed.length, board_id: rootBoard.id, tutorial_board_id: tutorialBoardId, showcase });
      setOnboardingUiActive(true);
      // Make the new child board visible in the boards map so its card renders as
      // a real board (not an orphan tile). After addCards so reconcile sees it.
      if (tutorialBoardId) { try { await refreshBoards(); } catch (_) {} }
      // Persist durably (one shallow-merge patch — merge_profile_settings replaces
      // the whole `onboarding` key): the seeded flag so we never re-seed, plus the
      // tutorial board id so the nest-detection knows which board completes the AHA.
      updateOwnSettings({
        onboarding: {
          ...(myTier.onboarding || {}),
          seeded: true,
          ...(tutorialBoardId ? { tutorialBoardId } : {}),
        },
      })
        .then(() => myTier.refetch?.())
        .catch((e) => { try { logEvent(EV.ONBOARDING_SETTINGS_PERSIST_FAILED, { op: 'seed', reason: String(e?.message || e || 'error').slice(0, 120) }); } catch (_) {} });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTier.loading, myTier.onboarding, currentYDoc, yb.ready, yb.cards.length, currentId, rootBoard.id, mainMutators]);

  // Preview affordance: ?showcasepreview=1 clones the welcome_showcase source board
  // (the real Clusters Logo board) into a throwaway board in YOUR workspace and
  // opens it — so the arm-B experience can be seen WITH images on any origin you're
  // signed in to (incl. production). prepare_showcase grants this new board read on
  // the source images first, so they render. Delete the board when done. Works for
  // any signed-in account; harmless + self-scoped (only seeds into your own space).
  const showcasePreviewRef = useRef(false);
  useEffect(() => {
    if (showcasePreviewRef.current || typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('showcasepreview') !== '1') return;
    if (!workspace?.id || !rootBoard?.id || !user?.id) return;
    showcasePreviewRef.current = true;
    (async () => {
      try {
        const b = await createBoard({ workspaceId: workspace.id, parentBoardId: rootBoard.id, name: 'Showcase preview', view: 'canvas', userId: user.id });
        if (!b?.id) return;
        const tpl = (await supabase.rpc('prepare_showcase', { p_board_id: b.id })).data;
        if (tpl?.snapshot) {
          const ydoc = new Y.Doc();
          Y.applyUpdate(ydoc, b64ToBytes(tpl.snapshot));
          await saveBoardSnapshot(b.id, ydoc);
          ydoc.destroy();
        } else {
          console.warn('[showcasepreview] no snapshot — showcase disabled in app_config?');
        }
        try { await refreshBoards(); } catch (_) {}
        setStack([b.id]);
        // strip the param so a reload doesn't make a second copy
        try { const u = new URL(window.location.href); u.searchParams.delete('showcasepreview'); window.history.replaceState({}, '', u.toString()); } catch (_) {}
      } catch (e) {
        console.error('[showcasepreview] failed', e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.id, rootBoard?.id, user?.id]);

  // Activation detection — DECOUPLED from the onboarding coachmark UI. The old
  // version only fired ONBOARDING_FIRST_CARD while the coachmark was showing AND
  // on the root board, so it never fired in practice (users place their first
  // card on a sub-board, or after dismissing the coachmark). Now: the first
  // genuine card on ANY owned board records the activation north-star + triggers
  // the first-value nudge; the first board to reach POP_BOARD_THRESHOLD genuine
  // cards records the "populated board" activation bar. Server triggers
  // (profiles.first_card_at / first_populated_board_at, migration 0120) remain the
  // source of truth; these client events add funnel timing + power the nudge.
  // localStorage stamps keep them ~once-per-account (admin RPCs dedupe by distinct
  // user_id regardless), and let us skip the O(n) scan for established users.
  const POP_BOARD_THRESHOLD = 3; // genuine cards on one board = a "populated" board
  // Which moment fires the Meta CompleteRegistration conversion.
  // 'first_card' = first genuine card (more volume, exits Meta's learning phase
  // faster); 'populated' = board hits POP_BOARD_THRESHOLD cards (stronger signal,
  // lower volume). Flip this single value to switch the activation bar.
  const META_REG_BAR = 'first_card'; // 'first_card' | 'populated'
  // Re-timed first-value nudge: fire a beat AFTER the first genuine card (the 2nd
  // card, or ~15s after the 1st), not on the first card itself. Timer ref persists
  // across renders; cleared on unmount.
  const firstValueTimerRef = useRef(null);
  useEffect(() => () => { if (firstValueTimerRef.current) clearTimeout(firstValueTimerRef.current); }, []);
  useEffect(() => {
    if (!user?.id) return;
    const fcKey = `soleil_first_card_logged_${user.id}`;
    const popKey = `soleil_activated_logged_${user.id}`;
    const fvKey = `soleil_firstvalue_${user.id}`;
    let fcDone = true, popDone = true, fvDone = true;
    try { fcDone = !!localStorage.getItem(fcKey); popDone = !!localStorage.getItem(popKey); fvDone = !!localStorage.getItem(fvKey); } catch { /* ignore */ }
    if (fcDone && popDone && fvDone && !onboardingUiActive) return; // nothing left to detect/dismiss
    const genuine = genuineCards(yb.cards);
    if (genuine.length === 0) return;
    // Fire Meta CompleteRegistration at the chosen activation bar — fire-and-forget,
    // owner-gated (never for a collaborator on someone else's board), never blocks
    // or throws into this effect. trackRegistration owns the durable per-device
    // guard (soleil.meta.reg.<uid>) + server dedup by reg:<uid>, so repeat calls
    // are no-ops.
    const fireMetaReg = () => {
      // Only the user's OWN boards count — never a collaborator's view of a shared
      // board. The personal root is always owned (and this also covers the brief
      // window before the owned-boards list has finished loading).
      const isOwn = currentId === rootBoard.id || !!ownedBoards?.[currentId];
      if (!isOwn) return;
      supabase.auth.getSession()
        .then(({ data }) => trackRegistration(data?.session, { skipAgeCheck: true }))
        .catch(() => {});
    };
    try {
      if (!fcDone) {
        localStorage.setItem(fcKey, '1');
        logEventOnce('first_card', EV.ONBOARDING_FIRST_CARD, { board_id: currentId });
        if (META_REG_BAR === 'first_card') fireMetaReg();
        // A small confirming beat on the very first genuine card — once per account
        // (the fcKey stamp guards it, so a reload never re-fires it).
        try { feedback.toast({ type: 'success', message: 'Nice — your first card is on the board 🎉', ttl: 3500 }); } catch (_) {}
        // First value reached → end any passive escalation immediately (the
        // dedicated effect below also stops the friction signal on this change).
        setFrictionStuck(false);
      }
      if (genuine.length >= POP_BOARD_THRESHOLD && !popDone) {
        localStorage.setItem(popKey, '1');
        logEventOnce('activated', EV.ACTIVATED, { board_id: currentId, n: genuine.length });
        if (META_REG_BAR === 'populated') fireMetaReg();
      }
    } catch { /* localStorage unavailable — logEventOnce still de-dupes per page load */ }

    // Re-timed first-value nudge (demo only): fire a beat AFTER the first genuine
    // card — on the 2nd genuine card, or ~15s after the first, whichever comes
    // first — so we never interrupt the very first action. UpgradeChip owns the
    // demo-gate + once-per-account guard + the soft banner; we just emit the window
    // event (works the same in the ?local=1 harness). The localStorage stamp avoids
    // re-arming across reloads; UpgradeChip de-dupes per account regardless.
    if (!fvDone && myTier.tier === 'demo') {
      const dispatchFirstValue = () => {
        if (firstValueTimerRef.current) { clearTimeout(firstValueTimerRef.current); firstValueTimerRef.current = null; }
        try { localStorage.setItem(fvKey, '1'); } catch { /* ignore */ }
        window.dispatchEvent(new CustomEvent('soleil:first-value'));
      };
      if (genuine.length >= 2) dispatchFirstValue();                          // 2nd genuine card → now
      else if (!firstValueTimerRef.current) firstValueTimerRef.current = setTimeout(dispatchFirstValue, 15000); // 1st → ~15s beat
    }

    // Close the coachmark when a genuine card lands while it's showing (UI only;
    // the analytics above no longer depends on it).
    if (onboardingUiActive) dismissOnboarding('placed');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, yb.cards, currentId, onboardingUiActive]);

  // ── First-card friction signal ────────────────────────────────────────────
  // Detect when a brand-new user is STRUGGLING to place a first card and passively
  // escalate the hint. Scoped tightly: only while onboarding isn't finished (or a
  // fresh demo account) AND there's no genuine card yet — and it stops the instant
  // their first card lands, so established/power users are never escalated. The
  // gesture sites (CanvasSurface) feed recordIntent(); this owns start/stop + the
  // onStuck → passive-escalation wiring. getCards reads a live ref so the signal's
  // own genuine-card self-check never goes stale between renders.
  const ybCardsRef = useRef(yb.cards);
  ybCardsRef.current = yb.cards;
  const frictionEligible = !myTier.loading && !!user?.id && !hasGenuineCard(yb.cards)
    && ((myTier.onboarding?.seeded === true && myTier.onboarding?.done !== true) || myTier.tier === 'demo');
  useEffect(() => {
    if (!frictionEligible) { stopFriction(); setFrictionStuck(false); return undefined; }
    startFriction({
      getCards: () => ybCardsRef.current,
      onStuck: (payload) => {
        setFrictionStuck(true);
        try { logEventOnce('card_create_stuck', EV.CARD_CREATE_STUCK, payload); } catch (_) {}
      },
    });
    return () => stopFriction();
  }, [frictionEligible]);

  // Suppress the coachmark while the welcome-showcase flair is still on the root
  // (the ShowcaseBanner is the guide then); it resumes once the demo is cleared.
  const showCoachmark = onboardingUiActive && currentId === rootBoard.id
    && !(yb.cards || []).some(isShowcaseCard);

  // Permission for the currently-active board — drives VIEW ONLY pill
  // in the topbar + canvas/doc readonly states.
  const currentBoardPerm = useBoardPermission({
    board: currentBoard,
    boards,
    workspace,
    workspaceMembers,
    sharedBoards,
    userId: user.id,
    tier: myTier.tier,
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

  // Once the real profile row (display_name + color) loads, overwrite
  // the email-derived defaults in the cache. Marks hasProfile=true so
  // resolve() doesn't bother fetching our own row.
  useEffect(() => {
    if (!user?.id) return;
    userProfiles.populateFromOwnProfile({
      id: user.id,
      displayName: ownProfile?.display_name || null,
      color:       ownProfile?.color || null,
    });
  }, [user?.id, ownProfile?.display_name, ownProfile?.color]);

  // One realtime sub on public.profiles so any workspace mate changing
  // their name/color reflects everywhere (comments, archive, etc.)
  // within ~1s, without us having to refetch on a timer.
  useEffect(() => {
    const unsub = userProfiles.subscribeToProfileChanges();
    return unsub;
  }, []);

  // Tab-visibility tick. Bumped on visibilitychange so the location object
  // re-evaluates `isActive` and useWorkspacePresence pings immediately
  // (rather than waiting up to 5s for the next heartbeat).
  const [tabVisible, setTabVisible] = useState(() =>
    typeof document === 'undefined' ? true : document.visibilityState === 'visible'
  );
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVis = () => setTabVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

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
      // True only when this tab is foregrounded AND user is on a board.
      // Peers consume this to hide presence dots from background tabs
      // (peer has Board X open but is currently viewing Board Y → only
      // Y shows their dot).
      isActive: tabVisible && currentSurface === 'board',
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
      // Skip peers whose tab isn't foregrounded on a board surface.
      // Lenient: missing isActive (older client bundle) is treated as
      // active so peers on stale tabs keep showing the same as before.
      // Tighten to `if (!p?.location?.isActive) continue;` once all
      // sessions have refreshed onto bundles that broadcast it.
      if (p?.location?.isActive === false) continue;
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
      const { sourceBoardId, targetBoardId, cards: movedCards,
              onTargetSaved, onTargetFailed } = e.detail || {};
      const ack    = () => { try { onTargetSaved?.(); } catch (_) {} };
      const reject = (err) => { try { onTargetFailed?.(err); } catch (_) {} };
      if (!sourceBoardId || !targetBoardId || !movedCards?.length) { reject(new Error('bad event')); return; }
      if (sourceBoardId === targetBoardId) { ack(); return; }
      // ── Onboarding AHA: first time the seed note is dragged into the tutorial
      // "Ideas" board. Match on e.detail.cards (ORIGINAL ids like 'onb-drag' —
      // the new-id remap happens below) + the durable tutorialBoardId. Gated on
      // onboarding not-yet-done so it fires exactly once. Fire-and-forget; do NOT
      // early-return — the note still genuinely moves into the board.
      try {
        const ob = myTier.onboarding || {};
        if (ob.done !== true && ob.tutorialBoardId && targetBoardId === ob.tutorialBoardId
            && movedCards.some((c) => isSeedCard(c))) {
          logEvent(EV.ONBOARDING_NEST, { board_id: targetBoardId, source_board_id: sourceBoardId, n: movedCards.length });
          feedback.toast({ type: 'success', message: 'Nice — that’s how you organize ✨' });
          dismissOnboarding('nested'); // sets onboarding.done:true + logs ONBOARDING_DISMISS
        }
      } catch (_) { /* never block the move on the celebration */ }
      console.log('[xbm] start', { sourceBoardId, targetBoardId, movedCount: movedCards.length, movedIds: movedCards.map(c => c.id), movedKinds: movedCards.map(c => c.kind) });
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

        console.log('[xbm:load] loading target snapshot', { targetBoardId });
        const snap = await loadBoardSnapshot(targetBoardId);
        console.log('[xbm:load] result', { targetBoardId, hasSnap: !!snap, snapBytes: snap?.length || 0 });
        // CRITICAL: if loadBoardSnapshot returns null/empty for a board
        // that already exists, we'd start with an empty tmp Y.Doc and
        // overwrite the live state with only the moved cards — wiping
        // every existing card on the target. Refuse the move and surface
        // a clear error so the user can retry rather than lose data.
        if (!snap) {
          console.error('[xbm] aborting: target board_state is empty', { targetBoardId, sourceBoardId });
          feedback.toast({
            type: 'error',
            message: 'Could not load the destination board’s state. Drag cancelled to prevent data loss. Try again in a moment.',
            duration: 8000,
          });
          reject(new Error('target board_state empty'));
          return;
        }
        const tmp = new Y.Doc();
        Y.applyUpdate(tmp, b64ToBytes(snap));
        const targetCardCountBefore = tmp.getMap('cards').size;
        console.log('[xbm:tmp-init] target cards before mutation', { targetCardCountBefore });
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
          reject(new Error('tmp card count below expected'));
          return;
        }
        const tmpFinalCount = tmp.getMap('cards').size;
        console.log('[xbm:save] writing target board_state', { targetBoardId, tmpFinalCount });
        try {
          await saveBoardSnapshot(targetBoardId, tmp);
        } catch (saveErr) {
          console.error('[xbm:save] saveBoardSnapshot threw', saveErr);
          tmp.destroy();
          feedback.toast({ type: 'error', message: 'Could not save destination board: ' + (saveErr.message || saveErr) });
          reject(saveErr);
          return;
        }
        console.log('[xbm:save] done');
        tmp.destroy();
        // CRITICAL: reset the target's PartyKit room before we let the source
        // delete. We wrote the moved cards straight to board_state, bypassing
        // the target's live CRDT. If the target's room is warm (it was open
        // recently, or is open in another tab / the split pane), its Durable
        // Object re-merges its STALE state and silently undoes our board_state
        // write — so the cards never persist to the target while the source
        // still deletes them => permanent loss. This is the exact failure
        // mode bulletproofRestore guards against (see its step 2). Resetting
        // forces the room to cold-load from the board_state we just wrote.
        // Best-effort: most targets are closed (cold room) so a failure here
        // usually means there was nothing to clobber — but if it throws we do
        // NOT ack, so the source keeps its cards rather than risk the loss.
        try {
          await forceResetBoardRoom(targetBoardId);
        } catch (resetErr) {
          console.error('[xbm] target room reset failed; NOT acking (source keeps cards)', resetErr);
          feedback.toast({
            type: 'error',
            message: 'Move incomplete — could not finalize the destination board. Your cards are safe on this board; try again.',
            duration: 8000,
          });
          reject(resetErr);
          return;
        }
        // If the target happens to be open (e.g. the split pane / another
        // tab), tell its mounted Y.Doc to tear down + re-cold-load so the
        // moved cards show up immediately instead of after a manual reopen.
        try { window.__soleilEmitBoardReset?.(targetBoardId); } catch (_) {}
        // Target save complete + room reset — safe to delete the source.
        ack();

        // ── Repoint attached comments to the target board. ──
        try {
          const oldCardIds = movedCards.map(c => c.id);
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
          }
        } catch (cmtErr) {
          console.warn('comment move failed', cmtErr);
        }

      } catch (err) {
        console.error('cross-board move failed', err);
        feedback.toast({ type: 'error', message: 'Move failed: ' + (err.message || err) });
        reject(err);
      }
    };
    document.addEventListener('soleil-card-into-board-drop', onDrop);
    return () => document.removeEventListener('soleil-card-into-board-drop', onDrop);
    // myTier.onboarding: re-subscribe when onboarding settings change so the
    // listener captures the fresh tutorialBoardId (set after the seed effect's
    // refetch) rather than a stale-null one at drop time. (dismissOnboarding is
    // deliberately NOT a dep — it's recreated each render and would force a
    // re-subscribe on every render; the closure captured when onboarding last
    // changed already reads the correct onboarding state.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boards, feedback, currentYDoc, currentBoard?.id, user?.id, myTier.onboarding]);

  // ── Global drop safety net ────────────────────────────────────────────────
  // Without this, a file / URL / text dropped ANYWHERE that isn't one of our
  // registered drop targets (the sidebar, toolbar, gaps between panes, the
  // bare body) makes the browser NAVIGATE to that file/url — silently blowing
  // away the unsaved board. We install a window-level guard that preventDefaults
  // any such drag the app didn't already handle.
  //
  // Bubble phase + `defaultPrevented`: a real in-app drop target (canvas, list,
  // message composer) calls preventDefault in its own handler, which runs as
  // the event bubbles through the React root BELOW window — so by the time we
  // see it, defaultPrevented is true and we leave it alone. We only catch the
  // truly-unhandled ones. Editable targets are skipped so native text-drop into
  // inputs / the rename field still works.
  useEffect(() => {
    const isDataDrag = (e) => {
      const t = e.dataTransfer?.types;
      if (!t) return false;
      const has = (x) => (typeof t.includes === 'function'
        ? t.includes(x)
        : Array.prototype.indexOf.call(t, x) >= 0);
      return has('Files') || has('text/uri-list') || has('text/plain') || has('text/html');
    };
    const onDragOver = (e) => {
      if (e.defaultPrevented || isEditableTarget(e)) return;
      if (isDataDrag(e)) e.preventDefault();
    };
    const onDrop = (e) => {
      if (e.defaultPrevented || isEditableTarget(e)) return;
      if (!isDataDrag(e)) return;
      e.preventDefault(); // stop the browser navigating to / opening the drop
      try { feedback?.toast?.({ type: 'info', message: 'Drop onto a board’s canvas to add it.' }); } catch (_) {}
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [feedback]);

  // ── Shared "drop a board into a board" (reparent) handler ─────────────────
  // The ONE place every drop surface (sidebar tree, canvas, list) routes to so
  // there's no per-surface divergence. parent_board_id is the source of truth;
  // the kind:'board' canvas card is a derived mirror.
  //
  // Order (see the plan's A3): commit STRUCTURE first (the validated atomic
  // move_boards_under RPC), THEN reconcile the canvas mirror best-effort. If
  // the RPC throws, nothing changed. If a post-commit canvas step fails, the
  // tree is still 100% correct and the only artifact is a cosmetic card that
  // the reconcile-drift effect / planCanvasReconcile heal on next open.
  useEffect(() => {
    const REASON_TEXT = {
      cycle: "can't put a board inside itself",
      self: "can't drop a board onto itself",
      'same-parent': 'already there',
      'cross-workspace': 'different workspace',
      'no-write': 'no edit access',
      missing: 'not found',
      'target-missing': 'destination not found',
    };
    const onReparent = async (e) => {
      const { childIds, targetId = null, onDone, onFailed } = e.detail || {};
      const done = (r) => { try { onDone?.(r); } catch (_) {} };
      const fail = (err) => { try { onFailed?.(err); } catch (_) {} };
      if (!Array.isArray(childIds) || childIds.length === 0) { fail(new Error('no boards')); return; }

      // 1) Pure pre-validate (advisory; the RPC re-checks authoritatively).
      const { movable, skipped } = planReparent(boards, childIds, targetId);
      if (!movable.length) {
        if (skipped.length) {
          const reasons = [...new Set(skipped.map(s => REASON_TEXT[s.reason] || s.reason))];
          feedback.toast({ type: 'info', message: `Nothing moved — ${reasons.join(', ')}.` });
        }
        done({ moved: [], skipped });
        return;
      }

      // 2) Remember each child's current parent so we know whose canvas mirror
      //    to clean up afterward.
      const prevParents = new Map();
      for (const id of movable) prevParents.set(id, boards[id]?.parent_board_id ?? null);
      const targetName = targetId ? (boards[targetId]?.name || 'board') : 'top level';

      // 2b) Optimistically hide each moved card from its OLD parent's canvas
      //     right now, so it doesn't snap back to its drag-origin and linger
      //     there for the duration of the async move before finally vanishing.
      //     dispatchEvent is synchronous, so this setState batches into the
      //     SAME render as the canvas's setDrag(null) — the card is filtered
      //     out before it can paint at the snapped-back position (no flash).
      //     Pure render filter (see renderSurface), reversible. Skips root
      //     boards (null old parent → no parent canvas to hide from). Cleared
      //     on EVERY exit below: success (card already removed from the doc by
      //     then) and failure (card restored in place).
      const flashIds = movable.filter(id => (prevParents.get(id) ?? null) != null);
      if (flashIds.length) {
        setPendingReparent(prev => {
          const next = new Map(prev);
          for (const id of flashIds) next.set(id, prevParents.get(id));
          return next;
        });
      }
      const clearPending = () => {
        if (!flashIds.length) return;
        setPendingReparent(prev => {
          const next = new Map(prev);
          for (const id of flashIds) next.delete(id);
          return next;
        });
      };

      // 3) Pre-reparent canvas snapshot of the board the user is looking at
      //    (cheap; the riskiest mutation is removing its mirror card). Closed
      //    boards rely on the abort-if-null + invariant guards in the
      //    round-trip helper below.
      if (currentYDoc && currentId) {
        try {
          await saveBoardVersion(currentId, currentYDoc, {
            triggerKind: 'pre-reparent',
            sessionId: yb?.sessionId || null,
            userId: user?.id || null,
            label: 'pre-reparent',
            opSummary: { action: 'reparent', target_board: targetId, child_count: movable.length },
          });
        } catch (_) {}
      }

      // 4) DURABLE STRUCTURAL WRITE (commit point).
      let result;
      try {
        result = await moveBoardsUnder(movable, targetId, { userId: user?.id || null, sessionId: yb?.sessionId || null });
      } catch (err) {
        console.error('[reparent] move_boards_under failed', err);
        feedback.toast({ type: 'error', message: 'Move failed: ' + (err.message || err) });
        clearPending(); // un-hide — the move didn't happen, restore the card
        fail(err);
        return;
      }
      const moved = result?.moved || [];

      // 5) Refresh the local boards map BEFORE touching any canvas mirror.
      //    This ordering is load-bearing, not cosmetic. The reconcile-drift
      //    effect (≈ line 1194) re-runs on every cards/boards change and
      //    re-adds a kind:'board' card for any child of the CURRENT board that
      //    lacks one. If we delete the old-parent mirror while `boards` still
      //    says the moved board is a child of the current (old-parent) board,
      //    that effect fires on our deletion and instantly re-creates the card
      //    we just removed — so it lingers on the old parent forever while the
      //    target also shows it (its card materializes on open). Refreshing
      //    first makes the effect see the new parentage, so the deletion
      //    sticks. Same refresh-then-strip order as deleteBoardsById.
      try { await refreshBoards(); } catch (_) {}

      // 6) CANVAS MIRROR RECONCILE (best-effort).
      //    ADD to target: handled automatically by the reconcile-drift effect
      //    on whichever client has the target open (now or next open) — no
      //    action needed here. REMOVE the stale mirror card from each OLD
      //    parent: nothing else does this, so we must.
      const removeBoardCard = (ydoc, ids) => {
        const m = ydoc.getMap('cards');
        let removed = 0;
        ydoc.transact(() => {
          for (const id of ids) { if (m.has(id)) { m.delete(id); removed++; } }
        }, 'reparent-reconcile');
        return removed;
      };
      // Group moved children by their OLD parent.
      const byOldParent = new Map();
      for (const id of moved) {
        const p = prevParents.get(id) ?? null;
        if (!p) continue; // was a root board — no parent canvas to clean
        if (!byOldParent.has(p)) byOldParent.set(p, []);
        byOldParent.get(p).push(id);
      }
      for (const [oldParent, ids] of byOldParent) {
        try {
          if (oldParent === currentId && currentYDoc) {
            removeBoardCard(currentYDoc, ids); // live doc; syncs + persists
          } else {
            const snap = await loadBoardSnapshot(oldParent);
            if (!snap) continue; // abort-if-null: never overwrite with empty
            const tmp = new Y.Doc();
            Y.applyUpdate(tmp, b64ToBytes(snap));
            const before = tmp.getMap('cards').size;
            const removed = removeBoardCard(tmp, ids);
            const after = tmp.getMap('cards').size;
            if (removed > 0 && after === before - removed) {
              await saveBoardSnapshot(oldParent, tmp);
              // We wrote oldParent's board_state directly (it's not open
              // here), so a warm PartyKit room for it would re-merge its
              // stale state and bring the removed mirror card BACK. Reset the
              // room so it cold-loads what we just wrote. Best-effort + NON
              // fatal: this is cosmetic mirror cleanup (the structural move
              // already committed), so unlike the cross-board card move we do
              // NOT fail the operation if the reset can't run (e.g. plain vite
              // dev has no /reset proxy) — at worst a stale card lingers until
              // the reconcile heals it on next open. See the PartyKit clobber
              // note: same mechanism bulletproofRestore step 2 guards against.
              try {
                await forceResetBoardRoom(oldParent);
                window.__soleilEmitBoardReset?.(oldParent);
              } catch (resetErr) {
                console.warn('[reparent] old-parent room reset failed (cosmetic only)', oldParent, resetErr);
              }
            }
            tmp.destroy();
          }
        } catch (err) {
          console.warn('[reparent] old-parent canvas cleanup failed (structure ok)', oldParent, err);
        }
      }

      // 7) Tell the user.
      if (moved.length) {
        const msg = moved.length === 1
          ? `Moved “${boards[moved[0]]?.name || 'board'}” into ${targetName === 'top level' ? 'top level' : `“${targetName}”`}`
          : `Moved ${moved.length} boards into ${targetName === 'top level' ? 'top level' : `“${targetName}”`}`;
        const extra = (result?.skipped?.length)
          ? ` · skipped ${result.skipped.length}`
          : '';
        feedback.toast({ type: 'success', message: msg + extra });
      } else if (result?.skipped?.length) {
        const reasons = [...new Set(result.skipped.map(s => REASON_TEXT[s.reason] || s.reason))];
        feedback.toast({ type: 'info', message: `Nothing moved — ${reasons.join(', ')}.` });
      }
      // Un-hide: on success the moved card is already gone from the doc (step 6
      // removal ran in this same sync continuation), so clearing now can't
      // re-show it; on a partial/no-op result it restores any card we hid.
      clearPending();
      done(result);
    };
    document.addEventListener('soleil-board-reparent-drop', onReparent);
    return () => document.removeEventListener('soleil-board-reparent-drop', onReparent);
  }, [boards, feedback, currentYDoc, currentId, user?.id, refreshBoards]);

  // ⌘B / Ctrl-B — toggle compact sidebar.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'b' || e.key === 'B')) {
        // Robust editor guard: while typing in a note/doc, Cmd+B is "bold",
        // not "toggle sidebar". The old tag/isContentEditable check missed
        // ProseMirror/contenteditable-descendant targets.
        if (isEditableTarget(e)) return;
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
    if (c.kind === 'board') return !boards[c.id];
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
    // split) so a stale Y.Doc entry never produces a flashing card. Also hide
    // any board card whose reparent is in flight FROM this pane's board — keyed
    // on board.id so the card vanishes instantly from its old parent on drop
    // (no snap-back) while the target pane, if open, still shows it via the
    // reconcile-drift effect. See pendingReparent + the onReparent handler.
    const rawCards = ready ? yh.cards : [];
    const cards = (boardsLoading || !boards || Object.keys(boards).length === 0)
      ? rawCards
      : rawCards.filter(c =>
          !isOrphanRef(c) &&
          !(c.kind === 'board' && pendingReparent.get(c.id) === board.id));
    const arrows = ready ? yh.arrows : [];
    const strokes = ready ? yh.strokes : [];
    const groups = ready ? (yh.groups || []) : [];
    const muts = isMain ? mainMutatorsFull : splitMutatorsFull;
    const surfaceJsx = (() => {
      if (view === 'list') return (
        <ListSurface board={board} boards={boards} boardsReady={boardsReady} cards={cards}
                     childBoards={Object.values(boards).filter(b => b.parent_board_id === board.id)}
                     onOpenBoard={openBoard}
                     onOpenPicker={() => setPickerOpen(true)}
                     onDropInboxItem={dropInboxItem}
                     canEdit={isMain ? canEditCurrent : true}
                     peersHereByBoard={peersHereByBoard}
                     peersBelowByBoard={peersBelowByBoard}
                     onJumpToPeer={jumpToPeer}
                     mutators={muts} />
      );
      return (
        <Profiler id={`canvas-${isMain ? 'main' : 'split'}`} onRender={onCanvasRender}>
          <CanvasSurface board={board} boards={boards} boardsReady={boardsReady} cards={cards} arrows={arrows} strokes={strokes} groups={groups}
                         ydoc={yd}
                         getAwareness={yh.getAwareness}
                         peersHereByBoard={peersHereByBoard}
                         peersBelowByBoard={peersBelowByBoard}
                         wsPeers={wsPeers}
                         onJumpToPeer={jumpToPeer}
                         canEdit={isMain ? canEditCurrent : true}
                         boardPermission={isMain ? currentBoardPerm : null}
                         onRequestUpgrade={() => setUpgradeReason('shared-edit')}
                         currentUser={currentUser}
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
                         sessionId={yh?.sessionId || null}
                         frictionStuck={isMain ? frictionStuck : false}
                         firstCardArm={isMain ? (getEnrolledArm('first_card_cta') || 'A') : 'A'}
                         showcaseArm={isMain ? (getEnrolledArm('welcome_showcase') || 'A') : 'A'}
                         defaults={defaults} />
        </Profiler>
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
        <SurfaceErrorBoundary>{surfaceJsx}</SurfaceErrorBoundary>
        {/* Loading overlay while the Y.Doc is hydrating. Keeps the page feeling
            alive during the boot window where CanvasSurface mounts but holds
            no data — without this, the user stares at an empty canvas with
            zero visual feedback for ~500ms-2s on cold loads. */}
        {!ready && (
          <div className="board-loading-overlay" aria-hidden="true">
            {/* Ghost cards: the page reads as "a board is coming" instead
                of a bare mark on an empty void. */}
            <div className="board-loading-ghosts">
              <span className="board-loading-ghost" />
              <span className="board-loading-ghost" />
              <span className="board-loading-ghost" />
            </div>
            <SoleilMark size={36} color="var(--soleil)" glow />
          </div>
        )}
      </div>
    );
  };

  return (
    <EntityNavigateContext.Provider value={navHandlers}>
    <OpenDmContext.Provider value={openDmWith}>
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
      {isPhone && mobileNavOpen && (
        <div className="sidebar-mobile-backdrop"
             onClick={() => setMobileNavOpen(false)}
             aria-hidden="true" />
      )}
      <aside className={`sidebar${isPhone && mobileNavOpen ? ' is-mobile-open' : ''}`}>
        {/* Single-column sidebar. Workspace switcher is now a popover
            triggered from the header (Notion-style) instead of the
            old icon rail. Settings + avatar live at the bottom. */}
        <div className="sb-mid">
          <div className="sb-mid-head">
            <button className="sb-ws-trigger"
                    onClick={() => setWsMenuOpen(o => !o)}
                    title={`${workspace.name} · click to switch`}
                    aria-haspopup="menu" aria-expanded={wsMenuOpen}>
              {(() => {
                const iconSrc = workspace.settings?.icon_url || '';
                return iconSrc ? (
                  <span className="sb-ws-avatar sb-ws-avatar-img">
                    <R2Image src={iconSrc} alt="" />
                  </span>
                ) : (
                  <span className="sb-ws-avatar" style={{ background: pickPresenceColor(workspace.id) }}>
                    {(workspace.name || '?').trim().charAt(0).toUpperCase()}
                  </span>
                );
              })()}
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
            onCreateBoard={canEditCurrent ? () => { setCurrentSurface('board'); mainMutators.addNewBoard?.(); } : null}
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
              settings (defaults, theme, display). Avatar opens identity
              (name, presence color, billing, notifications, sign out). */}
          <div className="sb-foot">
            <button className="sb-foot-icon" title="Workspace settings" aria-label="Workspace settings"
                    onClick={() => setSettingsOpen(true)}>
              <Icon as={Settings} size={14} />
            </button>
            {(() => {
              const avatarSrc = ownProfile?.avatar_url || '';
              if (avatarSrc) {
                return (
                  <button className="sb-foot-avatar sb-foot-avatar-img" title="Account"
                          onClick={() => setAccountOpen(true)}>
                    <R2Image src={avatarSrc} alt="" />
                  </button>
                );
              }
              return (
                <button className="sb-foot-avatar" title="Account"
                        style={{ background: userInfo.color || pickPresenceColor(user.id) }}
                        onClick={() => setAccountOpen(true)}>
                  {(user.email?.[0] || 'Y').toUpperCase()}
                </button>
              );
            })()}
          </div>
        </div>
      </aside>
      {/* Avatar → identity-only modal (Profile tab). */}
      <SettingsPanel
        open={accountOpen}
        onClose={() => { setAccountOpen(false); setAccountInitialTab(null); }}
        mode="account"
        initialTab={accountInitialTab}
        user={user}
        onSignOut={signOut}
        workspaceId={workspace?.id}
        workspaceName={workspace?.name}
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
        workspaceName={workspace?.name}
        onWorkspacesChanged={onWorkspacesChanged}
        onSaved={() => onWorkspacesChanged?.()}
        defaults={defaults}
        role={workspaceRole}
        refresh={refreshSettings}
        workspaceSettings={workspaceSettings}
        mySettings={mySettings}
        onOpenRecovery={() => { setSettingsOpen(false); setWorkspaceRecoveryOpen(true); }} />

      <main className="main">
        <WorkspaceAlertBanner
          workspaceId={workspace?.id}
          onOpenRecovery={() => setWorkspaceRecoveryOpen(true)}
        />
        <div className="topbar">
          <div className="tb-left">
            {(tweak.compactSidebar || isPhone) && (
              <button className="tb-icon" title={isPhone ? 'Open menu' : 'Open sidebar (⌘B)'}
                      aria-label={isPhone ? 'Open menu' : 'Open sidebar'}
                      onClick={() => {
                        if (isPhone) setMobileNavOpen(true);
                        else setTweak('compactSidebar', false);
                      }}>
                <Icon as={PanelLeftOpen} size={16} />
              </button>
            )}
            <button className="tb-brand" title="Home" aria-label="Clusters home"
                    onClick={() => setCurrentSurface('home')}>
              <ClustersMark size={22} />
              <span className="tb-brand-text">Clusters</span>
            </button>
            <span className="tb-brand-sep" aria-hidden="true" />
            <button className="tb-icon" title="Back" aria-label="Back"
                    disabled={!navCaps.back} onClick={() => navHistGo(-1)}>
              <Icon as={ChevronLeft} size={15} />
            </button>
            <button className="tb-icon" title="Forward" aria-label="Forward"
                    disabled={!navCaps.fwd} onClick={() => navHistGo(1)}>
              <Icon as={ChevronRight} size={15} />
            </button>
            <div className="crumbs">
              {crumbs.map((c, i) => (
                <React.Fragment key={`${c.id}-${i}`}>
                  {i > 0 && <span className="crumb-sep" aria-hidden="true">›</span>}
                  <span className={`crumb ${i === crumbs.length - 1 ? 'here' : 'clk'}`} title={c.name} onClick={() => goTo(i)}>{c.name}</span>
                </React.Fragment>
              ))}
            </div>
          </div>

          <div className="tb-center">
            <div className="view-pill">
              <button className={`view-pill-btn ${view !== 'list' ? 'on' : ''}`} onClick={() => setView('canvas')}>Canvas</button>
              <button className={`view-pill-btn ${view === 'list' ? 'on' : ''}`} onClick={() => setView('list')}>List</button>
            </div>
            {/* Read-only notice for demo-tier viewers — self-gates on
                source==='tier-demoted'. Anchored under the view toggle so it
                reads as centered in the content area on both canvas + list. */}
            <ReadOnlyBanner boardPermission={currentBoardPerm}
                            onRequestUpgrade={() => setUpgradeReason('shared-edit')} />
          </div>

          <div className="tb-right">
            {myTier.tier === 'admin' && (
              <button className="tb-admin-btn"
                      title="Admin dashboard"
                      onClick={() => window.location.assign('/admin')}>
                Admin
              </button>
            )}
            <button className="tb-icon" title="Undo (⌘Z)" disabled={!yb.canUndo} onClick={() => mainMutators.undo?.()}>
              <Icon as={Undo} size={16} />
            </button>
            <button className="tb-icon" title="Redo (⌘⇧Z)" disabled={!yb.canRedo} onClick={() => mainMutators.redo?.()}>
              <Icon as={Redo} size={16} />
            </button>
            <button className="tb-icon tb-icon-trash" title="Deleted boards (Trash)" onClick={() => setTrashOpen(true)}>
              <Icon as={Trash2} size={16} />
            </button>
            <FeedbackButton as="icon" />
            <span className="tb-divider" aria-hidden="true" />
            <WorkspacePresenceStack peers={wsPeers} status={wsStatus} selfId={user.id}
                                    workspaceId={workspace.id}
                                    onJumpTo={jumpToPeer} />
            <span className="tb-divider" aria-hidden="true" />
            {!canEditCurrent && (
              <span className="tb-viewonly" title="You have view-only access to this board">VIEW ONLY</span>
            )}
            <button className="tb-icon tb-icon-link"
                    onClick={() => setBacklinksRef({ kind: 'board', id: currentBoard.id })}
                    title="Linked from — every doc, message, and card that mentions this board">
              <Icon as={LinkIcon} size={16} />
            </button>
            <button className="tb-btn" onClick={() => setShareOpen(true)} title="Share this board">
              <Icon as={Share2} size={14} /> <span className="tb-btn-label">Share</span>
            </button>
            <button className="tb-icon tb-icon-theme" title="Toggle theme"
                    onClick={() => setTheme(themeMode === 'dark' ? 'light' : 'dark')}>
              <Icon as={themeMode === 'dark' ? Sun : Moon} size={16} />
            </button>
            <button className="tb-icon tb-icon-split"
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
          <Suspense fallback={<div style={{ display: 'grid', placeItems: 'center', width: '100%', height: '100%' }}><SoleilMark size={28} color="var(--soleil)" glow /></div>}>
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
          </Suspense>
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

      <TrashModal
        open={trashOpen}
        workspaceId={workspace.id}
        onBoardRestored={() => refreshBoards()}
        onClose={() => setTrashOpen(false)}
      />

      <ShortcutsHost />

      <WorkspaceRecoveryModal
        open={workspaceRecoveryOpen}
        workspaceId={workspace.id}
        onRewindComplete={() => refreshBoards()}
        onClose={() => setWorkspaceRecoveryOpen(false)}
      />

      {tweak.showMessages && (
        <MessagesPanel
          workspaceId={workspace.id}
          currentUser={userInfo}
          canSendMessages={
            // Mirrors SQL can_write_workspace: demo users can only send
            // messages in their OWN workspace; admin/paid get the
            // workspace-membership check; waitlist is blocked.
            myTier.tier === 'waitlist'
              ? false
              : (myTier.tier === 'admin' || myTier.tier === 'paid')
                ? workspaceMembers.some(m => m.user_id === user.id)
                : workspace?.created_by === user.id
          }
          refreshTick={msgRefreshTick}
          openConversationId={openConversationId}
          setOpenConversationId={setOpenConversationId}
          initialOpenConversationId={permalinkTarget?.conversationId || null}
          jumpToMessageId={permalinkTarget?.messageId || null}
          pendingOpenPeerId={pendingDmPeerId}
          suggestedUserIds={
            new Set([
              ...((peersHereByBoard.get(currentBoard.id) || []).map(p => p?.user?.id).filter(Boolean)),
              ...((peersBelowByBoard.get(currentBoard.id) || []).map(p => p?.user?.id).filter(Boolean)),
            ])
          }
          onRefreshRequested={() => setMsgRefreshTick(t => t + 1)}
          onPermalinkConsumed={() => setPermalinkTarget(null)}
          onPeerConsumed={() => setPendingDmPeerId(null)}
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
          tier={myTier.tier}
          onUpgrade={() => setUpgradeReason('manual')}
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

      {upgradeReason && (
        <UpgradeModal reason={upgradeReason} onClose={() => setUpgradeReason(null)} />
      )}

      {showCoachmark && (
        <OnboardingCoachmark boardId={rootBoard.id} onDismiss={dismissOnboarding} hasTutorialBoard={!!myTier.onboarding?.tutorialBoardId} escalated={frictionStuck} arm={getEnrolledArm('coachmark_copy')} />
      )}

      {isPhone && (
        <MobileBottomNav
          active={
            currentSurface === 'home' ? 'home'
            : tweak.showMessages ? 'messages'
            : settingsOpen ? 'settings'
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
            // Each tap is a destination; closing the others keeps the
            // surface stack consistent (only one "primary" overlay at a time).
            setMobileNavOpen(false);
            if (k === 'home')     { setCurrentSurface('home'); setPickerOpen(false); setSettingsOpen(false); setTweak('showMessages', false); }
            if (k === 'search')   { setPickerOpen(true); setSettingsOpen(false); setTweak('showMessages', false); }
            if (k === 'messages') { setTweak('showMessages', true); setPickerOpen(false); setSettingsOpen(false); }
            if (k === 'settings') { setSettingsOpen(true); setPickerOpen(false); setTweak('showMessages', false); }
          }}
        />
      )}

    </div>
    </AppTrieProvider>
    </OpenDmContext.Provider>
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
    const onDown = (event) => { if (!event.target.closest?.('.topbar-add')) setOpen(false); };
    window.addEventListener('keydown', onKey);
    // pointerdown (capture) + mousedown so a tap-away closes it on touch.
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
