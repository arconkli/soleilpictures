// Shared formatters for the admin dashboard. Before this module, every
// tab hand-rolled its own relativeTime / shortDate / money / percent
// helpers, so the same value rendered three different ways. One source
// of truth now — import from here and pair timestamps with a
// title={fmtDateTime(iso)} tooltip.

import { relativeTimeShort } from './relativeTime.js';

// Relative time, app-wide vocabulary ("Just now" / "5m ago" / "1w ago" /
// "Mar 12"). Accepts an ISO string or a ms epoch number.
export const relativeTime = relativeTimeShort;

// Full, unambiguous timestamp — use as the title= tooltip on any
// relative/abbreviated time so hovering reveals the exact moment.
export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

// Calendar date only (no time). "—" for missing/invalid.
export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

// Compact axis label, e.g. "5/18". Guarded so a bad value never renders
// the literal "NaN/NaN" onto a chart axis.
export function shortDate(d) {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return `${dt.getMonth() + 1}/${dt.getDate()}`;
}

// Whole-number-grouped count. "12,431".
export function formatCount(n) {
  return (Number(n) || 0).toLocaleString();
}

// Money from cents → "$25" (no cents when whole, else two decimals).
export function formatMoney(cents) {
  const v = (Number(cents) || 0) / 100;
  return v.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: Number.isInteger(v) ? 0 : 2,
  });
}

// Compact count for oversized hero KPIs — "999" / "12.4K" / "1.3M".
export function formatCompact(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) < 1000) return String(v);
  return v.toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 1 });
}

// Percent from a ratio in [0,1] → "12.3%". Floors tiny-but-nonzero
// values to "<1%" so a real conversion never rounds away to "0%".
export function formatPct(ratio) {
  const r = Number(ratio);
  if (!Number.isFinite(r) || r <= 0) return '0%';
  const pct = r * 100;
  if (pct < 1) return '<1%';
  return `${pct.toFixed(1)}%`;
}

// Human byte size — "1.4 GB". Mirrors the previous AdminStorageSection
// local copy so storage numbers don't shift.
export function formatBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let val = v / 1024;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(val >= 100 ? 0 : val >= 10 ? 1 : 2)} ${units[i]}`;
}

// Tier → chart/legend color. De-duped from AdminOverviewTab and
// AdminCardsSection, which each kept their own identical copy.
export const TIER_COLORS = {
  admin:    '#ffa500',  // soleil
  paid:     '#50c878',  // emerald
  demo:     '#9aa0aa',  // mid-grey
  waitlist: '#7a8090',  // dim
};

// ── Small-N honesty ─────────────────────────────────────────────────
// At early-stage volumes (today: 135 sessions, 12 users, 1 payer) almost
// every rate rests on a tiny denominator, so a raw "100%" off n=1 reads
// as a trend when it's noise. These thresholds drive ONE two-tier rule
// used across the whole dashboard so honesty is consistent, not ad-hoc:
//   denom ≥ MIN_RATE_FLAG                  → show the rate solid
//   MIN_RATE_SHOW ≤ denom < MIN_RATE_FLAG  → show it, flagged "directional"
//   denom < MIN_RATE_SHOW                  → hide it (placeholder), don't pretend
export const MIN_RATE_FLAG  = 20;  // ≥ this denominator → trustworthy
export const MIN_RATE_SHOW  = 5;   // < this denominator → suppress entirely
export const MIN_POINTS     = 3;   // fewer real datapoints → no line/sparkline
export const MIN_COHORT_SIZE = 5;  // cohort smaller than this → grey/suppress its row

// safeRate(numer, denom) — the single decision point for "can we trust
// this rate?". Pair `.rate` with formatPct(); show `.n` as the sample size.
//   { ok:true,  flag:false, rate, n }   denom ≥ MIN_RATE_FLAG  → solid
//   { ok:true,  flag:true,  rate, n }   MIN_RATE_SHOW..FLAG     → directional
//   { ok:false, hide:true,  rate, n }   denom < MIN_RATE_SHOW   → suppress
export function safeRate(numer, denom) {
  const n = Number(denom) || 0;
  const rate = n > 0 ? (Number(numer) || 0) / n : 0;
  if (n < MIN_RATE_SHOW) return { ok: false, hide: true, flag: false, n, rate };
  if (n < MIN_RATE_FLAG) return { ok: true, hide: false, flag: true, n, rate };
  return { ok: true, hide: false, flag: false, n, rate };
}
