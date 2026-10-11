// r2.js — a frame with more than 200 images signs them all (MEDIA-05). The
// module needs Supabase to load, so this pins the contract by source: the
// client's chunk size matches what the party actually honors, and flush
// posts chunks rather than every pending key at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const r2 = readFileSync(join(here, 'r2.js'), 'utf8');
const party = readFileSync(join(here, '..', '..', 'party', 'upload.ts'), 'utf8');

test('the client chunk equals the party cap', () => {
  const client = Number((r2.match(/export const SIGN_READS_MAX = (\d+);/) || [])[1]);
  const signReads = party.slice(party.indexOf('// POST /sign-reads'));
  const server = Number((signReads.match(/\.slice\(0, (\d+)\)/) || [])[1]);
  assert.ok(client > 0 && server > 0, 'both caps found');
  assert.ok(client <= server, `client chunks of ${client} fit the party's ${server}`);
});

test('flush posts one request per chunk, not every pending key', () => {
  const flush = r2.slice(r2.indexOf('async function flush()'), r2.indexOf('export function getSignedUrl'));
  assert.match(flush, /keys\.slice\(i, i \+ SIGN_READS_MAX\)/);
  assert.match(flush, /JSON\.stringify\(\{ keys: chunk \}\)/);
  assert.doesNotMatch(flush, /JSON\.stringify\(\{ keys \}\)/);
});
