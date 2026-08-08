// The MCP server's idempotency keys.
//
// The bug this pins: the key was `crypto.randomUUID()` per request, while the
// comment above it and mcp/README.md both promised a retry would replay rather
// than repeat. It did the opposite — every attempt got a fresh key, so a model
// re-issuing add_cards after a timeout added the cards twice.
//
// Tested here rather than through the server because it is one pure function
// and the property is exact: same call → same key, different call → different
// key, different process → different key.

import { test, expect } from '@playwright/test';
import { idempotencyKey, RUN_ID } from '../../mcp/src/idempotency.js';

test('the same call produces the same key — this is the whole point', () => {
  const args = { board_id: 'b1', cards: [{ title: 'Scene 4' }] };
  return Promise.all([
    idempotencyKey('add_cards', args),
    idempotencyKey('add_cards', args),
  ]).then(([a, b]) => {
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

test('a different payload is a different call', async () => {
  const a = await idempotencyKey('add_cards', { board_id: 'b1', cards: [{ title: 'one' }] });
  const b = await idempotencyKey('add_cards', { board_id: 'b1', cards: [{ title: 'two' }] });
  expect(a).not.toBe(b);
});

test('the same payload to a different board is a different call', async () => {
  const a = await idempotencyKey('add_cards', { board_id: 'b1', cards: [{ title: 'x' }] });
  const b = await idempotencyKey('add_cards', { board_id: 'b2', cards: [{ title: 'x' }] });
  expect(a).not.toBe(b);
});

test('the same payload through a different tool is a different call', async () => {
  const a = await idempotencyKey('add_cards', { x: 1 });
  const b = await idempotencyKey('move_cards', { x: 1 });
  expect(a).not.toBe(b);
});

test('a later process can repeat a write on purpose', async () => {
  // The API remembers keys for 24 hours. Without the run id, "add the same note
  // again tomorrow" would silently return yesterday's card and add nothing.
  const args = { board_id: 'b1', cards: [{ title: 'daily standup' }] };
  const today = await idempotencyKey('add_cards', args, 'run-one');
  const tomorrow = await idempotencyKey('add_cards', args, 'run-two');
  expect(today).not.toBe(tomorrow);
});

test('a run id exists and is a uuid', () => {
  expect(RUN_ID).toMatch(/^[0-9a-f-]{36}$/);
});

test('no-argument tools still get a stable key', async () => {
  expect(await idempotencyKey('whoami', undefined))
    .toBe(await idempotencyKey('whoami', undefined));
  // undefined and {} are the same call, and must not be two different keys.
  expect(await idempotencyKey('whoami', undefined)).toBe(await idempotencyKey('whoami', {}));
});
