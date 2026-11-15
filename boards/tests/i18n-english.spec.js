// The English snapshot (and the pseudo sweep) for the translation wrap.
//
// Steps 11b-13 wrap thousands of strings with a codemod. The English a person
// sees must not change, except that a count of 1,000 or more gains a thousands
// separator. This boots the REAL signed-in app (tests/helpers/signedInStub.js,
// every Supabase call stubbed) on a frozen clock, visits each screen in SCREENS
// and records every text node, every text-bearing attribute and every console
// error that starts with "[i18n]". scripts/i18nSnapshotDiff.mjs compares runs.
//
//   I18N_LABEL=baseline-1 PW_PORT=5244 npx playwright test tests/i18n-english.spec.js --project=desktop-chrome --workers=2
//   I18N_PSEUDO=1 I18N_LABEL=pseudo-0 PW_PORT=5244 npx playwright test tests/i18n-english.spec.js --project=desktop-chrome --workers=2
//   I18N_LANG=ru I18N_LABEL=ru-1 ...   the same run in a real language (step 16), over ?lang=ru
//   I18N_ONLY=settings,home   only the named screens (a quick check; use another label)
//   I18N_SHOTS=<dir>          also a screenshot of each screen, in <dir>
//   I18N_PHONE=1              a 390 x 844 touch phone instead of a 1280 x 800 desktop
//
// Skipped unless I18N_LABEL is set.
//
// Writes .i18n-snapshot/<label>.json:
//   { screens: { <id>: { texts: [[text, n]], attrs: [['attr=value', n]], i18nErrors: [], pseudoRequests?: [] } },
//     missing: [{ id, error }], fixtureStrings: [...] }
// Each screen also has clips ([[key, count, samples]]: elements whose text the layout cuts or
// pushes past the right edge) and sideways (the page scrolls sideways); scripts/i18nClipDiff.mjs
// compares an English run with a language run at the same size (I18N_PHONE) to list what the
// translation cut.
// A screen (or a step inside one) that cannot be reached goes to `missing`, and
// the others still run. With I18N_PSEUDO=1 every path opens with ?lang=pseudo
// (dev-only: each translated message shows accented inside the brackets), and
// any request body that carries a bracket is recorded: translated text being
// stored.
//
// Several screens are captured from one boot (a menu opened, captured, closed),
// so a screen's setup calls ctx.step(id, fn) for each; a screen without steps
// is captured under its own id after its setup.
import { test } from '@playwright/test';
import * as Y from 'yjs';
import fs from 'node:fs';
import path from 'node:path';
import { bootSignedIn, USER_ID, WS_ID, ROOT_ID, ORG } from './helpers/signedInStub.js';
import { cardToYMap, bytesToB64 } from '../src/lib/yhelpers.js';
import { TOKEN as SHARE_TOKEN, routeShareBundle, routeAnalytics } from './helpers/share-fixture.js';
import { setupI18n } from '@lingui/core';
import { generateMessageId } from '@lingui/message-utils/generateMessageId';
import { compileMessage } from '@lingui/message-utils/compileMessage';
import { installPseudo } from '../src/lib/i18nPseudo.js';

