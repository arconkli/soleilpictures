// snapshotPreview.js
//
// Decode a board snapshot's base64 Y.Doc bytes into a lightweight summary
// the TimeTravelModal can render in its preview pane without spinning up
// the full canvas. We deliberately do NOT instantiate Tiptap, signed R2
// URLs, or any heavy renderers — the preview is fast, scrolly, and shows
// "what cards existed and what was their content" so the user can decide
// whether to restore.

import * as Y from 'yjs';
import { supabase } from './supabase.js';
import { b64ToBytes } from './yhelpers.js';

const KIND_ICONS = {
  note: '📝',
  image: '🖼',
  audio: '🎙',
  video: '🎬',
  link: '🔗',
  palette: '🎨',
  doc: '📄',
  schedule: '📅',
  shape: '◇',
  board: '📁',
  boardlink: '🔗',
  list: '☑',
};

function decodeYDocFromB64(b64) {
  const ydoc = new Y.Doc();
  try { Y.applyUpdate(ydoc, b64ToBytes(b64), 'snapshot-preview'); }
  catch (_) { /* fall through with empty doc */ }
  return ydoc;
}

function htmlStrip(s) {
  if (!s || typeof s !== 'string') return '';
  return s.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

function cardTitle(card) {
  if (!card) return '';
  if (typeof card.title === 'string' && card.title) return card.title;
  if (typeof card.name === 'string' && card.name) return card.name;
  if (typeof card.body === 'string' && card.body) {
    const t = htmlStrip(card.body);
    return t.length > 80 ? t.slice(0, 80) + '…' : t;
  }
  if (typeof card.text === 'string' && card.text) {
    return card.text.length > 80 ? card.text.slice(0, 80) + '…' : card.text;
  }
  if (typeof card.alt === 'string' && card.alt) return card.alt;
  if (typeof card.url === 'string' && card.url) return card.url;
  return null;
}

function cardBodyPreview(card) {
  if (!card) return '';
  if (typeof card.body === 'string' && card.body) return htmlStrip(card.body).slice(0, 200);
  if (typeof card.text === 'string' && card.text) return card.text.slice(0, 200);
  return '';
}

// Given a snapshot row's doc_b64, return:
//   { cards: [{id, kind, title, body, x, y, hasR2}], groups, cardCount }
export function buildSnapshotPreview(b64) {
  if (!b64) return { cards: [], groups: [], cardCount: 0, error: 'empty snapshot' };
  const ydoc = decodeYDocFromB64(b64);
  try {
    const cards = [];
    const cardsMap = ydoc.getMap('cards');
    cardsMap.forEach((ym, id) => {
      const card = ym.toJSON ? ym.toJSON() : {};
      const kind = card.kind || 'unknown';
      cards.push({
        id,
        kind,
        title: cardTitle(card),
        body: cardBodyPreview(card),
        x: typeof card.x === 'number' ? card.x : null,
        y: typeof card.y === 'number' ? card.y : null,
        z: typeof card.z === 'number' ? card.z : null,
        hasR2: typeof (card.url || card.src || card.audioUrl || card.videoUrl) === 'string'
          && /^r2:/.test(card.url || card.src || card.audioUrl || card.videoUrl || ''),
      });
    });
    const groups = [];
    const groupsMap = ydoc.getMap('groups');
    groupsMap.forEach((ym, id) => {
      const g = ym.toJSON ? ym.toJSON() : {};
      groups.push({ id, name: g.name || '', color: g.color || null });
    });
    return { cards, groups, cardCount: cards.length };
  } finally {
    ydoc.destroy();
  }
}

// Resolve the doc_b64 for a given board_snapshots row. Currently only
// supports storage='postgres' snapshots; storage='r2' will require a signed
// fetch flow that we'll wire up later.
export async function fetchSnapshotBytes(snapshotId) {
  const { data, error } = await supabase
    .from('board_snapshots')
    .select('id, storage, doc_b64, r2_key')
    .eq('id', snapshotId)
    .single();
  if (error) throw error;
  if (!data) throw new Error('snapshot not found');
  if (data.storage === 'postgres') return data.doc_b64 || null;
  if (data.storage === 'r2') {
    // TODO: fetch via signed URL once the cold-tier read path is built.
    throw new Error('snapshot stored in R2; fetch not yet wired');
  }
  throw new Error('unknown snapshot storage: ' + data.storage);
}

// Cherry-pick: copy specific cards from a target snapshot into the live
// Y.Doc. Same-id cards in current state are overwritten; others are
// untouched. Runs as one Y.Doc transaction so the change appears as a
// single undoable operation on the user's undo stack AND flows to peers
// via the normal y-partykit update channel.
//
// Returns { addedCardIds, overwroteCardIds, skippedCardIds }
export function cherryPickCardsFromSnapshot(currentYDoc, targetB64, cardIds) {
  if (!currentYDoc || !targetB64 || !Array.isArray(cardIds) || cardIds.length === 0) {
    return { addedCardIds: [], overwroteCardIds: [], skippedCardIds: cardIds || [] };
  }
  const target = new Y.Doc();
  try { Y.applyUpdate(target, b64ToBytes(targetB64), 'snapshot-cherry-pick'); }
  catch (e) {
    target.destroy();
    throw new Error('could not decode target snapshot: ' + (e?.message || e));
  }

  const added = [];
  const overwrote = [];
  const skipped = [];

  try {
    const liveCards = currentYDoc.getMap('cards');
    const targetCards = target.getMap('cards');
    const targetGroups = target.getMap('groups');
    const liveGroups = currentYDoc.getMap('groups');

    currentYDoc.transact(() => {
      for (const cardId of cardIds) {
        const targetCard = targetCards.get(cardId);
        if (!targetCard) { skipped.push(cardId); continue; }
        const targetData = targetCard.toJSON ? targetCard.toJSON() : null;
        if (!targetData) { skipped.push(cardId); continue; }
        const existing = liveCards.get(cardId);
        const ym = new Y.Map();
        for (const [k, v] of Object.entries(targetData)) ym.set(k, v);
        liveCards.set(cardId, ym);
        if (existing) overwrote.push(cardId);
        else added.push(cardId);

        // Bring along the card's group if not present locally — preserves
        // cluster name/color when cherry-picking a clustered card.
        const groupId = targetData.group_id;
        if (groupId && targetGroups.has(groupId) && !liveGroups.has(groupId)) {
          const targetGroup = targetGroups.get(groupId);
          if (targetGroup && targetGroup.toJSON) {
            const gymap = new Y.Map();
            for (const [k, v] of Object.entries(targetGroup.toJSON())) gymap.set(k, v);
            liveGroups.set(groupId, gymap);
          }
        }
      }
    }, 'local');
  } finally {
    target.destroy();
  }

  return { addedCardIds: added, overwroteCardIds: overwrote, skippedCardIds: skipped };
}

export const SNAPSHOT_KIND_LABELS = {
  'auto-5min': 'auto',
  'auto-hourly': 'auto',
  'auto-daily': 'auto',
  'pre-restore': 'pre-restore',
  'post-restore': 'restored',
  'manual': 'manual',
};

export function kindLabel(kind) {
  if (!kind) return 'snapshot';
  if (SNAPSHOT_KIND_LABELS[kind]) return SNAPSHOT_KIND_LABELS[kind];
  if (kind.startsWith('legacy-')) return 'legacy';
  return kind;
}

export function kindBadgeClass(kind) {
  if (!kind) return 'tt-badge';
  if (kind === 'pre-restore') return 'tt-badge tt-badge-pre';
  if (kind === 'post-restore') return 'tt-badge tt-badge-post';
  if (kind === 'manual') return 'tt-badge tt-badge-manual';
  if (kind.startsWith('legacy-')) return 'tt-badge tt-badge-legacy';
  return 'tt-badge tt-badge-auto';
}

export { KIND_ICONS };
