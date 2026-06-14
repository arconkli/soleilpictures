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

function snapshotB64(cards, strokes = []) {
  const doc = new Y.Doc();
  const map = doc.getMap('cards');
  for (const [id, card] of Object.entries(cards)) {
    const m = new Y.Map();
    for (const [k, v] of Object.entries(card)) m.set(k, v);
    map.set(id, m);
  }
  if (strokes.length) doc.getArray('strokes').push(strokes);
  return Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');
}

// A grid of small freehand scribbles spread over a wide extent — drives the
// stroke viewport-culling spec (far-off strokes must not render at deep
// zoom; everything renders at fit-all).
function gridStrokes(n) {
  return Array.from({ length: n }, (_, i) => {
    const ox = (i % 12) * 600 + 80;
    const oy = Math.floor(i / 12) * 600 + 80;
    const points = Array.from({ length: 8 }, (_, j) => [ox + j * 12, oy + (j % 2) * 18]);
    return { points, color: '#f59e0b', width: 3 };
  });
}

// A board id NOT present in nav_boards — simulates a deleted sub-board or a
// link created without include_subboards. The public viewer must HIDE cards
// targeting it (no "Missing board" / "No access" tiles on marketing boards).
export const UNREACHABLE_ID = 'dddddddd-0000-0000-0000-00000000dead';

// A rich doc card built with the REAL docState shapes (lib/docState.js):
// pages are plain objects in a Y.Array; docPageContent maps pageId →
// Y.XmlFragment. Yjs buffers content set on detached (prelim) types, so the
// whole structure can be assembled before snapshotB64 integrates it.
function docCardEntry() {
  const pages = new Y.Array();
  pages.push([{ id: 'p1', name: 'Brief', parent_id: null, order: 0, expanded: true }]);
  const content = new Y.Map();
  const frag = new Y.XmlFragment();
  const para = new Y.XmlElement('paragraph');
  para.insert(0, [new Y.XmlText('Hello from the public doc')]);
  frag.insert(0, [para]);
  content.set('p1', frag);
  // One seeded thread so specs can assert the comment UI stays hidden on
  // public (the gutter only needs the map entry to exist).
  const comments = new Y.Map();
  comments.set('t1', { id: 't1', pageId: 'p1', text: 'hidden on public', resolved: false });
  return {
    kind: 'doc', title: 'Production brief',
    x: 120, y: 480, w: 260, h: 200,
    docPages: pages, docPageContent: content,
    docBookmarks: new Y.Map(), docComments: comments,
    docPageSheets: new Y.Map(), docSheetContent: new Y.Map(),
  };
}

// Image-card grid for the tier-selection specs: big (800px layout width) image
// cards spread over a wide extent, so the fit-all zoom is ~0.2 and the on-screen
// width (~160px) is FAR below the layout width. pickInitialTier must pick the
// 640w sm variant; the pre-fix behavior (sizes = layout width = 800px) picked
// the 1280w lg for every mount.
//
// Two sizes: IMAGE_COUNT (8, the basic tier spec) and DENSE_IMAGE_COUNT (24, a
// 6-wide grid for the bounded-storm spec — zooming into one corner leaves a
// ring of neighbors mounted-but-off-viewport, so the scheduler's viewport gate
// has something to filter).
export const IMAGE_COUNT = 8;
export const DENSE_IMAGE_COUNT = 24;
const imgKey = (i) => `ws1/img-${i}.png`;
const imgLgKey = (i) => `ws1/img-${i}.lg.webp`;
const imgSmKey = (i) => `ws1/img-${i}.sm.webp`;
function imageFixture(count = IMAGE_COUNT, cols = 4, dx = 1600, dy = 1400) {
  const cards = Object.fromEntries(Array.from({ length: count }, (_, i) => [
    `card-img-${i}`,
    { kind: 'image', src: `r2:${imgKey(i)}`, x: (i % cols) * dx + 100, y: Math.floor(i / cols) * dy + 100, w: 800, h: 600 },
  ]));
  const noteY = Math.ceil(count / cols) * dy + 200;
  cards['card-img-note'] = { kind: 'note', body: 'Image board ready', x: 100, y: noteY, w: 240, h: 140 };
  const urls = {};
  const meta = {};
  for (let i = 0; i < count; i++) {
    urls[imgKey(i)]   = `https://imgcdn.test/${i}-orig.png`;
    urls[imgLgKey(i)] = `https://imgcdn.test/${i}-lg.webp`;
    urls[imgSmKey(i)] = `https://imgcdn.test/${i}-sm.webp`;
    meta[imgKey(i)] = {
      blur: null,
      preview: imgLgKey(i), preview_w: 1280, preview_h: 960,
      preview_sm: imgSmKey(i), preview_sm_w: 640, preview_sm_h: 480,
      w: 1600, h: 1200,
    };
  }
  return { cards, urls, meta };
}

