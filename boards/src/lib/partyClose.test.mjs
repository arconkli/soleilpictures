import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { answerEmptyClose } from './partyClose.js';

const conn = () => {
  const calls = [];
  return { calls, close: (code, reason) => calls.push([code, reason]) };
};

test('an empty Close frame (1005) is answered with a normal closure', () => {
  const c = conn();
  answerEmptyClose(c, 1005);
  assert.deepEqual(c.calls, [[1000, '']]);
});

test('any other close code is left to partyserver', () => {
  for (const code of [1000, 1001, 1006, 1015, 4000, 4030, 4403]) {
    const c = conn();
    answerEmptyClose(c, code);
    assert.deepEqual(c.calls, [], `code ${code}`);
  }
});

test('a socket that is already closed does not throw', () => {
  assert.doesNotThrow(() => answerEmptyClose({ close() { throw new Error('closed'); } }, 1005));
});

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('both rooms answer it from onClose', () => {
  assert.match(src('../../party/board.ts'),
    /onClose\(conn: Connection, code: number, reason: string, wasClean: boolean\) \{\s*try \{ super\.onClose\(conn, code, reason, wasClean\); \} finally \{ answerEmptyClose\(conn, code\); \}/);
  assert.match(src('../../party/workspace.ts'),
    /onClose\(conn: Connection, code: number\) \{\s*this\.depart\(conn\);\s*answerEmptyClose\(conn, code\);/);
});
