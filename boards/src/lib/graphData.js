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

  const { data: boards = [] } = await supabase.from('boards')
    .select('id,name,parent_board_id')
    .eq('workspace_id', workspaceId);

  const { data: cards = [] } = await supabase.from('card_index')
    .select('board_id,card_id,kind,title')
    .eq('workspace_id', workspaceId);

  const { data: bls = [] } = await supabase.from('doc_backlinks')
    .select('*')
    .eq('source_workspace_id', workspaceId);

  const nodes = new Map();
  const add = (id, kind, name, val = 8) => {
    if (!nodes.has(id)) {
      nodes.set(id, { id, kind, name: name || 'Untitled', color: COLOR[kind] || COLOR.card, val });
    }
  };
  for (const b of boards) add(`board:${b.id}`, 'board', b.name, 14);
  for (const c of cards) {
    const isDoc = c.kind === 'doc';
    add(`card:${c.board_id}:${c.card_id}`, isDoc ? 'doc' : 'card', c.title, isDoc ? 12 : 8);
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
    for (const c of cards) {
      const s = `board:${c.board_id}`, t = `card:${c.board_id}:${c.card_id}`;
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

const COLOR = {
  board: '#d4a04a',  // soleil-gold
  doc:   '#e8d4a8',  // warm cream
  card:  '#6b8090',  // cool slate
  url:   '#5b574e',  // ink-3
};
