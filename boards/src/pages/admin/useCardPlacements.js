// useCardPlacements — live feed of card placements for the admin Command Center.
// Backfills the most recent placements once (so the ticker isn't empty), then
// subscribes to analytics_events INSERTs filtered to event=card_placed over
// Supabase Realtime. analytics_events is admin-RLS'd, so postgres_changes only
// streams to admins.
//
// Returns:
//   items     — most-recent placements, newest first (for the ticker)
//   liveTotal — cumulative count of cards placed via LIVE events since mount
//               (excludes the initial backfill). Lets the "Cards created" chart
//               tick its today bar up between the 20s metric polls.

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase.js';

const CAP = 14;

// Stable key from the underlying row so a placement that appears in BOTH the
// backfill and a live event (raced during subscribe) isn't shown/counted twice.
// occurred_at is normalized to epoch ms since the RPC and the realtime payload
// can format the timestamp differently.
function keyOf(p) {
  const t = p.occurred_at ? new Date(p.occurred_at).getTime() : 0;
  return `${t}|${p.user_id || ''}|${p.kind || ''}|${p.n || 1}`;
}

function fromBackfill(r) {
  return { occurred_at: r.occurred_at, user_id: r.user_id, actor: r.actor || r.email || null, kind: r.kind, n: Number(r.n) || 1 };
}

function fromRealtime(row) {
  let props = row?.props || {};
  if (typeof props === 'string') { try { props = JSON.parse(props); } catch (_) { props = {}; } }
  return { occurred_at: row?.occurred_at, user_id: row?.user_id, actor: props.actor || null, kind: props.kind, n: Number(props.n) || 1 };
}

export function useCardPlacements({ limit = CAP } = {}) {
  const [items, setItems] = useState([]);
  const [liveTotal, setLiveTotal] = useState(0);
  const seen = useRef(new Set());

  useEffect(() => {
    let alive = true;
    seen.current = new Set();

    const push = (p, isLive) => {
      if (!p || !alive) return;
      const k = keyOf(p);
      if (seen.current.has(k)) return;
      seen.current.add(k);
      setItems((prev) => [{ ...p, _key: k }, ...prev].slice(0, limit));
      if (isLive) setLiveTotal((t) => t + (Number(p.n) || 1));
    };

    // 1) Backfill the most recent placements (oldest→newest so the prepends
    //    leave the list newest-first). Backfill does NOT count toward liveTotal.
    supabase.rpc('admin_recent_card_placements', { p_limit: limit }).then(
      ({ data }) => { if (alive && Array.isArray(data)) [...data].reverse().forEach((r) => push(fromBackfill(r), false)); },
      () => {},
    );

    // 2) Live stream.
    const ch = supabase
      .channel('admin:card-placements')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'analytics_events', filter: 'event=eq.card_placed' },
        (payload) => push(fromRealtime(payload.new), true),
      )
      .subscribe();

    return () => { alive = false; try { supabase.removeChannel(ch); } catch (_) {} };
  }, [limit]);

  return { items, liveTotal };
}
