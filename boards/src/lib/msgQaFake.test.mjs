import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeSupabase } from '../local/msgqa/fakeSupabase.js';
import { buildMsgQaDb, SELF_ID, WORKSPACE_ID } from '../local/msgqa/msgQaFixtures.js';

// The Messages QA harness's fake Supabase (?msgqa=1). It has to behave like
// the real client where the messaging code leans on it, or a green spec means
// nothing.

const make = (opts = {}) => {
  const db = buildMsgQaDb();
  const fake = createFakeSupabase({ db, selfId: SELF_ID, ...opts });
  return { db, fake };
};
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

test('a query builder is a thenable with no catch (a stray .catch() must fail loudly)', async () => {
  const { fake } = make();
  const q = fake.from('messages').select('*');
  assert.equal(typeof q.then, 'function');
  assert.equal(q.catch, undefined);
  assert.equal(q.finally, undefined);
  const r = fake.rpc('get_unread_counts');
  assert.equal(typeof r.then, 'function');
  assert.equal(r.catch, undefined);
  assert.throws(() => fake.from('messages').select('*').catch(() => {}), TypeError);
  const { data, error } = await q.eq('conversation_id', 'c-maya').limit(3);
  assert.equal(error, null);
  assert.equal(data.length, 3);
});

test('get_unread_counts: kind user, not yours, not deleted, after your last_read_at', async () => {
  const { db, fake } = make();
  const { data } = await fake.rpc('get_unread_counts');
  assert.deepEqual(data, { 'c-maya': 2 });
  // A deleted one, a system one and one of yours do not count.
  const maya = fake.qa.peer('maya');
  const row = maya.send('c-maya', 'one more');
  assert.equal((await fake.rpc('get_unread_counts')).data['c-maya'], 3);
  maya.delete(row.id);
  assert.equal((await fake.rpc('get_unread_counts')).data['c-maya'], 2);
  db.messages.push({ ...db.messages[0], id: 'sys-x', kind: 'system', conversation_id: 'c-maya', sender_id: 'maya', created_at: new Date().toISOString() });
  db.messages.push({ ...db.messages[0], id: 'mine-x', kind: 'user', conversation_id: 'c-maya', sender_id: SELF_ID, created_at: new Date().toISOString() });
  assert.equal((await fake.rpc('get_unread_counts')).data['c-maya'], 2);
  // Reading it clears the count.
  await fake.from('conversation_participants').update({ last_read_at: new Date(Date.now() + 1000).toISOString() })
    .eq('conversation_id', 'c-maya').eq('user_id', SELF_ID);
  assert.equal((await fake.rpc('get_unread_counts')).data['c-maya'], undefined);
});

test('insert accepts a client id, stamps created_at, and a duplicate id is 23505', async () => {
  const { db, fake } = make();
  const row = {
    id: 'client-id-1', workspace_id: WORKSPACE_ID, conversation_id: 'c-maya', sender_id: SELF_ID,
    body: 'hello', attachments: [], mentions: [], kind: 'user',
  };
  const first = await fake.from('messages').insert(row).select().single();
  assert.equal(first.error, null);
  assert.equal(first.data.id, 'client-id-1');
  assert.ok(Date.parse(first.data.created_at) > 0);
  assert.equal(db.conversations.find((c) => c.id === 'c-maya').last_message_at, first.data.created_at);
  const dup = await fake.from('messages').insert(row).select().single();
  assert.equal(dup.data, null);
  assert.equal(dup.error.code, '23505');
  assert.equal(db.messages.filter((m) => m.id === 'client-id-1').length, 1);
});

