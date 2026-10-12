// The transport's own glyphs, where Phosphor has none that reads right:
// frame steps (◁| |▷ — carets read as "previous item") and in/out brackets.
// 2px strokes in currentColor, sized like the Phosphor icons beside them.
const svg = (size, children) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block' }}>
    {children}
  </svg>
);

export function FrameBack({ size = 20 }) {
  return svg(size, <><path d="M16 6.5 8.5 12 16 17.5Z" /><path d="M6 6v12" /></>);
}
export function FrameFwd({ size = 20 }) {
  return svg(size, <><path d="M8 6.5 15.5 12 8 17.5Z" /><path d="M18 6v12" /></>);
}
export function MarkIn({ size = 20 }) {
  return svg(size, <path d="M14 5H9v14h5" />);
}
export function MarkOut({ size = 20 }) {
  return svg(size, <path d="M10 5h5v14h-5" />);
}
export function PlayGlyph({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ display: 'block' }}>
      <path d="M8 5.2v13.6a1 1 0 0 0 1.52.85l10.6-6.8a1 1 0 0 0 0-1.7L9.52 4.35A1 1 0 0 0 8 5.2Z" fill="currentColor" />
    </svg>
  );
}
export function PauseGlyph({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ display: 'block' }}>
      <rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" />
      <rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" />
    </svg>
  );
}
export function GuidesGlyph({ size = 20 }) {
  return svg(size, <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18M3 15h18" strokeOpacity=".55" /></>);
}
// A small aspect-ratio thumbnail for the guides menu.
export function AspectThumb({ ar }) {
  const W = 24, H = 14;
  let w = W, h = W / ar;
  if (h > H) { h = H; w = H * ar; }
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" style={{ display: 'block' }}>
      <rect x="0.5" y="0.5" width={W - 1} height={H - 1} rx="2" fill="none" stroke="currentColor" strokeOpacity=".35" />
      <rect x={(W - w) / 2 + 0.5} y={(H - h) / 2 + 0.5} width={Math.max(1, w - 1)} height={Math.max(1, h - 1)} rx="1.5" fill="currentColor" fillOpacity=".55" />
    </svg>
  );
}
