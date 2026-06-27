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
import * as docState from '../lib/docState.js';
import * as docExport from '../lib/docFullExport.js';
import * as screenplayFlow from '../components/docExtensions/screenplay/screenplayFlow.js';
import * as screenplayIO from '../lib/screenplayIO.js';
import * as screenplayPaginate from '../lib/screenplayPaginate.js';
import * as screenplayPrint from '../lib/screenplayPrint.js';
import * as screenplayPdf from '../lib/screenplayPdf.js';
import { encodeAnchor, resolveAnchor } from '../lib/bookmarkRelPos.js';
import { RichDocCard } from '../components/DocCard.jsx';

const CARD_ID = 'docqa-card';

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
  return { ydoc, cardYMap, scope };
}

export function DocQaHarness() {
  // Create the store exactly once for this instance.
  const [{ ydoc, cardYMap, scope }] = useState(createDocStore);
  // Card title lives in React state so onUpdate flows (exercises the
  // card-title → primary-page-title sync) and the preview re-renders.
  const [title, setTitle] = useState('');
  const card = { id: CARD_ID, kind: 'doc', title, x: 0, y: 0, w: 320, h: 240 };

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
      // Open the live card via the real event path RichDocCard listens for.
      openCard: (pageId = null) =>
        document.dispatchEvent(new CustomEvent('soleil-open-doc-card', {
          detail: { cardId: CARD_ID, pageId, scrollTop: 0 },
        })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ydoc, cardYMap, scope]);

  return (
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
        <RichDocCard
          card={card}
          ydoc={ydoc}
          cardYMap={cardYMap}
          workspaceId={null}
          userId={STUB_USER.id}
          currentUser={STUB_USER}
          getAwareness={() => null}
          boards={{}}
          wsPeers={[]}
          onJumpToPeer={() => {}}
          canEdit
          autoFocus={false}
          onUpdate={(patch) => { if (patch && 'title' in patch) setTitle(patch.title || ''); }}
        />
      </div>
    </div>
  );
}