const LABEL = process.env.I18N_LABEL;
const PSEUDO = process.env.I18N_PSEUDO === '1';
const PHONE = process.env.I18N_PHONE === '1';
const LANG = PSEUDO ? 'pseudo' : (process.env.I18N_LANG || '').trim() || null; // null or 'en': English
const ONLY = (process.env.I18N_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const OUT_DIR = path.resolve('.i18n-snapshot');

const CHILD_ID = '55555555-5555-4555-8555-555555555551';
const CHILD2_ID = '55555555-5555-4555-8555-555555555552';
const KEEP_TOKEN = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const created = '2026-10-01T00:00:00Z';

// ---- the words the screens click -------------------------------------------
//
// L('Add menu') is the words as this run's language draws them, read through
// the same i18n._ the app uses (ids from Lingui's own generateMessageId): the
// English in English, the pseudo form under I18N_PSEUDO=1, the compiled
// catalog under I18N_LANG=<code>. Every locator that names English goes through
// it, so the same screens are reached in any language. `context` is the
// message's context when it has one; `values` fills its placeholders.
const words = setupI18n();
words.loadAndActivate({ locale: 'en', messages: {} });
if (PSEUDO) {
  installPseudo(words);
} else if (LANG && LANG !== 'en') {
  const { messages } = await import(`../src/locales/${LANG}/messages.mjs`);
  words.loadAndActivate({ locale: LANG, messages });
}
const L = (english, context, values) => words._({ id: generateMessageId(english, context), message: compileMessage(english), values });

// ---- fixtures -------------------------------------------------------------

const TIER = [{ tier: 'demo', demo_card_count: 6, onboarding: { seeded: true, done: true } }];

const board = (id, name, parent) => ({
  id, workspace_id: WS_ID, parent_board_id: parent, deleted_at: null, name, kind: 'canvas', created_by: USER_ID, created_at: created,
});
const BOARDS = [
  { ...board(ROOT_ID, 'Studio', null) },
  board(CHILD_ID, 'Locations', ROOT_ID),
  board(CHILD2_ID, 'Wardrobe', ROOT_ID),
];

function docCard() {
  const pages = new Y.Array();
  pages.push([{ id: 'p1', name: 'Treatment', parent_id: null, order: 0, expanded: true }]);
  const content = new Y.Map();
  const frag = new Y.XmlFragment();
  const para = new Y.XmlElement('paragraph');
  para.insert(0, [new Y.XmlText('Rain on sodium-lit streets; a detective who never takes off his coat.')]);
  frag.insert(0, [para]);
  content.set('p1', frag);
  return {
    kind: 'doc', title: 'Treatment', x: 700, y: 330, w: 300, h: 200,
    docPages: pages, docPageContent: content, docBookmarks: new Y.Map(), docComments: new Y.Map(),
    docPageSheets: new Y.Map(), docSheetContent: new Y.Map(),
  };
}

// A saved board as board_state holds it: a Y.Doc with a card map.
const CARDS = {
  'card-note-1': { kind: 'note', x: 80, y: 120, w: 240, h: 160, title: 'Opening scene', body: 'Sodium light, wet asphalt, steam from the vents.' },
  'card-note-2': { kind: 'note', x: 360, y: 120, w: 240, h: 160, title: 'Casting', body: 'Ren for the detective; the neighbour is still open.' },
  'card-link-1': { kind: 'link', x: 80, y: 330, w: 280, h: 110, title: 'Night shoots in Tokyo', source: 'example.com' },
  'card-img-1': { kind: 'image', x: 400, y: 330, w: 260, h: 180, tone: 'dusk', label: 'Neon motel', caption: 'practical sodium' },
  'card-file-1': { kind: 'file', x: 80, y: 480, w: 240, h: 100, fileName: 'call-sheet.pdf', ext: 'pdf', mime: 'application/pdf', sizeBytes: 48211 },
  'card-doc-1': docCard(),
  'card-pal-1': { kind: 'palette', x: 360, y: 540, w: 280, h: 110, title: 'House palette', swatches: [{ name: 'Ink', hex: '#0a0a0c' }, { name: 'Sodium', hex: '#f4a14a' }] },
  [CHILD_ID]: { kind: 'board', x: 700, y: 120, w: 260, h: 184 },
};
function savedBoard(cards) {
  const doc = new Y.Doc();
  const map = doc.getMap('cards');
  for (const [id, c] of Object.entries(cards)) map.set(id, cardToYMap({ id, ...c }));
  return bytesToB64(Y.encodeStateAsUpdate(doc));
}

const TAGS = [
  { id: '66666666-6666-4666-8666-666666666661', workspace_id: WS_ID, name: 'Night', color: '#5b8def', created_at: created },
  { id: '66666666-6666-4666-8666-666666666662', workspace_id: WS_ID, name: 'Wardrobe', color: '#d9822b', created_at: created },
];

// Strings the stubs serve as user content: the diff's pseudo mode does not count them as English the app left unwrapped.
const FIXTURE_STRINGS = new Set(['Sam Rivera', 'sam@example.com', 'Studio work', 'Studio', 'Locations', 'Wardrobe', 'Night']);
for (const c of Object.values(CARDS)) {
  for (const k of ['title', 'body', 'label', 'caption', 'source', 'fileName']) if (typeof c[k] === 'string') FIXTURE_STRINGS.add(c[k]);
  for (const s of c.swatches || []) FIXTURE_STRINGS.add(s.name);
}
FIXTURE_STRINGS.add('Rain on sodium-lit streets; a detective who never takes off his coat.');
FIXTURE_STRINGS.add('Northlight Films');
FIXTURE_STRINGS.add('Priya Nair');
FIXTURE_STRINGS.add('priya@example.com');
FIXTURE_STRINGS.add('Tokyo noir, 1974');

const profileRow = { user_id: USER_ID, display_name: 'Sam Rivera', color: null, avatar_url: null, settings: {}, updated_at: created };

function stub(extra = {}) {
  const { rpc = {}, rest = {}, functions = {}, ...more } = extra;
  return {
    rpc: { get_my_tier: TIER, ...rpc },
    rest: {
      boards: BOARDS,
      board_state: (url, method) => {
        if (method !== 'GET') return [];
        const id = (url.searchParams.get('board_id') || '').replace(/^eq\./, '');
        if (id === ROOT_ID) return { doc: savedBoard(CARDS) };
        if (id === CHILD_ID) return { doc: savedBoard({ 'loc-note-1': { kind: 'note', x: 120, y: 120, w: 240, h: 160, title: 'Shinjuku', body: 'Under the tracks, after midnight.' } }) };
        return { doc: savedBoard({}) };
      },
      tags: TAGS,
      profiles: (url, method) => (method === 'GET' ? [profileRow] : []),
      ...rest,
    },
    functions,
    ...more,
  };
}
const EMPTY = stub({ rest: { board_state: (url, method) => (method === 'GET' ? { doc: savedBoard({}) } : []) } });

// get_team / get_team_billing, in the shapes tests/team-live.spec.js uses.
const GET_TEAM = {
  id: ORG, name: 'Northlight Films', letter: 'N', color: '#5b8def', sample: false, status: 'active',
  me: { id: USER_ID, role: 'owner' },
  admins: [{ id: USER_ID, name: 'Sam Rivera' }],
  people: [
    { id: USER_ID, name: 'Sam Rivera', email: 'sam@example.com', role: 'owner', invited: null, color: '#5b8def', where: [], everywhere: true },
    { id: '88888888-8888-4888-8888-888888888888', name: 'Priya Nair', email: 'priya@example.com', role: 'member', invited: null, color: '#d9822b', where: ['Studio work'], everywhere: false },
  ],
  requests: [], plan: null, storage: null, unpaid: null,
  seats: { bought: 5, used: 2, pending: 0, ceiling: 20 },
  whenFull: { mode: 'auto', monthlyLimit: 4 },
  joining: { link: { on: false, token: null, role: null }, domains: [] },
  workspaces: [{ id: WS_ID, name: 'Studio work', letter: 'S', color: null, private: false }],
};
const GET_BILLING = {
  status: 'active', is_owner: true, seats: 5, plan: 'annual', subscription_status: 'active',
  current_period_end: '2027-01-02T00:00:00Z', trial_end: null, cancel_at_period_end: false,
  auto_added_this_month: 0, storage_used_bytes: 100, storage_quota_bytes: 1e12,
  view_only_since: null, past_due_since: null, grace_ends_at: null,
};
const TEAM = stub({
  rpc: {
    list_my_teams: [{ org_id: ORG, name: 'Northlight Films', letter: 'N', color: '#5b8def', role: 'owner', holds_seat: true }],
    get_team: GET_TEAM, get_team_billing: GET_BILLING,
  },
});

// ---- the capture ----------------------------------------------------------

function pageSnapshot() {
  const collapse = (s) => s.replace(/\s+/g, ' ').trim();
  const skip = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT']);
  const texts = {};
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || skip.has(el.tagName)) continue;
    const t = collapse(n.nodeValue || '');
    if (t) texts[t] = (texts[t] || 0) + 1;
  }
  const attrs = {};
  const names = ['title', 'aria-label', 'aria-description', 'placeholder', 'alt', 'data-tip', 'aria-valuetext'];
  for (const el of document.querySelectorAll('*')) {
    if (skip.has(el.tagName)) continue;
    for (const a of names) {
      const v = el.getAttribute(a);
      if (v == null) continue;
      const t = collapse(v);
      if (!t) continue;
      const k = `${a}=${t}`;
      attrs[k] = (attrs[k] || 0) + 1;
    }
  }
  const sorted = (o) => Object.entries(o).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  // Text the layout cuts or pushes off the right edge, for scripts/i18nClipDiff.mjs.
  const root = document.documentElement;
  const sideways = root.scrollWidth > root.clientWidth + 1;
  const groups = {};
  for (const el of document.body.querySelectorAll('*')) {
    if (skip.has(el.tagName) || typeof el.className !== 'string') continue;
    if (!(el.textContent || '').trim()) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'inline' || cs.display === 'contents' || cs.display === 'none' || cs.visibility !== 'visible') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    let why = null;
    if ((cs.overflowX === 'hidden' || cs.overflowX === 'clip' || cs.textOverflow === 'ellipsis') && el.scrollWidth > el.clientWidth + 1) why = 'x';
    else if ((cs.overflowY === 'hidden' || cs.overflowY === 'clip' || (cs.webkitLineClamp && cs.webkitLineClamp !== 'none')) && el.scrollHeight > el.clientHeight + 1) why = 'y';
    else if (r.right > root.clientWidth + 1 && r.left < root.clientWidth && cs.position !== 'fixed') why = 'edge';
    if (!why) continue;
    const classes = el.className.split(/\s+/).filter(Boolean).slice(0, 3);
    const k = `${why} ${el.tagName.toLowerCase()}${classes.map((c) => `.${c}`).join('')}`;
    const g = groups[k] || (groups[k] = { n: 0, samples: [] });
    g.n += 1;
    if (g.samples.length < 3) g.samples.push(collapse(el.innerText || '').slice(0, 60));
  }
  const clips = Object.entries(groups).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([k, g]) => [k, g.n, g.samples]);
  return { texts: sorted(texts), attrs: sorted(attrs), clips, sideways };
}

