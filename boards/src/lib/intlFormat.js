// Dates, numbers, lists, sorting and relative times in the interface's
// language. Cached: a formatter is costly to build and these are called per
// card. English returns no locale at all, so it keeps the browser's own
// formats, as before the app had languages. Imports only uiLocale.js.
import { uiLocale } from './uiLocale.js';

// The locale to format with: undefined for English; otherwise the browser's
// own regional tag for the UI language when it has one (es-MX for es), else
// the UI locale.
export function formatLocale() {
  const ui = uiLocale();
  if (ui === 'en') return undefined;
  const lang = ui.split('-')[0].toLowerCase();
  const langs = (typeof navigator !== 'undefined' && navigator.languages) || [];
  for (const tag of langs) {
    if (typeof tag === 'string' && tag.split('-')[0].toLowerCase() === lang) return tag;
  }
  return ui;
}

const cache = new Map();
function formatter(kind, Ctor, opts) {
  const loc = formatLocale();
  const key = `${kind}|${loc}|${JSON.stringify(opts || null)}`;
  let f = cache.get(key);
  if (!f) {
    try { f = new Ctor(loc, opts); } catch (_) { f = new Ctor(uiLocale() === 'en' ? undefined : uiLocale(), opts); }
    cache.set(key, f);
  }
  return f;
}

export const formatNumber = (n, opts) => formatter('number', Intl.NumberFormat, opts).format(n);
export const formatDate = (d, opts) => formatter('date', Intl.DateTimeFormat, opts).format(d);
export const formatList = (items, opts = { type: 'conjunction' }) => formatter('list', Intl.ListFormat, opts).format(items);
export const compareText = (a, b) => formatter('collator', Intl.Collator, { sensitivity: 'base', numeric: true }).compare(a, b);
export const formatRelative = (value, unit, opts = { numeric: 'auto' }) => formatter('relative', Intl.RelativeTimeFormat, opts).format(value, unit);
export const formatUnit = (value, unit, opts = { unitDisplay: 'narrow' }) => formatter('unit', Intl.NumberFormat, { ...opts, style: 'unit', unit }).format(value);

// Whole sentences run together into one paragraph: a space between them, none
// in Japanese, whose sentences end in 。 and run on. Empty parts drop out.
export function joinSentences(...parts) {
  return parts.flat().filter((p) => p != null && p !== '').join(uiLocale() === 'ja' ? '' : ' ');
}

// A size or a price whose English the caller writes itself, its own way and
// unchanged ("1.5 MB", "$12.50"). Other languages get the same number, with
// the same decimals, the way Intl writes it there: fr "1,5 Mo", "12,50 $US".
const digitsOf = (digits) => ({ minimumFractionDigits: digits, maximumFractionDigits: digits });
export function sizeText(english, value, unit, digits = 0) {
  if (uiLocale() === 'en') return english;
  return formatUnit(value, unit, { unitDisplay: 'short', ...digitsOf(digits) });
}
export function dollarsText(english, amount, digits = 0) {
  if (uiLocale() === 'en') return english;
  return formatNumber(amount, { style: 'currency', currency: 'USD', ...digitsOf(digits) });
}

// "A, B and C": English keeps its own join (no Oxford comma), as before the
// app had languages; other languages use the browser's list rule.
export function namesList(names) {
  if (uiLocale() !== 'en') return formatList(names);
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
