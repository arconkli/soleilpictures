import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bundleRefusalStatus } from './bundleRefusal.js';
import { bundleFailureKind } from './shareLoadError.js';

const kind = (status, body) => bundleFailureKind({ status: bundleRefusalStatus(status, body) });

test('an expired share link is dead, though PostgREST says 500', () => {
  // Exactly what PostgREST returned on 2026-10-17 for an unknown token / slug.
  const expired = '{"code":"P0002","details":null,"hint":null,"message":"invalid or expired share link"}';
  const unpublished = '{"code":"P0002","details":null,"hint":null,"message":"no such public board"}';
  assert.equal(bundleRefusalStatus(500, expired), 404);
  assert.equal(bundleRefusalStatus(500, unpublished), 404);
  assert.equal(kind(500, expired), 'invalid');
  // A malformed token is the database answering too.
  assert.equal(bundleRefusalStatus(400, '{"code":"22P02","message":"invalid input syntax for type uuid"}'), 404);
  assert.equal(bundleRefusalStatus(500, '{"code":"P0001","message":"link suspended"}'), 404);
});

test('an outage stays retryable', () => {
  assert.equal(bundleRefusalStatus(503, '{"code":"PGRST002","message":"Could not query the database for the schema cache"}'), 503);
  assert.equal(bundleRefusalStatus(500, '{"code":"57014","message":"canceling statement due to statement timeout"}'), 500);
  assert.equal(bundleRefusalStatus(500, '{"code":"40P01","message":"deadlock detected"}'), 500);
  assert.equal(bundleRefusalStatus(502, '<html>Bad gateway</html>'), 502);
  assert.equal(bundleRefusalStatus(504, ''), 504);
  assert.equal(kind(504, ''), 'retry');
  assert.equal(kind(500, '{"code":"08006","message":"connection failure"}'), 'retry');
});

test('the upload party decides with it, on both bundle routes', () => {
  const src = readFileSync(new URL('../../party/upload.ts', import.meta.url), 'utf8');
  assert.match(src, /from "\.\.\/src\/lib\/bundleRefusal\.js"/);
  assert.equal((src.match(/bundleRefusalStatus\(rpcRes\.status, msg\)/g) || []).length, 2);
  assert.doesNotMatch(src, /rpcRes\.status >= 500 \? rpcRes\.status : 404/);
});
