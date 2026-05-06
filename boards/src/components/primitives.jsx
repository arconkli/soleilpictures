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

// Constant-rate chase: each frame moves the rendered position a fixed
// fraction of the remaining distance toward the latest reported (x, y).
// Snapshot interpolation cursor renderer. We buffer the last ~1s of
// samples and render at virtual_time = now - RENDER_DELAY_MS, so we
// always have a future sample to interpolate toward. Each rAF frame
// finds the two buffered samples bracketing virtual_time and lerps
// linearly between them — cursor moves at peer's actual velocity with
// no overshoot, perfectly smooth in-between frames between known
// positions.
//
// Trade-off: cursor lags real-time by RENDER_DELAY_MS (~200ms). That's
// invisible to the operator (you don't see your own latency) and is
// the only way to get genuinely smooth motion from low-rate samples
// without overshoot.
const RENDER_DELAY_MS = 200;       // ~one sample interval at 4Hz
const BUFFER_MS = 1500;            // discard samples older than this

export function LiveCursor({ x, y, name, color }) {
  const ref = React.useRef(null);
  const bufferRef = React.useRef([{ t: performance.now(), x, y }]);

  // Append the latest sample to the buffer on every prop change.
  React.useEffect(() => {
    const now = performance.now();
    const buf = bufferRef.current;
    // De-dupe: identical position from a stationary peer doesn't add a
    // new sample (the existing tail already reflects it).
    const tail = buf[buf.length - 1];
    if (!tail || tail.x !== x || tail.y !== y) buf.push({ t: now, x, y });
    // Discard samples older than the buffer window.
    const cutoff = now - BUFFER_MS;
    while (buf.length > 2 && buf[0].t < cutoff) buf.shift();
  }, [x, y]);

  React.useEffect(() => {
    let raf = 0;
    const tick = () => {
      const buf = bufferRef.current;
      const renderT = performance.now() - RENDER_DELAY_MS;
      let rx = buf[buf.length - 1].x, ry = buf[buf.length - 1].y;
      // Walk the buffer to find the segment bracketing renderT.
      for (let i = 0; i < buf.length - 1; i++) {
        const a = buf[i], b = buf[i + 1];
        if (renderT >= a.t && renderT <= b.t) {
          const span = Math.max(1, b.t - a.t);
          const p = (renderT - a.t) / span;
          rx = a.x + (b.x - a.x) * p;
          ry = a.y + (b.y - a.y) * p;
          break;
        }
        // renderT before any sample we have — clamp to oldest.
        if (renderT < a.t) { rx = a.x; ry = a.y; break; }
        // renderT after the last sample — clamp to newest (peer stalled).
      }
      if (ref.current) ref.current.style.transform = `translate(${rx}px, ${ry}px)`;
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
