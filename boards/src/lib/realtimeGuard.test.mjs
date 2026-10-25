// A browser that refuses the WebSocket must not crash the surface that
// subscribes: realtime stays offline, subscribe() returns the channel, and the
// failure is reported once. Uses the real RealtimeClient with a transport
// whose constructor throws — exactly what a blocked socket looks like.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';   // held open, unlike the unref'd timers below
import { RealtimeClient } from '@supabase/realtime-js';
import { guardRealtimeConnect, watchChannels } from './realtimeGuard.js';
import { channelFailure, channelLabel } from './errorCore.js';

const here = dirname(fileURLToPath(import.meta.url));

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

// A socket that opens and answers every join the way Realtime refuses one.
class RefusingJoinSocket {
  constructor() {
    this.readyState = 0;
    setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0);
  }
  send(data) {
    const msg = JSON.parse(data);
    if (msg.event !== 'phx_join') return;
    const reason = `Unauthorized: You do not have permissions to read from this Channel topic: ${msg.topic}`;
    const reply = { topic: msg.topic, event: 'phx_reply', ref: msg.ref, join_ref: msg.join_ref,
      payload: { status: 'error', response: { reason } } };
    setTimeout(() => this.onmessage?.({ data: JSON.stringify(reply) }), 0);
  }
  close() { this.readyState = 3; this.onclose?.({ code: 1000, reason: '' }); }
}

const ID = '4f1c2d3e-aaaa-4bbb-8ccc-123456789abc';

test('every channel is watched however it was subscribed, and its subscriber still hears it', async () => {
  const rt = makeClient();
  guardRealtimeConnect(rt);
  const seen = [];
  watchChannels(rt, (ch, name, status) => seen.push([ch.topic, name, status]));
  const heard = [];
  const ch = rt.channel(`comments:${ID}:k3j2h1`).on('broadcast', { event: 'x' }, () => {});
  assert.equal(ch.subscribe((status) => heard.push(status), 30), ch, 'subscribe still hands back the channel');
  rt.channel(`tags:${ID}:zz`).subscribe(undefined, 30);   // no callback of its own
  await wait(120);
  assert.deepEqual(heard, ['TIMED_OUT']);
  assert.deepEqual(seen, [
    [`realtime:comments:${ID}:k3j2h1`, `comments:${ID}:k3j2h1`, 'TIMED_OUT'],
    [`realtime:tags:${ID}:zz`, `tags:${ID}:zz`, 'TIMED_OUT'],
  ]);
  assert.deepEqual(seen.map(([, name, status]) => [channelLabel(name), channelFailure(status)]),
    [['comments', 'timed out'], ['tags', 'timed out']]);
  // The same name hands back the same channel, watched once and not twice.
  assert.equal(rt.channel(`comments:${ID}:k3j2h1`), ch);
  const subscribeOnce = ch.subscribe;
  watchChannels(rt, () => {});
  assert.equal(rt.channel(`comments:${ID}:k3j2h1`).subscribe, subscribeOnce);
  assert.equal(watchChannels(null), null);
  for (const c of rt.getChannels()) await rt.removeChannel(c);
});

test('a join the server refuses reads by its code word, and the subscriber still has the reason', async () => {
  const rt = new RealtimeClient('wss://example.invalid/realtime/v1', {
    params: { apikey: 'test-key' }, transport: RefusingJoinSocket, vsn: '1.0.0',
  });
  const seen = [];
  watchChannels(rt, (ch, name, status, err) => seen.push([channelLabel(name), channelFailure(status, err)]));
  const heard = [];
  rt.channel(`user:${ID}`, { config: { private: true } }).subscribe((status, err) => heard.push([status, err?.message]));
  await wait(80);
  assert.deepEqual(seen, [['user', 'refused (Unauthorized)']]);
  assert.equal(heard[0][0], 'CHANNEL_ERROR');
  assert.match(heard[0][1], /^Unauthorized: You do not have permissions/);
  rt.disconnect();
});

test('the app\'s client hands every channel on to the error reporting', () => {
  const src = readFileSync(join(here, 'supabase.js'), 'utf8');
  assert.match(src, /watchChannels\(supabase\.realtime, noteChannel\);/);
});
