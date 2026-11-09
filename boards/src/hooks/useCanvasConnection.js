// The open cluster's connection for the canvas (lib/canvasConnection.js): one
// watcher per doc, for as long as the board is open.

import { useEffect, useState } from 'react';
import { watchCanvasConnection } from '../lib/canvasConnection.js';

const NOTHING = Object.freeze({ state: 'live', pending: false, kept: true, live: false, liveSince: null, everLive: false });

export function useCanvasConnection(ydoc, boardId) {
  const [conn, setConn] = useState(NOTHING);
  useEffect(() => {
    if (!ydoc || !boardId) { setConn(NOTHING); return undefined; }
    const w = watchCanvasConnection({ ydoc, boardId, onChange: setConn });
    setConn(w.get());
    return () => w.dispose();
  }, [ydoc, boardId]);
  return conn;
}
