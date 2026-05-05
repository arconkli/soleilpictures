import { useCallback, useEffect, useState } from 'react';

const PREFIX = 'soleil.boards.recents.';
const MAX = 5;

function readRecents(workspaceId) {
  if (!workspaceId || typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PREFIX + workspaceId);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX) : [];
  } catch (_) { return []; }
}

function writeRecents(workspaceId, ids) {
  if (!workspaceId || typeof localStorage === 'undefined') return;
  try { localStorage.setItem(PREFIX + workspaceId, JSON.stringify(ids.slice(0, MAX))); }
  catch (_) {}
}

// Per-workspace ring of last-N opened board ids. `push` moves an id to the
// front, dedupes, and trims to MAX.
export function useRecents(workspaceId) {
  const [recents, setRecents] = useState(() => readRecents(workspaceId));

  // Re-load when workspace changes.
  useEffect(() => { setRecents(readRecents(workspaceId)); }, [workspaceId]);

  const push = useCallback((boardId) => {
    if (!boardId) return;
    setRecents(prev => {
      const next = [boardId, ...prev.filter(id => id !== boardId)].slice(0, MAX);
      writeRecents(workspaceId, next);
      return next;
    });
  }, [workspaceId]);

  // Drop ids that no longer exist in the workspace's board map.
  const prune = useCallback((existingIds) => {
    setRecents(prev => {
      const set = new Set(existingIds);
      const next = prev.filter(id => set.has(id));
      if (next.length !== prev.length) writeRecents(workspaceId, next);
      return next;
    });
  }, [workspaceId]);

  return { recents, push, prune };
}