// Wait until the text on the page stops changing (three quiet looks in a row).
async function settle(page, { max = 8000 } = {}) {
  const start = Date.now();
  let last = -1;
  let quiet = 0;
  while (Date.now() - start < max && quiet < 3) {
    await page.waitForTimeout(400);
    const n = await page.evaluate(() => document.documentElement.innerText.length + document.querySelectorAll('*').length * 1000).catch(() => -2);
    if (n === last) quiet += 1; else { quiet = 0; last = n; }
  }
}

const withLang = (p) => {
  if (!LANG || LANG === 'en') return p;
  const u = new URL(p, 'http://x');
  u.searchParams.set('lang', LANG);
  return u.pathname + u.search + u.hash;
};

const result = { screens: {}, missing: [], fixtureStrings: [...FIXTURE_STRINGS].sort() };

function save() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, `${LABEL}.json`), `${JSON.stringify(result, null, 1)}\n`);
}

const miss = (id, e) => result.missing.push({ id, error: String(e && e.message ? e.message : e).split('\n')[0].slice(0, 200) });

// ---- helpers the screens share --------------------------------------------

const key = (page, k) => page.keyboard.press(k);
// `name` is the words as drawn: pass L('…') for anything the app translates.
const clickText = (page, name, opts = {}) => page.getByText(name, { exact: true }).first().click({ timeout: 4000, ...opts });
const closeAll = async (page) => {
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(250); }
};
const closeMenu = async (page) => { await page.keyboard.press('Escape'); await page.waitForTimeout(300); };
const bgClick = (page) => page.locator('.canvas-wrap').click({ position: { x: 1000, y: 700 } });
const BG = { x: 900, y: 650 };
const bg = (page) => page.locator('.canvas-wrap').click({ button: 'right', position: BG });
const firstCard = (kind) => `.card[data-card-id][data-kind="${kind}"], .card[data-card-id="${kind}"]`;
const cardEl = (page, id) => page.locator(`.card[data-card-id="${id}"]`).first();


