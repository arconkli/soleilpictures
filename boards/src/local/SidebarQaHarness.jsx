// Sidebar-files QA (?sidebarqa=1). Mounts the real <ClusterSidebar> in the
// real sidebar shell over fixture clusters, so its tabs, shelves, Quick look,
// the All files menu, paging and resize can be driven and screenshotted with no
// backend, and its two cards sized from their edges as App sizes them. The open cluster is live (its cards are in memory, as yb.cards would
// be); every other cluster is served by a fake of 0419's RPCs that keeps the
// same contract (shelf counts, a peek per shelf, offset paging, the four
// sorts), and every call lands in window.__sidebarQa.calls for the spec.
// DEV-only: main.jsx mounts it behind the literal import.meta.env.DEV guard.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import '../styles.css';
import { FILE_SHARE_EVENT } from '../lib/fileShareBus.js';
import { ClusterSidebar } from '../components/sidebar/ClusterSidebar.jsx';
import { SidebarSharedBoards } from '../components/SidebarSharedBoards.jsx';
import { KEPT_FITS_QUERY, SIDE_FITS_QUERY, layoutFromOldWidth, readSidebarLayout, sanitizeLayout, sidebarFootprint, writeSidebarLayout } from '../lib/sidebarLayout.js';
import { useMatchMedia } from '../hooks/useMatchMedia.js';
import { shelfOf } from '../lib/sidebarShelves.js';
import { buildCardIndexRow } from '../lib/cardIndexRow.js';
import { FloatingChrome } from '../components/chrome/FloatingChrome.jsx';
import { Icon } from '../components/Icon.jsx';
import { ChevronLeft, ChevronRight, PanelLeftOpen, PanelLeftClose, Undo, Redo, Search, Sun, Share2, History, Trash2, Columns2, Question, Settings } from '../lib/icons.js';
import { SidebarWho } from '../components/sidebar/SidebarWho.jsx';
import { whoLine } from '../lib/sidebarWho.js';
import { ClustersHome } from '../components/home/ClustersHome.jsx';
import { MessagesPanel } from '../components/MessagesPanel.jsx';
import { MessagesLookContext } from '../components/messagesLook.js';
import { MessagesFixtureContext } from '../lib/messagesFixture.js';
import { FeedbackProvider } from '../components/AppFeedback.jsx';
import * as userProfiles from '../lib/userProfiles.js';
import { pickPresenceColor } from '../lib/presenceColor.js';
import { HomeGraph } from '../components/HomeGraph.jsx';
import { GraphFixtureContext } from '../lib/graphFixture.js';
import { graphFromRows } from '../lib/graphData.js';
import { SELF, PEERS, messagesFixture, HOME_COVERS, HOME_PHOTOS } from './sidebarQaFixtures.js';

const WS = 'ws-qa';
const T0 = Date.parse('2026-10-01T12:00:00Z');

// Real photographs (small crops of the app's own landing and sign-in images),
// not coloured squares: a screenshot of this harness is judged as the product,
// and flat swatches made a calm list look like a toy.
const PHOTOS = Object.values(import.meta.glob('./qa-photos/*.jpg', { eager: true, query: '?url', import: 'default' }));
function swatch(i) {
  return PHOTOS[i % PHOTOS.length];
}

