// Shared fixture for the public /share viewer specs. Builds Y.Doc snapshots
// shaped exactly like the party's /share-bundle response and installs the
// route interceptions (share-bundle + analytics sink) so the specs run with
// no PartyKit and no Supabase.
//
// The fixture link has include_subboards=true with one navigable sub-board,
// so specs can exercise breadcrumb navigation, the nav progress shimmer and
// the SharePrompt "subboard" trigger.

import * as Y from 'yjs';

export const TOKEN   = '11111111-2222-3333-4444-555555555555';
export const ROOT_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
export const SUB_ID  = 'aaaaaaaa-0000-0000-0000-000000000002';

function snapshotB64(cards) {
  const doc = new Y.Doc();
  const map = doc.getMap('cards');
  for (const [id, card] of Object.entries(cards)) {
    const m = new Y.Map();
    for (const [k, v] of Object.entries(card)) m.set(k, v);
    map.set(id, m);
  }
  return Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');
}

// A board id NOT present in nav_boards — simulates a deleted sub-board or a
// link created without include_subboards. The public viewer must HIDE cards
// targeting it (no "Missing board" / "No access" tiles on marketing boards).
export const UNREACHABLE_ID = 'dddddddd-0000-0000-0000-00000000dead';

export function makeBundles() {
  const rootSnapshot = snapshotB64({
    'card-note-1': { kind: 'note', body: 'Welcome to the shared board', x: 120, y: 120, w: 240, h: 140 },
    // Board cards key the cards map by the target board's id (readCards
    // anchors card.id to the map key; CanvasSurface opens via onOpenBoard(c.id)).
    [SUB_ID]: { kind: 'board', x: 460, y: 120, w: 240, h: 160 },
    // Unreachable targets — must be filtered out of the public render.
    [UNREACHABLE_ID]: { kind: 'board', x: 460, y: 320, w: 240, h: 160 },
    'card-deadlink-1': { kind: 'boardlink', target: UNREACHABLE_ID, x: 120, y: 320, w: 240, h: 100 },
  });
  const subSnapshot = snapshotB64({
    'card-note-2': { kind: 'note', body: 'Inside the sub-board', x: 120, y: 120, w: 240, h: 140 },
  });
  const base = {
    image_urls: {},
    image_meta: {},
    role: 'viewer',
    root_id: ROOT_ID,
    include_subboards: true,
    nav_boards: [
      { id: ROOT_ID, name: 'Marketing Root' },
      { id: SUB_ID, name: 'Inside Board' },
    ],
  };
  return {
    [ROOT_ID]: { ...base, board: { id: ROOT_ID, name: 'Marketing Root', bg_color: null }, snapshot: rootSnapshot },
    [SUB_ID]:  { ...base, board: { id: SUB_ID, name: 'Inside Board', bg_color: null }, snapshot: subSnapshot },
  };
}

// Intercept the party share-bundle route. opts.subDelayMs delays sub-board
// responses (makes the nav progress shimmer observable); opts.fail404 fails
// every bundle request (drives the invalid-link page).
export async function routeShareBundle(page, { subDelayMs = 0, fail404 = false } = {}) {
  const bundles = makeBundles();
  await page.route('**/parties/upload/share/share-bundle', async (route) => {
    if (fail404) return route.fulfill({ status: 404, body: 'not found' });
    let boardId = null;
    try { boardId = route.request().postDataJSON()?.boardId || null; } catch (_) {}
    if (boardId && subDelayMs) await new Promise((r) => setTimeout(r, subDelayMs));
    const bundle = bundles[boardId || ROOT_ID];
    if (!bundle) return route.fulfill({ status: 404, body: 'out of subtree' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bundle) });
  });
}

// Swallow analytics inserts (both the batched supabase-js array insert and
// the keepalive beacon hit the same REST path) and collect the posted rows.
export async function routeAnalytics(page, rows) {
  await page.route('**/rest/v1/analytics_events**', async (route) => {
    try {
      const data = route.request().postDataJSON();
      if (Array.isArray(data)) rows.push(...data);
      else if (data) rows.push(data);
    } catch (_) {}
    return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
  });
}
