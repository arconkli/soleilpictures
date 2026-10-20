// SetupInWorkspace — the first-run setup's part inside the workspace. App
// renders it once, wherever the setup can run (appHost.js
// workspaceSetupAllowed), with what it already knows; this decides what shows
// when, keeps the records and logs all of it:
//
//  - the one invite re-ask (workspaceSetup.js reaskDue): arm B, someone who
//    skipped the invite step, once their own work reaches REASK_MIN_CARDS. It
//    goes first: it is the setup's real invite push.
//  - the three tips (setupTips.js): every new account, both arms, once
//    something is on the board and they've been quiet a moment.
//  - where someone who joined by a workspace link landed: the cluster with the
//    newest work (App's landing fallback opens it) or the root, and whether
//    the workspace had anything in it yet.
//
// Neither ever shows over the tour, a dialog, the import guide, an upgrade
// offer or another hint, and neither shows twice: the record is kept on the
// profile (one writer per key) and on the device, for the moments before the
// profile has loaded.

import { Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { lazyWithReload } from '../../lib/lazyWithReload.js';
import { logEvent, logEventNow } from '../../lib/analytics.js';
import { EV } from '../../lib/analyticsEvents.js';
import { updateOwnSettings } from '../../lib/boardsApi.js';
import { anyModalOpen } from '../../lib/modalGuard.js';
import { tourShowing, hintUp, claimHint, releaseHint } from '../../lib/hints.js';
import { upsellSlotBusy } from '../../lib/upsellSlot.js';
import { isImportGuideOpen } from '../../lib/importGuide.js';
import { hasActiveImport, subscribeImportJobs } from '../../lib/importJobs.js';
import { TIPS_KEY, TIPS_QUIET_MS, TIPS_RETRY_MS, tipsEligible, tipsDue, tipsRecord } from '../../lib/setupTips.js';
import { REASK_KEY, REASK_SETTLE_MS, reaskDue } from '../../lib/workspaceSetup.js';
import { joinedFlagKey } from '../../lib/workspaceLink.js';

const SetupTips = lazyWithReload(() => import('./SetupTips.jsx'));
const InviteReask = lazyWithReload(() => import('./InviteReask.jsx'));

// What counts as something already on screen, besides the registered modals:
// the app's own overlays by class (CanvasSurface's blocking set), the share
// and join cards in the corner, and any modal dialog.
const BUSY_SELECTOR = '[aria-modal="true"], .settings-bg, .upgrade-backdrop, .cmdk-bg, .lightbox, .pdfv, .iem, .share-prompt, .modal-shell-bg';

function screenBusy(self) {
  if (anyModalOpen() || tourShowing() || isImportGuideOpen()) return true;
  const held = hintUp();
  if (held && held !== self) return true;
  try { if (upsellSlotBusy()) return true; } catch (_) { /* no slot, no wait */ }
  try { if (document.querySelector(BUSY_SELECTOR)) return true; } catch (_) { /* no DOM */ }
  return false;
}

const flagKey = (what, uid) => `soleil.setup.${what}.${uid}`;
function readFlag(key) { try { return localStorage.getItem(key) === '1'; } catch (_) { return false; } }
function setFlag(key) { try { localStorage.setItem(key, '1'); } catch (_) { /* the profile keeps it */ } }

export default function SetupInWorkspace({
  user, workspace, settings, settingsLoaded, welcome, arm,
  ownCards, boardCards, wsCards, uploading: sidebarUploading,
  phone, sidebarShown, openDrawer, closeDrawer, canImport, openGuide,
  currentBoardId, rootBoardId, boardsReady, loadPhotos,
}) {
  const uid = user?.id;
  const importing = useSyncExternalStore(subscribeImportJobs, hasActiveImport, hasActiveImport);
  const uploading = !!sidebarUploading || importing;
  const [showing, setShowing] = useState(null);       // null | 'tips' | 'reask'
  const [ended, setEnded] = useState({ tips: false, reask: false });
  const seenHere = useRef({ tips: readFlag(flagKey('tips', uid)), reask: readFlag(flagKey('reask', uid)) });
  const lastActivity = useRef(Date.now());
  const ownWorkspace = !!workspace?.id && workspace.created_by === uid;

  // Quiet is measured from the last card added, anywhere they can see it, or
  // the last upload that finished.
  useEffect(() => { lastActivity.current = Date.now(); }, [ownCards, boardCards, uploading]);

  const cards = Number(ownCards) || 0;
  const nowIso = () => new Date().toISOString();

  // ── The re-ask ────────────────────────────────────────────────────────────
  const reaskOpen = !!settingsLoaded && ownWorkspace && reaskDue({
    arm: arm || (welcome?.done && !welcome?.invitee ? 'B' : null),
    welcome,
    reasked: !!settings?.[REASK_KEY] || seenHere.current.reask || ended.reask,
    ownCards: cards,
    uploading,
    overlayOpen: false,          // checked on screen when it is time (screenBusy)
    createdAt: user?.created_at,
    now: nowIso(),
  });

  useEffect(() => {
    if (!reaskOpen || showing) return undefined;
    let t = 0;
    const attempt = () => {
      const quiet = Date.now() - lastActivity.current;
      if (quiet < REASK_SETTLE_MS) { t = setTimeout(attempt, REASK_SETTLE_MS - quiet); return; }
      if (screenBusy('invite_reask') || !claimHint('invite_reask')) { t = setTimeout(attempt, TIPS_RETRY_MS); return; }
      try { logEvent(EV.INVITE_REASK, { action: 'view', cards, phone: !!phone }); } catch (_) {}
      setShowing('reask');
    };
    t = setTimeout(attempt, 0);
    return () => clearTimeout(t);
  }, [reaskOpen, showing]); // eslint-disable-line react-hooks/exhaustive-deps

  const closeReask = useCallback((action, counts = {}) => {
    releaseHint('invite_reask');
    // The tips, if they're still to come, wait for a quiet moment of their own
    // rather than follow the re-ask onto the screen.
    lastActivity.current = Date.now();
    setShowing(null);
    setEnded((e) => ({ ...e, reask: true }));
    setFlag(flagKey('reask', uid));
    try { logEventNow(EV.INVITE_REASK, { action, cards, emails: counts.emails || 0, links: counts.links || 0, phone: !!phone }); } catch (_) {}
    updateOwnSettings({ [REASK_KEY]: { v: 1, at: nowIso(), action, emails: counts.emails || 0, links: counts.links || 0 } })
      .catch((e) => { try { logEvent(EV.SETUP_ERROR, { op: 'settings', surface: 'reask', reason: String(e?.message || e).slice(0, 80) }); } catch (_) {} });
  }, [uid, cards, phone]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── The tips ──────────────────────────────────────────────────────────────
  const tipsOk = !!settingsLoaded && tipsEligible({
    allowed: true,
    createdAt: user?.created_at,
    record: settings?.[TIPS_KEY],
    seenHere: seenHere.current.tips || ended.tips,
  });
  const hasCards = cards > 0 || (Number(boardCards) || 0) > 0;

  useEffect(() => {
    if (!tipsOk || showing || reaskOpen || !hasCards || uploading || !sidebarShown) return undefined;
    let t = 0;
    const attempt = () => {
      const quietFor = Date.now() - lastActivity.current;
      if (!tipsDue({ eligible: true, hasCards: true, uploading: false, quietFor, blocked: false, sidebarShown: true })) {
        t = setTimeout(attempt, Math.max(250, TIPS_QUIET_MS - quietFor));
        return;
      }
      if (screenBusy('setup_tips') || !claimHint('setup_tips')) { t = setTimeout(attempt, TIPS_RETRY_MS); return; }
      setShowing('tips');
    };
    t = setTimeout(attempt, 0);
    return () => clearTimeout(t);
  }, [tipsOk, showing, reaskOpen, hasCards, uploading, sidebarShown, ownCards, boardCards]);

  const onTipStep = useCallback((tip, action) => {
    try { logEvent(EV.SETUP_TIPS, { tip: tip.id, action, cards, phone: !!phone }); } catch (_) {}
  }, [cards, phone]);

  const endTips = useCallback((tip, action) => {
    releaseHint('setup_tips');
    setShowing(null);
    setEnded((e) => ({ ...e, tips: true }));
    setFlag(flagKey('tips', uid));
    try { logEventNow(EV.SETUP_TIPS, { tip: tip.id, action, cards, phone: !!phone }); } catch (_) {}
    updateOwnSettings({ [TIPS_KEY]: tipsRecord({ last: tip.id, action, now: nowIso() }) })
      .catch((e) => { try { logEvent(EV.SETUP_ERROR, { op: 'settings', surface: 'tips', reason: String(e?.message || e).slice(0, 80) }); } catch (_) {} });
  }, [uid, cards, phone]); // eslint-disable-line react-hooks/exhaustive-deps

  // Released if the workspace goes away mid-tip.
  useEffect(() => () => { releaseHint('setup_tips'); releaseHint('invite_reask'); }, []);

  // ── Where a link joiner landed ────────────────────────────────────────────
  useEffect(() => {
    if (!boardsReady || !uid || !workspace?.id || ownWorkspace) return undefined;
    let joined = null;
    try { joined = sessionStorage.getItem(joinedFlagKey(uid)); } catch (_) { joined = null; }
    if (joined !== workspace.id) return undefined;
    // App's landing fallback opens the newest populated cluster as the boards
    // come in; read where they are once it has had its turn.
    const t = setTimeout(() => {
      try { sessionStorage.removeItem(joinedFlagKey(uid)); } catch (_) {}
      const total = Number(wsCards) || 0;
      try {
        logEvent(EV.JOINER_LANDED, {
          via: 'workspace_link', on_root: currentBoardId === rootBoardId, board_cards: Number(boardCards) || 0,
          ws_cards: total, empty: total === 0, phone: !!phone,
        });
      } catch (_) {}
    }, 1500);
    return () => clearTimeout(t);
  }, [boardsReady, uid, workspace?.id, ownWorkspace]); // eslint-disable-line react-hooks/exhaustive-deps

  if (showing === 'reask') {
    return (
      <Suspense fallback={null}>
        <InviteReask workspace={workspace} isPhone={phone} loadPhotos={loadPhotos}
          boardIds={[currentBoardId, rootBoardId].filter((id, i, a) => id && a.indexOf(id) === i)}
          onClose={closeReask} />
      </Suspense>
    );
  }
  if (showing === 'tips') {
    return (
      <Suspense fallback={null}>
        <SetupTips phone={phone} canImport={canImport} onStep={onTipStep} onEnd={endTips}
          onHow={openGuide} openDrawer={openDrawer} closeDrawer={closeDrawer} />
      </Suspense>
    );
  }
  return null;
}
