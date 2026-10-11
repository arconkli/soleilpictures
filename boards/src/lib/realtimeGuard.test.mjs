// A browser that refuses the WebSocket must not crash the surface that
// subscribes: realtime stays offline, subscribe() returns the channel, and the
// failure is reported once. Uses the real RealtimeClient with a transport
// whose constructor throws — exactly what a blocked socket looks like.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtimeClient } from '@supabase/realtime-js';
import { guardRealtimeConnect } from './realtimeGuard.js';

// The client arms join/rejoin/disconnect timers (10s+) that would hold this
// test process open long after the assertions ran. Unref them.
for (const name of ['setTimeout', 'setInterval']) {
  const orig = globalThis[name];
  globalThis[name] = (...args) => { const t = orig(...args); t?.unref?.(); return t; };
}

class RefusedSocket {
  constructor() { throw new Error("Failed to construct 'WebSocket': refused by policy"); }
}

function makeClient() {
  return new RealtimeClient('wss://example.invalid/realtime/v1', {
    params: { apikey: 'test-key' },
    transport: RefusedSocket,
  });
}

test('unguarded: a refused WebSocket makes channel().subscribe() throw (the bug)', () => {
  const rt = makeClient();
  assert.throws(() => rt.channel('t1').subscribe(), /WebSocket not available/);
});

test('guarded: subscribe() returns the channel without throwing and reports once', async () => {
  const rt = makeClient();
  const seen = [];
  guardRealtimeConnect(rt, (e) => seen.push(e));

  let ch1, ch2;
  assert.doesNotThrow(() => { ch1 = rt.channel('t1').on('broadcast', { event: 'x' }, () => {}).subscribe(); });
  assert.doesNotThrow(() => { ch2 = rt.channel('t2').subscribe(() => {}); });
  assert.equal(ch1?.topic, 'realtime:t1');
  assert.equal(ch2?.topic, 'realtime:t2');
  assert.doesNotThrow(() => rt.connect());
  assert.equal(seen.length, 1, 'logged once, not once per subscribe');
  assert.match(seen[0].message, /WebSocket not available/);
  assert.equal(rt.isConnected(), false);
  // Effects' cleanup paths call removeChannel — that must not throw either.
  await rt.removeChannel(ch1);
  await rt.removeChannel(ch2);
});

test('guard is idempotent and tolerates a missing client', () => {
  assert.equal(guardRealtimeConnect(null), null);
  const rt = makeClient();
  guardRealtimeConnect(rt);
  const once = rt.connect;
  guardRealtimeConnect(rt);
  assert.equal(rt.connect, once);
});
