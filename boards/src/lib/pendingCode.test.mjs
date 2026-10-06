// pendingCode.test.mjs — the code step's memory, and the mailbox shortcut.
//
//   node --test src/lib/pendingCode.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PENDING_CODE_KEY, PENDING_CODE_TTL_MS, savePendingCode, readPendingCode, clearPendingCode, resendWait,
} from './pendingCode.js';
import { mailboxFor, isConsumerAddress } from './mailboxLink.js';

function mem() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}

test('a saved code step comes back within the window, with the address only', () => {
  const s = mem();
  assert.equal(savePendingCode(s, 'ana@gmail.com', 1_000_000), true);
  assert.deepEqual(readPendingCode(s, 1_000_000 + 60_000), { email: 'ana@gmail.com', sentAt: 1_000_000 });
  assert.doesNotMatch(s._m.get(PENDING_CODE_KEY), /code"\s*:/, 'the code itself is never stored');
});

test('an expired, malformed or future-dated entry is dropped and removed', () => {
  const s = mem();
  savePendingCode(s, 'ana@gmail.com', 0);
  assert.equal(readPendingCode(s, PENDING_CODE_TTL_MS + 1), null);
  assert.equal(s._m.has(PENDING_CODE_KEY), false, 'expired entry removed');
  s.setItem(PENDING_CODE_KEY, '{not json');
  assert.equal(readPendingCode(s, 5), null);
  s.setItem(PENDING_CODE_KEY, JSON.stringify({ email: 'nope', sentAt: 5 }));
  assert.equal(readPendingCode(s, 5), null);
  s.setItem(PENDING_CODE_KEY, JSON.stringify({ email: 'a@b.co', sentAt: 10_000_000 }));
  assert.equal(readPendingCode(s, 0), null, 'a clock far in the future is not trusted');
});

test('clear forgets it, and storage that throws never throws out', () => {
  const s = mem();
  savePendingCode(s, 'ana@gmail.com', 0);
  clearPendingCode(s);
  assert.equal(readPendingCode(s, 1), null);
  const bad = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  assert.equal(savePendingCode(bad, 'ana@gmail.com', 0), false);
  assert.equal(readPendingCode(bad, 0), null);
  assert.doesNotThrow(() => clearPendingCode(bad));
  assert.equal(readPendingCode(null, 0), null);
});

test('the resend cooldown resumes where it was', () => {
  assert.equal(resendWait(0, 0), 60);
  assert.equal(resendWait(0, 25_000), 35);
  assert.equal(resendWait(0, 90_000), 0);
  assert.equal(resendWait(10_000, 0), 60, 'never more than the full cooldown');
});

test('known inboxes get a shortcut; Gmail searches every folder', () => {
  const g = mailboxFor('Ana@GMAIL.com');
  assert.equal(g.id, 'gmail');
  assert.match(decodeURIComponent(g.href), /in:anywhere/, 'spam and promotions included');
  assert.equal(mailboxFor('x@hotmail.co.uk').id, 'outlook');
  assert.equal(mailboxFor('x@yahoo.fr').id, 'yahoo');
  assert.equal(mailboxFor('x@me.com').id, 'icloud');
  assert.equal(mailboxFor('x@proton.me').id, 'proton');
  assert.equal(mailboxFor('x@studio.film'), null);
  assert.equal(mailboxFor('not an email'), null);
});

test('work and school domains are told apart from personal ones', () => {
  for (const e of ['a@gmail.com', 'a@gmx.de', 'a@naver.com', 'a@orange.fr', 'a@yandex.ru', 'a@outlook.com', 'a@qq.com']) {
    assert.equal(isConsumerAddress(e), true, e);
  }
  for (const e of ['a@studio.film', 'a@university.edu', 'a@agency.co.uk', 'a@company.com']) {
    assert.equal(isConsumerAddress(e), false, e);
  }
  assert.equal(isConsumerAddress(''), true, 'no hint for an empty field');
});

test('the Gmail shortcut opens the account the code went to; Yahoo Japan is its own service', () => {
  const g = mailboxFor('Someone@Gmail.com');
  assert.match(g.href, /[?&]authuser=someone%40gmail\.com#search\//, 'authuser, not /u/0/');
  assert.equal(mailboxFor('a@yahoo.co.jp').id, 'yahoo_jp');
  assert.match(mailboxFor('a@yahoo.co.jp').href, /mail\.yahoo\.co\.jp/);
  assert.equal(mailboxFor('a@yahoo.co.uk').id, 'yahoo');
});