// Nothing leaves the machine: only the dev host answers (signed-out and
// harness pages, which bootSignedIn does not serve).
async function blockOutside(page) {
  await page.context().route(/.*/, (route) => {
    const host = new URL(route.request().url()).hostname;
    return host === '127.0.0.1' || host === 'localhost' ? route.continue() : route.abort();
  });
  await page.context().routeWebSocket(/.*/, (ws) => {
    let host = '';
    try { host = new URL(ws.url()).hostname; } catch (_) { /* ignore */ }
    if (host === '127.0.0.1' || host === 'localhost') ws.connectToServer(); else ws.close();
  });
}

// The Worker's /api/keep/bundle for the keep page (tests/keep-page.spec.js has the full set).
async function routeKeep(page) {
  const cards = {
    'k-note-1': { kind: 'note', body: 'Sodium light, wet asphalt, steam from the vents.', x: 100, y: 100, w: 300, h: 180 },
    'k-note-2': { kind: 'note', body: 'Shinjuku, under the tracks', x: 440, y: 100, w: 260, h: 160 },
  };
  const doc = new Y.Doc();
  const map = doc.getMap('cards');
  for (const [id, c] of Object.entries(cards)) { const m = new Y.Map(); for (const [k, v] of Object.entries(c)) m.set(k, v); map.set(id, m); }
  const bundle = {
    state: 'live', host: 'chatgpt', expires_at: '2026-11-25T14:00:00Z', lifetime_days: 30, card_count: 2, card_limit: 50,
    image_urls: {}, image_meta: {}, role: 'viewer', root_id: ROOT_ID, include_subboards: true,
    nav_boards: [{ id: ROOT_ID, name: 'Tokyo noir, 1974' }],
    board: { id: ROOT_ID, name: 'Tokyo noir, 1974', bg_color: null },
    snapshot: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'),
  };
  await page.route('**/api/keep/bundle', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bundle) }));
}

