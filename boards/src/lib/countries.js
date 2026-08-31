// countries.js — ISO 3166-1 alpha-2 code → display name and flag emoji.
//
// No lookup table: Intl.DisplayNames ships the ~250-entry country list in the
// platform, so we don't carry one. Both helpers are TOTAL — any input that
// isn't a well-formed 2-letter code returns a safe fallback instead of
// throwing, because these render inside admin tables where one malformed row
// must not blank the whole panel.
//
// The DB stores uppercase alpha-2 and uses the lowercase string 'unknown' as
// its no-country sentinel; 'unknown' is 7 characters, so normalizeCountry
// rejects it and it renders as "Unknown" like any other missing value.
//
// countryFlag is a DELIBERATE exception to "no emoji in Clusters". That rule is
// about the product's own voice — toasts, onboarding, notifications, anything a
// customer reads. These render only in /admin, which no customer sees, and a
// flag column is legible at a glance in a way a column of alpha-2 codes is not.
// It was removed once and put straight back; don't sweep it up in a third pass.

const UNKNOWN_NAME = 'Unknown';
const UNKNOWN_FLAG = '🌐';
const FLAG_OFFSET = 0x1f1e6 - 'A'.charCodeAt(0);   // 'A' → REGIONAL INDICATOR SYMBOL LETTER A

// Built once and cached — constructing Intl.DisplayNames per row is measurably
// slow in a long list. `null` marks an environment without it (we then fall
// back to the raw code, which is still readable).
let displayNames;
function getDisplayNames() {
  if (displayNames !== undefined) return displayNames;
  try { displayNames = new Intl.DisplayNames(['en'], { type: 'region' }); }
  catch (_) { displayNames = null; }
  return displayNames;
}

export function normalizeCountry(code) {
  if (typeof code !== 'string') return null;
  const cc = code.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(cc) ? cc : null;
}

export function countryName(code) {
  const cc = normalizeCountry(code);
  if (!cc) return UNKNOWN_NAME;
  try { return getDisplayNames()?.of(cc) || cc; }
  catch (_) { return cc; }
}

export function countryFlag(code) {
  const cc = normalizeCountry(code);
  if (!cc) return UNKNOWN_FLAG;
  return String.fromCodePoint(...[...cc].map((c) => c.charCodeAt(0) + FLAG_OFFSET));
}
