// emailReplyTo.test.mjs — a reply to anything Clusters sends reaches a person.
//
//   node --test src/lib/emailReplyTo.test.mjs
//
// Mail to hello@clusters.soleilpictures.com lands in Resend's inbound (the
// subdomain's MX), and nothing reads it there: resend-webhook takes delivery
// events, never email.received. So the clusters subdomain stays the sender
// (its DKIM, its reputation), while every Reply-To, and every address the app
// tells someone to write to, is hello@soleilpictures.com, the Google Workspace
// inbox the owner reads (owner, 2026-10-21).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('both senders reply to the inbox a person reads', () => {
  for (const fn of ['send-transactional-email', 'billing-reconcile-cron']) {
    const src = read(`../../../supabase/functions/${fn}/index.ts`);
    assert.match(src, /const REPLY_TO\s+= "hello@soleilpictures\.com";/, `${fn}'s REPLY_TO`);
    assert.match(src, /const FROM_HELLO\s+= "Clusters <hello@clusters\.soleilpictures\.com>";/,
      `${fn} still sends from the clusters subdomain`);
  }
});

test('the app never tells anyone to write to the clusters inbox', () => {
  const src = join(dirname(fileURLToPath(import.meta.url)), '..');
  const hits = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.(jsx?|mjs)$/.test(name) || name.endsWith('.test.mjs')) continue;
      if (readFileSync(p, 'utf8').includes('hello@clusters.soleilpictures.com')) hits.push(p.slice(src.length + 1));
    }
  };
  walk(src);
  assert.deepEqual(hits, [], 'point people at hello@soleilpictures.com instead');
});
