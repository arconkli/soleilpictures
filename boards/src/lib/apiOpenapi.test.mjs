// The OpenAPI document must describe the API that exists.
//
// It is a THIRD statement of the surface, after the router and the docs, and
// the only one a machine consumes: a pipeline TD generating a client from it
// gets exactly the endpoints it lists and none of the ones it forgot. A stale
// spec is worse than no spec, because it fails silently — the generated client
// simply has no method for the endpoint you need.
//
// So it is held to the `endpoints:` array the router already publishes, which
// is the list `GET /api/v1` answers with and therefore the one that cannot be
// allowed to be wrong.

import test from 'node:test';
import assert from 'node:assert/strict';
import { openapiDocument } from './apiOpenapi.js';
import { restEndpoints } from '../../scripts/lib/publicSurface.mjs';

const doc = openapiDocument('https://clusters.soleilpictures.com');

// `GET /boards?workspace=&…` → { method: 'get', path: '/boards' }
const parse = (line) => {
  const [method, rest] = line.split(/\s+/, 2);
  const path = rest.split('?')[0].split('{')[0].trim().replace(/\/$/, '') || '/';
  return { method: method.toLowerCase(), path };
};

// The router writes `:id`; OpenAPI writes `{id}`.
const toOpenApiPath = (p) => p.replace(/:([A-Za-z]+)/g, '{$1}');

test('the document is a valid OpenAPI 3.1 shell', () => {
  assert.match(doc.openapi, /^3\.1/);
  assert.ok(doc.info?.title);
  assert.ok(doc.servers?.[0]?.url);
  assert.ok(doc.components?.securitySchemes);
});

test('every published endpoint is in the spec', () => {
  const missing = [];
  for (const line of restEndpoints()) {
    const { method, path } = parse(line);
    const spec = doc.paths?.[toOpenApiPath(path)];
    if (!spec || !spec[method]) missing.push(`${method.toUpperCase()} ${toOpenApiPath(path)}`);
  }
  assert.deepEqual([...new Set(missing)], [],
    'these endpoints exist but are not in /api/v1/openapi.json — a generated client '
    + 'silently has no method for them');
});

test('the spec describes nothing that does not exist', () => {
  const real = new Set();
  for (const line of restEndpoints()) {
    const { method, path } = parse(line);
    real.add(`${method} ${toOpenApiPath(path)}`);
  }
  const ghosts = [];
  for (const [path, ops] of Object.entries(doc.paths || {})) {
    // `parameters` is a path-level key, not an operation.
    for (const method of Object.keys(ops).filter((k) => k !== 'parameters')) {
      if (!real.has(`${method} ${path}`)) ghosts.push(`${method.toUpperCase()} ${path}`);
    }
  }
  assert.deepEqual(ghosts, [], 'the spec promises endpoints the router does not serve');
});

test('every operation has an operationId, and they are unique', () => {
  // Generators name methods from these. A missing one produces something like
  // `getBoardsIdCards_1`, and a duplicate silently drops a method.
  const seen = new Set();
  for (const [path, ops] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(ops).filter(([k]) => k !== 'parameters')) {
      assert.ok(op.operationId, `${method.toUpperCase()} ${path} has no operationId`);
      assert.equal(seen.has(op.operationId), false, `duplicate operationId: ${op.operationId}`);
      seen.add(op.operationId);
      assert.ok(op.summary, `${method.toUpperCase()} ${path} has no summary`);
    }
  }
});
