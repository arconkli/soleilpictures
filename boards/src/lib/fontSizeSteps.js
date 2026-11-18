// The sizes the note bar's − and + step through (the presets, extended both
// ways), so 15 to 64 is a few clicks, not 49. 6 and 200 are the size box's clamp.
export const FONT_SIZE_STEPS = [6, 7, 8, 9, 10, 11, 13, 15, 18, 24, 32, 48, 64, 80, 96, 128, 160, 200];

// The smallest step above `size`; at the top (or past it) the size stays.
export function stepUp(size) {
  const n = Number(size);
  if (!Number.isFinite(n)) return n;
  const next = FONT_SIZE_STEPS.find((s) => s > n);
  return next ?? n;
}

// The largest step below `size`; at the bottom (or past it) the size stays.
export function stepDown(size) {
  const n = Number(size);
  if (!Number.isFinite(n)) return n;
  for (let i = FONT_SIZE_STEPS.length - 1; i >= 0; i--) if (FONT_SIZE_STEPS[i] < n) return FONT_SIZE_STEPS[i];
  return n;
}
