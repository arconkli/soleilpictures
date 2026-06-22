import { useEffect, useRef } from 'react';
import { CanvasPresence } from '../components/CanvasPresence.jsx';
import { PresenceStack } from '../components/PresenceStack.jsx';
import { makeFakeAwareness, makePresenceTestBridge } from '../lib/presenceQa.js';

// Dev-only presence QA harness (?presenceqa=1). Mounts the REAL <CanvasPresence>
// against a fake awareness so tests/presence-collab.spec.js can inject many
// synthetic peers and assert the cull / cap / no-storm guarantees on actual
// rendered DOM. Dropped from production by main.jsx's import.meta.env.DEV guard.
export function PresenceQaHarness() {
  const awRef = useRef(null);
  if (!awRef.current) awRef.current = makeFakeAwareness();
  // Stable callbacks — CanvasPresence's effect deps include getAwareness, so a
  // fresh arrow each render would needlessly re-subscribe.
  const getAwarenessRef = useRef(() => awRef.current);
  const getCardByIdRef = useRef((id) => ({ id, x: 80, y: 80, w: 200, h: 120 }));
  const boardId = 'qa-board';

  useEffect(() => {
    window.__soleilPresenceTest = makePresenceTestBridge({ aw: awRef.current, boardId });
    const root = document.getElementById('root');
    if (root) root.setAttribute('data-presenceqa-ready', '1');
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0a0a0c' }}>
      <CanvasPresence
        getAwareness={getAwarenessRef.current}
        boardId={boardId}
        pan={{ x: 0, y: 0 }}
        zoom={1}
        selfId={'self'}
        getCardById={getCardByIdRef.current}
      />
      <div className="canvas-presence-roster">
        <PresenceStack getAwareness={getAwarenessRef.current} />
      </div>
    </div>
  );
}