test('RLS: you cannot write as someone else, edit their message, or touch their participant row', async () => {
  const { db, fake } = make();
  const asOther = await fake.from('messages').insert({ conversation_id: 'c-maya', sender_id: 'maya', body: 'x' }).select().single();
  assert.equal(asOther.error.code, '42501');
  const left = await fake.from('messages').insert({ conversation_id: 'c-left', sender_id: SELF_ID, body: 'x' }).select().single();
  assert.equal(left.error.code, '42501');
  const theirs = await fake.from('messages').update({ body: 'hacked' }).eq('id', 'maya-01').select('id');
  assert.deepEqual(theirs.data, []);
  assert.notEqual(db.messages.find((m) => m.id === 'maya-01').body, 'hacked');
  const mine = await fake.from('messages').update({ body: 'edited' }).eq('id', 'maya-05').select('id');
  assert.equal(mine.data.length, 1);
  const part = await fake.from('conversation_participants').update({ last_read_at: null }).eq('user_id', 'maya').select('user_id');
  assert.deepEqual(part.data, []);
});

test('you see only conversations you participate in', async () => {
  const { db, fake } = make();
  db.conversations.push({ id: 'c-secret', workspace_id: WORKSPACE_ID, title: 'Secret', created_by: 'jon', created_at: new Date().toISOString(), last_message_at: null });
  db.conversation_participants.push({ conversation_id: 'c-secret', user_id: 'jon', joined_at: '', left_at: null, last_read_at: '' });
  const { data } = await fake.from('conversation_summary').select('*');
  assert.ok(data.length >= 5);
  assert.ok(!data.some((c) => c.conversation_id === 'c-secret'));
  const maya = data.find((c) => c.conversation_id === 'c-maya');
  assert.equal(maya.last_message_sender_id, 'maya');
  assert.equal(maya.active_participant_count, 2);
});

test('fetching a thread pages newest-first and soft-deleted rows are left out', async () => {
  const { fake } = make();
  const newest = await fake.from('messages').select('*').eq('conversation_id', 'c-long').is('deleted_at', null)
    .order('created_at', { ascending: false }).limit(200);
  assert.equal(newest.data.length, 200);
  assert.equal(newest.data[0].id, 'long-320');
  const older = await fake.from('messages').select('*').eq('conversation_id', 'c-long').is('deleted_at', null)
    .lt('created_at', newest.data[199].created_at).order('created_at', { ascending: false }).limit(200);
  assert.equal(older.data.length, 120);
  const cast = await fake.from('messages').select('id').eq('conversation_id', 'c-cast').is('deleted_at', null);
  assert.ok(!cast.data.some((m) => m.id === 'cast-09'));
  assert.ok(cast.data.some((m) => m.id === 'cast-10'));
});

test('channels: self:false does not echo to the sender, but another client on the topic hears it', async () => {
  const { fake } = make();
  const other = fake.clientFor('maya');
  const got = { mine: [], theirs: [] };
  const a = fake.channel('conv:c-maya', { config: { broadcast: { self: false } } });
  a.on('broadcast', { event: 'chat-message' }, (m) => got.mine.push(m.payload));
  a.subscribe();
  const b = other.channel('conv:c-maya');
  b.on('broadcast', { event: 'chat-message' }, (m) => got.theirs.push(m.payload));
  b.subscribe();
  await tick();
  assert.equal(await a.send({ type: 'broadcast', event: 'chat-message', payload: { n: 1 } }), 'ok');
  assert.deepEqual(got.mine, []);
  assert.deepEqual(got.theirs, [{ n: 1 }]);
  // self:true echoes.
  const c = fake.channel('conv:c-cast', { config: { broadcast: { self: true } } });
  const echoed = [];
  c.on('broadcast', { event: 'x' }, (m) => echoed.push(m.payload));
  c.subscribe();
  await tick();
  await c.send({ type: 'broadcast', event: 'x', payload: 7 });
  assert.deepEqual(echoed, [7]);
});

