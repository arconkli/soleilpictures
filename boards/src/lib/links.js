import * as Y from 'yjs';

// Y.Doc surface for cross-entity Links inside a doc card.
//
// Storage shape:
//   ydoc.getMap('links') :: Y.Map<linkId, Y.Map>
//     each value Y.Map has { id, name?, createdAt, createdBy?, pageId,
//                            anchor:{from,to}, targets: Y.Array<target> }
//
// Targets are plain JS objects (not Y types) — they're small and fully
// replaced when edited.

export function linksMap(ydoc) { return ydoc.getMap('links'); }

export function listLinks(ydoc) {
  const m = linksMap(ydoc);
  const out = [];
  m.forEach((v) => out.push(yLinkToJSON(v)));
  return out;
}

export function getLink(ydoc, id) {
  const v = linksMap(ydoc).get(id);
  return v ? yLinkToJSON(v) : null;
}

export function addLink(ydoc, { id, name, pageId, anchor, targets, createdBy }) {
  const m = linksMap(ydoc);
  const v = new Y.Map();
  v.set('id', id);
  if (name) v.set('name', name);
  v.set('createdAt', Date.now());
  if (createdBy) v.set('createdBy', createdBy);
  v.set('pageId', pageId);
  v.set('anchor', { from: anchor.from, to: anchor.to });
  const arr = new Y.Array();
  arr.insert(0, targets);
  v.set('targets', arr);
  m.set(id, v);
}

export function updateLinkTargets(ydoc, id, targets) {
  const v = linksMap(ydoc).get(id);
  if (!v) return;
  const arr = v.get('targets');
  arr.delete(0, arr.length);
  arr.insert(0, targets);
}

export function renameLink(ydoc, id, name) {
  const v = linksMap(ydoc).get(id);
  if (v) v.set('name', name);
}

export function deleteLink(ydoc, id) {
  linksMap(ydoc).delete(id);
}

function yLinkToJSON(v) {
  const targets = v.get('targets');
  return {
    id: v.get('id'),
    name: v.get('name') || null,
    createdAt: v.get('createdAt'),
    createdBy: v.get('createdBy') || null,
    pageId: v.get('pageId'),
    anchor: v.get('anchor'),
    targets: targets ? targets.toArray() : [],
  };
}

// One-time migration from the legacy bookmarks Y.Map to links.
// Bookmarks have shape { id, name, pageId, anchor } where anchor is a single
// PM position. They become kind:'docPos' Links pointing at themselves.
export function migrateBookmarksToLinks(ydoc, { docCardId } = {}) {
  const bm = ydoc.getMap('bookmarks');
  if (bm.size === 0) return 0;
  let migrated = 0;
  ydoc.transact(() => {
    bm.forEach((v, id) => {
      if (linksMap(ydoc).has(id)) return; // already migrated
      // Bookmarks may be stored as Y.Map or plain object — handle both.
      const name   = v?.get?.('name')   ?? v?.name   ?? 'Bookmark';
      const pageId = v?.get?.('pageId') ?? v?.pageId;
      const anchor = v?.get?.('anchor') ?? v?.anchor;
      if (!pageId || anchor == null) return;
      addLink(ydoc, {
        id,
        name,
        pageId,
        anchor: { from: anchor, to: anchor },
        targets: [{ kind: 'docPos', docCardId, pageId, anchor }],
      });
      migrated++;
    });
    bm.clear();
  });
  return migrated;
}
