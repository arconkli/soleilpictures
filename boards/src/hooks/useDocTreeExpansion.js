import { useRef, useState } from 'react';

// Which pages of a doc's page list are folded, kept on this device. A fold used
// to be the page's `expanded` flag in the doc everyone shares, so folding the
// list folded it for everyone in the doc, and ⌘Z "undid" it. That flag is now
// only where a page starts out: one an older tab folded starts folded here
// until it is unfolded here. One record per doc, under its cluster and its
// card (a doc shared on its own has its card for a cluster).
const keyOf = (boardId, cardId) => `soleil.docTree.v1:${boardId || '-'}:${cardId || 'doc'}`;

function load(key) {
  try {
    const v = JSON.parse(window.localStorage.getItem(key) || 'null');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch (_) { return {}; }
}

export function useDocTreeExpansion(boardId, cardId) {
  const key = keyOf(boardId, cardId);
  const [saved, setSaved] = useState(() => ({ key, open: load(key) }));
  const now = saved.key === key ? saved : { key, open: load(key) };
  if (now !== saved) setSaved(now);
  const latest = useRef(now);
  latest.current = now;
  return {
    isOpen: (p) => (typeof now.open[p.id] === 'boolean' ? now.open[p.id] : p.expanded !== false),
    setOpen: (id, value) => {
      const next = { key, open: { ...latest.current.open, [id]: !!value } };
      latest.current = next;
      try { window.localStorage.setItem(key, JSON.stringify(next.open)); } catch (_) {}
      setSaved(next);
    },
  };
}
