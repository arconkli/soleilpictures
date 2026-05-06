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
// linearly between them.
//
// On PartyKit (high broadcast rate), 80ms of render delay is enough to
// always have a future sample for interpolation while keeping the
// perceived cursor latency near-zero. On Supabase Realtime (4Hz) we
// needed 200ms — bump back up here if you ever roll back to that path.
const RENDER_DELAY_MS = 80;
const BUFFER_MS = 1500;            // discard samples older than this

export function LiveCursor({ x, y, name, color }) {
  const ref = React.useRef(null);
  const bufferRef = React.useRef([{ t: performance.now(), x, y }]);

  // Append the latest sample to the buffer on every prop change.
  React.useEffect(() => {
    const now = performance.now();
    const buf = bufferRef.current;
    const tail = buf[buf.length - 1];
    if (!tail || tail.x !== x || tail.y !== y) {
      // If the peer was stationary for a while (long gap since last
      // sample), synthesize a "just-before-motion" sample at their old
      // position so the first motion segment has a normal-length curve
      // instead of spanning the whole idle window. Without this the
      // Catmull-Rom curve at the start of motion has weird tangents
      // because P0 (the stale stationary sample) is far in the past.
      if (tail && now - tail.t > 350) {
        buf.push({ t: now - 250, x: tail.x, y: tail.y });
      }
      buf.push({ t: now, x, y });
    }
    const cutoff = now - BUFFER_MS;
    while (buf.length > 2 && buf[0].t < cutoff) buf.shift();
  }, [x, y]);

  React.useEffect(() => {
    let raf = 0;
    // Catmull-Rom: smooth curve through points P1-P2 using P0 and P3 as
    // tangent control points. Avoids the sharp angles linear interp
    // produces at every sample, so cornering peers look natural.
    const cmr = (p0, p1, p2, p3, p) => {
      const p2_ = p * p;
      const p3_ = p2_ * p;
      return 0.5 * (
        2 * p1 +
        (-p0 + p2) * p +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * p2_ +
        (-p0 + 3 * p1 - 3 * p2 + p3) * p3_
      );
    };
    const tick = () => {
      const buf = bufferRef.current;
      const renderT = performance.now() - RENDER_DELAY_MS;
      const last = buf[buf.length - 1];
      let rx = last.x, ry = last.y;
      // Walk the buffer to find the segment bracketing renderT.
      let handled = false;
      for (let i = 0; i < buf.length - 1; i++) {
        const a = buf[i], b = buf[i + 1];
        if (renderT < a.t) { rx = a.x; ry = a.y; handled = true; break; }
        if (renderT >= a.t && renderT <= b.t) {
          const span = Math.max(1, b.t - a.t);
          const p = (renderT - a.t) / span;
          const prev = i > 0 ? buf[i - 1] : a;
          const next = i + 2 < buf.length ? buf[i + 2] : b;
          rx = cmr(prev.x, a.x, b.x, next.x, p);
          ry = cmr(prev.y, a.y, b.y, next.y, p);
          handled = true;
          break;
        }
      }
      // renderT past the last sample (peer stopped broadcasting). Don't
      // snap — coast forward with the last segment's velocity, decaying
      // to zero over EASE_OUT_MS so the cursor eases to a stop instead
      // of slamming.
      if (!handled && buf.length >= 2) {
        const a = buf[buf.length - 2], b = buf[buf.length - 1];
        const segSpan = Math.max(1, b.t - a.t);
        const vx = (b.x - a.x) / segSpan;
        const vy = (b.y - a.y) / segSpan;
        const overshoot = renderT - b.t;
        const EASE_OUT_MS = 200;
        const decay = Math.max(0, 1 - overshoot / EASE_OUT_MS);
        // Integrate decaying velocity: ∫(1 - t/T)dt from 0 to overshoot
        // = overshoot - overshoot²/(2T). Clamps after EASE_OUT_MS.
        const t = Math.min(overshoot, EASE_OUT_MS);
        const dist = t - (t * t) / (2 * EASE_OUT_MS);
        rx = b.x + vx * dist;
        ry = b.y + vy * dist;
        // Suppress any pixel-level wiggle once the decay is done.
        if (decay <= 0) { rx = b.x + vx * (EASE_OUT_MS / 2); ry = b.y + vy * (EASE_OUT_MS / 2); }
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
