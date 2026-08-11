// AdminScoutTab — is the bot alive, and is anyone using it.
//
// WHY THIS EXISTS. Soleil Scout is the one part of this product that runs
// somewhere else: a long-lived Node process on Fly holding an outbound gRPC
// stream to the messaging provider. Nothing routes to it, so nothing probes it,
// and its own entry point can only detect the stream ENDING — which it turns
// into a non-zero exit so the supervisor restarts it.
//
// The failure it cannot detect is the stream that stays OPEN and stops
// delivering. The process looks healthy, the logs stay quiet, and every photo
// anyone texts is silently ignored. Nothing pages, because nothing went wrong.
// `last seen` is the whole answer to that: a number a human can read in one
// glance to know whether the bot is there.
//
// The second number worth staring at is STUCK CLAIMS. The ingest log claims a
// message on arrival and marks it done once the burst has landed; a claim older
// than any plausible burst means the process died mid-burst. Those messages are
// re-deliverable by design, but a count above zero means somebody's photos took
// a detour, and it is the signature of a crash that leaves no other trace.

import { supabase } from '../../lib/supabase.js';
import { relativeTime, fmtDateTime, formatCount } from '../../lib/adminFormat.js';
import { useAdminData } from './useAdminData.js';
import { AdminToolbar, AdminAsync, AdminSkeleton } from './AdminStates.jsx';
import { AdminStatCard } from './AdminStatCard.jsx';
import { Icon } from '../../components/Icon.jsx';
import { ChatTeardrop } from '../../lib/icons.js';

// Above this the bot has almost certainly stopped consuming the stream. It
// heartbeats every 60s, so three missed beats is not a blip.
const STALE_MS = 4 * 60 * 1000;

function health(lastSeen) {
  if (!lastSeen) return { label: 'never', tone: 'down', sub: 'the bot has never checked in' };
  const age = Date.now() - Date.parse(lastSeen);
  if (!Number.isFinite(age)) return { label: 'unknown', tone: 'down', sub: null };
  if (age > STALE_MS) {
    return { label: relativeTime(lastSeen), tone: 'down', sub: 'no heartbeat — the bot is not running' };
  }
  return { label: relativeTime(lastSeen), tone: 'ok', sub: 'heartbeat is current' };
}

export function AdminScoutTab() {
  const { data, loading, error, refreshing, lastUpdated, refresh } = useAdminData(
    async () => {
      const { data: rows, error: err } = await supabase.rpc('scout_admin_overview');
      if (err) throw err;
      return (Array.isArray(rows) ? rows[0] : rows) || null;
    },
    [],
    // The point of the tab is liveness, so it refreshes itself rather than
    // showing a number that was true when the page loaded.
    { pollIntervalMs: 60_000, refetchOnFocus: true },
  );

  const s = data || {};
  const beat = health(s.last_seen_at);

  return (
    <>
      <AdminToolbar onRefresh={refresh} refreshing={refreshing} lastUpdated={lastUpdated} />

      <AdminAsync
        loading={loading}
        error={error}
        onRetry={refresh}
        skeleton={<AdminSkeleton variant="cards" rows={4} />}
      >
        <div className="admin-stat-grid">
          <AdminStatCard
            label="Bot last seen"
            value={beat.label}
            sub={beat.sub}
            accent={beat.tone === 'down'}
            title={s.last_seen_at ? fmtDateTime(s.last_seen_at) : 'no heartbeat recorded'}
          />
          <AdminStatCard
            label="Messages, 24h"
            value={formatCount(s.ingest_24h)}
            sub={s.version ? `running ${s.version}` : null}
          />
          <AdminStatCard
            label="Cards in Bins, 24h"
            value={formatCount(s.bin_cards_24h)}
            sub="touched, not necessarily created"
          />
          <AdminStatCard
            label="Stuck claims"
            value={formatCount(s.ingest_claimed)}
            // Not merely informational: above zero means a burst was claimed
            // and never completed, i.e. the process died holding somebody's
            // photos. They are re-deliverable, which is the whole reason the
            // ingest log is two-phase — but it should be zero.
            accent={Number(s.ingest_claimed) > 0}
            sub={Number(s.ingest_claimed) > 0 ? 'a burst died mid-flight' : 'nothing in flight'}
          />
        </div>

        <h3 className="admin-section-title">People</h3>
        <div className="admin-stat-grid">
          <AdminStatCard label="Connected numbers" value={formatCount(s.identities)} />
          <AdminStatCard
            label="Shell accounts"
            value={formatCount(s.shell_accounts)}
            sub="no email address yet"
          />
          <AdminStatCard
            label="Opted out"
            value={formatCount(s.opted_out)}
            sub="texted STOP"
          />
        </div>

        <h3 className="admin-section-title">Signup queue</h3>
        <div className="admin-stat-grid">
          <AdminStatCard
            label="Waiting"
            value={formatCount(s.signups_pending)}
            sub="asked to be texted"
            // Somebody is waiting for a text that is not coming while the bot
            // is down. That pairing is the reason both live on one screen.
            accent={Number(s.signups_pending) > 0 && beat.tone === 'down'}
          />
          <AdminStatCard label="Texted" value={formatCount(s.signups_sent)} />
          <AdminStatCard
            label="Replied"
            value={formatCount(s.signups_replied)}
            sub="the only number that means it worked"
          />
          <AdminStatCard
            label="Failed / blocked"
            value={`${formatCount(s.signups_failed)} / ${formatCount(s.signups_blocked)}`}
            sub="undeliverable / opted out"
          />
        </div>

        {beat.tone === 'down' && (
          <p className="t-meta" style={{ marginTop: 16, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
            <Icon as={ChatTeardrop} size={14} style={{ marginTop: 2, flex: 'none' }} />
            <span>
              The bot is deployed with{' '}
              <code>fly deploy --config scout/fly.toml --dockerfile scout/Dockerfile .</code>{' '}
              from the repo root, and must run exactly one machine.
            </span>
          </p>
        )}
      </AdminAsync>
    </>
  );
}
