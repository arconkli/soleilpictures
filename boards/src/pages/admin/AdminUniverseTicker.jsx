// AdminUniverseTicker — horizontal strip of live counters pinned to
// the top of the Universe tab. Each cell animates between values so
// growth is visible mid-glance.

import { useEffect, useRef, useState } from 'react';
import { AdminStatCard } from './AdminStatCard.jsx';

const CELLS = [
  { key: 'total_users',       label: 'Users' },
  { key: 'total_workspaces',  label: 'Workspaces' },
  { key: 'total_boards',      label: 'Boards' },
  { key: 'total_cards',       label: 'Cards' },
  { key: 'total_links',       label: 'Connections' },
  { key: 'nodes_created_24h', label: 'New · 24h' },
];

// AnimatedCounter — interpolates from prev value to next over ~500ms
// using requestAnimationFrame. Pure presentation; no globals.
function AnimatedCounter({ value }) {
  const [shown, setShown] = useState(value || 0);
  const fromRef = useRef(value || 0);
  const toRef   = useRef(value || 0);

  useEffect(() => {
    fromRef.current = shown;
    toRef.current   = value || 0;
    const start = performance.now();
    const dur   = 500;
    let raf = 0;
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = Math.round(fromRef.current + (toRef.current - fromRef.current) * eased);
      setShown(v);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <>{shown.toLocaleString()}</>;
}

export function AdminUniverseTicker({ stats, error }) {
  return (
    <div className="universe-ticker">
      {CELLS.map((c) => (
        <AdminStatCard
          key={c.key}
          label={c.label}
          value={<AnimatedCounter value={stats?.[c.key] ?? 0} />}
          accent={c.key === 'nodes_created_24h'}
        />
      ))}
      {error && <div className="universe-ticker-warn t-meta">{error}</div>}
    </div>
  );
}
