// storageAddonCore — the pure half of the storage-addon edge function.
//
// Plain ESM, no Deno APIs, no npm deps, so the same file runs in the edge
// bundle and under `node --test` (boards/src/lib/storageAddon.test.mjs), the
// pattern activateCore.mjs set. The function fetches; this decides. Everything
// here moves money or a drive, so change nothing without a test.
//
// What is sold (owner decision 2026-10-17): extra storage in blocks of
// app_config storage_addon.block_bytes (1 TiB), a second item on the Creator
// subscription whose quantity is the number of blocks, at the Creator item's
// own interval, up to storage_addon.max_blocks. The drive counts the blocks
// while the subscription entitles (0415 _storage_addon_blocks).

import { subscriptionItems } from "./activateCore.mjs";

// What one block costs, per interval, in the currency's minor unit. The
// Stripe price must say exactly this or the function refuses to sell
// (`price_mismatch`): a price edited in the dashboard must never charge an
// amount the sheet did not show. billingCopy PRICING.storage states the same
// figures to the reader; storageAddon.test.mjs holds the two in lockstep.
export const STORAGE_ADDON_UNIT_AMOUNT = { month: 2500, year: 24000 };
export const STORAGE_ADDON_CURRENCY = "usd";

// The storage price that matches the plan's own interval — classic billing
// keeps one interval per subscription, so a monthly plan takes the monthly
// block and an annual plan the annual one.
export function storagePriceIdFor(creatorItem, cfg) {
  const r = creatorItem?.price?.recurring;
  if (!r || (r.interval_count ?? 1) !== 1) return null;
  if (r.interval === "month") return cfg?.storagePrices?.monthly ?? null;
  if (r.interval === "year") return cfg?.storagePrices?.annual ?? null;
  return null;
}

// Does the Stripe price say what we sell?
export function priceMatches(price, creatorItem, cfg) {
  const r = price?.recurring;
  const cr = creatorItem?.price?.recurring;
  if (!price || !price.active || !r || !cr) return false;
  const product = typeof price.product === "string" ? price.product : price.product?.id ?? null;
  if (!cfg?.storageProduct || product !== cfg.storageProduct) return false;
  if (r.interval !== cr.interval || (r.interval_count ?? 1) !== (cr.interval_count ?? 1)) return false;
  if ((r.usage_type ?? "licensed") !== "licensed") return false;
  const currency = String(price.currency || "").toLowerCase();
  if (currency !== STORAGE_ADDON_CURRENCY) return false;
  if (currency !== String(creatorItem.price.currency || "").toLowerCase()) return false;
  return price.unit_amount === STORAGE_ADDON_UNIT_AMOUNT[r.interval];
}

// The block count asked for: a whole number from 0 to the maximum, or null.
export function parseTarget(raw, maxBlocks) {
  if (typeof raw !== "number" || !Number.isInteger(raw)) return null;
  if (raw < 0 || raw > maxBlocks) return null;
  return raw;
}

// Any discount at all on the subscription. A recurring coupon applies to
// every item unless restricted, and nothing restricts one by hand-made
// dashboard coupons; selling a block under one would sell it below price for
// as long as the coupon runs.
export function hasDiscount(sub) {
  const list = Array.isArray(sub?.discounts) ? sub.discounts.filter(Boolean) : [];
  return list.length > 0 || Boolean(sub?.discount);
}

// Whether the subscription carries a schedule (a planned phase change). An
// update made around a schedule is overwritten by its next phase, so the
// block would vanish at the phase boundary.
export function hasSchedule(sub) {
  return Boolean(sub?.schedule);
}

