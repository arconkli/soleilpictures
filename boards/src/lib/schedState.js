// Normalized read for the Schedule card (kind:'schedule' with a `schedView`).
// Mirrors gridState.readGridModel: item records live in the SAME nested
// `gridCells` Y.Map a grid uses (init via initCardGridStore) but are keyed by
// date slot paths (see lib/schedLayout.js grammar), and the breakdown state
// lives in the `gridMeta` Y.Map under 'expand'. The local shell (no Yjs)
// stores the twins as plain `card.cells` / `card.gridMeta` fields.

import { gridCardYMap } from './gridState.js';

export function readSchedModel(card, ydoc) {
  const view = card?.schedView || 'month';
  const anchor = card?.anchor || null;
  const anchorHour = Number.isFinite(card?.anchorHour) ? card.anchorHour : 9;
  let cells = {};
  let expand = {};
  const ym = gridCardYMap(ydoc, card?.id);
  const cm = ym && ym.get && ym.get('gridCells');
  if (cm && typeof cm.forEach === 'function') {
    cm.forEach((v, k) => { cells[k] = (v && typeof v.toJSON === 'function') ? v.toJSON() : v; });
  } else if (card?.cells && typeof card.cells === 'object') {
    cells = { ...card.cells };
  }
  const mm = ym && ym.get && ym.get('gridMeta');
  if (mm && typeof mm.get === 'function') expand = mm.get('expand') || {};
  else if (card?.gridMeta && typeof card.gridMeta === 'object') expand = card.gridMeta.expand || {};
  return { view, anchor, anchorHour, cells, expand };
}
