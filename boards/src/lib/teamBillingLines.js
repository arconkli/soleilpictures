// teamBillingLines — what Seats & billing says about the plan, the card and
// the receipts (the Team billing mockup, 2026-11-15). Pure: the snapshot's
// plan and whenFull, plus the team-billing "summary" answer when it has
// arrived (card, next charge, receipts), in; sentences and labels out, read
// through Lingui. Amounts come from the summary in the currency's minor unit
// (cents) and are never computed here. Without a known next amount, every
// line falls back to the wording the tab has always had.

import { t as tr, ph, plural } from '@lingui/core/macro';
import { uiLocale } from './uiLocale.js';
import { formatDate, formatNumber, dollarsText } from './intlFormat.js';
import { dateLabel, dayLabel } from './teamModelWords.js';

// ── Money and dates ─────────────────────────────────────────────────────

function currencyDigits(currency) {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  } catch (_) {
    return 2;
  }
}

// Stripe's minor-unit amount as money: "$375", "$41.67" (whole amounts drop
// the cents, as the tab's other prices do), or with { fixed: true } always
// with them ("$375.00", for a receipt). English dollars keep the app's own
// look; any other currency or language goes through Intl.
export function amountLabel(minor, currency, { fixed = false } = {}) {
  const cur = String(currency || 'usd').toUpperCase();
  const digits = currencyDigits(cur);
  const unit = 10 ** digits;
  const value = minor / unit;
  const shown = fixed || Math.round(minor) % unit !== 0 ? digits : 0;
  if (cur === 'USD') {
    const english = '$' + value.toLocaleString('en-US', { minimumFractionDigits: shown, maximumFractionDigits: shown });
    return dollarsText(english, value, shown);
  }
  return formatNumber(value, { style: 'currency', currency: cur, minimumFractionDigits: shown, maximumFractionDigits: shown });
}

// "Dec 29", the way dayLabel writes "December 29": English on en-US.
function shortDayLabel(ms) {
  const opts = { month: 'short', day: 'numeric' };
  return uiLocale() === 'en' ? new Date(ms).toLocaleDateString('en-US', opts) : formatDate(new Date(ms), opts);
}

// A receipt's date: "Nov 29", with the year once it isn't this year's.
export function receiptDate(ms, now = Date.now()) {
  if (!Number.isFinite(ms)) return '';
  const opts = new Date(ms).getFullYear() === new Date(now).getFullYear()
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' };
  return uiLocale() === 'en' ? new Date(ms).toLocaleDateString('en-US', opts) : formatDate(new Date(ms), opts);
}

// The next charge's amount as money, or null when the summary hasn't said
// (missing, or nothing to charge, which reads better as today's wording).
function nextAmount(next) {
  if (!next || !Number.isFinite(next.amount) || next.amount <= 0 || !next.currency) return null;
  return amountLabel(next.amount, next.currency);
}

// ── The plan card ───────────────────────────────────────────────────────

// Today's status sentence: seats, interval, and the renewal date when known.
function renewingText(plan) {
  const seats = plan.seats;
  if (plan.interval === 'year') {
    return plan.renewsAt
      ? tr`${ph({ seats })} seats, billed yearly, renewing ${ph({ date: dateLabel(plan.renewsAt) })}.`
      : tr`${ph({ seats })} seats, billed yearly.`;
  }
  return plan.renewsAt
    ? tr`${ph({ seats })} seats, billed monthly, renewing ${ph({ date: dateLabel(plan.renewsAt) })}.`
    : tr`${ph({ seats })} seats, billed monthly.`;
}

// { state, badge, text, keep } for the Plan card of a real team.
//   state: 'trial' | 'ending' | 'renewing' | 'plain'
//   badge: the pill beside the plan's name, or null
//   text: the sentence under it
//   keep: true when the owner gets "Keep the team" (an ending plan)
// plan: the snapshot's plan; role: the viewer's ('owner' or 'admin'); ownerName
// is the owner's first name for the admin's sentence; next: the summary's
// { amount, currency, date } or null.
export function planLines({ plan, role, ownerName = null, next = null }) {
  const seats = plan.seats;

  // The owner ended the plan in Stripe: it runs to the period's end.
  if (plan.cancelAtPeriodEnd && plan.renewsAt) {
    const date = dayLabel(plan.renewsAt);
    const owner = ownerName;
    let text;
    if (role === 'owner') {
      text = tr`The team ends on ${ph({ date })}, and nothing more is charged. Its workspaces then become yours, and everyone in them keeps what they had.`;
    } else if (owner) {
      text = tr`${ph({ owner })} ended the plan. The team ends on ${ph({ date })}, and its workspaces become ${ph({ owner })}’s.`;
    } else {
      text = tr`The owner ended the plan. The team ends on ${ph({ date })}, and its workspaces become the owner’s.`;
    }
    return { state: 'ending', badge: tr`Ends ${ph({ day: shortDayLabel(plan.renewsAt) })}`, text, keep: role === 'owner' };
  }

  const amountText = nextAmount(next);

  if (plan.status === 'trialing' && plan.trialEndsAt) {
    const badge = tr`Free trial`;
    if (!amountText) return { state: 'trial', badge, text: renewingText(plan), keep: false };
    const date = dayLabel(plan.trialEndsAt);
    const amount = amountText;
    const text = plan.interval === 'year'
      ? plural(seats, {
        one: `Free until ${ph({ date })}. The first charge is that day: ${ph({ amount })} for # seat, then yearly.`,
        other: `Free until ${ph({ date })}. The first charge is that day: ${ph({ amount })} for # seats, then yearly.`,
      })
      : plural(seats, {
        one: `Free until ${ph({ date })}. The first charge is that day: ${ph({ amount })} for # seat, then monthly.`,
        other: `Free until ${ph({ date })}. The first charge is that day: ${ph({ amount })} for # seats, then monthly.`,
      });
    return { state: 'trial', badge, text, keep: false };
  }

  const at = next && Number.isFinite(next.date) ? next.date : plan.renewsAt;
  if (amountText && at) {
    const date = dayLabel(at);
    const amount = amountText;
    const text = plan.interval === 'year'
      ? plural(seats, {
        one: `# seat, billed yearly. The next charge is ${ph({ amount })} on ${ph({ date })}.`,
        other: `# seats, billed yearly. The next charge is ${ph({ amount })} on ${ph({ date })}.`,
      })
      : plural(seats, {
        one: `# seat, billed monthly. The next charge is ${ph({ amount })} on ${ph({ date })}.`,
        other: `# seats, billed monthly. The next charge is ${ph({ amount })} on ${ph({ date })}.`,
      });
    return { state: 'renewing', badge: null, text, keep: false };
  }

  return { state: 'plain', badge: null, text: renewingText(plan), keep: false };
}