// A cluster's cards, deterministically: n of each kind, each a minute apart.
function cardsFor(prefix, spec, startIndex = 0) {
  const out = [];
  let i = startIndex;
  const at = () => new Date(T0 - (i++) * 60_000).toISOString();
  const pos = (k) => ({ x: (k % 8) * 220, y: Math.floor(k / 8) * 200, w: 200, h: 160 });
  let k = 0;
  for (let n = 0; n < (spec.image || 0); n++) out.push({ id: `${prefix}-img-${n}`, kind: 'image', src: swatch(i), fileName: `${prefix}-still-${String(n + 1).padStart(3, '0')}.jpg`, createdAt: at(), ...pos(k++) });
  for (let n = 0; n < (spec.video || 0); n++) out.push({ id: `${prefix}-vid-${n}`, kind: 'video', src: 'r2:qa', poster: swatch(i + 3), fileName: `${prefix}-take-${n + 1}.mov`, duration: 42 + n * 17, sizeBytes: (180 + n * 40) * 1024 * 1024, createdAt: at(), ...pos(k++) });
  for (let n = 0; n < (spec.audio || 0); n++) out.push({ id: `${prefix}-aud-${n}`, kind: 'audio', src: 'r2:qa', fileName: `${prefix}-loop-${n + 1}.wav`, duration: 8 + n * 4, bpm: 90 + n, createdAt: at(), ...pos(k++) });
  for (let n = 0; n < (spec.pdf || 0); n++) out.push({ id: `${prefix}-pdf-${n}`, kind: 'pdf', pdfSrc: 'r2:qa', src: swatch(i + 7), name: `${prefix}-permit-${n + 1}.pdf`, sizeBytes: (240 + n * 90) * 1024, createdAt: at(), ...pos(k++) });
  for (let n = 0; n < (spec.file || 0); n++) out.push({ id: `${prefix}-file-${n}`, kind: 'file', fileSrc: 'r2:qa', fileName: n % 2 ? `${prefix}-budget.xlsx` : `${prefix}-selects.zip`, ext: n % 2 ? 'xlsx' : 'zip', sizeBytes: (2 + n) * 1024 * 1024, createdAt: at(), ...pos(k++), unplaced: n === 0 });
  for (let n = 0; n < (spec.note || 0); n++) out.push({ id: `${prefix}-note-${n}`, kind: 'note', html: `<p>${['Call sheet notes', 'Wardrobe ideas', 'Ask about the barn', 'Lens list', 'Day two order'][n % 5]}</p>`, createdAt: at(), ...pos(k++) });
  for (let n = 0; n < (spec.doc || 0); n++) out.push({ id: `${prefix}-doc-${n}`, kind: 'doc', title: ['Shot list', 'Treatment v2'][n % 2], lines: [{ text: 'INT. BARN — DAY' }], createdAt: at(), ...pos(k++) });
  for (let n = 0; n < (spec.link || 0); n++) out.push({ id: `${prefix}-link-${n}`, kind: 'link', link: `https://www.example.com/ref/${n + 1}`, title: `Reference ${n + 1}`, createdAt: at(), ...pos(k++) });
  // Grids and shapes as people leave them: nothing on them names them.
  for (let n = 0; n < (spec.grid || 0); n++) out.push({ id: `${prefix}-grid-${n}`, kind: 'grid', createdAt: at(), ...pos(k++) });
  for (let n = 0; n < (spec.shape || 0); n++) out.push({ id: `${prefix}-shape-${n}`, kind: 'shape', shape: n % 2 ? 'rect' : 'arrow', createdAt: at(), ...pos(k++) });
  for (let n = 0; n < (spec.palette || 0); n++) out.push({ id: `${prefix}-pal-${n}`, kind: 'palette', title: ['Night palette', 'Daylight'][n % 2], swatches: ['#1d2b3a', '#c8a26b'], createdAt: at(), ...pos(k++) });
  return out;
}

const BOARDS = {
  root:  { id: 'root',  name: 'Studio',       parent_board_id: null,   workspace_id: WS, cover: 'neutral', created_at: '2026-01-01' },
  film:  { id: 'film',  name: 'Feature film', parent_board_id: 'root', workspace_id: WS, cover: 'amber',   created_at: '2026-02-01', thumb_key: swatch(3) },
  loc:   { id: 'loc',   name: 'Locations',    parent_board_id: 'film', workspace_id: WS, cover: 'sage',    created_at: '2026-02-02' },
  cast:  { id: 'cast',  name: 'Casting',      parent_board_id: 'film', workspace_id: WS, cover: 'rose',    created_at: '2026-02-03' },
  mv:    { id: 'mv',    name: 'Music video',  parent_board_id: 'root', workspace_id: WS, cover: 'sky',     created_at: '2026-03-01', thumb_key: swatch(11) },
  mood:  { id: 'mood',  name: 'Moodboards',   parent_board_id: 'root', workspace_id: WS, cover: 'violet',  created_at: '2026-04-01' },
};

const CARDS = {
  film: cardsFor('film', { image: 30, video: 3, audio: 2, pdf: 1, file: 2, note: 3, doc: 1, link: 4, grid: 2, shape: 2, palette: 1 }, 0),
  loc:  cardsFor('loc',  { image: 40, pdf: 2, note: 1 }, 100),
  cast: cardsFor('cast', { image: 12, note: 5 }, 200),
  mv:   cardsFor('mv',   { image: 120, video: 10, audio: 18, link: 2 }, 300),
  mood: cardsFor('mood', { image: 36 }, 600),
  root: cardsFor('root', { note: 1 }, 900),
};

// card_index rows, built by the real projection so the sidebar reads exactly
// what it would read from the server.
const ROWS = Object.fromEntries(Object.entries(CARDS).map(([b, cards]) => [b, cards.map((c) => {
  const r = buildCardIndexRow({ workspaceId: WS, boardId: b, cardId: c.id, get: (k) => c[k] });
  return { ...r, created_at: c.createdAt, updated_at: c.createdAt };
})]));

