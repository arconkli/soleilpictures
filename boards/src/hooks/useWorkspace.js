// On first sign-in, get-or-create the user's personal workspace.
// Atomic via the get_or_create_personal_workspace RPC — that takes a
// per-user advisory lock so duplicate StrictMode / concurrent-mount
// effect fires can't create duplicate "Soleil" workspaces.

import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthGate.jsx';
import { getOrCreatePersonalWorkspace, getRootBoard } from '../lib/boardsApi.js';

export function useWorkspace() {
  const { user } = useAuth();
  const [state, setState] = useState({ loading: true, workspace: null, rootBoard: null, error: null });

  useEffect(() => {
    if (!user) {
      setState({ loading: false, workspace: null, rootBoard: null, error: null });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // The RPC now returns BOTH the workspace and a guaranteed root
        // board id (creating either if missing) in one security-definer
        // transaction — no client-side createBoard fallback needed.
        const { workspace: ws, rootBoardId } = await getOrCreatePersonalWorkspace({ userId: user.id });
        if (!ws) throw new Error('personal workspace bootstrap returned nothing');
        // Hydrate the root board row (RLS now passes because the user is
        // a member of the workspace).
        let root = null;
        if (rootBoardId) {
          // Best-effort hydrate from Postgres so callers get the full row.
          root = await getRootBoard(ws.id);
        }

        if (cancelled) return;
        setState({ loading: false, workspace: ws, rootBoard: root, error: null });
      } catch (error) {
        console.error('useWorkspace', error);
        if (cancelled) return;
        setState({ loading: false, workspace: null, rootBoard: null, error });
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  return state;
}
