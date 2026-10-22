// Who is on each cluster of the workspace right now, for the card of a
// cluster picked on the files sidebar's Home (components/home/ClustersHome.jsx,
// preview only). Pure: App hands in workspace presence and the board map.

// Who is in the workspace right now and where: one row a person, you left
// out, a tab that isn't in front skipped (as the sidebar's presence dots skip
// it). where is "In <cluster>" when they're on one the map knows.
//   peers: useWorkspacePresence's peers ({ user: { id, … }, location })
//   nameOf(peer) → a label or ''
export function hereNow(peers, boards, { selfId = null, nameOf = () => '' } = {}) {
  const seen = new Set();
  const out = [];
  for (const p of peers || []) {
    const id = p?.user?.id;
    if (!id || id === selfId || seen.has(id)) continue;
    if (p?.location?.isActive === false) continue;
    seen.add(id);
    const bid = p?.location?.boardId;
    const board = bid ? boards?.[bid] : null;
    const name = nameOf(p) || 'Someone';
    out.push({
      id,
      name,
      initial: name.charAt(0).toUpperCase(),
      where: board ? `In ${(board.name && board.name.trim()) || 'Untitled cluster'}` : 'Here now',
      loc: p.location || null,
    });
  }
  return out;
}