function sortRows(rows, sort) {
  const nameKey = (r) => String(r.title || r.meta?.fileName || r.meta?.name || (r.body || '').slice(0, 120) || '').trim().toLowerCase();
  const num = (v) => (typeof v === 'number' ? v : null);
  const by = {
    newest: (a, b) => 0,
    name: (a, b) => (nameKey(a) || '￿').localeCompare(nameKey(b) || '￿'),
    size: (a, b) => (num(b.meta?.sizeBytes) ?? -1) - (num(a.meta?.sizeBytes) ?? -1),
    canvas: (a, b) => ((a.meta?.pos?.y ?? 1e9) - (b.meta?.pos?.y ?? 1e9)) || ((a.meta?.pos?.x ?? 1e9) - (b.meta?.pos?.x ?? 1e9)),
  }[sort] || (() => 0);
  return [...rows].sort((a, b) => by(a, b) || Date.parse(b.created_at) - Date.parse(a.created_at) || a.card_id.localeCompare(b.card_id));
}

function makeSource(stars) {
  const calls = [];
  const asItem = (r, boardId, seq) => ({
    board_id: boardId, card_id: r.card_id, kind: r.kind, shelf: shelfOf(r.kind), title: r.title,
    snippet: (r.body || '').slice(0, 160), meta: r.meta, created_at: r.created_at, updated_at: r.updated_at, seq,
  });
  const rpc = async (fn, p) => {
    calls.push({ fn, params: p });
    await new Promise((r) => setTimeout(r, 30));
    if (fn === 'sidebar_shelf_counts') {
      const out = [];
      for (const b of p.p_board_ids) {
        const by = {};
        for (const r of ROWS[b] || []) {
          const s = shelfOf(r.kind);
          if (!s) continue;
          by[s] ||= { n: 0, u: 0 };
          by[s].n++; if (r.meta?.unplaced) by[s].u++;
        }
        for (const [shelf, v] of Object.entries(by)) out.push({ board_id: b, shelf, n: v.n, n_unplaced: v.u });
      }
      return out;
    }
    if (fn === 'sidebar_cluster_items') {
      const rows = (ROWS[p.p_board_id] || []).filter((r) => shelfOf(r.kind)
        && (!p.p_shelf || shelfOf(r.kind) === p.p_shelf)
        && (!p.p_unplaced || r.meta?.unplaced === true));
      const byShelf = {};
      for (const r of sortRows(rows, p.p_sort)) (byShelf[shelfOf(r.kind)] ||= []).push(r);
      const out = [];
      for (const list of Object.values(byShelf)) {
        list.slice(p.p_offset, p.p_offset + Math.min(p.p_limit, 200))
          .forEach((r, i) => out.push(asItem(r, p.p_board_id, p.p_offset + i + 1)));
      }
      return out;
    }
    if (fn === 'sidebar_recent') {
      const all = Object.entries(ROWS).flatMap(([b, rows]) => rows.map((r) => ({ r, b })));
      return all.sort((x, y) => Date.parse(y.r.created_at) - Date.parse(x.r.created_at)).slice(0, p.p_limit)
        .map(({ r, b }) => asItem(r, b, null));
    }
    if (fn === 'sidebar_starred') {
      return [...stars].map((key) => {
        const [b, c] = key.split(':');
        if (!c) return { board_id: b, card_id: '', kind: 'cluster', title: BOARDS[b]?.name };
        const r = (ROWS[b] || []).find((x) => x.card_id === c);
        return r ? asItem(r, b, null) : null;
      }).filter(Boolean);
    }
    return [];
  };
  const search = async ({ query }) => {
    calls.push({ fn: 'search', params: { query } });
    const q = query.toLowerCase();
    return Object.entries(ROWS).flatMap(([b, rows]) => rows
      .filter((r) => `${r.title} ${r.body} ${r.meta?.fileName || ''} ${r.meta?.name || ''}`.toLowerCase().includes(q))
      .map((r) => ({ ...r, board_id: b })));
  };
  const toggleStar = async (boardId, cardId, on) => {
    calls.push({ fn: 'toggleStar', params: { boardId, cardId, on } });
    const key = `${boardId}:${cardId}`;
    if (on) stars.add(key); else stars.delete(key);
  };
  return { rpc, search, toggleStar, calls };
}

