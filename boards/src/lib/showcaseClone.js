// showcaseClone.js — decode the source "Clusters Logo" brand board snapshot
// (returned by the prepare_showcase RPC) into seed cards for welcome_showcase
// arm B. The cards keep their real r2:<key> image refs + positions, so the new
// user's canvas is a faithful copy of the brand board — prepare_showcase has
// already granted this user's board cross-workspace read on those images, so
// they resolve via the normal sign-reads path.
//
// Every card is stamped seed:true (excluded from activation / card_placed — see
// firstValueTrigger.isSeedCard) + showcase:true (what the one-click "Clear & try
// it yourself" banner targets — see ShowcaseBanner + CanvasSurface).

import * as Y from 'yjs';
import { b64ToBytes, readCards } from './yhelpers.js';

// Self-contained kinds only. Defensive — the source board is note/image/palette,
// but never clone board/boardlink/doc cards: their ids/content point at the
// source workspace's boards or per-card doc stores the new user can't read.
const CLONE_KINDS = new Set(['note', 'image', 'palette', 'shape', 'link']);

// Decode a base64 Y.Doc snapshot into a stamped, filtered cards array. Returns
// [] on any decode failure so the caller can fall back to standard onboarding.
export function decodeShowcaseCards(snapshotB64) {
  if (!snapshotB64 || typeof snapshotB64 !== 'string') return [];
  let cards = [];
  try {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, b64ToBytes(snapshotB64));
    cards = readCards(doc);
    doc.destroy();
  } catch (_) {
    return [];
  }
  return (cards || [])
    .filter((c) => c && CLONE_KINDS.has(c.kind))
    .map((c) => ({ ...c, seed: true, showcase: true }));
}