// Under "Add a seat for them": { added, left } or null. `left` is null when
// there is no monthly limit.
export function autoAddLines(whenFull) {
  if (!whenFull || whenFull.mode !== 'auto' || !Number.isFinite(whenFull.addedThisMonth)) return null;
  const added = whenFull.addedThisMonth;
  const limit = Number(whenFull.monthlyLimit);
  const left = limit > 0 ? Math.max(0, limit - added) : null;
  return {
    added: plural(added, { one: '# added this month', other: '# added this month' }),
    left: left == null ? null : plural(left, { one: '# more before it asks first.', other: '# more before it asks first.' }),
  };
}

// ── The payment card and receipts ───────────────────────────────────────

const BRANDS = {
  visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express', discover: 'Discover',
  diners: 'Diners Club', jcb: 'JCB', unionpay: 'UnionPay',
};

// Stripe's brand id (or, for a method that isn't a card, its type) as a
// name: "visa" → Visa, "sepa_debit" → Sepa debit. null for nothing or "unknown".
export function brandName(id) {
  const key = String(id || '').trim().toLowerCase();
  if (!key || key === 'unknown') return null;
  if (BRANDS[key]) return BRANDS[key];
  const words = key.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function expiryText(month, year) {
  if (!Number.isInteger(month) || !Number.isInteger(year) || month < 1 || month > 12) return null;
  return `${String(month).padStart(2, '0')}/${String(year % 100).padStart(2, '0')}`;
}

// { title, sub } for the Payment card, or null when the summary names nothing.
//   title: "Visa ending 4242", or just the type for a method that isn't a card
//   sub:   "Expires 08/28", with "· only Alex changes the card" for someone
//          who can't change it; null when there is no expiry
export function cardLines(card, { canChange = false, ownerName = null } = {}) {
  if (!card) return null;
  const brand = brandName(card.brand);
  const last4 = card.last4 ? String(card.last4) : null;
  if (!brand && !last4) return null;
  let title = brand;
  if (last4) {
    const name = brand || tr({ message: 'Card', context: 'payment card' });
    title = tr`${ph({ brand: name })} ending ${ph({ last4 })}`;
  }
  const exp = expiryText(card.expMonth, card.expYear);
  let sub = null;
  if (exp) {
    const owner = ownerName;
    if (canChange) sub = tr`Expires ${ph({ exp })}`;
    else if (owner) sub = tr`Expires ${ph({ exp })} · only ${ph({ owner })} changes the card`;
    else sub = tr`Expires ${ph({ exp })} · only the owner changes the card`;
  }
  return { title, sub };
}

function statusLabel(status) {
  if (status === 'paid') return tr`Paid`;
  if (status === 'open') return tr({ message: 'Open', context: 'invoice status' });
  if (status === 'uncollectible') return tr`Not paid`;
  return null;
}

// Only a Stripe-hosted https page is ever linked.
function safeUrl(url) {
  return typeof url === 'string' && /^https:\/\//i.test(url) ? url : null;
}

// The Receipts list: [{ key, date, amount, status, url }], newest first as sent.
export function receiptRows(receipts, now = Date.now()) {
  return (Array.isArray(receipts) ? receipts : []).map((r, i) => ({
    key: r.id || String(i),
    date: receiptDate(r.date, now),
    amount: Number.isFinite(r.amount) && r.currency ? amountLabel(r.amount, r.currency, { fixed: true }) : '',
    status: statusLabel(r.status),
    url: safeUrl(r.url),
  }));
}

// What the list says when there are none: in a trial, when the first comes.
export function noReceiptsLine(plan) {
  if (plan && plan.status === 'trialing' && plan.trialEndsAt) {
    return tr`None yet. The first comes on ${ph({ date: dayLabel(plan.trialEndsAt) })}.`;
  }
  return tr`None yet.`;
}