// ---- the screens ----------------------------------------------------------

const SETTINGS_TABS = ['Profile', 'Appearance', 'Notifications', 'Connections', 'Plan & billing', 'Invite & earn', 'General', 'Members', 'Card defaults', 'Documentation'];

const SCREENS = [
  {
    id: 'home', multi: true,
    setup: async (page, ctx) => {
      await ctx.step('home', async () => {});
      await ctx.step('workspace-menu', async () => { await page.locator('.sb-ws-trigger').click(); }, closeAll);
      await ctx.step('new-workspace', async () => {
        await page.locator('.sb-ws-trigger').click();
        await page.locator('.ws-menu-add').click();
      }, closeAll);
      await ctx.step('palette-empty', async () => { await key(page, 'Control+k'); await page.waitForTimeout(600); }, closeAll);
      await ctx.step('palette-set', async () => {
        await key(page, 'Control+k');
        await page.waitForTimeout(500);
        await page.keyboard.type('set');
        await page.waitForTimeout(800);
      }, closeAll);
      await ctx.step('shortcuts', async () => { await page.locator(`[aria-label="${L('Keyboard shortcuts')}"]`).click(); }, closeAll);
      await ctx.step('help-hub', async () => { await page.locator(`button[aria-label="${L('Help')}"]`).click(); }, closeAll);
      await ctx.step('feedback', async () => {
        await page.locator(`button[aria-label="${L('Help')}"]`).click();
        await page.locator(`button[aria-label="${L('Send feedback')}"]`).click();
      }, closeAll);
      await ctx.step('trash', async () => {
        await page.locator('.chrome-more-btn').click();
        await clickText(page, L('Deleted clusters'));
      }, closeAll);
      await ctx.step('version-history', async () => {
        await page.locator('.chrome-more-btn').click();
        await clickText(page, L('Version history'));
      }, closeAll);
      await ctx.step('chrome-more-menu', async () => { await page.locator('.chrome-more-btn').click(); }, closeAll);
      await ctx.step('account-settings-profile', async () => { await page.locator('.sb-foot-avatar').click(); }, closeAll);
      await ctx.step('notifications', async () => { await page.locator('.nb-bell').click(); }, closeAll);
      await ctx.step('add-menu', async () => { await page.locator(`[aria-label="${L('Add menu')}"]`).click(); }, closeAll);
      await ctx.step('background-menu', async () => { await bg(page); }, closeAll);
      await ctx.step('new-cluster', async () => { await page.locator('.tb-newcluster').click(); }, closeAll);
      await ctx.step('share-modal', async () => { await page.locator('.tb-share').click(); }, closeAll);
      await ctx.step('plan-and-storage', async () => { await page.locator('.sbf-meter-text').click(); }, closeAll);
      await ctx.step('messages-panel', async () => { await page.locator('.sbf-quickbtn', { hasText: L('Messages') }).click(); }, async () => { await page.locator('.sbf-quickbtn', { hasText: L('Messages') }).click(); });
      await ctx.step('home-page', async () => { await page.locator('.sbf-quickbtn', { hasText: L('Home') }).click(); });
      await ctx.step('all-clusters', async () => { await page.getByText(L('All clusters'), { exact: true }).first().click(); });
    },
  },
  {
    id: 'cluster-work', multi: true,
    setup: async (page, ctx) => {
      const sel = (id) => page.locator(`.card[data-card-id="${id}"]`).first();
      await ctx.step('cards-all-kinds', async () => { await sel('card-note-1').waitFor({ timeout: 8000 }); });
      await ctx.step('card-note-selected', async () => { await sel('card-note-1').click(); }, async () => { await bgClick(page); });
      await ctx.step('card-image-selected', async () => { await sel('card-img-1').click(); }, async () => { await bgClick(page); });
      await ctx.step('card-link-selected', async () => { await sel('card-link-1').click(); }, async () => { await bgClick(page); });
      await ctx.step('card-file-selected', async () => { await sel('card-file-1').click(); }, async () => { await bgClick(page); });
      await ctx.step('card-doc-selected', async () => { await sel('card-doc-1').click(); }, async () => { await bgClick(page); });
      await ctx.step('card-menu-note', async () => { await sel('card-note-1').click({ button: 'right' }); }, closeAll);
      await ctx.step('card-menu-image', async () => { await sel('card-img-1').click({ button: 'right' }); }, closeAll);
      await ctx.step('card-menu-link', async () => { await sel('card-link-1').click({ button: 'right' }); }, closeAll);
      await ctx.step('card-menu-file', async () => { await sel('card-file-1').click({ button: 'right' }); }, closeAll);
      await ctx.step('card-menu-doc', async () => { await sel('card-doc-1').click({ button: 'right' }); }, closeAll);
      await ctx.step('cluster-info', async () => { await key(page, 'Control+i'); }, closeAll);
      await ctx.step('comments-mode', async () => { await page.locator('.cnv-comments-eye').click(); }, async () => { await page.locator('.cnv-comments-eye').click(); });
      await ctx.step('note-editing', async () => { await sel('card-note-1').dblclick(); await page.locator('.note-body[contenteditable="true"]').waitFor(); }, async () => { await closeAll(page); await bgClick(page); });
      await ctx.step('comment-composer', async () => {
        await sel('card-note-1').click({ button: 'right' });
        await clickText(page, L('Add comment'));
      }, closeAll);
      await ctx.step('tag-card-picker', async () => {
        await sel('card-note-1').click({ button: 'right' });
        await clickText(page, L('Tag…'));
      }, closeAll);
      await ctx.step('doc-open', async () => { await sel('card-doc-1').getByText(L('Open'), { exact: true }).click(); await page.waitForTimeout(1500); });
      // The doc's own bar: its comments button, the insert menu and the more menu (a fixed 1280x800 window).
      await ctx.step('doc-insert-menu', async () => { await page.mouse.click(1170, 109); }, closeMenu);
      await ctx.step('doc-more-menu', async () => { await page.mouse.click(1218, 109); }, closeMenu);
      await ctx.step('doc-comments', async () => { await page.mouse.click(1160, 50); });
      await ctx.step('doc-closed', async () => { await page.mouse.click(1229, 50); });
      await ctx.step('toast-card-deleted', async () => {
        await sel('card-note-2').click();
        await key(page, 'Delete');
        await page.locator('.toast-msg').first().waitFor({ timeout: 4000 });
      }, async () => { await page.waitForTimeout(100); });
      await ctx.step('tag-detail', async () => { await page.locator('.sb-tags-head ~ * >> text=Night').first().click(); }, async () => {
        await page.locator('.sb-tree-row, .sb-tree-item', { hasText: 'Studio' }).first().click();
      });
      await ctx.step('files-page', async () => { await page.locator(`[aria-label="${L('Open in the full Files page')}"]`).click(); });
    },
  },
  {
    id: 'child-cluster', multi: true,
    setup: async (page, ctx) => {
      await ctx.step('child-cluster', async () => {
        await page.locator('.sb-tree-row, .sb-tree-item', { hasText: 'Locations' }).first().click();
        await page.locator('.card[data-card-id="loc-note-1"]').waitFor({ timeout: 10000 });
      });
      await ctx.step('toast-cluster-deleted', async () => {
        await page.locator('.sb-tree-row, .sb-tree-item', { hasText: 'Wardrobe' }).first().click({ button: 'right' });
        await page.getByText(L('Delete'), { exact: true }).first().click({ timeout: 3000 });
      }, closeAll);
    },
  },
  {
    id: 'empty-cluster', stub: EMPTY,
  },
  {
    id: 'settings', multi: true,
    setup: async (page, ctx) => {
      await page.locator(`button[aria-label="${L('Settings')}"]`).first().click();
      await page.getByRole('dialog', { name: L('Settings') }).waitFor();
      for (const tab of SETTINGS_TABS) {
        await ctx.step(`settings-${tab.toLowerCase().replace(/[^a-z]+/g, '-')}`, async () => {
          await page.getByRole('dialog', { name: L('Settings') }).locator('.settings-tab', { hasText: L(tab) }).first().click();
          await page.waitForTimeout(600);
        });
      }
      await ctx.step('pricing-popup', async () => {
        await page.getByRole('dialog', { name: L('Settings') }).locator('.settings-tab', { hasText: L('Plan & billing') }).first().click();
        await page.getByText(L('Try {planName} free for {days} days', undefined, { planName: 'Creator', days: 14 })).first().click();
        await page.waitForTimeout(1500);
      }, closeMenu);
      await ctx.step('settings-delete-account', async () => {
        await page.getByRole('dialog', { name: L('Settings') }).locator('.settings-tab', { hasText: L('Profile') }).first().click();
        await page.getByText(L('Delete account…')).click();
      }, closeMenu);
    },
  },
  {
    id: 'team', path: '/team', stub: TEAM, multi: true,
    setup: async (page, ctx) => {
      await page.waitForTimeout(5000); // the Team plan loads several seconds after the boot
      await ctx.step('team-page', async () => {});
    },
  },
  {
    id: 'sign-in', multi: true,
    boot: async (page) => {
      await blockOutside(page);
      await page.goto(withLang('/'));
      await page.waitForSelector('input[type="email"], input[autocomplete="email"]', { timeout: 20000 });
      await page.waitForTimeout(1500);
    },
    setup: async (page, ctx) => { await ctx.step('sign-in', async () => {}); },
  },
  {
    id: 'shared-guest', multi: true,
    boot: async (page) => {
      await routeAnalytics(page, []);
      await routeShareBundle(page, { withDoc: true });
      await page.goto(withLang(`/share/${SHARE_TOKEN}`));
      await page.waitForSelector('.public-board-name', { timeout: 20000 });
      await page.waitForTimeout(2500);
    },
    setup: async (page, ctx) => { await ctx.step('shared-guest', async () => {}); },
  },
  {
    id: 'oauth-consent', multi: true,
    boot: async (page) => {
      const client = { client_id: 'https://claude.ai/oauth/mcp-oauth-client-metadata', client_name: 'Claude', client_kind: 'metadata', client_host: 'claude.ai' };
      await page.route(/\/oauth\/client\?/, (r) => r.fulfill({ json: { ...client, redirect_uri_registered: true, scopes_supported: ['read', 'write', 'delete'] } }));
      const q = new URLSearchParams({
        response_type: 'code', client_id: client.client_id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', scope: 'read write', state: 's',
        code_challenge: 'c'.repeat(43), code_challenge_method: 'S256',
      });
      await bootSignedIn(page, { ...stub(), path: withLang(`/oauth/authorize?${q}`) });
      await page.waitForSelector('.oauth-allow', { timeout: 20000 });
    },
    setup: async (page, ctx) => {
      await ctx.step('oauth-consent', async () => {});
      await ctx.step('oauth-consent-allow-deleting', async () => { await page.getByRole('button', { name: L('Allow deleting') }).click(); });
    },
  },
  {
    id: 'keep-page', multi: true,
    boot: async (page) => {
      await routeKeep(page);
      await blockOutside(page);
      await page.goto(withLang(`/keep/${KEEP_TOKEN}`));
      await page.waitForSelector('.keep-island', { timeout: 20000 });
      await page.waitForTimeout(2000);
    },
    setup: async (page, ctx) => {
      await ctx.step('keep-page', async () => {});
      await ctx.step('keep-page-email', async () => {
        await page.getByLabel(L('Your email')).fill('ren@example.com');
      });
    },
  },
  ...['running', 'paused', 'problems', 'offline', 'error', 'held', 'op-zip', 'reconnecting', 'saved'].map((state) => ({
    id: `activity-tray-${state}`,
    boot: async (page) => {
      await blockOutside(page);
      await page.goto(withLang(`/?uploadqa=1&tray=${state}`));
      await page.waitForSelector('html[data-trayqa-ready="1"]', { timeout: 30000 });
    },
  })),
];

