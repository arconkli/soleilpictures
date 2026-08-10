// /api/v1 — what a stranger is told when something goes wrong.
//
// The API reaches Postgres two different ways, and the second one used to
// bypass all of this:
//
//   · AS THE USER  — userSelect/userRpc/… in lib/apiAuth.js
//   · AS THE SERVICE ROLE — lib/scoutDb.js, used by EVERY card mutation,
//     because cards live in a Y.Doc and the triple write cannot run under RLS.
//
// scoutDb throws its own shape and worker-api.js returned e.message verbatim
// for any 4xx, so hitting the card cap — the most common failure in the whole
// product — answered with this:
//
//   403 {"error":"insert card_index 403: {\"code\":\"42501\",…}","code":"bad_request"}
//
// Raw envelope, table name, SQLSTATE, wrong status, useless code, and the
// documentation promised 402 `limit_reached`. Curating one path and not the
// other is exactly how that happens, so there is now one function and these
// tests pin what comes out of it.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describeUpstreamError, normalizeApiError } from '../src/lib/apiAuth.js';
import { openapiDocument } from '../src/lib/apiOpenapi.js';

const pg = (code, message) => JSON.stringify({ code, details: null, hint: null, message });

test('the card cap is a 402 a caller can act on', () => {
  const out = describeUpstreamError(403,
    pg('42501', 'Demo accounts are limited to 100 cards. Invite friends or upgrade to add more.'));
  expect(out.status).toBe(402);
  expect(out.code).toBe('limit_reached');
  // Our own words survive — they are the reason a 402 is useful.
  expect(out.message).toBe('Demo accounts are limited to 100 cards. Invite friends or upgrade to add more.');
});

test('the storage quota is also a 402', () => {
  const out = describeUpstreamError(403, pg('42501', 'this workspace is over_quota'));
  expect(out.status).toBe(402);
  expect(out.code).toBe('limit_reached');
});

test('nothing internal survives into a message', () => {
  for (const raw of [
    'insert card_index 403: {"code":"42501"}',
    pg('42P01', 'relation "public.secret_table" does not exist'),
    pg('23503', 'insert or update on table "boards" violates foreign key constraint "boards_workspace_id_fkey"'),
    pg('42501', 'new row violates row-level security policy for table "images"'),
    '{"code":"XX000","message":"internal: connection to 10.0.0.4:5432 failed"}',
  ]) {
    const { message } = describeUpstreamError(403, raw);
    expect(message).not.toMatch(/card_index|secret_table|_fkey|row-level security|10\.0\.0/);
    expect(message).not.toMatch(/^\w+ \w+ \d{3}:/);   // the "insert card_index 403:" shape
  }
});

test('an RLS refusal names nothing', () => {
  const out = describeUpstreamError(403, pg('42501', 'new row violates row-level security policy for table "images"'));
  expect(out.status).toBe(403);
  expect(out.code).toBe('forbidden');
  expect(out.message).toBe('your account cannot do that');
});

test('an HTML page is something in front of the database, not the database', () => {
  // Supabase sits behind Cloudflare. Its WAF answers a query string that looks
  // like SQL injection ("or 1=1 --") with an HTML block page. Calling that
  // "your account cannot do that" sends someone to debug permissions that are
  // fine, so it points outward instead.
  const out = describeUpstreamError(403, '<!DOCTYPE html>\n<html><body>Attention Required</body></html>');
  expect(out.status).toBe(502);
  expect(out.code).toBe('upstream_rejected');
  expect(out.message).toMatch(/rewording/);
});

test('ordinary statuses map to codes a client can branch on', () => {
  expect(describeUpstreamError(404, '').code).toBe('not_found');
  expect(describeUpstreamError(409, '').code).toBe('conflict');
  expect(describeUpstreamError(400, '').code).toBe('bad_request');
  expect(describeUpstreamError(401, '').status).toBe(403);
  expect(describeUpstreamError(500, '').status).toBe(500);
  expect(describeUpstreamError(500, '').message).toBe('something went wrong on our end');
});

test('an empty body never crashes the normalizer', () => {
  for (const raw of [undefined, null, '', 'not json at all', '[]', '{}']) {
    const out = describeUpstreamError(403, raw);
    expect(typeof out.message).toBe('string');
    expect(out.message.length).toBeGreaterThan(0);
  }
});

// ── normalizeApiError: the three shapes an error arrives in ──────────────────

test('our own refusals pass through untouched', () => {
  const e = Object.assign(new Error('board id must be a uuid'), { status: 400, code: 'bad_request' });
  expect(normalizeApiError(e)).toEqual({ status: 400, code: 'bad_request', message: 'board id must be a uuid' });
});

test('a scoutDb throw is curated by its raw body', () => {
  // Exactly what lib/scoutDb.js produces on a cap hit: a raw message plus the
  // PostgREST body on .body.
  const e = Object.assign(
    new Error('insert card_index 403: {"code":"42501","message":"Demo accounts are limited to 100 cards."}'),
    { status: 403, body: pg('42501', 'Demo accounts are limited to 100 cards.'), isCapHit: true },
  );
  const out = normalizeApiError(e);
  expect(out.status).toBe(402);
  expect(out.code).toBe('limit_reached');
  expect(out.message).toBe('Demo accounts are limited to 100 cards.');
  expect(out.message).not.toContain('card_index');
});

