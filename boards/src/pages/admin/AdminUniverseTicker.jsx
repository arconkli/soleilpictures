// AdminUniverseTicker — compact, frosted pill floating over the
// cosmograph canvas. Each cell is a tiny stack of value + label;
// values animate between updates so growth is visible mid-glance.

import { useEffect, useRef, useState } from 'react';
import { formatDuration } from '../../lib/formatDuration.js';

const CELLS = [
  { key: 'total_users',          label: 'Users' },
  { key: 'total_workspaces',     label: 'WS' },
  { key: 'total_boards',         label: 'Boards' },
  { key: 'total_cards',          label: 'Cards' },
  { key: 'total_links',          label: 'Conn' },
  { key: 'nodes_created_24h',    label: '24h',     accent: true },
  { key: 'total_seconds_in_app', label: 'Time',    format: 'duration' },
];

// Compact integer formatter: 12_481 → '12.5K', 2_140_000 → '2.1M'.
function fmtCompact(n) {
  const v = Math.round(Number(n) || 0);
  if (v < 1000)      return v.toLocaleString();
  if (v < 1_000_000) return (v / 1000).toFixed(v < 10_000 ? 1 : 0).replace(/\.0$/, '') + 'K';
  if (v < 1e9)       return (v / 1_000_000).toFixed(v < 10_000_000 ? 1 : 0).replace(/\.0$/, '') + 'M';
  return (v / 1e9).toFixed(1) + 'B';
}

// AnimatedValue — tweens between consecutive values over ~600ms using
// requestAnimationFrame. Renders via a supplied formatter so it works
// for both compact integers and duration strings.
function AnimatedValue({ value, format }) {
  const [shown, setShown] = useState(Number(value) || 0);
  const fromRef = useRef(Number(value) || 0);

  useEffect(() => {
    const target = Number(value) || 0;
    const start = performance.now();
    const dur = 600;
    const from = fromRef.current;
    let raf = 0;
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = from + (target - from) * eased;
      setShown(v);
      if (t < 1) raf = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  const text = format === 'duration' ? formatDuration(shown) : fmtCompact(shown);
  return <>{text}</>;
}

export function AdminUniverseTicker({ stats, error }) {
  return (
    <div className="universe-ticker" role="status" aria-live="polite">
      {CELLS.map((c, i) => (
        <div key={c.key} className={`universe-ticker-cell ${c.accent ? 'is-accent' : ''}`}>
          <div className="universe-ticker-value">
            <AnimatedValue value={stats?.[c.key] ?? 0} format={c.format} />
          </div>
          <div className="universe-ticker-label">{c.label}</div>
        </div>
      ))}
      {error && <div className="universe-ticker-warn" title={error}>•</div>}
    </div>
  );
}
