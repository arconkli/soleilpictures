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

import { scoutSelect, scoutInsert, scoutPatch } from './scoutDb.js';

// The database, injectable. Not for ceremony: fan-out and retry are the parts
// where a mistake is a silent non-delivery or an infinite retry, and both are
// pure decisions over rows. Passing the three calls in means those decisions can
// be tested for real rather than described in a comment.
const REAL_DB = { select: scoutSelect, insert: scoutInsert, patch: scoutPatch };

export const MAX_ATTEMPTS = 6;
export const REPLAY_WINDOW_SECONDS = 300;
// Consecutive failures before a hook is switched off. High enough to survive an
// afternoon of someone else's downtime, low enough that a URL that has been dead
// for a week stops costing anything.
export const DISABLE_AFTER_FAILURES = 20;

export const WEBHOOK_EVENTS = [
  'board.created', 'board.updated', 'board.deleted', 'board.restored',
  'card.created', 'card.updated', 'card.deleted', 'card.moved',
  'image.created',
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

const BLOCKED_HOSTS = new Set([
  'localhost', 'localhost.localdomain', '127.0.0.1', '0.0.0.0', '[::1]', '::1',
  'metadata.google.internal', 'metadata.goog',
]);

// A webhook URL is caller-supplied and we fetch it from our own IP on a
// schedule, which is the shape of an SSRF / open proxy. Same posture as the
// /api/og guard in worker.js: https only, default port only, and no host we can
// see is local. We cannot resolve DNS before fetching in a Worker, so a name
// that resolves to a private address is the residual — which is why the scheme
// and port limits carry the weight.
export function webhookUrlProblem(raw) {
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    return 'url must be an absolute https URL';
  }
  if (u.protocol !== 'https:') return 'url must use https';
  if (u.port && u.port !== '443') return 'url must use the default port';
  const host = u.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host) || host.endsWith('.local') || host.endsWith('.internal')) {
    return 'url must be a public host';
  }
  if (/^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) {
    return 'url must be a public host';
  }
  return null;
}

// ── Fan-out ──────────────────────────────────────────────────────────────────

// Turn outbox events into per-webhook deliveries.
//
// One event becomes N deliveries, one per subscribed hook, because each has its
// own secret, its own retry state and its own delivery record. A shared row
// would make "did hook B get it?" unanswerable.
export async function fanOutEvents(env, { limit = 500, db = REAL_DB } = {}) {
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

export async function deliverDue(env, { limit = 100, fetchImpl = fetch, now = Date.now(), db = REAL_DB } = {}) {
  const due = await db.select(env, 'webhook_deliveries',
    `delivered_at=is.null&next_attempt_at=lte.${new Date(now).toISOString()}`
    + '&select=id,webhook_id,event,payload,attempt'
    + `&order=next_attempt_at.asc&limit=${limit}`);
  if (!due?.length) return { attempted: 0, delivered: 0, failed: 0 };

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
        signal: AbortSignal.timeout(10_000),
      });
      status = res.status;
      if (!res.ok) error = `receiver answered ${res.status}`;
    } catch (e) {
      error = String(e?.message || e).slice(0, 300);
    }

    const ms = Date.now() - started;
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
  return { attempted: due.length, delivered, failed };
}

// One pass: fan out what is new, then deliver what is due. Called from the
// minute cron, and opportunistically after an API write so an API-driven event
// leaves in milliseconds rather than waiting for the next tick.
export async function runWebhooks(env, opts = {}) {
  const fan = await fanOutEvents(env, opts).catch((e) => {
    console.error('[webhooks] fan-out failed', e?.message);
    return { events: 0, deliveries: 0 };
  });
  const sent = await deliverDue(env, opts).catch((e) => {
    console.error('[webhooks] delivery failed', e?.message);
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
