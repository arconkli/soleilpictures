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
import { describeUpstreamError, normalizeApiError } from '../src/lib/apiAuth.js';

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
