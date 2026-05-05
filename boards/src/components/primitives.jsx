// Small visual primitives — image stub, avatar, live cursor, soleil mark.

import React from 'react';

export function ImagePlaceholder({ label, tone = 'neutral', aspect = '4/3' }) {
  const tones = {
    neutral: { base: '#1c1c1f', stripe: '#222226' },
    warm:    { base: '#1d1c1a', stripe: '#26241f' },
    cool:    { base: '#191c20', stripe: '#1f242b' },
    sun:     { base: '#1f1d18', stripe: '#2a2620' },
    dusk:    { base: '#1c1a20', stripe: '#22202a' },
    sand:    { base: '#1e1d19', stripe: '#272520' },
    sea:     { base: '#181c1e', stripe: '#1f2528' },
  };
  const t = tones[tone] || tones.neutral;
  return (
    <div className="img-ph" style={{ aspectRatio: aspect, background: t.base }}>
      <svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100">
        <defs>
          <pattern id={`stripes-${tone}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
            <rect width="6" height="6" fill={t.base} />
            <rect width="3" height="6" fill={t.stripe} />
          </pattern>
        </defs>
        <rect width="100" height="100" fill={`url(#stripes-${tone})`} />
      </svg>
      {label && <div className="img-ph-label">{label}</div>}
    </div>
  );
}

export function Avatar({ name, color, size = 22, ring }) {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div className="avatar" style={{
      width: size, height: size, background: color,
      fontSize: Math.round(size * 0.42),
      boxShadow: ring ? `0 0 0 1.5px ${ring}` : 'none',
    }}>{initials}</div>
  );
}

// Snapshot-interpolation cursor. Each new (x, y) prop is recorded with a
// timestamp into a small buffer; the rAF loop renders the position at
// (now - RENDER_DELAY_MS), interpolating between the two samples that
// bracket that time. Trade: ~RENDER_DELAY_MS of perceived lag in exchange
// for genuinely smooth motion regardless of broadcast cadence or jitter.
const RENDER_DELAY_MS = 90;
const BUFFER = 6;

export function LiveCursor({ x, y, name, color }) {
  const ref = React.useRef(null);
  const samplesRef = React.useRef([]);

  // Push every new prop into the buffer.
  React.useLayoutEffect(() => {
    const t = performance.now();
    const buf = samplesRef.current;
    // Drop a duplicate trailing sample if the position didn't change.
    const last = buf[buf.length - 1];
    if (last && last.x === x && last.y === y) { last.t = t; return; }
    buf.push({ x, y, t });
    if (buf.length > BUFFER) buf.shift();
  }, [x, y]);

  React.useEffect(() => {
    let raf = 0;
    const tick = () => {
      const buf = samplesRef.current;
      const now = performance.now() - RENDER_DELAY_MS;
      let px, py;
      if (buf.length === 0) {
        // Nothing yet — fall back to the inline transform set on the div.
      } else if (buf.length === 1 || now <= buf[0].t) {
        px = buf[0].x; py = buf[0].y;
      } else if (now >= buf[buf.length - 1].t) {
        // Already past the newest sample — extrapolate slightly via the
        // last two samples' velocity to avoid the "freeze and jump" feel
        // when broadcasts pause briefly.
        const a = buf[buf.length - 2];
        const b = buf[buf.length - 1];
        const span = Math.max(1, b.t - a.t);
        const ahead = Math.min(now - b.t, RENDER_DELAY_MS); // cap how far we extrapolate
        const f = ahead / span;
        px = b.x + (b.x - a.x) * f;
        py = b.y + (b.y - a.y) * f;
      } else {
        // Find the bracketing samples and lerp.
        let i = buf.length - 1;
        while (i > 0 && buf[i - 1].t > now) i--;
        const a = buf[i - 1] || buf[0];
        const b = buf[i] || a;
        const span = Math.max(1, b.t - a.t);
        const f = Math.max(0, Math.min(1, (now - a.t) / span));
        px = a.x + (b.x - a.x) * f;
        py = a.y + (b.y - a.y) * f;
      }
      if (ref.current && Number.isFinite(px) && Number.isFinite(py)) {
        ref.current.style.transform = `translate(${px}px, ${py}px)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={ref} className="cursor" style={{ transform: `translate(${x}px, ${y}px)` }}>
      <svg width="16" height="20" viewBox="0 0 16 20" fill="none">
        <path d="M2 2 L2 15 L5.5 12 L8 17.5 L10 16.5 L7.5 11 L13 11 Z"
              fill={color} stroke="#0a0a0c" strokeWidth="1" strokeLinejoin="round" />
      </svg>
      <span className="cursor-flag" style={{ background: color }}>{name}</span>
    </div>
  );
}

export function SoleilMark({ size = 18, color = 'currentColor', glow = false }) {
  const rays = 12;
  const filter = glow && size > 20
    ? 'drop-shadow(0 0 12px rgba(212,160,74,.35))'
    : undefined;
  // At small sizes (<= 20px) the rays read as noise — shorten them slightly
  // and drop stroke weight to 1px so the mark reads as a luminous point.
  const stroke = 1;
  const innerR = size <= 20 ? 5.0 : 5.5;
  const outerR = size <= 20 ? 9.2 : 10;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block', filter }}>
      <circle cx="12" cy="12" r="2.6" fill={color} />
      {Array.from({ length: rays }).map((_, i) => {
        const a = (i / rays) * Math.PI * 2;
        const x1 = 12 + Math.cos(a) * innerR;
        const y1 = 12 + Math.sin(a) * innerR;
        const x2 = 12 + Math.cos(a) * outerR;
        const y2 = 12 + Math.sin(a) * outerR;
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={stroke} strokeLinecap="round" />;
      })}
    </svg>
  );
}

// Tint dots for child rows — small color cue per board cover
export const COVER_TINTS = {
  neutral: '#6b6760',
  warm:    '#b88958',
  cool:    '#6b8090',
  sun:     '#d4a04a',
  dusk:    '#9a6b88',
  sand:    '#c9a577',
  sea:     '#6b9088',
};
