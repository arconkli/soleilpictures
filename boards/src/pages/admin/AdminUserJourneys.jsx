// AdminUserJourneys — what one person actually did, in order.
//
// `admin_journey_reconstruct_by_user` has been deployed since migration 0162
// and has NEVER been called from the client. It holds 21,626 events across 686
// journeys and 271 people, running up to the present minute. The dashboard has
// been computing averages over this the whole time without ever letting anyone
// read a single one.
//
// At 6-17 daily actives, one person's session is not an anecdote — it is a
// meaningful share of the day. So this is the drill-down the aggregate panels
// have always implied: pick someone in the Users list and watch their first
// five minutes, phase by phase, with the gaps visible.
//
// Fetched lazily on expand. Someone scrolling the Users list should not pull
// twenty thousand events per click.

import { useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { useAdminData } from './useAdminData.js';
import { AdminAsync, AdminSkeleton } from './AdminStates.jsx';
import { DetailSection } from './AdminUserDetailParts.jsx';
import { Clock } from '../../lib/icons.js';
import { fmtDateTime, relativeTime, formatCount } from '../../lib/adminFormat.js';

/** "1.2s" / "45s" / "3m 20s" — elapsed since the journey started. */
function offset(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1000) return `${n}ms`;
  if (n < 60_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}s`;
  const m = Math.floor(n / 60_000);
  const s = Math.round((n % 60_000) / 1000);
  return s ? `${m}m ${s}s` : `${m}m`;
}

/**
 * A pause long enough to mean something.
 *
 * Reading a raw event list, the interesting thing is almost never an event —
 * it is the thirty seconds of nothing before someone left. Gaps over four
 * seconds are called out so they are as visible as the events either side.
 */
const GAP_MS = 4000;

function Journey({ j, index }) {
  const [open, setOpen] = useState(index === 0);
  const events = Array.isArray(j.events) ? j.events : [];
  const last = events[events.length - 1];
  const span = Number(last?.t_ms) || 0;
  const phases = [...new Set(events.map((e) => e.phase).filter(Boolean))];

  return (
    <div className={`adm-journey ${open ? 'is-open' : ''}`}>
      <button type="button" className="adm-journey-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="adm-journey-caret" aria-hidden="true">▸</span>
        <span className="adm-journey-when" title={fmtDateTime(j.t0_iso)}>{relativeTime(j.t0_iso)}</span>
        <span className="adm-journey-meta">
          {formatCount(j.n_events)} events{span > 0 ? ` over ${offset(span)}` : ''}
        </span>
        <span className="adm-journey-last">{phases[phases.length - 1] || '—'}</span>
      </button>

      {open && (
        <ol className="adm-journey-events">
          {events.map((e, i) => {
            const prev = events[i - 1];
            const gap = prev ? (Number(e.t_ms) || 0) - (Number(prev.t_ms) || 0) : 0;
            const phaseChanged = !prev || prev.phase !== e.phase;
            return (
              <li key={`${e.seq ?? i}-${e.event}`}>
                {gap >= GAP_MS && (
                  <div className="adm-journey-gap">
                    <span>{offset(gap)} of nothing</span>
                  </div>
                )}
                <div className="adm-journey-event">
                  <span className="adm-journey-t">{offset(e.t_ms)}</span>
                  <span className={`adm-journey-phase ${phaseChanged ? 'is-new' : ''}`}>
                    {phaseChanged ? e.phase || '' : ''}
                  </span>
                  <span className="adm-journey-name">{e.event}</span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export function AdminUserJourneys({ userId, excludeInternal = false }) {
  const [expanded, setExpanded] = useState(false);
  if (!expanded) {
    return (
      <DetailSection title="Sessions" icon={Clock}>
        <button type="button" className="adm-journey-load" onClick={() => setExpanded(true)}>
          Replay this person&rsquo;s sessions
        </button>
      </DetailSection>
    );
  }
  return <Journeys userId={userId} excludeInternal={excludeInternal} />;
}

function Journeys({ userId, excludeInternal }) {
  const q = useAdminData(async () => {
    // Internal exclusion is OFF by default here on purpose. Elsewhere it keeps
    // founder traffic out of aggregates; here you have deliberately opened one
    // specific person, and filtering them to nothing would be baffling.
    const { data, error } = await supabase.rpc('admin_journey_reconstruct_by_user', {
      p_user_id: userId,
      p_exclude_internal: excludeInternal,
    });
    if (error) throw error;
    return Array.isArray(data) ? [...data].reverse() : [];   // newest first
  }, [userId, excludeInternal]);

  const journeys = q.data || [];

  return (
    <DetailSection title="Sessions" icon={Clock}>
      <AdminAsync
        loading={q.loading}
        error={q.error}
        onRetry={q.refresh}
        skeleton={<AdminSkeleton variant="list" rows={4} />}
        isEmpty={!q.loading && !q.error && journeys.length === 0}
        empty={{
          title: 'No reconstructable sessions',
          body: 'Journeys are stitched from events carrying a jid, which the client began emitting on 2026-06-21. Anyone who last visited before that has none.',
        }}
      >
        <div className={`adm-journeys ${q.refreshing ? 'is-refreshing' : ''}`}>
          {journeys.slice(0, 12).map((j, i) => <Journey key={j.jid} j={j} index={i} />)}
          {journeys.length > 12 && (
            <div className="adm-journey-more">
              Showing the 12 most recent of {formatCount(journeys.length)}.
            </div>
          )}
        </div>
      </AdminAsync>
    </DetailSection>
  );
}