// The move route's fakes: record what was asked and answer the way the route
// does, so the sidebar's toasts and Undo can be driven.
function makeMoveApi(calls) {
  return {
    moveFiles: async (body) => {
      calls.push({ fn: 'moveFiles', params: body });
      const pairs = body.cardIds.map((id) => ({ from: id, to: id }));
      return body.mode === 'copy'
        ? { ok: true, mode: 'copy', copied: body.cardIds.length, cards: body.cardIds.map((id) => ({ id: `${id}-copy` })), skipped: [] }
        : { ok: true, mode: 'move', moved: body.cardIds.length, pairs, originals: body.cardIds.map((id) => ({ id, x: 0, y: 0, unplaced: false })), kept: [] };
    },
    appendCards: async (body) => { calls.push({ fn: 'appendCards', params: body }); return { ok: true, cards: body.cards }; },
    removeCards: async (body) => {
      calls.push({ fn: 'removeCards', params: body });
      return { ok: true, removed: body.cardIds.map((id) => ({ id, kind: 'image' })) };
    },
  };
}

// The stand-in canvas: a dotted field to float over, and a corner for the
// readout the specs watch.
const QA_STYLE = `
.sbqa-world { position: absolute; left: 0; top: 0; width: 0; height: 0; }
.sbqa-card { position: absolute; border-radius: 4px; overflow: hidden; background: var(--bg-2); box-shadow: 0 1px 3px rgba(0,0,0,.4); }
.sbqa-card img { display: block; width: 100%; height: 100%; object-fit: cover; }
.sbqa-readout { position: absolute; left: 24px; bottom: 24px; color: var(--ink-2); font: 13px var(--font-sans); z-index: 1; }
.sbqa-tag, .sbqa-faces { color: var(--ink-1); font: 500 12px var(--font-sans); padding: 4px 8px; }
.sbqa-home-readout { position: fixed; left: 340px; bottom: 6px; z-index: 5; opacity: .6; }
`;

// What the URL asks for: Home instead of the board (&surface=home), Messages
// open (&messages=1; &conv=<id> opens a conversation, &readonly=1 as a
// viewer), and the line under the workspace (&who=here|shared|none).
const QS = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
const SURFACE = QS.get('surface') === 'home' ? 'home' : 'board';
const MSG_QA = QS.has('messages');
const WHO = QS.get('who') || 'here';
// A phone shows the drawer open unless &drawer=0 asks for what's under it.
const DRAWER = QS.get('drawer') !== '0';
// Moving files between clusters: &viewonly=<cluster> is one this person may
// only look at; &shared=1 adds a cluster shared from another workspace under
// the tree, where nothing can be dropped.
const VIEW_ONLY = QS.get('viewonly') || null;
const SHARED = QS.has('shared') ? [{
  board_id: 'grade', board_name: 'Grade', role: 'viewer',
  source_workspace_id: 'ws-gradehouse', source_workspace_name: 'Gradehouse',
}] : [];
userProfiles.populateFromPeers(PEERS);

// Home: the harness's clusters with real covers and an order, who's on which,
// and the workspace at its top left. &viewer=1 is someone who may only look
// (no Rename, Invite, New cluster or a cluster's changes); &empty=1 a
// workspace with nothing but Studio in it. Its universe is the real one
// (HomeGraph), drawn from the same clusters and card rows the sidebar reads.
const VIEWER = QS.has('viewer');
const EMPTY = QS.has('empty');
const HERE_BY_BOARD = new Map([
  ['film', [{ id: 'maya', name: 'Maya Ortiz', initial: 'M', loc: { boardId: 'film' }, color: pickPresenceColor('maya') }]],
  ['cast', [{ id: 'jon', name: 'Jon Park', initial: 'J', loc: { boardId: 'cast' }, color: pickPresenceColor('jon') }]],
]);
const HOME_WORKSPACES = [
  { id: WS, name: 'Sidebar QA', created_by: SELF.id, settings: {} },
  { id: 'ws-personal', name: 'Personal', created_by: SELF.id, settings: {} },
  { id: 'ws-ridge', name: 'Ridgeline', created_by: 'priya', settings: {}, _myRole: 'editor' },
];

// The stand-in board under the canvas's real wrappers (App's split pane, its
// surface, FilesDock), panned so its first column starts under the sidebar:
// the floating cards' gaps should show these photos and this ground, not a
// strip of black. The ground is drawn the way CanvasSurface draws it, at 1:1.
const PAN = { x: -170, y: 36 };
const BOARD = Array.from({ length: 10 }, (_, i) => ({
  id: `b${i}`, src: swatch(i), x: (i % 5) * 236, y: Math.floor(i / 5) * 300 + (i % 2) * 40, w: 216, h: 270 - (i % 3) * 40,
}));
const GROUND = {
  backgroundImage: 'linear-gradient(to right, var(--grid-line) 1px, transparent 1px), linear-gradient(to bottom, var(--grid-line) 1px, transparent 1px), radial-gradient(circle at center, var(--grid-dot) 1px, transparent 1.5px)',
  backgroundSize: '80px 80px, 80px 80px, 20px 20px',
  backgroundPosition: `${PAN.x}px ${PAN.y}px, ${PAN.x}px ${PAN.y}px, ${PAN.x}px ${PAN.y}px`,
  '--cnv-bg-x': `${PAN.x}px`,
  '--cnv-bg-y': `${PAN.y}px`,
};