// Why this request cannot be served, or null. Order matters: the reader is
// told the most fundamental reason first, and nothing reaches Stripe pricing
// for an account that cannot buy at all.
//   state = {
//     configured      the four storage env ids are set
//     profile         { tier, storage_quota_bytes }
//     grantActive     a paid grant carries the account
//     mirror          the subscriptions row ({ stripe_subscription_id })
//     sub             the subscription, retrieved fresh, latest_invoice expanded
//     cfg             billingConfig()
//     target, current the block count asked for and the one on the subscription
//     maxBlocks
//     usedBytes       counted + in-flight uploads (the gates' own figure)
//     quotaIfBytes    what the drive would be with `target` blocks
//     price           the storage price for the plan's interval, retrieved
//   }
export function addonRefusal(state) {
  const { configured, profile, grantActive, mirror, sub, cfg, target, current, maxBlocks, usedBytes, quotaIfBytes, price } = state;
  if (!configured) return { code: "not_configured" };
  if (profile?.storage_quota_bytes != null) return { code: "quota_override" };
  if (!["paid", "admin"].includes(profile?.tier ?? "")) return { code: "no_subscription" };
  if (!mirror?.stripe_subscription_id || !sub) return { code: grantActive ? "contact_support" : "no_subscription" };
  const items = subscriptionItems(sub, cfg);
  if (!items.creator) return { code: "no_subscription" };
  if (items.storage.length > 1) return { code: "contact_support" };
  if (sub.status === "trialing") return { code: "trial_active" };
  // Before the open-invoice check: an add that needed 3D Secure leaves the
  // subscription active with a pending update, and its open invoice is the
  // one waiting to be paid. That is "finish your payment", not "your payment
  // failed".
  if (sub.pending_update) return { code: "payment_pending" };
  const inv = sub.latest_invoice && typeof sub.latest_invoice === "object" ? sub.latest_invoice : null;
  if (sub.status === "past_due" || sub.status === "unpaid" || inv?.status === "open") return { code: "past_due" };
  if (sub.status !== "active") return { code: "not_active", status: sub.status };
  if (hasSchedule(sub)) return { code: "schedule_attached" };
  if (sub.cancel_at_period_end || sub.cancel_at) return { code: "cancel_pending" };
  if (target == null) return { code: "bad_request", max: maxBlocks };
  if (target < current && Number(usedBytes) > Number(quotaIfBytes)) {
    return { code: "over_usage", used_bytes: Number(usedBytes), quota_bytes: Number(quotaIfBytes) };
  }
  if (target > current) {
    if (!priceMatches(price, items.creator, cfg)) return { code: "price_mismatch" };
    if (hasDiscount(sub)) return { code: "discounted_subscription" };
  }
  return null;
}

// The `items` for a subscription update (or its preview) that leaves
// `target` blocks on the subscription.
export function addonItems({ storageItem, priceId, target }) {
  if (storageItem) {
    return target === 0
      ? [{ id: storageItem.id, deleted: true }]
      : [{ id: storageItem.id, quantity: target }];
  }
  return target === 0 ? [] : [{ price: priceId, quantity: target }];
}

// What a change bills, read off a preview invoice: the sum of its proration
// lines (positive for an increase charged today, negative for the credit a
// removal leaves on the next invoice). Stripe's API versions disagree on where
// a line says it is a proration; both shapes are read.
export function prorationAmount(invoice) {
  let n = 0;
  for (const l of invoice?.lines?.data ?? []) {
    const isProration = l?.proration === true || l?.parent?.subscription_item_details?.proration === true;
    if (isProration) n += Number(l.amount) || 0;
  }
  return n;
}

// Any discount on a preview invoice — the check that also sees a CUSTOMER
// discount, which the subscription object does not carry.
export function previewDiscounted(invoice) {
  for (const d of invoice?.total_discount_amounts ?? []) {
    if ((Number(d?.amount) || 0) > 0) return true;
  }
  return false;
}

// A preview is only as good as the proration date it was priced at: the
// apply must reuse it (so the charge equals what the sheet showed) and refuse
// one too old to honour.
export const PRORATION_DATE_MAX_AGE_S = 15 * 60;
export function prorationDateOk(prorationDate, nowS) {
  return Number.isInteger(prorationDate)
    && prorationDate <= nowS + 60
    && nowS - prorationDate <= PRORATION_DATE_MAX_AGE_S;
}

// The per-click idempotency key. A second click is a new request_id and a new
// key; a retried request (a dropped response) reuses its key, so Stripe
// returns the first answer instead of applying the change twice.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function idempotencyKey(userId, requestId) {
  if (!UUID_RE.test(String(requestId || ""))) return null;
  return `addon:${userId}:${String(requestId).toLowerCase()}`;
}
