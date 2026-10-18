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
import { SIDEBAR_W, clampSidebarWidth } from '../lib/sidebarWidth.js';
import { shelfOf } from '../lib/sidebarShelves.js';
import { buildCardIndexRow } from '../lib/cardIndexRow.js';

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
      const rows = (ROWS[p.p_board_id] || []).filter((r) => shelfOf(r.kind) && (!p.p_shelf || shelfOf(r.kind) === p.p_shelf));
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

export function SidebarQaHarness() {
  const [active, setActive] = useState('film');
  const [width, setWidth] = useState(SIDEBAR_W.DEFAULT);
  const [log, setLog] = useState([]);
  const listRef = useRef(null);
  const source = useMemo(() => {
    const s = makeSource(new Set(['mood:', 'loc:loc-img-0']));
    window.__sidebarQa = { calls: s.calls, setActive: (id) => setActive(id) };
    return s;
  }, []);
  const say = (msg) => setLog((l) => [...l.slice(-4), msg]);

  return (
    <div className="app sb-files" style={{ '--sb-w': `${width}px`, height: '100vh' }} data-sidebarqa-ready="1">
      <aside className="sidebar">
        <SidebarResizer width={width} onChange={(w) => setWidth(clampSidebarWidth(w))} />
        <div className="sb-mid">
          <div className="sb-top">
            <div className="sb-mid-head"><span className="sb-ws-name">Sidebar QA</span></div>
          </div>
          <ClusterSidebar
            workspaceId={WS}
            boards={BOARDS}
            allBoards={BOARDS}
            rootId="root"
            activeBoardId={active}
            liveBoardId={active}
            liveCards={CARDS[active] || []}
            width={width}
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
          />
        </div>
      </aside>
      <main style={{ padding: 24, color: 'var(--ink-2)', font: '13px var(--font-sans)' }}>
        <div data-testid="sbqa-active">open: {active}</div>
        <div data-testid="sbqa-log">{log.join(' | ')}</div>
      </main>
    </div>
  );
}
