// BoardMoreNudge — the first board asks for more (experiments.js
// first_board_more; the rules are lib/boardMore.js).
//
// App renders it only for an account new enough for the test, or a QA tab
// (lib/boardMoreEpoch.js boardMoreMayRun), so nobody else fetches it. It:
//
//  - decides at the first load that knows the account's onboarding record
//    whether it is in the test, and stamps its arm on the server either way
//    (the setup's stamp, lib/setupGate.js, with its own device mark);
//  - watches the open board: a card landing that takes it to 3..9 arms the
//    moment, and once things have been quiet a moment and nothing else is on
//    screen, both arms log it ('eligible') and only B sees the toast.
//
// It never lands on the tour, a dialog, the import guide, an upgrade offer or
// another hint, and holds the hint mutex only while it is up, so the setup's
// tips and re-ask wait seconds, never a visit. It claims no upsell slot: it
// spends nobody's turn. Shown or not, the moment is kept on the profile (one
// writer per key) and on the device, and never comes again.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { supabase } from '../lib/supabase.js';
import { logEvent, logEventNow, setEnrolledExperiments, getEnrolledArm } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { updateOwnSettings } from '../lib/boardsApi.js';
import { anyModalOpen } from '../lib/modalGuard.js';
import { tourShowing, hintUp, claimHint, releaseHint } from '../lib/hints.js';
import { upsellSlotBusy } from '../lib/upsellSlot.js';
import { isImportGuideOpen } from '../lib/importGuide.js';
import { hasActiveImport, subscribeImportJobs } from '../lib/importJobs.js';
import { onPreviewHost } from '../lib/appHost.js';
import { genuineCards } from '../lib/firstValueTrigger.js';
import { stampSetupArm } from '../lib/setupGate.js';
import {
  BOARD_MORE_KEY, BOARD_MORE_SETTING, BOARD_MORE_MAX_CARDS, BOARD_MORE_QUIET_MS, BOARD_MORE_RETRY_MS,
  BOARD_MORE_TTL_MS, BOARD_MORE_STAMP_PREFIX, BOARD_MORE_CAND_PREFIX, BOARD_MORE_DONE_PREFIX,
  isBoardMoreCandidate, boardMoreArm, readBoardMoreOverride, boardMoreArms, boardMoreDue,
  boardMoreCopy, noteBesidePictures, isPictureCard, boardMoreRecord,
} from '../lib/boardMore.js';

// What else counts as on screen: SetupInWorkspace's set (CanvasSurface's
// blocking overlays, the share and join cards, any modal dialog).
const BUSY_SELECTOR = '[aria-modal="true"], .settings-bg, .upgrade-backdrop, .cmdk-bg, .lightbox, .pdfv, .iem, .share-prompt, .modal-shell-bg';
const HINT = 'board_more';
const OPEN_SETTLE_MS = 3_000;

function screenBusy() {
  if (anyModalOpen() || tourShowing() || isImportGuideOpen()) return true;
  const held = hintUp();
  if (held && held !== HINT) return true;
  try { if (upsellSlotBusy()) return true; } catch (_) { /* no slot, no wait */ }
  try { if (document.querySelector(BUSY_SELECTOR)) return true; } catch (_) { /* no DOM */ }
  return false;
}

