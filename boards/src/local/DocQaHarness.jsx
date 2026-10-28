// Dev-only doc QA harness (reached via ?docqa=1 in a DEV build — see
// isDocQaMode() in ../lib/localMode.js). Mounts the REAL RichDocCard against
// a fresh in-memory Y.Doc with stub awareness so Playwright can drive genuine
// doc behaviour (pages, sheets/pagination, rename, formatting, bookmarks,
// comments, links) without Supabase / PartyKit.
//
// It also publishes a test bridge on window.__soleilDocTest exposing the whole
// docState namespace + Y so logic specs can build their own Y.Docs / scopes in
// page.evaluate, plus the harness's live ydoc/cardYMap/scope and an openCard()
// helper that drives the real open path (the soleil-open-doc-card event).
//
// This module is dynamically imported only when the gate is on, so it is never
// part of the production bundle.

import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { MessagesUiContext } from '../hooks/useOpenDm.js';
import * as docState from '../lib/docState.js';
import * as docExport from '../lib/docFullExport.js';
import * as screenplayFlow from '../components/docExtensions/screenplay/screenplayFlow.js';
import * as screenplayIO from '../lib/screenplayIO.js';
import * as screenplayPaginate from '../lib/screenplayPaginate.js';
import * as screenplayPrint from '../lib/screenplayPrint.js';
import * as screenplayPdf from '../lib/screenplayPdf.js';
import { encodeAnchor, resolveAnchor } from '../lib/bookmarkRelPos.js';
import { RichDocCard } from '../components/DocCard.jsx';
import { setDocImageUploader } from '../components/docExtensions/ImageUpload.js';
import { announceBoardReload, markLocalReset } from '../lib/docResets.js';
import { useOrphanedDocResets } from '../hooks/useOrphanedDocResets.js';
import { DocPanesQa } from './DocPanesQa.jsx';
import { createQaRoom } from './docQaRoom.js';

const CARD_ID = 'docqa-card';
const HOST_BOARD = 'docqa-board';

// ?docqa=1&reload=1 puts the doc on a cluster and lets a spec reload that
// cluster the way a restore (or cards moved into it) does in the app: reload()
// announces it as useYBoard does (lib/docResets.js), takes the cluster's cards
// away a beat later, the doc's own card among them, and brings the cluster
// back as the server has it: `from`, an update taken with snapshot(), or
// nothing, for a cluster without this doc. doc-reset.spec drives it.
const RELOAD = new URLSearchParams(window.location.search).get('reload') === '1';

// ?docqa=1&uploads=1 gives the doc a workspace and a host cluster, and puts a
// stand-in for R2 behind its image uploads: each upload is recorded and then
// waits until a spec calls progress(p), finish() or fail(message) on
// window.__soleilDocTest.uploads. Made once, here, so StrictMode's double
// render can't install one stand-in and publish another.
const UPLOADS = new URLSearchParams(window.location.search).get('uploads') === '1';
// ?docqa=1&cluster=Feature%20film: the doc sits on a cluster with that name, as
// a doc card on a canvas does (the doc look's header shows it, Cluster › Title).
const CLUSTER = new URLSearchParams(window.location.search).get('cluster');
// ?docqa=1&room=1 puts the doc's cluster on a live room (docQaRoom.js) that
// answers the save line's questions as the board room does; a spec drives it
// through window.__soleilDocTest.room, ends access with endAccess(), and says
// whether this device's draft took with draftTook() (yboard.js marks the doc).
// One per doc, made on first sight, so StrictMode's double render can't make
// a second. docs-status.spec walks the save line with it.
const ROOM = new URLSearchParams(window.location.search).get('room') === '1';
const qaRooms = new WeakMap();
function qaRoomFor(ydoc) {
  let r = qaRooms.get(ydoc);
  if (!r) {
    r = createQaRoom(ydoc);
    qaRooms.set(ydoc, r);
    ydoc._soleilRoom = r.room;
    r.controls.live();
  }
  return r;
}
const uploadStub = UPLOADS ? (() => {
  const calls = [];
  let pending = null;
  setDocImageUploader(({ onProgress, workspaceId, userId, boardId, cardId, originalName }) => {
    calls.push({ workspaceId, userId, boardId, cardId, originalName });
    return new Promise((resolve, reject) => { pending = { onProgress, resolve, reject }; });
  });
  const settle = () => { const p = pending; pending = null; return p; };
  return {
    calls,
    progress: (p) => pending?.onProgress?.(p),
    finish: (src = '/src/local/qa-photos/street.jpg') => settle()?.resolve({ src, publicUrl: src }),
    fail: (message = 'The upload failed.') => settle()?.reject(new Error(message)),
  };
})() : null;

const STUB_USER = { id: 'docqa-user', name: 'QA Tester', email: 'qa@soleilpictures.com', color: '#d98c2b' };

