import { useState, useCallback, useRef } from 'react';
import { listWorkspacePalettes } from '../lib/boardsApi.js';

// Lazy single-fetch of every palette card across the workspace, with a
// module-scoped cache so reopening pickers in the same session is instant.
const _cache = new Map();
const _inflight = new Map();

export function useWorkspacePalettes(workspaceId) {
  const [palettes, setPalettes] = useState(() => _cache.get(workspaceId) || []);
  const loadedFor = useRef(null);

  const ensureLoaded = useCallback(() => {
    if (!workspaceId) return;
    if (loadedFor.current === workspaceId) return;
    loadedFor.current = workspaceId;
    if (_cache.has(workspaceId)) {
      setPalettes(_cache.get(workspaceId));
      return;
    }
    let p = _inflight.get(workspaceId);
    if (!p) {
      p = listWorkspacePalettes(workspaceId).then(rows => {
        _cache.set(workspaceId, rows);
        _inflight.delete(workspaceId);
        return rows;
      });
      _inflight.set(workspaceId, p);
    }
    p.then(rows => { if (loadedFor.current === workspaceId) setPalettes(rows); });
  }, [workspaceId]);

  return { palettes, ensureLoaded };
}
