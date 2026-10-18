// The client half of extra storage: one call to the storage-addon edge
// function, and the words for each answer it can give. Every amount comes
// from the function's preview — Stripe's figures, never one computed here —
// and every refusal is the function's own decision (storageAddonCore).
//
// Held behind billingCopy STORAGE_ADDON_HELD until the owner creates the
// Stripe product and prices; until then nothing calls this.

import { supabase } from './supabase.js';
import { STORAGE_ADDON_BLOCK_LABEL, STORAGE_ADDON_HELD, STORAGE_ADDON_MAX_BLOCKS } from './billingCopy.js';

const ADDON_URL = (import.meta.env.VITE_SUPABASE_URL || '') + '/functions/v1/storage-addon';

async function call(body) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) return { ok: false, error: 'auth required' };
  let res;
  try {
    res = await fetch(ADDON_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (_) {
    return { ok: false, error: 'network' };
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, ...json, error: json.error || `http_${res.status}` };
  return json;
}

// What setting the subscription to `blocks` blocks would cost.
export function previewStorageAddon(blocks) {
  return call({ action: 'preview', blocks });
}

// Do it, at the preview's proration date, under a fresh per-click request id.
export function applyStorageAddon({ blocks, prorationDate }) {
  const requestId = globalThis.crypto?.randomUUID?.() ?? null;
  if (!requestId) return Promise.resolve({ ok: false, error: 'bad_request' });
  return call({ action: 'apply', blocks, proration_date: prorationDate, request_id: requestId });
}

// The words for a refusal or a failure. A code the function adds later falls
// through to the generic line rather than to its raw identifier.
export function storageAddonErrorMessage(answer) {
  switch (answer?.error) {
    case 'trial_active':
      return 'Extra storage can be added after your trial’s first payment.';
    case 'past_due':
      return 'Your last payment didn’t go through. Update your card in Manage billing, then add storage.';
    case 'cancel_pending':
      return 'Your plan is set to end. Resume it in Manage billing to add or remove storage.';
    case 'payment_pending':
      return 'A storage payment is still waiting to be finished. Check your email or Manage billing.';
    case 'over_usage':
      return `Your files take more room than you’d have without this ${STORAGE_ADDON_BLOCK_LABEL}. Delete some or empty the trash first.`;
    case 'bad_request':
      return `Extra storage goes up to ${STORAGE_ADDON_MAX_BLOCKS} × ${STORAGE_ADDON_BLOCK_LABEL}. For more, write to us.`;
    case 'rate_limited':
      return 'That’s a lot of changes in an hour — try again a little later.';
    case 'stale_preview':
      return 'The price was a few minutes old. Open this again for a fresh one.';
    case 'no_subscription':
    case 'contact_support':
    case 'quota_override':
    case 'schedule_attached':
    case 'discounted_subscription':
    case 'not_active':
      return 'Extra storage can’t be added to this plan here. Write to hello@clusters.soleilpictures.com and we’ll sort it out.';
    case 'not_configured':
      return 'Extra storage isn’t available yet.';
    case 'network':
      return 'Couldn’t reach billing. Check your connection and try again.';
    default:
      // A retry is always safe: the request names the TOTAL, so one that
      // already went through finds nothing to change and charges nothing.
      return 'Something went wrong with billing. Try again — you won’t be charged twice.';
  }
}

// The storage wall, for a paying owner: the toast that says the drive is full
// carries this action, and App opens the extra-storage sheet on the event. A
// toast action rather than a modal, because the list and canvas paths raise
// the wall once per refused FILE. Null while extra storage is held, so every
// caller falls back to the toast it already showed.
export const STORAGE_ADDON_OPEN_EVENT = 'clusters:storage-addon-open';
export function storageAddonAction(surface) {
  if (STORAGE_ADDON_HELD) return null;
  return {
    label: `Add ${STORAGE_ADDON_BLOCK_LABEL}`,
    onClick: () => window.dispatchEvent(new CustomEvent(STORAGE_ADDON_OPEN_EVENT, { detail: { surface } })),
  };
}