// Build the in-memory Y.Doc + a doc-card YMap once. Returns everything the
// harness + bridge need. Pure (no React) so StrictMode's double-invoke of the
// useState initializer is harmless — only the surviving instance is used.
function createDocStore() {
  const ydoc = new Y.Doc();
  const cardsMap = ydoc.getMap('cards');
  const cardYMap = new Y.Map();
  ydoc.transact(() => {
    cardYMap.set('id', CARD_ID);
    cardYMap.set('kind', 'doc');
    cardsMap.set(CARD_ID, cardYMap);
  }, 'local');
  docState.initCardDocStore(ydoc, cardYMap);
  const scope = { ...docState.cardScope(cardYMap), cardId: CARD_ID, docCardId: CARD_ID };
  // A reader never seeds the first page (it would exist only in their tab),
  // so the viewer harness arrives with one already there, as a real doc does.
  if (new URLSearchParams(window.location.search).get('viewer') === '1') {
    docState.addPage(ydoc, { name: 'Page one', scope });
  }
  return { ydoc, cardYMap, scope };
}

// The cluster as the server has it after a reload: `update` applied to a
// fresh Y.Doc, and the doc's card if the cluster holds one.
function storeFrom(update) {
  const ydoc = new Y.Doc();
  if (update) Y.applyUpdate(ydoc, update);
  const cardYMap = ydoc.getMap('cards').get(CARD_ID) || null;
  if (!cardYMap) return { ydoc, cardYMap: null, scope: null };
  docState.initCardDocStore(ydoc, cardYMap);
  return { ydoc, cardYMap, scope: { ...docState.cardScope(cardYMap), cardId: CARD_ID, docCardId: CARD_ID } };
}

// ?docqa=1&panes=1: two docs side by side, docked and beside (DocPanesQa).
const PANES = new URLSearchParams(window.location.search).get('panes') === '1';

export function DocQaHarness() {
  return PANES ? <DocPanesQa /> : <OneDocQa />;
}

