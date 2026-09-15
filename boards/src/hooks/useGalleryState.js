// React binding for the galleryState module.
//
// galleryState.js stays React-free on purpose — it is read from hot paths (the
// analytics stamp, claimUpsellSlot, startCheckout) that must not import React,
// and from `node --test`. This is the one adapter, kept here so there is
// exactly one subscription shape and no component grows its own listener.
// Mirrors hooks/useCaptureState.js.
//
// getGalleryState() returns a frozen object whose identity changes only on a
// real change, which is precisely the useSyncExternalStore contract.
import { useSyncExternalStore } from 'react';
import { subscribe, getGalleryState, isGalleryActive } from '../lib/galleryState.js';

export function useGalleryState() {
  return useSyncExternalStore(subscribe, getGalleryState, getGalleryState);
}

// Narrow read for leaves that only care whether the gallery owns the screen.
export function useGalleryActive() {
  return useSyncExternalStore(subscribe, isGalleryActive, isGalleryActive);
}
