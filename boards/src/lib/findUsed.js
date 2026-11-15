// findUsed — one row when a result is picked while a search is typed.
// Counts and which side matched only; never the typed text.

import { logEvent } from './analytics.js';
import { EV } from './analyticsEvents.js';

export function trackFindUsed({ surface, nItems, by } = {}) {
  try { logEvent(EV.FIND_USED, { surface, n_items: nItems, by }); } catch (_) { /* analytics never breaks a click */ }
}