function readMark(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
function setMark(key, v) { try { localStorage.setItem(key, v); } catch (_) { /* the profile keeps it */ } }

// A hidden picker, opened inside the press that asked for it.
function pick({ folder, accept, onFiles }) {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  if (accept) input.accept = accept;
  if (folder) input.setAttribute('webkitdirectory', '');
  input.style.display = 'none';
  input.addEventListener('change', () => {
    const files = [...(input.files || [])];
    input.remove();
    if (files.length) onFiles(files);
  }, { once: true });
  document.body.appendChild(input);
  input.click();
}

export default function BoardMoreNudge({
  user, tierLoaded, onboarding, settings, settingsLoaded,
  boardId, boardReady, cards, canEdit, uploading: sidebarUploading, tourActive,
  phone, canFolder, feedback, onFolder, onPhotos, onNote,
}) {
  const uid = user?.id || null;
  const createdAt = user?.created_at || null;
  const importing = useSyncExternalStore(subscribeImportJobs, hasActiveImport, hasActiveImport);
  const uploading = !!sidebarUploading || importing;

  const override = useMemo(() => {
    try {
      return readBoardMoreOverride({
        search: window.location.search, storage: window.sessionStorage,
        allowed: import.meta.env.DEV || onPreviewHost(),
      });
    } catch (_) { return null; }
  }, []);

  // ── Who is in it, and the stamp ─────────────────────────────────────────
  // Decided once per account, at the first render that knows the tier: the
  // seed writes `seeded` moments after this load starts, so asking later would
  // turn every new account away. A device mark keeps the answer, so a stamp
  // that failed is tried again on the next load.
  const [decided, setDecided] = useState({ uid: null, candidate: false });
  useEffect(() => {
    if (!uid || !tierLoaded || decided.uid === uid) return;
    const candKey = `${BOARD_MORE_CAND_PREFIX}${uid}`;
    const candidate = isBoardMoreCandidate({ createdAt, onboarding })
      || (isBoardMoreCandidate({ createdAt }) && readMark(candKey) === '1');
    setDecided({ uid, candidate });
    if (!candidate || override) return;
    setMark(candKey, '1');
    const arm = boardMoreArm({ uid, candidate: true });
    if (!arm) return;
    setEnrolledExperiments({ [`exp_${BOARD_MORE_KEY}`]: arm }, uid);
    if (!supabase) return;
    let storage = null;
    try { storage = window.localStorage; } catch (_) { /* stamp without the mark */ }
    stampSetupArm({
      uid, arm, storage, markPrefix: BOARD_MORE_STAMP_PREFIX,
      rpc: () => supabase.rpc('set_experiment_arm', { p_key: BOARD_MORE_KEY, p_arm: arm }),
      log: () => logEvent(EV.EXPERIMENT_ENROLLED, { key: BOARD_MORE_KEY, arm }),
    });
  }, [uid, tierLoaded, onboarding, createdAt, override, decided.uid]);

  // The arm at the moment it is needed: on a later load or another device the
  // server's stamp (primed at sign-in) says it.
  const armNow = useCallback(() => boardMoreArm({
    uid,
    candidate: decided.uid === uid && decided.candidate,
    override,
    enrolled: uid ? getEnrolledArm(BOARD_MORE_KEY, uid) : null,
  }), [uid, decided, override]);

  // ── The open board ──────────────────────────────────────────────────────
  const genuine = useMemo(() => (boardId && boardReady ? genuineCards(cards) : null), [boardId, boardReady, cards]);
  const count = genuine ? genuine.length : null;
  const live = useRef({});
  live.current = { genuine, count, canEdit, uploading, settings, settingsLoaded, tourActive, phone, canFolder, feedback, onFolder, onPhotos, onNote };

  const lastActivity = useRef(Date.now());
  useEffect(() => { lastActivity.current = Date.now(); }, [count, uploading]);

  // A card landing arms it; opening a board (its doc filling in) does not:
  // for a moment after a board opens, a change in its count is the doc
  // arriving, not a card.
  const seen = useRef({ boardId: null, n: null, at: 0 });
  const [armedFor, setArmedFor] = useState(null);
  useEffect(() => {
    const s = seen.current;
    if (s.boardId !== boardId || count == null) {
      seen.current = { boardId, n: count, at: Date.now() };
      if (s.boardId !== boardId) setArmedFor(null);
      return;
    }
    if (s.n == null) { seen.current = { boardId, n: count, at: Date.now() }; return; }
    if (Date.now() - s.at < OPEN_SETTLE_MS) { seen.current = { ...s, n: count }; return; }
    if (boardMoreArms({ prev: s.n, next: count })) setArmedFor(boardId);
    else if (count >= BOARD_MORE_MAX_CARDS) setArmedFor(null);
    seen.current = { ...s, n: count };
  }, [boardId, count]);

  const [finished, setFinished] = useState(() => !!uid && readMark(`${BOARD_MORE_DONE_PREFIX}${uid}`) === '1');
  const showingRef = useRef(false);

  const keep = useCallback((arm, action) => {
    setMark(`${BOARD_MORE_DONE_PREFIX}${uid}`, '1');
    updateOwnSettings({ [BOARD_MORE_SETTING]: boardMoreRecord({ arm, action, now: new Date().toISOString() }) })
      .catch(() => { /* the device mark keeps it */ });
  }, [uid]);

  useEffect(() => {
    // Once a page load even under ?more=, which only skips the records.
    if (!uid || !armedFor || armedFor !== boardId || showingRef.current || finished) return undefined;
    let timer = 0;
    const attempt = () => {
      const L = live.current;
      const arm = armNow();
      if (!arm) return;                                   // not in the test
      const qa = !!override;
      if (!qa && !L.settingsLoaded) { timer = setTimeout(attempt, BOARD_MORE_RETRY_MS); return; }
      const done = !!L.settings?.[BOARD_MORE_SETTING] || readMark(`${BOARD_MORE_DONE_PREFIX}${uid}`) === '1';
      const now = new Date().toISOString();
      const rule = { arm, done, qa, createdAt, now, canEdit: L.canEdit, cards: L.count };
      // What can't change by waiting: stand down until the next card.
      if (!boardMoreDue({ ...rule, uploading: false, busy: false, quietFor: BOARD_MORE_QUIET_MS })) {
        if (done && !qa) setFinished(true);
        setArmedFor(null);
        return;
      }
      const quietFor = Date.now() - lastActivity.current;
      if (quietFor < BOARD_MORE_QUIET_MS) { timer = setTimeout(attempt, BOARD_MORE_QUIET_MS - quietFor); return; }
      if (L.uploading || L.tourActive || screenBusy()) { timer = setTimeout(attempt, BOARD_MORE_RETRY_MS); return; }
      if (arm === 'B' && !claimHint(HINT)) { timer = setTimeout(attempt, BOARD_MORE_RETRY_MS); return; }

      const pics = (L.genuine || []).some(isPictureCard);
      const base = { arm, cards: L.count, phone: !!L.phone, folder: !!L.canFolder, pictures: pics };
      try { logEventNow(EV.BOARD_MORE_NUDGE, { action: 'eligible', ...base }); } catch (_) {}
      setArmedFor(null);
      if (!qa) keep(arm, 'eligible');
      if (arm !== 'B') { setFinished(true); return; }

      showingRef.current = true;
      const copy = boardMoreCopy({ canFolder: L.canFolder });
      let closed = false;
      let expiry = 0;
      const close = (action) => {
        if (closed) return;
        closed = true;
        clearTimeout(expiry);
        releaseHint(HINT);
        showingRef.current = false;
        setFinished(true);
        try { logEventNow(EV.BOARD_MORE_NUDGE, { action, ...base }); } catch (_) {}
        if (!qa) keep(arm, action);
      };
      const run = (id) => {
        close(id);
        try {
          const now = live.current;
          if (id === 'folder') pick({ folder: true, onFiles: now.onFolder });
          else if (id === 'photos') pick({ accept: 'image/*,video/*', onFiles: now.onPhotos });
          else now.onNote(noteBesidePictures(now.genuine || [], { phone: !!now.phone }));
        } catch (_) { /* the toast is gone either way */ }
      };
      L.feedback.toast({
        type: 'info',
        message: copy.message,
        ttl: BOARD_MORE_TTL_MS,
        actions: copy.actions.map((a) => ({ label: a.label, onClick: () => run(a.id) })),
        onDismiss: () => close('dismiss'),
      });
      expiry = setTimeout(() => close('expire'), BOARD_MORE_TTL_MS + 250);
      try { logEvent(EV.BOARD_MORE_NUDGE, { action: 'view', ...base }); } catch (_) {}
    };
    timer = setTimeout(attempt, 0);
    return () => clearTimeout(timer);
  }, [uid, armedFor, boardId, finished, override, armNow, createdAt, keep]);

  // Released if the board goes away mid-toast.
  useEffect(() => () => { releaseHint(HINT); }, []);

  return null;
}
