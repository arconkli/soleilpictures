// The shared clock's time, re-rendering on its tick (lib/minuteTick.js).
// `enabled` false: read it without listening, e.g. a message whose edit
// window has closed has nothing left to change.
import { useCallback, useSyncExternalStore } from 'react';
import { subscribeMinute, minuteNow } from '../lib/minuteTick.js';

const noop = () => () => {};

export function useMinuteNow(enabled = true) {
  const subscribe = useCallback((fn) => (enabled ? subscribeMinute(fn) : noop()), [enabled]);
  return useSyncExternalStore(subscribe, minuteNow, minuteNow);
}
