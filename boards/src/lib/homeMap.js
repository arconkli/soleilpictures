// homeMap — Home as the universe's map (the files sidebar's Home, preview
// only; the owner's pick, 2026-10-19, "B": "i like B but with the workspace
// title at the top left"). The universe is the page: every cluster is a star
// with its name on it, a picked star opens a card beside it, a search lights
// the stars it finds and dims the rest. This module decides the parts that are
// rules rather than drawing — which stars get names and in what order they
// give way, what a search finds, where the card goes, how the camera is framed
// into the open space, and the line under the workspace's name — so node can
// test them.

const UNTITLED_RE = /^Untitled (cluster|list)$/i;

/** A cluster's name as Home shows it. */
export const clusterName = (b) => {
  const n = typeof b?.name === 'string' ? b.name.trim() : '';
  return n && !UNTITLED_RE.test(n) ? n : 'Untitled cluster';
};

const isLive = (b) => !!b && !b.deleted_at;
const isOwn = (b, workspaceId) =>
  isLive(b) && !b._shared && (workspaceId == null || b.workspace_id === workspaceId);

/**
 * The names on the stars: every live cluster in the workspace. The top of the
 * workspace (Studio) is 'root', its children 'top', anything deeper 'nested'.
 * Ids are the universe's node ids ('board:<id>'). A cluster whose parent is
 * gone (an orphan the universe drops) gets no name either.
 */
export function starLabels(boards, rootId, { workspaceId = null } = {}) {
  if (!boards || !rootId) return [];
  const out = [];
  for (const b of Object.values(boards)) {
    if (!isOwn(b, workspaceId)) continue;
    const kind = b.id === rootId ? 'root' : b.parent_board_id === rootId ? 'top' : 'nested';
    if (kind === 'nested' && !boards[b.parent_board_id]) continue;
    out.push({ id: `board:${b.id}`, boardId: b.id, name: clusterName(b), kind, parentId: b.parent_board_id || null });
  }
  return out;
}

// Accents and case don't decide a match: "cafe" finds "Café".
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * What a search finds: clusters whose name holds the query, those that start
 * with it first, then by the order they came in (the caller passes them newest
 * first). An empty query finds nothing — nothing dims until you type.
 */
export function findClusters(labels, query) {
  const q = fold(query);
  if (!q) return [];
  const starts = [];
  const holds = [];
  for (const l of labels || []) {
    const n = fold(l.name);
    if (n.startsWith(q)) starts.push(l.boardId);
    else if (n.includes(q)) holds.push(l.boardId);
  }
  return [...starts, ...holds];
}

// Which name gives way when two would overlap: the picked star's first, then
// the one pointed at, then what a search found, then the top, the clusters at
// the top level, and the ones inside them last.
const RANK = { selected: 0, hover: 1, hit: 2, root: 3, top: 4, nested: 5 };
export const labelRank = ({ kind, selected = false, hover = false, hit = false }) =>
  selected ? RANK.selected : hover ? RANK.hover : hit ? RANK.hit : (RANK[kind] ?? RANK.nested);

/**
 * The names that show. `items` are boxes in screen pixels with a rank (lower
 * keeps its place); a name that would cover one already placed is hidden, and
 * so is one off the open area. Returns the ids that show.
 */
export function visibleLabels(items, area = null, pad = 4) {
  const placed = [];
  const shown = new Set();
  const sorted = [...(items || [])].sort((a, z) => (a.rank - z.rank) || (a.y - z.y) || (a.x - z.x));
  for (const it of sorted) {
    if (area && (it.x < area.left || it.x + it.w > area.right || it.y < area.top || it.y + it.h > area.bottom)) continue;
    const hit = placed.some((p) => it.x < p.x + p.w + pad && p.x < it.x + it.w + pad && it.y < p.y + p.h + pad && p.y < it.y + it.h + pad);
    if (hit) continue;
    placed.push(it);
    shown.add(it.id);
  }
  return shown;
}

/**
 * Where a picked star's card goes: beside the star, on its right when the
 * card fits there, else on its left; centred on the star from top to bottom,
 * and kept inside the open area. `star` is the star's screen point, `card`
 * the card's size, `area` the open area's edges.
 */
export function cardPlacement(star, card, area, gap = 30) {
  const roomRight = area.right - (star.x + gap);
  const side = roomRight >= card.w || star.x - gap - card.w < area.left ? 'right' : 'left';
  let left = side === 'right' ? star.x + gap : star.x - gap - card.w;
  left = Math.max(area.left, Math.min(left, area.right - card.w));
  let top = star.y - card.h / 2;
  top = Math.max(area.top, Math.min(top, area.bottom - card.h));
  return { left: Math.round(left), top: Math.round(top), side };
}

/**
 * The camera's view offset that centres the universe in the open area: the
 * window less the sidebar on the left, the top bar above and the find bar
 * below. A positive x moves what the camera sees left, so the scene's centre
 * lands right of the window's centre by half the difference of the insets.
 */
export function viewOffset(insets) {
  const { left = 0, right = 0, top = 0, bottom = 0 } = insets || {};
  return { x: (right - left) / 2, y: (bottom - top) / 2 };
}

/**
 * The line under the workspace's name: whose it is, how many people are in
 * it (left out when it's only you), and when anything in it last changed
 * (`when`, already worded, e.g. "2h ago").
 */
export function workspaceLine({ workspace, personalWorkspaceId = null, selfUserId = null, memberCount = 0, when = '' } = {}) {
  if (!workspace) return '';
  const whose = workspace.id === personalWorkspaceId ? 'Your personal workspace'
    : workspace.created_by === selfUserId ? 'Your workspace'
    : workspace._myRole === 'coowner' ? 'You co-own this'
    : 'Shared with you';
  const parts = [whose];
  if (memberCount > 1) parts.push(`${memberCount} people`);
  if (when) parts.push(when === 'Just now' ? 'updated just now' : `updated ${when}`);
  return parts.join(' · ');
}
