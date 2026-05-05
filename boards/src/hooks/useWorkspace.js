// On first sign-in, create the user's default workspace + Studio root board.
// Subsequent sign-ins just return the existing workspace.

import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthGate.jsx';
import { getMyFirstWorkspace, createWorkspace, getRootBoard, createBoard } from '../lib/boardsApi.js';

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
        let ws = await getMyFirstWorkspace();
        if (!ws) {
          ws = await createWorkspace({ name: 'Soleil', userId: user.id });
        }

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
