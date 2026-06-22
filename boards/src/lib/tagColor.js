// Single source of truth for tag colors.
//
// A tag without an explicit `color` gets a deterministic hue by hashing
// its slug/name, so the same tag looks identical across every surface
// (canvas chips, the picker, hover popovers, doc underlines, the detail
// view, sidebar). This palette + hash used to be copy-pasted across ~8
// files; it lives only here now. Change the look in one place.

export const TAG_PALETTE = [
  '#4f8df8', '#22d3ee', '#10b981', '#84cc16', '#f59e0b',
  '#ef4444', '#ec4899', '#a78bfa', '#6366f1', '#0ea5e9',
];

// Deterministic fallback color for a tag with no explicit color.
// Pass the slug (preferred) or the name.
export function tagFallbackColor(slugOrName) {
  const s = (slugOrName || '').toString();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return TAG_PALETTE[Math.abs(h) % TAG_PALETTE.length];
}

// Resolve a tag's display color: explicit `color`, else a deterministic
// fallback from its slug (preferred) / name / id. Use this everywhere a
// tag is rendered so the color key is consistent across surfaces.
export function resolveTagColor(tag) {
  if (!tag) return tagFallbackColor('');
  // Hash by NAME first to match the deterministic hue the other tag
  // surfaces (chips, popovers, context menu, doc) already use, so the same
  // uncolored tag looks identical everywhere (slug/name hash differently).
  return tag.color || tagFallbackColor(tag.name || tag.slug || tag.id);
}
