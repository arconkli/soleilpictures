// AdminUniverseTicker — compact, frosted pill floating over the universe
// canvas. Each cell shows a value, a small label, and (when something was
// created in the last 24 hours) a tiny "+N" growth indicator beside the label.
//
// Every cell carries a `hint` that states its EXACT definition, because these
// numbers used to be quietly ambiguous: "Cards +N today" counted cards that
// were EDITED today, and "24h" counted boards-created plus cards-edited while
// silently omitting users and workspaces. Migration 0254 fixed the SQL; the
// hints exist so the next person doesn't have to go read it.
//
// 0460 moved every figure off platform_counters onto exact live counts, and
// changed three definitions to match their labels:
//   • "+N" is the last 24 hours. It was "since midnight UTC", which is 5 pm in
//     California, so every evening the chips read nothing.
//   • Cards are cards on clusters that still exist. A trashed cluster's cards
//     keep their rows, and they were counted here but drawn nowhere.
//   • "Boards" became Clusters, the ones people made. Every workspace is born
//     with a Studio (its top-level cluster), and those were more than half of
//     the old figure. The Studios are in the tooltip.
// The team's own and test accounts are in every figure, by the owner's choice
// (2026-10-20), and the pill says so once rather than seven times.
//
// `Drawn` is deliberately NOT one of those counts. Several kinds of row never
// become anything you can see — entity_links are overwhelmingly tag
// attachments, which the graph renders as nothing at all — so Drawn comes from
// the renderer itself, and the HUD can only ever claim what is on screen.

import { useEffect, useRef, useState } from 'react';
import { formatDuration } from '../../lib/formatDuration.js';

const CELLS = [
  { key: 'total_users', label: 'Users', recentKey: 'users',
    hint: 'Accounts that confirmed their email and have signed in at least once. "+N" counts those created in the last 24 hours.' },
  { key: 'total_workspaces', label: 'WS', recentKey: 'workspaces',
    hint: 'Workspaces. "+N" counts workspaces created in the last 24 hours.' },
  { key: 'total_clusters_made', label: 'Clusters', recentKey: 'clusters_made',
    hint: 'Clusters people made, not counting trashed ones. "+N" counts those made in the last 24 hours.',
    detail: (s) => `Plus ${Number(s?.total_studios || 0).toLocaleString()} Studios, the top-level cluster every workspace is born with.` },
  { key: 'total_cards', label: 'Cards', recentKey: 'cards',
    hint: 'Cards on clusters that are not trashed. "+N" counts cards created on them in the last 24 hours.' },
  { key: 'drawn', label: 'Drawn', source: 'graph',
    hint: 'Nodes · connections the renderer actually drew: everyone in a workspace, workspaces, every live cluster (Studios included) and its cards. Tag attachments are not drawn at all.' },
  { key: 'nodes_created_24h', label: '24h', accent: true,
    hint: 'Accounts, workspaces, clusters (Studios included) and cards created in the last 24 hours.' },
  { key: 'total_seconds_in_app', label: 'Time', format: 'duration',
    hint: 'Summed time-in-app across every signed-in user (profiles.seconds_in_app). Signed-out visits are not counted.' },
];

const SCOPE_HINT = 'Every figure here includes the team: our own accounts and the test accounts. '
  + 'Analytics › Overview can leave them out.';

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

// Stream health is a first-class cell, not a decoration.
//
// This universe legitimately goes twenty minutes without a new node, so a still
// screen is the normal case — which means a dead socket looks exactly like a
// healthy quiet one. The old HUD had a single unlabelled warning dot that only
// appeared on error, so the two states it most needed to separate ("quiet" and
// "broken") were the two it never distinguished. Now the pill always says which
// one you are looking at.
const STREAM_LABEL = {
  live:         { text: 'Live',       hint: 'Counters are streaming. A still universe means nothing was created — the platform adds a node roughly every 20 minutes.' },
  connecting:   { text: 'Connecting', hint: 'Opening the counter and delta streams.' },
  reconnecting: { text: 'Offline',    hint: 'A stream dropped and is retrying with backoff. Numbers on screen are the last ones received, not current.' },
};

export function AdminUniverseTicker({ stats, graph, error, status = 'live' }) {
  const recent = stats?.last_24h || {};
  const health = STREAM_LABEL[status] || STREAM_LABEL.connecting;
  return (
    <div className="universe-ticker" role="status" aria-live="polite">
      <div className={`universe-ticker-cell universe-ticker-health is-${status}`} title={health.hint}>
        <div className="universe-ticker-value">
          <span className="universe-ticker-pip" />
        </div>
        <div className="universe-ticker-label">{health.text}</div>
      </div>
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
        const recentValue = c.recentKey ? Number(recent[c.recentKey] || 0) : 0;
        const detail = c.detail ? `\n${c.detail(stats)}` : '';
        return (
          <div
            key={c.key}
            className={`universe-ticker-cell ${c.accent ? 'is-accent' : ''}`}
            title={`${c.hint}\n\n${fmtFull(value, c.format)}${detail}`}
          >
            <div className="universe-ticker-value">
              <AnimatedValue value={value} format={c.format} />
            </div>
            <div className="universe-ticker-label">
              {c.label}
              {recentValue > 0 && (
                <span className="universe-ticker-today" title={`${recentValue.toLocaleString()} in the last 24 hours`}>
                  +{fmtCompact(recentValue)}
                </span>
              )}
            </div>
          </div>
        );
      })}
      <div className="universe-ticker-scope" title={SCOPE_HINT}>incl. team</div>
      {error && <div className="universe-ticker-warn" title={error} />}
    </div>
  );
}
