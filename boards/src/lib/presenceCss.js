// Peer presence reaches the page stylesheet (CanvasPresence's selection rings),
// and every value in it comes from another person's awareness state. These
// keep each value in a shape that cannot leave the rule it is written into.

// A peer's colour: a hex colour, or the default.
export function cssColor(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : '#ffa500';
}

// A card id inside a quoted attribute selector. Card ids are made of letters,
// digits, '-', '_', '.' and ':', so anything else is dropped rather than escaped.
export function cssString(value) {
  const s = String(value ?? '');
  return /^[A-Za-z0-9_.:-]{1,128}$/.test(s) ? s : '';
}
