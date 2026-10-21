// EventConsole — the thing on the deck that moves while you watch it.
//
// The product creates a node roughly once every twenty minutes, which is why
// the Universe view never felt alive. analytics_events runs about twenty times
// denser: ~741 a day, 2,057 in the last 24 hours. That is a stream you can
// actually watch, and watching it answers the one question a dashboard full of
// 30-day aggregates cannot — is anything happening RIGHT NOW.
//
// Costs almost nothing to run. useActivityPulse already holds the realtime
// subscription open, already backfills the per-minute buckets exactly once, and
// already accumulates raw rows in `recent`. This component is the display for
// state that was being computed and thrown away. The Overview holds that hook
// and hands it in as `pulse`, because its live figures listen to the same
// stream and two channels on one topic would collide (useActivityPulse says why).
//
// The one thing it adds is a seed. `recent` starts empty and fills only as new
// events arrive, so at roughly one event every two minutes the console would be
// blank for its first few minutes — which reads as broken rather than as quiet.
// admin_recent_events backfills it once; everything after that is pushed.
//
// Pushed rows arrive bare: realtime hands over the analytics_events row, with
// no email and no idea whether its author is internal. Shown as they came, the
// owner's own clicks streamed in under "Internal: excluded" and every live row
// read as an 8-character id beside seeded rows that read as names. So a pushed
// row is held back for a moment and sent through admin_events_by_id (0410),
// which applies admin_recent_events' own Internal rule and joins the email:
// rows it does not return are internal and stay out. Against a database
// without 0410 the console falls back to the old behaviour, with names filled
// from the seed where it knows them.
//
// Accessibility, deliberately: the stream is NOT an aria-live region. A console
// that announces two thousand events a day is unusable with a screen reader.
// The list is aria-hidden and a single visually-hidden summary carries the
// state instead — which is the part a non-visual reader actually wants.

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase.js';
import { useAdminData } from '../useAdminData.js';
import { formatCount } from '../../../lib/adminFormat.js';
import { VAR } from './palette.js';
import { Rolling } from './Rolling.jsx';

const CAP = 26;
// How long a pushed row waits so a burst resolves in one call.
const RESOLVE_MS = 800;

/**
 * Event families.
 *
 * Colour goes on the FAMILY, never on the individual event name: there are 172
 * distinct names in the last ninety days, and a palette that only holds three
 * hues plus a remainder cannot identify them — nor should it try, because the
 * family is what you actually read the stream for. Three plus other is exactly
 * what the categorical set permits, and family is genuine identity, so it earns
 * the colour.
 */
const FAMILIES = [
  { key: 'landing', label: 'landing', color: VAR.cat[0], test: (e) => /^(lp_|landing_|seo_landing)/.test(e) },
  { key: 'signup',  label: 'signup',  color: VAR.cat[1], test: (e) => /^(ps_|onboarding_|experiment_)/.test(e) },
  { key: 'work',    label: 'work',    color: VAR.cat[2], test: (e) => /^(card_|board_|doc_|grid_|note_|share_)/.test(e) },
];

function familyOf(event) {
  const e = String(event || '');
  return FAMILIES.find((f) => f.test(e)) || { key: 'other', label: 'other', color: VAR.other };
}

const clock = (iso) => {
  try {
    return new Date(iso).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return '--:--:--'; }
};

/** Emails are long and the column is narrow; the local part is the identifying bit. */
const who = (row) => {
  if (row.email) return String(row.email).split('@')[0].slice(0, 14);
  if (row.user_id) return String(row.user_id).slice(0, 8);
  return 'anon';
};

