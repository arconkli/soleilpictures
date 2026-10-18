// One drop of desktop files onto a sidebar row, for a cluster this tab doesn't
// have open. App renders one at a time, keyed by the drop.
//
// It holds that cluster's doc for exactly as long as the files take. It opens
// the doc and pours the files in through the very same ingestFilesArranged a
// drop into Files uses (the cap dialog, held uploads, scripts and all). That
// promise settles only once every upload has finished or failed; then this
// writes card_index (what the sidebar reads for a cluster nobody has open) and
// reports done, App unmounts it, and useYBoard's own teardown lets the room go.
//
// Owning its doc is the point. The doc used to be App's, re-pointed from drop
// to drop and never torn down in between: it held a room open after its drop,
// a cluster you navigated into mid-drop lost the files, and a late teardown
// could write a stale snapshot over a version restore. It stays mounted until
// its own files are in, even if you open that cluster meanwhile — for that
// stretch the tab holds two handles on one room, which only costs a duplicate
// connection.

import { useEffect, useMemo, useRef } from 'react';
import { useYBoard } from '../../hooks/useYBoard.js';

// Past this the drop lets go regardless: a stalled upload stays pending on its
// card, where the abandoned-upload sweep finds it.
const MAX_HOLD_MS = 15 * 60_000;

export function BackgroundDrop({ drop, userId, userInfo, workspaceId, buildMutators, syncCardIndex, onDone }) {
  const yb = useYBoard(drop.boardId, userId, userInfo, workspaceId, true);
  const ydoc = yb.ready && yb.boardId === drop.boardId ? yb.ydoc : null;
  const mutators = useMemo(
    () => (ydoc ? buildMutators({ ydoc, boardId: drop.boardId, undoManager: yb.undoManager }) : null),
    // buildMutators is App's and new each render; the doc is what matters.
    [ydoc, drop.boardId, yb.undoManager],   // eslint-disable-line react-hooks/exhaustive-deps
  );
  const started = useRef(false);
  const latest = useRef({ syncCardIndex, onDone });
  latest.current = { syncCardIndex, onDone };

  useEffect(() => {
    if (!ydoc || !mutators || started.current) return;
    started.current = true;
    let finished = false;
    const finish = async () => {
      if (finished) return;
      finished = true;
      clearTimeout(cap);
      try { await latest.current.syncCardIndex({ boardId: drop.boardId, ydoc }); } catch (_) { /* the next open re-syncs */ }
      latest.current.onDone(drop);
    };
    const cap = setTimeout(finish, MAX_HOLD_MS);
    Promise.resolve()
      .then(() => mutators.ingestFilesArranged?.(drop.files))
      .catch((e) => console.warn('[sidebar] background drop failed', e?.message || e))
      .finally(finish);
  }, [ydoc, mutators, drop]);

  return null;
}
