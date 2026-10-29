// showcaseLibrary.js — what Admin › Boards shows, worked out from one
// showcase_library() read (0820 + 0821). Pure, so the tab stays a renderer and
// the rules here are pinned by showcaseLibrary.test.mjs.
//
// The boards engine (scripts/engine/run.mjs) writes a real board into the
// Showcase workspace, shoots it in the real app and files the shots here. The
// first ten wait for a person's OK; after that they land straight in the
// library, and the engine's own checks are the gate.

export const HAND_OKS = 10;           // run.mjs's HAND_OKS: OKs by a person before it runs by itself
export const ENGINE_HOUR = 6;         // the launchd job's 06:00, local time
export const QUIET_HOURS = 36;        // past this with no run, the tab says so

// The big picture's two switches → the shot that answers them. A board with no
// dark phone shot shows the light one: the phone shot is taken once.
export const VIEWS = [
  { id: 'app', label: 'In the app', light: 'desk-light', dark: 'desk-dark' },
  { id: 'board', label: 'Board only', light: 'board-light', dark: 'board-dark' },
  { id: 'phone', label: 'Phone', light: 'phone', dark: 'phone' },
];

// Download list order; anything the engine adds later goes after these.
const SHOT_ORDER = ['wide', 'desk-light', 'desk-dark', 'board-light', 'board-dark', 'phone', 'portrait', 'square'];

const lower = (s) => String(s || '').toLowerCase();

/** The rows a board needs, with safe defaults for an older or partial row. */
function normal(b) {
  const shots = Array.isArray(b.shots) ? b.shots : [];
  const score = b.score && typeof b.score === 'object' ? b.score : {};
  return {
    ...b,
    cluster: b.cluster || 'Unsorted',
    shots,
    score,
    credits: Array.isArray(b.credits) ? b.credits : [],
    placed_on: Array.isArray(b.placed_on) ? b.placed_on : [],
    cards: Number.isFinite(score.cards) ? score.cards : null,
    photos: Number.isFinite(score.photos) ? score.photos : (Array.isArray(b.credits) ? b.credits.length : 0),
  };
}

/** The shot of a kind, or null. */
export function shotOf(board, kind) {
  return (board?.shots || []).find((s) => s.kind === kind) || null;
}

/** The picture a tile or a waiting card shows, in a theme. Falls back so a tile is never blank. */
export function thumbFor(board, theme = 'light') {
  const want = theme === 'dark' ? ['desk-dark', 'board-dark', 'desk-light'] : ['desk-light', 'board-light', 'desk-dark'];
  for (const kind of [...want, 'wide', 'square']) {
    const s = shotOf(board, kind);
    if (s) return s.thumb_url || s.url;
  }
  const any = (board?.shots || []).find((s) => s.kind !== 'zip');
  return any ? any.thumb_url || any.url : null;
}

/** The detail view's big picture for a view (app | board | phone) and a theme. */
export function bigShot(board, view = 'app', theme = 'light') {
  const v = VIEWS.find((x) => x.id === view) || VIEWS[0];
  return shotOf(board, v[theme === 'dark' ? 'dark' : 'light']) || shotOf(board, v.light) || shotOf(board, v.dark);
}

/** The views this board has a shot for (the switch hides the rest). */
export function viewsFor(board) {
  return VIEWS.filter((v) => shotOf(board, v.light) || shotOf(board, v.dark));
}

/**
 * The detail view's download list: the full shots in a fixed order, the
 * close-ups folded into one group, the zip apart.
 * → { shots: [shot], closeUps: [shot], zip: shot | null }
 */
export function shotGroups(board) {
  const all = (board?.shots || []).filter((s) => s && s.url);
  const rank = (k) => { const i = SHOT_ORDER.indexOf(k); return i < 0 ? SHOT_ORDER.length : i; };
  return {
    shots: all.filter((s) => s.kind !== 'card' && s.kind !== 'zip').sort((a, b) => rank(a.kind) - rank(b.kind)),
    closeUps: all.filter((s) => s.kind === 'card'),
    zip: all.find((s) => s.kind === 'zip') || null,
  };
}

/** A download link: the signed shot url plus the name the browser saves it as. */
export function downloadUrl(board, shot) {
  if (!shot?.url) return null;
  const ext = (String(shot.file || '').split('.').pop() || 'png').toLowerCase();
  const name = shot.kind === 'zip' ? `${board.slug}-shots` : `${board.slug}-${String(shot.file || shot.kind).replace(/\.[a-z0-9]+$/i, '')}`;
  return `${shot.url}${shot.url.includes('?') ? '&' : '?'}dl=${encodeURIComponent(`${name}.${ext}`)}`;
}

/** "2880×1800", or the file size for a zip. */
export function sizeLabel(shot) {
  if (shot?.w && shot?.h) return `${shot.w}×${shot.h}`;
  const kb = Math.round((shot?.bytes || 0) / 1024);
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
}

/** Where the board is used: its search page, and its public page once it's live. */
export function usedOn(board) {
  const out = [];
  if (board.page_path) out.push({ label: 'Search page', path: board.page_path });
  for (const p of board.placed_on || []) if (p !== board.page_path) out.push({ label: 'Also on', path: p });
  if (board.live && board.slug) out.push({ label: 'Public page', path: `/c/${board.slug}` });
  return out;
}

