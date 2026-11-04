// The Together chip's state for the open cluster: the room's messages
// (yPartyKit.js dispatches 'soleil-together') folded by togetherState.js.
import { useEffect, useState } from 'react';
import { togetherReduce, TOGETHER_OFF, TOGETHER_STALE_MS } from './togetherState.js';

export function useTogether(boardId) {
  const [state, setState] = useState(TOGETHER_OFF);
  const [, setTick] = useState(0);

  useEffect(() => {
    setState(TOGETHER_OFF);
    if (!boardId) return undefined;
    const onMsg = (e) => {
      const d = e?.detail;
      if (!d || d.boardId !== boardId) return;
      setState((prev) => togetherReduce(prev, d, Date.now()));
    };
    window.addEventListener('soleil-together', onMsg);
    return () => window.removeEventListener('soleil-together', onMsg);
  }, [boardId]);

  // Silence is how it ends when the room goes away: re-render once the last
  // message is stale so togetherShown can say no.
  const at = state.on ? state.at : 0;
  useEffect(() => {
    if (!at) return undefined;
    const t = setTimeout(() => setTick((n) => n + 1), TOGETHER_STALE_MS + 1000);
    return () => clearTimeout(t);
  }, [at]);

  return state;
}
