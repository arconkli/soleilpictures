import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { getProfilesByIds } from '../lib/boardsApi.js';
import { cssColor } from '../lib/presenceCss.js';

// Who owns each workspace that isn't yours, for telling same-named workspaces
// apart. member_profiles only covers workspace mates, so some owners come back
// unknown; those workspaces are left out of the map.
//
// userId -> { name, color } | null (looked up, nothing known). Module-level so
// the menu remounting on every open never refetches.
const profiles = new Map();
const inflight = new Map();   // userId -> Promise, shared by concurrent mounts

function toProfile(p) {
  if (!p) return null;
  const name = typeof p.display_name === 'string' ? p.display_name.trim() : '';
  // cssColor falls back to a default orange for bad input; only a real colour counts.
  const color = typeof p.color === 'string' && cssColor(p.color) === p.color ? p.color : null;
  return name || color ? { name: name || null, color } : null;
}

function fetchProfiles(ids) {
  const need = ids.filter((id) => !profiles.has(id) && !inflight.has(id));
  if (need.length) {
    const req = getProfilesByIds(need)
      .then((m) => { need.forEach((id) => profiles.set(id, toProfile(m.get(id)))); })
      .catch(() => {})
      .finally(() => { need.forEach((id) => inflight.delete(id)); });
    need.forEach((id) => inflight.set(id, req));
  }
  const waits = ids.map((id) => inflight.get(id)).filter(Boolean);
  return waits.length ? Promise.all(waits) : null;   // null: everything was cached
}

export function useWorkspaceOwners(workspaces, selfId) {
  const [version, setVersion] = useState(0);
  const ownerIds = useMemo(() => {
    const ids = new Set();
    (workspaces || []).forEach((w) => {
      if (w?.created_by && w.created_by !== selfId) ids.add(w.created_by);
    });
    return [...ids].sort();
  }, [workspaces, selfId]);
  const idsKey = ownerIds.join(',');

  useEffect(() => {
    if (!supabase || !selfId || !ownerIds.length) return undefined;
    let live = true;
    const pending = fetchProfiles(ownerIds);
    if (pending) pending.then(() => { if (live) setVersion((v) => v + 1); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, selfId]);

  return useMemo(() => {
    const out = new Map();
    if (!supabase || !selfId) return out;
    (workspaces || []).forEach((w) => {
      const id = w?.created_by;
      if (!id || id === selfId) return;
      const p = profiles.get(id);
      if (p) out.set(w.id, { id, name: p.name, color: p.color });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaces, selfId, version]);
}
