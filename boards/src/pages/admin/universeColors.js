// Stable per-workspace hue + degree-based sizing for the admin
// universe graph. Pure functions — no React, no DOM.

// FNV-1a 32-bit hash. We just want a deterministic 32-bit number per
// workspace_id so the same workspace renders with the same hue every
// time the universe loads.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

// Deterministic HSL → hex per workspace id. Saturation/lightness are
// fixed in a band that reads well on the admin's dark background.
export function colorForWorkspace(workspaceId) {
  if (!workspaceId) return '#9aa0aa';
  const h = fnv1a(String(workspaceId));
  const hue = h % 360;
  return hslToHex(hue, 62, 58);
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const x = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * x).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// Pure presentational — used when we don't have a degree column
// (Cosmograph handles degree-based sizing natively via pointSizeStrategy).
export function fallbackSize(_node) { return 4; }
