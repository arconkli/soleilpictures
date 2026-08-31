// Pure helpers behind the admin Discounts tab (AdminDiscountsTab.jsx).
//
// These live outside the component for one reason: the house rule that pricing
// numbers are never typed by hand. discountPreviewLine composes the operator's
// preview from PRICING, so a price change in billingCopy.js moves the admin
// copy too — and a test can prove it.

import { PRICING } from './billingCopy.js';

// I/O/0/1 are excluded: a code gets read aloud, and those four are the pairs
// people transcribe wrongly.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function normalizeDiscountCode(raw) {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 40);
}

export function generateDiscountCode(len = 8, rand = Math.random) {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += ALPHABET[Math.min(ALPHABET.length - 1, Math.floor(rand() * ALPHABET.length))];
  }
  return out;
}

const money = (n) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);

// The line under the create form, in the operator's own numbers. It names the
// plan restriction because that is the single most surprising thing about these
// codes — Stripe discounts invoices, not months, so an unrestricted "50% off
// the first month" would be 50% off a whole year on the annual plan.
export function discountPreviewLine({ percentOff } = {}) {
  const pct = Number(percentOff);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return null;
  const full = PRICING.monthly.perMonth;
  const first = Math.round(full * (1 - pct / 100) * 100) / 100;
  const paid = first === 0 ? 'their first month is free' : `they pay ${money(first)}`;
  return `${pct}% off the first month — ${paid}, then ${money(full)}/mo. Monthly plan only.`;
}

// Maps a Stripe promotion code onto the four lifecycle words StatusPill already
// colours. A used-up code reads 'expired' rather than 'active': Stripe leaves
// active:true on a code nobody can redeem any more, which reads as available.
export function codeStatus(code, now = new Date()) {
  if (!code?.active) return 'revoked';
  const cap = code.max_redemptions;
  const used = code.times_redeemed ?? 0;
  if (Number.isFinite(cap) && used >= cap) return 'expired';
  if (code.expires_at && new Date(code.expires_at).getTime() <= now.getTime()) return 'expired';
  if ((cap === null || cap === undefined) && !code.expires_at) return 'forever';
  return 'active';
}