test('channels are deduped by topic, removed on removeChannel, and StrictMode-safe', async () => {
  const { fake } = make();
  const a = fake.channel('user:qa-me');
  assert.equal(fake.channel('user:qa-me'), a);
  // Mount, unmount before SUBSCRIBED lands, mount again.
  const seen = [];
  a.on('broadcast', { event: 'inbox-ping' }, (m) => seen.push(m.payload.message_id));
  a.subscribe((s) => seen.push(s));
  await fake.removeChannel(a);
  const b = fake.channel('user:qa-me');
  assert.notEqual(b, a);
  b.on('broadcast', { event: 'inbox-ping' }, (m) => seen.push(m.payload.message_id));
  b.subscribe((s) => seen.push(s));
  await tick();
  assert.deepEqual(seen, ['SUBSCRIBED']); // the removed channel never reported
  assert.throws(() => b.on('broadcast', { event: 'y' }, () => {}), /after subscribe/);
  fake.qa.peer('maya').send('c-maya', 'ping');
  assert.equal(seen.length, 2);
  await fake.removeChannel(b);
  fake.qa.peer('maya').send('c-maya', 'ping 2');
  assert.equal(seen.length, 2);
  assert.deepEqual(fake.qa.openChannels(), []);
});

test('dropSocket re-emits SUBSCRIBED on every open channel', async () => {
  const { fake } = make();
  const seen = [];
  const a = fake.channel('conv:c-maya');
  a.subscribe((s) => seen.push(s));
  await tick();
  fake.qa.dropSocket();
  await tick();
  assert.deepEqual(seen, ['SUBSCRIBED', 'SUBSCRIBED']);
});

test('storage: the upload path must be <workspace>/<you>/<uuid>.<ext>', async () => {
  const { db, fake } = make();
  const bucket = fake.storage.from('message-attachments');
  const file = { size: 12, type: 'image/png' };
  const id = '123e4567-e89b-42d3-a456-426614174000';
  const ok = await bucket.upload(`${WORKSPACE_ID}/${SELF_ID}/${id}.png`, file, { contentType: 'image/png', upsert: false });
  assert.equal(ok.error, null);
  assert.equal(db.storage.get(`${WORKSPACE_ID}/${SELF_ID}/${id}.png`).contentType, 'image/png');
  assert.ok((await bucket.upload(`${WORKSPACE_ID}/${SELF_ID}/${id}.png`, file, { upsert: false })).error);   // exists
  assert.ok((await bucket.upload(`${SELF_ID}/${id}.png`, file)).error);                                     // too short
  assert.ok((await bucket.upload(`${WORKSPACE_ID}/maya/${id}.png`, file)).error);                           // not yours
  assert.ok((await bucket.upload(`${WORKSPACE_ID}/${SELF_ID}/not-a-uuid.png`, file)).error);
  fake.qa.failNext('upload');
  assert.ok((await bucket.upload(`${WORKSPACE_ID}/${SELF_ID}/223e4567-e89b-42d3-a456-426614174000.png`, file)).error);
});

test('a peer send pings every other active participant and nudges the conversation', async () => {
  const { fake } = make();
  const pings = { me: [], jon: [], lena: [], sam: [] };
  const convEvents = [];
  const subscribe = (client, topic, event, sink) => {
    const ch = client.channel(topic);
    ch.on('broadcast', { event }, (m) => sink.push(m.payload));
    ch.subscribe();
  };
  subscribe(fake, 'user:qa-me', 'inbox-ping', pings.me);
  subscribe(fake.clientFor('jon'), 'user:jon', 'inbox-ping', pings.jon);
  subscribe(fake.clientFor('lena'), 'user:lena', 'inbox-ping', pings.lena);
  subscribe(fake.clientFor('sam'), 'user:sam', 'inbox-ping', pings.sam);
  subscribe(fake, 'conv:c-cast', 'chat-message', convEvents);
  await tick();
  const row = fake.qa.peer('lena').send('c-cast', 'Sides are out @Jon Park', { mentions: ['jon'] });
  assert.equal(pings.lena.length, 0);                                   // not the sender
  for (const k of ['me', 'jon', 'sam']) assert.equal(pings[k].length, 1, k);
  assert.equal(pings.jon[0].conversation_id, 'c-cast');
  assert.equal(pings.jon[0].message_id, row.id);
  assert.deepEqual(pings.jon[0].mentions, ['jon']);
  assert.equal(pings.jon[0].body_preview, 'Sides are out @Jon Park');
  assert.equal(convEvents.length, 1);
  assert.equal(convEvents[0].body, 'Sides are out @Jon Park');
  // An edit is a { changed, id } nudge; a system row pings nobody.
  fake.qa.peer('lena').edit(row.id, 'Sides are out');
  assert.deepEqual(convEvents[1], { changed: 'edit', id: row.id });
  fake.qa.peer('lena').send('c-cast', 'Lena added Priya', { kind: 'system' });
  assert.equal(pings.me.length, 1);
});

