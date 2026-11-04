// The look-switch stamp in send-transactional-email (see the comment above
// stampLookSwitch there). Read as text: the function needs Deno.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../../supabase/functions/send-transactional-email/index.ts', import.meta.url), 'utf8');
const { renderTemplate, TEMPLATE_NAMES } = await import('../../../supabase/functions/_shared/email/templates.ts');

const fn = src.slice(src.indexOf('async function stampLookSwitch'), src.indexOf('// Per-template From routing.'));

test('the stamp is an insert-if-absent on email_look_switch', () => {
  assert.match(fn, /\.upsert\(/);
  assert.ok(fn.includes('key: "email_look_switch"'));
  assert.match(fn, /ignoreDuplicates:\s*true/);
  assert.match(fn, /onConflict:\s*"key"/);
});

test('the stamp starts after the successful send is logged and never holds up the response', () => {
  const logged = src.indexOf('ok: true, resendId');
  const stamped = src.indexOf('keepAlive(stampLookSwitch(body.template');
  const answered = src.indexOf('return json({ ok: true, id: resendBody.id }');
  assert.ok(logged > 0 && stamped > logged && answered > stamped);
  assert.ok(!src.includes('await stampLookSwitch('), 'never awaited');
  assert.match(fn, /\.abortSignal\(AbortSignal\.timeout\(/, 'its own timeout');
  assert.match(fn, /finally \{\s*lookSwitchInFlight = false;/, 'one at a time, and it can try again');
});

test('the upsert sits inside a try and is never .catch()ed', () => {
  const t = fn.indexOf('try {');
  assert.ok(t > 0 && fn.indexOf('.upsert(') > t);
  assert.ok(fn.indexOf('} catch', t) > fn.indexOf('.upsert('));
  assert.ok(!fn.includes('.catch('));
});

test('it stops early for the flag, no client, other templates and legacy editions', () => {
  assert.match(fn, /lookSwitchStamped \|\| lookSwitchInFlight \|\| !logDb \|\| !NOTE_LOOK_TEMPLATES\.includes\(template\)/);
  assert.ok(fn.includes('isLegacyLookEdition(v)'));
  assert.ok(fn.includes('String(data.version).replace(/[^A-Za-z0-9._-]/g, "").slice(0, 32)'));
});

test('NOTE_LOOK_TEMPLATES is exactly the templates rendered by renderPlainNote', () => {
  const m = src.match(/const NOTE_LOOK_TEMPLATES = \[([^\]]*)\]/);
  assert.ok(m);
  const listed = [...m[1].matchAll(/"([a-z_0-9]+)"/g)].map((x) => x[1]).sort();
  const sample = {
    unsubscribeToken: 'tok', workspaceId: '11111111-1111-1111-1111-111111111111',
    items: ['one thing'], subject: 'Hello', ctaPath: '/', title: 'Someone opened it', viewers: 1,
  };
  const notes = [];
  for (const name of TEMPLATE_NAMES) {
    let r;
    try { r = renderTemplate(name, sample); } catch { continue; }
    if (r.html && r.html.includes('Not into these?')) notes.push(name);
  }
  assert.deepEqual(notes.sort(), listed);
});
