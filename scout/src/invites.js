// Scout — sending the first message to someone who signed up on the website.
//
// /scout takes a phone number and promises Scout will text you. The Worker
// writes a row to scout_signups (0210); this drains it.
//
// WHY A QUEUE AND NOT AN HTTP CALL FROM THE WORKER
//
//   · scout/fly.toml has no [http_service] on purpose — this process holds an
//     outbound gRPC stream to Photon and accepts no inbound HTTP. Keeping it
//     that way means no public surface and no new shared secret.
//   · A signup survives this process being down. The row simply waits.
//   · Most importantly it PACES the sends. Photon allows ~50 new conversations
//     per line per day and documents burst sending as a cause of line
//     flagging. A flagged line is fatal: Scout has exactly one channel, since
//     Telegram was dropped from v1. So the queue drains a few at a time, on a
//     slow tick, with a gap between messages — deliberately unhurried.
//
// ⚠️ THE ONE UNVERIFIED CALL IN THIS FILE is opening a space to a handle that
// has never messaged us. Photon's pricing page lists cold outreach as a
// Business-tier feature while their deliverability docs give the same 50/day
// limit with no tier distinction, and Free/Pro draw from a shared number pool.
// Whether a Pro project may initiate to an opted-in signup is an open question
// with the vendor. Until it's answered this loop is correct but unproven — and
// it fails SAFE: a refusal marks the row and the landing page keeps telling
// people they're on the list, which stays true.

import { text as textMsg } from 'spectrum-ts';
import { scoutRpc } from '../../boards/src/lib/scoutDb.js';

// Slow on purpose. Nobody signing up expects an instant text, and a leisurely
// cadence is the single cheapest defence against looking like a spam blast.
const TICK_MS = 90_000;
// Per tick. With the 40/day cap in app_config this is nowhere near binding —
// it exists so a backlog drains as a trickle rather than all at once.
const BATCH = 3;
// Between individual sends inside a batch.
const GAP_MS = 6_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// What a stranger sees as the very first thing Scout ever says to them.
//
// It has to do three jobs in the space of one notification: prove this is the
// thing they asked for (they typed their number minutes-to-hours ago), say
// exactly what to do next, and be worth replying to. No link — there is no
// board yet, and a link to nothing is worse than no link.
export function inviteText() {
  return [
    'This is Soleil Scout — you asked us to text you.',
    '',
    'Send a photo and it lands on a canvas, no signup. Add a line like "Scene 4 diner" and it gets filed under that.',
    '',
    'Nothing happens until you send something.',
  ].join('\n');
}

// Open a conversation with a handle we have never heard from, and send once.
async function sendInvite(app, phone) {
  // Provider APIs differ on how you address someone who hasn't written first.
  // Try the documented shapes in order rather than pinning one we can't verify
  // — the alternative is a loop that fails 100% of the time on a naming detail.
  const space = typeof app.space === 'function'
    ? await app.space(phone)
    : typeof app.conversation === 'function'
      ? await app.conversation(phone)
      : typeof app.dm === 'function'
        ? await app.dm(phone)
        : null;

  if (!space || typeof space.send !== 'function') {
    throw new Error('provider exposes no way to open a space to a new handle');
  }
  await space.send(textMsg(inviteText()));
}

// One pass. Exported so the dry run can exercise it without the timer.
export async function drainOnce(cfg, app, { batch = BATCH, gapMs = GAP_MS } = {}) {
  const claimed = await scoutRpc(cfg, 'scout_claim_invites', { p_limit: batch });
  const rows = Array.isArray(claimed) ? claimed : [];
  if (!rows.length) return { claimed: 0, sent: 0 };

  let sent = 0;
  for (const row of rows) {
    try {
      await sendInvite(app, row.phone_e164);
      sent++;
      await scoutRpc(cfg, 'scout_mark_invite_sent', { p_id: row.id, p_ok: true });
    } catch (e) {
      // The row keeps its attempt count and goes back to pending until it has
      // burned three tries, then it's 'failed' — an unreachable number must
      // stop eating the daily allowance that working numbers need.
      const msg = e?.message || String(e);
      console.error('[scout] invite send failed', msg);
      await scoutRpc(cfg, 'scout_mark_invite_sent', {
        p_id: row.id, p_ok: false, p_error: msg,
      }).catch(() => {});
    }
    if (gapMs) await sleep(gapMs);
  }

  // The only routine log line this module emits. Silence otherwise — the real
  // telemetry lands in analytics_events from inside the RPCs.
  if (sent) console.log(`[scout] invites sent: ${sent}/${rows.length}`);
  return { claimed: rows.length, sent };
}

// Start the loop. Returns a stop function.
//
// setTimeout-after-completion rather than setInterval: a slow or hanging pass
// must never overlap the next one and double-send.
export function startInviteLoop(cfg, app, { tickMs = TICK_MS } = {}) {
  let stopped = false;
  let timer = null;

  const tick = async () => {
    if (stopped) return;
    try {
      await drainOnce(cfg, app);
    } catch (e) {
      // A failure here is almost always Supabase being briefly unreachable.
      // Log and wait for the next tick — the rows are still pending.
      console.error('[scout] invite drain error', e?.message || e);
    }
    if (!stopped) timer = setTimeout(tick, tickMs);
  };

  timer = setTimeout(tick, tickMs);
  return () => { stopped = true; clearTimeout(timer); };
}