// Serve every fixture image URL as a tiny in-memory PNG (the bytes don't
// matter — the specs assert WHICH candidate the browser selected via
// currentSrc, not what it looks like).
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
export async function routeImageCdn(page) {
  await page.route('https://imgcdn.test/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TINY_PNG }));
}

// opts.withDoc adds a rich doc card to the root board; opts.dense replaces
// the root with a 60-note grid (for the zoom-cull spec); opts.withStrokes
// adds 120 spread-out scribbles (for the stroke-cull spec); opts.withImages
// replaces the root with the image grid above (for the tier specs).
export function makeBundles({ withDoc = false, dense = false, withStrokes = false, withImages = false, denseImages = false, nullSnapshot = false } = {}) {
  const images = denseImages ? imageFixture(DENSE_IMAGE_COUNT, 6, 1000, 900)
    : withImages ? imageFixture() : null;
  const rootCards = images
    ? images.cards
    : dense
    ? Object.fromEntries(Array.from({ length: 60 }, (_, i) => [
        `card-grid-${i}`,
        { kind: 'note', body: `Note ${i}`, x: (i % 10) * 400 + 100, y: Math.floor(i / 10) * 400 + 100, w: 240, h: 140 },
      ]))
    : {
        'card-note-1': { kind: 'note', body: 'Welcome to the shared board', x: 120, y: 120, w: 240, h: 140 },
        // Board cards key the cards map by the target board's id (readCards
        // anchors card.id to the map key; CanvasSurface opens via onOpenBoard(c.id)).
        [SUB_ID]: { kind: 'board', x: 460, y: 120, w: 240, h: 160 },
        // Unreachable targets — must be filtered out of the public render.
        [UNREACHABLE_ID]: { kind: 'board', x: 460, y: 320, w: 240, h: 160 },
        'card-deadlink-1': { kind: 'boardlink', target: UNREACHABLE_ID, x: 120, y: 320, w: 240, h: 100 },
        ...(withDoc ? { 'card-doc-1': docCardEntry() } : {}),
      };
  const rootSnapshot = snapshotB64(rootCards, withStrokes ? gridStrokes(120) : []);
  const subSnapshot = snapshotB64({
    'card-note-2': { kind: 'note', body: 'Inside the sub-board', x: 120, y: 120, w: 240, h: 140 },
  });
  const base = {
    image_urls: images ? images.urls : {},
    image_meta: images ? images.meta : {},
    role: 'viewer',
    root_id: ROOT_ID,
    include_subboards: true,
    nav_boards: [
      { id: ROOT_ID, name: 'Marketing Root' },
      { id: SUB_ID, name: 'Inside Board' },
    ],
  };
  return {
    // nullSnapshot simulates a board with NO board_state row (a data anomaly) —
    // the party would return snapshot: null. The viewer must render the calm
    // empty state, not a blank canvas.
    [ROOT_ID]: { ...base, board: { id: ROOT_ID, name: 'Marketing Root', bg_color: null }, snapshot: nullSnapshot ? null : rootSnapshot },
    [SUB_ID]:  { ...base, board: { id: SUB_ID, name: 'Inside Board', bg_color: null }, snapshot: subSnapshot },
  };
}

// Intercept the party share-bundle route. opts.subDelayMs delays sub-board
// responses (makes the nav progress shimmer observable); opts.fail404 fails
// every bundle request (drives the invalid-link page); opts.withDoc /
// opts.dense select the fixture variant (see makeBundles).
export async function routeShareBundle(page, { subDelayMs = 0, fail404 = false, withDoc = false, dense = false, withStrokes = false, withImages = false, denseImages = false, nullSnapshot = false } = {}) {
  const bundles = makeBundles({ withDoc, dense, withStrokes, withImages, denseImages, nullSnapshot });
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