test('an unexpected throw becomes a 500 that says nothing', () => {
  const out = normalizeApiError(new TypeError('cannot read properties of undefined (reading foo)'));
  expect(out.status).toBe(500);
  expect(out.code).toBe('internal_error');
  expect(out.message).toBe('something went wrong on our end');
  expect(out.message).not.toMatch(/undefined|TypeError/);
});

test('a failed session is distinguishable from a broken route', () => {
  const e = Object.assign(new Error('could not open a session for that account'),
    { status: 502, code: 'session_unavailable' });
  expect(normalizeApiError(e)).toEqual({
    status: 502, code: 'session_unavailable', message: 'could not open a session for that account',
  });
});

// ── the spec and the router must describe the same API ───────────────────────
//
// There are two hand-written descriptions of this surface — the `endpoints`
// list that GET /api/v1 returns, and the OpenAPI document — plus the router
// itself. A spec that drifts is worse than no spec, because it is confidently
// wrong, and nothing else in this repo would notice.

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER_API = readFileSync(join(HERE, '..', 'src', 'worker-api.js'), 'utf8');

// The `endpoints:` array in the index route, as the strings it actually ships.
function indexEndpoints() {
  // A BALANCED scan, not a non-greedy regex. The list now carries example
  // payloads — {"board_ids":[…]}, {"items":[{"url":…}]} — whose own brackets
  // ended /[\s\S]*?\]/ at the first `]` it met, truncating the block mid-array
  // so every endpoint after that line simply vanished. The comparison was then
  // between the whole OpenAPI document and half an index.
  const start = WORKER_API.indexOf('[', WORKER_API.indexOf('endpoints: ['));
  let depth = 0;
  let end = start;
  for (let i = start; i < WORKER_API.length; i++) {
    if (WORKER_API[i] === '[') depth++;
    else if (WORKER_API[i] === ']' && --depth === 0) { end = i; break; }
  }
  const block = WORKER_API.slice(start + 1, end);
  // The path stops at whitespace: everything after it is an example payload or
  // a prose note, not part of the route.
  return [...block.matchAll(/'([A-Z]+)\s+(\/[^'\s]*)/g)]
    .map(([, method, path]) => `${method} ${path.split('?')[0]}`);
}

// OpenAPI paths, flattened to "METHOD /path" with {id} → :id so the two
// notations can be compared at all.
function openapiEndpoints() {
  const doc = openapiDocument('https://example.com');
  const out = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of Object.keys(item)) {
      if (method === 'parameters') continue;
      out.push(`${method.toUpperCase()} ${path.replace(/\{(\w+)\}/g, ':$1')}`);
    }
  }
  return out;
}

test('every documented endpoint is one the index advertises', () => {
  const index = new Set(indexEndpoints());
  const missing = openapiEndpoints().filter((e) => !index.has(e));
  expect(missing, `in OpenAPI but not in the index list: ${missing.join(', ')}`).toEqual([]);
});

test('every advertised endpoint is documented', () => {
  const spec = new Set(openapiEndpoints());
  const missing = indexEndpoints().filter((e) => !spec.has(e));
  expect(missing, `advertised but absent from OpenAPI: ${missing.join(', ')}`).toEqual([]);
});

test('the spec is servable and self-describing', () => {
  const doc = openapiDocument('https://clusters.soleilpictures.com');
  expect(doc.openapi).toBe('3.1.0');
  expect(doc.servers[0].url).toBe('https://clusters.soleilpictures.com/api/v1');
  expect(doc.components.securitySchemes.bearerAuth.scheme).toBe('bearer');
  // Every response the router can actually produce must be a code the spec
  // admits exists, or a client cannot branch on what it is told.
  const declared = new Set(doc.components.schemas.Error.properties.code.enum);
  for (const code of ['limit_reached', 'insufficient_scope', 'upstream_rejected',
    'rate_limited', 'invalid_token', 'not_found', 'conflict', 'bad_request',
    'payload_too_large', 'unsupported_media_type', 'session_unavailable',
    'storage_unavailable', 'method_not_allowed', 'forbidden', 'internal_error',
    'upstream_error', 'idempotency_in_progress']) {
    expect(declared.has(code), `Error.code enum is missing ${code}`).toBe(true);
  }
});

test('the codes the router emits are all declared', () => {
  // Every fail(status, 'code', …) literal in the router.
  const emitted = new Set([...WORKER_API.matchAll(/fail\(\s*\d+\s*,\s*'([a-z_]+)'/g)].map((m) => m[1]));
  const declared = new Set(openapiDocument('https://example.com')
    .components.schemas.Error.properties.code.enum);
  const undeclared = [...emitted].filter((c) => !declared.has(c));
  expect(undeclared, `router emits codes the spec never mentions: ${undeclared.join(', ')}`).toEqual([]);
});
