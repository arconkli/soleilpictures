// uuid.test.mjs — the one uuid check the doc-link writers and readers share.
//
//   node --test src/lib/uuid.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { isUuid } from './uuid.js';

test('a uuid passes in either case', () => {
  assert.equal(isUuid('3f1c2a9e-8b7d-4c6e-9a1b-2c3d4e5f6a7b'), true);
  assert.equal(isUuid('3F1C2A9E-8B7D-4C6E-9A1B-2C3D4E5F6A7B'), true);
});

test('a doc card id that is not a uuid, and anything else, does not', () => {
  for (const v of [
    'doc-1730000000000-123456',
    '3f1c2a9e-8b7d-4c6e-9a1b-2c3d4e5f6a7',   // one short
    ' 3f1c2a9e-8b7d-4c6e-9a1b-2c3d4e5f6a7b', // padded
    '', null, undefined, 42, {},
  ]) assert.equal(isUuid(v), false, String(v));
});
