// AdminUniverseTicker — compact, frosted pill floating over the
// cosmograph canvas. Each cell shows a value, a small label, and
// (when fresh signups arrived today) a tiny "+N" growth indicator
// pinned below the label.

import { useEffect, useRef, useState } from 'react';
import { formatDuration } from '../../lib/formatDuration.js';

const CELLS = [
  { key: 'total_users',          label: 'Users',  todayKey: 'users' },
  { key: 'total_workspaces',     label: 'WS',     todayKey: 'workspaces' },
  { key: 'total_boards',         label: 'Boards', todayKey: 'boards' },
  { key: 'total_cards',          label: 'Cards',  todayKey: 'cards' },
  { key: 'nodes_created_24h',    label: '24h',    accent: true },
  { key: 'total_seconds_in_app', label: 'Time',   format: 'duration' },
];

function fmtCompact(n) {
  const v = Math.round(Number(n) || 0);
  if (v < 1000)      return v.toLocaleString();
  if (v < 1_000_000) return (v / 1000).toFixed(v < 10_000 ? 1 : 0).replace(/\.0$/, '') + 'K';
  if (v < 1e9)       return (v / 1_000_000).toFixed(v < 10_000_000 ? 1 : 0).replace(/\.0$/, '') + 'M';
  return (v / 1e9).toFixed(1) + 'B';
}

function fmtFull(n, format) {
  const v = Math.round(Number(n) || 0);
  if (format === 'duration') {
    const days  = Math.floor(v / 86400);
    const hours = Math.floor((v % 86400) / 3600);
    return `${v.toLocaleString()} seconds (~${days}d ${hours}h)`;
  }
  return v.toLocaleString();
}

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
  const today = stats?.today || {};
  return (
    <div className="universe-ticker" role="status" aria-live="polite">
      {CELLS.map((c) => {
        const value = stats?.[c.key] ?? 0;
        const todayValue = c.todayKey ? Number(today[c.todayKey] || 0) : 0;
        return (
          <div
            key={c.key}
            className={`universe-ticker-cell ${c.accent ? 'is-accent' : ''}`}
            title={fmtFull(value, c.format)}
          >
            <div className="universe-ticker-value">
              <AnimatedValue value={value} format={c.format} />
            </div>
            <div className="universe-ticker-label">
              {c.label}
              {todayValue > 0 && (
                <span className="universe-ticker-today" title={`${todayValue.toLocaleString()} today`}>
                  +{fmtCompact(todayValue)}
                </span>
              )}
            </div>
          </div>
        );
      })}
      {error && <div className="universe-ticker-warn" title={error} />}
    </div>
  );
}
