// On first sign-in, create the user's default workspace + Studio root board +
// seed the inbox. Subsequent sign-ins just return the existing workspace.

import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthGate.jsx';
import { getMyFirstWorkspace, createWorkspace, getRootBoard, createBoard } from '../lib/boardsApi.js';
import { seedInbox } from '../lib/inboxApi.js';
import { INBOX_SEED } from '../data.js';

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
        let firstRun = false;
        if (!root) {
          root = await createBoard({
            workspaceId: ws.id,
            parentBoardId: null,
            name: 'Studio',
            view: 'canvas',
            userId: user.id,
          });
          firstRun = true;
        }

        if (firstRun) {
          // Best-effort inbox seed so the first-run experience has draggable items.
          try { await seedInbox({ workspaceId: ws.id, items: INBOX_SEED, userId: null }); }
          catch (e) { console.warn('seedInbox failed (non-fatal)', e); }
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