// ---- the run --------------------------------------------------------------

async function runScreen(browser, screen) {
  const size = PHONE ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 } };
  const context = await browser.newContext({ ...size, locale: 'en-US', timezoneId: 'UTC' });
  const page = await context.newPage();
  page.setDefaultTimeout(5000); // a step that cannot be reached must fail fast, not hang
  const errors = [];
  const bodies = [];
  page.on('console', (m) => { if (m.type() === 'error' && m.text().startsWith('[i18n]')) errors.push(m.text()); });
  if (PSEUDO) {
    page.on('request', (r) => {
      let b = null;
      try { b = r.postData(); } catch (_) { /* ignore */ }
      if (b && b.includes('⟦')) bodies.push({ method: r.method(), url: r.url().replace(/\?.*$/, ''), body: b.slice(0, 400) });
    });
  }
  const capture = async (id) => {
    await settle(page);
    const snap = await page.evaluate(pageSnapshot);
    if (process.env.I18N_SHOTS) await page.screenshot({ path: `${process.env.I18N_SHOTS}/${id}.png` }).catch(() => {});
    const entry = { ...snap, i18nErrors: errors.splice(0) };
    if (PSEUDO) entry.pseudoRequests = bodies.splice(0);
    result.screens[id] = entry;
  };
  const ctx = {
    capture,
    // Capture `id` after `open`, then `close` (the menu or dialog), or record why it could not be reached.
    step: async (id, open, close) => {
      try {
        await open();
        await capture(id);
      } catch (e) {
        miss(id, e);
      }
      try { if (close) await close(page); } catch (_) { /* ignore */ }
    },
  };
  try {
    await page.clock.install({ time: new Date('2026-11-09T15:00:00Z') });
    if (screen.boot) {
      await screen.boot(page, ctx);
    } else {
      const s = screen.stub || stub();
      await bootSignedIn(page, { ...s, path: withLang(screen.path || '/') });
      await page.waitForSelector(screen.ready || '.sb-ws-trigger', { timeout: 40000 });
      await page.waitForTimeout(3500); // a board's first 3s are the doc arriving
    }
    if (screen.setup) await screen.setup(page, ctx);
    if (!screen.multi) await capture(screen.id);
  } catch (e) {
    miss(screen.id, e);
  } finally {
    await context.close().catch(() => {});
  }
}

test('English snapshot', async ({ browser }) => {
  test.skip(!LABEL, 'English snapshot: run with I18N_LABEL=<name>');
  test.setTimeout(45 * 60 * 1000);
  for (const screen of SCREENS) {
    if (ONLY.length && !ONLY.includes(screen.id)) continue;
    await runScreen(browser, screen);
    save();
  }
  save();
});
