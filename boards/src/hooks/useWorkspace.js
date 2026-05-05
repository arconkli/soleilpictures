// On first sign-in, get-or-create the user's personal workspace.
// Atomic via the get_or_create_personal_workspace RPC — that takes a
// per-user advisory lock so duplicate StrictMode / concurrent-mount
// effect fires can't create duplicate "Soleil" workspaces.

import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthGate.jsx';
import { getOrCreatePersonalWorkspace, getRootBoard, createBoard } from '../lib/boardsApi.js';

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
        const ws = await getOrCreatePersonalWorkspace({ userId: user.id });

        // RPC creates a Studio root the first time, but if the user later
        // deleted theirs (from a different workspace) and we re-enter, the
        // workspace exists with no root. Be defensive.
        let root = await getRootBoard(ws.id);
        if (!root) {
          root = await createBoard({
            workspaceId: ws.id,
            parentBoardId: null,
            name: 'Studio',
            view: 'canvas',
            userId: user.id,
          });
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
