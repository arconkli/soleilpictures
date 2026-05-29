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
