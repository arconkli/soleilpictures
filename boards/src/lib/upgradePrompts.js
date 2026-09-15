// upgradePrompts — the one writer for profiles.settings.upgrade_prompts.
//
// Two things made this necessary, and both were live bugs:
//
//   1. merge_profile_settings (0047) merges at the TOP level only. Writing
//      { upgrade_prompts: { price_seen_at } } therefore REPLACES the whole
//      upgrade_prompts object, taking first_value_shown_at with it and
//      re-arming a once-per-account banner for everyone it had already been
//      spent on. Spreading a locally-held copy of the object is only a fix if
//      that copy is current — and the chip's copy is `{}` until an async
//      profile read resolves, which it loses the race to.
//   2. Four surfaces can be the first to show a price, but only one of them
//      held that local copy, so the other three burned the shared device latch
//      without ever writing the durable stamp. Whichever fired first
//      permanently prevented the stamp from being written at all.
//
// So: every write goes through here, every write RE-READS first, and the
// writes are serialised in a module-scope chain so two surfaces racing in the
// same commit cannot clobber one another. Failure is swallowed — a missing
// stamp costs one duplicate prompt, never a broken render.

import { getOwnProfile, updateOwnSettings } from './boardsApi.js';
import { isGalleryActive } from './galleryState.js';

let chain = Promise.resolve();

// Merge `patch` into settings.upgrade_prompts, preserving every sibling key.
// Returns a promise that resolves when this write has landed (or failed); the
// caller does not need to await it.
export function stampUpgradePrompt(patch) {
  if (!patch || typeof patch !== 'object') return chain;
  // A preview must not stamp the admin's own profile. price_seen_at is written
  // once per account for the lifetime of the account, so one look at the
  // pricing modal in the gallery would spend it permanently and silently.
  if (isGalleryActive()) return chain;
  chain = chain.then(async () => {
    let prev = {};
    try {
      const p = await getOwnProfile();
      const cur = p?.settings?.upgrade_prompts;
      if (cur && typeof cur === 'object' && !Array.isArray(cur)) prev = cur;
    } catch (_) { /* a failed read must not drop the write */ }
    try {
      await updateOwnSettings({ upgrade_prompts: { ...prev, ...patch } });
    } catch (_) { /* best-effort */ }
  }).catch(() => {});
  return chain;
}

// Read the object once, for callers that need to decide whether to act.
// Returns {} on any failure, which reads as "nothing has been shown yet" —
// the safe direction, since showing a prompt twice is cheaper than a crash.
export async function readUpgradePrompts() {
  try {
    const p = await getOwnProfile();
    const cur = p?.settings?.upgrade_prompts;
    return (cur && typeof cur === 'object' && !Array.isArray(cur)) ? cur : {};
  } catch (_) {
    return {};
  }
}

// Test seam: reset the serialisation chain between cases.
export function __resetUpgradePrompts() { chain = Promise.resolve(); }