test('failNext and setLatency target a call by name; calls are recorded', async () => {
  const { fake } = make();
  fake.qa.failNext('rpc:toggle_message_reaction', { error: { message: 'nope', code: 'X1' } });
  const bad = await fake.rpc('toggle_message_reaction', { p_message_id: 'maya-01', p_emoji: '👍' });
  assert.equal(bad.error.code, 'X1');
  const good = await fake.rpc('toggle_message_reaction', { p_message_id: 'maya-01', p_emoji: '👍' });
  assert.deepEqual(good.data, { '👍': [SELF_ID] });
  fake.qa.setLatency({ 'select:messages': 40 });
  const t0 = Date.now();
  await fake.from('messages').select('id').limit(1);
  assert.ok(Date.now() - t0 >= 35);
  assert.ok(fake.qa.calls.some((c) => c.kind === 'rpc' && c.target === 'rpc:toggle_message_reaction'));
  assert.equal((await fake.rpc('no_such_rpc')).error.code, 'PGRST202');
});

test('find_or_create_dm reuses a DM, creates one otherwise; add_conversation_participants rejoins', async () => {
  const { fake } = make();
  assert.equal((await fake.rpc('find_or_create_dm', { p_workspace: WORKSPACE_ID, p_peer: 'maya' })).data, 'c-maya');
  const fresh = (await fake.rpc('find_or_create_dm', { p_workspace: WORKSPACE_ID, p_peer: 'lena' })).data;
  assert.ok(fresh && !['c-maya', 'c-cast'].includes(fresh));
  const g = (await fake.rpc('create_group_conversation', { p_workspace: WORKSPACE_ID, p_title: ' Crew ', p_member_ids: ['jon', 'sam'] })).data;
  const sum = (await fake.from('conversation_summary').select('*').eq('conversation_id', g).single()).data;
  assert.equal(sum.title, 'Crew');
  assert.equal(sum.active_participant_count, 3);
  const added = (await fake.rpc('add_conversation_participants', { p_conversation_id: g, p_user_ids: ['jon', 'priya'] })).data;
  assert.deepEqual(added, ['priya']);
  assert.deepEqual((await fake.rpc('list_messageable_users', { p_workspace: WORKSPACE_ID, p_query: 'pri' })).data.map((u) => u.user_id), ['priya']);
});

test('analytics_events takes inserts (rows land in qa.events) and nothing else', async () => {
  const { fake } = make();
  const row = { event: 'msg_send', props: { ok: true }, user_id: SELF_ID };
  assert.deepEqual(await fake.from('analytics_events').insert([row]), { data: null, error: null });
  assert.deepEqual(fake.qa.events, [row]);
  assert.ok(fake.qa.calls.some((c) => c.target === 'insert:analytics_events'));
  fake.qa.failNext('insert:analytics_events');
  assert.equal((await fake.from('analytics_events').insert([row])).error.code, 'QA000');
  assert.equal(fake.qa.events.length, 1);
  assert.equal((await fake.from('analytics_events').update({ event: 'x' }).eq('event', 'msg_send')).error.code, '0A000');
});