function OneDocQa() {
  // Create the store exactly once for this instance. A reload (RELOAD) swaps
  // it for the cluster as it comes back, and `generation` makes the card a
  // new one then, as the canvas's would be.
  const [store, setStore] = useState(createDocStore);
  const { ydoc, cardYMap, scope } = store;
  const [generation, setGeneration] = useState(0);
  // ?docqa=1&presence=1 gives the card a real Awareness so DocPresence mounts;
  // specs add simulated peers through the bridge's setPeer().
  const [awareness] = useState(() => (
    new URLSearchParams(window.location.search).get('presence') === '1' || ROOM
      ? new awarenessProtocol.Awareness(ydoc) : null));
  // The room attaches with the awareness, as in the app (lib/yPartyKit.js).
  const qaRoom = ROOM ? qaRoomFor(ydoc) : null;
  // Card title lives in React state so onUpdate flows (exercises the
  // card-title → primary-page-title sync) and the preview re-renders.
  const [title, setTitle] = useState('');
  // ?docqa=1&public=1 mounts the card as the anonymous /share viewer would see
  // it, so specs can assert the collaboration surfaces (comments, the Messages
  // button) are correctly suppressed there.
  const isPublicView = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('public') === '1';
  // ?docqa=1&viewer=1 mounts it as a signed-in VIEW-ONLY member: not public,
  // but canEdit false — the case whose writes the board room drops.
  const isViewer = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('viewer') === '1';
  // Stub messages state for the doc-header button (see MessagesUiContext below).
  // A non-zero unread count so the badge dot renders and can be asserted.
  const [messagesOpen, setMessagesOpen] = useState(false);
  const messagesUnread = 3;
  const card = { id: CARD_ID, kind: 'doc', title, x: 0, y: 0, w: 320, h: 240 };
  // The cluster as useYBoard hands it on: loading while a reload runs, then
  // back with the doc's card or without it — when the workspace says so.
  useOrphanedDocResets({ ready: RELOAD && !store.loading, boardId: HOST_BOARD, cards: cardYMap ? [card] : [] });

  // Publish the test bridge. Set it idempotently on every effect run and do
  // NOT delete it on cleanup — under StrictMode the dev double-invoke
  // (setup → cleanup → setup) would otherwise leave the bridge deleted.
  useEffect(() => {
    window.__soleilDocTest = {
      ...docState,
      ...(window.__soleilDocTest || {}), // preserve `editor` set by DocSurface
      docExport,
      screenplay: { ...screenplayFlow, ...screenplayIO, ...screenplayPaginate, ...screenplayPrint, ...screenplayPdf },
      encodeAnchor,
      resolveAnchor,
      Y,
      ydoc,
      cardYMap,
      getScope: () => scope,
      awareness,
      uploads: uploadStub,
      room: qaRoom?.controls || null,
      endAccess: () => window.dispatchEvent(new CustomEvent('soleil-board-access-ended', {
        detail: { boardId: HOST_BOARD, code: 4401 },
      })),
      draftTook: (ok) => { ydoc._soleilKept = !!ok; },
      // Publish a simulated peer's awareness state (null removes it). Each
      // name gets its own Y.Doc, so its own clientID, like another tab.
      setPeer: (name, state) => {
        if (!awareness) return;
        const peers = window.__soleilDocPeers || (window.__soleilDocPeers = new Map());
        let peer = peers.get(name);
        if (!peer) {
          peer = new awarenessProtocol.Awareness(new Y.Doc());
          peers.set(name, peer);
        }
        peer.setLocalState(state);
        awarenessProtocol.applyAwarenessUpdate(
          awareness, awarenessProtocol.encodeAwarenessUpdate(peer, [peer.clientID]), 'docqa');
      },
      // Make the open doc throw as a real render crash would (DocSurface's
      // DEV-only hook): on its next render, or on every mount while `always`
      // holds; { stop: true } ends that. For doc-crash.spec.
      crash: (always = false, { stop = false } = {}) => {
        window.__soleilDocCrashAlways = !!always && !stop;
        if (!stop) document.dispatchEvent(new CustomEvent('soleil-docqa-crash'));
      },
      // Open the live card via the real event path RichDocCard listens for.
      openCard: (pageId = null) =>
        document.dispatchEvent(new CustomEvent('soleil-open-doc-card', {
          detail: { cardId: CARD_ID, pageId, scrollTop: 0 },
        })),
      ...(RELOAD ? {
        snapshot: () => Y.encodeStateAsUpdate(ydoc),
        // `local`: this tab started it (Version history, a move it made).
        // `boardId`: another cluster's reload, which this doc must ignore.
        // Resolves once the cluster is back, true if it has the doc.
        reload: ({ reason = 'restore', from = null, local = false, delay = 600, boardId = HOST_BOARD } = {}) =>
          new Promise((resolve) => {
            if (local) markLocalReset(boardId);
            announceBoardReload(boardId, reason);
            if (boardId !== HOST_BOARD) { resolve(true); return; }
            setTimeout(() => {
              setStore((s) => ({ ...s, cardYMap: null, loading: true }));
              setTimeout(() => {
                const next = storeFrom(from);
                setStore(next);
                setGeneration((g) => g + 1);
                resolve(!!next.cardYMap);
              }, 80);
            }, delay);
          }),
      } : {}),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ydoc, cardYMap, scope, awareness, qaRoom]);

  // The doc header's Messages button reads MessagesUiContext, which normally
  // comes from App. Provide a stub so the button (and its unread badge) is
  // exercised here instead of silently rendering null — `open` is echoed back
  // into the panel-open flag so a spec can assert the toggle actually fires.
  const messagesUi = {
    unread: messagesUnread,
    open: messagesOpen,
    toggle: () => setMessagesOpen((v) => !v),
  };

  return (
    <MessagesUiContext.Provider value={messagesUi}>
    <div className="docqa-root" data-testid="docqa-root"
         style={{ minHeight: '100vh', padding: 24, background: 'var(--bg-1, #111)', color: 'var(--ink-1, #ddd)' }}>
      <header style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <strong style={{ font: '700 13px var(--font-display, sans-serif)', letterSpacing: '.08em', textTransform: 'uppercase' }}>
          Doc QA Harness
        </strong>
        <span style={{ fontSize: 12, opacity: .6 }}>in-memory Y.Doc · no backend</span>
      </header>
      {/* A canvas-card-sized wrapper so .doc-card preview lays out sanely and
          is double-clickable. The real overlay portals to document.body. */}
      <div className="docqa-card-wrap" style={{ position: 'relative', width: 320, height: 240 }}>
        {cardYMap && (
          <RichDocCard
            key={generation}
            card={card}
            ydoc={ydoc}
            cardYMap={cardYMap}
            workspaceId={UPLOADS ? 'docqa-workspace' : null}
            hostBoardId={UPLOADS || RELOAD || CLUSTER || ROOM ? HOST_BOARD : null}
            userId={STUB_USER.id}
            currentUser={STUB_USER}
            getAwareness={() => awareness}
            boards={CLUSTER ? { [HOST_BOARD]: { id: HOST_BOARD, name: CLUSTER } } : {}}
            wsPeers={[]}
            onJumpToPeer={() => {}}
            canEdit={!isPublicView && !isViewer}
            isPublic={isPublicView}
            autoFocus={false}
            onUpdate={(patch) => { if (patch && 'title' in patch) setTitle(patch.title || ''); }}
          />
        )}
      </div>
    </div>
    </MessagesUiContext.Provider>
  );
}
