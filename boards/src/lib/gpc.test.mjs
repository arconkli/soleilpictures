// Global Privacy Control — the guard that keeps it honoured (2026-10-20).
//
// The privacy and cookie policies say a browser that sends GPC gets no Meta
// Pixel and has nothing sent to Meta's Conversions API. Both halves are one
// forgotten argument from false, and nothing else would notice:
//
//   * every emitCapi({…}) in supabase/functions passes optOut
//   * sendCapiEvent returns on optOut before the request to Meta
//   * gpcFrom reads the Sec-GPC header and the body's gpc flag
//   * a checkout made under GPC is stamped, and both Purchase senders read it
//   * index.html loads the pixel only when navigator.globalPrivacyControl isn't true
//   * every client body that carries Meta's cookies also carries gpc
//
// The edge functions are Deno TypeScript, so this reads their source rather
// than importing them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const boards = path.join(here, '..', '..');
const functionsDir = path.join(boards, '..', 'supabase', 'functions');
const read = (p) => readFileSync(p, 'utf8');

// The brace-balanced object literal opening at the first '{' from `at`.
function objectAt(src, at) {
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(open, i + 1); }
  }
  throw new Error(`unbalanced object at ${at}`);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|jsx|mjs)$/.test(name) && !/\.test\.mjs$/.test(name)) out.push(p);
  }
  return out;
}

test('every Conversions API send in supabase/functions passes optOut', () => {
  const calls = [];
  for (const dir of readdirSync(functionsDir)) {
    const file = path.join(functionsDir, dir, 'index.ts');
    let src;
    try { src = read(file); } catch { continue; }
    for (const m of src.matchAll(/emitCapi\(\s*\{/g)) calls.push({ fn: dir, body: objectAt(src, m.index) });
  }
  assert.ok(calls.length >= 5, `found ${calls.length} emitCapi calls; the scan is looking in the wrong place`);
  for (const c of calls) {
    assert.match(c.body, /\boptOut:\s*\S/, `${c.fn} sends to Meta without saying whether GPC is on`);
  }
});

test('the sender returns on optOut before anything reaches Meta', () => {
  const src = read(path.join(functionsDir, '_shared', 'meta-capi.ts'));
  assert.match(src, /optOut: boolean;/, 'optOut must stay required, so a new sender cannot leave it out');
  const send = src.slice(src.indexOf('export async function sendCapiEvent'));
  const check = send.indexOf('if (ev.optOut) {');
  assert.ok(check > 0, 'sendCapiEvent no longer checks optOut');
  assert.ok(check < send.indexOf('await fetch(url'), 'the optOut check must come before the request to Meta');
  assert.match(objectAt(send, check), /return false;/);

  const gpcFrom = objectAt(src, src.indexOf('export function gpcFrom'));
  assert.match(gpcFrom, /req\.headers\.get\("sec-gpc"\)/, 'the header browsers with GPC on send');
  assert.match(gpcFrom, /\.gpc === true/, 'the flag the app sends for browsers that set only navigator.globalPrivacyControl');
});

test('a checkout made under GPC says so to the senders that read it later', () => {
  const create = read(path.join(functionsDir, 'create-checkout-session', 'index.ts'));
  assert.match(create, /gpc = gpcFrom\(req, body\);/);
  assert.match(create, /\.\.\.\(gpc\s*\?\s*\{ gpc: "1" \}/, 'the Stripe session must carry metadata.gpc');
  // Stripe's own request to the webhook carries no browser signal at all.
  for (const fn of ['stripe-webhook', 'verify-checkout-session']) {
    const src = read(path.join(functionsDir, fn, 'index.ts'));
    assert.match(src, /optOut: m\.gpc === "1"/, `${fn} must withhold the Purchase of a checkout made under GPC`);
  }
});

test('index.html loads the pixel only without GPC', () => {
  const html = read(path.join(boards, 'index.html'));
  assert.equal(html.split('fbevents.js').length - 1, 1, 'exactly one pixel loader');
  // More conditions may join the guard with && (the link-token one has,
  // linkTokens.test.mjs): each can only keep the pixel off in more places.
  const guard = html.search(/if \(navigator\.globalPrivacyControl !== true(?: && !?[A-Za-z_$][\w$]*)*\) \{/);
  const loader = html.indexOf('connect.facebook.net/en_US/fbevents.js');
  const pageView = html.indexOf("fbq('track', 'PageView');");
  assert.ok(guard > 0, 'the pixel snippet lost its GPC guard');
  assert.ok(guard < loader && loader < pageView, 'the loader, init and PageView must sit inside the guard');
  const end = html.indexOf('</script>', pageView);
  assert.match(html.slice(pageView, end), /\n\s*\}\n\s*$/, 'the guard must close after the PageView, in the same script');
});

test('every client body that carries Meta\'s cookies also carries gpc', () => {
  let bodies = 0;
  for (const file of walk(path.join(boards, 'src'))) {
    const src = read(file);
    for (const m of src.matchAll(/JSON\.stringify\(\s*\{/g)) {
      const body = objectAt(src, m.index);
      if (!/\bfbp\b/.test(body)) continue;
      bodies += 1;
      assert.match(body, /\bgpc: gpcOn\(\)/, `${path.relative(boards, file)} sends Meta's cookies without the GPC flag`);
    }
  }
  assert.ok(bodies >= 4, `found ${bodies} bodies carrying fbp; expected the registration, lead, checkout and waitlist ones`);
});
