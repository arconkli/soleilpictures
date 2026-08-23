// AdminUniverseTicker — compact, frosted pill floating over the universe
// canvas. Each cell shows a value, a small label, and (when something was
// created today) a tiny "+N" growth indicator pinned below the label.
//
// Every cell carries a `hint` that states its EXACT definition, because these
// numbers used to be quietly ambiguous: "Cards +N today" counted cards that
// were EDITED today, and "24h" counted boards-created plus cards-edited while
// silently omitting users and workspaces. Migration 0254 fixed the SQL; the
// hints exist so the next person doesn't have to go read it.
//
// `Drawn` is deliberately NOT a platform_counters value. The counters count
// rows, and several kinds of row never become anything you can see: entity_links
// are overwhelmingly tag attachments, which the graph renders as nothing at all,
// and cards on soft-deleted boards keep their row but lose their board. Drawn
// comes from the renderer itself, so the HUD can only ever claim what is
// actually on screen.

import { useEffect, useRef, useState } from 'react';
import { formatDuration } from '../../lib/formatDuration.js';

const CELLS = [
  { key: 'total_users', label: 'Users', todayKey: 'users',
    hint: 'Accounts that confirmed their email and have signed in at least once.' },
  { key: 'total_workspaces', label: 'WS', todayKey: 'workspaces',
    hint: 'Workspaces. "+N" counts workspaces created since midnight UTC.' },
  { key: 'total_boards', label: 'Boards', todayKey: 'boards',
    hint: 'Boards that are not soft-deleted. "+N" counts boards created since midnight UTC.' },
  { key: 'total_cards', label: 'Cards', todayKey: 'cards',
    hint: 'Rows in card_index. "+N" counts cards created since midnight UTC.' },
  { key: 'drawn', label: 'Drawn', source: 'graph',
    hint: 'Nodes · connections the renderer actually drew. Lower than the totals above: cards on soft-deleted boards keep their row but lose their board, and tag attachments are not drawn at all.' },
  { key: 'nodes_created_24h', label: '24h', accent: true,
    hint: 'Users + workspaces + boards + cards created in the last 24 hours.' },
  { key: 'total_seconds_in_app', label: 'Time', format: 'duration',
    hint: 'Summed time-in-app across every signed-in user (profiles.seconds_in_app). Signed-out visits are not counted.' },
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

export function AdminUniverseTicker({ stats, graph, error }) {
  const today = stats?.today || {};
  return (
    <div className="universe-ticker" role="status" aria-live="polite">
      {CELLS.map((c) => {
        // The Drawn cell reads the renderer, not the counters, and renders as
        // a paired "nodes · edges" figure rather than a single number.
        if (c.source === 'graph') {
          const n = graph?.nodes ?? 0;
          const e = graph?.edges ?? 0;
          return (
            <div key={c.key} className="universe-ticker-cell" title={`${c.hint}\n\n${n.toLocaleString()} nodes · ${e.toLocaleString()} connections`}>
              <div className="universe-ticker-value">
                {fmtCompact(n)}<span className="universe-ticker-sep">·</span>{fmtCompact(e)}
              </div>
              <div className="universe-ticker-label">{c.label}</div>
            </div>
          );
        }
        const value = stats?.[c.key] ?? 0;
        const todayValue = c.todayKey ? Number(today[c.todayKey] || 0) : 0;
        return (
          <div
            key={c.key}
            className={`universe-ticker-cell ${c.accent ? 'is-accent' : ''}`}
            title={`${c.hint}\n\n${fmtFull(value, c.format)}`}
          >
            <div className="universe-ticker-value">
              <AnimatedValue value={value} format={c.format} />
            </div>
            <div className="universe-ticker-label">
              {c.label}
              {todayValue > 0 && (
                <span className="universe-ticker-today" title={`${todayValue.toLocaleString()} created today`}>
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
