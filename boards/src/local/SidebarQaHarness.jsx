// Sidebar-files QA (?sidebarqa=1). Mounts the real <ClusterSidebar> in the
// real sidebar shell over fixture clusters, so its shelves, Quick look, finder,
// chips, sort menu, paging and resize can be driven and screenshotted with no
// backend. The open cluster is live (its cards are in memory, as yb.cards would
// be); every other cluster is served by a fake of 0419's RPCs that keeps the
// same contract (shelf counts, a peek per shelf, offset paging, the four
// sorts), and every call lands in window.__sidebarQa.calls for the spec.
// DEV-only: main.jsx mounts it behind the literal import.meta.env.DEV guard.

import { useMemo, useRef, useState } from 'react';
import '../styles.css';
import { ClusterSidebar } from '../components/sidebar/ClusterSidebar.jsx';
import { SidebarResizer } from '../components/sidebar/SidebarResizer.jsx';
import { SIDEBAR_W, clampSidebarWidth, isWideSidebar } from '../lib/sidebarWidth.js';
import { shelfOf } from '../lib/sidebarShelves.js';
import { buildCardIndexRow } from '../lib/cardIndexRow.js';
import { FloatingChrome } from '../components/chrome/FloatingChrome.jsx';
import { Icon } from '../components/Icon.jsx';
import { ChevronLeft, ChevronRight, PanelLeftOpen, Undo, Redo, Search, Sun, Share2, History, Trash2, Columns2, Question, Home, MessageSquare } from '../lib/icons.js';

const WS = 'ws-qa';
const T0 = Date.parse('2026-10-01T12:00:00Z');

function swatch(i) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'>`
    + `<rect width='80' height='80' fill='hsl(${(i * 47) % 360},55%,55%)'/>`
    + `<circle cx='56' cy='26' r='12' fill='hsl(${(i * 47 + 180) % 360},60%,75%)'/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
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
  for (let n = 0; n < (spec.grid || 0); n++) out.push({ id: `${prefix}-grid-${n}`, kind: 'grid', title: `Storyboard ${n + 1}`, createdAt: at(), ...pos(k++) });
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
  film: cardsFor('film', { image: 30, video: 3, audio: 2, pdf: 1, file: 2, note: 3, doc: 1, link: 4, grid: 2 }, 0),
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
.sbqa-canvas { position: absolute; inset: 0; background: var(--bg-0, #0c0c0e);
  background-image: radial-gradient(var(--line-2) 1px, transparent 1px); background-size: 22px 22px; }
.sbqa-readout { position: absolute; left: 24px; bottom: 24px; color: var(--ink-2); font: 13px var(--font-sans); }
.sbqa-tag, .sbqa-faces { color: var(--ink-1); font: 500 12px var(--font-sans); padding: 4px 8px; }
`;

export function SidebarQaHarness() {
  const [active, setActive] = useState('film');
  // A realtime change to any cluster rebuilds App's boards map; bumpBoards
  // does the same here (a new object, the same clusters).
  const [boardsVersion, setBoardsVersion] = useState(0);
  const allBoards = useMemo(() => ({ ...BOARDS }), [boardsVersion]);
  // A phone shows the sidebar as the app's drawer, open — as the menu button
  // would leave it — at the drawer's width.
  const phone = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 640px)').matches;
  const [width, setWidth] = useState(phone ? Math.round(Math.min(window.innerWidth * 0.86, 320)) : SIDEBAR_W.DEFAULT);
  const [log, setLog] = useState([]);
  const [collapsed, setCollapsed] = useState(false);
  // Whether the open cluster's doc is live; off, its files come from the fake
  // server like any other cluster's (the RPC path: peeks, pages, sorts).
  const [live, setLive] = useState(true);
  const [toast, setToast] = useState(null);
  const listRef = useRef(null);
  const source = useMemo(() => {
    const s = makeSource(new Set(['mood:', 'loc:loc-img-0']));
    window.__sidebarQa = {
      calls: s.calls,
      setActive: (id) => setActive(id),
      bumpBoards: () => setBoardsVersion((v) => v + 1),
      setCollapsed: (v) => setCollapsed(!!v),
      setWidth: (w) => setWidth(clampSidebarWidth(w)),
      setLive: (v) => setLive(!!v),
    };
    return s;
  }, []);
  const moveApi = useMemo(() => makeMoveApi(source.calls), [source]);
  const feedback = useMemo(() => ({ toast: (t) => setToast(t) }), []);
  const say = (msg) => setLog((l) => [...l.slice(-4), msg]);

  return (
    <>
    <style>{QA_STYLE}</style>
    <div className={`app sb-files${phone ? '' : ' is-floating-chrome'}${collapsed ? ' sb-collapsed' : ''}`}
         style={{ '--sb-w': `${collapsed ? 0 : width}px`, height: '100vh' }} data-sidebarqa-ready="1">
      <aside className={`sidebar${phone ? ' is-mobile-open' : ''}${!phone && isWideSidebar(width) ? ' is-wide' : ''}`}>
        {!phone && <SidebarResizer width={width} onChange={(w) => setWidth(clampSidebarWidth(w))} />}
        <div className="sb-mid">
          {/* The real top rows' classes, so the parts below sit as they do in App. */}
          <div className="sb-top">
            <div className="sb-mid-head"><span className="sb-ws-name">Sidebar QA</span></div>
            <button type="button" className="sb-search" onClick={() => say('palette ""')}>
              <Icon as={Search} size={13} /><span>Search…</span><span className="sb-search-kbd">⌘K</span>
            </button>
            <div className="sb-row" role="button" tabIndex={0} onClick={() => say('home')}><Icon as={Home} size={15} /><span className="sb-row-label">Home</span></div>
            <div className="sb-row" role="button" tabIndex={0} onClick={() => say('messages')}><Icon as={MessageSquare} size={15} /><span className="sb-row-label">Messages</span></div>
          </div>
          <ClusterSidebar
            workspaceId={WS}
            boards={BOARDS}
            allBoards={allBoards}
            rootId="root"
            activeBoardId={active}
            liveBoardId={live ? active : null}
            liveCards={live ? (CARDS[active] || []) : null}
            width={width}
            coarse={phone}
            onSetWidth={phone ? null : (w) => setWidth(clampSidebarWidth(w))}
            listRef={listRef}
            source={source}
            boardsSectionProps={{
              boards: BOARDS, workspaceId: WS, rootId: 'root', activeBoardId: active,
              onOpenBoard: (id) => setActive(id), canEditBoard: () => true,
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
        <div className="surface-wrap is-canvas" style={{ flex: 1 }}>
          <div className="canvas-wrap sbqa-canvas">
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
                  {toast.action && (
                    <button type="button" style={{ marginLeft: 8 }} onClick={() => { toast.action.onClick(); setToast(null); }}>
                      {toast.action.label}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
    </>
  );
}