export function SidebarQaHarness() {
  const [active, setActive] = useState('film');
  // A realtime change to any cluster rebuilds App's boards map; bumpBoards
  // does the same here (a new object, the same clusters).
  const [boardsVersion, setBoardsVersion] = useState(0);
  const allBoards = useMemo(() => ({ ...BOARDS }), [boardsVersion]);
  // A phone shows the sidebar as the app's drawer, open — as the menu button
  // would leave it — at the drawer's width.
  const phone = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 640px)').matches;
  const drawerW = phone ? Math.round(Math.min(window.innerWidth * 0.86, 320)) : 0;
  // The cards' layout, kept and remembered as App keeps it.
  const [layout, setLayout] = useState(() => readSidebarLayout());
  const roomy = useMatchMedia(SIDE_FITS_QUERY);
  const snug = useMatchMedia(KEPT_FITS_QUERY);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const onLayout = (next, { commit = false } = {}) => {
    setLayout(next);
    if (commit) writeSidebarLayout(next);
  };
  const [log, setLog] = useState([]);
  const [collapsed, setCollapsed] = useState(false);
  // App's workspace menu, by its classes: it drops from the top of the clusters' card.
  const [wsMenu, setWsMenu] = useState(false);
  // Whether the open cluster's doc is live; off, its files come from the fake
  // server like any other cluster's (the RPC path: peeks, pages, sorts).
  const [live, setLive] = useState(true);
  const [toast, setToast] = useState(null);
  const listRef = useRef(null);
  const [msgsOpen, setMsgsOpen] = useState(MSG_QA);
  const [openConv, setOpenConv] = useState(QS.get('conv') || null);
  const fixture = useMemo(() => messagesFixture(), []);
  const homeBoards = useMemo(() => Object.fromEntries(Object.entries(allBoards)
    .filter(([id]) => !EMPTY || id === 'root')
    .map(([id, b], i) => [id, {
      ...b, thumb_key: HOME_COVERS[id] || b.thumb_key, card_count: EMPTY ? 0 : (CARDS[id] || []).length,
      updated_at: { film: '2026-10-19T08:00:00Z', cast: '2026-10-18T16:00:00Z', mv: '2026-10-16T10:00:00Z' }[id] || `2026-09-${10 + i}T10:00:00Z`,
    }])), [allBoards]);
  const homeGraph = useMemo(() => ({
    graph: graphFromRows(Object.values(homeBoards), EMPTY ? [] : Object.values(ROWS).flat(), [], { structural: true }),
  }), [homeBoards]);
  const [homeStars, setHomeStars] = useState(() => new Set(['mv']));
  // App's <body> hooks while the files sidebar is on: Messages portals there.
  useEffect(() => {
    const b = document.body;
    b.setAttribute('data-sb-files', '1');
    if (!phone) b.setAttribute('data-sb-float', '1');
    return () => { b.removeAttribute('data-sb-files'); b.removeAttribute('data-sb-float'); };
  }, [phone]);
  const source = useMemo(() => {
    const s = makeSource(new Set(['mood:', 'loc:loc-img-0']));
    window.__sidebarQa = {
      calls: s.calls,
      setActive: (id) => setActive(id),
      bumpBoards: () => setBoardsVersion((v) => v + 1),
      setCollapsed: (v) => setCollapsed(!!v),
      // The sidebar at one width, as it was before the cards were sized apart.
      setWidth: (w) => setLayout(layoutFromOldWidth(w)),
      setLayout: (l) => setLayout(sanitizeLayout(l)),
      layout: () => layoutRef.current,
      setLive: (v) => setLive(!!v),
    };
    return s;
  }, []);
  const moveApi = useMemo(() => makeMoveApi(source.calls), [source]);
  const feedback = useMemo(() => ({ toast: (t) => setToast(t) }), []);
  const say = (msg) => setLog((l) => [...l.slice(-4), msg]);
  // Share file… asks the app's FileShareHost through the bus; here it's a call.
  useEffect(() => {
    const onShare = (e) => source.calls.push({ fn: 'openFileShare', params: e.detail });
    document.addEventListener(FILE_SHARE_EVENT, onShare);
    return () => document.removeEventListener(FILE_SHARE_EVENT, onShare);
  }, [source]);

  // App's top and foot, by their classes, so the parts sit as they do there.
  // The top: the workspace (its subtitle and members too), search everywhere
  // (an icon), and collapse.
  const top = (
    <div className="sb-top">
      <div className="sb-mid-head">
        <button type="button" className="sb-ws-trigger" aria-expanded={wsMenu}
                onClick={() => { say('workspaces'); setWsMenu((o) => !o); }}>
          <span className="sb-ws-avatar">S</span>
          <span className="sb-ws-name">Sidebar QA</span>
          <svg className="sb-ws-chev" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path d="M2 4 L5 7 L8 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button type="button" className="sb-mid-search" onClick={() => say('palette ""')} title="Search (⌘K)" aria-label="Search">
          <Icon as={Search} size={16} weight="regular" />
        </button>
        <button type="button" className="sb-mid-collapse" onClick={() => setCollapsed(true)}
                title="Collapse sidebar (⌘B)" aria-label="Collapse sidebar">
          <Icon as={PanelLeftClose} size={16} weight="regular" />
        </button>
        {wsMenu && (
          <div className="ws-menu" role="menu" aria-label="Workspaces">
            {['Sidebar QA', 'Studio North', 'Feature film unit', 'Archive', 'Personal', 'Client: Lumen', 'Client: Harbor', 'New workspace…', 'Workspace settings'].map((n) => (
              <div key={n} className="ws-menu-row-wrap">
                <button type="button" role="menuitem" className="ws-menu-row" onClick={() => { say(`ws ${n}`); setWsMenu(false); }}>
                  <span className="ws-menu-text">{n}</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <SidebarWho line={WHO === 'none' ? null : whoLine(WHO === 'shared'
        ? { mine: false, sharedBy: 'Maya Ortiz' }
        : { mine: true, others: [{ id: 'maya', name: 'Maya Ortiz' }, { id: 'jon', name: 'Jon Park' }] })} />
    </div>
  );
  // Help, Settings and you.
  const foot = (
    <div className="sb-foot">
      <button type="button" className="sb-foot-icon" title="Help" aria-label="Help" onClick={() => say('help')}>
        <Icon as={Question} size={16} weight="regular" />
      </button>
      <button type="button" className="sb-foot-icon" title="Settings" aria-label="Settings" onClick={() => say('settings')}>
        <Icon as={Settings} size={16} weight="regular" />
      </button>
      <button type="button" className="sb-foot-avatar" title="Account" style={{ background: '#2f6fd6' }} onClick={() => say('account')}>A</button>
    </div>
  );

  return (
    <>
    <style>{QA_STYLE}</style>
    <div className={`app sb-files${phone ? '' : ' is-floating-chrome'}${collapsed ? ' sb-collapsed' : ''}${SURFACE === 'home' ? ' is-home' : ''}`}
         style={{ '--sb-w': `${collapsed ? 0 : phone ? drawerW : sidebarFootprint(layout, { coarse: phone, roomy, snug })}px`, height: '100vh' }} data-sidebarqa-ready="1">
      <aside className={`sidebar${phone && DRAWER ? ' is-mobile-open' : ''}`}>
        <div className="sb-mid">
          <ClusterSidebar
            workspaceId={WS}
            workspaceName="Sidebar QA"
            boards={BOARDS}
            allBoards={allBoards}
            rootId="root"
            activeBoardId={SURFACE === 'home' ? null : active}
            liveBoardId={live ? active : null}
            liveCards={live ? (CARDS[active] || []) : null}
            coarse={phone}
            top={top}
            foot={foot}
            layout={layout}
            onLayout={phone ? null : onLayout}
            floating={!phone}
            roomy={roomy}
            snug={snug}
            sizable={!phone && !collapsed}
            quickNav={{
              home: { active: SURFACE === 'home', onClick: () => say('home') },
              messages: { pressed: msgsOpen, unread: 2, onClick: () => { say('messages'); if (MSG_QA) setMsgsOpen((o) => !o); } },
            }}
            listRef={listRef}
            sharedSection={SHARED.length ? <SidebarSharedBoards shared={SHARED} activeBoardId={active} onOpenBoard={(id) => say(`open shared ${id}`)} /> : null}
            source={source}
            boardsSectionProps={{
              boards: BOARDS, workspaceId: WS, rootId: 'root', activeBoardId: SURFACE === 'home' ? null : active,
              onOpenBoard: (id) => setActive(id), canEditBoard: (id) => id !== VIEW_ONLY,
              onOpenPicker: () => say('picker'),
            }}
            meterProps={{ isPaid: false, cardsUsed: 38, cardLimit: 50, storage: { used: 1.2 * 1024 ** 3, quota: 5 * 1024 ** 3, loading: false } }}
            onOpenPlan={() => say('plan')}
            onUpload={(files) => say(`upload ${files.length}`)}
            onOpenBoard={(id) => setActive(id)}
            onShowFile={(b, c, o) => say(`show ${b}/${c}${o?.unplaced ? ' stored' : ''}`)}
            onOpenShelf={(b) => say(`files ${b}`)}
            onOpenPalette={(q) => say(`palette "${q}"`)}
            feedback={feedback}
            moveApi={moveApi}
            onPickCluster={async () => BOARDS.mood}
            onPutOnBoard={async (boardId, cardIds) => {
              source.calls.push({ fn: 'putOnBoard', params: { boardId, cardIds } });
              if (window.__sidebarQa.putFails) throw new Error(window.__sidebarQa.putFails);
              return { placed: cardIds.length, left: 0 };
            }}
            onSetOpensAs={(id, v) => say(`opens-as ${id} ${v}`)}
            onDropFilesOnCluster={(b, files) => say(`drop ${files.length} on ${b}`)}
            uploadsByBoard={{ cast: 3 }}
          />
        </div>
      </aside>
      <main className="main">
        {/* The desktop bar as App draws it with the files sidebar, over a
            stand-in canvas whose top-edge controls carry the real classes, so
            the islands meet the very rules they would meet on a board. */}
        {!phone && (
          <FloatingChrome
            left={(
              <>
                {collapsed && (
                  <button className="tb-icon" aria-label="Open sidebar" onClick={() => setCollapsed(false)}>
                    <Icon as={PanelLeftOpen} size={16} />
                  </button>
                )}
                <button className="tb-icon" aria-label="Back" disabled><Icon as={ChevronLeft} size={15} /></button>
                <button className="tb-icon" aria-label="Forward" disabled><Icon as={ChevronRight} size={15} /></button>
                <div className="crumbs" data-tour="nav">
                  {[...(BOARDS[active]?.parent_board_id ? [BOARDS[BOARDS[active].parent_board_id]] : []), BOARDS[active]].map((b, i, all) => (
                    <span key={b.id} style={{ display: 'contents' }}>
                      {i > 0 && <span className="crumb-sep" aria-hidden="true">›</span>}
                      <span className={`crumb ${i === all.length - 1 ? 'here' : 'clk'}`}>{b.name}</span>
                    </span>
                  ))}
                </div>
              </>
            )}
            right={(
              <>
                <button className="tb-admin-btn" onClick={() => say('admin')}>Admin</button>
                <button className="tb-icon" aria-label="Undo"><Icon as={Undo} size={16} /></button>
                <button className="tb-icon" aria-label="Redo" disabled><Icon as={Redo} size={16} /></button>
                <button className="tb-icon" aria-label="Search"><Icon as={Search} size={16} /></button>
                <button className="tb-icon" aria-label="Toggle theme"><Icon as={Sun} size={16} /></button>
                <span className="chrome-sep" aria-hidden="true" />
                <span className="sbqa-faces" aria-label="2 people here">AC · JR</span>
                <button className="tb-btn tb-share" aria-label="Share this cluster" onClick={() => say('share')}>
                  <Icon as={Share2} size={14} /> <span className="tb-btn-label">Share</span>
                </button>
              </>
            )}
            menuItems={[
              { id: 'versions', label: 'Version history', icon: History, run: () => say('versions') },
              { id: 'trash', label: 'Deleted clusters', icon: Trash2, run: () => say('trash') },
              { id: 'split', label: 'Pin a cluster alongside…', icon: Columns2, run: () => say('split') },
              { sep: true },
              { id: 'help', label: 'Help & feedback', icon: Question, run: () => say('help') },
            ]}
          />
        )}
        {/* App's chain to the canvas, element for element: SplitContainer's
            wrap and pane, the pane's surface, SurfaceErrorBoundary's
            display:contents root, then FilesDock. The clusterSidebar.css rules
            that let the board run under the sidebar walk this chain, and a
            stand-in that skipped a link once let them pass here while they
            matched nothing in the app. */}
        {SURFACE === 'home' ? (
          <>
            <GraphFixtureContext.Provider value={homeGraph}>
            <ClustersHome
              boards={homeBoards} rootId="root" workspaceId={WS} canCreate={!VIEWER}
              Graph={phone ? null : HomeGraph}
              graphProps={{ workspaceId: WS, onNavigate: (t) => say(`navigate ${t?.kind || ''}`) }}
              workspace={HOME_WORKSPACES[0]} workspaces={HOME_WORKSPACES} personalWorkspaceId="ws-personal"
              selfUserId={SELF.id} wsPeers={PEERS} memberCount={4} canManageWorkspace={!VIEWER}
              onSwitchWorkspace={(id) => say(`switch ${id}`)}
              onNewWorkspace={() => say('new workspace')}
              onRemoveWorkspace={(ws, action) => say(`${action} ${ws.id}`)}
              onOpenWorkspaceSettings={(ws) => say(`settings ${ws.id}`)}
              onInviteWorkspace={(ws) => say(`invite ${ws?.id}`)}
              onRenameWorkspace={async (name) => say(`rename workspace ${name}`)}
              onOpenBoard={(id, via) => say(`home ${via} ${id}`)}
              onNewProject={(name) => say(`new cluster ${name || ''}`)}
              canEditCluster={() => !VIEWER}
              onRenameCluster={(id, name) => say(`rename ${id} ${name}`)}
              onCoverCluster={(id, file) => say(`cover ${id} ${file?.name || ''}`)}
              onMoveCluster={(id) => say(`move ${id}`)}
              isStarred={(id) => homeStars.has(id)}
              onToggleStar={(id) => { say(`star ${id}`); setHomeStars((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }}
              onDeleteCluster={(id) => say(`delete ${id}`)}
              loadPhotos={async (id) => HOME_PHOTOS[id] || []}
              hereByBoard={HERE_BY_BOARD}
            />
            </GraphFixtureContext.Provider>
            <div className="sbqa-readout sbqa-home-readout"><div data-testid="sbqa-log">{log.join(' | ')}</div></div>
          </>
        ) : (
        <div className="split-wrap">
        <div className="split-pane" style={{ flex: 1 }}>
        <div className="surface-wrap is-canvas">
        <div className="surface-eb-root">
        <div className="fdl fdl-off">
        <div className="fdl-canvas">
          <div className="canvas-wrap sbqa-canvas" style={GROUND}
               // What CanvasSurface tells the drag label about its board.
               data-drop-board={active} data-drop-where="board"
               onPointerDown={(e) => { if (!e.target.closest('button')) say('canvas'); }}>
            {/* CanvasSurface's own first layer: the grain over the ground. */}
            <div className="grain-canvas" aria-hidden="true" />
            <div className="sbqa-world" style={{ transform: `translate(${PAN.x}px, ${PAN.y}px)` }}>
              {BOARD.map((c) => (
                <div key={c.id} className="sbqa-card" data-sbqa-card={c.id}
                     style={{ left: c.x, top: c.y, width: c.w, height: c.h }}>
                  <img src={c.src} alt="" draggable={false} />
                </div>
              ))}
            </div>
            {!phone && (
              <>
                <button type="button" className="cnv-comments-eye" aria-label="Comments">◉</button>
                <div className="board-tags-strip"><span className="sbqa-tag">#location</span></div>
                <div className="canvas-presence-roster"><span className="sbqa-tag">2 here</span></div>
                <div className="cnv-hint">Drop files anywhere</div>
              </>
            )}
            <div className="sbqa-readout">
              <div data-testid="sbqa-active">open: {active}</div>
              <div data-testid="sbqa-log">{log.join(' | ')}</div>
              {toast && (
                <div data-testid="sbqa-toast" style={{ marginTop: 12 }}>
                  <span>{toast.message}</span>
                  {(toast.actions || (toast.action ? [toast.action] : [])).map((a) => (
                    <button key={a.label} type="button" style={{ marginLeft: 8 }} onClick={() => { a.onClick(); setToast(null); }}>
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        </div>
        </div>
        </div>
        </div>
        </div>
        )}
      </main>
    </div>
    {msgsOpen && createPortal((
      <FeedbackProvider>
        <MessagesFixtureContext.Provider value={fixture}>
          <MessagesLookContext.Provider value="card">
            <MessagesPanel
              workspaceId={WS} currentUser={SELF}
              canSendMessages={!QS.has('readonly')} readOnlyReason={QS.has('readonly') ? 'viewer' : null}
              refreshTick={0}
              openConversationId={openConv} setOpenConversationId={setOpenConv}
              initialOpenConversationId={null} jumpToMessageId={null} pendingOpenPeerId={null}
              suggestedUserIds={new Set(['maya', 'jon'])}
              onRefreshRequested={() => {}} onPermalinkConsumed={() => {}} onPeerConsumed={() => {}}
              onClose={() => setMsgsOpen(false)}
            />
          </MessagesLookContext.Provider>
        </MessagesFixtureContext.Provider>
      </FeedbackProvider>
    ), document.body)}
    </>
  );
}
