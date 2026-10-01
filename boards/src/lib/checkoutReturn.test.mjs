// checkoutReturn — the trial flag and the waiting folder survive the trip to
// Stripe and back, expire, and never throw when storage does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  noteCheckoutStart, notePendingImport, readCheckoutReturn, clearCheckoutReturn, CHECKOUT_RETURN_TTL_MS,
} from './checkoutReturn.js';

function memStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

function throwingStore() {
  const boom = () => { throw new Error('SecurityError'); };
  return { getItem: boom, setItem: boom, removeItem: boom };
}

test('a trial checkout is remembered across the redirect', () => {
  const s = memStore();
  noteCheckoutStart({ trial: true, plan: 'monthly' }, s, 1000);
  assert.deepEqual(readCheckoutReturn(s, 2000), { trial: true, plan: 'monthly', importN: 0 });
});

test('a plain purchase reads as not-a-trial', () => {
  const s = memStore();
  noteCheckoutStart({ trial: false, plan: 'annual' }, s, 1000);
  assert.equal(readCheckoutReturn(s, 1001).trial, false);
});

test('the waiting folder and the checkout note merge rather than overwrite', () => {
  const s = memStore();
  notePendingImport({ n: 65 }, s, 1000);
  noteCheckoutStart({ trial: true, plan: 'annual' }, s, 1500);
  assert.deepEqual(readCheckoutReturn(s, 2000), { trial: true, plan: 'annual', importN: 65 });
});

test('a non-positive or junk folder size records nothing', () => {
  const s = memStore();
  notePendingImport({ n: 0 }, s, 1000);
  notePendingImport({ n: 'x' }, s, 1000);
  assert.equal(readCheckoutReturn(s, 1000), null);
});

test('the note expires after an hour so it cannot greet an unrelated visit', () => {
  const s = memStore();
  noteCheckoutStart({ trial: true }, s, 0);
  assert.equal(readCheckoutReturn(s, CHECKOUT_RETURN_TTL_MS + 1), null);
  // …and the expired record is gone, not merely ignored.
  assert.equal(readCheckoutReturn(s, 1), null);
});

test('an unknown plan is not echoed back', () => {
  const s = memStore();
  noteCheckoutStart({ trial: true, plan: 'lifetime' }, s, 1);
  assert.equal(readCheckoutReturn(s, 2).plan, null);
});

test('clear removes it', () => {
  const s = memStore();
  noteCheckoutStart({ trial: true }, s, 1);
  clearCheckoutReturn(s);
  assert.equal(readCheckoutReturn(s, 2), null);
});

test('storage that throws never breaks a checkout', () => {
  const s = throwingStore();
  assert.doesNotThrow(() => noteCheckoutStart({ trial: true }, s, 1));
  assert.doesNotThrow(() => notePendingImport({ n: 3 }, s, 1));
  assert.equal(readCheckoutReturn(s, 2), null);
  assert.doesNotThrow(() => clearCheckoutReturn(s));
  assert.equal(readCheckoutReturn(null, 2), null);
});