/** The engine's checks, in words, from what it recorded. */
export function checkLines(board) {
  const s = board.score || {};
  const sources = [...new Set((board.credits || []).map((c) => c.source).filter(Boolean))];
  const lines = [];
  const n = board.photos || (board.credits || []).length;
  if (n) lines.push(`${n} photo${n === 1 ? '' : 's'}, every one passed the AI check`);
  if (Number.isFinite(s.rejected) && s.rejected > 0) lines.push(`${s.rejected} turned down on the way`);
  if (sources.length) lines.push(`Photos from ${sources.join(' and ')}, free to use · credits kept`);
  lines.push('Nothing overlaps, every card on the grid');
  lines.push('Notes readable on their colours');
  lines.push('No photo repeated from another board');
  if (Number.isFinite(s.grade)) lines.push(`Claude's look: ${s.grade} of 5 against the bar${s.tries > 1 ? ` (on try ${s.tries})` : ''}`);
  return lines;
}

/** Links out: the board in the app, the app in Capture Mode, and the live page. */
export function linksFor(board) {
  return {
    app: `/?to=b:${board.board_id}`,
    capture: `/?to=b:${board.board_id}&capture=1`,
    live: board.live && board.slug ? `/c/${board.slug}` : null,
  };
}

function matches(board, q) {
  if (!q) return true;
  const hay = lower([board.title, board.cluster, board.subject, board.page_path, board.slug, board.story].join(' '));
  return lower(q).split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

/** "today 6:04", "yesterday 6:00", "Oct 27 6:00" — the time in the viewer's zone. */
export function whenLabel(iso, now = new Date()) {
  const t = new Date(iso);
  if (!Number.isFinite(t.getTime())) return '';
  const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(now) - day(t)) / 86400000);
  const clock = `${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`;
  if (diff === 0) return `today ${clock}`;
  if (diff === 1) return `yesterday ${clock}`;
  if (diff === -1) return `tomorrow ${clock}`;
  return `${t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${clock}`;
}

/** "Oct 29". */
export function dayLabel(iso) {
  const t = new Date(iso);
  return Number.isFinite(t.getTime()) ? t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
}

/** The next 06:00 after now. */
export function nextRun(now = new Date()) {
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), ENGINE_HOUR, 0, 0, 0);
  if (t <= now) t.setDate(t.getDate() + 1);
  return t;
}

/**
 * The engine's line at the top: on and well, or quiet (no run for a day and a
 * half), or its last run failed.
 * → { tone: 'ok' | 'warn', text }
 */
export function engineState(lastRun, boards, now = new Date()) {
  const lastBoard = boards.reduce((m, b) => (!m || b.made_at > m ? b.made_at : m), null);
  const next = `next ${whenLabel(nextRun(now).toISOString(), now)}`;
  if (!lastRun) return { tone: 'warn', text: 'Engine not run yet', detail: next };
  const at = new Date(lastRun.finished_at || lastRun.started_at);
  const hours = (now - at) / 3600000;
  if (lastRun.finished_at && lastRun.ok === false) {
    return { tone: 'warn', text: 'Engine stuck', detail: `last run ${whenLabel(at.toISOString(), now)} didn't finish a board${lastRun.note ? `: ${String(lastRun.note).slice(0, 120)}` : ''}` };
  }
  if (hours > QUIET_HOURS) return { tone: 'warn', text: 'Engine quiet', detail: `nothing since ${whenLabel(at.toISOString(), now)}` };
  return { tone: 'ok', text: 'Engine on', detail: [lastBoard ? `last board ${whenLabel(lastBoard, now)}` : null, next].filter(Boolean).join(' · ') };
}

/**
 * The whole tab from one read.
 *   data: showcase_library()'s { boards, ok_by_person, last_run }
 *   filter: { q, cluster ('all' | name), theme ('both' | 'light' | 'dark'), onPage (bool) }
 */
export function libraryView(data, filter = {}, now = new Date()) {
  const boards = (data?.boards || []).map(normal).filter((b) => !b.trashed);
  const waiting = boards.filter((b) => b.status === 'new');
  const library = boards.filter((b) => b.status === 'ok');

  const counts = new Map();
  for (const b of library) counts.set(b.cluster, (counts.get(b.cluster) || 0) + 1);
  const clusters = [{ id: 'all', label: 'All', count: library.length },
    ...[...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => ({ id: name, label: name, count }))];

  const cluster = filter.cluster && filter.cluster !== 'all' && counts.has(filter.cluster) ? filter.cluster : 'all';
  const theme = ['light', 'dark'].includes(filter.theme) ? filter.theme : 'both';
  const searched = library.filter((b) => matches(b, filter.q));
  const onPageCount = searched.filter((b) => b.page_path).length;
  const tiles = searched
    .filter((b) => cluster === 'all' || b.cluster === cluster)
    .filter((b) => !filter.onPage || b.page_path)
    // "Both" mixes the grid, one light then one dark, so the two looks sit side by side.
    .map((b, i) => ({ ...b, thumb: thumbFor(b, theme === 'both' ? (i % 2 ? 'dark' : 'light') : theme) }));

  const okByPerson = Number(data?.ok_by_person) || 0;
  const shotCount = library.reduce((n, b) => n + b.shots.filter((s) => s.kind !== 'zip').length, 0);
  return {
    waiting: waiting.map((b) => ({ ...b, thumb: thumbFor(b, 'light') })),
    tiles,
    clusters,
    cluster,
    theme,
    onPageCount,
    totals: { boards: library.length, shots: shotCount },
    firstTen: { done: Math.min(okByPerson, HAND_OKS), of: HAND_OKS, finished: okByPerson >= HAND_OKS },
    engine: engineState(data?.last_run || null, boards, now),
  };
}

/** One board by id from the same read (the detail view), or null. */
export function boardById(data, id) {
  const b = (data?.boards || []).find((x) => x.board_id === id);
  return b ? normal(b) : null;
}
