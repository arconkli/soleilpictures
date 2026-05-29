// Canonical loading spinner. `size` sets the diameter; `tone="on-dark"`
// switches the track to a translucent-white ring for use over dark media
// overlays. Uses the single shared @keyframes spin; the global
// prefers-reduced-motion rule renders it static for motion-sensitive users.
export function Spinner({ size = 16, tone = 'default', className = '', label = 'Loading' }) {
  return (
    <span
      className={`spinner spinner-${tone} ${className}`.trim()}
      role="status"
      aria-label={label}
      style={{ width: size, height: size }}
    />
  );
}
