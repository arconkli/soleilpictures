// Outbound webhooks: signing, fan-out, delivery and retry.
//
// WHY AN OUTBOX. The alternative — POST from the request that caused the change
// — only ever fires for changes made through /api/v1, and most changes are not.
// Someone drags a card on the canvas and an integration watching for that hears
// nothing. So events are written by STATEMENT-level triggers on `boards` and
// `card_index` (0222), and card_index is written by both the browser
// (boardsApi.js:syncCardIndex) and the API (cardEncode.js:buildCardIndexRows) —
// which means an edit made in the app fires a webhook too. That is the
// difference between a demo and something a pipeline TD will trust.
//
// The triggers are statement level with transition tables so a 1000-card batch
// emits ONE event carrying a count, not 1000, and every emit is guarded by an
// EXISTS against an active webhook so a workspace with none pays one index probe
// and writes nothing.
//
// WHY THIS SIGNATURE SCHEME. It is Frame.io's, deliberately: HMAC-SHA256 over
// `v0:{timestamp}:{body}`, signature in a header as `v0=…`, timestamp beside it,
// five-minute replay window. Integrators in this industry have already written
// the verifier once. Being novel here would cost them work and buy nothing.
//
// WHY THE DELIVERY LOG. It is ShotGrid's surface — list deliveries, inspect one,
// redeliver — because that is what facilities actually rely on when something
// did not arrive, and "we sent it" without a record is not an answer.

import { scoutSelect, scoutInsert, scoutPatch, scoutRpc } from './scoutDb.js';
import { publicHttpsUrlProblem } from './safeUrl.js';
import { jobFailed } from './workerErrors.js';

// The database, injectable. Not for ceremony: fan-out and retry are the parts
// where a mistake is a silent non-delivery or an infinite retry, and both are
// pure decisions over rows. Passing the three calls in means those decisions can
// be tested for real rather than described in a comment.
const REAL_DB = { select: scoutSelect, insert: scoutInsert, patch: scoutPatch, rpc: scoutRpc };

// How long a claimed delivery stays out of every other drain's reach. It must
// outlast the invocation holding it, or a slow batch is re-claimed under the
// drain still sending it. It should not outlast it by much, because a drain
// that dies mid-batch strands its unsent rows until the lease runs out. So the
// lease follows the caller: the cron drain can run up to 15 minutes, and gets
// 900s; the drain after an API write lives inside waitUntil, which Cloudflare
// stops about 30s after the response, so it gets 60s — never re-claimed under
// itself, and what it could not reach goes back out about as fast as the
// minute cron would have sent it anyway (2026-10-11 review of API-10).
const DELIVERY_LEASE_SECONDS = 900;
export const AFTER_WRITE_LEASE_SECONDS = 60;

// The drain an API write kicks off. One object so worker-api.js and the test
// that pins its lease cannot drift apart.
export const AFTER_WRITE_DRAIN = { limit: 50, leaseSeconds: AFTER_WRITE_LEASE_SECONDS };

// The claim RPCs arrive with 0409. Until it is applied, PostgREST answers
// "no such function" and the unclaimed path below still works, so this file
// can ship before the migration does. Once 0409 is live the fallbacks are dead
// code and can go.
const missingFunction = (e) => e?.status === 404
  || /PGRST202|could not find the function/i.test(`${e?.body || ''} ${e?.message || ''}`);

export const MAX_ATTEMPTS = 6;
export const REPLAY_WINDOW_SECONDS = 300;
// Consecutive failures before a hook is switched off. High enough to survive an
// afternoon of someone else's downtime, low enough that a URL that has been dead
// for a week stops costing anything.
export const DISABLE_AFTER_FAILURES = 20;

// Each one is written by a trigger in the migrations (webhook_emit_*: 0222,
// 0702, 0703), so a change made in the app fires it as one made here does.
// webhooks.test.mjs holds the two lists to each other: a name offered here and
// written by nothing would be a subscription that never fires.
export const WEBHOOK_EVENTS = [
  'board.created', 'board.updated', 'board.deleted', 'board.restored',
  'card.created', 'card.updated', 'card.deleted', 'card.moved',
  'image.created',
  'comment.created', 'comment.updated', 'comment.resolved', 'comment.reopened',
  'comment.deleted', 'comment.restored',
  'tag.applied', 'tag.removed',
];

// 1m, 5m, 25m, 2h, 10h — bounded exponential, so a receiver that is down for a
// working day still gets its events when it comes back.
const backoffSeconds = (attempt) => Math.min(60 * (5 ** (attempt - 1)), 36000);

