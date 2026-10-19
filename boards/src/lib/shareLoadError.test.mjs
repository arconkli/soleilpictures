// shareLoadError — a network blip on a share link is not "revoked" (MEDIA-03).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleFailureKind, bundleHttpError } from './shareLoadError.js';

const here = dirname(fileURLToPath(import.meta.url));

test('only the server saying the link is gone reads as a dead link', () => {
  for (const s of [404, 400, 403, 410]) assert.equal(bundleFailureKind(bundleHttpError({ status: s })), 'invalid', String(s));
});

test('a dropped connection, a timeout or a 5xx is retryable', () => {
  assert.equal(bundleFailureKind(new TypeError('Load failed')), 'retry');
  assert.equal(bundleFailureKind(new TypeError('Failed to fetch')), 'retry');
  for (const s of [500, 502, 503, 504, 520, 522, 429]) assert.equal(bundleFailureKind(bundleHttpError({ status: s })), 'retry', String(s));
  assert.equal(bundleFailureKind(new SyntaxError('Unexpected end of JSON input')), 'retry');
  assert.equal(bundleFailureKind(null), 'retry');
});

test('the party passes a Supabase 5xx through instead of calling it a 404', () => {
  // Through lib/bundleRefusal.js, which also tells the RPCs' own refusal (a
  // P0002 that PostgREST sends as HTTP 500) from an outage; see its tests.
  const party = readFileSync(join(here, '..', '..', 'party', 'upload.ts'), 'utf8');
  const n = (party.match(/bundleRefusalStatus\(rpcRes\.status, msg\)/g) || []).length;
  assert.equal(n, 4, '/share-bundle, /public-bundle, /file-share and /doc-images');
});

test('the viewer keeps a retry state apart from the invalid one', () => {
  const view = readFileSync(join(here, '..', 'components', 'PublicBoardView.jsx'), 'utf8');
  assert.match(view, /bundleFailureKind\(/);
  assert.match(view, /status === 'error'/);
});
