import { SoleilMark } from './primitives.jsx';

// Soleil wordmark — Brandon Grotesque uppercase, mark substituted for the O.
//   size="display"  → 56px (auth screen)
//   size="block"    → 24px (sidebar brand area)
export function SoleilWordmark({ size = 'display', color = 'var(--ink-0)' }) {
  const isDisplay = size === 'display';
  const fontSize = isDisplay ? 56 : 24;
  const tracking = isDisplay ? '0.18em' : '0.16em';
  const markSize = isDisplay ? 52 : 22;
  const gap = isDisplay ? 10 : 4;

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
      <span>S</span>
      <SoleilMark size={markSize} color="var(--soleil)" glow />
      <span>LEIL</span>
    </div>
  );
}
