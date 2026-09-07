// React binding for the captureState module.
//
// captureState.js stays React-free on purpose — it is read from hot paths
// (toast(), the analytics stamp, getCanvasScale) that must not import React,
// and from `node --test`. This is the one adapter, kept here so there is
// exactly one subscription shape and no component grows its own listener.
//
// getCaptureState() returns a frozen object whose identity changes only on a
// real change, which is precisely the useSyncExternalStore contract.
import { useSyncExternalStore } from 'react';
import { subscribe, getCaptureState, isCaptureActive } from '../lib/captureState.js';

export function useCaptureState() {
  return useSyncExternalStore(subscribe, getCaptureState, getCaptureState);
}

// Narrow read for components that only care whether the mode is on at all.
// Re-renders on any capture change, so prefer it in small leaves rather than
// in a component that renders the card tree.
export function useCaptureActive() {
  return useSyncExternalStore(subscribe, isCaptureActive, isCaptureActive);
}