// ── Signing ──────────────────────────────────────────────────────────────────

export async function signBody(secret, timestamp, body) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(`v0:${timestamp}:${body}`));
  return `v0=${[...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

// Exported so the docs can point at a verifier that is literally the one used
// here, and so it can be tested without a live receiver.
export async function verifySignature(secret, header, timestamp, body, nowSeconds) {
  const age = Math.abs(Number(nowSeconds) - Number(timestamp));
  if (!Number.isFinite(age) || age > REPLAY_WINDOW_SECONDS) return false;
  const expected = await signBody(secret, timestamp, body);
  // Constant time: a byte-by-byte early return leaks the signature one
  // character at a time to anyone willing to time the responses.
  if (expected.length !== String(header).length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ String(header).charCodeAt(i);
  }
  return diff === 0;
}

// ── URL validation ───────────────────────────────────────────────────────────

// A webhook URL is caller-supplied and we fetch it from our own IP on a
// schedule, which is the shape of an SSRF / open proxy. Same posture as the
// /api/og guard in worker.js: https only, default port only, and no host we can
// see is local. We cannot resolve DNS before fetching in a Worker, so a name
// that resolves to a private address is the residual — which is why the scheme
// and port limits carry the weight.
// The SSRF rule lives in safeUrl.js, because the importer asks the identical
// question about a URL the server is about to fetch. Kept as a named export so
// the message stays webhook-shaped at the call site.
export function webhookUrlProblem(raw) {
  const problem = publicHttpsUrlProblem(raw);
  return problem ? `url ${problem}` : null;
}

// ── Fan-out ──────────────────────────────────────────────────────────────────

// Turn outbox events into per-webhook deliveries.
//
// One event becomes N deliveries, one per subscribed hook, because each has its
// own secret, its own retry state and its own delivery record. A shared row
// would make "did hook B get it?" unanswerable.
//
// Overlapping drains are the normal case — every API write ends with one, and
// the cron runs beside them — so the events are CLAIMED: webhook_fan_out (0409)
// takes them with FOR UPDATE SKIP LOCKED, marks them fanned and writes their
// deliveries in one statement, building the same payload as the code below.
// Selecting then marking afterwards let two drains fan out the same events and
// every receiver got them twice (2026-10-11 audit, API-10).
export async function fanOutEvents(env, { limit = 500, db = REAL_DB } = {}) {
  if (db.rpc) {
    try {
      const rows = await db.rpc(env, 'webhook_fan_out', { p_limit: limit });
      const r = (Array.isArray(rows) ? rows[0] : rows) || {};
      return { events: Number(r.events) || 0, deliveries: Number(r.deliveries) || 0 };
    } catch (e) {
      if (!missingFunction(e)) throw e;
    }
  }

  const events = await db.select(env, 'webhook_events',
    `fanned_at=is.null&select=id,workspace_id,board_id,event,resource,created_at`
    + `&order=id.asc&limit=${limit}`);
  if (!events?.length) return { events: 0, deliveries: 0 };

  const workspaces = [...new Set(events.map((e) => e.workspace_id))];
  const hooks = await db.select(env, 'webhooks',
    `active=is.true&workspace_id=in.(${workspaces.join(',')})`
    + '&select=id,workspace_id,events');

  const byWorkspace = new Map();
  for (const h of hooks || []) {
    if (!byWorkspace.has(h.workspace_id)) byWorkspace.set(h.workspace_id, []);
    byWorkspace.get(h.workspace_id).push(h);
  }

  const deliveries = [];
  for (const e of events) {
    for (const h of byWorkspace.get(e.workspace_id) || []) {
      // `*` subscribes to everything, including events added later — which is
      // what a general-purpose sync wants, and what a narrow integration should
      // not have.
      if (!h.events.includes(e.event) && !h.events.includes('*')) continue;
      deliveries.push({
        webhook_id: h.id,
        event_id: e.id,
        event: e.event,
        payload: {
          type: e.event,
          // Thin on purpose, and the same shape Frame.io uses: an id and enough
          // context to know where to look. A fat payload is a second, stale
          // copy of the truth — call back and read the current state.
          resource: { type: e.event.split('.')[0], id: e.resource?.id ?? e.board_id ?? null },
          workspace: { id: e.workspace_id },
          board: e.board_id ? { id: e.board_id } : null,
          data: e.resource || {},
          occurred_at: e.created_at,
        },
      });
    }
  }

  if (deliveries.length) {
    for (let i = 0; i < deliveries.length; i += 500) {
      await db.insert(env, 'webhook_deliveries', deliveries.slice(i, i + 500));
    }
  }
  // Marked fanned even when nothing matched: the event has been considered, and
  // leaving it pending would make the outbox grow without bound for any
  // workspace whose only hook is narrowly subscribed.
  const now = new Date().toISOString();
  await db.patch(env, 'webhook_events',
    `id=in.(${events.map((e) => e.id).join(',')})`, { fanned_at: now });

  return { events: events.length, deliveries: deliveries.length };
}

// ── Delivery ─────────────────────────────────────────────────────────────────

// Take the due deliveries this drain will send. With 0409 they are LEASED —
// next_attempt_at pushed out under SKIP LOCKED before anything is POSTed — so a
// second drain running at the same moment takes different rows instead of the
// same ones. `id` narrows the claim to one delivery.
async function claimDue(env, { limit, now, db, id = null, leaseSeconds = DELIVERY_LEASE_SECONDS }) {
  if (db.rpc) {
    try {
      return await db.rpc(env, 'webhook_deliveries_claim', {
        p_limit: limit, p_lease_seconds: leaseSeconds, p_id: id,
      }) || [];
    } catch (e) {
      if (!missingFunction(e)) throw e;
    }
  }
  return await db.select(env, 'webhook_deliveries',
    `delivered_at=is.null&next_attempt_at=lte.${new Date(now).toISOString()}`
    + (id ? `&id=eq.${id}` : '')
    + '&select=id,webhook_id,event,payload,attempt'
    + `&order=next_attempt_at.asc&limit=${limit}`) || [];
}

export async function deliverDue(env, {
  limit = 100, fetchImpl = fetch, now = Date.now(), db = REAL_DB, leaseSeconds,
} = {}) {
  const due = await claimDue(env, { limit, now, db, leaseSeconds });
  const { outcomes: _perRow, ...counts } = await deliverRows(env, due, { fetchImpl, db });
  return counts;
}

// Send ONE delivery now, and say what happened to it.
//
// POST /webhooks/:id/test used to insert its row and then run a general drain
// of the 25 oldest due deliveries across every workspace. With a backlog of
// retries anywhere, the test row was not among them: nothing was sent, and the
// response still said `sent: true` beside counts that belonged to other
// people's hooks (2026-10-11 audit, API-17). `outcome` is null when the row
// was not claimable — already delivered, or held by another drain.
export async function deliverOne(env, id, { fetchImpl = fetch, now = Date.now(), db = REAL_DB } = {}) {
  const due = await claimDue(env, { limit: 1, now, db, id });
  const out = await deliverRows(env, due.filter((d) => d.id === id), { fetchImpl, db });
  return { ...out, outcome: out.outcomes[0] || null };
}

async function deliverRows(env, due, { fetchImpl = fetch, db = REAL_DB } = {}) {
  const outcomes = [];
  if (!due?.length) return { attempted: 0, delivered: 0, failed: 0, outcomes };

  const hookIds = [...new Set(due.map((d) => d.webhook_id))];
  const hooks = await db.select(env, 'webhooks',
    `id=in.(${hookIds.join(',')})&select=id,url,secret,active,failure_count`);
  const byId = new Map((hooks || []).map((h) => [h.id, h]));

  let delivered = 0;
  let failed = 0;
  for (const d of due) {
    const hook = byId.get(d.webhook_id);
    if (!hook || !hook.active) {
      await db.patch(env, 'webhook_deliveries', `id=eq.${d.id}`, {
        delivered_at: new Date().toISOString(),
        error: 'webhook is inactive',
      });
      outcomes.push({ id: d.id, delivered: false, status: null, attempt: d.attempt || 0, error: 'webhook is inactive' });
      continue;
    }

    // Re-checked at delivery, not only when saved. A hook saved under an older,
    // looser rule (before 2026-10-02 it let [::ffff:…], CGNAT, .lan and
    // .home.arpa through) must not be POSTed to because it was once accepted.
    // It is switched off at once, with the reason: the URL can never pass, so
    // the usual 25 retries would only be 25 more attempts to send it there.
    const urlProblem = webhookUrlProblem(hook.url);
    if (urlProblem) {
      failed++;
      const notSent = `not sent: the webhook ${urlProblem}`.slice(0, 300);
      await db.patch(env, 'webhook_deliveries', `id=eq.${d.id}`, {
        delivered_at: new Date().toISOString(), attempt: (d.attempt || 0) + 1,
        error: notSent,
      });
      outcomes.push({ id: d.id, delivered: false, status: null, attempt: (d.attempt || 0) + 1, error: notSent });
      if (hook.active) {
        hook.active = false;
        await db.patch(env, 'webhooks', `id=eq.${hook.id}`, {
          active: false,
          disabled_reason: `the webhook ${urlProblem} — point it at a public https address`.slice(0, 300),
        });
      }
      continue;
    }

    const body = JSON.stringify(d.payload);
    const ts = Math.floor(Date.now() / 1000);
    const signature = await signBody(hook.secret, ts, body);
    const attempt = (d.attempt || 0) + 1;
    const started = Date.now();

    let status = null;
    let error = null;
    try {
      const res = await fetchImpl(hook.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'soleil-clusters-webhooks/1',
          'x-soleil-signature': signature,
          'x-soleil-request-timestamp': String(ts),
          'x-soleil-event': d.event,
          'x-soleil-delivery': d.id,
        },
        body,
        // Never follow a redirect. The URL was checked when the webhook was
        // saved; a receiver that 302s us somewhere else would send a signed
        // body to an address that check never saw (fetch's default is to
        // follow). A 3xx is a failure that names itself, so the owner fixes
        // the URL rather than the delivery silently going elsewhere.
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      });
      status = res.status;
      if (res.status >= 300 && res.status < 400) {
        error = `receiver answered ${res.status} (a redirect) — webhooks are never redirected; update the webhook URL to the final address`;
      } else if (!res.ok) error = `receiver answered ${res.status}`;
    } catch (e) {
      error = String(e?.message || e).slice(0, 300);
    }

    const ms = Date.now() - started;
    outcomes.push({ id: d.id, delivered: !error, status, attempt, response_ms: ms, error });
    if (!error) {
      delivered++;
      await db.patch(env, 'webhook_deliveries', `id=eq.${d.id}`, {
        delivered_at: new Date().toISOString(), status, attempt, response_ms: ms, error: null,
      });
      // A success clears the failure streak, so a hook is only ever disabled
      // for being CONSISTENTLY dead, not for a bad afternoon.
      if (hook.failure_count) {
        await db.patch(env, 'webhooks', `id=eq.${hook.id}`, { failure_count: 0 });
      }
    } else {
      failed++;
      const exhausted = attempt >= MAX_ATTEMPTS;
      await db.patch(env, 'webhook_deliveries', `id=eq.${d.id}`, {
        status, attempt, response_ms: ms, error,
        // An exhausted delivery is stamped delivered_at so it stops being
        // selected, and keeps its error so the log says what happened rather
        // than going quiet.
        ...(exhausted
          ? { delivered_at: new Date().toISOString() }
          : { next_attempt_at: new Date(Date.now() + backoffSeconds(attempt) * 1000).toISOString() }),
      });
      const streak = (hook.failure_count || 0) + 1;
      hook.failure_count = streak;
      if (streak >= DISABLE_AFTER_FAILURES) {
        await db.patch(env, 'webhooks', `id=eq.${hook.id}`, {
          active: false,
          failure_count: streak,
          disabled_reason: `${streak} consecutive failures — last: ${error}`.slice(0, 300),
        });
      } else {
        await db.patch(env, 'webhooks', `id=eq.${hook.id}`, { failure_count: streak });
      }
    }
  }
  return { attempted: due.length, delivered, failed, outcomes };
}

// One pass: fan out what is new, then deliver what is due. Called from the
// minute cron, and opportunistically after an API write so an API-driven event
// leaves in milliseconds rather than waiting for the next tick.
export async function runWebhooks(env, opts = {}) {
  const fan = await fanOutEvents(env, opts).catch(async (e) => {
    console.error('[webhooks] fan-out failed', e?.message);
    await jobFailed(env, 'webhooks', e, 'fan_out');
    return { events: 0, deliveries: 0 };
  });
  const sent = await deliverDue(env, opts).catch(async (e) => {
    console.error('[webhooks] delivery failed', e?.message);
    await jobFailed(env, 'webhooks', e, 'delivery');
    return { attempted: 0, delivered: 0, failed: 0 };
  });
  return { ...fan, ...sent };
}

// Whether anything is worth waking up for. Cheap enough to call on every API
// write; skips the whole machine for the overwhelming majority of workspaces,
// which have no webhooks at all.
export async function hasPendingWork(env) {
  const rows = await scoutSelect(env, 'webhook_events', 'fanned_at=is.null&select=id&limit=1')
    .catch(() => null);
  return !!rows?.length;
}
