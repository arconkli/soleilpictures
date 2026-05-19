// Soleil Clusters wordmark — cluster mark + "CLUSTERS" in Brandon Grotesque
// uppercase. The mark is a PNG with a light/dark variant; we swap based on the
// active data-theme attribute so the dashed-orbit stays legible on either bg.
//   size="display"  → ~56px (auth screen) — clamps down on narrow viewports
//   size="block"    → 24px (sidebar brand area)
//
// For display size, font + mark + gap use clamp() so the whole composite
// shrinks proportionally below ~480px viewport width. Prevents the
// wordmark from clipping on phones (393px iPhone, 360px small Android).
export function SoleilWordmark({ size = 'display', color = 'var(--ink-0)' }) {
  const isDisplay = size === 'display';
  // clamp(min, fluid, max): below ~430px we scale toward 36px, above 700px we cap at 56px.
  const fontSize = isDisplay ? 'clamp(32px, 9.4vw, 56px)' : 24;
  const tracking = isDisplay ? '0.18em' : '0.16em';
  const markSize = isDisplay ? 'clamp(36px, 10.8vw, 64px)' : 28;
  const gap = isDisplay ? 'clamp(8px, 2.4vw, 14px)' : 8;

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap,
        fontFamily: 'var(--font-display)',
        fontWeight: 700,
        fontSize,
        textTransform: 'uppercase',
        letterSpacing: tracking,
        color,
        lineHeight: 1,
        maxWidth: '100%',
      }}
    >
      <ClustersMark size={markSize} />
      <span style={{ whiteSpace: 'nowrap', minWidth: 0 }}>Clusters</span>
    </div>
  );
}

// Theme-aware cluster mark. Renders both PNG variants and lets CSS show the
// right one — keeps things synchronous when the theme bootstrap script flips
// data-theme before React mounts.
export function ClustersMark({ size = 28 }) {
  return (
    <span
      className="clusters-mark"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <img src="/clusters-logo-dark.png" alt="" className="clusters-mark-img clusters-mark-dark" />
      <img src="/clusters-logo-light.png" alt="" className="clusters-mark-img clusters-mark-light" />
    </span>
  );
}
