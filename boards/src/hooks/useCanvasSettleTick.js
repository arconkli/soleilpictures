// Re-render a component once per canvas zoom/pan SETTLE (the 140ms commit
// after a wheel/pinch gesture — see lib/canvasScale.js). Components that pick
// a render tier from getCanvasScale() subscribe here EXPLICITLY instead of
// riding parent re-renders, so a future memo() wrap can't silently freeze
// their zoom reactivity (the imageTierScheduler pattern, as a hook).
import { useEffect, useState } from 'react';
import { onCanvasSettle } from '../lib/canvasScale.js';

export function useCanvasSettleTick() {
  const [, setTick] = useState(0);
  useEffect(() => onCanvasSettle(() => setTick((t) => t + 1)), []);
}