/** `pulse` is useActivityPulse({ minutes }), held by the view. */
export function EventConsole({ pulse, activeNow, minutes = 60, excludeInternal = true }) {

  // Seed only. Not a poll: deps are empty, so this fires once per mount.
  const seed = useAdminData(async () => {
    const { data, error } = await supabase.rpc('admin_recent_events', {
      p_limit: CAP, p_exclude_internal: excludeInternal,
    });
    if (error) throw error;
    return data || [];
  }, [excludeInternal]);

  // id -> the resolved row (email joined), or null for one the server left out
  // (internal, under "excluded"). Keyed to the toggle: flipping it starts over.
  const [resolved, setResolved] = useState(() => new Map());
  const [fallback, setFallback] = useState(false);
  const pending = useRef(new Set());
  const gen = useRef(0);
  useEffect(() => {
    gen.current += 1;
    pending.current = new Set();
    setResolved(new Map());
  }, [excludeInternal]);

  useEffect(() => {
    if (fallback) return undefined;
    const seeded = new Set((seed.data || []).map((r) => r.id));
    const todo = (pulse.recent || [])
      .map((r) => r?.id)
      .filter((id) => id && !seeded.has(id) && !resolved.has(id) && !pending.current.has(id));
    if (!todo.length) return undefined;
    const myGen = gen.current;
    const t = setTimeout(async () => {
      todo.forEach((id) => pending.current.add(id));
      let data = null;
      let error = null;
      try {
        ({ data, error } = await supabase.rpc('admin_events_by_id', {
          p_ids: todo, p_exclude_internal: excludeInternal,
        }));
      } catch (e) { error = e; }
      if (myGen !== gen.current) return;
      todo.forEach((id) => pending.current.delete(id));
      if (error) {
        // No 0410 yet (PGRST202), or a failed call: show rows as they came
        // rather than hold the stream back forever.
        setFallback(true);
        return;
      }
      const back = new Map((data || []).map((r) => [r.id, r]));
      setResolved((prev) => {
        const next = new Map(prev);
        for (const id of todo) next.set(id, back.get(id) || null);
        return next;
      });
    }, RESOLVE_MS);
    return () => clearTimeout(t);
  }, [pulse.recent, seed.data, resolved, fallback, excludeInternal]);

  // Live rows first, then the backfill for anything the stream has not covered.
  // Dedupe on analytics_events.id, which is the primary key, so it is exact.
  const rows = useMemo(() => {
    const seedById = new Map((seed.data || []).map((r) => [r.id, r]));
    // For the fallback only: names the seed already knows, by user.
    const emailOf = new Map((seed.data || []).filter((r) => r.user_id && r.email).map((r) => [r.user_id, r.email]));
    const out = [];
    const seen = new Set();
    for (const raw of [...(pulse.recent || []), ...(seed.data || [])]) {
      if (!raw?.id || seen.has(raw.id)) continue;
      let r = seedById.get(raw.id) || raw;
      if (r === raw && !seedById.has(raw.id)) {
        if (fallback) {
          r = { ...raw, email: emailOf.get(raw.user_id) || null };
        } else {
          if (!resolved.has(raw.id)) continue;      // still resolving
          const v = resolved.get(raw.id);
          if (!v) { seen.add(raw.id); continue; }    // internal: left out
          r = { ...raw, email: v.email };
        }
      }
      seen.add(raw.id);
      out.push(r);
      if (out.length >= CAP) break;
    }
    return out;
  }, [pulse.recent, seed.data, resolved, fallback]);

  const seedIds = useMemo(() => new Set((seed.data || []).map((r) => r.id)), [seed.data]);
  const buckets = pulse.buckets || [];
  const peak = Math.max(1, ...buckets.map((b) => b.events || 0));
  const live = pulse.status === 'live';

  return (
    <div className="adm-console">
      <div className="adm-console-head">
        <span className={`adm-live-led ${live ? 'is-live' : ''}`} aria-hidden="true" />
        {/* admin_active_now follows the Internal toggle (0460), so this one is
            filtered like the rest of the screen; the events count beside it is
            the exception, and labelled as one. */}
        <span className="adm-console-stat"
              title={`Signed in within the last five minutes, ${excludeInternal ? 'the team left out' : 'the team included'}.`}>
          <b><Rolling text={formatCount(activeNow ?? 0)} /></b> here now
        </span>
        {/* The per-minute count comes from admin_activity_pulse and the raw
            push, neither of which knows who is internal, so it is all traffic
            and says so when the stream below is filtered. */}
        <span className="adm-console-stat"
              title={excludeInternal ? 'All traffic, internal included: the per-minute count is not filtered.' : undefined}>
          <b>{formatCount(pulse.total)}</b> events / {minutes}m{excludeInternal ? ' · all' : ''}
        </span>
        <span className="adm-console-status">
          {live ? 'live' : pulse.status === 'error' ? 'reconnecting' : 'connecting'}
        </span>
      </div>

      {/* Per-minute volume. The in-progress minute is the one this hook owns
          outright — the backfill deliberately stops one minute short — so it is
          lit rather than merely last. */}
      <div className="adm-console-strip" aria-hidden="true">
        {buckets.map((b) => (
          <span
            key={b.minute}
            className={`adm-console-tick ${b.live ? 'is-now' : ''}`}
            style={{ height: `${Math.max(6, ((b.events || 0) / peak) * 100)}%` }}
            title={`${new Date(b.minute).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} — ${b.events} events`}
          />
        ))}
      </div>

      <div className="adm-console-stream" aria-hidden="true">
        {rows.length === 0 && (
          <div className="adm-console-idle">
            {seed.loading ? 'connecting…' : 'nothing in the last while'}
          </div>
        )}
        {rows.map((r) => {
          const fam = familyOf(r.event);
          // A pushed row slides in with a tint that fades; the seed is history.
          const pushed = !seedIds.has(r.id);
          return (
            <div className={`adm-console-row${pushed ? ' is-pushed' : ''}`} key={r.id}>
              <span className="adm-console-t">{clock(r.occurred_at)}</span>
              <span className="adm-console-dot" style={{ background: fam.color }} />
              <span className="adm-console-ev" title={r.event}>{r.event}</span>
              <span className="adm-console-who" title={r.email || r.user_id || 'signed out'}>{who(r)}</span>
            </div>
          );
        })}
      </div>

      <div className="adm-console-legend" aria-hidden="true">
        {[...FAMILIES, { key: 'other', label: 'other', color: VAR.other }].map((f) => (
          <span className="adm-console-key" key={f.key}>
            <span className="adm-console-dot" style={{ background: f.color }} />
            {f.label}
          </span>
        ))}
      </div>

      {/* The whole console, for a reader who is not watching it. */}
      <p className="sr-only">
        {formatCount(activeNow ?? 0)} people signed in within the last five minutes.
        {' '}{formatCount(pulse.total)} events in the last {minutes} minutes.
        {' '}The live event stream is presentational and is not announced.
      </p>
    </div>
  );
}
