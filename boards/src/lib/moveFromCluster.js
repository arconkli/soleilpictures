// Move cards OUT of a cluster that isn't open, into the board you're on —
// "Move here" for the notes, docs and grids dragged in from another cluster in
// Files beside the board (lib/filesDrag.js: those can't be copied, their content
// lives in live Yjs structures).
//
// The cross-board move in App.jsx goes the other way (the open board is the
// source, a closed one the target); this is its mirror, and keeps its rules:
//
//   • The arrival happens first, on the live board, through addCards. Only the
//     cards that actually landed are then removed from the source — so a
//     failure part-way leaves a duplicate, never a loss.
//   • The source is changed through its saved snapshot: a pre-move version is
//     saved for recovery, the cards are deleted, the snapshot is written, and
//     its PartyKit room is reset so a warm room can't re-merge stale state over
//     the write (see the long comment in App.jsx's cross-board move).
//   • Undo puts the cards back on the source with their original ids and
//     places, carrying whatever was edited since, then removes them here.

import * as Y from 'yjs';
import { loadBoardSnapshot, saveBoardSnapshot, forceResetBoardRoom, saveBoardVersion } from './boardsApi.js';
import { b64ToBytes, cardToYMap, yMapToCard } from './yhelpers.js';
import { boardDoc } from './yboard.js';
import { supabase } from './supabase.js';

const PLACE_KEYS = ['x', 'y', 'w', 'h', 'z', 'groupId'];

function arrowEnds(a) {
  return [
    typeof a?.from === 'string' ? a.from : a?.from?.cardId,
    typeof a?.to === 'string' ? a.to : a?.to?.cardId,
  ];
}

function emitReset(boardId) {
  try { window.__soleilEmitBoardReset?.(boardId); } catch (_) {}
}

export async function repointComments(fromBoardId, toBoardId, idMap) {
  const anchors = Object.keys(idMap);
  if (!anchors.length || !supabase) return;
  try {
    const { data } = await supabase.from('comments').select('id, anchor_id')
      .eq('board_id', fromBoardId).is('deleted_at', null)
      .eq('anchor_kind', 'card').in('anchor_id', anchors);
    for (const row of data || []) {
      const next = idMap[row.anchor_id];
      if (next) await supabase.from('comments').update({ board_id: toBoardId, anchor_id: next }).eq('id', row.id);
    }
  } catch (err) { console.warn('[move-from-cluster] comment repoint failed', err); }
}

// Load the source and hand back its cards (live Yjs values included — the
// caller's addCards deep-copies them via cardToYMap). Returns null when the
// source can't be read; nothing has changed at that point.
export async function openClusterForMove(sourceBoardId, ids, { userId = null, sessionId = null } = {}) {
  const snap = await loadBoardSnapshot(sourceBoardId);
  if (!snap) return null;
  const doc = boardDoc(sourceBoardId);
  Y.applyUpdate(doc, b64ToBytes(snap));
  const cm = doc.getMap('cards');
  const cards = (ids || []).map((id) => {
    const ym = cm.get(id);
    return ym ? { ...yMapToCard(ym), id } : null;
  }).filter(Boolean);
  const originals = new Map(cards.map((c) => [c.id, Object.fromEntries(PLACE_KEYS.map((k) => [k, c[k]]))]));

  return {
    cards,
    // Remove what landed (old id → new id) from the source and save it.
    async commit(idMap) {
      const gone = new Set(Object.keys(idMap || {}));
      if (!gone.size) return;
      try {
        await saveBoardVersion(sourceBoardId, doc, {
          triggerKind: 'pre-drop', userId, sessionId, label: 'pre-move-out',
          opSummary: { action: 'move-out-of-cluster', card_count: gone.size },
        });
      } catch (_) {}
      doc.transact(() => {
        gone.forEach((id) => { if (cm.has(id)) cm.delete(id); });
        const ar = doc.getArray('arrows');
        for (let i = ar.length - 1; i >= 0; i--) {
          const [a, b] = arrowEnds(ar.get(i));
          if (gone.has(a) || gone.has(b)) ar.delete(i, 1);
        }
      }, 'cross-board-move');
      await saveBoardSnapshot(sourceBoardId, doc);
      await forceResetBoardRoom(sourceBoardId);
      emitReset(sourceBoardId);
    },
    originals,
    close() { try { doc.destroy(); } catch (_) {} },
  };
}

// Undo: put cards back on the source under their original ids and places.
// `entries` is [{ id (original), card (current content, from the live board) }].
export async function returnToCluster(sourceBoardId, entries, originals) {
  const snap = await loadBoardSnapshot(sourceBoardId);
  if (!snap) throw new Error('source cluster state unavailable');
  const doc = boardDoc(sourceBoardId);
  try {
    Y.applyUpdate(doc, b64ToBytes(snap));
    const cm = doc.getMap('cards');
    doc.transact(() => {
      for (const { id, card } of entries || []) {
        if (!id || !card || cm.has(id)) continue;
        const place = originals?.get?.(id) || {};
        const back = { ...card, id };
        for (const k of PLACE_KEYS) { if (place[k] !== undefined) back[k] = place[k]; else delete back[k]; }
        cm.set(id, cardToYMap(back));
      }
    }, 'cross-board-move');
    await saveBoardSnapshot(sourceBoardId, doc);
  } finally {
    try { doc.destroy(); } catch (_) {}
  }
  await forceResetBoardRoom(sourceBoardId);
  emitReset(sourceBoardId);
}

