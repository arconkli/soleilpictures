// Dev-only collaborative-note QA harness (reached via ?noteqa=1 in a DEV build —
// see isNoteQaMode() in ../lib/localMode.js). Mounts the REAL collaborative note
// card (NoteCardCollab) TWICE — two Tiptap editors bound to two in-memory
// Y.Docs whose updates are piped to each other — so Playwright can drive genuine
// two-client co-typing, offline-merge, write-through, and seed behaviour without
// Supabase / PartyKit.
//
// window.__soleilNoteTest exposes the noteDocState namespace + Y + both ydocs +
// per-client html/fragment readers + a sync toggle for offline-merge tests.
//
// Dynamically imported only when the gate is on, so it never ships to prod.

import { useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } from 'y-protocols/awareness';
import * as noteDocState from '../lib/noteDocState.js';
import { getActiveNoteEditor } from '../lib/noteEditorRegistry.js';
import { NoteCardCollab } from '../components/cards.jsx';

const CARD_ID = 'noteqa-card';

// Force the collaborative-note gate on for this harness.
if (typeof window !== 'undefined') window.__NOTE_COLLAB = true;

// Build docA with the card + fragment, clone its state into docB so BOTH share
// the same logical `cards` map / card / fragment (creating the card on each doc
// independently would conflict on the shared key). Then wire bidirectional
// update piping with origin guards so it can be toggled for offline tests.
function createTwoClientStore(initialHtml) {
  const docA = new Y.Doc();
  const cardsA = docA.getMap('cards');
  const cardA = new Y.Map();
  docA.transact(() => {
    cardA.set('id', CARD_ID);
    cardA.set('kind', 'note');
    cardsA.set(CARD_ID, cardA);
  }, 'local');
  noteDocState.ensureNoteFragment(docA, cardA);
  if (initialHtml) noteDocState.seedNoteFragmentFromHtml(docA, cardA, initialHtml);

  const docB = new Y.Doc();
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA), 'init');
  const cardB = docB.getMap('cards').get(CARD_ID);

  const sync = { on: true };
  docA.on('update', (u, origin) => {
    if (origin === 'remote-b' || !sync.on) return;
    Y.applyUpdate(docB, u, 'remote-a');
  });
  docB.on('update', (u, origin) => {
    if (origin === 'remote-a' || !sync.on) return;
    Y.applyUpdate(docA, u, 'remote-b');
  });
  // On reconnect, exchange full state both ways so divergent offline edits merge.
  sync.resync = () => {
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA), 'remote-a');
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB), 'remote-b');
  };

  // Two awareness instances (one per client), piped, so NotePresence has a real
  // peer channel for caret/selection broadcast.
  const awA = new Awareness(docA);
  awA.setLocalStateField('user', { id: 'user-A', name: 'Alice', color: '#d98c2b' });
  const awB = new Awareness(docB);
  awB.setLocalStateField('user', { id: 'user-B', name: 'Bob', color: '#3b82f6' });
  awA.on('update', ({ added, updated, removed }, origin) => {
    if (origin === 'remote' || !sync.on) return;
    applyAwarenessUpdate(awB, encodeAwarenessUpdate(awA, added.concat(updated, removed)), 'remote');
  });
  awB.on('update', ({ added, updated, removed }, origin) => {
    if (origin === 'remote' || !sync.on) return;
    applyAwarenessUpdate(awA, encodeAwarenessUpdate(awB, added.concat(updated, removed)), 'remote');
  });

  return { docA, cardA, docB, cardB, sync, awA, awB };
}

function ClientCard({ label, ydoc, cardYMap, awareness }) {
  const [card, setCard] = useState(() => ({
    html: noteDocState.noteFragmentToHtml(noteDocState.getNoteFragment(cardYMap)) || '',
    h: 120,
    manuallyResized: false,
  }));
  const onUpdate = (patch) => setCard((c) => ({ ...c, ...patch }));
  // Mirror the real app: the write-through sets html/h on the card map under
  // NOTE_ORIGIN; pick them up via a Y.Map observer (this is what readCards does
  // on the canvas).
  useEffect(() => {
    const update = () => setCard((c) => ({
      ...c,
      html: cardYMap.get('html') ?? c.html,
      h: cardYMap.get('h') ?? c.h,
    }));
    cardYMap.observe(update);
    return () => cardYMap.unobserve(update);
  }, [cardYMap]);
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ font: '11px monospace', opacity: 0.6, marginBottom: 6 }}>{label}</div>
      <div
        data-client={label}
        style={{ position: 'relative', width: 320, height: Math.max(80, card.h || 120), border: '1px solid #333' }}
      >
        <NoteCardCollab
          html={card.html}
          bgColor={null}
          textColor={null}
          fontFamily={card.fontFamily}
          fontSize={card.fontSize}
          manuallyResized={!!card.manuallyResized}
          onUpdate={onUpdate}
          onEditingChange={() => {}}
          ydoc={ydoc}
          cardYMap={cardYMap}
          cardId="noteqa-card"
          boardId="noteqa-board"
          awareness={awareness}
        />
      </div>
    </div>
  );
}

export function NoteQaHarness() {
  const [{ docA, cardA, docB, cardB, sync, awA, awB }] = useState(() => createTwoClientStore(''));

  useEffect(() => {
    const fragHtml = (cardYMap) =>
      noteDocState.noteFragmentToHtml(noteDocState.getNoteFragment(cardYMap));
    window.__soleilNoteTest = {
      ...noteDocState,
      Y,
      docA, cardA, docB, cardB,
      // Fragment-derived html (the true CRDT content) per client.
      getFragHtmlA: () => fragHtml(cardA),
      getFragHtmlB: () => fragHtml(cardB),
      // Plain-text projection per client (card_index path).
      getTextA: () => noteDocState.noteFragmentToText(noteDocState.getNoteFragment(cardA)),
      getTextB: () => noteDocState.noteFragmentToText(noteDocState.getNoteFragment(cardB)),
      setSync: (on) => { sync.on = on; if (on) sync.resync(); },
      getActiveEditor: () => getActiveNoteEditor(),
      // Awareness inspectors for presence tests.
      getLocalCaretA: () => awA.getLocalState()?.noteCaret || null,
      getLocalCaretB: () => awB.getLocalState()?.noteCaret || null,
      // What client B's awareness sees as A's caret (proves the broadcast piped).
      getPeerCaretSeenByB: () => {
        let found = null;
        awB.getStates().forEach((s) => { if (s?.user?.id === 'user-A' && s.noteCaret) found = s.noteCaret; });
        return found;
      },
      ready: true,
    };
    const el = document.getElementById('noteqa-ready');
    if (el) el.textContent = 'noteqa ready';
    return undefined;
  }, [docA, cardA, docB, cardB, sync, awA, awB]);

  return (
    <div style={{ padding: 24, color: '#eee', background: '#0a0a0c', minHeight: '100vh' }}>
      <h3 style={{ font: '13px monospace' }}>noteqa — two-client co-typing harness</h3>
      <div id="noteqa-ready" style={{ font: '11px monospace', opacity: 0.5 }} />
      <div style={{ display: 'flex', gap: 32, marginTop: 16 }}>
        <ClientCard label="A" ydoc={docA} cardYMap={cardA} awareness={awA} />
        <ClientCard label="B" ydoc={docB} cardYMap={cardB} awareness={awB} />
      </div>
    </div>
  );
}
