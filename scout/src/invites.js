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
// OPENING A CONVERSATION WITH A STRANGER is `imessage(app).space.create(handle)`
// — checked against the installed SDK's own types, not guessed. It used to probe
// app.space / app.conversation / app.dm in order; none of the three exist (the
// instance carries only messages/send/edit/responding, and space.create lives on
// the PLATFORM instance), so every invite threw "provider exposes no way to open
// a space" and the whole signup drain was dead on arrival.
//
// ⚠️ STILL UNVERIFIED, but now for a policy reason rather than a naming one:
// whether Photon PERMITS a Pro project to initiate to an opted-in signup. Their
// pricing lists cold outreach as Business-tier while the deliverability docs
// give the same 50/day limit with no tier distinction. If they refuse, it fails
// SAFE — the row records the error and the landing page keeps saying people are
// on the list, which stays true.

import { text as textMsg } from 'spectrum-ts';
import { imessage } from 'spectrum-ts/providers/imessage';
import { scoutRpc } from '../../boards/src/lib/scoutDb.js';

// LATENCY AND PACING ARE SEPARATE KNOBS, and conflating them was the mistake in
// the first version: a 90s tick draining 3 at a time meant a lone signup — the
// overwhelmingly common case — waited up to a minute and a half for the text it
// had just asked for, while a backlog still went out in visible clumps of three.
// Both are backwards.
//
// Poll FAST, send ONE. A single signup is now texted within ~10s of submitting,
// which is what someone staring at "we'll text you" expects. Sustained rate is
// capped by the batch size instead: one per tick is at most 6/min, and the
// 40/day ceiling in app_config binds long before anything looks like a blast.
// A backlog trickles rather than bursts, which is what protects the line.
const TICK_MS = Number(process.env.SCOUT_INVITE_TICK_MS || 10_000);
// Per tick. Keep this at 1 unless a backlog genuinely needs draining — raising
// it is what turns a trickle into a burst.
const BATCH = Number(process.env.SCOUT_INVITE_BATCH || 1);
// Between individual sends inside a batch. Only relevant when BATCH > 1.
const GAP_MS = Number(process.env.SCOUT_INVITE_GAP_MS || 6_000);

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
//
// `space.create` resolves an existing 1:1 conversation or makes one, and takes
// the same E.164 handle format the inbound stream reports — so a signup who has
// coincidentally already texted us lands in their existing thread rather than a
// second one.
async function sendInvite(app, phone) {
  const space = await imessage(app).space.create(phone);
  if (!space || typeof space.send !== 'function') {
    throw new Error('could not open a conversation with that number');
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
