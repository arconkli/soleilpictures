// Soleil Clusters wordmark — cluster mark + "CLUSTERS" in Brandon Grotesque
// uppercase. The mark is a PNG with a light/dark variant; we swap based on the
// active data-theme attribute so the dashed-orbit stays legible on either bg.
//   size="display"  → 56px (auth screen)
//   size="block"    → 24px (sidebar brand area)
export function SoleilWordmark({ size = 'display', color = 'var(--ink-0)' }) {
  const isDisplay = size === 'display';
  const fontSize = isDisplay ? 56 : 24;
  const tracking = isDisplay ? '0.18em' : '0.16em';
  const markSize = isDisplay ? 64 : 28;
  const gap = isDisplay ? 14 : 8;

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
      }}
    >
      <ClustersMark size={markSize} />
      <span>Clusters</span>
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
