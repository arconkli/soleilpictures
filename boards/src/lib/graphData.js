import { supabase } from './supabase.js';

// Assemble nodes + edges arrays for the home graph from boards + card_index +
// doc_backlinks. Used by HomeGraph.
//
// Returns { nodes: [...], links: [...] }.
//   Nodes: { id: 'kind:rest', kind, name, color, val (size) }
//   Links: { source: nodeId, target: nodeId, kind: 'semantic' | 'structural' }
//
// Options:
//   structural — bool. When true, also emits implicit board↔child-board and
//                board↔card edges. When false (default), only emits semantic
//                edges from doc_backlinks and filters out unconnected nodes.
export async function assembleGraph({ workspaceId, options = {} }) {
  if (!supabase || !workspaceId) return { nodes: [], links: [] };

  const { data: rawBoards = [] } = await supabase.from('boards')
    .select('id,name,parent_board_id,workspace_id')
    .eq('workspace_id', workspaceId);

  const { data: cards = [] } = await supabase.from('card_index')
    .select('board_id,card_id,kind,title,meta')
    .eq('workspace_id', workspaceId);

  const { data: bls = [] } = await supabase.from('doc_backlinks')
    .select('*')
    .eq('source_workspace_id', workspaceId);

  // Reachability filter — only include boards that can be reached by
  // walking parent_board_id from a root (parent_board_id IS NULL),
  // matching what the sidebar tree shows. The boards table can
  // accumulate orphans: rows whose parent chain dead-ends because a
  // mid-tree board got deleted, or rows whose parent_board_id points
  // at a row from a different workspace. Those are invisible in the
  // sidebar but used to appear in the graph as ghost "Untitled" planets,
  // and an auto-reconcile effect in App.jsx re-creates board cards
  // for them every time their parent is opened. Drop them here so
  // the graph reflects the user's mental model of "what boards exist."
  const allById = new Map(rawBoards.map(b => [b.id, b]));
  const reachable = new Set();
  for (const b of rawBoards) {
    if (b.parent_board_id == null) reachable.add(b.id);
  }
  // Iterate to fixpoint — children of reachable parents become reachable.
  let changed = true;
  while (changed) {
    changed = false;
    for (const b of rawBoards) {
      if (reachable.has(b.id)) continue;
      if (b.parent_board_id && reachable.has(b.parent_board_id)) {
        reachable.add(b.id);
        changed = true;
      }
    }
  }
  const orphans = rawBoards.filter(b => !reachable.has(b.id));
  if (orphans.length && typeof window !== 'undefined' && window.__SOLEIL_GRAPH_DEBUG__ !== false) {
    console.warn(`%c[graph]`, 'color:#a3854b;font-weight:600',
      `dropping ${orphans.length} orphan board${orphans.length === 1 ? '' : 's'} (parent chain doesn't reach a root):`,
      orphans.map(b => ({ id: b.id, name: b.name || '(empty)', parent_board_id: b.parent_board_id })));
  }
  const boards = rawBoards.filter(b => reachable.has(b.id));

  // Build a set of live board IDs so we can drop ANY card_index row
  // whose board_id no longer resolves to an actual reachable board.
  const liveBoardIds = new Set(boards.map(b => b.id));
  const liveCards = cards.filter(c => liveBoardIds.has(c.board_id));
  // For board/boardlink cards, also confirm the *target* board still
  // exists AND is reachable. card_index.meta.boardId points at the
  // linked board for these kinds (built by buildCardMeta in boardsApi.js).
  const liveCardsResolved = liveCards.filter(c => {
    if (c.kind !== 'board' && c.kind !== 'boardlink') return true;
    const targetId = c?.meta?.boardId;
    if (!targetId) return false;
    return liveBoardIds.has(targetId);
  });

  const nodes = new Map();
  // `kind` is the node's broad category (board/doc/card/url) used by the
  // home-graph filter. `cardKind` is the underlying card sub-type
  // (note/image/palette/link/...) — surfaced so the renderer can give
  // each card a distinct planetary color.
  const add = (id, kind, name, val = 8, cardKind = null) => {
    if (!nodes.has(id)) {
      const colorKey = cardKind || kind;
      nodes.set(id, {
        id, kind, cardKind, name: name || 'Untitled',
        color: COLOR[colorKey] || COLOR[kind] || COLOR.card,
        val,
      });
    }
  };

  for (const b of boards) add(`board:${b.id}`, 'board', b.name, 14);

  // Embedded-board (`kind: 'board'`) and boardlink (`kind: 'boardlink'`)
  // cards are NOT added as separate nodes. The drawer used to render
  // them as small "Untitled" yellow planets because their title field
  // is empty (syncCardIndex reads card-local fields, not the
  // underlying board's name) and clicking them said "Board" — which
  // looked like phantom boards but were actually embed/link cards
  // that double-referenced an existing board. We surface the
  // host→target relationship as a board:→board: structural edge
  // below instead. Other card kinds (note/image/palette/link/doc)
  // still get their own nodes.
  const skippedEmbeds = [];
  for (const c of liveCardsResolved) {
    if (c.kind === 'board' || c.kind === 'boardlink') {
      skippedEmbeds.push(c);
      continue;
    }
    const isDoc = c.kind === 'doc';
    add(`card:${c.board_id}:${c.card_id}`, isDoc ? 'doc' : 'card', c.title, isDoc ? 12 : 8, c.kind || 'note');
  }
  if (skippedEmbeds.length && typeof window !== 'undefined' && window.__SOLEIL_GRAPH_DEBUG__ !== false) {
    console.log(`%c[graph]`, 'color:#a3854b;font-weight:600',
      `skipped ${skippedEmbeds.length} embedded-board card${skippedEmbeds.length === 1 ? '' : 's'} (host→target rendered as edge instead of a duplicate node)`);
  }

  const links = [];

  // Semantic edges from doc_backlinks (the "real" linking graph).
  for (const bl of bls) {
    // Source is the doc card the link lives in.
    const src = `card:${bl.source_doc_card_id}`;
    let tgt = null;
    if (bl.target_kind === 'board') tgt = `board:${bl.target_board_id}`;
    else if (bl.target_kind === 'doc') tgt = `card:${bl.target_doc_card_id}`;
    else if (bl.target_kind === 'docPos') tgt = `card:${bl.target_doc_card_id}`;
    else if (bl.target_kind === 'card') tgt = `card:${bl.target_board_id}:${bl.target_card_id}`;
    else if (bl.target_kind === 'url') {
      const id = `url:${bl.target_url}`;
      let host = bl.target_url;
      try { host = new URL(bl.target_url).hostname; } catch {}
      add(id, 'url', host, 6);
      tgt = id;
    }
    if (tgt && nodes.has(src) && nodes.has(tgt)) {
      links.push({ source: src, target: tgt, kind: 'semantic' });
    }
  }

  if (options.structural) {
    for (const b of boards) {
      if (!b.parent_board_id) continue;
      const s = `board:${b.parent_board_id}`, t = `board:${b.id}`;
      if (nodes.has(s) && nodes.has(t)) links.push({ source: s, target: t, kind: 'structural' });
    }
    // Per-card edges. Skip embed/link cards — we collapse those into
    // a board→target edge below so the graph doesn't double-count
    // the relationship.
    for (const c of liveCardsResolved) {
      if (c.kind === 'board' || c.kind === 'boardlink') continue;
      const s = `board:${c.board_id}`, t = `card:${c.board_id}:${c.card_id}`;
      if (nodes.has(s) && nodes.has(t)) links.push({ source: s, target: t, kind: 'structural' });
    }
    // Embed / boardlink cards: instead of host→card→target (which
    // produced ghost intermediate nodes), draw a single host→target
    // structural edge, dedup'd in case the host has multiple embeds
    // pointing at the same board.
    const seenHostTarget = new Set();
    for (const c of skippedEmbeds) {
      const targetId = c?.meta?.boardId;
      if (!targetId) continue;
      const s = `board:${c.board_id}`, t = `board:${targetId}`;
      if (s === t) continue; // a board embedding itself would be a self-loop
      const key = `${s}→${t}`;
      if (seenHostTarget.has(key)) continue;
      seenHostTarget.add(key);
      if (nodes.has(s) && nodes.has(t)) links.push({ source: s, target: t, kind: 'structural' });
    }
    return { nodes: [...nodes.values()], links };
  }

  // Default mode: drop nodes that have no semantic edges so the graph stays sparse.
  const used = new Set();
  for (const l of links) { used.add(l.source); used.add(l.target); }
  return {
    nodes: [...nodes.values()].filter(n => used.has(n.id)),
    links,
  };
}

// Each entity gets its own distinct planet color. Tuned so they
// read clearly against the dark canvas while still feeling like
// they belong to the same warm/earthy family. Order — boards are
// the brightest "stars", docs are pale moons, and the various
// card sub-kinds get their own planetary hues.
const COLOR = {
  board:     '#ffa500',  // sun — Soleil brand gold
  doc:       '#f1d9a3',  // pale cream moon
  // Card sub-kinds:
  note:      '#cf6a4f',  // mars — terracotta
  image:     '#7c5cc9',  // jovian violet
  palette:   '#3fa39a',  // teal seafoam
  link:      '#5b8fc7',  // neptune blue
  board_:    '#c4a96b',  // dust gold (embedded board)
  boardlink: '#c4a96b',
  doc_card:  '#e6c98a',  // warm doc satellite
  // Fallbacks
  card:      '#7c8a98',  // cool slate
  url:       '#8c7a55',  // ink-3 (warmed)
};
