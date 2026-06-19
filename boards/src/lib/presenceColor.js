// Per-user presence color, drawn from a muted cover palette. Stable per
// user id so the same person always shows up in the same color across
// sessions and across surfaces (canvas cursors, doc overlays, peer dots
// in the page tree, avatars in the doc-card header).
// NOTE: brand gold (#ffa500) is intentionally NOT in this palette — it's
// reserved for YOUR OWN selection ring, so a collaborator's selection is
// never confused with your own. Slot 0 is a cool blue for clear contrast.
const PRESENCE_COLORS = ['#5b8def', '#6b8090', '#9a6b88', '#c9a577', '#6b9088', '#b88958'];

export function pickPresenceColor(id) {
  if (!id) return PRESENCE_COLORS[0];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return PRESENCE_COLORS[Math.abs(h) % PRESENCE_COLORS.length];
}
