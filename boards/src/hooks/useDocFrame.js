import { useSyncExternalStore } from 'react';
import { NO_FRAME } from '../lib/docFrame.js';

// The open doc's frame (lib/docFrame.js) as the header sees it: re-renders when
// the surface publishes a change. No frame reads as nothing to switch.
const noSubscribe = () => () => {};
const noFrame = () => NO_FRAME;

export function useDocFrame(frame) {
  return useSyncExternalStore(frame ? frame.subscribe : noSubscribe, frame ? frame.get : noFrame, noFrame);
}
